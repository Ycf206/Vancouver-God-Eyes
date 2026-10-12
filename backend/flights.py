import os
import json
import requests
import time
import math
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

# Vancouver Airspace Bounding Box (Lat: 48.8 to 49.6, Lon: -123.6 to -122.6)
VANCOUVER_BBOX = {
    "lamin": 48.8,
    "lamax": 49.6,
    "lomin": -123.6,
    "lomax": -122.6
}

# Quota file and Dynamic Routes cache for FlightAware
FLIGHTAWARE_QUOTA_FILE = os.path.join(os.path.dirname(__file__), "data", "flightaware_quota.json")
FLIGHTAWARE_ROUTES_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "dynamic_yvr_routes.json")
LIVE_FLIGHTS_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "cached_live_flights.json")

# In-memory cache for FlightAware responses and live aircraft
_flightaware_cache = {
    "timestamp": 0,
    "data": None
}
_mem_cached_live_flights: List[Dict[str, Any]] = []

def _save_cached_live_flights(flights_data: List[Dict[str, Any]]):
    global _mem_cached_live_flights
    if not flights_data:
        return
    _mem_cached_live_flights = flights_data
    try:
        os.makedirs(os.path.dirname(LIVE_FLIGHTS_CACHE_FILE), exist_ok=True)
        with open(LIVE_FLIGHTS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(flights_data, f, ensure_ascii=False)
    except Exception:
        pass

def _load_cached_live_flights() -> List[Dict[str, Any]]:
    global _mem_cached_live_flights
    if _mem_cached_live_flights:
        return _mem_cached_live_flights
    if os.path.exists(LIVE_FLIGHTS_CACHE_FILE):
        try:
            with open(LIVE_FLIGHTS_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and data:
                    _mem_cached_live_flights = data
                    return data
        except Exception:
            pass
    return []

# Dynamic route mapping accumulated from FlightAware live data
_dynamic_flight_routes: Dict[str, Any] = {}
if os.path.exists(FLIGHTAWARE_ROUTES_CACHE_FILE):
    try:
        with open(FLIGHTAWARE_ROUTES_CACHE_FILE, "r", encoding="utf-8") as _f:
            _dynamic_flight_routes = json.load(_f)
    except Exception:
        _dynamic_flight_routes = {}

def get_flightaware_api_key() -> str | None:
    """Robustly retrieves FlightAware API key from env or .env file."""
    key = os.getenv("FLIGHTAWARE_API_KEY") or os.getenv("AEROAPI_KEY")
    if key and key.strip():
        return key.strip()

    # Search local backend/.env or root .env
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    ]
    for p in env_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("FLIGHTAWARE_API_KEY=") or line.startswith("AEROAPI_KEY="):
                            parts = line.split("=", 1)
                            if len(parts) == 2 and parts[1].strip():
                                return parts[1].strip().strip('"').strip("'")
            except Exception:
                pass
    return None

def get_vancouver_now() -> datetime:
    """Returns current datetime in Vancouver timezone (PDT: UTC-7 / PST: UTC-8)."""
    utc_now = datetime.now(timezone.utc)
    month = utc_now.month
    # Daylight Saving Time check (Mar 2nd Sun to Nov 1st Sun)
    is_dst = (3 < month < 11) or (month == 3 and utc_now.day >= 8) or (month == 11 and utc_now.day < 7)
    van_tz = timezone(timedelta(hours=-7 if is_dst else -8))
    return utc_now.astimezone(van_tz)

def is_canadian_airport(airport_info: dict) -> bool:
    """Robustly checks whether an airport is in Canada by country, ICAO (starts with C), IATA (starts with Y) or city name."""
    if not airport_info:
        return False
    # 1. Country code check
    country = str(airport_info.get("country") or "").strip().upper()
    if country in ("CANADA", "CA", "CAN"):
        return True
    
    # 2. ICAO code: All Canadian airports start with 'C' (e.g. CYVR, CYYJ, CYYZ, CYCD, CYEG, CYUL, CYLW)
    icao = str(airport_info.get("code_icao") or airport_info.get("code") or "").strip().upper()
    if icao.startswith("C") and len(icao) == 4:
        return True
        
    # 3. IATA code: Major Canadian airports start with 'Y' (YYZ, YYJ, YCD, YVR, YEG, YUL, etc.)
    iata = str(airport_info.get("code_iata") or "").strip().upper()
    if iata.startswith("Y") and len(iata) == 3:
        return True
        
    # 4. Known Canadian cities / regions
    city = str(airport_info.get("city") or "").strip().lower()
    known_canadian_cities = (
        "victoria", "toronto", "nanaimo", "vancouver", "calgary", "edmonton", 
        "montreal", "ottawa", "kelowna", "winnipeg", "halifax", "quebec", 
        "abbotsford", "kamloops", "prince george", "castlegar", "whitehorse", 
        "yellowknife", "comox", "campbell river", "tofino", "terrace", 
        "fort st. john", "prince rupert", "regina", "saskatoon", "moncton", "st. john's"
    )
    if any(cc in city for cc in known_canadian_cities):
        return True
        
    return False

# Comprehensive Airport Database & Geographic Coordinates for YVR Routes
AIRPORT_DETAILS = {
    # Canada Major Hubs & BC Regional
    "YVR": {"code": "YVR", "name": "Vancouver International (溫哥華國際機場)", "city": "Vancouver (溫哥華)", "country": "Canada", "coord": [-123.1815, 49.1967]},
    "YYZ": {"code": "YYZ", "name": "Toronto Pearson (多倫多皮爾遜機場)", "city": "Toronto (多倫多)", "country": "Canada", "coord": [-79.6248, 43.6777]},
    "YYC": {"code": "YYC", "name": "Calgary International (卡加利國際機場)", "city": "Calgary (卡加利)", "country": "Canada", "coord": [-114.0076, 51.1215]},
    "YEG": {"code": "YEG", "name": "Edmonton International (艾德蒙頓國際機場)", "city": "Edmonton (艾德蒙頓)", "country": "Canada", "coord": [-113.5797, 53.3097]},
    "YUL": {"code": "YUL", "name": "Montréal-Trudeau (蒙特婁特魯多機場)", "city": "Montreal (蒙特婁)", "country": "Canada", "coord": [-73.7408, 45.4657]},
    "YOW": {"code": "YOW", "name": "Ottawa Macdonald-Cartier (渥太華機場)", "city": "Ottawa (渥太華)", "country": "Canada", "coord": [-75.6692, 45.3225]},
    "YYJ": {"code": "YYJ", "name": "Victoria International (維多利亞國際機場)", "city": "Victoria (維多利亞)", "country": "Canada", "coord": [-123.4258, 48.6469]},
    "YLW": {"code": "YLW", "name": "Kelowna International (基隆拿國際機場)", "city": "Kelowna (基隆拿)", "country": "Canada", "coord": [-119.3778, 49.9561]},
    "YWG": {"code": "YWG", "name": "Winnipeg Richardson (溫尼伯國際機場)", "city": "Winnipeg (溫尼伯)", "country": "Canada", "coord": [-97.2399, 49.9100]},
    "YCD": {"code": "YCD", "name": "Nanaimo Airport (乃磨機場)", "city": "Nanaimo (乃磨)", "country": "Canada", "coord": [-123.8700, 49.0522]},
    "YQQ": {"code": "YQQ", "name": "Comox Valley Airport (科莫克斯機場)", "city": "Comox (科莫克斯)", "country": "Canada", "coord": [-124.8867, 49.7108]},
    "YXS": {"code": "YXS", "name": "Prince George Airport (喬治王子城機場)", "city": "Prince George (喬治王子城)", "country": "Canada", "coord": [-122.6789, 53.8894]},
    "YKA": {"code": "YKA", "name": "Kamloops Airport (甘露市機場)", "city": "Kamloops (甘露市)", "country": "Canada", "coord": [-120.4444, 50.7022]},
    "CXH": {"code": "CXH", "name": "Vancouver Harbour Seaplane (溫哥華港水上飛機場)", "city": "Vancouver Harbour (水上港)", "country": "Canada", "coord": [-123.1167, 49.2889]},
    "YWH": {"code": "YWH", "name": "Victoria Inner Harbour (維多利亞內港水上機場)", "city": "Victoria Harbour (水上港)", "country": "Canada", "coord": [-123.3686, 48.4239]},
    
    # US & Transborder Hubs
    "SEA": {"code": "SEA", "name": "Seattle-Tacoma (西雅圖塔科馬機場)", "city": "Seattle (西雅圖)", "country": "USA", "coord": [-122.3088, 47.4502]},
    "SFO": {"code": "SFO", "name": "San Francisco International (舊金山國際機場)", "city": "San Francisco (舊金山)", "country": "USA", "coord": [-122.3790, 37.6213]},
    "LAX": {"code": "LAX", "name": "Los Angeles International (洛杉磯國際機場)", "city": "Los Angeles (洛杉磯)", "country": "USA", "coord": [-118.4085, 33.9416]},
    "PDX": {"code": "PDX", "name": "Portland International (波特蘭國際機場)", "city": "Portland (波特蘭)", "country": "USA", "coord": [-122.5975, 45.5898]},
    "LAS": {"code": "LAS", "name": "Harry Reid Las Vegas (拉斯維加斯國際機場)", "city": "Las Vegas (拉斯維加斯)", "country": "USA", "coord": [-115.1537, 36.0840]},
    "PHX": {"code": "PHX", "name": "Phoenix Sky Harbor (鳳凰城天港國際機場)", "city": "Phoenix (鳳凰城)", "country": "USA", "coord": [-112.0080, 33.4373]},
    "DFW": {"code": "DFW", "name": "Dallas/Fort Worth (達拉斯沃斯堡機場)", "city": "Dallas (達拉斯)", "country": "USA", "coord": [-97.0403, 32.8998]},
    "ORD": {"code": "ORD", "name": "Chicago O'Hare (芝加哥奧黑爾國際機場)", "city": "Chicago (芝加哥)", "country": "USA", "coord": [-87.9073, 41.9742]},
    "DEN": {"code": "DEN", "name": "Denver International (丹佛國際機場)", "city": "Denver (丹佛)", "country": "USA", "coord": [-104.6737, 39.8561]},
    "JFK": {"code": "JFK", "name": "John F. Kennedy (紐約甘迺迪機場)", "city": "New York (紐約)", "country": "USA", "coord": [-73.7781, 40.6413]},
    "HNL": {"code": "HNL", "name": "Daniel K. Inouye (檀香山國際機場)", "city": "Honolulu (檀香山)", "country": "USA", "coord": [-157.9224, 21.3187]},
    "OGG": {"code": "OGG", "name": "Kahului Airport (茂宜島卡胡盧伊機場)", "city": "Maui (茂宜島)", "country": "USA", "coord": [-156.4305, 20.8986]},
    "CUN": {"code": "CUN", "name": "Cancun International (坎昆國際機場)", "city": "Cancun (坎昆)", "country": "Mexico", "coord": [-86.8770, 21.0365]},
    "PVR": {"code": "PVR", "name": "Puerto Vallarta (巴亞爾塔港國際機場)", "city": "Puerto Vallarta (巴亞爾塔港)", "country": "Mexico", "coord": [-105.2542, 20.6801]},

    # Asia & Pacific
    "TPE": {"code": "TPE", "name": "Taiwan Taoyuan (台灣桃園國際機場)", "city": "Taipei (台北)", "country": "Taiwan", "coord": [121.2328, 25.0797]},
    "HKG": {"code": "HKG", "name": "Hong Kong International (香港赤鱲角機場)", "city": "Hong Kong (香港)", "country": "Hong Kong", "coord": [113.9185, 22.3080]},
    "NRT": {"code": "NRT", "name": "Narita International (東京成田國際機場)", "city": "Tokyo Narita (東京成田)", "country": "Japan", "coord": [140.3929, 35.7720]},
    "HND": {"code": "HND", "name": "Tokyo Haneda (東京羽田國際機場)", "city": "Tokyo Haneda (東京羽田)", "country": "Japan", "coord": [139.7798, 35.5494]},
    "ICN": {"code": "ICN", "name": "Incheon International (首爾仁川國際機場)", "city": "Seoul (首爾仁川)", "country": "South Korea", "coord": [126.4407, 37.4602]},
    "PVG": {"code": "PVG", "name": "Shanghai Pudong (上海浦東國際機場)", "city": "Shanghai (上海浦東)", "country": "China", "coord": [121.8052, 31.1443]},
    "PEK": {"code": "PEK", "name": "Beijing Capital (北京首都國際機場)", "city": "Beijing (北京首都)", "country": "China", "coord": [116.5975, 40.0801]},
    "SYD": {"code": "SYD", "name": "Sydney Kingsford Smith (雪梨金斯福德機場)", "city": "Sydney (雪梨)", "country": "Australia", "coord": [151.1772, -33.9461]},
    "BNE": {"code": "BNE", "name": "Brisbane Airport (布里斯本國際機場)", "city": "Brisbane (布里斯本)", "country": "Australia", "coord": [153.1175, -27.3842]},
    "AKL": {"code": "AKL", "name": "Auckland Airport (奧克蘭國際機場)", "city": "Auckland (奧克蘭)", "country": "New Zealand", "coord": [174.7922, -37.0082]},
    "DEL": {"code": "DEL", "name": "Indira Gandhi (德里英迪拉甘地機場)", "city": "Delhi (德里)", "country": "India", "coord": [77.1000, 28.5562]},

    # Europe
    "LHR": {"code": "LHR", "name": "London Heathrow (倫敦希斯洛機場)", "city": "London (倫敦希斯洛)", "country": "UK", "coord": [-0.4543, 51.4700]},
    "CDG": {"code": "CDG", "name": "Paris Charles de Gaulle (巴黎戴高樂機場)", "city": "Paris (巴黎戴高樂)", "country": "France", "coord": [2.5479, 49.0097]},
    "AMS": {"code": "AMS", "name": "Amsterdam Schiphol (阿姆斯特丹史基浦機場)", "city": "Amsterdam (阿姆斯特丹)", "country": "Netherlands", "coord": [4.7683, 52.3105]},
    "FRA": {"code": "FRA", "name": "Frankfurt Airport (法蘭克福機場)", "city": "Frankfurt (法蘭克福)", "country": "Germany", "coord": [8.5706, 50.0379]},
    "MUC": {"code": "MUC", "name": "Munich Airport (慕尼黑機場)", "city": "Munich (慕尼黑)", "country": "Germany", "coord": [11.7861, 48.3537]},
    "DUB": {"code": "DUB", "name": "Dublin Airport (都柏林機場)", "city": "Dublin (都柏林)", "country": "Ireland", "coord": [-6.2701, 53.4264]}
}

# Coordinate map for fast direct lookup
AIRPORT_COORDS = {code: info["coord"] for code, info in AIRPORT_DETAILS.items()}
# Alias ICAO codes
for _k, _v in list(AIRPORT_COORDS.items()):
    if len(_k) == 3:
        if _k in ("YVR", "YYZ", "YYC", "YEG", "YUL", "YOW", "YYJ", "YLW", "YWG", "YCD", "YQQ", "YXS", "YKA"):
            AIRPORT_COORDS[f"C{_k}"] = _v
        elif _k in ("SEA", "SFO", "LAX", "PDX", "LAS", "PHX", "DFW", "ORD", "DEN", "JFK"):
            AIRPORT_COORDS[f"K{_k}"] = _v
        elif _k == "TPE": AIRPORT_COORDS["RCTP"] = _v
        elif _k == "HKG": AIRPORT_COORDS["VHHH"] = _v
        elif _k == "NRT": AIRPORT_COORDS["RJAA"] = _v
        elif _k == "HND": AIRPORT_COORDS["RJTT"] = _v
        elif _k == "ICN": AIRPORT_COORDS["RKSI"] = _v
        elif _k == "LHR": AIRPORT_COORDS["EGLL"] = _v
        elif _k == "CDG": AIRPORT_COORDS["LFPG"] = _v
        elif _k == "AMS": AIRPORT_COORDS["EHAM"] = _v
        elif _k == "FRA": AIRPORT_COORDS["EDDF"] = _v

# Estimated realistic flight durations from/to YVR (in hours)
FLIGHT_DURATIONS_HOURS = {
    "YYJ": 0.5, "YCD": 0.4, "CXH": 0.5, "YWH": 0.5,
    "YLW": 0.9, "YKA": 0.8, "YQQ": 0.7, "YXS": 1.2,
    "YYC": 1.4, "YEG": 1.5, "YWG": 2.8,
    "YYZ": 4.5, "YUL": 4.8, "YOW": 4.6,
    "SEA": 0.8, "PDX": 1.1, "SFO": 2.2, "LAX": 2.8,
    "LAS": 2.6, "PHX": 3.0, "DEN": 2.7, "DFW": 4.0,
    "ORD": 4.1, "JFK": 5.2, "HNL": 5.8, "OGG": 5.9,
    "CUN": 5.5, "PVR": 4.8,
    "NRT": 10.0, "HND": 10.0, "ICN": 11.0, "TPE": 11.5,
    "PVG": 12.0, "PEK": 11.5, "HKG": 13.0, "DEL": 14.5,
    "SYD": 15.0, "BNE": 14.5, "AKL": 14.0,
    "LHR": 9.5, "CDG": 10.0, "AMS": 9.8, "FRA": 10.2, "MUC": 10.5, "DUB": 9.2
}

def get_airport_info(code_or_text: str) -> Dict[str, Any]:
    """Resolves airport code (IATA or ICAO) or city text into canonical airport details."""
    if not code_or_text:
        return AIRPORT_DETAILS["YYC"]
    
    clean = str(code_or_text).strip().upper()
    if clean in AIRPORT_DETAILS:
        return AIRPORT_DETAILS[clean]
    
    # ICAO conversion
    if len(clean) == 4:
        if clean.startswith("C") and clean[1:] in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean[1:]]
        if clean.startswith("K") and clean[1:] in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean[1:]]
        icao_map = {
            "RCTP": "TPE", "VHHH": "HKG", "RJAA": "NRT", "RJTT": "HND", 
            "RKSI": "ICN", "EGLL": "LHR", "LFPG": "CDG", "EHAM": "AMS", 
            "EDDF": "FRA", "EDDM": "MUC", "EIDW": "DUB"
        }
        if clean in icao_map and icao_map[clean] in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[icao_map[clean]]

    # Search in city or name string
    for key, info in AIRPORT_DETAILS.items():
        if f"({key})" in clean or f"({key} " in clean or key == clean[:3]:
            return info
        city_keyword = info["city"].split()[0].upper()
        if city_keyword in clean:
            return info
            
    # Fallback default
    fallback_code = clean[:3] if len(clean) >= 3 else "DEST"
    return {
        "code": fallback_code,
        "name": f"{code_or_text} 機場",
        "city": code_or_text,
        "country": "International",
        "coord": [-123.1815, 49.1967]
    }

