import os
import json
import requests
import time
import math
import calendar
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

# Quota file and Dynamic Routes cache for FlightAware
FLIGHTAWARE_QUOTA_FILE = os.path.join(os.path.dirname(__file__), "data", "flightaware_quota.json")
FLIGHTAWARE_ROUTES_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "flightaware_routes_cache.json")

# In-memory cache for FlightAware responses (Plan B: 90-minute cache TTL = 5400s)
CACHE_TTL_SECONDS = 5400  # 90 minutes (1.5 hours) per update round
_flightaware_cache = {
    "timestamp": 0,
    "data": None
}

# Dynamic route mapping accumulated and persisted permanently from FlightAware
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
    # Canada Major Hubs & Regional BC / Prairie / East
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
    "YXX": {"code": "YXX", "name": "Abbotsford International (阿伯茨福德機場)", "city": "Abbotsford (阿伯茨福德)", "country": "Canada", "coord": [-122.3600, 49.0253]},
    "YXT": {"code": "YXT", "name": "Northwest Regional Terrace (特勒斯機場)", "city": "Terrace (特勒斯)", "country": "Canada", "coord": [-128.5761, 54.4686]},
    "YPR": {"code": "YPR", "name": "Prince Rupert Airport (魯珀特王子城機場)", "city": "Prince Rupert (魯珀特王子城)", "country": "Canada", "coord": [-130.4447, 54.2861]},
    "YCG": {"code": "YCG", "name": "West Kootenay Castlegar (卡斯爾加機場)", "city": "Castlegar (卡斯爾加)", "country": "Canada", "coord": [-117.6325, 49.2964]},
    "YXY": {"code": "YXY", "name": "Whitehorse Airport (白馬市機場)", "city": "Whitehorse (白馬市)", "country": "Canada", "coord": [-135.0672, 60.7094]},
    "YZF": {"code": "YZF", "name": "Yellowknife Airport (黃刀鎮機場)", "city": "Yellowknife (黃刀鎮)", "country": "Canada", "coord": [-114.4403, 62.4628]},
    "YHZ": {"code": "YHZ", "name": "Halifax Stanfield (哈利法克斯機場)", "city": "Halifax (哈利法克斯)", "country": "Canada", "coord": [-63.5086, 44.8808]},
    "YQB": {"code": "YQB", "name": "Québec City Jean Lesage (魁北克市機場)", "city": "Quebec City (魁北克市)", "country": "Canada", "coord": [-71.3933, 46.7911]},
    "YQR": {"code": "YQR", "name": "Regina International (雷吉納機場)", "city": "Regina (雷吉納)", "country": "Canada", "coord": [-104.6658, 50.4319]},
    "YXE": {"code": "YXE", "name": "Saskatoon Airport (薩斯卡通機場)", "city": "Saskatoon (薩斯卡通)", "country": "Canada", "coord": [-106.7000, 52.1708]},
    "CXH": {"code": "CXH", "name": "Vancouver Harbour Seaplane (溫哥華港水上飛機場)", "city": "Vancouver Harbour (水上港)", "country": "Canada", "coord": [-123.1167, 49.2889]},
    "YWH": {"code": "YWH", "name": "Victoria Inner Harbour (維多利亞內港水上機場)", "city": "Victoria Harbour (水上港)", "country": "Canada", "coord": [-123.3686, 48.4239]},
    
    # US & Transborder Hubs
    "SEA": {"code": "SEA", "name": "Seattle-Tacoma (西雅圖塔科馬機場)", "city": "Seattle (西雅圖)", "country": "USA", "coord": [-122.3088, 47.4502]},
    "SFO": {"code": "SFO", "name": "San Francisco International (舊金山國際機場)", "city": "San Francisco (舊金山)", "country": "USA", "coord": [-122.3790, 37.6213]},
    "LAX": {"code": "LAX", "name": "Los Angeles International (洛杉磯國際機場)", "city": "Los Angeles (洛杉磯)", "country": "USA", "coord": [-118.4085, 33.9416]},
    "PDX": {"code": "PDX", "name": "Portland International (波特蘭國際機場)", "city": "Portland (波特蘭)", "country": "USA", "coord": [-122.5975, 45.5898]},
    "SAN": {"code": "SAN", "name": "San Diego International (聖地牙哥國際機場)", "city": "San Diego (聖地牙哥)", "country": "USA", "coord": [-117.1897, 32.7338]},
    "PSP": {"code": "PSP", "name": "Palm Springs International (棕櫚泉國際機場)", "city": "Palm Springs (棕櫚泉)", "country": "USA", "coord": [-116.5067, 33.8297]},
    "LAS": {"code": "LAS", "name": "Harry Reid Las Vegas (拉斯維加斯國際機場)", "city": "Las Vegas (拉斯維加斯)", "country": "USA", "coord": [-115.1537, 36.0840]},
    "PHX": {"code": "PHX", "name": "Phoenix Sky Harbor (鳳凰城天港國際機場)", "city": "Phoenix (鳳凰城)", "country": "USA", "coord": [-112.0080, 33.4373]},
    "DEN": {"code": "DEN", "name": "Denver International (丹佛國際機場)", "city": "Denver (丹佛)", "country": "USA", "coord": [-104.6737, 39.8561]},
    "SLC": {"code": "SLC", "name": "Salt Lake City (鹽湖城國際機場)", "city": "Salt Lake City (鹽湖城)", "country": "USA", "coord": [-111.9778, 40.7884]},
    "DFW": {"code": "DFW", "name": "Dallas/Fort Worth (達拉斯沃斯堡機場)", "city": "Dallas (達拉斯)", "country": "USA", "coord": [-97.0403, 32.8998]},
    "IAH": {"code": "IAH", "name": "Houston George Bush (休士頓機場)", "city": "Houston (休士頓)", "country": "USA", "coord": [-95.3414, 29.9844]},
    "ORD": {"code": "ORD", "name": "Chicago O'Hare (芝加哥奧黑爾國際機場)", "city": "Chicago (芝加哥)", "country": "USA", "coord": [-87.9073, 41.9742]},
    "MSP": {"code": "MSP", "name": "Minneapolis-Saint Paul (明尼阿波利斯機場)", "city": "Minneapolis (明尼阿波利斯)", "country": "USA", "coord": [-93.2218, 44.8848]},
    "ATL": {"code": "ATL", "name": "Atlanta Hartsfield-Jackson (亞特蘭大機場)", "city": "Atlanta (亞特蘭大)", "country": "USA", "coord": [-84.4277, 33.6407]},
    "BOS": {"code": "BOS", "name": "Boston Logan (波士頓機場)", "city": "Boston (波士頓)", "country": "USA", "coord": [-71.0096, 42.3656]},
    "JFK": {"code": "JFK", "name": "John F. Kennedy (紐約甘迺迪機場)", "city": "New York (紐約)", "country": "USA", "coord": [-73.7781, 40.6413]},
    "EWR": {"code": "EWR", "name": "Newark Liberty (紐瓦克機場)", "city": "Newark (紐瓦克)", "country": "USA", "coord": [-74.1686, 40.6895]},
    "HNL": {"code": "HNL", "name": "Daniel K. Inouye (檀香山國際機場)", "city": "Honolulu (檀香山)", "country": "USA", "coord": [-157.9224, 21.3187]},
    "OGG": {"code": "OGG", "name": "Kahului Airport (茂宜島卡胡盧伊機場)", "city": "Maui (茂宜島)", "country": "USA", "coord": [-156.4305, 20.8986]},
    "KOA": {"code": "KOA", "name": "Ellison Onizuka Kona (科納國際機場)", "city": "Kona (夏威夷科納)", "country": "USA", "coord": [-156.0456, 19.7388]},
    "ANC": {"code": "ANC", "name": "Anchorage International (安克拉治機場)", "city": "Anchorage (安克拉治)", "country": "USA", "coord": [-149.9964, 61.1744]},
    "CUN": {"code": "CUN", "name": "Cancun International (坎昆國際機場)", "city": "Cancun (坎昆)", "country": "Mexico", "coord": [-86.8770, 21.0365]},
    "PVR": {"code": "PVR", "name": "Puerto Vallarta (巴亞爾塔港國際機場)", "city": "Puerto Vallarta (巴亞爾塔港)", "country": "Mexico", "coord": [-105.2542, 20.6801]},
    "SJD": {"code": "SJD", "name": "Los Cabos International (洛斯卡波斯機場)", "city": "Los Cabos (洛斯卡波斯)", "country": "Mexico", "coord": [-109.7211, 23.1518]},
    "MEX": {"code": "MEX", "name": "Mexico City International (墨西哥城機場)", "city": "Mexico City (墨西哥城)", "country": "Mexico", "coord": [-99.0721, 19.4361]},

    # Europe
    "ZRH": {"code": "ZRH", "name": "Zurich Airport (蘇黎世機場)", "city": "Zurich (蘇黎世)", "country": "Switzerland", "coord": [8.5492, 47.4582]},
    "MUC": {"code": "MUC", "name": "Munich Airport (慕尼黑機場)", "city": "Munich (慕尼黑)", "country": "Germany", "coord": [11.7861, 48.3537]},
    "FRA": {"code": "FRA", "name": "Frankfurt Airport (法蘭克福機場)", "city": "Frankfurt (法蘭克福)", "country": "Germany", "coord": [8.5706, 50.0379]},
    "LHR": {"code": "LHR", "name": "London Heathrow (倫敦希斯洛機場)", "city": "London (倫敦希斯洛)", "country": "UK", "coord": [-0.4543, 51.4700]},
    "LGW": {"code": "LGW", "name": "London Gatwick (倫敦蓋威克機場)", "city": "London Gatwick (倫敦蓋威克)", "country": "UK", "coord": [-0.1903, 51.1537]},
    "CDG": {"code": "CDG", "name": "Paris Charles de Gaulle (巴黎戴高樂機場)", "city": "Paris (巴黎戴高樂)", "country": "France", "coord": [2.5479, 49.0097]},
    "AMS": {"code": "AMS", "name": "Amsterdam Schiphol (阿姆斯特丹史基浦機場)", "city": "Amsterdam (阿姆斯特丹)", "country": "Netherlands", "coord": [4.7683, 52.3105]},
    "DUB": {"code": "DUB", "name": "Dublin Airport (都柏林機場)", "city": "Dublin (都柏林)", "country": "Ireland", "coord": [-6.2701, 53.4264]},
    "KEF": {"code": "KEF", "name": "Keflavik International (雷克雅維克機場)", "city": "Reykjavik (雷克雅維克)", "country": "Iceland", "coord": [-22.6056, 63.9850]},
    "FCO": {"code": "FCO", "name": "Rome Fiumicino (羅馬菲烏米奇諾機場)", "city": "Rome (羅馬)", "country": "Italy", "coord": [12.2389, 41.8003]},
    "BCN": {"code": "BCN", "name": "Barcelona-El Prat (巴塞隆納機場)", "city": "Barcelona (巴塞隆納)", "country": "Spain", "coord": [2.0785, 41.2974]},

    # Asia, Middle East & Pacific
    "TPE": {"code": "TPE", "name": "Taiwan Taoyuan (台灣桃園國際機場)", "city": "Taipei (台北)", "country": "Taiwan", "coord": [121.2328, 25.0797]},
    "HKG": {"code": "HKG", "name": "Hong Kong International (香港赤鱲角機場)", "city": "Hong Kong (香港)", "country": "Hong Kong", "coord": [113.9185, 22.3080]},
    "NRT": {"code": "NRT", "name": "Narita International (東京成田國際機場)", "city": "Tokyo Narita (東京成田)", "country": "Japan", "coord": [140.3929, 35.7720]},
    "HND": {"code": "HND", "name": "Tokyo Haneda (東京羽田國際機場)", "city": "Tokyo Haneda (東京羽田)", "country": "Japan", "coord": [139.7798, 35.5494]},
    "KIX": {"code": "KIX", "name": "Kansai International (大阪關西國際機場)", "city": "Osaka (大阪)", "country": "Japan", "coord": [135.2304, 34.4347]},
    "ICN": {"code": "ICN", "name": "Incheon International (首爾仁川國際機場)", "city": "Seoul (首爾仁川)", "country": "South Korea", "coord": [126.4407, 37.4602]},
    "PVG": {"code": "PVG", "name": "Shanghai Pudong (上海浦東國際機場)", "city": "Shanghai (上海浦東)", "country": "China", "coord": [121.8052, 31.1443]},
    "PEK": {"code": "PEK", "name": "Beijing Capital (北京首都國際機場)", "city": "Beijing (北京首都)", "country": "China", "coord": [116.5975, 40.0801]},
    "CAN": {"code": "CAN", "name": "Guangzhou Baiyun (廣州白雲國際機場)", "city": "Guangzhou (廣州)", "country": "China", "coord": [113.2988, 23.3924]},
    "XMN": {"code": "XMN", "name": "Xiamen Gaoqi (廈門高崎國際機場)", "city": "Xiamen (廈門)", "country": "China", "coord": [118.1278, 24.5440]},
    "DEL": {"code": "DEL", "name": "Indira Gandhi (德里英迪拉甘地機場)", "city": "Delhi (德里)", "country": "India", "coord": [77.1000, 28.5562]},
    "SIN": {"code": "SIN", "name": "Singapore Changi (新加坡樟宜機場)", "city": "Singapore (新加坡)", "country": "Singapore", "coord": [103.9915, 1.3644]},
    "MNL": {"code": "MNL", "name": "Manila Ninoy Aquino (馬尼拉國際機場)", "city": "Manila (馬尼拉)", "country": "Philippines", "coord": [121.0194, 14.5086]},
    "BKK": {"code": "BKK", "name": "Bangkok Suvarnabhumi (曼谷蘇凡納布機場)", "city": "Bangkok (曼谷)", "country": "Thailand", "coord": [100.7501, 13.6900]},
    "SYD": {"code": "SYD", "name": "Sydney Kingsford Smith (雪梨金斯福德機場)", "city": "Sydney (雪梨)", "country": "Australia", "coord": [151.1772, -33.9461]},
    "BNE": {"code": "BNE", "name": "Brisbane Airport (布里斯本國際機場)", "city": "Brisbane (布里斯本)", "country": "Australia", "coord": [153.1175, -27.3842]},
    "MEL": {"code": "MEL", "name": "Melbourne Airport (墨爾本機場)", "city": "Melbourne (墨爾本)", "country": "Australia", "coord": [144.8433, -37.6733]},
    "AKL": {"code": "AKL", "name": "Auckland Airport (奧克蘭國際機場)", "city": "Auckland (奧克蘭)", "country": "New Zealand", "coord": [174.7922, -37.0082]},
    "DXB": {"code": "DXB", "name": "Dubai International (杜拜國際機場)", "city": "Dubai (杜拜)", "country": "UAE", "coord": [55.3644, 25.2532]},
}

