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
_whitecaps_schedules_cache: Dict[str, Dict[str, Any]] = {}

# MLS Known Season IDs mapping
MLS_SEASON_IDS: Dict[int, str] = {
    2027: "MLS-SEA-0002KB",
    2026: "MLS-SEA-0001KA",
    2025: "MLS-SEA-0001K9",
    2024: "MLS-SEA-0001K8",
    2023: "MLS-SEA-0001K7",
    2022: "MLS-SEA-0001K6",
    2021: "MLS-SEA-0001K5",
    2020: "MLS-SEA-0001K4",
}

def get_current_whitecaps_season() -> int:
    """
    獲取目前 MLS 賽季年份（例如 2026 年）
    """
    now = datetime.now(PCT_TZ)
    return now.year

def get_available_whitecaps_seasons() -> List[Dict[str, Any]]:
    """
    產生由近至遠的 MLS Whitecaps 賽季下拉選單選項 (例如 2027, 2026, 2025... 2020)
    """
    cur_year = get_current_whitecaps_season()
    # 預先包含下一年（例如 2027）與目前年份
    max_year = max(cur_year + 1, 2027)
    min_year = 2020
    seasons = []
    for y in range(max_year, min_year - 1, -1):
        seasons.append({
            "year": y,
            "label": f"{y} 賽季"
        })
    return seasons

def get_season_id(year: int) -> str:
    """
    根據年份取得 MLS Season ID，若字典無則連線官方動態查詢
    """
    if year in MLS_SEASON_IDS:
        return MLS_SEASON_IDS[year]
    try:
        resp = requests.get(
            "https://stats-api.mlssoccer.com/competitions/MLS-COM-000001/seasons",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            timeout=8
        )
        if resp.status_code == 200:
            data = resp.json()
            for s in data.get("seasons", []):
                s_year = s.get("season")
                s_id = s.get("season_id")
                if s_year and s_id:
                    MLS_SEASON_IDS[int(s_year)] = s_id
            if year in MLS_SEASON_IDS:
                return MLS_SEASON_IDS[year]
    except Exception as e:
        print(f"⚠️ Error resolving MLS season ID for {year}: {e}")
    return "MLS-SEA-0001KA"

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".mls_sched_", suffix=".tmp", dir=parent_dir)
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
    b_path = os.path.join(DATA_DIR, f"vancouver_whitecaps_schedule_{year}.json")
    f_path = os.path.join(FRONTEND_PUBLIC_DIR, f"vancouver_whitecaps_schedule_{year}.json")
    return b_path, f_path

def fetch_whitecaps_schedule(year: Optional[int] = None, force: bool = False) -> Dict[str, Any]:
    """
    全數連線 MLS 官方真實 API (每日更新 1 次，快取效期 86400 秒)。
    真實性保證：若外部暫時中斷，維持最後一次成功官方真實記錄，絕不生成假比賽。
    """
    global _whitecaps_schedules_cache
    target_year = year or get_current_whitecaps_season()
    year_str = str(target_year)
    now = time.time()
    CACHE_EXPIRY = 86400  # 每日更新 1 次

    # 1. 記憶體快取 (0ms 極速)
    cached = _whitecaps_schedules_cache.get(year_str)
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
                    if disk_data and isinstance(disk_data.get("matches"), list) and len(disk_data["matches"]) > 0:
                        _whitecaps_schedules_cache[year_str] = {
                            "timestamp": mtime,
                            "data": disk_data
                        }
                        return disk_data
        except Exception:
            pass

    # 3. 連線官方真實 API
    season_id = get_season_id(target_year)
    api_url = (
        f"https://stats-api.mlssoccer.com/matches/seasons/{season_id}?"
        f"match_date[gte]={target_year}-01-01&match_date[lte]={target_year}-12-31&"
        f"team_id=MLS-CLU-00000C&per_page=120&sort=planned_kickoff_time:asc,home_team_name:asc"
    )

    try:
        resp = requests.get(
            api_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
            },
            timeout=12
        )
    except Exception as e:
        print(f"⚠️ 連線 MLS 官方 API 失敗: {e}")
        resp = None

    if resp and resp.status_code == 200:
        try:
            raw_json = resp.json()
        except Exception:
            raw_json = {}

        matches = raw_json.get("schedule", [])
        payload = {
            "success": True,
            "season": target_year,
            "season_id": season_id,
            "source_url": api_url,
            "updated_at": datetime.now(PCT_TZ).isoformat(),
            "totalMatches": len(matches),
            "matches": matches
        }
        _whitecaps_schedules_cache[year_str] = {
            "timestamp": now,
            "data": payload
        }
        try:
            _atomic_write_json(b_cache_file, payload)
            if os.path.exists(FRONTEND_PUBLIC_DIR):
                _atomic_write_json(f_cache_file, payload)
        except Exception as e:
            print(f"⚠️ Error persisting Whitecaps schedule {target_year}: {e}")
        return payload

    # 4. 若官方暫時不可達，回退至最後一次成功磁碟快取
    for p in [b_cache_file, f_cache_file]:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                    if disk_data and isinstance(disk_data.get("matches"), list):
                        return disk_data
            except Exception:
                pass

    return {
        "success": False,
        "season": target_year,
        "updated_at": datetime.now(PCT_TZ).isoformat(),
        "totalMatches": 0,
        "matches": [],
        "error": "無法連接 MLS 官方賽程伺服器"
    }

async def run_whitecaps_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每日自動抓取真實 MLS Whitecaps 足球賽季賽程，每日更新 1 次)
    """
    print("⚽ [Whitecaps Service] 溫哥華 Whitecaps 足球賽程背景定時快取服務啟動 (每日 1 次週期)...")
    loop = asyncio.get_event_loop()
    cur_year = get_current_whitecaps_season()
    try:
        await loop.run_in_executor(None, fetch_whitecaps_schedule, cur_year, False)
    except Exception as e:
        print(f"⚠️ [Whitecaps Service] 啟動預熱失敗: {e}")

    while True:
        try:
            # 每日更新 1 次 (24 小時 = 86400 秒)
            await asyncio.sleep(86400)
            cur_year = get_current_whitecaps_season()
            await loop.run_in_executor(None, fetch_whitecaps_schedule, cur_year, True)
            print(f"✅ [Whitecaps Service] Whitecaps 足球賽程已同步更新 (賽季 {cur_year})")
        except Exception as e:
            print(f"⚠️ [Whitecaps Service] 背景更新錯誤: {e}")