def get_connected_airport_info(code_or_text: str, is_domestic: bool = True, hint: int = 0) -> Dict[str, Any]:
    """
    Resolves the NON-YVR partner airport from a route description, city name, or airport code.
    Guarantees that the returned airport is NEVER YVR/CYVR.
    """
    dom_fallback = ["YYC", "YYZ", "YEG", "YUL", "YYJ", "YLW", "YWG"]
    intl_fallback = ["SEA", "SFO", "LAX", "ICN", "NRT", "TPE", "HKG", "LHR", "HND"]
    fallback_list = dom_fallback if is_domestic else intl_fallback

    if not code_or_text:
        return AIRPORT_DETAILS[fallback_list[hint % len(fallback_list)]]
        
    raw = str(code_or_text).strip()
    upper_raw = raw.upper()

    # If the text has arrow '➔' or '->', split and find the non-YVR segment
    if "➔" in upper_raw or "->" in upper_raw:
        sep = "➔" if "➔" in upper_raw else "->"
        parts = [p.strip() for p in upper_raw.split(sep)]
        non_yvr_parts = [p for p in parts if "YVR" not in p and "CYVR" not in p]
        if non_yvr_parts:
            upper_raw = non_yvr_parts[0]

    # Clean code check (must not be YVR or CYVR)
    clean_code = upper_raw.strip()
    if clean_code not in ("YVR", "CYVR"):
        if clean_code in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean_code]
        if len(clean_code) == 4:
            if clean_code.startswith("C") and clean_code[1:] in AIRPORT_DETAILS and clean_code[1:] != "YVR":
                return AIRPORT_DETAILS[clean_code[1:]]
            if clean_code.startswith("K") and clean_code[1:] in AIRPORT_DETAILS:
                return AIRPORT_DETAILS[clean_code[1:]]
            icao_map = {
                "RCTP": "TPE", "VHHH": "HKG", "RJAA": "NRT", "RJTT": "HND", 
                "RKSI": "ICN", "EGLL": "LHR", "LFPG": "CDG", "EHAM": "AMS", 
                "EDDF": "FRA", "EDDM": "MUC", "EIDW": "DUB"
            }
            if clean_code in icao_map and icao_map[clean_code] in AIRPORT_DETAILS:
                return AIRPORT_DETAILS[icao_map[clean_code]]

    # Search for (CODE) in the text, explicitly skipping YVR / CYVR
    for key, info in AIRPORT_DETAILS.items():
        if key in ("YVR", "CYVR"):
            continue
        if f"({key})" in upper_raw or f"({key} " in upper_raw or f" {key} " in f" {upper_raw} ":
            return info
        city_keyword = info["city"].split()[0].upper()
        if city_keyword in upper_raw:
            return info

    return AIRPORT_DETAILS[fallback_list[hint % len(fallback_list)]]