AIRPORT_COORDS = {code: info["coord"] for code, info in AIRPORT_DETAILS.items()}

ICAO_TO_IATA = {
    "LSZH": "ZRH", "EDDM": "MUC", "EDDF": "FRA", "EGLL": "LHR", "EGKK": "LGW",
    "LFPG": "CDG", "EHAM": "AMS", "EIDW": "DUB", "BIKF": "KEF", "LIRF": "FCO",
    "LEBL": "BCN", "RCTP": "TPE", "VHHH": "HKG", "RJAA": "NRT", "RJTT": "HND",
    "RJBB": "KIX", "RKSI": "ICN", "ZSPD": "PVG", "ZBAA": "PEK", "ZGGG": "CAN",
    "ZSAM": "XMN", "VIDP": "DEL", "WSSS": "SIN", "RPLL": "MNL", "VTBS": "BKK",
    "YSSY": "SYD", "YBBN": "BNE", "YMML": "MEL", "NZAA": "AKL", "OMDB": "DXB",
    "MMUN": "CUN", "MMPR": "PVR", "MMSD": "SJD", "MMMX": "MEX", "PHNL": "HNL",
    "PHOG": "OGG", "PHKO": "KOA", "PANC": "ANC"
}

for _k, _v in list(AIRPORT_COORDS.items()):
    if len(_k) == 3:
        if _k in ("YVR", "YYZ", "YYC", "YEG", "YUL", "YOW", "YYJ", "YLW", "YWG", "YCD", "YQQ", "YXS", "YKA", "YXX", "YXT", "YPR", "YCG", "YXY", "YZF", "YHZ", "YQB", "YQR", "YXE"):
            AIRPORT_COORDS[f"C{_k}"] = _v
        elif _k in ("SEA", "SFO", "LAX", "PDX", "SAN", "PSP", "LAS", "PHX", "DEN", "SLC", "DFW", "IAH", "ORD", "MSP", "ATL", "BOS", "JFK", "EWR"):
            AIRPORT_COORDS[f"K{_k}"] = _v
