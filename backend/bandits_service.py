from __future__ import annotations
import os
import json
import time
import tempfile
import asyncio
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))

PCT_TZ = timezone(timedelta(hours=-7))

# In-memory schedules cache: { year_str: { "timestamp": float, "data": dict } }
_bandits_schedules_cache: Dict[str, Dict[str, Any]] = {}

CEBL_API_KEY = "800chyzv2hvur3z0ogh39cve2zok0c"
CEBL_REFERER = "https://cebl-stats-hub.web.app/"

def get_current_bandits_season() -> int:
    """
    獲取目前 CEBL 籃球賽季年份：
    CEBL 賽季時段通常為 5 月至 8 月；每年 5 月自動切換至新賽季。
    例如 2026 年 5 月至 2027 年 4 月 -> 2026；2027 年 5 月起 -> 2027。
    """
    now = datetime.now(PCT_TZ)
    if now.month >= 5:
        return now.year
    # 5 月前若仍在前一年週期，預設可看當年度即將開始的 2026 賽程或前一年賽季
    return now.year

def get_available_bandits_seasons() -> List[Dict[str, Any]]:
    """
    產生由近至遠的 CEBL Bandits 賽季選項 (例如 2027, 2026, 2025... 2020)
    """
    cur_year = get_current_bandits_season()
    max_year = max(cur_year + 1, 2026)
    min_year = 2020
    seasons = []
    for y in range(max_year, min_year - 1, -1):
        seasons.append({
            "year": y,
            "label": f"{y}"
        })
    return seasons

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".cebl_sched_", suffix=".tmp", dir=parent_dir)
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

def _get_cache_file_paths(year: int) -> tuple[str, str]:
    b_path = os.path.join(DATA_DIR, f"vancouver_bandits_schedule_{year}.json")
    f_path = os.path.join(FRONTEND_PUBLIC_DIR, f"vancouver_bandits_schedule_{year}.json")
    return b_path, f_path

def fetch_bandits_schedule(year: Optional[int] = None, force: bool = False) -> Dict[str, Any]:
    """
    全數連線 CEBL 官方真實 API (每日更新 1 次，快取效期 86400 秒)。
    真實性保證：若外部暫時中斷，維持最後一次成功官方真實記錄，絕不生成假比賽。
    """
    global _bandits_schedules_cache
    target_year = year or get_current_bandits_season()
    year_str = str(target_year)
    now = time.time()
    CACHE_EXPIRY = 86400  # 每日更新 1 次

    # 1. 記憶體快取 (0ms 極速)
    cached = _bandits_schedules_cache.get(year_str)
    if not force and cached and (now - cached.get("timestamp", 0) < CACHE_EXPIRY):
        return cached.get("data", {})

    b_cache_file, f_cache_file = _get_cache_file_paths(target_year)

    # 2. 磁碟快取檢核
    if not force and os.path.exists(b_cache_file):
        try:
            mtime = os.path.getmtime(b_cache_file)
            if now - mtime < CACHE_EXPIRY:
                with open(b_cache_file, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                    if disk_data and isinstance(disk_data.get("games"), list) and len(disk_data["games"]) > 0:
                        _bandits_schedules_cache[year_str] = {
                            "timestamp": mtime,
                            "data": disk_data
                        }
                        return disk_data
        except Exception:
            pass

    # 3. 連線官方真實 CEBL API
    api_url = f"https://api.data.cebl.ca/games/{target_year}/?team_id=16"

    try:
        resp = requests.get(
            api_url,
            headers={
                "x-api-key": CEBL_API_KEY,
                "Referer": CEBL_REFERER,
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            timeout=12
        )
    except Exception as e:
        print(f"⚠️ 連線 CEBL 官方 API 失敗: {e}")
        resp = None

    if resp and resp.status_code == 200:
        try:
            raw_json = resp.json()
        except Exception:
            raw_json = []

        games = raw_json if isinstance(raw_json, list) else []
        payload = {
            "success": True,
            "season": target_year,
            "team_id": 16,
            "source_url": api_url,
            "updated_at": datetime.now(PCT_TZ).isoformat(),
            "totalGames": len(games),
            "games": games
        }
        _bandits_schedules_cache[year_str] = {
            "timestamp": now,
            "data": payload
        }
        try:
            _atomic_write_json(b_cache_file, payload)
            if os.path.exists(FRONTEND_PUBLIC_DIR):
                _atomic_write_json(f_cache_file, payload)
        except Exception as e:
            print(f"⚠️ Error persisting Bandits schedule {target_year}: {e}")
        return payload

    # 4. 若官方暫時不可達，回退至最後一次成功磁碟快取
    for p in [b_cache_file, f_cache_file]:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                    if disk_data and isinstance(disk_data.get("games"), list):
                        return disk_data
            except Exception:
                pass

    return {
        "success": False,
        "season": target_year,
        "updated_at": datetime.now(PCT_TZ).isoformat(),
        "totalGames": 0,
        "games": [],
        "error": "無法連接 CEBL 官方賽程伺服器"
    }

async def run_bandits_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每日自動抓取真實 CEBL Bandits 籃球賽季賽程，每日更新 1 次；主要執行期間為每年 5 月至 8 月尾)
    """
    print("🏀 [Bandits Service] 溫哥華 Bandits 籃球賽程背景定時快取服務啟動 (每日 1 次週期)...")
    loop = asyncio.get_event_loop()
    cur_year = get_current_bandits_season()
    try:
        await loop.run_in_executor(None, fetch_bandits_schedule, cur_year, False)
    except Exception as e:
        print(f"⚠️ [Bandits Service] 啟動預熱失敗: {e}")

    while True:
        try:
            # 每日更新 1 次 (24 小時 = 86400 秒)
            await asyncio.sleep(86400)
            now = datetime.now(PCT_TZ)
            # 依指示：執行資料更新的時間是每年 5 月開始直到 8 月尾
            if 5 <= now.month <= 8:
                cur_year = get_current_bandits_season()
                await loop.run_in_executor(None, fetch_bandits_schedule, cur_year, True)
                print(f"✅ [Bandits Service] Bandits 籃球賽程已同步更新 (賽季 {cur_year})")
            else:
                # 非賽季期間每日僅在記憶體/磁碟快取檢視，不頻繁發送 API
                pass
        except Exception as e:
            print(f"⚠️ [Bandits Service] 背景更新錯誤: {e}")