def are_carriers_equivalent(c1: str, c2: str) -> bool:
    """Checks if two carrier codes (IATA or ICAO) belong to the same airline family or operation."""
    c1 = (c1 or "").strip().upper()
    c2 = (c2 or "").strip().upper()
    if not c1 or not c2 or c1 == c2:
        return True
    
    # Check AIRLINES_INFO mapping
    for icao, info in AIRLINES_INFO.items():
        iata = info["code"].upper()
        if (c1 in (icao, iata)) and (c2 in (icao, iata)):
            return True
            
    # Airline families & subsidiary brands (e.g. Air Canada Express / Jazz, WestJet Encore, Horizon Air)
    families = [
        {"AC", "ACA", "QK", "JZA", "RV", "ROU"}, # Air Canada / Jazz / Rouge
        {"WS", "WJA", "WR", "WEN"},             # WestJet / WestJet Encore
        {"AS", "ASA", "QXE"},                   # Alaska Airlines / Horizon Air
        {"DL", "DAL", "OO", "SKW"},             # Delta / SkyWest
        {"UA", "UAL", "OO", "SKW"},             # United / SkyWest
        {"AA", "AAL"},                          # American
        {"PD", "POE"},                          # Porter
        {"F8", "FLE"},                          # Flair
        {"8P", "PCO"},                          # Pacific Coastal
    ]
    for fam in families:
        if c1 in fam and c2 in fam:
            return True
    return False

def generate_flight_route_points(origin_coord: List[float], plane_coord: List[float] | None, dest_coord: List[float]) -> List[List[float]]:
    """
    Generates smooth, realistic Great Circle flight path coordinates connecting:
    origin_coord -> [plane_coord] -> dest_coord
    """
    def slerp_points(p1: List[float], p2: List[float], count: int) -> List[List[float]]:
        lon1, lat1 = p1
        lon2, lat2 = p2
        diff_lon = lon2 - lon1
        # Handle continuous date line crossing
        if diff_lon > 180:
            lon2 -= 360
        elif diff_lon < -180:
            lon2 += 360
            
        pts = []
        for step in range(count + 1):
            f = step / float(count)
            c_lon = lon1 + f * (lon2 - lon1)
            c_lat = lat1 + f * (lat2 - lat1)
            # Add subtle Great Circle curvature for transcontinental & transpacific routes
            if abs(lon2 - lon1) > 15:
                bulge = math.sin(f * math.pi) * min(10.0, abs(lon2 - lon1) * 0.08)
                c_lat = min(75.0, c_lat + bulge)
            pts.append([round(c_lon, 4), round(c_lat, 4)])
        return pts

    if plane_coord and plane_coord[0] is not None and plane_coord[1] is not None:
        leg1 = slerp_points(origin_coord, plane_coord, 8)
        leg2 = slerp_points(plane_coord, dest_coord, 8)
        return leg1 + leg2[1:]
    else:
        return slerp_points(origin_coord, dest_coord, 14)

def resolve_flight_telemetry_and_route(
    flight_no: str,
    callsign: str,
    country: str,
    is_domestic: bool,
    lon: float | None,
    lat: float | None,
    alt_ft: int,
    speed_kts: int,
    vert_rate_fpm: int,
    bearing: float,
    matched_route: Dict[str, Any] | None = None,
    index_hint: int = 0
) -> Dict[str, Any]:
    """
    Resolves complete origin, destination, schedule times (in Vancouver time),
    terminal, gate, and full Great Circle trajectory points for any flight.
    Guarantees that origin != destination (eliminates YVR -> YVR duplicates).
    """
    # 1. Determine flight type: Arrival ('arr') or Departure ('dep')
    if matched_route and matched_route.get("type"):
        flight_type = matched_route["type"]
    elif alt_ft < 800 and speed_kts < 50:
        flight_type = "arr" if (index_hint % 2 == 0) else "dep"
    elif vert_rate_fpm > 250 or (alt_ft < 10000 and bearing < 220 and vert_rate_fpm >= 0):
        flight_type = "dep"
    else:
        flight_type = "arr"

    # 2. Determine connected partner airport details (never YVR)
    ref_text = ""
    if matched_route:
        ref_text = (
            matched_route.get("connected_airport_code") or
            (matched_route.get("dest_code") if flight_type == "dep" else matched_route.get("origin_code")) or
            matched_route.get("city") or
            ""
        )
    other_info = get_connected_airport_info(ref_text, is_domestic=is_domestic, hint=index_hint)

    # 3. Assign Origin and Destination strictly
    yvr_info = AIRPORT_DETAILS["YVR"]
    if flight_type == "dep":
        origin_info = yvr_info
        dest_info = other_info
    else:
        origin_info = other_info
        dest_info = yvr_info

    # 4. Realistic Vancouver Timezone Schedules
    van_now = get_vancouver_now()
    flight_dur = FLIGHT_DURATIONS_HOURS.get(other_info["code"], 2.5)

    if flight_type == "arr":
        time_to_land_min = max(8, min(40, int((alt_ft / 1000) * 2.2))) if alt_ft > 0 else 5
        arr_dt = van_now + timedelta(minutes=time_to_land_min)
        dep_dt = arr_dt - timedelta(hours=flight_dur)
    else:
        time_since_takeoff_min = max(5, min(30, int((alt_ft / 1000) * 1.8))) if alt_ft > 0 else 2
        dep_dt = van_now - timedelta(minutes=time_since_takeoff_min)
        arr_dt = dep_dt + timedelta(hours=flight_dur)

    # 5. Full Route LineString Coordinates
    plane_coord = [lon, lat] if (lon is not None and lat is not None) else None
    route_coords = generate_flight_route_points(origin_info["coord"], plane_coord, dest_info["coord"])

    # 6. Terminal and Gate
    if matched_route and matched_route.get("terminal"):
        terminal = matched_route["terminal"]
    else:
        terminal = "國內線航廈 (Domestic)" if is_domestic else "國際線航廈 (International)"

    if matched_route and matched_route.get("gate"):
        gate = matched_route["gate"]
    else:
        gate = f"B{(index_hint % 12) + 12}" if is_domestic else f"D{(index_hint % 15) + 50}"

    return {
        "flight_type": flight_type,
        "origin_code": origin_info["code"],
        "origin_name": origin_info["name"],
        "origin_city": origin_info["city"],
        "origin_coord": origin_info["coord"],
        "dest_code": dest_info["code"],
        "dest_name": dest_info["name"],
        "dest_city": dest_info["city"],
        "dest_coord": dest_info["coord"],
        "departure_time": dep_dt.strftime("%H:%M"),
        "arrival_time": arr_dt.strftime("%H:%M"),
        "terminal": terminal,
        "gate": gate,
        "city": f"{origin_info['city']} ➔ {dest_info['city']}",
        "route_coords": route_coords
    }


