from __future__ import annotations
import os
import json
import time
import tempfile
import asyncio
import random
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional
from concurrent.futures import ThreadPoolExecutor

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))

PCT_TZ = timezone(timedelta(hours=-7))

# In-memory atomic cache
_flipp_cache: Optional[Dict[str, Any]] = None
_flipp_cache_ts: float = 0.0

CACHE_FILE_NAME = "vancouver_flipp_flyers.json"
DEFAULT_POSTAL_CODE = "V5P1W3"
CACHE_EXPIRY = 43200  # 12 小時 (每 12 小時檢查更新 1 次)

# 知名大溫超市官網對應表 (用於日期右方點擊前往該商店官網)
MERCHANT_WEBSITES: Dict[str, str] = {
    "T&T Supermarket": "https://www.tntsupermarket.com",
    "Real Canadian Superstore": "https://www.realcanadiansuperstore.ca",
    "Walmart": "https://www.walmart.ca",
    "Costco": "https://www.costco.ca",
    "Safeway": "https://www.safeway.ca",
    "Save-On-Foods": "https://www.saveonfoods.com",
    "No Frills": "https://www.nofrills.ca",
    "FreshCo": "https://freshco.com",
    "Choices Markets": "https://www.choicesmarkets.com",
    "Buy-Low Foods": "https://www.buy-low.com",
    "Nesters Market": "https://www.nestersmarket.com",
    "PriceSmart foods": "https://www.pricesmartfoods.com",
    "Urban Fare": "https://www.urbanfare.com",
    "Wholesale Club and Club Entrepôt": "https://www.wholesaleclub.ca",
    "Wholesale Club and Club Entrepot": "https://www.wholesaleclub.ca",
    "Foody World": "https://www.foodyworldrichmond.ca/",
    "88 Supermarket": "https://88supermarket.ca",
    "Chong Lee Market": "https://chonglee.ca/",
    "Fruiticana": "https://fruiticana.com",
    "SuperValu": "https://www.coastgrocery.ca/gibsons",
    "Supervalu": "https://www.coastgrocery.ca/gibsons",
    "Loblaws": "https://www.loblaws.ca",
    "M&M Food Market": "https://www.mmfoodmarket.com",
    "Your Independent Grocer": "https://www.yourindependentgrocer.ca",
    "Freshmart": "https://www.freshmart.ca",
    "Donald's Market": "https://donaldsmarkethastings.com/",
    "Donalds Market": "https://donaldsmarkethastings.com/",
    "Greens Organic and Natural Market": "https://greensmarket.ca",
    "Pomme Produce": "https://pommenaturalmarket.com",
    "Subway": "https://www.subway.com",
    "Super Grocer & Pharmacy": "https://supergrocer.ca",
    "Chalo FreshCo": "https://chalofreshco.com",
    "Famous Foods": "https://famousfoods.ca",
    "Sabzi Mandi": "https://sabzimandicanada.com/",
    "President's Choice": "https://www.pcoptimum.ca/presidents-choice",
    "Presidents Choice": "https://www.pcoptimum.ca/presidents-choice"
}

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".flipp_", suffix=".tmp", dir=parent_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

def _get_cache_paths() -> tuple[str, str]:
    b_path = os.path.join(DATA_DIR, CACHE_FILE_NAME)
    f_path = os.path.join(FRONTEND_PUBLIC_DIR, CACHE_FILE_NAME)
    return b_path, f_path

def generate_flipp_sid() -> str:
    """產生 16 位 Flipp 客戶端 Session ID"""
    return str(random.randint(1000000000000000, 9999999999999999))

def fetch_single_flyer_items(flyer_id: int) -> List[Dict[str, Any]]:
    """連線 API 2 取得單獨 flyer 的所有商品特惠資料"""
    url = f"https://dam.flippenterprise.net/api/flipp/flyers/{flyer_id}/flyer_items?locale=en"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://flipp.com/"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                items = []
                for it in data:
                    items.append({
                        "id": it.get("id"),
                        "name": it.get("name"),
                        "price": it.get("price"),
                        "brand": it.get("brand"),
                        "valid_from": it.get("valid_from"),
                        "valid_to": it.get("valid_to"),
                        "cutout_image_url": it.get("cutout_image_url")
                    })
                return items
    except Exception as e:
        print(f"⚠️ 載入 Flyer {flyer_id} 商品錯誤: {e}")
    return []

