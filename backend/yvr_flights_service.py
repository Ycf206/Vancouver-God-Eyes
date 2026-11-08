from __future__ import annotations
import os
import json
import time
import math
import re
import random
import tempfile
import urllib.parse
import subprocess
import asyncio
import requests
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional, Tuple

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend"))
OUTPUT_BACKEND_FILE = os.path.join(BACKEND_DIR, "data", "vancouver_yvr_flights.json")
OUTPUT_FRONTEND_FILE = os.path.join(FRONTEND_DIR, "public", "vancouver_yvr_flights.json")

# In-memory cache
_yvr_flights_cache: Dict[str, Any] = {
    "timestamp": 0,
    "data": None
}

# Standard direct flight durations (hours) from YVR for known destinations
AIRPORT_DURATIONS_HOURS = {
    # Canada
    "YYZ": 4.5, "YUL": 4.75, "YYC": 1.4, "YEG": 1.4, "YOW": 4.5, "YWG": 2.75,
    "YHZ": 5.75, "YYJ": 0.5, "YCD": 0.4, "YWH": 0.4, "YQQ": 0.6, "YLW": 0.8,
    "YKA": 0.75, "YXS": 1.2, "YPR": 1.8, "YXT": 1.6, "YXY": 2.4, "YZF": 2.5,
    "YQR": 2.1, "YXE": 2.1, "YXX": 0.4, "YCG": 1.0, "YXC": 1.2,
    # USA
    "SEA": 0.8, "PDX": 1.1, "SFO": 2.25, "OAK": 2.2, "SJC": 2.3, "LAX": 2.75,
    "SAN": 3.0, "LAS": 2.6, "PHX": 3.1, "DEN": 2.75, "SLC": 2.0, "DFW": 4.25,
    "IAH": 4.4, "ORD": 4.0, "MSP": 3.4, "ATL": 4.8, "JFK": 5.25, "EWR": 5.25,
    "BOS": 5.25, "IAD": 5.1, "MCO": 5.5, "MIA": 5.75, "HNL": 6.0, "OGG": 5.9,
    "KOA": 6.1, "LIH": 6.2, "ANC": 3.5,
    # International & Overseas
    "LHR": 9.5, "LGW": 9.5, "CDG": 9.75, "FRA": 10.0, "AMS": 9.5, "DUB": 9.0,
    "ZRH": 10.25, "KEF": 7.5, "NRT": 10.0, "HND": 10.0, "KIX": 10.75, "ICN": 11.0,
    "TPE": 11.5, "HKG": 12.5, "PVG": 12.0, "PEK": 11.5, "CAN": 13.0, "XMN": 12.5,
    "BKK": 15.5, "SIN": 16.0, "MNL": 13.5, "SYD": 14.5, "BNE": 14.0, "AKL": 13.5,
    "NAN": 11.5, "MEX": 5.25, "CUN": 5.5, "PVR": 4.75, "SJD": 4.5
}

# Standard Airport Coordinates for distance calculations & route rendering
AIRPORT_COORDINATES = {
    "YVR": [-123.1844, 49.1939],
    "YYZ": [-79.6248, 43.6777],
    "YUL": [-73.7408, 45.4657],
    "YYC": [-114.0076, 51.1215],
    "YEG": [-113.5797, 53.3097],
    "YOW": [-75.6672, 45.3225],
    "YWG": [-97.2399, 49.9100],
    "YYJ": [-123.4261, 48.6469],
    "YLW": [-119.3778, 49.9572],
    "YXS": [-122.6783, 53.8894],
    "SEA": [-122.3088, 47.4502],
    "SFO": [-122.3790, 37.6213],
    "LAX": [-118.4085, 33.9416],
    "LAS": [-115.1537, 36.0840],
    "PHX": [-112.0078, 33.4342],
    "DEN": [-104.6737, 39.8561],
    "SLC": [-111.9778, 40.7884],
    "ORD": [-87.9073, 41.9742],
    "DFW": [-97.0403, 32.8998],
    "JFK": [-73.7781, 40.6413],
    "EWR": [-74.1745, 40.6895],
    "HNL": [-157.9224, 21.3187],
    "OGG": [-156.4305, 20.8986],
    "LHR": [-0.4543, 51.4700],
    "CDG": [2.5479, 49.0097],
    "FRA": [8.5622, 50.0379],
    "AMS": [4.7639, 52.3105],
    "NRT": [140.3929, 35.7720],
    "HND": [139.7798, 35.5494],
    "ICN": [126.4505, 37.4602],
    "TPE": [121.2328, 25.0797],
    "HKG": [113.9145, 22.3080],
    "SYD": [151.1772, -33.9399],
    "AKL": [174.7917, -37.0082],
    "MEX": [-99.0721, 19.4361],
    "CUN": [-86.8771, 21.0365],
    "PVR": [-105.2542, 20.6801],
    "SJD": [-109.7214, 23.1518]
}