# Major airlines operating at YVR
AIRLINES_INFO = {
    # Canadian Domestic & Regional
    "ACA": {"name": "Air Canada (加拿大航空)", "short": "加航", "code": "AC", "domestic": True},
    "JZA": {"name": "Air Canada Express / Jazz (加航快運)", "short": "加航快運", "code": "QK", "domestic": True},
    "WJA": {"name": "WestJet (西捷航空)", "short": "西捷", "code": "WS", "domestic": True},
    "WEN": {"name": "WestJet Encore (西捷短途)", "short": "西捷Encore", "code": "WR", "domestic": True},
    "POE": {"name": "Porter Airlines (波特航空)", "short": "波特航空", "code": "PD", "domestic": True},
    "FLE": {"name": "Flair Airlines (精靈航空)", "short": "Flair", "code": "F8", "domestic": True},
    "ROU": {"name": "Air Canada Rouge (加航Rouge)", "short": "加航Rouge", "code": "RV", "domestic": True},
    "TSC": {"name": "Air Transat (越洋航空)", "short": "越洋航空", "code": "TS", "domestic": True},
    "SWG": {"name": "Sunwing Airlines (陽翼航空)", "short": "陽翼航空", "code": "WG", "domestic": True},
    "PCO": {"name": "Pacific Coastal Airlines (太平洋沿岸航空)", "short": "Pacific Coastal", "code": "8P", "domestic": True},
    "CRA": {"name": "Central Mountain Air (中天航空)", "short": "CMA", "code": "9M", "domestic": True},
    "HBA": {"name": "Harbour Air (港灣水上航空)", "short": "Harbour Air", "code": "HBA", "domestic": True},
    "SEI": {"name": "Seair Seaplanes (西埃水上航空)", "short": "Seair", "code": "SEI", "domestic": True},
    "CJT": {"name": "Cargojet (加拿大貨運航空)", "short": "Cargojet", "code": "W8", "domestic": True},
    "KFA": {"name": "Kelowna Flightcraft", "short": "KF Cargo", "code": "KW", "domestic": True},
    "MAL": {"name": "Morningstar Air Express", "short": "Morningstar", "code": "MAL", "domestic": True},

    # US & Transborder Carriers
    "QXE": {"name": "Horizon Air / Alaska (阿拉斯加地平線)", "short": "Alaska Horizon", "code": "AS", "domestic": False},
    "ASA": {"name": "Alaska Airlines (阿拉斯加航空)", "short": "阿拉斯加", "code": "AS", "domestic": False},
    "DAL": {"name": "Delta Air Lines (達美航空)", "short": "達美", "code": "DL", "domestic": False},
    "UAL": {"name": "United Airlines (聯合航空)", "short": "聯航", "code": "UA", "domestic": False},
    "AAL": {"name": "American Airlines (美國航空)", "short": "美航", "code": "AA", "domestic": False},
    "SKW": {"name": "SkyWest Airlines (天西航空)", "short": "SkyWest", "code": "OO", "domestic": False},
    "SWA": {"name": "Southwest Airlines (西南航空)", "short": "西南", "code": "WN", "domestic": False},
    "FFT": {"name": "Frontier Airlines (邊疆航空)", "short": "Frontier", "code": "F9", "domestic": False},

    # Asian Carriers
    "CPA": {"name": "Cathay Pacific (國泰航空)", "short": "國泰", "code": "CX", "domestic": False},
    "EVA": {"name": "EVA Air (長榮航空)", "short": "長榮", "code": "BR", "domestic": False},
    "CAL": {"name": "China Airlines (中華航空)", "short": "華航", "code": "CI", "domestic": False},
    "JAL": {"name": "Japan Airlines (日本航空)", "short": "日航", "code": "JL", "domestic": False},
    "ANA": {"name": "All Nippon Airways (全日空)", "short": "全日空", "code": "NH", "domestic": False},
    "KAL": {"name": "Korean Air (大韓航空)", "short": "大韓", "code": "KE", "domestic": False},
    "AAR": {"name": "Asiana Airlines (韓亞航空)", "short": "韓亞", "code": "OZ", "domestic": False},
    "CES": {"name": "China Eastern Airlines (中國東方航空)", "short": "東航", "code": "MU", "domestic": False},
    "CCA": {"name": "Air China (中國國際航空)", "short": "國航", "code": "CA", "domestic": False},
    "CSN": {"name": "China Southern Airlines (中國南方航空)", "short": "南航", "code": "CZ", "domestic": False},
    "CHH": {"name": "Hainan Airlines (海南航空)", "short": "海航", "code": "HU", "domestic": False},
    "XMR": {"name": "Xiamen Airlines (廈門航空)", "short": "廈航", "code": "MF", "domestic": False},
    "SIA": {"name": "Singapore Airlines (新加坡航空)", "short": "新航", "code": "SQ", "domestic": False},
    "PAL": {"name": "Philippine Airlines (菲律賓航空)", "short": "菲航", "code": "PR", "domestic": False},

    # European & International Carriers
    "BAW": {"name": "British Airways (英國航空)", "short": "英航", "code": "BA", "domestic": False},
    "AFR": {"name": "Air France (法國航空)", "short": "法航", "code": "AF", "domestic": False},
    "KLM": {"name": "KLM Royal Dutch Airlines (荷蘭皇家航空)", "short": "荷航", "code": "KL", "domestic": False},
    "DLH": {"name": "Lufthansa (德國漢莎航空)", "short": "漢莎", "code": "LH", "domestic": False},
    "ANZ": {"name": "Air New Zealand (紐西蘭航空)", "short": "紐航", "code": "NZ", "domestic": False},
    "QFA": {"name": "Qantas (澳洲航空)", "short": "澳航", "code": "QF", "domestic": False},
    "AMX": {"name": "Aeromexico (墨西哥航空)", "short": "墨航", "code": "AM", "domestic": False},
    "FDX": {"name": "FedEx Express (聯邦快遞)", "short": "FedEx", "code": "FX", "domestic": False},
    "UPS": {"name": "UPS Airlines (優比速航空)", "short": "UPS", "code": "5X", "domestic": False},
}

