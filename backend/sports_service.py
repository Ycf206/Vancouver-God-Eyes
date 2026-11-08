from __future__ import annotations
import os
import json
import time
import tempfile
import asyncio
import subprocess
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))

PCT_TZ = timezone(timedelta(hours=-7))

# In-memory season schedules cache: { season: { "timestamp": float, "data": dict } }
_nhl_schedules_cache: Dict[str, Dict[str, Any]] = {}

def get_current_nhl_season() -> str:
    """
    根據 NHL 賽季週期推算目前賽季代碼：
    賽季時段通常為 9 月至隔年 4 月；4 月尾後自動切換至下個賽季。
    例如 2026 年 5 月至 2027 年 4 月 -> 20262027；2027 年 5 月起 -> 20272028。
    """
    now = datetime.now(PCT_TZ)
    if now.month >= 5:
        return f"{now.year}{now.year + 1}"
    return f"{now.year - 1}{now.year}"

def get_available_seasons() -> List[Dict[str, str]]:
    """
    產生由近至遠的賽季下拉選單選項：由當前賽季 (2026 - 2027) 往回推至 2020 - 2021
    """
    cur_season = get_current_nhl_season()
    cur_start_year = int(cur_season[:4])
    min_year = 2020
    seasons = []
    for y in range(cur_start_year, min_year - 1, -1):
        s_code = f"{y}{y + 1}"
        s_label = f"{y} - {y + 1}"
        seasons.append({
            "code": s_code,
            "label": s_label
        })
    return seasons

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".nhl_sched_", suffix=".tmp", dir=parent_dir)
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

def _get_cache_file_paths(season: str) -> tuple[str, str]:
    b_path = os.path.join(DATA_DIR, f"vancouver_canucks_schedule_{season}.json")
    f_path = os.path.join(FRONTEND_PUBLIC_DIR, f"vancouver_canucks_schedule_{season}.json")
    return b_path, f_path

def fetch_canucks_schedule(season: Optional[str] = None, force: bool = False) -> Dict[str, Any]:
    """
    全數連線 NHL 官方真實 API (每日更新 1 次，快取效期 86400 秒)。
    真實性保證：若外部暫時中斷，維持最後一次成功官方真實記錄，絕不生成假比賽。
    """
    global _nhl_schedules_cache
    target_season = (season or "").strip() or get_current_nhl_season()
    now = time.time()
    CACHE_EXPIRY = 86400  # 每日更新 1 次

    # 1. 記憶體快取 (0ms 極速)
    cached = _nhl_schedules_cache.get(target_season)
    if not force and cached and (now - cached.get("timestamp", 0) < CACHE_EXPIRY):
        return cached.get("data", {})

    b_cache_file, f_cache_file = _get_cache_file_paths(target_season)

    # 2. 磁碟快取檢核
    if not force and os.path.exists(b_cache_file):
        try:
            mtime = os.path.getmtime(b_cache_file)
            if now - mtime < CACHE_EXPIRY:
                with open(b_cache_file, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                    if disk_data and isinstance(disk_data.get("games"), list) and len(disk_data["games"]) > 0:
                        _nhl_schedules_cache[target_season] = {
                            "timestamp": mtime,
                            "data": disk_data
                        }
                        return disk_data
        except Exception:
            pass

    # 3. 呼叫官方真實 NHL API
    url = f"https://api-web.nhle.com/v1/club-schedule-season/VAN/{target_season}"
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.nhl.com/canucks/schedule",
        "Origin": "https://www.nhl.com"
    }

    raw_json = None

    # (A) 優先使用 requests
    try:
        resp = requests.get(url, headers=req_headers, timeout=20)
        if resp.status_code == 200:
            raw_json = resp.json()
    except Exception:
        pass

    # (B) 次選系統 curl 指令
    if not raw_json or not isinstance(raw_json.get("games"), list):
        curl_bin = "curl.exe" if os.name == "nt" else "curl"
        try:
            curl_args = [
                curl_bin, "-L", "-s", url,
                "-H", f"User-Agent: {req_headers['User-Agent']}",
                "-H", f"Accept: {req_headers['Accept']}",
                "-H", f"Referer: {req_headers['Referer']}"
            ]
            res = subprocess.run(curl_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
            if res.returncode == 0 and res.stdout:
                stdout_clean = (res.stdout or b"").decode("utf-8", errors="replace").strip()
                if stdout_clean.startswith("{") and stdout_clean.endswith("}"):
                    data = json.loads(stdout_clean)
                    if isinstance(data.get("games"), list):
                        raw_json = data
        except Exception as e:
            print(f"⚠️ [NHL Sports] Error fetching season {target_season}: {e}")

    # 官方資料解析成功，持久化快取
    if raw_json and isinstance(raw_json.get("games"), list):
        payload = {
            "success": True,
            "season": target_season,
            "updated_at": datetime.now(PCT_TZ).isoformat(),
            "clubTimezone": raw_json.get("clubTimezone") or "America/Vancouver",
            "totalGames": len(raw_json.get("games", [])),
            "games": raw_json.get("games", [])
        }
        _nhl_schedules_cache[target_season] = {
            "timestamp": now,
            "data": payload
        }
        try:
            _atomic_write_json(b_cache_file, payload)
            if os.path.exists(FRONTEND_PUBLIC_DIR):
                _atomic_write_json(f_cache_file, payload)
        except Exception as e:
            print(f"⚠️ Error persisting NHL schedule {target_season}: {e}")
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
        "season": target_season,
        "updated_at": datetime.now(PCT_TZ).isoformat(),
        "totalGames": 0,
        "games": [],
        "error": "無法連接 NHL 官方賽程伺服器"
    }

async def run_sports_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每日自動抓取真實 NHL Canucks 冰球賽季賽程，每日更新 1 次)
    """
    print("🏒 [Sports Service] 溫哥華 Canucks 冰球賽程背景定時快取服務啟動 (每日 1 次週期)...")
    loop = asyncio.get_event_loop()
    cur_season = get_current_nhl_season()
    try:
        await loop.run_in_executor(None, fetch_canucks_schedule, cur_season, False)
    except Exception as e:
        print(f"⚠️ [Sports Service] 啟動預熱失敗: {e}")

    while True:
        try:
            # 每日更新 1 次 (24 小時 = 86400 秒)
            await asyncio.sleep(86400)
            cur_season = get_current_nhl_season()
            await loop.run_in_executor(None, fetch_canucks_schedule, cur_season, True)
            print(f"✅ [Sports Service] Canucks 冰球賽程已同步更新 (賽季 {cur_season})")
        except Exception as e:
            print(f"⚠️ [Sports Service] 背景更新錯誤: {e}")
