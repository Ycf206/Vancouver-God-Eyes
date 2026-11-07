import os
import json
import time
import math
import re
import urllib.parse
import subprocess
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend"))
OUTPUT_BACKEND_FILE = os.path.join(BACKEND_DIR, "data", "vancouver_yvr_flights.json")
OUTPUT_FRONTEND_FILE = os.path.join(FRONTEND_DIR, "public", "vancouver_yvr_flights.json")
LIVE_FLIGHTS_CACHE_FILE = os.path.join(BACKEND_DIR, "data", "cached_live_flights.json")

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
        # Vancouver UTC-7 / UTC-8
        now = datetime.now(timezone(timedelta(hours=-7)))
    
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

def fetch_yvr_endpoint(f_type: str, today_str: str, tomorrow_str: str) -> List[Dict[str, Any]]:
    referer = "https://www.yvr.ca/en/passengers/flights/arriving-flights" if f_type == "A" else "https://www.yvr.ca/en/passengers/flights/departing-flights"
    filter_expr = f"((FlightScheduledTime gt DateTime'{today_str}T00:00:00' and FlightScheduledTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}') or (FlightEstimatedTime gt DateTime'{today_str}T00:00:00' and FlightEstimatedTime lt DateTime'{tomorrow_str}T00:00:00' and FlightType eq '{f_type}'))"
    encoded_filter = urllib.parse.quote(filter_expr)
    url = f"https://www.yvr.ca/en/_api/Flights?%24filter={encoded_filter}&%24orderby=FlightScheduledTime%20asc"

    headers = [
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "-H", f"Referer: {referer}",
        "-H", "Accept: application/json, text/plain, */*"
    ]
    try:
        res = subprocess.run(
            ["curl.exe", "-s", url] + headers,
            capture_output=True,
            text=True,
            timeout=25,
            check=False
        )
        if res.returncode == 0 and res.stdout:
            stdout_clean = res.stdout.strip()
            if stdout_clean.startswith("{") and stdout_clean.endswith("}"):
                data = json.loads(stdout_clean)
                return data.get("value", [])
            else:
                # Returned non-JSON (e.g. Cloudflare captcha HTML)
                pass
    except Exception as e:
        print(f"⚠️ [YVR Flights] curl error fetching {f_type}: {e}")
    return []

def load_flightaware_supplement():
    """
    Builds a robust lookup map from FlightAware cached data.
    Keys include normalized flight number, callsign, and numeric ID + airport code.
    """
    fa_map = {}
    
    # 1. Check cached_live_flights.json
    if os.path.exists(LIVE_FLIGHTS_CACHE_FILE):
        try:
            with open(LIVE_FLIGHTS_CACHE_FILE, "r", encoding="utf-8") as f:
                live_data = json.load(f)
                items = live_data if isinstance(live_data, list) else live_data.get("flights", [])
                for item in items:
                    fn_raw = str(item.get("flight_no") or item.get("callsign") or "").upper()
                    fn_norm = re.sub(r'[^A-Z0-9]', '', fn_raw)
                    if fn_norm:
                        fa_map[fn_norm] = item
                    cs = str(item.get("callsign") or "").upper()
                    if cs:
                        fa_map[cs] = item
                    # Number only
                    num_match = re.search(r'\d+', fn_norm)
                    if num_match:
                        fa_map[num_match.group(0)] = item
        except Exception:
            pass
            
    # 2. Check scheduled FlightAware API memory cache if available
    try:
        import flights
        if hasattr(flights, "_flightaware_cache") and flights._flightaware_cache.get("data"):
            fa_sched = flights._flightaware_cache["data"]
            for arr in fa_sched.get("arrivals", []):
                fn = re.sub(r'[^A-Z0-9]', '', str(arr.get("flight_no") or "").upper())
                if fn:
                    fa_map[fn] = arr
            for dep in fa_sched.get("departures", []):
                fn = re.sub(r'[^A-Z0-9]', '', str(dep.get("flight_no") or "").upper())
                if fn:
                    fa_map[fn] = dep
    except Exception:
        pass

    return fa_map