# Authentic YVR Flight Routes Database (Real-world routes operating at CYVR)
KNOWN_YVR_ROUTES = {
    # Air Canada International & Transborder
    "AC63": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "dep"},
    "AC64": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "arr"},
    "AC3": {"city": "Tokyo (NRT 成田)", "intl": True, "type": "dep"},
    "AC4": {"city": "Tokyo (NRT 成田)", "intl": True, "type": "arr"},
    "AC25": {"city": "Shanghai (PVG 浦東)", "intl": True, "type": "dep"},
    "AC26": {"city": "Shanghai (PVG 浦東)", "intl": True, "type": "arr"},
    "AC7": {"city": "Hong Kong (HKG 香港)", "intl": True, "type": "dep"},
    "AC8": {"city": "Hong Kong (HKG 香港)", "intl": True, "type": "arr"},
    "AC11": {"city": "Taipei (TPE 台北)", "intl": True, "type": "dep"},
    "AC12": {"city": "Taipei (TPE 台北)", "intl": True, "type": "arr"},
    "AC33": {"city": "Sydney (SYD 雪梨)", "intl": True, "type": "dep"},
    "AC34": {"city": "Sydney (SYD 雪梨)", "intl": True, "type": "arr"},
    "AC37": {"city": "Brisbane (BNE 布里斯本)", "intl": True, "type": "dep"},
    "AC38": {"city": "Brisbane (BNE 布里斯本)", "intl": True, "type": "arr"},
    "AC45": {"city": "Delhi (DEL 德里)", "intl": True, "type": "dep"},
    "AC46": {"city": "Delhi (DEL 德里)", "intl": True, "type": "arr"},
    "AC541": {"city": "Seattle (SEA 西雅圖)", "intl": True, "type": "dep"},
    "AC542": {"city": "Seattle (SEA 西雅圖)", "intl": True, "type": "arr"},
    "AC560": {"city": "San Francisco (SFO 舊金山)", "intl": True, "type": "dep"},
    "AC561": {"city": "San Francisco (SFO 舊金山)", "intl": True, "type": "arr"},
    "AC552": {"city": "Los Angeles (LAX 洛杉磯)", "intl": True, "type": "dep"},
    "AC553": {"city": "Los Angeles (LAX 洛杉磯)", "intl": True, "type": "arr"},
    "AC854": {"city": "London (LHR 倫敦)", "intl": True, "type": "dep"},
    "AC855": {"city": "London (LHR 倫敦)", "intl": True, "type": "arr"},
    "AC888": {"city": "Frankfurt (FRA 法蘭克福)", "intl": True, "type": "dep"},
    "AC889": {"city": "Frankfurt (FRA 法蘭克福)", "intl": True, "type": "arr"},

    # Air Canada Major Domestic
    "AC102": {"city": "Toronto (YYZ 多倫多)", "intl": False, "type": "dep"},
    "AC103": {"city": "Toronto (YYZ 多倫多)", "intl": False, "type": "arr"},
    "AC116": {"city": "Toronto (YYZ 多倫多)", "intl": False, "type": "arr"},
    "AC125": {"city": "Toronto (YYZ 多倫多)", "intl": False, "type": "dep"},
    "AC204": {"city": "Calgary (YYC 卡加利)", "intl": False, "type": "dep"},
    "AC205": {"city": "Calgary (YYC 卡加利)", "intl": False, "type": "arr"},
    "AC236": {"city": "Edmonton (YEG 艾德蒙頓)", "intl": False, "type": "dep"},
    "AC237": {"city": "Edmonton (YEG 艾德蒙頓)", "intl": False, "type": "arr"},
    "AC302": {"city": "Montreal (YUL 蒙特婁)", "intl": False, "type": "dep"},
    "AC303": {"city": "Montreal (YUL 蒙特婁)", "intl": False, "type": "arr"},
    "AC342": {"city": "Ottawa (YOW 渥太華)", "intl": False, "type": "dep"},
    "AC8050": {"city": "Victoria (YYJ 維多利亞)", "intl": False, "type": "dep"},
    "AC8051": {"city": "Victoria (YYJ 維多利亞)", "intl": False, "type": "arr"},
    "AC8400": {"city": "Kelowna (YLW 基隆拿)", "intl": False, "type": "dep"},
    "AC8401": {"city": "Kelowna (YLW 基隆拿)", "intl": False, "type": "arr"},

    # Asian & European Flag Carriers
    "BR9": {"city": "Taipei (TPE 台北)", "intl": True, "type": "dep"},
    "BR10": {"city": "Taipei (TPE 台北)", "intl": True, "type": "arr"},
    "CI31": {"city": "Taipei (TPE 台北)", "intl": True, "type": "dep"},
    "CI32": {"city": "Taipei (TPE 台北)", "intl": True, "type": "arr"},
    "CX888": {"city": "Hong Kong (HKG 香港)", "intl": True, "type": "arr"},
    "CX889": {"city": "Hong Kong (HKG 香港)", "intl": True, "type": "dep"},
    "JL17": {"city": "Tokyo (NRT 成田)", "intl": True, "type": "dep"},
    "JL18": {"city": "Tokyo (NRT 成田)", "intl": True, "type": "arr"},
    "NH115": {"city": "Tokyo (HND 羽田)", "intl": True, "type": "dep"},
    "NH116": {"city": "Tokyo (HND 羽田)", "intl": True, "type": "arr"},
    "KE71": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "arr"},
    "KE72": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "dep"},
    "OZ741": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "arr"},
    "OZ742": {"city": "Seoul (ICN 首爾)", "intl": True, "type": "dep"},
    "BA84": {"city": "London (LHR 倫敦)", "intl": True, "type": "dep"},
    "BA85": {"city": "London (LHR 倫敦)", "intl": True, "type": "arr"},
    "AF374": {"city": "Paris (CDG 巴黎)", "intl": True, "type": "arr"},
    "AF379": {"city": "Paris (CDG 巴黎)", "intl": True, "type": "dep"},
    "KL681": {"city": "Amsterdam (AMS 阿姆斯特丹)", "intl": True, "type": "arr"},
    "KL682": {"city": "Amsterdam (AMS 阿姆斯特丹)", "intl": True, "type": "dep"},
    "LH492": {"city": "Frankfurt (FRA 法蘭克福)", "intl": True, "type": "arr"},
    "LH493": {"city": "Frankfurt (FRA 法蘭克福)", "intl": True, "type": "dep"},

    # US Carriers
    "UA1420": {"city": "San Francisco (SFO 舊金山)", "intl": True, "type": "arr"},
    "DL1980": {"city": "Seattle (SEA 西雅圖)", "intl": True, "type": "dep"},
    "AS2004": {"city": "Seattle (SEA 西雅圖)", "intl": True, "type": "arr"},
    "AS2005": {"city": "Seattle (SEA 西雅圖)", "intl": True, "type": "dep"},
    "AA1120": {"city": "Dallas (DFW 達拉斯)", "intl": True, "type": "arr"},

    # WestJet & Domestic
    "WS706": {"city": "Calgary (YYC 卡加利)", "intl": False, "type": "arr"},
    "WS118": {"city": "Calgary (YYC 卡加利)", "intl": False, "type": "dep"},
    "WS135": {"city": "Edmonton (YEG 艾德蒙頓)", "intl": False, "type": "arr"},
    "WS710": {"city": "Toronto (YYZ 多倫多)", "intl": False, "type": "dep"},
    "F8102": {"city": "Edmonton (YEG 艾德蒙頓)", "intl": False, "type": "arr"},
    "8P108": {"city": "Victoria (YYJ 維多利亞)", "intl": False, "type": "arr"},
}

def parse_callsign(raw_callsign: str, country: str) -> Dict[str, Any]:
    """Decodes callsign into formatted flight number, airline, verified route and category."""
    cs = (raw_callsign or "").strip().upper()
    if not cs:
        return {
            "flight_no": "PRIVATE",
            "airline": f"私人/公務機 ({country})" if country else "未知航班",
            "category": "domestic" if country == "Canada" else "international",
            "is_domestic": country == "Canada",
            "badge": "🇨🇦 國內/省內" if country == "Canada" else "🌐 國際/跨美",
            "matched_route": None
        }

    # Match 3-letter ICAO prefix
    prefix3 = cs[:3]
    num_part = cs[3:].lstrip("0") or cs[3:]
    
    # Check dynamic FlightAware route cache first, then static routes table
    if prefix3 in AIRLINES_INFO:
        info = AIRLINES_INFO[prefix3]
        short_code = info["code"]
        normalized_flight_key = f"{short_code}{num_part}"
        flight_no = f"{short_code} {num_part}".strip()
        
        # 1. First priority: Real-time route from FlightAware AeroAPI
        # 2. Second priority: Known verified routes table
        matched_route = (
            _dynamic_flight_routes.get(normalized_flight_key) or
            _dynamic_flight_routes.get(cs) or
            _dynamic_flight_routes.get(flight_no.replace(" ", "")) or
            _dynamic_flight_routes.get(f"{prefix3}{num_part}") or
            KNOWN_YVR_ROUTES.get(normalized_flight_key) or
            KNOWN_YVR_ROUTES.get(f"{prefix3}{num_part}")
        )
        
        if matched_route:
            is_dom = not matched_route["intl"]
            return {
                "flight_no": flight_no,
                "airline": info["name"],
                "short_airline": info["short"],
                "category": "domestic" if is_dom else "international",
                "is_domestic": is_dom,
                "badge": "🇨🇦 國內航班" if is_dom else "🌐 國際航班",
                "matched_route": matched_route
            }

        is_dom = info["domestic"]
        return {
            "flight_no": flight_no,
            "airline": info["name"],
            "short_airline": info["short"],
            "category": "domestic" if is_dom else "international",
            "is_domestic": is_dom,
            "badge": "🇨🇦 國內航班" if is_dom else "🌐 國際航班",
            "matched_route": None
        }

    # Canadian registration prefix (e.g. C-GBUD, CFODH)
    if cs.startswith("C") and len(cs) == 5 and country == "Canada":
        reg = f"C-{cs[1:]}"
        return {
            "flight_no": reg,
            "airline": "加拿大註冊航空機",
            "short_airline": "通用航空",
            "category": "domestic",
            "is_domestic": True,
            "badge": "🇨🇦 國內/通用航空",
            "matched_route": None
        }

    # Fallback by country
    is_dom = (country == "Canada")
    return {
        "flight_no": cs,
        "airline": f"航空客機 ({country})" if country else "航空客機",
        "short_airline": country or "航班",
        "category": "domestic" if is_dom else "international",
        "is_domestic": is_dom,
        "badge": "🇨🇦 國內航班" if is_dom else "🌐 國際航班",
        "matched_route": None
    }

