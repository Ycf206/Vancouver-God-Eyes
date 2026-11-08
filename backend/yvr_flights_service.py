from __future__ import annotations
import os
import json
import time
import math
import re
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

def get_vancouver_dates():
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo("America/Vancouver")
        now = datetime.now(tz)
    except Exception:
        # Vancouver UTC-7 (PDT) / UTC-8 (PST) manual check
        utc_now = datetime.now(timezone.utc)
        m = utc_now.month
        is_dst = (3 < m < 11) or (m == 3 and utc_now.day >= 8) or (m == 11 and utc_now.day < 7)
        now = utc_now.astimezone(timezone(timedelta(hours=-7 if is_dst else -8)))
    
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
                    if s.get("id") == "flight_schedules":
                        u = s.get("source_url") or s.get("url")
                        if u and str(u).strip():
                            return str(u).strip().split("?")[0]
    except Exception:
        pass
    return "https://www.yvr.ca/en/_api/Flights"

def fetch_yvr_endpoint(f_type: str, today_str: str, tomorrow_str: str) -> List[Dict[str, Any]]:
    referer = "https://www.yvr.ca/en/passengers/flights/arriving-flights" if f_type == "A" else "https://www.yvr.ca/en/passengers/flights/departing-flights"
    filter_expr = f"((FlightScheduledTime gt DateTime'{today_str}T00:00:00' and FlightScheduledTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}') or (FlightEstimatedTime gt DateTime'{today_str}T00:00:00' and FlightEstimatedTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}'))"
    encoded_filter = urllib.parse.quote(filter_expr)
    base_api = get_custom_yvr_base_url()
    url = f"{base_api}?%24filter={encoded_filter}&%24orderby=FlightScheduledTime%20asc"

    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "application/json, text/plain, */*"
    }

    curl_bin = "curl.exe" if os.name == "nt" else "curl"
    curl_args = [
        "-H", f"User-Agent: {req_headers['User-Agent']}",
        "-H", f"Referer: {referer}",
        "-H", f"Accept: {req_headers['Accept']}"
    ]
    
    for attempt in range(1, 4):
        # 1. 優先使用 Python 原生 requests
        try:
            resp = requests.get(url, headers=req_headers, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                val = data.get("value", [])
                if val and len(val) > 0:
                    return val
        except Exception as re_err:
            pass

        # 2. 次選使用系統 curl 指令防護
        try:
            res = subprocess.run(
                [curl_bin, "-s", url] + curl_args,
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
                    if val and len(val) > 0:
                        return val
            time.sleep(1.2 * attempt)
        except Exception as e:
            print(f"⚠️ [YVR Flights] attempt {attempt} error fetching {f_type}: {e}")
            time.sleep(1.2 * attempt)
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

def update_yvr_flights() -> Dict[str, Any]:
    """
    Executes one update cycle: fetches YVR Arrivals & Departures directly from
    official YVR API, parses times and statuses, and writes to disk.
    Protects against partial API failure by merging with existing valid cache.
    """
    today_str, tomorrow_str, now_dt = get_vancouver_dates()

    # Read existing cache to prevent accidental wipe-out
    existing_arr = []
    existing_dep = []
    if os.path.exists(OUTPUT_BACKEND_FILE):
        try:
            with open(OUTPUT_BACKEND_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                existing_arr = old_data.get("arrivals", [])
                existing_dep = old_data.get("departures", [])
        except Exception:
            pass

    # 1. Fetch Arrivals
    arr_raw = fetch_yvr_endpoint("A", today_str, tomorrow_str)
    # Wait 1.5s between calls to prevent rate limiting
    time.sleep(1.5)
    # 2. Fetch Departures
    dep_raw = fetch_yvr_endpoint("D", today_str, tomorrow_str)

    # 3. Transform YVR official records
    new_arrivals = [process_yvr_flight_item(it, "A") for it in arr_raw]
    new_departures = [process_yvr_flight_item(it, "D") for it in dep_raw]

    # Robust retention: If new fetch returned empty (due to momentary rate limit / glitch),
    # keep the previous valid flights rather than overwriting with 0!
    arrivals = new_arrivals if len(new_arrivals) > 0 else existing_arr
    departures = new_departures if len(new_departures) > 0 else existing_dep

    # If YVR API returned valid flights, build new cache object
    if arrivals or departures:
        consolidated = {
            "success": True,
            "updated_at": now_dt.isoformat(),
            "counts": {
                "arrivals": len(arrivals),
                "departures": len(departures)
            },
            "arrivals": arrivals,
            "departures": departures
        }

        # Update in-memory cache
        global _yvr_flights_cache
        _yvr_flights_cache["timestamp"] = time.time()
        _yvr_flights_cache["data"] = consolidated

        # Write to disk
        try:
            os.makedirs(os.path.dirname(OUTPUT_BACKEND_FILE), exist_ok=True)
            with open(OUTPUT_BACKEND_FILE, "w", encoding="utf-8") as f:
                json.dump(consolidated, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️ Error saving {OUTPUT_BACKEND_FILE}: {e}")

        try:
            os.makedirs(os.path.dirname(OUTPUT_FRONTEND_FILE), exist_ok=True)
            with open(OUTPUT_FRONTEND_FILE, "w", encoding="utf-8") as f:
                json.dump(consolidated, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️ Error saving {OUTPUT_FRONTEND_FILE}: {e}")

        print(f"✅ [YVR Flights Service] 航班排程同步成功: 抵達 {len(arrivals)} 班, 出發 {len(departures)} 班")
        return consolidated

    # Fallback to existing disk cache
    if os.path.exists(OUTPUT_BACKEND_FILE):
        try:
            with open(OUTPUT_BACKEND_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return {"success": False, "arrivals": [], "departures": []}

def get_flights_data(force: bool = False) -> Dict[str, Any]:
    global _yvr_flights_cache
    now = time.time()
    if not force:
        # Cache valid for 50 seconds
        if _yvr_flights_cache["data"] and (now - _yvr_flights_cache["timestamp"] < 50):
            return _yvr_flights_cache["data"]

        # Try disk cache
        if os.path.exists(OUTPUT_BACKEND_FILE):
            try:
                with open(OUTPUT_BACKEND_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _yvr_flights_cache["data"] = data
                    _yvr_flights_cache["timestamp"] = now
                    return data
            except Exception:
                pass

    # Trigger update
    return update_yvr_flights()

async def run_yvr_flights_background_service():
    """
    OCI Server 24/7 background task running every 60 seconds (1 minute).
    """
    print("🛫 [YVR Flights Service] 溫哥華機場即時航班排程服務啟動 (1 分鐘週期)...")
    while True:
        try:
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(None, update_yvr_flights)
            arr_cnt = len(res.get("arrivals", []))
            dep_cnt = len(res.get("departures", []))
            print(f"✅ [YVR Flights Service] 航班排程同步成功: 抵達 {arr_cnt} 班, 出發 {dep_cnt} 班")
        except Exception as e:
            print(f"⚠️ [YVR Flights Service] 同步錯誤: {e}")
        # Wait 60 seconds (1 minute)
        await asyncio.sleep(60)

if __name__ == "__main__":
    result = update_yvr_flights()
    print(f"Manual run result: Arrivals={len(result.get('arrivals', []))}, Departures={len(result.get('departures', []))}")