# BC Permanent Pacific Time (PCT = UTC-7 year-round, effective Nov 2026)
PCT_TZ = timezone(timedelta(hours=-7))

def get_vancouver_dates() -> Tuple[str, str, datetime]:
    now = datetime.now(PCT_TZ)
    today_str = now.strftime("%Y-%m-%d")
    tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    return today_str, tomorrow_str, now

def estimate_flight_duration(code: str) -> float:
    code_up = (code or "").upper().strip()
    if code_up in AIRPORT_DURATIONS_HOURS:
        return AIRPORT_DURATIONS_HOURS[code_up]
    
    # Calculate approximate flight duration from distance if coordinates known
    if code_up in AIRPORT_COORDINATES:
        c1 = AIRPORT_COORDINATES["YVR"]
        c2 = AIRPORT_COORDINATES[code_up]
        dlon = math.radians(c2[0] - c1[0])
        dlat = math.radians(c2[1] - c1[1])
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(c1[1])) * math.cos(math.radians(c2[1])) * math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        km = 6371.0 * c
        # Commercial jet average speed ~820 km/h + 30 min takeoff/landing buffer
        dur = round((km / 820.0) + 0.5, 2)
        return max(0.5, dur)
    
    # Default fallback duration
    return 2.5

def get_custom_yvr_base_url() -> str:
    default_api = "https://www.yvr.ca/en/_api/Flights"
    try:
        cfg_paths = [
            os.path.join(BACKEND_DIR, "data", "admin_sources_config.json"),
            os.path.join(BACKEND_DIR, "..", "data", "admin_sources_config.json"),
            "/app/data/admin_sources_config.json"
        ]
        for p in cfg_paths:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                for s in cfg.get("sources", []):
                    if s.get("id") in ("flight_schedules", "yvr_flights"):
                        u = s.get("source_url") or s.get("url")
                        if u and str(u).strip():
                            clean_u = str(u).strip().split("?")[0].rstrip("/")
                            low_u = clean_u.lower()
                            # Prevent human HTML webpage URLs from poisoning the OData JSON endpoint
                            if "/passengers/flights" in low_u or ("yvr.ca" in low_u and "/_api/" not in low_u):
                                return default_api
                            return clean_u
    except Exception:
        pass
    return default_api