def compute_supplementary_times(item: Dict[str, Any], f_type: str, fa_flight: Dict[str, Any]) -> Tuple[str, str]:
    """
    Calculates origin departure time and destination arrival time.
    Prioritizes real-time FlightAware timestamps, and accurately computes
    departure/arrival from scheduled/estimated time and flight duration when missing.
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
        # Arrival at YVR
        dest_arrival_time = target_str
        
        # Check FlightAware for origin departure time
        if fa_flight:
            origin_departure_time = (
                fa_flight.get("dep_dt_iso") or
                fa_flight.get("departure_time") or
                fa_flight.get("actual_off") or
                fa_flight.get("estimated_off") or
                ""
            )
        
        # Fallback calculation if still empty
        if not origin_departure_time and primary_dt:
            origin_dt = primary_dt - dur_delta
            origin_departure_time = origin_dt.strftime("%Y-%m-%dT%H:%M:00")
            
    else:
        # Departure from YVR
        origin_departure_time = target_str
        
        # Check FlightAware for destination arrival time
        if fa_flight:
            dest_arrival_time = (
                fa_flight.get("arr_dt_iso") or
                fa_flight.get("arrival_time") or
                fa_flight.get("actual_on") or
                fa_flight.get("estimated_on") or
                ""
            )
            
        # Fallback calculation if still empty
        if not dest_arrival_time and primary_dt:
            dest_dt = primary_dt + dur_delta
            dest_arrival_time = dest_dt.strftime("%Y-%m-%dT%H:%M:00")

    return origin_departure_time, dest_arrival_time

def process_yvr_flight_item(item: Dict[str, Any], f_type: str, fa_map: Dict[str, Any]) -> Dict[str, Any]:
    fn_raw = str(item.get("FlightNumber") or "").strip().upper()
    fn_norm = re.sub(r'[^A-Z0-9]', '', fn_raw)
    carrier = str(item.get("FlightCarrier") or "").strip().upper()
    code = str(item.get("FlightAirportCode") or "").strip().upper()

    # Match in FlightAware map
    fa_match = fa_map.get(fn_norm)
    if not fa_match and carrier:
        # Try without carrier prefix
        num_only = re.sub(r'^[A-Z0-9]{2,3}', '', fn_norm)
        if num_only:
            fa_match = fa_map.get(num_only)

    origin_departure_time, dest_arrival_time = compute_supplementary_times(item, f_type, fa_match or {})

    # Coordinates
    yvr_coord = [-123.184444, 49.193889]
    remote_coord = AIRPORT_COORDINATES.get(code)
    if not remote_coord and fa_match:
        remote_coord = fa_match.get("origin_coord") if f_type == "A" else fa_match.get("dest_coord")

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
    Executes one update cycle: fetches YVR Arrivals & Departures,
    enriches with FlightAware data, and writes to disk.
    """
    today_str, tomorrow_str, now_dt = get_vancouver_dates()

    # 1. Fetch Arrivals
    arr_raw = fetch_yvr_endpoint("A", today_str, tomorrow_str)
    # Wait 1.5s between calls to prevent rate limiting
    time.sleep(1.5)
    # 2. Fetch Departures
    dep_raw = fetch_yvr_endpoint("D", today_str, tomorrow_str)

    # 3. Load FlightAware supplementary data
    fa_map = load_flightaware_supplement()

    # 4. Transform and merge
    arrivals = [process_yvr_flight_item(it, "A", fa_map) for it in arr_raw]
    departures = [process_yvr_flight_item(it, "D", fa_map) for it in dep_raw]

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

        return consolidated

    # Fallback to existing disk cache
    if os.path.exists(OUTPUT_BACKEND_FILE):
        try:
            with open(OUTPUT_BACKEND_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return {"success": False, "arrivals": [], "departures": []}

def get_flights_data() -> Dict[str, Any]:
    global _yvr_flights_cache
    now = time.time()
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