for _icao, _iata in ICAO_TO_IATA.items():
    if _iata in AIRPORT_COORDS:
        AIRPORT_COORDS[_icao] = AIRPORT_COORDS[_iata]

FLIGHT_DURATIONS_HOURS = {
    "YYJ": 0.5, "YCD": 0.4, "CXH": 0.5, "YWH": 0.5, "YXX": 0.4,
    "YLW": 0.9, "YKA": 0.8, "YQQ": 0.7, "YXS": 1.2, "YCG": 1.1,
    "YXT": 1.5, "YPR": 1.6, "YXY": 2.4, "YZF": 2.6,
    "YYC": 1.4, "YEG": 1.5, "YWG": 2.8, "YQR": 2.1, "YXE": 2.0,
    "YYZ": 4.5, "YUL": 4.8, "YOW": 4.6, "YHZ": 5.8, "YQB": 5.2,
    "SEA": 0.8, "PDX": 1.1, "SFO": 2.2, "LAX": 2.8, "SAN": 2.9, "PSP": 2.8,
    "LAS": 2.6, "PHX": 3.0, "DEN": 2.7, "SLC": 2.1, "DFW": 4.0, "IAH": 4.3,
    "ORD": 4.1, "MSP": 3.4, "ATL": 4.8, "BOS": 5.2, "JFK": 5.2, "EWR": 5.2,
    "HNL": 5.8, "OGG": 5.9, "KOA": 5.9, "ANC": 3.4,
    "CUN": 5.5, "PVR": 4.8, "SJD": 4.4, "MEX": 5.0,
    "ZRH": 10.5, "MUC": 10.5, "FRA": 10.2, "LHR": 9.5, "LGW": 9.5, "CDG": 10.0,
    "AMS": 9.8, "DUB": 9.2, "KEF": 7.5, "FCO": 11.5, "BCN": 11.2,
    "NRT": 10.0, "HND": 10.0, "KIX": 10.5, "ICN": 11.0, "TPE": 11.5,
    "PVG": 12.0, "PEK": 11.5, "CAN": 12.5, "XMN": 12.5, "HKG": 13.0, "DEL": 14.5,
    "SIN": 15.5, "MNL": 13.5, "BKK": 14.5, "DXB": 14.5,
    "SYD": 15.0, "BNE": 14.5, "MEL": 15.5, "AKL": 14.0
}

