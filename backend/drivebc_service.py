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

# In-memory atomic cache
_drivebc_cache: Optional[Dict[str, Any]] = None
_drivebc_cache_ts: float = 0.0

CACHE_FILE_NAME = "vancouver_drivebc_events.json"
CACHE_EXPIRY = 86400  # 24 小時 (每日更新 1 次)
DRIVEBC_API_URL = "https://www.drivebc.ca/api/eventspolling/"


def _atomic_write_json(file_path: str, data: Any):
    dir_name = os.path.dirname(file_path)
    os.makedirs(dir_name, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(dir=dir_name, prefix=".tmp_drivebc_", suffix=".json")
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, file_path)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


def _load_disk_cache() -> Optional[Dict[str, Any]]:
    candidate_paths = [
        os.path.join(DATA_DIR, CACHE_FILE_NAME),
        os.path.join(FRONTEND_PUBLIC_DIR, CACHE_FILE_NAME),
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and "events" in data:
                        return data
                    elif isinstance(data, list):
                        return {
                            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "total_events": len(data),
                            "geotagged_events": len([x for x in data if x.get("location", {}).get("coordinates")]),
                            "events": data,
                        }
            except Exception:
                continue
    return None


def fetch_drivebc_events(force: bool = False) -> Dict[str, Any]:
    """
    抓取 Drive BC 即時交通事件 (每日更新 1 次，磁碟與記憶體原子快取)
    """
    global _drivebc_cache, _drivebc_cache_ts

    now = time.time()
    if not force and _drivebc_cache is not None and (now - _drivebc_cache_ts < CACHE_EXPIRY):
        return _drivebc_cache

    disk_data = _load_disk_cache()
    if not force and disk_data is not None:
        try:
            mtime = os.path.getmtime(os.path.join(DATA_DIR, CACHE_FILE_NAME))
            if now - mtime < CACHE_EXPIRY:
                _drivebc_cache = disk_data
                _drivebc_cache_ts = mtime
                return _drivebc_cache
        except Exception:
            pass

    # 嘗試從 Drive BC 官網 API 抓取
    events_raw: List[Dict[str, Any]] = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.drivebc.ca/",
        }
        res = requests.get(DRIVEBC_API_URL, headers=headers, timeout=20)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                events_raw = data
            elif isinstance(data, dict) and "events" in data:
                events_raw = data["events"]
    except Exception as e:
        print(f"⚠️ Drive BC API 抓取失敗: {e}")

    if not events_raw:
        if disk_data is not None:
            _drivebc_cache = disk_data
            _drivebc_cache_ts = now
            return disk_data
        return {
            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_events": 0,
            "geotagged_events": 0,
            "events": [],
            "error": "暫無可用 Drive BC 事件資料",
        }

    geotagged_count = len([x for x in events_raw if x.get("location") and x["location"].get("coordinates")])
    payload = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_events": len(events_raw),
        "geotagged_events": geotagged_count,
        "events": events_raw,
    }

    _drivebc_cache = payload
    _drivebc_cache_ts = now

    # 寫入磁碟快取
    try:
        b_cache_file = os.path.join(DATA_DIR, CACHE_FILE_NAME)
        _atomic_write_json(b_cache_file, payload)
        f_cache_file = os.path.join(FRONTEND_PUBLIC_DIR, CACHE_FILE_NAME)
        if os.path.exists(FRONTEND_PUBLIC_DIR):
            _atomic_write_json(f_cache_file, payload)
    except Exception as e:
        print(f"⚠️ 寫入 Drive BC 快取失敗: {e}")

    return payload


async def run_drivebc_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每 24 小時每日自動檢查更新 1 次)
    """
    print("🚗 [Drive BC Service] BC 省交通即時事件背景定時快取服務啟動 (24 小時週期)...")
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, fetch_drivebc_events, False)
    except Exception as e:
        print(f"⚠️ [Drive BC Service] 啟動預熱失敗: {e}")

    while True:
        try:
            # 24 小時 (86400 秒)
            await asyncio.sleep(86400)
            await loop.run_in_executor(None, fetch_drivebc_events, False)
            print("✅ [Drive BC Service] BC 省交通即時事件定時排程檢查更新完成！")
        except Exception as e:
            print(f"⚠️ [Drive BC Service] 背景更新錯誤: {e}")
