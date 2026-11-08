import os
import json
import time
import logging
import asyncio
import tempfile
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))

LOTTERY_CACHE_FILE = os.path.join(DATA_DIR, "vancouver_lottery_cache.json")
FRONTEND_LOTTERY_CACHE_FILE = os.path.join(FRONTEND_PUBLIC_DIR, "vancouver_lottery_cache.json")

# In-memory cache (TTL: 12 hours = 43200 seconds)
_lottery_cache: Dict[str, Any] = {
    "timestamp": 0,
    "data": None
}

# 卑詩省常年固定太平洋時間 (PCT = UTC-7)
PCT_TZ = timezone(timedelta(hours=-7))

def get_vancouver_now() -> datetime:
    return datetime.now(PCT_TZ)

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".lottery_", suffix=".tmp", dir=parent_dir)
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

def calculate_next_draw_date(draw_days: list[int]) -> str:
    """
    計算下次開彩日期 (以溫哥華當地時間 PCT 計算)。
    draw_days: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
    開彩截止時間一般為晚上 19:30。若當天是開彩日且時間在 19:30 前，下次開彩為今日；否則計算下個開彩日。
    """
    now = get_vancouver_now()
    cur_weekday = now.weekday()
    
    # 檢查今天是否為開彩日，且未超過晚上 19:30
    if cur_weekday in draw_days and (now.hour < 19 or (now.hour == 19 and now.minute < 30)):
        target = now
    else:
        # 尋找未來最近的開彩日
        for offset in range(1, 8):
            next_day = now + timedelta(days=offset)
            if next_day.weekday() in draw_days:
                target = next_day
                break
        else:
            target = now + timedelta(days=1)

    weekday_names = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
    return f"{target.strftime('%Y-%m-%d')} ({weekday_names[target.weekday()]})"

def enrich_lottery_data(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    為 4 款彩種計算下次開彩日期並結構化輸出。
    """
    if not isinstance(raw_data, dict):
        return {}

    # 開彩排程 (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun)
    schedules = {
        "SIX49": [2, 5],      # 週三及六晚上
        "BC49": [2, 5],       # 週三及六晚上
        "LMAX": [1, 4],       # 週二及五晚上
        "DGRD": [0, 3],       # 週一及四晚上
    }

    result = {
        "success": True,
        "updated_at": get_vancouver_now().isoformat(),
        "draws": {}
    }

    for key in ["SIX49", "BC49", "LMAX", "DGRD"]:
        item = raw_data.get(key)
        if isinstance(item, dict):
            enriched_item = dict(item)
            enriched_item["nextDrawDate"] = calculate_next_draw_date(schedules.get(key, [2, 5]))
            result["draws"][key] = enriched_item

    return result

def load_disk_cache() -> Optional[Dict[str, Any]]:
    for path in [LOTTERY_CACHE_FILE, FRONTEND_LOTTERY_CACHE_FILE]:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and data.get("draws"):
                        return data
            except Exception:
                pass
    return None

def fetch_lottery_latest(force: bool = False) -> Dict[str, Any]:
    """
    從 PlayNow 官方 API 取得最新開彩號碼 (每 12 小時更新一次)。
    若暫時斷線，維持最後已知真實官方快取，絕不製造假資料。
    """
    global _lottery_cache
    now = time.time()
    LOTTERY_TTL = 43200  # 12 小時 (12 * 3600 秒)

    if not force and _lottery_cache["data"] and (now - _lottery_cache["timestamp"] < LOTTERY_TTL):
        return _lottery_cache["data"]

    # 檢查磁碟快取
    disk_data = load_disk_cache()
    if not force and disk_data:
        try:
            mtime = os.path.getmtime(LOTTERY_CACHE_FILE) if os.path.exists(LOTTERY_CACHE_FILE) else 0
            if now - mtime < LOTTERY_TTL:
                _lottery_cache["data"] = disk_data
                _lottery_cache["timestamp"] = mtime
                return disk_data
        except Exception:
            pass

    # 連線官方 API
    url = "https://www.playnow.com/services2/lotto/draw/latest/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.playnow.com/lottery/",
        "Origin": "https://www.playnow.com"
    }

    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code == 200:
            raw_data = resp.json()
            if isinstance(raw_data, dict) and "SIX49" in raw_data:
                enriched = enrich_lottery_data(raw_data)
                _lottery_cache["data"] = enriched
                _lottery_cache["timestamp"] = now

                # 原子寫入磁碟快取
                try:
                    _atomic_write_json(LOTTERY_CACHE_FILE, enriched)
                    if os.path.exists(FRONTEND_PUBLIC_DIR):
                        _atomic_write_json(FRONTEND_LOTTERY_CACHE_FILE, enriched)
                except Exception as e:
                    logger.warning(f"Failed to persist lottery cache: {e}")

                return enriched
    except Exception as e:
        logger.warning(f"Error fetching PlayNow lotto latest: {e}")

    # 若抓取失敗，回傳既有磁碟快取
    if disk_data:
        _lottery_cache["data"] = disk_data
        _lottery_cache["timestamp"] = now
        return disk_data

    return {"success": False, "draws": {}, "error": "無法連線 PlayNow 官方彩票 API"}

async def run_lottery_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每 12 小時更新 1 次)。
    """
    print("🎱 [LotteryService] PlayNow 官方彩票最新開彩背景定時快取服務啟動 (12 小時週期)...")
    loop = asyncio.get_event_loop()
    # 啟動時先進行一次預熱
    try:
        await loop.run_in_executor(None, fetch_lottery_latest, True)
    except Exception as e:
        logger.warning(f"Lottery initial warm-up failed: {e}")

    while True:
        try:
            await asyncio.sleep(43200)  # 12 小時 (12 * 3600 秒)
            await loop.run_in_executor(None, fetch_lottery_latest, True)
        except Exception as e:
            logger.warning(f"⚠️ [LotteryService] 背景彩票更新失敗: {e}")