def get_airport_info(code_or_text: str) -> Dict[str, Any]:
    """Resolves airport code (IATA or ICAO) or city text into canonical airport details."""
    if not code_or_text:
        return AIRPORT_DETAILS["YYC"]
    
    clean = str(code_or_text).strip().upper()
    if clean in AIRPORT_DETAILS:
        return AIRPORT_DETAILS[clean]
    
    if clean in ICAO_TO_IATA and ICAO_TO_IATA[clean] in AIRPORT_DETAILS:
        return AIRPORT_DETAILS[ICAO_TO_IATA[clean]]
    if len(clean) == 4:
        if clean.startswith("C") and clean[1:] in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean[1:]]
        if clean.startswith("K") and clean[1:] in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean[1:]]

    for key, info in AIRPORT_DETAILS.items():
        if f"({key})" in clean or f"({key} " in clean or key == clean[:3]:
            return info
        city_keyword = info["city"].split()[0].upper()
        if city_keyword in clean:
            return info
            
    fallback_code = clean[:3] if len(clean) >= 3 else "DEST"
    return {
        "code": fallback_code,
        "name": f"{code_or_text} 機場",
        "city": code_or_text,
        "country": "International",
        "coord": [-123.1815, 49.1967]
    }

def get_connected_airport_info(
    code_or_text: str,
    is_domestic: bool = True,
    hint: int = 0,
    fallback_city: str | None = None,
    fallback_code: str | None = None
) -> Dict[str, Any]:
    """Resolves non-YVR partner airport from a route description, city name, or airport code."""
    dom_fallback = ["YYC", "YYZ", "YEG", "YUL", "YYJ", "YLW", "YWG"]
    intl_fallback = ["SEA", "SFO", "LAX", "ICN", "NRT", "TPE", "HKG", "LHR", "ZRH", "MUC"]
    fallback_list = dom_fallback if is_domestic else intl_fallback

    if fallback_code:
        f_clean = str(fallback_code).strip().upper()
        if f_clean not in ("YVR", "CYVR", "ARR", "DEP", "N/A", ""):
            if f_clean in ICAO_TO_IATA:
                f_clean = ICAO_TO_IATA[f_clean]
            elif len(f_clean) == 4:
                if f_clean.startswith("K") and f_clean[1:] in AIRPORT_DETAILS:
                    f_clean = f_clean[1:]
                elif f_clean.startswith("C") and f_clean[1:] in AIRPORT_DETAILS and f_clean[1:] != "YVR":
                    f_clean = f_clean[1:]

            if f_clean in AIRPORT_DETAILS and f_clean != "YVR":
                return AIRPORT_DETAILS[f_clean]

            coord = AIRPORT_COORDS.get(f_clean, [8.5492, 47.4582] if not is_domestic else [-114.0076, 51.1215])
            city_display = fallback_city or f_clean
            return {
                "code": f_clean,
                "name": f"{city_display} 機場",
                "city": city_display,
                "country": "Canada" if is_domestic else "International",
                "coord": coord
            }

    raw = str(code_or_text or "").strip()
    upper_raw = raw.upper()

    if "➔" in upper_raw or "->" in upper_raw:
        sep = "➔" if "➔" in upper_raw else "->"
        parts = [p.strip() for p in upper_raw.split(sep)]
        non_yvr_parts = [p for p in parts if "YVR" not in p and "CYVR" not in p]
        if non_yvr_parts:
            upper_raw = non_yvr_parts[0]

    clean_code = upper_raw.strip()
    if clean_code in ICAO_TO_IATA and ICAO_TO_IATA[clean_code] != "YVR":
        clean_code = ICAO_TO_IATA[clean_code]

    if clean_code not in ("YVR", "CYVR", "ARR", "DEP", "N/A", ""):
        if clean_code in AIRPORT_DETAILS:
            return AIRPORT_DETAILS[clean_code]
        if len(clean_code) == 4:
            if clean_code.startswith("C") and clean_code[1:] in AIRPORT_DETAILS and clean_code[1:] != "YVR":
                return AIRPORT_DETAILS[clean_code[1:]]
            if clean_code.startswith("K") and clean_code[1:] in AIRPORT_DETAILS:
                return AIRPORT_DETAILS[clean_code[1:]]

    for key, info in AIRPORT_DETAILS.items():
        if key in ("YVR", "CYVR"):
            continue
        if f"({key})" in upper_raw or f"({key} " in upper_raw or f" {key} " in f" {upper_raw} ":
            return info
        city_keyword = info["city"].split()[0].upper()
        if len(city_keyword) >= 3 and city_keyword in upper_raw:
            return info

    if fallback_city:
        fb_upper = fallback_city.strip().upper()
        for key, info in AIRPORT_DETAILS.items():
            if key in ("YVR", "CYVR"): continue
            city_keyword = info["city"].split()[0].upper()
            if city_keyword in fb_upper or fb_upper in city_keyword:
                return info

    return AIRPORT_DETAILS[fallback_list[hint % len(fallback_list)]]

def generate_flight_route_points(origin_coord: List[float], plane_coord: List[float] | None, dest_coord: List[float]) -> List[List[float]]:
    """
    Generates smooth, realistic Great Circle flight path coordinates connecting:
    origin_coord -> dest_coord
    All coordinates are strictly normalized to [-180, 180].
    """
    lon1, lat1 = origin_coord
    lon2, lat2 = dest_coord
    diff_lon = lon2 - lon1
    if diff_lon > 180:
        lon2 -= 360
    elif diff_lon < -180:
        lon2 += 360

    count = 14
    pts = []
    for step in range(count + 1):
        f = step / float(count)
        c_lon = lon1 + f * (lon2 - lon1)
        c_lat = lat1 + f * (lat2 - lat1)
        span = abs(lon2 - lon1)
        if span > 15:
            bulge = math.sin(f * math.pi) * min(10.0, span * 0.08)
            c_lat = min(75.0, c_lat + bulge)

        norm_lon = c_lon
        while norm_lon > 180: norm_lon -= 360
        while norm_lon < -180: norm_lon += 360
        pts.append([round(norm_lon, 4), round(c_lat, 4)])
    return pts

AIRLINES_INFO = {
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
    "QXE": {"name": "Horizon Air / Alaska (阿拉斯加地平線)", "short": "Alaska Horizon", "code": "AS", "domestic": False},
    "ASA": {"name": "Alaska Airlines (阿拉斯加航空)", "short": "阿拉斯加", "code": "AS", "domestic": False},
    "DAL": {"name": "Delta Air Lines (達美航空)", "short": "達美", "code": "DL", "domestic": False},
    "UAL": {"name": "United Airlines (聯合航空)", "short": "聯航", "code": "UA", "domestic": False},
    "AAL": {"name": "American Airlines (美國航空)", "short": "美航", "code": "AA", "domestic": False},
    "SKW": {"name": "SkyWest Airlines (天西航空)", "short": "SkyWest", "code": "OO", "domestic": False},
    "SWA": {"name": "Southwest Airlines (西南航空)", "short": "西南", "code": "WN", "domestic": False},
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
    "EDW": {"name": "Edelweiss Air (瑞士雪絨花航空)", "short": "雪絨花航空", "code": "WK", "domestic": False},
    "ICE": {"name": "Icelandair (冰島航空)", "short": "冰島航空", "code": "FI", "domestic": False},
    "BAW": {"name": "British Airways (英國航空)", "short": "英航", "code": "BA", "domestic": False},
    "AFR": {"name": "Air France (法國航空)", "short": "法航", "code": "AF", "domestic": False},
    "KLM": {"name": "KLM Royal Dutch Airlines (荷蘭皇家航空)", "short": "荷航", "code": "KL", "domestic": False},
    "DLH": {"name": "Lufthansa (德國漢莎航空)", "short": "漢莎", "code": "LH", "domestic": False},
    "ANZ": {"name": "Air New Zealand (紐西蘭航空)", "short": "紐航", "code": "NZ", "domestic": False},
    "QFA": {"name": "Qantas (澳洲航空)", "short": "澳航", "code": "QF", "domestic": False},
    "AMX": {"name": "Aeromexico (墨西哥航空)", "short": "墨航", "code": "AM", "domestic": False},
}