def fetch_flipp_flyers(force: bool = False, postal_code: str = DEFAULT_POSTAL_CODE) -> Dict[str, Any]:
    """
    全數連線 Flipp 官方真實 API (每 12 小時自動檢查更新 1 次，快取效期 43200 秒)。
    更新邏輯：
    1. 針對已過期的 flyers 更新
    2. 檢查 API 1 的 valid_from 是否為今天日期，才重新抓取該子分頁商品資料
    """
    global _flipp_cache, _flipp_cache_ts
    now = time.time()
    b_cache_file, f_cache_file = _get_cache_paths()

    # 1. 記憶體快取 (0ms 極速)
    if not force and _flipp_cache and (now - _flipp_cache_ts < CACHE_EXPIRY):
        return _flipp_cache

    # 2. 磁碟快取檢視
    existing_merchants_map: Dict[str, Dict[str, Any]] = {}
    if os.path.exists(b_cache_file):
        try:
            mtime = os.path.getmtime(b_cache_file)
            with open(b_cache_file, "r", encoding="utf-8") as f:
                disk_data = json.load(f)
                if disk_data and isinstance(disk_data.get("merchants"), list):
                    for m in disk_data["merchants"]:
                        existing_merchants_map[m["merchant"]] = m
                    if not force and (now - mtime < CACHE_EXPIRY):
                        _flipp_cache = disk_data
                        _flipp_cache_ts = mtime
                        return disk_data
        except Exception:
            pass

    # 3. 呼叫 API 1 取得大溫全數超市 flyers
    sid = "6364941772613210"
    api1_url = f"https://dam.flippenterprise.net/api/flipp/data?locale=en&postal_code={postal_code}&sid={sid}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://flipp.com/"
    }

    try:
        resp = requests.get(api1_url, headers=headers, timeout=15)
        raw_data = resp.json() if resp.status_code == 200 else {}
    except Exception as e:
        print(f"⚠️ 連線 Flipp API 1 失敗: {e}")
        raw_data = {}

    all_flyers = raw_data.get("flyers", [])
    if not all_flyers and existing_merchants_map:
        # 降級維持既有快取
        return {
            "success": True,
            "updated_at": datetime.now(PCT_TZ).isoformat(),
            "postal_code": postal_code,
            "total_merchants": len(existing_merchants_map),
            "merchants": list(existing_merchants_map.values())
        }

    # 篩選 Groceries (超級市場)
    grocery_flyers = [f for f in all_flyers if "Groceries" in (f.get("categories") or [])]
    
    # 依 merchant 分組，保留第一份最新特惠傳單
    merchant_flyers: Dict[str, Dict[str, Any]] = {}
    for f in grocery_flyers:
        m_name = (f.get("merchant") or "").strip()
        if not m_name:
            continue
        if m_name not in merchant_flyers:
            merchant_flyers[m_name] = f

    # A-Z 字母順序排序
    sorted_merchant_names = sorted(merchant_flyers.keys())
    now_pct = datetime.now(PCT_TZ)
    today_str = now_pct.strftime("%Y-%m-%d")

    flyers_to_fetch_items: List[tuple[str, int, Dict[str, Any]]] = []
    result_merchants: List[Dict[str, Any]] = []

    for m_name in sorted_merchant_names:
        f = merchant_flyers[m_name]
        f_id = f["id"]
        v_from = f.get("valid_from") or ""
        v_to = f.get("valid_to") or ""
        
        # 取得官網連結
        website_url = MERCHANT_WEBSITES.get(m_name, f"https://flipp.com/en-ca/vancouver-bc/flyer/{f_id}")

        # 檢查更新條件：
        # 1. 舊資料是否存在且 flyer_id 相同
        # 2. 舊 flyer 是否已過期
        # 3. API 1 的 valid_from 是否為今天 (新 flyer 發布)
        existing = existing_merchants_map.get(m_name)
        need_fetch = force or not existing or existing.get("flyer_id") != f_id

        if not need_fetch and existing:
            # 檢查 valid_to 是否過期
            try:
                # 解析 ISO 日期
                v_to_dt = datetime.fromisoformat(v_to.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > v_to_dt:
                    need_fetch = True
            except Exception:
                pass

            # 檢查 valid_from 是否為今天
            if v_from.startswith(today_str):
                need_fetch = True

        m_data = {
            "merchant": m_name,
            "merchant_id": f.get("merchant_id"),
            "merchant_logo": f.get("merchant_logo"),
            "flyer_id": f_id,
            "flyer_name": f.get("name"),
            "valid_from": v_from,
            "valid_to": v_to,
            "website_url": website_url,
            "items_count": 0,
            "items": []
        }

        if need_fetch or not existing or not existing.get("items"):
            flyers_to_fetch_items.append((m_name, f_id, m_data))
        else:
            m_data["items"] = existing.get("items", [])
            m_data["items_count"] = len(m_data["items"])
            result_merchants.append(m_data)

    # 平行抓取需要更新的 flyer items
    if flyers_to_fetch_items:
        print(f"🛒 [Flipp Service] 正在平行更新 {len(flyers_to_fetch_items)} 個商戶的最新傳單商品...")
        def _fetch_worker(tup):
            name, fid, obj = tup
            items = fetch_single_flyer_items(fid)
            obj["items"] = items
            obj["items_count"] = len(items)
            return obj

        with ThreadPoolExecutor(max_workers=8) as executor:
            fetched_objs = list(executor.map(_fetch_worker, flyers_to_fetch_items))
            result_merchants.extend(fetched_objs)

    # 重新按商戶名稱 A-Z 排序
    result_merchants.sort(key=lambda x: x["merchant"].lower())

    payload = {
        "success": True,
        "updated_at": datetime.now(PCT_TZ).isoformat(),
        "postal_code": postal_code,
        "total_merchants": len(result_merchants),
        "merchants": result_merchants
    }

    _flipp_cache = payload
    _flipp_cache_ts = now

    try:
        _atomic_write_json(b_cache_file, payload)
        if os.path.exists(FRONTEND_PUBLIC_DIR):
            _atomic_write_json(f_cache_file, payload)
    except Exception as e:
        print(f"⚠️ 寫入 Flipp 傳單快取失敗: {e}")

    return payload

async def run_flipp_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每 12 小時自動檢查更新 1 次)
    """
    print("🛒 [Flipp Service] 大溫超市特惠傳單背景定時快取服務啟動 (12 小時週期)...")
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, fetch_flipp_flyers, False)
    except Exception as e:
        print(f"⚠️ [Flipp Service] 啟動預熱失敗: {e}")

    while True:
        try:
            # 12 小時 (43200 秒)
            await asyncio.sleep(43200)
            await loop.run_in_executor(None, fetch_flipp_flyers, False)
            print("✅ [Flipp Service] 大溫超市特惠傳單定時排程檢查更新完成！")
        except Exception as e:
            print(f"⚠️ [Flipp Service] 背景更新錯誤: {e}")