def fetch_yvr_endpoint(f_type: str, today_str: str, tomorrow_str: str) -> List[Dict[str, Any]]:
    referer = (
        "https://www.yvr.ca/en/passengers/flights/arriving-flights"
        if f_type == "A"
        else "https://www.yvr.ca/en/passengers/flights/departing-flights"
    )
    filter_expr = (
        f"((FlightScheduledTime gt DateTime'{today_str}T00:00:00' and FlightScheduledTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}') "
        f"or (FlightEstimatedTime gt DateTime'{today_str}T00:00:00' and FlightEstimatedTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}'))"
    )
    encoded_filter = urllib.parse.quote(filter_expr, safe="()")
    base_api = get_custom_yvr_base_url()
    url = f"{base_api}?%24filter={encoded_filter}&%24orderby=FlightScheduledTime%20asc"

    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Referer": referer,
        "Origin": "https://www.yvr.ca",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }

    curl_bin = "curl.exe" if os.name == "nt" else "curl"
    curl_args = []
    for hk, hv in req_headers.items():
        curl_args.extend(["-H", f"{hk}: {hv}"])

    for attempt in range(1, 4):
        # 1. 優先使用 Python 原生 requests
        try:
            resp = requests.get(url, headers=req_headers, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                val = data.get("value", [])
                if isinstance(val, list) and len(val) > 0:
                    return val
        except Exception:
            pass

        # 2. 次選使用系統 curl 指令防護
        try:
            res = subprocess.run(
                [curl_bin, "-L", "-s", url] + curl_args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=25,
                check=False
            )
            if res.returncode == 0 and res.stdout:
                stdout_clean = (res.stdout or b"").decode("utf-8", errors="replace").strip()
                if stdout_clean.startswith("{") and stdout_clean.endswith("}"):
                    data = json.loads(stdout_clean)
                    val = data.get("value", [])
                    if isinstance(val, list) and len(val) > 0:
                        return val
            time.sleep(1.0 * attempt)
        except Exception as e:
            print(f"⚠️ [YVR Flights] attempt {attempt} error fetching {f_type}: {e}")
            time.sleep(1.0 * attempt)
    return []

def compute_supplementary_times(item: Dict[str, Any], f_type: str) -> Tuple[str, str]:
    """
    Calculates origin departure time and destination arrival time directly from YVR API official
    scheduled/estimated time and accurate airport route duration models.
    """
    code = str(item.get("FlightAirportCode") or "").upper().strip()
    duration_hours = estimate_flight_duration(code)
    dur_delta = timedelta(hours=duration_hours)

    sched_time_str = item.get("FlightScheduledTime") or ""
    est_time_str = item.get("FlightEstimatedTime") or sched_time_str

    dest_arrival_time = ""
    origin_departure_time = ""

    # Parse primary time
    primary_dt = None
    target_str = est_time_str or sched_time_str
    if target_str:
        try:
            primary_dt = datetime.fromisoformat(target_str.replace("Z", ""))
        except Exception:
            pass

    if f_type == "A":
        # Arrival at YVR: target_str is arrival time; departure was arrival minus flight duration
        dest_arrival_time = target_str
        if primary_dt:
            origin_dt = primary_dt - dur_delta
            origin_departure_time = origin_dt.strftime("%Y-%m-%dT%H:%M:00")
    else:
        # Departure from YVR: target_str is departure time; arrival is departure plus flight duration
        origin_departure_time = target_str
        if primary_dt:
            dest_dt = primary_dt + dur_delta
            dest_arrival_time = dest_dt.strftime("%Y-%m-%dT%H:%M:00")

    return origin_departure_time, dest_arrival_time

def process_yvr_flight_item(item: Dict[str, Any], f_type: str) -> Dict[str, Any]:
    fn_raw = str(item.get("FlightNumber") or "").strip().upper()
    fn_norm = re.sub(r'[^A-Z0-9]', '', fn_raw)
    carrier = str(item.get("FlightCarrier") or "").strip().upper()
    code = str(item.get("FlightAirportCode") or "").strip().upper()

    origin_departure_time, dest_arrival_time = compute_supplementary_times(item, f_type)

    # Coordinates
    yvr_coord = [-123.184444, 49.193889]
    remote_coord = AIRPORT_COORDINATES.get(code)

    return {
        "id": str(item.get("FlightID") or f"{fn_norm}_{item.get('FlightScheduledTime')}"),
        "flight_number": fn_raw,
        "airline": item.get("FlightAirlineName") or carrier,
        "carrier": carrier,
        "type": f_type,
        "range": item.get("FlightRange") or "D",
        "city": item.get("FlightCity") or "",
        "airport_code": code,
        "scheduled_time": item.get("FlightScheduledTime") or "",
        "estimated_time": item.get("FlightEstimatedTime") or "",
        "origin_departure_time": origin_departure_time,
        "dest_arrival_time": dest_arrival_time,
        "desk_from": item.get("FlightDeskFrom") or "",
        "desk_to": item.get("FlightDeskTo") or "",
        "gate": item.get("FlightGate") or "",
        "carousel": item.get("FlightCarousel") or "",
        "status": item.get("FlightStatus") or item.get("FlightRemarks") or "On Time",
        "aircraft_type": item.get("FlightAircraftType") or "",
        "yvr_coords": yvr_coord,
        "remote_coords": remote_coord
    }

def _is_flight_for_today(f: Dict[str, Any], today_str: str) -> bool:
    if not isinstance(f, dict):
        return False
    sched_d = str(f.get("scheduled_time") or "")[:10]
    est_d = str(f.get("estimated_time") or "")[:10]
    return (len(sched_d) == 10 and sched_d >= today_str) or (len(est_d) == 10 and est_d >= today_str)

def _dedup_and_sort_flights(flights: List[Dict[str, Any]], today_str: str) -> List[Dict[str, Any]]:
    dedup: Dict[str, Dict[str, Any]] = {}
    for f in flights or []:
        if not _is_flight_for_today(f, today_str):
            continue
        key = str(f.get("id") or f"{f.get('flight_number', '')}_{f.get('scheduled_time', '')}")
        dedup[key] = f
    items = list(dedup.values())
    items.sort(key=lambda x: (str(x.get("scheduled_time") or x.get("estimated_time") or ""), str(x.get("flight_number") or "")))
    return items

def _parse_updated_age(data: Dict[str, Any]) -> float:
    ts_str = str((data or {}).get("updated_at") or "").strip()
    if not ts_str:
        return 1e9
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=PCT_TZ)
        return max(0.0, time.time() - dt.timestamp())
    except Exception:
        return 1e9