def calculate_remaining_time(target_dt: datetime, now_dt: datetime, is_arr: bool = True) -> Tuple[str, str, int]:
    """Calculates humanized remaining time to landing or departure in Vancouver time."""
    diff_sec = (target_dt - now_dt).total_seconds()
    diff_min = int(diff_sec / 60)

    if diff_min < -15:
        return ("已降落" if is_arr else "已起飛", "past", diff_min)
    elif -15 <= diff_min <= 0:
        return ("即將降落" if is_arr else "即將起飛", "landing" if is_arr else "boarding", diff_min)
    elif 0 < diff_min <= 30:
        return (f"剩餘 {diff_min} 分鐘", "approaching" if is_arr else "scheduled", diff_min)
    elif 30 < diff_min < 60:
        return (f"約 {diff_min} 分鐘", "approaching" if is_arr else "scheduled", diff_min)
    elif 60 <= diff_min < 1440:
        h = diff_min // 60
        m = diff_min % 60
        text = f"約 {h} 小時 {m} 分" if m > 0 else f"約 {h} 小時"
        return (text, "en_route" if is_arr else "scheduled", diff_min)
    else:
        d = diff_min // 1440
        return (f"約 {d} 天後", "scheduled", diff_min)

def fetch_flightaware_schedules(allow_api_call: bool = True) -> Dict[str, Any]:
    """
    Fetches official YVR arrivals and departures from FlightAware AeroAPI (Plan B: Separate Scheduled Endpoints).
    Strictly protected with:
    1. 90-minute in-memory cache (5400 seconds) for 16 rounds/day in 30-day months, 15 rounds/day in 31-day months.
    2. 480-round monthly hard limit (safety buffer: 480 rounds * $0.010 = $4.80 USD < $5.00 limit).
    3. Auto-detection of month length (31-day month: 15 rounds/day; 30-day month: 16 rounds/day, skipping late night).
    4. Persistent disk storage of quota usage and parsed routes.
    5. Automatically excludes past flights (< -15 mins) and sorts upcoming flights chronologically.
    """
    global _dynamic_flight_routes
    now_ts = time.time()
    van_now = get_vancouver_now()
    current_month = van_now.strftime("%Y-%m")
    today_str = van_now.strftime("%Y-%m-%d")

    # Days in current month (e.g. 30 or 31)
    days_in_month = calendar.monthrange(van_now.year, van_now.month)[1]
    # Daily ceiling: 15 rounds for 31-day months (15 * 31 = 465 rounds = $4.65), 16 rounds for 30-day months (16 * 30 = 480 rounds = $4.80)
    max_daily_rounds = 15 if days_in_month >= 31 else 16
    max_monthly_rounds = int(os.getenv("FLIGHTAWARE_MAX_MONTHLY_ROUNDS") or os.getenv("FLIGHTAWARE_MAX_MONTHLY_CALLS") or "480")

    # 1. Check in-memory cache (90 minutes)
    if _flightaware_cache["data"] and (now_ts - _flightaware_cache["timestamp"] < CACHE_TTL_SECONDS):
        return _flightaware_cache["data"]

    api_key = get_flightaware_api_key()
    month_rounds = 0
    today_rounds = 0

    try:
        if os.path.exists(FLIGHTAWARE_QUOTA_FILE):
            with open(FLIGHTAWARE_QUOTA_FILE, "r", encoding="utf-8") as f:
                q_data = json.load(f)
                if q_data.get("month") == current_month:
                    month_rounds = q_data.get("month_rounds") or q_data.get("count", 0)
                if q_data.get("today") == today_str:
                    today_rounds = q_data.get("today_rounds", 0)
    except Exception:
        pass

    # 31-day month late-night skip: YVR has virtually no commercial flights arriving/departing between 02:00 AM and 05:00 AM.
    # On 31-day months, skip queries during 02:00-05:00 AM to conserve quota for the 15-round limit.
    is_late_night = (van_now.hour in (2, 3, 4))
    night_skip = (days_in_month >= 31 and is_late_night and today_rounds >= 1)

    # Circuit breaker check: Strictly block external queries if quota >= 480 or daily ceiling reached
    if (not api_key or 
        month_rounds >= max_monthly_rounds or 
        today_rounds >= max_daily_rounds or 
        night_skip or 
        not allow_api_call):
        if month_rounds >= max_monthly_rounds:
            print(f"⚠️ FlightAware Monthly Quota Circuit Breaker active ({month_rounds}/{max_monthly_rounds} rounds). Using verified cache & fallback.")
        elif today_rounds >= max_daily_rounds:
            print(f"ℹ️ FlightAware Daily Quota ceiling reached ({today_rounds}/{max_daily_rounds} rounds today). Using cache & fallback.")
        elif night_skip:
            print(f"🌙 FlightAware Late-night quota conservation active (02:00-05:00 AM in 31-day month). Using cache & fallback.")
        return _flightaware_cache["data"] or _generate_fallback_schedules(van_now)

    try:
        headers = {"x-apikey": api_key, "User-Agent": "VancouverGodsEye/1.0"}
        arr_url = "https://aeroapi.flightaware.com/aeroapi/airports/CYVR/flights/scheduled_arrivals?max_pages=1"
        dep_url = "https://aeroapi.flightaware.com/aeroapi/airports/CYVR/flights/scheduled_departures?max_pages=1"

        arr_resp = requests.get(arr_url, headers=headers, timeout=10)
        dep_resp = requests.get(dep_url, headers=headers, timeout=10)

        if arr_resp.status_code != 200 and dep_resp.status_code != 200:
            print(f"FlightAware API error status: arr={arr_resp.status_code}, dep={dep_resp.status_code}. Using fallback schedules.")
            return _flightaware_cache["data"] or _generate_fallback_schedules(van_now)

        # Increment quota tracker on successful round ($0.005 + $0.005 = $0.010 USD)
        month_rounds += 1
        today_rounds += 1
        os.makedirs(os.path.dirname(FLIGHTAWARE_QUOTA_FILE), exist_ok=True)
        with open(FLIGHTAWARE_QUOTA_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "month": current_month,
                "month_rounds": month_rounds,
                "today": today_str,
                "today_rounds": today_rounds,
                "max_daily_rounds": max_daily_rounds,
                "max_monthly_rounds": max_monthly_rounds,
                "cost_per_round_usd": 0.010,
                "estimated_monthly_cost_usd": round(month_rounds * 0.010, 3),
                "last_call": datetime.now(timezone.utc).isoformat()
            }, f, indent=2)

        arr_data = arr_resp.json() if arr_resp.status_code == 200 else {}
        dep_data = dep_resp.json() if dep_resp.status_code == 200 else {}

        raw_arrivals = arr_data.get("scheduled_arrivals", []) + arr_data.get("arrivals", [])
        arrivals = []
        for flight in raw_arrivals:
            ident = flight.get("ident") or flight.get("ident_iata") or "N/A"
            origin_info = flight.get("origin") or {}
            orig_raw_code = (origin_info.get("code_iata") or origin_info.get("code") or origin_info.get("city") or "DEP").upper()
            real_orig_code = (origin_info.get("code_iata") or origin_info.get("code") or "").upper()
            is_dom = is_canadian_airport(origin_info)
            orig_detail = get_connected_airport_info(
                orig_raw_code,
                is_domestic=is_dom,
                fallback_city=origin_info.get("city"),
                fallback_code=real_orig_code
            )
            dest_detail = AIRPORT_DETAILS["YVR"]
            orig_city = origin_info.get("city") or orig_detail["city"]
            city_str = orig_city if f"({orig_detail['code']}" in orig_city else f"{orig_city} ({orig_detail['code']})"
            airline_name = flight.get("operator") or (AIRLINES_INFO.get(ident[:3].upper(), {}).get("name") if len(ident) >= 3 else "客運航空")

            # Arrival time in Vancouver timezone
            t_str = (
                flight.get("estimated_on") or 
                flight.get("estimated_in") or 
                flight.get("scheduled_on") or 
                flight.get("scheduled_in") or 
                flight.get("actual_on") or 
                flight.get("actual_in")
            )
            arr_dt = van_now + timedelta(minutes=30)
            if t_str:
                try:
                    dt_val = datetime.fromisoformat(t_str.replace("Z", "+00:00"))
                    arr_dt = dt_val.astimezone(van_now.tzinfo)
                except Exception:
                    pass

            arr_display_time = arr_dt.strftime("%m/%d %H:%M")

            # Calculate remaining time & filter past flights
            rem_text, rem_code, diff_min = calculate_remaining_time(arr_dt, van_now, is_arr=True)
            if diff_min < -15:
                continue  # Filter out past flights

            # Departure time
            dep_t_str = (
                flight.get("estimated_off") or 
                flight.get("estimated_out") or 
                flight.get("scheduled_off") or 
                flight.get("scheduled_out") or 
                flight.get("actual_off") or 
                flight.get("actual_out")
            )
            dep_display_time = "--/-- --:--"
            if dep_t_str:
                try:
                    dep_dt_val = datetime.fromisoformat(dep_t_str.replace("Z", "+00:00"))
                    dep_display_time = dep_dt_val.astimezone(van_now.tzinfo).strftime("%m/%d %H:%M")
                except Exception:
                    pass
            if dep_display_time == "--/-- --:--":
                flight_dur = FLIGHT_DURATIONS_HOURS.get(orig_detail["code"], 2.5)
                try:
                    dep_display_time = (arr_dt - timedelta(hours=flight_dur)).strftime("%m/%d %H:%M")
                except Exception:
                    dep_display_time = van_now.strftime("%m/%d 12:00")

            route_coords = generate_flight_route_points(orig_detail["coord"], None, dest_detail["coord"])
            status_raw = str(flight.get("status") or "").strip()
            if not status_raw or "En Route" in status_raw or "Airborne" in status_raw:
                status_display = "航行中 (準點)"
            elif "Arrived" in status_raw:
                status_display = "已降落"
            elif "Scheduled" in status_raw:
                status_display = "預計抵達"
            else:
                status_display = status_raw

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
                "date": arr_dt.strftime("%m/%d"),
                "time": arr_dt.strftime("%H:%M"),
                "city": f"{city_str} ➔ Vancouver (YVR)",
                "remaining_time": rem_text,
                "remaining_code": rem_code,
                "terminal": flight.get("terminal") or ("國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)"),
                "gate": flight.get("gate") or "--",
                "status": status_display,
                "status_code": rem_code,
                "is_live": False,
                "route_coords": route_coords,
                "target_dt_iso": arr_dt.isoformat()
            }
            arrivals.append(item)

            # Persist dynamic route for permanent cache
            clean_ident = ident.replace(" ", "").upper()
            if clean_ident:
                _dynamic_flight_routes[clean_ident] = {
                    "city": item["city"],
                    "origin_code": orig_detail["code"],
                    "dest_code": "YVR",
                    "intl": not is_dom,
                    "type": "arr",
                    "terminal": item["terminal"],
                    "gate": item["gate"]
                }

        raw_departures = dep_data.get("scheduled_departures", []) + dep_data.get("departures", [])
        departures = []
        for flight in raw_departures:
            ident = flight.get("ident") or flight.get("ident_iata") or "N/A"
            dest_info = flight.get("destination") or {}
            dest_raw_code = (dest_info.get("code_iata") or dest_info.get("code") or dest_info.get("city") or "ARR").upper()
            real_dest_code = (dest_info.get("code_iata") or dest_info.get("code") or "").upper()
            is_dom = is_canadian_airport(dest_info)
            dest_detail = get_connected_airport_info(
                dest_raw_code,
                is_domestic=is_dom,
                fallback_city=dest_info.get("city"),
                fallback_code=real_dest_code
            )
            orig_detail = AIRPORT_DETAILS["YVR"]
            dest_city = dest_info.get("city") or dest_detail["city"]
            city_str = dest_city if f"({dest_detail['code']}" in dest_city else f"{dest_city} ({dest_detail['code']})"
            airline_name = flight.get("operator") or (AIRLINES_INFO.get(ident[:3].upper(), {}).get("name") if len(ident) >= 3 else "客運航空")

            dep_t_str = (
                flight.get("estimated_off") or 
                flight.get("estimated_out") or 
                flight.get("scheduled_off") or 
                flight.get("scheduled_out") or 
                flight.get("actual_off") or 
                flight.get("actual_out")
            )
            dep_dt = van_now + timedelta(minutes=40)
            if dep_t_str:
                try:
                    dep_dt_val = datetime.fromisoformat(dep_t_str.replace("Z", "+00:00"))
                    dep_dt = dep_dt_val.astimezone(van_now.tzinfo)
                except Exception:
                    pass

            dep_display_time = dep_dt.strftime("%m/%d %H:%M")

            rem_text, rem_code, diff_min = calculate_remaining_time(dep_dt, van_now, is_arr=False)
            if diff_min < -15:
                continue  # Filter out past flights

            arr_t_str = (
                flight.get("estimated_on") or 
                flight.get("estimated_in") or 
                flight.get("scheduled_on") or 
                flight.get("scheduled_in") or 
                flight.get("actual_on") or 
                flight.get("actual_in")
            )
            arr_display_time = "--/-- --:--"
            if arr_t_str:
                try:
                    arr_dt_val = datetime.fromisoformat(arr_t_str.replace("Z", "+00:00"))
                    arr_display_time = arr_dt_val.astimezone(van_now.tzinfo).strftime("%m/%d %H:%M")
                except Exception:
                    pass
            if arr_display_time == "--/-- --:--":
                flight_dur = FLIGHT_DURATIONS_HOURS.get(dest_detail["code"], 2.5)
                try:
                    arr_display_time = (dep_dt + timedelta(hours=flight_dur)).strftime("%m/%d %H:%M")
                except Exception:
                    arr_display_time = van_now.strftime("%m/%d 18:00")

            route_coords = generate_flight_route_points(orig_detail["coord"], None, dest_detail["coord"])
            status_raw = str(flight.get("status") or "").strip()
            if not status_raw or "On Time" in status_raw:
                status_display = "準點"
            elif "Delayed" in status_raw:
                status_display = "延誤"
            elif "Departed" in status_raw or "Taxiing" in status_raw:
                status_display = "已出發"
            else:
                status_display = status_raw

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
                "date": dep_dt.strftime("%m/%d"),
                "time": dep_dt.strftime("%H:%M"),
                "city": f"Vancouver (YVR) ➔ {city_str}",
                "remaining_time": rem_text,
                "remaining_code": rem_code,
                "terminal": flight.get("terminal") or ("國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)"),
                "gate": flight.get("gate") or "--",
                "status": status_display,
                "status_code": rem_code,
                "is_live": False,
                "route_coords": route_coords,
                "target_dt_iso": dep_dt.isoformat()
            }
            departures.append(item)

            clean_ident = ident.replace(" ", "").upper()
            if clean_ident:
                _dynamic_flight_routes[clean_ident] = {
                    "city": item["city"],
                    "origin_code": "YVR",
                    "dest_code": dest_detail["code"],
                    "intl": not is_dom,
                    "type": "dep",
                    "terminal": item["terminal"],
                    "gate": item["gate"]
                }

        # Save dynamic routes to persistent cache
        try:
            os.makedirs(os.path.dirname(FLIGHTAWARE_ROUTES_CACHE_FILE), exist_ok=True)
            with open(FLIGHTAWARE_ROUTES_CACHE_FILE, "w", encoding="utf-8") as rf:
                json.dump(_dynamic_flight_routes, rf, ensure_ascii=False)
        except Exception:
            pass

        # Sort chronologically (soonest flights first)
        arrivals.sort(key=lambda x: x["target_dt_iso"])
        departures.sort(key=lambda x: x["target_dt_iso"])

        result = {
            "airport": "YVR",
            "airport_name": "Vancouver International Airport (溫哥華國際機場)",
            "updated_at": van_now.isoformat(),
            "source": "FlightAware AeroAPI (官方權威航班排程)",
            "total_arrivals": len(arrivals),
            "total_departures": len(departures),
            "arrivals": arrivals,
            "departures": departures
        }
        _flightaware_cache["timestamp"] = now_ts
        _flightaware_cache["data"] = result
        print(f"✅ FlightAware YVR schedule refreshed: {len(arrivals)} arrivals, {len(departures)} departures. (Quota: {month_rounds}/{max_monthly_rounds} rounds)")
        return result

    except Exception as e:
        print(f"Error querying FlightAware AeroAPI: {e}")
        return _flightaware_cache["data"] or _generate_fallback_schedules(van_now)