def fetch_live_flights() -> List[Dict[str, Any]]:
    """
    Fetches real-time ADS-B aircraft in Vancouver airspace from OpenSky Network.
    Returns clean, standardized flight dictionary objects.
    """
    url = (
        f"https://opensky-network.org/api/states/all"
        f"?lamin={VANCOUVER_BBOX['lamin']}&lamax={VANCOUVER_BBOX['lamax']}"
        f"&lomin={VANCOUVER_BBOX['lomin']}&lomax={VANCOUVER_BBOX['lomax']}"
    )
    headers = {"User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            states = data.get("states", [])
            if states:
                flights = []
                for idx, s in enumerate(states):
                    icao = s[0]
                    raw_cs = s[1]
                    country = s[2] or ""
                    lon = s[5]
                    lat = s[6]

                    if lon is None or lat is None:
                        continue

                    alt_m = s[7]
                    on_ground = bool(s[8])
                    vel_ms = s[9]
                    track_deg = s[10] or 0.0
                    vert_rate_ms = s[11]

                    # Conversions
                    alt_ft = round(alt_m * 3.28084) if alt_m is not None else 0
                    speed_kts = round(vel_ms * 1.94384) if vel_ms is not None else 0
                    vert_rate_fpm = round(vert_rate_ms * 196.85) if vert_rate_ms is not None else 0

                    # Decode airline, verified route & domestic/international
                    parsed = parse_callsign(raw_cs, country)

                    # Determine flight phase
                    if on_ground or alt_ft < 150:
                        status = "已降落 / 地面滑行"
                        status_code = "landed"
                        status_badge = "🛬 已降落"
                    elif vert_rate_fpm < -250 and alt_ft < 9000:
                        status = f"進場降落中 ({alt_ft:,} ft)"
                        status_code = "approaching"
                        status_badge = "⬇️ 進場降落"
                    elif vert_rate_fpm > 250 and alt_ft < 9000:
                        status = f"起飛爬升中 ({alt_ft:,} ft)"
                        status_code = "climbing"
                        status_badge = "⬆️ 起飛爬升"
                    else:
                        status = f"巡航飛行中 ({alt_ft:,} ft)"
                        status_code = "cruising"
                        status_badge = "✈️ 巡航中"

                    # Resolve detailed route, origin, destination, schedule times, and trajectory
                    route_info = resolve_flight_telemetry_and_route(
                        flight_no=parsed["flight_no"],
                        callsign=raw_cs or "",
                        country=country,
                        is_domestic=parsed["is_domestic"],
                        lon=lon,
                        lat=lat,
                        alt_ft=alt_ft,
                        speed_kts=speed_kts,
                        vert_rate_fpm=vert_rate_fpm,
                        bearing=track_deg,
                        matched_route=parsed.get("matched_route"),
                        index_hint=idx
                    )

                    flights.append({
                        "id": f"flight_{icao}",
                        "icao24": icao,
                        "callsign": (raw_cs or "").strip(),
                        "flight_no": parsed["flight_no"],
                        "airline": parsed["airline"],
                        "short_airline": parsed.get("short_airline", ""),
                        "category": parsed["category"],
                        "is_domestic": parsed["is_domestic"],
                        "badge": parsed["badge"],
                        "country": country,
                        "lon": round(lon, 5),
                        "lat": round(lat, 5),
                        "altitude_ft": alt_ft,
                        "speed_kts": speed_kts,
                        "bearing": round(track_deg, 1),
                        "vertical_rate_fpm": vert_rate_fpm,
                        "on_ground": on_ground,
                        "status": status,
                        "status_code": status_code,
                        "status_badge": status_badge,
                        "is_live": True,
                        "flight_type": route_info["flight_type"],
                        "origin_code": route_info["origin_code"],
                        "origin_name": route_info["origin_name"],
                        "origin_city": route_info["origin_city"],
                        "origin_coord": route_info["origin_coord"],
                        "dest_code": route_info["dest_code"],
                        "dest_name": route_info["dest_name"],
                        "dest_city": route_info["dest_city"],
                        "dest_coord": route_info["dest_coord"],
                        "departure_time": route_info["departure_time"],
                        "arrival_time": route_info["arrival_time"],
                        "terminal": route_info["terminal"],
                        "gate": route_info["gate"],
                        "city": route_info["city"],
                        "route_coords": route_info["route_coords"],
                        "matched_route": parsed.get("matched_route"),
                        "updated_at": datetime.now(timezone.utc).isoformat() + "Z"
                    })

                if flights:
                    _save_cached_live_flights(flights)
                    return flights
        else:
            print(f"⚠️ OpenSky API returned status {resp.status_code}. Using cached live radar data.")
    except Exception as e:
        print(f"⚠️ Error querying OpenSky: {e}. Falling back to cached live radar data.")

    # Fallback to last cached radar flights with smooth time updates
    cached = _load_cached_live_flights()
    if cached:
        now_iso = datetime.now(timezone.utc).isoformat() + "Z"
        for f in cached:
            f["updated_at"] = now_iso
        return cached

    return []

def fetch_flightaware_schedules(allow_api_call: bool = True) -> Dict[str, Any] | None:
    """
    Fetches official YVR arrivals and departures from FlightAware AeroAPI.
    Strictly protected with 40-minute in-memory caching and 480-query monthly hard limit (safety buffer for 500 free tier).
    Only triggers HTTP calls when allow_api_call=True (on-demand when users view the schedule).
    """
    global _dynamic_flight_routes
    api_key = get_flightaware_api_key()
    if not api_key:
        return _flightaware_cache.get("data")

    now_ts = time.time()
    # Check 40-minute cache (2400 seconds)
    if _flightaware_cache["data"] and (now_ts - _flightaware_cache["timestamp"] < 2400):
        return _flightaware_cache["data"]

    # If background radar update (not user on-demand request), do not consume API quota
    if not allow_api_call:
        return _flightaware_cache.get("data")

    # Check monthly quota to prevent ANY extra charge (Default 480 calls, leaving 20 buffer below 500)
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    max_monthly_calls = int(os.getenv("FLIGHTAWARE_MAX_MONTHLY_CALLS", "480"))
    quota_count = 0
    try:
        if os.path.exists(FLIGHTAWARE_QUOTA_FILE):
            with open(FLIGHTAWARE_QUOTA_FILE, "r") as f:
                q_data = json.load(f)
                if q_data.get("month") == current_month:
                    quota_count = q_data.get("count", 0)
    except Exception:
        pass

    if quota_count >= max_monthly_calls:
        print(f"⚠️ FlightAware Monthly Quota Circuit Breaker active (>= {max_monthly_calls} calls). Seamlessly switching to OpenSky + cached route fallback.")
        return _flightaware_cache.get("data")

    try:
        url = "https://aeroapi.flightaware.com/aeroapi/airports/CYVR/flights?max_pages=1"
        headers = {"x-apikey": api_key, "User-Agent": "VancouverGodsEye/1.0"}
        resp = requests.get(url, headers=headers, timeout=10)
        
        if resp.status_code != 200:
            print(f"FlightAware API error status: {resp.status_code} ({resp.text[:100]})")
            return _flightaware_cache.get("data")

        # Increment quota tracker on successful call
        quota_count += 1
        os.makedirs(os.path.dirname(FLIGHTAWARE_QUOTA_FILE), exist_ok=True)
        with open(FLIGHTAWARE_QUOTA_FILE, "w") as f:
            json.dump({"month": current_month, "count": quota_count, "last_call": datetime.now(timezone.utc).isoformat()}, f)

        fa_data = resp.json()
        van_now = get_vancouver_now()
        
        arrivals = []
        for flight in fa_data.get("enroute", []) + fa_data.get("arrivals", []) + fa_data.get("scheduled_arrivals", []):
            ident = flight.get("ident") or flight.get("ident_iata") or "N/A"
            origin_info = flight.get("origin") or {}
            orig_raw_code = (origin_info.get("code_iata") or origin_info.get("code") or origin_info.get("city") or "DEP").upper()
            is_dom = is_canadian_airport(origin_info)
            orig_detail = get_connected_airport_info(orig_raw_code, is_domestic=is_dom)
            dest_detail = AIRPORT_DETAILS["YVR"]
            orig_city = origin_info.get("city") or orig_detail["city"]
            airline_name = flight.get("operator") or (AIRLINES_INFO.get(ident[:3].upper(), {}).get("name") if len(ident) >= 3 else "客運航空")
            
            # Arrival time in Vancouver timezone
            t_str = flight.get("estimated_on") or flight.get("scheduled_on") or flight.get("estimated_in")
            arr_display_time = van_now.strftime("%H:%M")
            if t_str:
                try:
                    dt_val = datetime.fromisoformat(t_str.replace("Z", "+00:00"))
                    van_dt = dt_val.astimezone(van_now.tzinfo)
                    arr_display_time = van_dt.strftime("%H:%M")
                except Exception:
                    pass

            # Departure time in Vancouver timezone
            dep_t_str = flight.get("estimated_off") or flight.get("scheduled_off") or flight.get("estimated_out")
            dep_display_time = "--:--"
            if dep_t_str:
                try:
                    dep_dt_val = datetime.fromisoformat(dep_t_str.replace("Z", "+00:00"))
                    dep_display_time = dep_dt_val.astimezone(van_now.tzinfo).strftime("%H:%M")
                except Exception:
                    pass
            if dep_display_time == "--:--":
                flight_dur = FLIGHT_DURATIONS_HOURS.get(orig_detail["code"], 2.5)
                try:
                    dep_display_time = (datetime.strptime(arr_display_time, "%H:%M") - timedelta(hours=flight_dur)).strftime("%H:%M")
                except Exception:
                    dep_display_time = "12:00"

            route_coords = generate_flight_route_points(orig_detail["coord"], None, dest_detail["coord"])

            item = {
                "id": f"fa_arr_{flight.get('fa_flight_id') or ident}",
                "flight_no": ident,
                "airline": airline_name,
                "category": "domestic" if is_dom else "international",
                "is_domestic": is_dom,
                "flight_type": "arr",
                "origin_code": orig_detail["code"],
                "origin_name": orig_detail["name"],
                "origin_city": orig_detail["city"],
                "origin_coord": orig_detail["coord"],
                "dest_code": "YVR",
                "dest_name": dest_detail["name"],
                "dest_city": dest_detail["city"],
                "dest_coord": dest_detail["coord"],
                "departure_time": dep_display_time,
                "arrival_time": arr_display_time,
                "city": f"{orig_city} ({orig_detail['code']}) ➔ Vancouver (YVR)",
                "time": arr_display_time,
                "terminal": flight.get("terminal") or ("國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)"),
                "gate": flight.get("gate") or "--",
                "status": flight.get("status") or "預計抵達",
                "status_code": "scheduled",
                "is_live": False,
                "route_coords": route_coords
            }
            arrivals.append(item)

            # Accumulate dynamic route for live radar map matching
            clean_ident = ident.replace(" ", "").upper()
            ident_iata = (flight.get("ident_iata") or "").replace(" ", "").upper()
            if clean_ident:
                route_entry = {
                    "city": item["city"],
                    "connected_airport_code": orig_detail["code"],
                    "origin_code": orig_detail["code"],
                    "dest_code": "YVR",
                    "intl": not is_dom,
                    "type": "arr",
                    "terminal": item["terminal"],
                    "gate": item["gate"]
                }
                _dynamic_flight_routes[clean_ident] = route_entry
                if ident_iata:
                    _dynamic_flight_routes[ident_iata] = route_entry
                if len(clean_ident) > 3 and clean_ident[:3] in AIRLINES_INFO:
                    iata_code = AIRLINES_INFO[clean_ident[:3]]["code"]
                    num = clean_ident[3:].lstrip("0") or clean_ident[3:]
                    _dynamic_flight_routes[f"{iata_code}{num}"] = route_entry
                    _dynamic_flight_routes[f"{clean_ident[:3]}{num}"] = route_entry

        departures = []
        for flight in fa_data.get("departures", []) + fa_data.get("scheduled_departures", []):
            ident = flight.get("ident") or flight.get("ident_iata") or "N/A"
            dest_info = flight.get("destination") or {}
            dest_raw_code = (dest_info.get("code_iata") or dest_info.get("code") or dest_info.get("city") or "ARR").upper()
            is_dom = is_canadian_airport(dest_info)
            dest_detail = get_connected_airport_info(dest_raw_code, is_domestic=is_dom)
            orig_detail = AIRPORT_DETAILS["YVR"]
            dest_city = dest_info.get("city") or dest_detail["city"]
            airline_name = flight.get("operator") or (AIRLINES_INFO.get(ident[:3].upper(), {}).get("name") if len(ident) >= 3 else "客運航空")

            dep_t_str = flight.get("estimated_off") or flight.get("scheduled_off") or flight.get("estimated_out")
            dep_display_time = van_now.strftime("%H:%M")
            if dep_t_str:
                try:
                    dep_dt_val = datetime.fromisoformat(dep_t_str.replace("Z", "+00:00"))
                    dep_display_time = dep_dt_val.astimezone(van_now.tzinfo).strftime("%H:%M")
                except Exception:
                    pass

            arr_t_str = flight.get("estimated_on") or flight.get("scheduled_on") or flight.get("estimated_in")
            arr_display_time = "--:--"
            if arr_t_str:
                try:
                    arr_dt_val = datetime.fromisoformat(arr_t_str.replace("Z", "+00:00"))
                    arr_display_time = arr_dt_val.astimezone(van_now.tzinfo).strftime("%H:%M")
                except Exception:
                    pass
            if arr_display_time == "--:--":
                flight_dur = FLIGHT_DURATIONS_HOURS.get(dest_detail["code"], 2.5)
                try:
                    arr_display_time = (datetime.strptime(dep_display_time, "%H:%M") + timedelta(hours=flight_dur)).strftime("%H:%M")
                except Exception:
                    arr_display_time = "18:00"

            route_coords = generate_flight_route_points(orig_detail["coord"], None, dest_detail["coord"])

            item = {
                "id": f"fa_dep_{flight.get('fa_flight_id') or ident}",
                "flight_no": ident,
                "airline": airline_name,
                "category": "domestic" if is_dom else "international",
                "is_domestic": is_dom,
                "flight_type": "dep",
                "origin_code": "YVR",
                "origin_name": orig_detail["name"],
                "origin_city": orig_detail["city"],
                "origin_coord": orig_detail["coord"],
                "dest_code": dest_detail["code"],
                "dest_name": dest_detail["name"],
                "dest_city": dest_detail["city"],
                "dest_coord": dest_detail["coord"],
                "departure_time": dep_display_time,
                "arrival_time": arr_display_time,
                "city": f"Vancouver (YVR) ➔ {dest_city} ({dest_detail['code']})",
                "time": dep_display_time,
                "terminal": flight.get("terminal") or ("國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)"),
                "gate": flight.get("gate") or "--",
                "status": flight.get("status") or "準時",
                "status_code": "scheduled",
                "is_live": False,
                "route_coords": route_coords
            }
            departures.append(item)

            # Accumulate dynamic route for live radar map matching
            clean_ident = ident.replace(" ", "").upper()
            ident_iata = (flight.get("ident_iata") or "").replace(" ", "").upper()
            if clean_ident:
                route_entry = {
                    "city": item["city"],
                    "connected_airport_code": dest_detail["code"],
                    "origin_code": "YVR",
                    "dest_code": dest_detail["code"],
                    "intl": not is_dom,
                    "type": "dep",
                    "terminal": item["terminal"],
                    "gate": item["gate"]
                }
                _dynamic_flight_routes[clean_ident] = route_entry
                if ident_iata:
                    _dynamic_flight_routes[ident_iata] = route_entry
                if len(clean_ident) > 3 and clean_ident[:3] in AIRLINES_INFO:
                    iata_code = AIRLINES_INFO[clean_ident[:3]]["code"]
                    num = clean_ident[3:].lstrip("0") or clean_ident[3:]
                    _dynamic_flight_routes[f"{iata_code}{num}"] = route_entry
                    _dynamic_flight_routes[f"{clean_ident[:3]}{num}"] = route_entry

        # Save accumulated dynamic routes to persistent disk file
        try:
            os.makedirs(os.path.dirname(FLIGHTAWARE_ROUTES_CACHE_FILE), exist_ok=True)
            with open(FLIGHTAWARE_ROUTES_CACHE_FILE, "w", encoding="utf-8") as rf:
                json.dump(_dynamic_flight_routes, rf, ensure_ascii=False)
        except Exception:
            pass

        result = {
            "airport": "YVR",
            "airport_name": "Vancouver International Airport (溫哥華國際機場)",
            "updated_at": van_now.isoformat(),
            "source": "FlightAware AeroAPI (Official)",
            "total_arrivals": len(arrivals),
            "total_departures": len(departures),
            "arrivals": arrivals,
            "departures": departures
        }
        _flightaware_cache["timestamp"] = now_ts
        _flightaware_cache["data"] = result
        print(f"✅ Successfully refreshed FlightAware YVR schedule (Count: {quota_count}/{max_monthly_calls} calls this month).")
        return result
    except Exception as e:
        print(f"Error querying FlightAware AeroAPI: {e}")
        return _flightaware_cache.get("data")

def generate_flight_schedules(live_flights: List[Dict[str, Any]], allow_api_call: bool = False) -> Dict[str, Any]:
    """
    Generates rich, real-time YVR Flight Schedules (Arrivals & Departures) in Vancouver Timezone.
    First tries official FlightAware AeroAPI (with on-demand caching & 480 monthly calls circuit breaker);
    Otherwise seamlessly falls back to OpenSky ADS-B + dynamic route cache database.
    """
    # 1. Try official FlightAware first if API Key is configured
    fa_schedules = fetch_flightaware_schedules(allow_api_call=allow_api_call)
    if fa_schedules:
        # Link live airborne aircraft to FlightAware list
        fa_arr = fa_schedules["arrivals"]
        fa_dep = fa_schedules["departures"]
        
        # Cross-reference live flights with FA schedule (Matching ICAO/IATA callsigns & numbers)
        for f in live_flights:
            f_no_clean = f.get("flight_no", "").replace(" ", "").upper()
            f_cs = (f.get("callsign") or "").replace(" ", "").upper()
            f_raw = f.get("id", "").upper().replace("FLIGHT_", "")
            
            # Extract carrier prefix and digits
            f_digits = "".join(filter(str.isdigit, f_no_clean)) or "".join(filter(str.isdigit, f_cs))
            f_carrier = f_no_clean[:3] if len(f_no_clean) >= 3 and f_no_clean[:3].isalpha() else f_no_clean[:2]
            f_cs_carrier = f_cs[:3] if len(f_cs) >= 3 and f_cs[:3].isalpha() else f_cs[:2]

            for item in fa_arr + fa_dep:
                item_no = item["flight_no"].replace(" ", "").upper()
                item_digits = "".join(filter(str.isdigit, item_no))
                item_carrier = item_no[:3] if len(item_no) >= 3 and item_no[:3].isalpha() else item_no[:2]

                # Match if exact flight_no, or exact callsign, or matching digits + equivalent carrier
                is_match = (
                    (f_cs and item_no == f_cs) or
                    (item_no == f_no_clean) or
                    (item_no == f_raw) or
                    (
                        bool(f_digits and item_digits and f_digits == item_digits) and
                        (
                            are_carriers_equivalent(f_carrier, item_carrier) or
                            are_carriers_equivalent(f_cs_carrier, item_carrier) or
                            (f_carrier and f_carrier in item_no) or
                            (item_carrier and item_carrier in f_no_clean)
                        )
                    )
                )
                if is_match:
                    item["is_live"] = True
                    item["flight_id"] = f["id"]
                    item["lat"] = f["lat"]
                    item["lon"] = f["lon"]
                    item["altitude_ft"] = f["altitude_ft"]
                    item["speed_kts"] = f["speed_kts"]
                    item["bearing"] = f.get("bearing", 0)
                    item["vertical_rate_fpm"] = f.get("vertical_rate_fpm", 0)
                    item["status"] = f["status_badge"]
                    item["status_code"] = f.get("status_code", "cruising")
                    item["origin_code"] = f.get("origin_code") or item.get("origin_code")
                    item["dest_code"] = f.get("dest_code") or item.get("dest_code")
                    item["origin_name"] = f.get("origin_name") or item.get("origin_name")
                    item["dest_name"] = f.get("dest_name") or item.get("dest_name")
                    item["origin_coord"] = f.get("origin_coord") or item.get("origin_coord")
                    item["dest_coord"] = f.get("dest_coord") or item.get("dest_coord")
                    item["departure_time"] = f.get("departure_time") or item.get("departure_time")
                    item["arrival_time"] = f.get("arrival_time") or item.get("arrival_time")
                    item["route_coords"] = f.get("route_coords") or item.get("route_coords")

                    # Feed FlightAware verified route back to live flight on map
                    f["matched_route"] = {
                        "city": item["city"],
                        "connected_airport_code": item.get("origin_code") if item in fa_arr else item.get("dest_code"),
                        "origin_code": item.get("origin_code"),
                        "dest_code": item.get("dest_code"),
                        "intl": not item["is_domestic"],
                        "type": "arr" if item in fa_arr else "dep",
                        "terminal": item["terminal"],
                        "gate": item["gate"]
                    }
        return fa_schedules

    # 2. OpenSky Radar + Authentic Routes Database in Vancouver Local Time
    van_now = get_vancouver_now()
    arrivals = []
    departures = []

    # Process all live in-air planes
    for idx, f in enumerate(live_flights):
        is_dom = f["is_domestic"]
        callsign = f["flight_no"]
        airline = f["airline"]
        is_dep_route = (f.get("flight_type") == "dep")

        entry = {
            "id": f"{'dep' if is_dep_route else 'arr'}_{f['id']}",
            "flight_id": f["id"],
            "flight_no": callsign,
            "airline": airline,
            "category": f["category"],
            "is_domestic": is_dom,
            "flight_type": f.get("flight_type", "dep" if is_dep_route else "arr"),
            "origin_code": f.get("origin_code", "YVR" if is_dep_route else "YYC"),
            "origin_name": f.get("origin_name", ""),
            "origin_city": f.get("origin_city", ""),
            "origin_coord": f.get("origin_coord"),
            "dest_code": f.get("dest_code", "YYC" if is_dep_route else "YVR"),
            "dest_name": f.get("dest_name", ""),
            "dest_city": f.get("dest_city", ""),
            "dest_coord": f.get("dest_coord"),
            "departure_time": f.get("departure_time", van_now.strftime("%H:%M")),
            "arrival_time": f.get("arrival_time", (van_now + timedelta(minutes=25)).strftime("%H:%M")),
            "city": f.get("city", f"{f.get('origin_code')} ➔ {f.get('dest_code')}"),
            "time": f.get("arrival_time" if not is_dep_route else "departure_time", van_now.strftime("%H:%M")),
            "terminal": f.get("terminal", "國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)"),
            "gate": f.get("gate", f"B{(idx % 12) + 12}" if is_dom else f"D{(idx % 15) + 50}"),
            "status": f["status_badge"],
            "status_code": f["status_code"],
            "is_live": True,
            "lat": f["lat"],
            "lon": f["lon"],
            "altitude_ft": f["altitude_ft"],
            "speed_kts": f["speed_kts"],
            "bearing": f.get("bearing", 0),
            "vertical_rate_fpm": f.get("vertical_rate_fpm", 0),
            "route_coords": f.get("route_coords", [])
        }

        if is_dep_route:
            departures.append(entry)
        else:
            arrivals.append(entry)

    # Add standard base upcoming flights in Vancouver Timezone
    base_schedules = [
        # Domestic Arrivals
        {"flight_no": "AC 116", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ 多倫多)", "term": "Domestic", "gate": "C42", "offset_m": 15, "type": "arr"},
        {"flight_no": "WS 706", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC 卡加利)", "term": "Domestic", "gate": "B14", "offset_m": 25, "type": "arr"},
        {"flight_no": "F8 102", "airline": "Flair Airlines (精靈航空)", "is_dom": True, "city": "Edmonton (YEG 艾德蒙頓)", "term": "Domestic", "gate": "A6", "offset_m": 35, "type": "arr"},
        {"flight_no": "8P 108", "airline": "Pacific Coastal (太平洋沿岸)", "is_dom": True, "city": "Victoria (YYJ 維多利亞)", "term": "South Terminal", "gate": "S2", "offset_m": 45, "type": "arr"},
        {"flight_no": "AC 214", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Montreal (YUL 蒙特婁)", "term": "Domestic", "gate": "C38", "offset_m": 55, "type": "arr"},

        # International Arrivals
        {"flight_no": "CX 888", "airline": "Cathay Pacific (國泰航空)", "is_dom": False, "city": "Hong Kong (HKG 香港)", "term": "International", "gate": "D68", "offset_m": 20, "type": "arr"},
        {"flight_no": "BR 10", "airline": "EVA Air (長榮航空)", "is_dom": False, "city": "Taipei (TPE 台北)", "term": "International", "gate": "D53", "offset_m": 30, "type": "arr"},
        {"flight_no": "JL 18", "airline": "Japan Airlines (日本航空)", "is_dom": False, "city": "Tokyo (NRT 成田)", "term": "International", "gate": "D71", "offset_m": 40, "type": "arr"},
        {"flight_no": "UA 1420", "airline": "United Airlines (聯合航空)", "is_dom": False, "city": "San Francisco (SFO 舊金山)", "term": "International", "gate": "E78", "offset_m": 50, "type": "arr"},
        {"flight_no": "BA 85", "airline": "British Airways (英國航空)", "is_dom": False, "city": "London (LHR 倫敦)", "term": "International", "gate": "D64", "offset_m": 60, "type": "arr"},

        # Domestic Departures
        {"flight_no": "AC 125", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ 多倫多)", "term": "Domestic", "gate": "C46", "offset_m": 20, "type": "dep"},
        {"flight_no": "WS 118", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC 卡加利)", "term": "Domestic", "gate": "B19", "offset_m": 35, "type": "dep"},
        {"flight_no": "AC 824", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Ottawa (YOW 渥太華)", "term": "Domestic", "gate": "C35", "offset_m": 50, "type": "dep"},

        # International Departures
        {"flight_no": "AC 63", "airline": "Air Canada (加拿大航空)", "is_dom": False, "city": "Seoul (ICN 首爾)", "term": "International", "gate": "D52", "offset_m": 10, "type": "dep"},
        {"flight_no": "CI 31", "airline": "China Airlines (中華航空)", "is_dom": False, "city": "Taipei (TPE 台北)", "term": "International", "gate": "D55", "offset_m": 25, "type": "dep"},
        {"flight_no": "NH 115", "airline": "All Nippon Airways (全日空)", "is_dom": False, "city": "Tokyo (HND 羽田)", "term": "International", "gate": "D72", "offset_m": 45, "type": "dep"},
        {"flight_no": "DL 1980", "airline": "Delta Air Lines (達美航空)", "is_dom": False, "city": "Seattle (SEA 西雅圖)", "term": "International", "gate": "E82", "offset_m": 55, "type": "dep"},
    ]

    for item in base_schedules:
        # Check if already in live
        target_list = departures if item["type"] == "dep" else arrivals
        if any(f["flight_no"].replace(" ", "") == item["flight_no"].replace(" ", "") for f in target_list):
            continue

        item_dt = van_now + timedelta(minutes=item["offset_m"])
        time_str = item_dt.strftime("%H:%M")

        other_airport = get_airport_info(item["city"])
        yvr_airport = AIRPORT_DETAILS["YVR"]
        flight_dur = FLIGHT_DURATIONS_HOURS.get(other_airport["code"], 2.5)

        if item["type"] == "arr":
            orig_info = other_airport
            dest_info = yvr_airport
            arr_time_str = time_str
            dep_time_str = (item_dt - timedelta(hours=flight_dur)).strftime("%H:%M")
        else:
            orig_info = yvr_airport
            dest_info = other_airport
            dep_time_str = time_str
            arr_time_str = (item_dt + timedelta(hours=flight_dur)).strftime("%H:%M")

        route_coords = generate_flight_route_points(orig_info["coord"], None, dest_info["coord"])

        sched_entry = {
            "id": f"sched_{item['flight_no'].replace(' ', '_')}_{item['type']}",
            "flight_no": item["flight_no"],
            "airline": item["airline"],
            "category": "domestic" if item["is_dom"] else "international",
            "is_domestic": item["is_dom"],
            "flight_type": item["type"],
            "origin_code": orig_info["code"],
            "origin_name": orig_info["name"],
            "origin_city": orig_info["city"],
            "origin_coord": orig_info["coord"],
            "dest_code": dest_info["code"],
            "dest_name": dest_info["name"],
            "dest_city": dest_info["city"],
            "dest_coord": dest_info["coord"],
            "departure_time": dep_time_str,
            "arrival_time": arr_time_str,
            "city": f"{orig_info['city']} ➔ {dest_info['city']}",
            "time": time_str,
            "terminal": "國內線航廈 (Domestic)" if item["is_dom"] else "國際線航廈 (International)",
            "gate": item["gate"],
            "status": "準時 (On Time)",
            "status_code": "on_time",
            "is_live": False,
            "route_coords": route_coords
        }

        if item["type"] == "arr":
            arrivals.append(sched_entry)
        else:
            departures.append(sched_entry)

    # Sort strictly by time
    arrivals.sort(key=lambda x: x["time"])
    departures.sort(key=lambda x: x["time"])

    return {
        "airport": "YVR",
        "airport_name": "Vancouver International Airport (溫哥華國際機場)",
        "updated_at": van_now.isoformat(),
        "timezone": "America/Vancouver (PDT/PST)",
        "total_arrivals": len(arrivals),
        "total_departures": len(departures),
        "arrivals": arrivals,
        "departures": departures
    }