def _atomic_write_json(target_path: str, payload: Dict[str, Any]) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".yvr_flights_", suffix=".tmp", dir=parent_dir)
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

def _load_valid_disk_cache(today_str: str) -> Tuple[Optional[Dict[str, Any]], float]:
    if not os.path.exists(OUTPUT_BACKEND_FILE):
        return None, 1e9
    try:
        with open(OUTPUT_BACKEND_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return None, 1e9
        arr = _dedup_and_sort_flights(raw.get("arrivals", []), today_str)
        dep = _dedup_and_sort_flights(raw.get("departures", []), today_str)
        if not arr and not dep:
            return None, 1e9
        age = _parse_updated_age(raw)
        cleaned = {
            "success": True,
            "query_date": today_str,
            "updated_at": raw.get("updated_at") or "",
            "counts": {
                "arrivals": len(arr),
                "departures": len(dep),
            },
            "arrivals": arr,
            "departures": dep,
        }
        return cleaned, age
    except Exception:
        return None, 1e9

def update_yvr_flights(force: bool = False) -> Dict[str, Any]:
    """
    Executes one update cycle: fetches YVR Arrivals & Departures directly from
    official YVR API, validates against today's PCT date, sorts by scheduled_time,
    and writes atomically to disk. Coordinates across Gunicorn workers via disk age.
    """
    global _yvr_flights_cache
    today_str, tomorrow_str, now_dt = get_vancouver_dates()

    # Coordinate across Gunicorn workers: avoid redundant upstream hits if another worker just updated
    disk_data, disk_age = _load_valid_disk_cache(today_str)
    fresh_threshold = 15.0 if force else 45.0
    if disk_data and disk_age < fresh_threshold:
        _yvr_flights_cache["timestamp"] = time.time() - disk_age
        _yvr_flights_cache["data"] = disk_data
        return disk_data

    # 1. Fetch Arrivals
    arr_raw = fetch_yvr_endpoint("A", today_str, tomorrow_str)
    # Wait 1.2s between calls to prevent rate limiting
    time.sleep(1.2)
    # 2. Fetch Departures
    dep_raw = fetch_yvr_endpoint("D", today_str, tomorrow_str)

    # 3. Transform, strictly filter for today_str, deduplicate, and sort ascending by scheduled_time
    new_arrivals = _dedup_and_sort_flights([process_yvr_flight_item(it, "A") for it in arr_raw], today_str)
    new_departures = _dedup_and_sort_flights([process_yvr_flight_item(it, "D") for it in dep_raw], today_str)

    # Only fall back on transient single-leg API glitch if existing cache is strictly from today_str and recent (<15m)
    same_day_recent = disk_data if (disk_data and disk_age < 900.0) else None
    arrivals = new_arrivals if len(new_arrivals) > 0 else (same_day_recent.get("arrivals", []) if same_day_recent else [])
    departures = new_departures if len(new_departures) > 0 else (same_day_recent.get("departures", []) if same_day_recent else [])

    # Only update timestamp & write cache if at least one live leg succeeded right now
    if len(new_arrivals) > 0 or len(new_departures) > 0:
        consolidated = {
            "success": True,
            "query_date": today_str,
            "updated_at": now_dt.isoformat(),
            "counts": {
                "arrivals": len(arrivals),
                "departures": len(departures)
            },
            "arrivals": arrivals,
            "departures": departures
        }

        _yvr_flights_cache["timestamp"] = time.time()
        _yvr_flights_cache["data"] = consolidated

        try:
            _atomic_write_json(OUTPUT_BACKEND_FILE, consolidated)
        except Exception as e:
            print(f"⚠️ Error saving {OUTPUT_BACKEND_FILE}: {e}")

        frontend_pub_dir = os.path.dirname(OUTPUT_FRONTEND_FILE)
        if os.path.isdir(frontend_pub_dir) and os.access(frontend_pub_dir, os.W_OK):
            try:
                _atomic_write_json(OUTPUT_FRONTEND_FILE, consolidated)
            except Exception as e:
                print(f"⚠️ Error saving {OUTPUT_FRONTEND_FILE}: {e}")

        print(f"✅ [YVR Flights Service] ({today_str}) 航班排程同步成功: 抵達 {len(arrivals)} 班, 出發 {len(departures)} 班")
        return consolidated

    if disk_data:
        _yvr_flights_cache["timestamp"] = time.time() - disk_age
        _yvr_flights_cache["data"] = disk_data
        return disk_data

    return {
        "success": False,
        "query_date": today_str,
        "updated_at": now_dt.isoformat(),
        "counts": {"arrivals": 0, "departures": 0},
        "arrivals": [],
        "departures": []
    }

def get_flights_data(force: bool = False) -> Dict[str, Any]:
    global _yvr_flights_cache
    today_str, _, _ = get_vancouver_dates()
    now = time.time()
    max_age = 15.0 if force else 55.0

    mem_data = _yvr_flights_cache.get("data")
    if isinstance(mem_data, dict) and mem_data.get("query_date") == today_str:
        mem_age = now - float(_yvr_flights_cache.get("timestamp") or 0)
        if 0 <= mem_age < max_age and (mem_data.get("arrivals") or mem_data.get("departures")):
            return mem_data

    disk_data, disk_age = _load_valid_disk_cache(today_str)
    if disk_data and disk_age < max_age:
        _yvr_flights_cache["data"] = disk_data
        _yvr_flights_cache["timestamp"] = now - disk_age
        return disk_data

    return update_yvr_flights(force=force)

async def run_yvr_flights_background_service():
    """
    OCI Server 24/7 background task running every 60 seconds (1 minute).
    """
    await asyncio.sleep(random.uniform(0.3, 3.5))
    print("🛫 [YVR Flights Service] 溫哥華機場即時航班排程服務啟動 (1 分鐘週期)...")
    while True:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, update_yvr_flights, False)
        except Exception as e:
            print(f"⚠️ [YVR Flights Service] 同步錯誤: {e}")
        await asyncio.sleep(60)

if __name__ == "__main__":
    result = update_yvr_flights(force=True)
    print(f"Manual run result: Arrivals={len(result.get('arrivals', []))}, Departures={len(result.get('departures', []))}")