def _generate_fallback_schedules(van_now: datetime) -> Dict[str, Any]:
    """Generates authentic scheduled flights for YVR in Vancouver local time with accurate real-world routes."""
    base_schedules = [
        # Domestic Arrivals
        {"flight_no": "AC 116", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ 多倫多)", "code": "YYZ", "term": "國內線航廈", "gate": "C42", "offset_m": 12, "type": "arr", "status": "進場中"},
        {"flight_no": "WS 706", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC 卡加利)", "code": "YYC", "term": "國內線航廈", "gate": "B14", "offset_m": 25, "type": "arr", "status": "準點"},
        {"flight_no": "F8 102", "airline": "Flair Airlines (精靈航空)", "is_dom": True, "city": "Edmonton (YEG 艾德蒙頓)", "code": "YEG", "term": "國內線航廈", "gate": "A6", "offset_m": 40, "type": "arr", "status": "準點"},
        {"flight_no": "8P 108", "airline": "Pacific Coastal (太平洋沿岸)", "is_dom": True, "city": "Victoria (YYJ 維多利亞)", "code": "YYJ", "term": "南航廈", "gate": "S2", "offset_m": 50, "type": "arr", "status": "準點"},
        {"flight_no": "AC 214", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Montreal (YUL 蒙特婁)", "code": "YUL", "term": "國內線航廈", "gate": "C38", "offset_m": 75, "type": "arr", "status": "準點"},
        {"flight_no": "PD 120", "airline": "Porter Airlines (波特航空)", "is_dom": True, "city": "Ottawa (YOW 渥太華)", "code": "YOW", "term": "國內線航廈", "gate": "B18", "offset_m": 105, "type": "arr", "status": "準點"},

        # International Arrivals
        {"flight_no": "DLH 476", "airline": "Lufthansa (德國漢莎航空)", "is_dom": False, "city": "Munich (MUC 慕尼黑)", "code": "MUC", "term": "國際線航廈", "gate": "D54", "offset_m": 18, "type": "arr", "status": "航行中 (準點)"},
        {"flight_no": "KE 75", "airline": "Korean Air (大韓航空)", "is_dom": False, "city": "Seoul (ICN 首爾)", "code": "ICN", "term": "國際線航廈", "gate": "D60", "offset_m": 30, "type": "arr", "status": "航行中 (準點)"},
        {"flight_no": "CX 888", "airline": "Cathay Pacific (國泰航空)", "is_dom": False, "city": "Hong Kong (HKG 香港)", "code": "HKG", "term": "國際線航廈", "gate": "D68", "offset_m": 45, "type": "arr", "status": "航行中 (準點)"},
        {"flight_no": "BR 10", "airline": "EVA Air (長榮航空)", "is_dom": False, "city": "Taipei (TPE 台北)", "code": "TPE", "term": "國際線航廈", "gate": "D53", "offset_m": 60, "type": "arr", "status": "航行中 (準點)"},
        {"flight_no": "JL 18", "airline": "Japan Airlines (日本航空)", "is_dom": False, "city": "Tokyo (NRT 成田)", "code": "NRT", "term": "國際線航廈", "gate": "D71", "offset_m": 85, "type": "arr", "status": "航行中 (準點)"},
        {"flight_no": "UA 1420", "airline": "United Airlines (聯合航空)", "is_dom": False, "city": "San Francisco (SFO 舊金山)", "code": "SFO", "term": "國際線航廈", "gate": "E78", "offset_m": 95, "type": "arr", "status": "準點"},
        {"flight_no": "BA 85", "airline": "British Airways (英國航空)", "is_dom": False, "city": "London (LHR 倫敦)", "code": "LHR", "term": "國際線航廈", "gate": "D64", "offset_m": 130, "type": "arr", "status": "航行中 (準點)"},

        # Domestic Departures
        {"flight_no": "AC 125", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ 多倫多)", "code": "YYZ", "term": "國內線航廈", "gate": "C46", "offset_m": 20, "type": "dep", "status": "登機中"},
        {"flight_no": "WS 118", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC 卡加利)", "code": "YYC", "term": "國內線航廈", "gate": "B19", "offset_m": 35, "type": "dep", "status": "準點"},
        {"flight_no": "AC 824", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Ottawa (YOW 渥太華)", "code": "YOW", "term": "國內線航廈", "gate": "C35", "offset_m": 55, "type": "dep", "status": "準點"},
        {"flight_no": "WS 135", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Edmonton (YEG 艾德蒙頓)", "code": "YEG", "term": "國內線航廈", "gate": "B22", "offset_m": 70, "type": "dep", "status": "準點"},

        # International Departures
        {"flight_no": "AC 63", "airline": "Air Canada (加拿大航空)", "is_dom": False, "city": "Seoul (ICN 首爾)", "code": "ICN", "term": "國際線航廈", "gate": "D52", "offset_m": 25, "type": "dep", "status": "登機中"},
        {"flight_no": "CI 31", "airline": "China Airlines (中華航空)", "is_dom": False, "city": "Taipei (TPE 台北)", "code": "TPE", "term": "國際線航廈", "gate": "D55", "offset_m": 45, "type": "dep", "status": "準點"},
        {"flight_no": "NH 115", "airline": "All Nippon Airways (全日空)", "is_dom": False, "city": "Tokyo (HND 羽田)", "code": "HND", "term": "國際線航廈", "gate": "D72", "offset_m": 65, "type": "dep", "status": "準點"},
        {"flight_no": "DL 1980", "airline": "Delta Air Lines (達美航空)", "is_dom": False, "city": "Seattle (SEA 西雅圖)", "code": "SEA", "term": "國際線航廈", "gate": "E82", "offset_m": 80, "type": "dep", "status": "準點"},
        {"flight_no": "LH 477", "airline": "Lufthansa (德國漢莎航空)", "is_dom": False, "city": "Munich (MUC 慕尼黑)", "code": "MUC", "term": "國際線航廈", "gate": "D54", "offset_m": 120, "type": "dep", "status": "準點"}
    ]

    arrivals = []
    departures = []

    for item in base_schedules:
        target_dt = van_now + timedelta(minutes=item["offset_m"])
        time_str = target_dt.strftime("%H:%M")
        other_airport = AIRPORT_DETAILS.get(item["code"], get_airport_info(item["city"]))
        yvr_airport = AIRPORT_DETAILS["YVR"]
        flight_dur = FLIGHT_DURATIONS_HOURS.get(other_airport["code"], 2.5)

        is_arr = (item["type"] == "arr")
        rem_text, rem_code, diff_min = calculate_remaining_time(target_dt, van_now, is_arr=is_arr)
        if diff_min < -15:
            continue

        if is_arr:
            orig_info = other_airport
            dest_info = yvr_airport
            arr_dt = target_dt
            dep_dt = target_dt - timedelta(hours=flight_dur)
            arr_time_str = arr_dt.strftime("%m/%d %H:%M")
            dep_time_str = dep_dt.strftime("%m/%d %H:%M")
        else:
            orig_info = yvr_airport
            dest_info = other_airport
            dep_dt = target_dt
            arr_dt = target_dt + timedelta(hours=flight_dur)
            dep_time_str = dep_dt.strftime("%m/%d %H:%M")
            arr_time_str = arr_dt.strftime("%m/%d %H:%M")

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
            "date": target_dt.strftime("%m/%d"),
            "city": f"{orig_info['city']} ➔ {dest_info['city']}",
            "time": time_str,
            "remaining_time": rem_text,
            "remaining_code": rem_code,
            "terminal": item["term"],
            "gate": item["gate"],
            "status": item["status"],
            "status_code": rem_code,
            "is_live": False,
            "route_coords": route_coords,
            "target_dt_iso": target_dt.isoformat()
        }

        if is_arr:
            arrivals.append(sched_entry)
        else:
            departures.append(sched_entry)

    arrivals.sort(key=lambda x: x["target_dt_iso"])
    departures.sort(key=lambda x: x["target_dt_iso"])

    return {
        "airport": "YVR",
        "airport_name": "Vancouver International Airport (溫哥華國際機場)",
        "updated_at": van_now.isoformat(),
        "source": "離線參考排程庫 (未檢測到 FLIGHTAWARE_API_KEY，請在 backend/.env 設定以啟動官方即時排程)",
        "is_real_api": False,
        "total_arrivals": len(arrivals),
        "total_departures": len(departures),
        "arrivals": arrivals,
        "departures": departures
    }

def generate_flight_schedules(live_flights=None, allow_api_call: bool = True) -> Dict[str, Any]:
    """Alias for fetch_flightaware_schedules."""
    return fetch_flightaware_schedules(allow_api_call=allow_api_call)

def fetch_live_flights() -> List[Dict[str, Any]]:
    """Deprecated: OpenSky ADS-B live aircraft radar tracking has been removed."""
    return []
