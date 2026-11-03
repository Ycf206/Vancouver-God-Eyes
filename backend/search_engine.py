"""
High-Performance In-Memory Layer & Location Search Engine for Vancouver God's Eye.

Features:
- Sub-millisecond inverted index (exact token, prefix 1..6 chars, CJK char & bigram, O(1) code & category maps)
- Simplified <-> Traditional Chinese normalization + English street/ordinal/direction/landmark synonym expansion
- Coordinate direct parsing ("49.2827, -123.1207") with nearest POI discovery
- Unified multi-field relevance scoring, tier prioritization, proximity ranking, and category diversity guard
- Automatic mtime-based background hot-reload without blocking active requests
- Smartly gated, connection-pooled City of Vancouver civic address lookup
"""

from __future__ import annotations

from collections import OrderedDict, defaultdict
from dataclasses import dataclass
import json
import math
import os
import re
import threading
import time
from typing import Any, Callable, Optional
import urllib.parse

import requests
from requests.adapters import HTTPAdapter


# ---------------------------------------------------------------------------
# 1. Simplified -> Traditional Chinese Translation Table (C-speed str.translate)
# ---------------------------------------------------------------------------
_SIMP_CHARS = (
    "银医图书馆学园厕卫间场车铁邮递电动桩桥路街号区湾温华门关轮机飞船货头滩树灯线单双"
    "东西南北总处队灾难护养饮贩摊统丰汇皇蒙满艺术博购雪铲闭施规划废环节观测达罗列素本"
    "拿高贵兰白马狮松鸡赛奥尔边界无障碍滑板摩托信号转载重速度斑警消栓救颤器站线港岛楼"
    "层室中心广场大厦国际机场码头渡轮铁路轻轨天车公交巴士单车脚踏车计程车停车场收费表"
    "充电加油医院诊所急救药房学校大学中学小学幼稚园图书馆博物馆美术馆社区公园花园海滩"
    "泳滩洗手间公厕饮水机垃圾回收环保食物银行援助庇护所警察消防灾害紧急摄影机相机测速"
    "冲红灯封路封闭施工修路路况塞车拥堵意外车祸转弯转向限速货车卡车桥梁隧道边境界线邮"
    "政快递包裹柜员机自动提款机网路免费无线滑雪缆车潮汐水文气象极光购物超市商场餐厅美"
    "食咖啡厅动物园水族馆体育馆球场游泳池溜冰场网球场篮球场滑板场儿童游乐场宠物狗公园"
)
_TRAD_CHARS = (
    "銀醫圖書館學園廁衛間場車鐵郵遞電動樁橋路街號區灣溫華門關輪機飛船貨頭灘樹燈線單雙"
    "東西南北總處隊災難護養飲販攤統豐匯皇蒙滿藝術博購雪鏟閉施規劃廢環節觀測達羅列素本"
    "拿高貴蘭白馬獅松雞賽奧爾邊界無障礙滑板摩托信號轉載重速度斑警消栓救顫器站線港島樓"
    "層室中心廣場大廈國際機場碼頭渡輪鐵路輕軌天車公交巴士單車腳踏車計程車停車場收費錶"
    "充電加油醫院診所急救藥房學校大學中學小學幼稚園圖書館博物館美術館社區公園花園海灘"
    "泳灘洗手間公廁飲水機垃圾回收環保食物銀行援助庇護所警察消防災害緊急攝影機相機測速"
    "衝紅燈封路封閉施工修路路況塞車擁堵意外車禍轉彎轉向限速貨車卡車橋樑隧道邊境界線郵"
    "政快遞包裹櫃員機自動提款機網路免費無線滑雪纜車潮汐水文氣象極光購物超市商場餐廳美"
    "食咖啡廳動物園水族館體育館球場游泳池溜冰場網球場籃球場滑板場兒童遊樂場寵物狗公園"
)
assert len(_SIMP_CHARS) == len(_TRAD_CHARS), "Simplified/Traditional mapping length mismatch"
_SIMP_TO_TRAD_TABLE = str.maketrans(_SIMP_CHARS, _TRAD_CHARS)


def to_traditional(text: str) -> str:
    if not text:
        return ""
    return text.translate(_SIMP_TO_TRAD_TABLE)


# ---------------------------------------------------------------------------
# 2. Tokenization, Synonym Expansion & Category Intents
# ---------------------------------------------------------------------------
_ORDINAL_RE = re.compile(r"^(\d+)(?:st|nd|rd|th)$")
_TOKEN_EXTRACT_RE = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]+")
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
_COORD_QUERY_RE = re.compile(
    r"^\s*(-?\d{1,2}\.\d{2,})\s*°?\s*([nNsS])?\s*[,，\s/]+\s*(-?\d{2,3}\.\d{2,})\s*°?\s*([eEwW])?\s*$"
)
_CIVIC_ADDR_RE = re.compile(r"^\s*\d{1,5}(?:\s*-\s*\d{1,5})?\s+[a-zA-Z0-9]")
_POSTAL_CODE_RE = re.compile(r"^\s*([vV]\d[a-zA-Z])\s*(\d[a-zA-Z]\d)?\s*$")

# Bi-directional word-level synonyms expanded at document indexing time
_BIDIR_WORD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "st": ("street", "saint"),
    "street": ("st",),
    "saint": ("st",),
    "ave": ("avenue", "av"),
    "av": ("ave", "avenue"),
    "avenue": ("ave", "av"),
    "blvd": ("boulevard",),
    "boulevard": ("blvd",),
    "dr": ("drive",),
    "drive": ("dr",),
    "rd": ("road",),
    "road": ("rd",),
    "hwy": ("highway",),
    "highway": ("hwy",),
    "cres": ("crescent", "cr"),
    "cr": ("cres", "crescent"),
    "crescent": ("cres", "cr"),
    "pl": ("place",),
    "place": ("pl",),
    "ct": ("court",),
    "court": ("ct",),
    "pkwy": ("parkway",),
    "parkway": ("pkwy",),
    "ln": ("lane",),
    "lane": ("ln",),
    "w": ("west", "westbound", "wb"),
    "west": ("w",),
    "wb": ("westbound", "w"),
    "westbound": ("wb", "w", "west"),
    "e": ("east", "eastbound", "eb"),
    "east": ("e",),
    "eb": ("eastbound", "e"),
    "eastbound": ("eb", "e", "east"),
    "n": ("north", "northbound", "nb"),
    "north": ("n",),
    "nb": ("northbound", "n"),
    "northbound": ("nb", "n", "north"),
    "s": ("south", "southbound", "sb"),
    "south": ("s",),
    "sb": ("southbound", "s"),
    "southbound": ("sb", "s", "south"),
    "mt": ("mount",),
    "mount": ("mt",),
    "stn": ("station",),
    "station": ("stn",),
    "centre": ("center",),
    "center": ("centre",),
    "intl": ("international",),
    "international": ("intl",),
    "hosp": ("hospital",),
    "hospital": ("hosp",),
    "univ": ("university",),
    "university": ("univ",),
    " Washroom".strip().lower(): ("toilet", "restroom"),
}

# Landmark & Brand Phrase Aliases (if phrase appears in doc text, inject extra keywords)
_LANDMARK_PHRASE_ALIASES: tuple[tuple[str, str], ...] = (
    ("science world", "科學館 telus world of science 科技館"),
    ("university of british columbia", "ubc 卑詩大學 不列顛哥倫比亞大學"),
    ("ubc", "university of british columbia 卑詩大學"),
    ("simon fraser", "sfu 西門菲沙大學"),
    ("british columbia institute of technology", "bcit 卑詩理工學院"),
    ("vancouver general hospital", "vgh 溫哥華綜合醫院 溫哥華總醫院"),
    ("st paul", "聖保祿醫院 st pauls hospital"),
    ("children's hospital", "bc childrens hospital 兒童醫院"),
    ("mount saint joseph", "聖若瑟醫院 mt st joseph"),
    ("stanley park", "史丹利公園 斯坦利公園"),
    ("queen elizabeth park", "伊利沙伯女皇公園 女皇公園 qe park"),
    ("granville island", "固蘭湖島 格蘭維爾島"),
    ("canada place", "加拿大廣場 五帆 郵輪碼頭"),
    ("english bay", "英吉利灣"),
    ("kitsilano", "kits 基斯蘭奴"),
    ("gastown", "煤氣鎮 蓋士鎮"),
    ("chinatown", "華埠 唐人街"),
    ("yaletown", "耶魯鎮"),
    ("metrotown", "鐵道鎮 麗晶"),
    ("waterfront", "濱海站 水前"),
    ("lonsdale", "朗斯代爾 北溫碼頭"),
    ("lions gate", "獅門大橋 獅門橋"),
    ("ironworkers", "鋼鐵工人紀念橋 第二海峽橋 second narrows"),
    ("burrard bridge", "伯拉德橋"),
    ("cambie bridge", "甘比橋"),
    ("granville bridge", "固蘭湖橋"),
    ("knight street bridge", "奈特街橋"),
    ("oak street bridge", "橡樹街橋"),
    ("arthur laing", "亞瑟連橋 機場橋"),
    ("td canada trust", "td bank 道明銀行"),
    ("royal bank", "rbc 皇家銀行"),
    ("bank of montreal", "bmo 滿地可銀行 蒙特利爾銀行"),
    ("cibc", "canadian imperial bank 帝國商業銀行"),
    ("scotiabank", "scotia 豐業銀行"),
    ("hsbc", "滙豐銀行 匯豐銀行"),
    ("vancity", "vancity credit union 溫市信貸"),
    ("t&t", "大統華 tnt supermarket"),
    ("vancouver public library", "vpl 溫哥華公共圖書館 中央圖書館"),
)

# Explicit query -> target category mapping for instant category intent boosting
CATEGORY_INTENTS: dict[str, tuple[str, ...]] = {
    # Financial & Postal
    "銀行": ("banks",),
    "櫃員機": ("banks",),
    "提款機": ("banks",),
    "bank": ("banks",),
    "banks": ("banks",),
    "atm": ("banks",),
    "td": ("banks",),
    "rbc": ("banks",),
    "bmo": ("banks",),
    "cibc": ("banks",),
    "scotiabank": ("banks",),
    "hsbc": ("banks",),
    "vancity": ("banks",),
    "郵局": ("canada_post",),
    "郵政": ("canada_post",),
    "郵寄": ("canada_post", "fedex", "purolator"),
    "快遞": ("fedex", "purolator", "canada_post"),
    "包裹": ("canada_post", "fedex", "purolator"),
    "canada post": ("canada_post",),
    "post office": ("canada_post",),
    "fedex": ("fedex",),
    "purolator": ("purolator",),
    # Daily & Public Facilities
    "洗手間": ("public_washrooms",),
    "衛生間": ("public_washrooms",),
    "公共洗手間": ("public_washrooms",),
    "公共廁所": ("public_washrooms",),
    "公廁": ("public_washrooms",),
    "廁所": ("public_washrooms",),
    "washroom": ("public_washrooms",),
    "washrooms": ("public_washrooms",),
    "toilet": ("public_washrooms",),
    "restroom": ("public_washrooms",),
    "飲水器": ("drinking_fountains",),
    "飲水機": ("drinking_fountains",),
    "fountain": ("drinking_fountains",),
    "water fountain": ("drinking_fountains",),
    "圖書館": ("libraries",),
    "library": ("libraries",),
    "libraries": ("libraries",),
    "vpl": ("libraries",),
    "學校": ("schools",),
    "小學": ("schools",),
    "中學": ("schools",),
    "school": ("schools",),
    "schools": ("schools",),
    "社區中心": ("community_centres",),
    "community centre": ("community_centres",),
    "community center": ("community_centres",),
    "博物館": ("museums",),
    "美術館": ("museums",),
    "museum": ("museums",),
    "museums": ("museums",),
    "公園": ("parks",),
    "park": ("parks",),
    "parks": ("parks",),
    "公園設施": ("parks_facilities",),
    "球場": ("parks_facilities",),
    "遊樂場": ("parks_facilities",),
    "社區花園": ("community_gardens",),
    "海灘": ("beach_water_quality",),
    "泳灘": ("beach_water_quality",),
    "沙灘": ("beach_water_quality",),
    "beach": ("beach_water_quality",),
    "公共藝術": ("public_art",),
    "雕塑": ("public_art",),
    "壁畫": ("public_art",),
    "wifi": ("van_wifi",),
    "vanwifi": ("van_wifi",),
    "免費上網": ("van_wifi",),
    "餐車": ("food_vendors",),
    "食品攤販": ("food_vendors",),
    "小食": ("food_vendors",),
    "food truck": ("food_vendors",),
    "食物銀行": ("food_banks",),
    "食物援助": ("food_banks",),
    "food bank": ("food_banks",),
    "庇護所": ("homeless_shelters",),
    "shelter": ("homeless_shelters",),
    "回收": ("recycling", "garbage_collection"),
    "環保回收": ("recycling",),
    "recycling": ("recycling",),
    "垃圾箱": ("litter_containers",),
    "垃圾收集": ("garbage_collection",),
    # Emergency & Healthcare
    "醫院": ("hospitals",),
    "診所": ("hospitals",),
    "醫療": ("hospitals",),
    "急症": ("hospitals",),
    "upcc": ("hospitals",),
    "hospital": ("hospitals",),
    "hospitals": ("hospitals",),
    "clinic": ("hospitals",),
    "警察": ("police",),
    "警局": ("police",),
    "警察局": ("police",),
    "police": ("police",),
    "vpd": ("police",),
    "消防": ("fire_halls",),
    "消防局": ("fire_halls",),
    "fire hall": ("fire_halls",),
    "消防栓": ("fire_hydrants",),
    "hydrant": ("fire_hydrants",),
    "aed": ("aed",),
    "去顫器": ("aed",),
    "災害": ("disaster_hubs",),
    "災害支援": ("disaster_hubs",),
    "治安": ("crime_areas",),
    "罪案": ("crime_areas",),
    "crime": ("crime_areas",),
    # Energy, Parking & Mobility
    "油站": ("fuel",),
    "加油站": ("fuel",),
    "加油": ("fuel",),
    "fuel": ("fuel",),
    "gas": ("fuel",),
    "gas station": ("fuel",),
    "petro": ("fuel",),
    "shell": ("fuel",),
    "esso": ("fuel",),
    "chevron": ("fuel",),
    "充電": ("ev_charging", "tesla"),
    "充電站": ("ev_charging", "tesla"),
    "充電樁": ("ev_charging", "tesla"),
    "電動車": ("ev_charging", "tesla"),
    "ev": ("ev_charging", "tesla"),
    "charger": ("ev_charging", "tesla"),
    "tesla": ("tesla",),
    "特斯拉": ("tesla",),
    "supercharger": ("tesla",),
    "超級充電": ("tesla",),
    "停車場": ("impark", "accessible_parking"),
    "泊車": ("impark", "parking_meters", "accessible_parking"),
    "parking": ("impark", "accessible_parking", "parking_meters"),
    "impark": ("impark",),
    "收費錶": ("parking_meters",),
    "咪錶": ("parking_meters",),
    "meter": ("parking_meters",),
    "無障礙車位": ("accessible_parking",),
    "殘障車位": ("accessible_parking",),
    "accessible parking": ("accessible_parking",),
    "摩托車": ("motorcycle_parking",),
    "電單車": ("motorcycle_parking",),
    "motorcycle": ("motorcycle_parking",),
    "共享汽車": ("car_sharing",),
    "evo": ("car_sharing",),
    "modo": ("car_sharing",),
    "car share": ("car_sharing",),
    "共享單車": ("shared_bikes",),
    "mobi": ("shared_bikes",),
    "bike share": ("shared_bikes",),
    "單車徑": ("bikeways",),
    "單車道": ("bikeways",),
    "bikeway": ("bikeways",),
    "單車架": ("bike_racks",),
    "滑板車": ("escooter",),
    "共享滑板車": ("escooter",),
    "lime": ("escooter",),
    "escooter": ("escooter",),
    "scooter": ("escooter",),
    # Transit, Marine, Air & Border
    "天車": ("skytrain",),
    "天車站": ("skytrain",),
    "地鐵": ("skytrain",),
    "skytrain": ("skytrain",),
    "expo line": ("skytrain",),
    "canada line": ("skytrain",),
    "millennium line": ("skytrain",),
    "海上巴士": ("seabus",),
    "seabus": ("seabus",),
    "巴士": ("bus_route",),
    "公車": ("bus_route",),
    "巴士線": ("bus_route",),
    "bus": ("bus_route",),
    "rapidbus": ("bus_route",),
    "巴士站": ("bus_stop",),
    "公車站": ("bus_stop",),
    "bus stop": ("bus_stop",),
    "轉車站": ("bus_exchange",),
    "轉乘站": ("bus_exchange",),
    "巴士總站": ("bus_exchange",),
    "bus exchange": ("bus_exchange",),
    "exchange": ("bus_exchange",),
    "loop": ("bus_exchange",),
    "渡輪": ("ferry_terminal", "ferry_vehicle"),
    "碼頭": ("ferry_terminal", "marine_terminals"),
    "bc ferries": ("ferry_terminal", "ferry_vehicle"),
    "ferry": ("ferry_terminal", "ferry_vehicle"),
    "機場": ("airports",),
    "飛機場": ("airports",),
    "水上飛機": ("airports",),
    "airport": ("airports",),
    "yvr": ("airports",),
    "商船": ("maritime_vessel",),
    "貨輪": ("maritime_vessel",),
    "船運": ("maritime_vessel", "marine_terminals"),
    "vessel": ("maritime_vessel",),
    "鐵路": ("railways",),
    "火車": ("railways",),
    "railway": ("railways",),
    "關口": ("border_crossing",),
    "邊境": ("border_crossing",),
    "海關": ("border_crossing",),
    "border": ("border_crossing",),
    "nexus": ("border_crossing",),
    "滑雪": ("ski_resort",),
    "滑雪場": ("ski_resort",),
    "ski": ("ski_resort",),
    "潮汐": ("tide_stations",),
    "水位": ("tide_stations",),
    "tide": ("tide_stations",),
    # Traffic & Roads
    "交通攝影機": ("traffic_cameras",),
    "攝影機": ("traffic_cameras", "safety_cameras"),
    "鏡頭": ("traffic_cameras",),
    "webcam": ("traffic_cameras",),
    "camera": ("traffic_cameras", "safety_cameras"),
    "測速": ("safety_cameras",),
    "衝紅燈": ("safety_cameras",),
    "red light": ("safety_cameras",),
    "speed camera": ("safety_cameras",),
    "封路": ("road_closures",),
    "道路封閉": ("road_closures",),
    "road closure": ("road_closures",),
    "施工": ("road_construction",),
    "道路施工": ("road_construction",),
    "修路": ("road_construction",),
    "construction": ("road_construction",),
    "路況": ("traffic_conditions",),
    "塞車": ("traffic_conditions",),
    "即時通報": ("traffic_alerts",),
    "鏟雪": ("snow_removal_routes",),
    "除雪": ("snow_removal_routes",),
    "snow": ("snow_removal_routes",),
    "單向": ("one_way_streets",),
    "單行道": ("one_way_streets",),
    "one way": ("one_way_streets",),
    "速限": ("traffic_speed_limits",),
    "限速": ("traffic_speed_limits",),
    "貨車": ("truck_routes_restriction", "truck_routes"),
    "限高": ("truck_routes_restriction",),
    "轉向限制": ("turn_restrictions",),
    "交通燈": ("traffic_signals",),
    "紅綠燈": ("traffic_signals",),
    "斑馬線": ("traffic_crosswalks",),
    "行人穿越道": ("traffic_crosswalks",),
    "郵遞區號": ("postal_code_fsa",),
    "郵編": ("postal_code_fsa",),
    "postal": ("postal_code_fsa",),
    "fsa": ("postal_code_fsa",),
    "區域邊界": ("local_area_boundary",),
    "社區分區": ("local_area_boundary",),
    "土地規劃": ("zoning_districts",),
    "zoning": ("zoning_districts",),
}


# Tier Priority Score Bonus (prevents 8,800 bus stops & street poles from burying landmarks)
CATEGORY_TIER_BONUS: dict[str, int] = {
    # Tier 1 (+34): Major Landmarks, Rapid Transit, Aviation, Ferries, Emergency, Civic, Neighbourhoods
    "airports": 34,
    "skytrain": 34,
    "seabus": 34,
    "ferry_terminal": 34,
    "bus_exchange": 35,
    "border_crossing": 34,
    "ski_resort": 34,
    "hospitals": 34,
    "museums": 34,
    "libraries": 34,
    "schools": 32,
    "parks": 32,
    "community_centres": 32,
    "police": 32,
    "fire_halls": 32,
    "banks": 30,
    "local_area_boundary": 30,
    "beach_water_quality": 30,
    "marine_terminals": 28,
    # Tier 2 (+20): Bus Routes, Energy, Parking Lots, Mobility Share, Couriers, Washrooms, Live Overlays
    "bus_route": 22,
    "ferry_vehicle": 22,
    "maritime_vessel": 20,
    "tide_stations": 22,
    "canada_post": 22,
    "fedex": 20,
    "purolator": 20,
    "fuel": 22,
    "tesla": 22,
    "ev_charging": 20,
    "impark": 20,
    "public_washrooms": 20,
    "car_sharing": 18,
    "shared_bikes": 18,
    "escooter": 18,
    "parks_facilities": 18,
    "community_gardens": 18,
    "public_art": 18,
    "food_vendors": 18,
    "food_banks": 18,
    "homeless_shelters": 18,
    "disaster_hubs": 20,
    "aed": 16,
    "van_wifi": 16,
    "recycling": 18,
    "traffic_cameras": 18,
    "safety_cameras": 18,
    "traffic_conditions": 18,
    "traffic_alerts": 18,
    "road_closures": 16,
    "road_construction": 16,
    "postal_code_fsa": 20,
    "crime_areas": 18,
    "bikeways": 16,
    "address": 18,
    # Tier 3 (+6): Bus Stops, Street Parking, Linear Corridors, Zoning
    "bus_stop": 6,
    "accessible_parking": 8,
    "motorcycle_parking": 8,
    "parking_meters": 6,
    "drinking_fountains": 8,
    "garbage_collection": 8,
    "zoning_districts": 8,
    "railways": 8,
    "snow_removal_routes": 6,
    "one_way_streets": 6,
    "traffic_speed_limits": 6,
    "truck_routes_restriction": 8,
    "truck_routes": 6,
    "turn_restrictions": 6,
    # Tier 4 (+0): High-density street hardware
    "traffic_signals": 0,
    "traffic_crosswalks": 0,
    "bike_racks": 0,
    "litter_containers": 0,
    "fire_hydrants": 0,
}

# Broad UI Group mapping for instant dropdown quick-tabs
CATEGORY_UI_GROUP: dict[str, str] = {
    "skytrain": "transit",
    "seabus": "transit",
    "bus_route": "transit",
    "bus_stop": "transit",
    "ferry_terminal": "transit",
    "bus_exchange": "transit",
    "ferry_vehicle": "transit",
    "airports": "transit",
    "maritime_vessel": "transit",
    "marine_terminals": "transit",
    "railways": "transit",
    "border_crossing": "road",
    "fuel": "road",
    "tesla": "road",
    "ev_charging": "road",
    "impark": "road",
    "accessible_parking": "road",
    "motorcycle_parking": "road",
    "parking_meters": "road",
    "car_sharing": "road",
    "shared_bikes": "road",
    "escooter": "road",
    "bikeways": "road",
    "bike_racks": "road",
    "traffic_cameras": "road",
    "safety_cameras": "road",
    "traffic_conditions": "road",
    "traffic_alerts": "road",
    "road_closures": "road",
    "road_construction": "road",
    "snow_removal_routes": "road",
    "one_way_streets": "road",
    "traffic_speed_limits": "road",
    "truck_routes_restriction": "road",
    "truck_routes": "road",
    "turn_restrictions": "road",
    "traffic_signals": "road",
    "traffic_crosswalks": "road",
    "address": "area",
    "coordinate": "area",
    "local_area_boundary": "area",
    "postal_code_fsa": "area",
    "zoning_districts": "area",
    "crime_areas": "area",
}


def normalize_token(tok: str) -> str:
    m = _ORDINAL_RE.match(tok)
    if m:
        return m.group(1)
    return tok


def extract_tokens_and_phrase(raw: str) -> tuple[list[str], str]:
    """
    Translates Simplified -> Traditional, lowercases, strips ordinals (41st -> 41),
    and returns (tokens_list, normalized_space_joined_phrase).
    """
    if not raw:
        return [], ""
    trad = to_traditional(raw).lower()
    raw_tokens = _TOKEN_EXTRACT_RE.findall(trad)
    if not raw_tokens:
        return [], ""
    tokens = [normalize_token(t) for t in raw_tokens]
    return tokens, " ".join(tokens)


def expand_index_tokens(tokens: list[str]) -> tuple[set[str], set[str]]:
    """
    Given base tokens of a document, returns:
    - expanded_words: ASCII words + bi-directional synonyms + CJK runs + CJK 2-char bigrams
    - cjk_chars: individual CJK characters
    """
    expanded: set[str] = set()
    cjk_chars: set[str] = set()
    for tok in tokens:
        expanded.add(tok)
        syns = _BIDIR_WORD_SYNONYMS.get(tok)
        if syns:
            expanded.update(syns)
        if _CJK_RUN_RE.match(tok):
            for ch in tok:
                cjk_chars.add(ch)
            if len(tok) >= 2:
                for i in range(len(tok) - 1):
                    expanded.add(tok[i : i + 2])
    return expanded, cjk_chars


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Fast equirectangular approximation accurate to <0.2% within Metro Vancouver."""
    dlat = (lat2 - lat1) * 111.132
    dlon = (lon2 - lon1) * 73.074  # cos(49.25 deg) * 111.320
    return math.hypot(dlat, dlon)


# ---------------------------------------------------------------------------
# 3. Compact Document Record
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class SearchDoc:
    doc_id: int
    id: str
    title: str
    subtitle: str
    category: str
    badge: str
    icon: str
    lon: float
    lat: float
    zoom: int
    layer_key: Optional[str]
    meta: dict[str, Any]
    norm_title: str
    norm_addr: str
    norm_sub: str
    title_tokens: frozenset[str]
    addr_tokens: frozenset[str]
    all_tokens: frozenset[str]
    tier_bonus: int


# ---------------------------------------------------------------------------
# 4. Static Reference Configs (BC Ferries Terminals & Fallback Airports)
# ---------------------------------------------------------------------------
SEARCH_BC_FERRY_TERMINALS: list[dict[str, Any]] = [
    {
        "id": "ferry_tsa",
        "title": "Tsawwassen Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 吐瓦森 (TSA · 往維多利亞/納奈莫/海灣群島)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.1311,
        "lat": 49.0068,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["tsa"],
        "keywords": "tsawwassen tsa 吐瓦森 托瓦森 措瓦森 delta 三角洲 victoria 維多利亞 swartz duke point ferry 碼頭 渡輪",
        "meta": {"code": "TSA"},
    },
    {
        "id": "ferry_hsb",
        "title": "Horseshoe Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 馬蹄灣 (HSB · 往納奈莫/陽光海岸/寶雲島)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.2741,
        "lat": 49.3693,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["hsb"],
        "keywords": "horseshoe bay hsb 馬蹄灣 west vancouver 西溫哥華 nanaimo bowen langdale ferry 碼頭 渡輪",
        "meta": {"code": "HSB"},
    },
    {
        "id": "ferry_swb",
        "title": "Swartz Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 斯沃茨灣 (SWB · 維多利亞 Victoria)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4107,
        "lat": 48.6868,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["swb"],
        "keywords": "swartz bay swb victoria 維多利亞 斯沃茨灣 sidney ferry 碼頭 渡輪",
        "meta": {"code": "SWB"},
    },
    {
        "id": "ferry_nan",
        "title": "Departure Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 啟航灣 (NAN · 納奈莫 Nanaimo)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.9554,
        "lat": 49.1935,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["nan"],
        "keywords": "departure bay nanaimo nan 啟航灣 納奈莫 溫哥華島 ferry 碼頭 渡輪",
        "meta": {"code": "NAN"},
    },
    {
        "id": "ferry_duk",
        "title": "Duke Point Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 杜克角 (DUK · 納奈莫 Nanaimo)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.8912,
        "lat": 49.1606,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["duk"],
        "keywords": "duke point duk 杜克角 nanaimo 納奈莫 ferry 碼頭 渡輪",
        "meta": {"code": "DUK"},
    },
    {
        "id": "ferry_lng",
        "title": "Langdale Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 蘭代爾 (LNG · 陽光海岸 Sunshine Coast)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4723,
        "lat": 49.4339,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["lng"],
        "keywords": "langdale lng sunshine coast 蘭代爾 陽光海岸 gibsons ferry 碼頭 渡輪",
        "meta": {"code": "LNG"},
    },
    {
        "id": "ferry_bow",
        "title": "Bowen Island (Snug Cove) Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 寶雲島 (BOW · Snug Cove)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.3313,
        "lat": 49.3795,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["bow"],
        "keywords": "bowen island snug cove bow 寶雲島 ferry 碼頭 渡輪",
        "meta": {"code": "BOW"},
    },
    {
        "id": "ferry_ful",
        "title": "Fulford Harbour Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 富爾福德港 (FUL · 鹽泉島 Salt Spring Island)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4511,
        "lat": 48.7694,
        "zoom": 14,
        "layer_key": "bcferriesRoutes",
        "codes": ["ful"],
        "keywords": "fulford harbour salt spring island ful 富爾福德港 鹽泉島 ferry 碼頭 渡輪",
        "meta": {"code": "FUL"},
    },
]

SEARCH_BUS_EXCHANGES: list[dict[str, Any]] = [
    {
        "id": "bus_exchange_blanca_loop",
        "title": "Blanca Loop (布蘭卡巴士轉乘站)",
        "subtitle": "巴士轉乘站 · Blanca St and Chancellor Blvd · 路線: 4",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.215573,
        "lat": 49.265194,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "blanca loop 布蘭卡 轉乘站 轉車站 bus exchange 4 ubc chancellor",
        "meta": {"exchange_id": "blanca_loop"},
    },
    {
        "id": "bus_exchange_dunbar_loop",
        "title": "Dunbar Loop (鄧巴巴士轉乘站)",
        "subtitle": "巴士轉乘站 · Dunbar St and 41st Ave · 路線: 2, 7, 41, 49, N22, R4",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.18588,
        "lat": 49.23475,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "dunbar loop 鄧巴 轉乘站 轉車站 bus exchange 2 7 41 49 n22 r4 41st ave",
        "meta": {"exchange_id": "dunbar_loop"},
    },
    {
        "id": "bus_exchange_kootenay_loop",
        "title": "Kootenay Loop (庫特尼巴士轉乘站)",
        "subtitle": "巴士轉乘站 · Hastings St and Kootenay St · 路線: 14, 27, 28, 130, 131, 160, N35, R2, R5",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.0260,
        "lat": 49.2813,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "kootenay loop 庫特尼 轉乘站 轉車站 bus exchange 14 27 28 130 131 160 n35 r2 r5 hastings",
        "meta": {"exchange_id": "kootenay_loop"},
    },
    {
        "id": "bus_exchange_marpole_loop",
        "title": "Marpole Loop (馬寶巴士轉乘站)",
        "subtitle": "巴士轉乘站 · Marine Dr and Hudson St · 路線: 10, 100",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.13388,
        "lat": 49.20325,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "marpole loop 馬寶 轉乘站 轉車站 bus exchange 10 100 marine dr hudson",
        "meta": {"exchange_id": "marpole_loop"},
    },
    {
        "id": "bus_exchange_stanley_park_loop",
        "title": "Stanley Park Loop (史丹利公園巴士總站)",
        "subtitle": "巴士轉乘站 · Pipeline Rd / Rose Garden Lane · 路線: 19",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.13386,
        "lat": 49.3006,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "stanley park loop 史丹利公園 轉乘站 總站 轉車站 bus exchange 19 pipeline rose garden",
        "meta": {"exchange_id": "stanley_park_loop"},
    },
    {
        "id": "bus_exchange_ubc_exchange",
        "title": "UBC Exchange (UBC 卑詩大學巴士轉乘站)",
        "subtitle": "巴士轉乘站 · Wesbrook Mall and University Blvd · 路線: 4, 9, 14, 25, 33, 44, 49, 68, 84, 99, N17, R4",
        "category": "bus_exchange",
        "badge": "巴士轉乘站",
        "icon": "🚏",
        "lon": -123.2475,
        "lat": 49.26675,
        "zoom": 17,
        "layer_key": "busExchanges",
        "keywords": "ubc exchange 卑詩大學 總站 轉乘站 轉車站 bus exchange 4 9 14 25 33 44 49 68 84 99 n17 r4 wesbrook university",
        "meta": {"exchange_id": "ubc_exchange"},
    },
]

# GeoJSON Layer Configurations:
# (file_stem, search_category, meta_facility_type, badge_zh, icon, layer_key, zoom, dedup_mode)
# dedup_mode: None = index every feature, "name" = deduplicate multi-segment lines/zones by normalized title
GEOJSON_LAYER_CONFIGS: list[tuple[str, str, str, str, str, str, int, Optional[str]]] = [
    ("schools", "schools", "schools", "學校", "🏫", "schools", 16, None),
    ("libraries", "libraries", "libraries", "圖書館", "📚", "libraries", 16, None),
    ("museums", "museums", "museums", "博物館", "🏛️", "museums", 16, None),
    ("hospitals", "hospitals", "hospitals", "醫療機構", "🏥", "hospitals", 15, None),
    ("police", "police", "police", "警察局", "👮", "police", 16, None),
    ("fire_halls", "fire_halls", "fire_halls", "消防局", "🚒", "fireHalls", 16, None),
    ("disaster_hubs", "disaster_hubs", "disaster_hubs", "災害支援中心", "🛟", "disasterHubs", 16, None),
    ("aed", "aed", "aed", "AED 去顫器", "💓", "aed", 17, None),
    ("parks", "parks", "parks", "公園", "🌲", "parks", 15, None),
    ("parks_facilities", "parks_facilities", "parks_facilities", "公園設施", "🛝", "parksFacilities", 16, None),
    ("community_gardens", "community_gardens", "community_gardens", "社區花園", "🌻", "communityGardens", 16, None),
    ("community_centres", "community_centres", "community_centres", "社區中心", "🏛️", "communityCentres", 16, None),
    ("beach_water", "beach_water_quality", "beach_water_quality", "海灘水質", "🏖️", "beachWaterQuality", 15, None),
    ("public_washrooms", "public_washrooms", "public_washrooms", "公共洗手間", "🚻", "publicWashrooms", 17, None),
    ("drinking_fountains", "drinking_fountains", "drinking_fountains", "飲水器", "💧", "drinkingFountains", 17, None),
    ("food_banks", "food_banks", "food_banks", "食物援助", "🥫", "foodBanks", 16, None),
    ("food_vendors", "food_vendors", "food_vendors", "食品攤販", "🍱", "foodVendors", 17, None),
    ("homeless_shelters", "homeless_shelters", "homeless_shelters", "無家者庇護所", "🏠", "homelessShelters", 16, None),
    ("recycling", "recycling", "recycling", "環保回收", "♻️", "recycling", 16, None),
    ("garbage_collection", "garbage_collection", "garbage_collection", "廢物回收分區", "🚛", "garbageCollection", 14, "name"),
    ("van_wifi", "van_wifi", "van_wifi", "VanWiFi", "📶", "vanWifi", 17, None),
    ("public_art", "public_art", "public_art", "公共藝術", "🎨", "publicArt", 17, None),
    ("banks", "banks", "banks", "銀行", "🏦", "banks", 16, None),
    ("canada_post", "canada_post", "canada_post", "Canada Post", "📮", "canadaPost", 16, None),
    ("fedex", "fedex", "fedex", "FedEx", "📦", "canadaPost", 16, None),
    ("purolator", "purolator", "purolator", "Purolator", "📦", "canadaPost", 16, None),
    ("fuel", "fuel", "fuel", "油站", "⛽", "fuel", 16, None),
    ("tesla", "tesla", "tesla", "Tesla 充電站", "⚡", "tesla", 16, None),
    ("ev_charging", "ev_charging", "ev_charging", "電動車充電站", "⚡", "evCharging", 16, None),
    ("impark", "impark", "impark", "ImPark 停車場", "🅿️", "impark", 16, None),
    ("accessible_parking", "accessible_parking", "accessible_parking", "無障礙停車位", "♿", "accessibleParking", 17, None),
    ("motorcycle_parking", "motorcycle_parking", "motorcycle_parking", "摩托車停車位", "🏍️", "motorcycleParking", 17, None),
    ("car_sharing", "car_sharing", "car_sharing", "共享汽車", "🚗", "carSharing", 16, None),
    ("shared_bikes", "shared_bikes", "shared_bikes", "Mobi 共享單車", "🚲", "sharedBikes", 16, None),
    ("escooter", "escooter", "escooter", "Lime 共享滑板車", "🛴", "escooter", 17, None),
    ("bikeways", "bikeways", "bikeways", "單車徑", "🚲", "bikeways", 15, "name"),
    ("bike_racks", "bike_racks", "bike_racks", "單車架", "🚲", "bikeRacks", 17, None),
    ("marine_terminals", "marine_terminals", "marine_terminals", "港口貨運碼頭", "⚓", "marineTerminals", 15, None),
    ("railways", "railways", "railways", "鐵路軌道", "🚆", "railways", 14, "name"),
    ("traffic_cameras", "traffic_cameras", "traffic_cameras", "交通攝影機", "📷", "trafficCameras", 16, None),
    ("safety_cameras", "safety_cameras", "safety_cameras", "路口安全相機", "🚨", "safetyCameras", 16, None),
    ("traffic_conditions", "traffic_conditions", "traffic_conditions", "主要幹道路況", "🛣️", "trafficConditions", 14, "name"),
    ("traffic_alerts", "traffic_alerts", "traffic_alerts", "即時交通通報", "⚠️", "trafficAlerts", 15, None),
    ("road_closures", "road_closures", "road_closures", "道路封閉", "🚧", "roadClosures", 16, None),
    ("road_construction", "road_construction", "road_construction", "道路施工", "🏗️", "roadConstruction", 16, None),
    ("snow_removal_routes", "snow_removal_routes", "snow_removal_routes", "優先鏟雪路線", "❄️", "snowRemovalRoutes", 15, "name"),
    ("one_way_streets", "one_way_streets", "one_way_streets", "單向行車路段", "⬆️", "oneWayStreets", 16, "name"),
    ("traffic_speed_limits", "traffic_speed_limits", "traffic_speed_limits", "速限路段", "🚦", "trafficSpeedLimits", 15, "name"),
    ("truck_routes", "truck_routes_restriction", "truck_routes_restriction", "貨車路線與限制", "🚛", "truckRoutes", 16, "point_or_name"),
    ("traffic_turn_restrictions", "turn_restrictions", "turn_restrictions", "轉向限制路口", "🚫", "turnRestrictions", 17, None),
    ("traffic_signals", "traffic_signals", "traffic_signals", "交通信號燈", "🚦", "trafficSignals", 17, None),
    ("traffic_crosswalks", "traffic_crosswalks", "traffic_crosswalks", "行人穿越道", "🚶", "trafficCrosswalks", 17, None),
    ("litter_containers", "litter_containers", "litter_containers", "公共垃圾箱", "🗑️", "litterContainers", 17, None),
    ("fire_hydrants", "fire_hydrants", "fire_hydrants", "消防栓", "🧯", "fireHydrants", 17, "name"),
    ("local_area_boundary", "local_area_boundary", "local_area_boundary", "區域邊界", "📍", "localAreaBoundary", 14, "name"),
    ("postal_code_fsa", "postal_code_fsa", "postal_code_fsa", "郵遞編號分區", "📮", "postalCodeFSA", 13, "name"),
    ("crime_areas", "crime_areas", "crime_areas", "社區治安統計", "🛡️", "crimeAreas", 14, "name"),
    ("zoning_districts", "zoning_districts", "zoning_districts", "土地規劃分區", "🗺️", "zoningDistricts", 15, "name"),
]

_LAYER_ALIAS_KEYWORDS: dict[str, str] = {
    "canada_post": "canada post 郵寄 郵局 郵政 post office canadapost 寄件 包裹 信箱",
    "fedex": "fedex 聯邦快遞 郵寄 快遞 courier 寄件 包裹",
    "purolator": "purolator 郵寄 快遞 courier 寄件 包裹",
    "banks": "銀行 bank banks atm 櫃員機 自動櫃員機 提款機 分行",
    "fuel": "油站 加油站 汽油 柴油 gas station fuel petrol",
    "tesla": "tesla 特斯拉 超級充電 目的地充電 supercharger ev charger",
    "ev_charging": "充電 充電站 充電樁 電動車 ev charging charger",
    "impark": "停車場 泊車 時租 月租 impark parking lot",
    "accessible_parking": "無障礙車位 殘障車位 傷健車位 accessible parking disability",
    "motorcycle_parking": "摩托車 電單車 重機 停車位 motorcycle parking",
    "parking_meters": "停車收費錶 咪錶 路邊泊車 parking meter paybyphone",
    "car_sharing": "共享汽車 租車 car sharing evo modo",
    "shared_bikes": "共享單車 單車 腳踏車 mobi bike share",
    "escooter": "共享滑板車 電動滑板車 lime escooter scooter",
    "bikeways": "單車徑 單車道 綠道 bikeway greenway bike route",
    "bike_racks": "單車架 停單車 bike rack",
    "public_washrooms": "公共洗手間 洗手間 公廁 廁所 衛生間 washroom toilet restroom",
    "drinking_fountains": "飲水器 飲水機 直飲水 water fountain drinking fountain",
    "food_vendors": "食品攤販 餐車 街頭小食 food vendor food truck",
    "food_banks": "食物援助 食物銀行 免費餐點 food bank",
    "homeless_shelters": "無家者庇護所 庇護所 避難所 shelter",
    "community_centres": "社區中心 活動中心 community centre center",
    "libraries": "圖書館 借書 自修室 library vpl",
    "schools": "學校 小學 中學 高中 大學 學院 school elementary secondary",
    "museums": "博物館 美術館 展覽館 museum gallery",
    "parks": "公園 綠地 森林 park",
    "parks_facilities": "公園設施 球場 網球場 籃球場 泳池 遊樂場 playground court",
    "community_gardens": "社區花園 農圃 community garden",
    "beach_water_quality": "海灘 泳灘 沙灘 水質 大腸桿菌 beach swimming",
    "police": "警察局 警局 報案 治安 police vpd",
    "fire_halls": "消防局 消防隊 救火 fire hall rescue",
    "hospitals": "醫院 醫療機構 診所 急症 急診 upcc hospital clinic emergency",
    "disaster_hubs": "災害支援中心 緊急集合點 防災 disaster hub earthquake",
    "aed": "aed 自動體外心臟去顫器 急救 defibrillator",
    "van_wifi": "vanwifi wifi 免費無線上網 free wifi",
    "recycling": "環保回收 回收站 退瓶 return-it recycling depot",
    "garbage_collection": "廢物回收 垃圾收集 清運分區 garbage collection zone",
    "public_art": "公共藝術 雕塑 壁畫 裝置藝術 public art sculpture mural",
    "traffic_cameras": "交通攝影機 路況鏡頭 即時畫面 traffic camera webcam",
    "safety_cameras": "路口安全相機 衝紅燈 測速照相 red light speed camera",
    "road_closures": "道路封閉 封路 交通管制 road closure",
    "road_construction": "道路施工 修路 工程 road construction",
    "snow_removal_routes": "鏟雪路線 除雪 優先清雪 snow removal route",
    "one_way_streets": "單向行車 單行道 one way street",
    "railways": "鐵路 火車 貨運鐵路 railway train track cn cp cpkc bnsf via",
    "crime_areas": "治安 罪案率 犯罪統計 crime rate neighbourhood",
    "postal_code_fsa": "郵遞編號 郵遞區號 郵編 postal code fsa",
    "local_area_boundary": "區域邊界 社區分區 neighbourhood boundary",
    "zoning_districts": "土地規劃 分區管制 zoning district",
}

_NEIGHBOURHOOD_ZH_ALIASES: dict[str, str] = {
    "arbutus ridge": "楊梅嶺",
    "downtown": "市中心 溫哥華市中心",
    "downtown eastside": "市中心東端 dtes",
    "dunbar-southlands": "登巴 南地 dunbar southlands",
    "fairview": "美景 費爾維尤 百老匯醫療區",
    "grandview-woodland": "格蘭維尤 商業街 commercial drive",
    "hastings-sunrise": "喜士定日出 pne",
    "kensington-cedar cottage": "肯辛頓 雪松屋",
    "kerrisdale": "克里斯代爾",
    "killarney": "基拉尼",
    "kitsilano": "基斯蘭奴 kits",
    "marpole": "馬寶區 馬波爾",
    "mount pleasant": "快樂山 mt pleasant",
    "oakridge": "橡樹嶺",
    "renfrew-collingwood": "倫弗魯 科林伍德 joyce",
    "riley park": "萊利公園 main street",
    "shaughnessy": "桑拿斯 肖內西",
    "south cambie": "南甘比",
    "strathcona": "士達孔拿 華埠 唐人街",
    "sunset": "日落區 南溫哥華",
    "victoria-fraserview": "維多利亞 菲沙景",
    "west end": "西端 英吉利灣 史丹利",
    "west point grey": "西灰角 ubc jericho",
}


def _extract_representative_coord(geom: dict[str, Any], props: dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    gp = props.get("geo_point_2d")
    if isinstance(gp, dict) and gp.get("lon") is not None and gp.get("lat") is not None:
        try:
            return float(gp["lon"]), float(gp["lat"])
        except (TypeError, ValueError):
            pass

    if not geom:
        return None, None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "GeometryCollection":
        for sub_g in geom.get("geometries") or []:
            lon, lat = _extract_representative_coord(sub_g, {})
            if lon is not None and lat is not None:
                return lon, lat
        return None, None

    if not coords:
        return None, None
    if gtype == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
        return float(coords[0]), float(coords[1])

    pts: list[tuple[float, float]] = []

    def _collect(c: Any) -> None:
        if isinstance(c, (list, tuple)):
            if len(c) >= 2 and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float)):
                pts.append((float(c[0]), float(c[1])))
            else:
                for sub in c:
                    _collect(sub)

    _collect(coords)
    if not pts:
        return None, None
    if gtype in ("LineString", "MultiLineString"):
        mid = pts[len(pts) // 2]
        return mid[0], mid[1]
    min_lon = min(p[0] for p in pts)
    max_lon = max(p[0] for p in pts)
    min_lat = min(p[1] for p in pts)
    max_lat = max(p[1] for p in pts)
    return (min_lon + max_lon) * 0.5, (min_lat + max_lat) * 0.5


# ---------------------------------------------------------------------------
# 5. In-Memory Inverted Index Snapshot & Search Engine
# ---------------------------------------------------------------------------
class _IndexSnapshot:
    __slots__ = (
        "docs",
        "word_index",
        "prefix_index",
        "cjk_char_index",
        "category_index",
        "code_index",
        "built_at",
        "max_mtime",
    )

    def __init__(self) -> None:
        self.docs: list[SearchDoc] = []
        self.word_index: dict[str, set[int]] = defaultdict(set)
        self.prefix_index: dict[str, set[int]] = defaultdict(set)
        self.cjk_char_index: dict[str, set[int]] = defaultdict(set)
        self.category_index: dict[str, list[int]] = defaultdict(list)
        self.code_index: dict[str, list[int]] = defaultdict(list)
        self.built_at: float = 0.0
        self.max_mtime: float = 0.0


class LayerSearchEngine:
    def __init__(self, base_dir: str) -> None:
        self.base_dir = base_dir
        self.data_dir = os.path.join(base_dir, "data")
        self._snapshot: Optional[_IndexSnapshot] = None
        self._build_lock = threading.Lock()
        self._reloading = False
        self._last_mtime_check = 0.0

        # Query result cache (quantized by normalized q + rounded lat/lon)
        self._cache_lock = threading.Lock()
        self._query_cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()
        self._addr_cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()

        # Persistent HTTP session for City of Vancouver civic address OpenData API
        self._http = requests.Session()
        adapter = HTTPAdapter(pool_connections=4, pool_maxsize=8, max_retries=0)
        self._http.mount("https://", adapter)
        self._http.mount("http://", adapter)
        self._http.headers.update({"User-Agent": "VancouverGodsEye-Search/2.0"})

    # ------------------------------------------------------------------
    # Index Construction & Non-Blocking Hot Reload
    # ------------------------------------------------------------------
    def _compute_latest_data_mtime(self) -> float:
        latest = 0.0
        try:
            for entry in os.scandir(self.data_dir):
                if entry.name.endswith((".geojson", ".json")):
                    try:
                        mt = entry.stat().st_mtime
                        if mt > latest:
                            latest = mt
                    except OSError:
                        pass
        except OSError:
            pass
        return latest

    def ensure_ready(
        self,
        gtfs_provider: Optional[Callable[[], dict[str, Any]]] = None,
        db_session_factory: Optional[Callable[[], Any]] = None,
    ) -> _IndexSnapshot:
        snap = self._snapshot
        now = time.time()
        if snap is not None:
            if now - self._last_mtime_check > 25.0 and not self._reloading:
                self._last_mtime_check = now
                latest_mt = self._compute_latest_data_mtime()
                if latest_mt > snap.max_mtime:
                    self._reloading = True
                    threading.Thread(
                        target=self._rebuild_background,
                        args=(gtfs_provider, db_session_factory),
                        daemon=True,
                    ).start()
            return snap

        with self._build_lock:
            if self._snapshot is None:
                self._snapshot = self._build_snapshot(gtfs_provider, db_session_factory)
                self._last_mtime_check = time.time()
            return self._snapshot

    def _rebuild_background(
        self,
        gtfs_provider: Optional[Callable[[], dict[str, Any]]],
        db_session_factory: Optional[Callable[[], Any]],
    ) -> None:
        try:
            with self._build_lock:
                new_snap = self._build_snapshot(gtfs_provider, db_session_factory)
                self._snapshot = new_snap
                with self._cache_lock:
                    self._query_cache.clear()
        except Exception as exc:
            print(f"[SearchEngine] Background index reload error: {exc}")
        finally:
            self._reloading = False

    def _add_doc(
        self,
        snap: _IndexSnapshot,
        *,
        item_id: str,
        title: str,
        subtitle: str,
        category: str,
        badge: str,
        icon: str,
        lon: float,
        lat: float,
        zoom: int,
        layer_key: Optional[str],
        meta: dict[str, Any],
        addr_text: str = "",
        extra_keywords: str = "",
        exact_codes: Optional[list[str]] = None,
    ) -> None:
        doc_id = len(snap.docs)
        title_clean = title.strip()
        sub_clean = subtitle.strip()
        addr_clean = addr_text.strip()

        title_toks, norm_title = extract_tokens_and_phrase(title_clean)
        addr_toks, norm_addr = extract_tokens_and_phrase(addr_clean)
        sub_toks, norm_sub = extract_tokens_and_phrase(sub_clean)

        combined_raw = f"{title_clean} {addr_clean} {sub_clean} {extra_keywords}"
        lower_combined = combined_raw.lower()
        lower_title = title_clean.lower()
        landmark_injected: list[str] = []
        title_landmark_injected: list[str] = []
        for phrase, bonus_kw in _LANDMARK_PHRASE_ALIASES:
            if phrase in lower_combined:
                landmark_injected.append(bonus_kw)
                if phrase in lower_title:
                    title_landmark_injected.append(bonus_kw)
        if landmark_injected:
            combined_raw = f"{combined_raw} {' '.join(landmark_injected)}"

        all_base_toks, _ = extract_tokens_and_phrase(combined_raw)
        expanded_words, cjk_chars = expand_index_tokens(all_base_toks)
        if title_landmark_injected:
            t_with_alias_toks, _ = extract_tokens_and_phrase(f"{title_clean} {' '.join(title_landmark_injected)}")
            title_expanded, _ = expand_index_tokens(t_with_alias_toks)
        else:
            title_expanded, _ = expand_index_tokens(title_toks)
        addr_expanded, _ = expand_index_tokens(addr_toks)

        tier_bonus = CATEGORY_TIER_BONUS.get(category, 10)
        if category == "bus_stop" and "unload" in lower_title:
            tier_bonus = max(1, tier_bonus - 10)

        doc = SearchDoc(
            doc_id=doc_id,
            id=item_id,
            title=title_clean,
            subtitle=sub_clean,
            category=category,
            badge=badge,
            icon=icon,
            lon=float(lon),
            lat=float(lat),
            zoom=zoom,
            layer_key=layer_key,
            meta=meta,
            norm_title=norm_title,
            norm_addr=norm_addr,
            norm_sub=norm_sub,
            title_tokens=frozenset(title_expanded),
            addr_tokens=frozenset(addr_expanded),
            all_tokens=frozenset(expanded_words),
            tier_bonus=tier_bonus,
        )
        snap.docs.append(doc)
        snap.category_index[category].append(doc_id)

        for w in expanded_words:
            snap.word_index[w].add(doc_id)
            # Build 1..6 character ASCII prefixes for instant typeahead
            if w.isascii():
                max_plen = min(len(w), 6)
                min_plen = 1 if (tier_bonus >= 20 or len(w) <= 3) else 2
                for plen in range(min_plen, max_plen + 1):
                    snap.prefix_index[w[:plen]].add(doc_id)

        for ch in cjk_chars:
            snap.cjk_char_index[ch].add(doc_id)

        if exact_codes:
            for raw_code in exact_codes:
                if raw_code:
                    c_norm = str(raw_code).strip().lower().lstrip("#")
                    if c_norm:
                        snap.code_index[c_norm].append(doc_id)
                        snap.word_index[c_norm].add(doc_id)

    def _build_snapshot(
        self,
        gtfs_provider: Optional[Callable[[], dict[str, Any]]],
        db_session_factory: Optional[Callable[[], Any]],
    ) -> _IndexSnapshot:
        t0 = time.perf_counter()
        snap = _IndexSnapshot()
        snap.max_mtime = self._compute_latest_data_mtime()

        # 1. Airports (from vancouver_airports.geojson with full popup properties)
        airports_path = os.path.join(self.data_dir, "vancouver_airports.geojson")
        indexed_airports = False
        if os.path.exists(airports_path):
            try:
                with open(airports_path, "r", encoding="utf-8") as f:
                    adata = json.load(f)
                for feat in adata.get("features", []):
                    props = feat.get("properties") or {}
                    lon, lat = _extract_representative_coord(feat.get("geometry") or {}, props)
                    if lon is None or lat is None:
                        continue
                    iata = str(props.get("iata") or "").strip()
                    icao = str(props.get("icao") or "").strip()
                    name = str(props.get("name") or "機場").strip()
                    name_en = str(props.get("name_en") or "").strip()
                    sub = f"{name_en} · {icao} / {iata}".strip(" ·/")
                    is_main_intl = props.get("sub_type") == "international_airport" or feat.get("id") == "airport_yvr_main"
                    ap_codes = [iata, icao] if is_main_intl else ([f"{iata} south"] if props.get("sub_type") == "south_terminal" else [iata, icao])
                    self._add_doc(
                        snap,
                        item_id=str(feat.get("id") or props.get("id") or f"airport_{iata}"),
                        title=name,
                        subtitle=sub,
                        category="airports",
                        badge=str(props.get("badge") or "機場"),
                        icon=str(props.get("icon") or "🛫"),
                        lon=lon,
                        lat=lat,
                        zoom=14,
                        layer_key="airports",
                        meta=props,
                        addr_text=str(props.get("address") or ""),
                        extra_keywords=f"{name_en} {iata} {icao} {props.get('local_area', '')} {props.get('operators', '')} 機場 飛機場 水上飛機 airport seaplane",
                        exact_codes=ap_codes,
                    )
                    indexed_airports = True
            except Exception as exc:
                print(f"[SearchEngine] Airport index warning: {exc}")

        if not indexed_airports:
            self._add_doc(
                snap,
                item_id="airport_yvr_main",
                title="溫哥華國際機場 (YVR) · 主航廈",
                subtitle="Vancouver International Airport · CYVR / YVR",
                category="airports",
                badge="國際機場",
                icon="🛫",
                lon=-123.184444,
                lat=49.193889,
                zoom=14,
                layer_key="airports",
                meta={"iata": "YVR", "icao": "CYVR"},
                extra_keywords="yvr cyvr vancouver airport 溫哥華機場 國際機場 飛機場 richmond sea island",
                exact_codes=["yvr", "cyvr"],
            )

        # 2. BC Ferries Terminals
        for term in SEARCH_BC_FERRY_TERMINALS:
            self._add_doc(
                snap,
                item_id=term["id"],
                title=term["title"],
                subtitle=term["subtitle"],
                category="ferry_terminal",
                badge=term["badge"],
                icon=term["icon"],
                lon=term["lon"],
                lat=term["lat"],
                zoom=term["zoom"],
                layer_key=term["layer_key"],
                meta=term["meta"],
                extra_keywords=term["keywords"],
                exact_codes=term.get("codes"),
            )

        # 2.5 Bus Exchanges (巴士轉乘站)
        for exc in SEARCH_BUS_EXCHANGES:
            self._add_doc(
                snap,
                item_id=exc["id"],
                title=exc["title"],
                subtitle=exc["subtitle"],
                category=exc["category"],
                badge=exc["badge"],
                icon=exc["icon"],
                lon=exc["lon"],
                lat=exc["lat"],
                zoom=exc["zoom"],
                layer_key=exc["layer_key"],
                meta=exc["meta"],
                extra_keywords=exc["keywords"],
                exact_codes=[exc["meta"]["exchange_id"]],
            )

        # 3. Border Crossings (CBSA / CBP 5 Crossings)
        try:
            import border_service
            bsvc = getattr(border_service, "border_service", None) or border_service.BorderService()
            base_crossings = bsvc._get_base_crossings()
            for cid, cinfo in base_crossings.items():
                title_str = f"{cinfo['name']} ({cinfo['english_name']})"
                sub_str = f"美加邊境關卡 · {cinfo.get('highway', '')} · {cinfo.get('crossing_type', '')}"
                self._add_doc(
                    snap,
                    item_id=f"border_{cid}",
                    title=title_str,
                    subtitle=sub_str,
                    category="border_crossing",
                    badge="邊境關卡",
                    icon="🛂",
                    lon=cinfo["lon"],
                    lat=cinfo["lat"],
                    zoom=15,
                    layer_key=None,
                    meta={
                        "id": cid,
                        "facility_type": "border_crossing",
                        "name": cinfo["name"],
                        "local_area": cinfo.get("address", ""),
                        "properties": cinfo,
                    },
                    addr_text=cinfo.get("address", ""),
                    extra_keywords=f"邊境 關口 海關 通關 border crossing customs cbsa cbp nexus {cinfo.get('cbsa_key', '')} {cinfo.get('cbp_key', '')}",
                )
        except Exception as exc:
            print(f"[SearchEngine] Border crossings index warning: {exc}")

        # 4. North Shore Ski Resorts
        try:
            import ski_service
            for rcfg in getattr(ski_service, "RESORTS_CONFIG", []):
                r_id = rcfg["id"]
                self._add_doc(
                    snap,
                    item_id=f"ski_{r_id}",
                    title=f"{rcfg['name']} ({rcfg['english_name']})",
                    subtitle=f"滑雪度假村 · {rcfg.get('area', '')} · 垂直落差 {rcfg.get('vertical_drop', '')}",
                    category="ski_resort",
                    badge="滑雪場",
                    icon="🎿",
                    lon=rcfg["lon"],
                    lat=rcfg["lat"],
                    zoom=rcfg.get("zoom", 14),
                    layer_key=None,
                    meta={
                        "id": f"ski_{r_id}",
                        "facility_type": "ski_resort",
                        "name": rcfg["name"],
                        "local_area": rcfg.get("area", ""),
                        "properties": rcfg,
                    },
                    extra_keywords="滑雪 滑雪場 雪況 纜車 ski resort snowboard mountain",
                )
        except Exception as exc:
            print(f"[SearchEngine] Ski resorts index warning: {exc}")

        # 5. DFO Tide Stations
        try:
            import tides_service
            for scfg in getattr(tides_service, "STATIONS_CONFIG", []):
                self._add_doc(
                    snap,
                    item_id=f"tide_{scfg['id']}",
                    title=scfg["name"],
                    subtitle=f"潮汐與水位觀測站 #{scfg['code']} · {scfg.get('area', '')}",
                    category="tide_stations",
                    badge="潮汐觀測站",
                    icon="🌊",
                    lon=scfg["lon"],
                    lat=scfg["lat"],
                    zoom=14,
                    layer_key="tideStations",
                    meta={
                        "id": scfg["id"],
                        "facility_type": "tide_stations",
                        "name": scfg["name"],
                        "local_area": scfg.get("area", ""),
                        "properties": scfg,
                    },
                    extra_keywords=f"潮汐 漲潮 退潮 水位 觀測站 tide station water level {scfg['english_name']}",
                    exact_codes=[scfg["code"]],
                )
        except Exception as exc:
            print(f"[SearchEngine] Tide stations index warning: {exc}")

        # 6. TransLink GTFS Bus Routes, SkyTrain Stations, SeaBus Terminals & Bus Stops
        self._index_transit_network(snap, gtfs_provider, db_session_factory)

        # 7. All GeoJSON Layers (50+ urban, mobility, road, safety & boundary datasets)
        self._index_geojson_layers(snap)

        # 8. DB-backed Parking Meters (if PostgreSQL RoadFacility has parking_meters)
        if db_session_factory is not None:
            self._index_db_parking_meters(snap, db_session_factory)

        snap.built_at = time.time()
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        print(
            f"[SearchEngine] Indexed {len(snap.docs):,} searchable locations "
            f"({len(snap.word_index):,} tokens, {len(snap.prefix_index):,} prefixes) in {elapsed_ms:.1f} ms"
        )
        return snap

    def _index_transit_network(
        self,
        snap: _IndexSnapshot,
        gtfs_provider: Optional[Callable[[], dict[str, Any]]],
        db_session_factory: Optional[Callable[[], Any]],
    ) -> None:
        gtfs_meta: dict[str, Any] = {}
        if gtfs_provider is not None:
            try:
                gtfs_meta = gtfs_provider() or {}
            except Exception:
                gtfs_meta = {}
        if not gtfs_meta:
            gtfs_path = os.path.join(self.data_dir, "translink_gtfs_metadata.json")
            if os.path.exists(gtfs_path):
                try:
                    with open(gtfs_path, "r", encoding="utf-8") as f:
                        gtfs_meta = json.load(f)
                except Exception:
                    gtfs_meta = {}

        routes_lookup = gtfs_meta.get("routes") or {}
        variants_lookup = gtfs_meta.get("variants") or {}
        default_variants = gtfs_meta.get("route_default_variants") or {}

        # 6a. Bus Routes (by direction variant)
        seen_route_dirs: set[tuple[str, str]] = set()
        for r_id, r_info in routes_lookup.items():
            r_num = str(r_info.get("route_number") or "").strip()
            r_long = str(r_info.get("long_name") or "").strip()
            if not r_num or r_num in ("Canada Line", "Expo Line", "Millennium Line", "SeaBus", "WCE", "HD"):
                continue
            r_raw = str(r_info.get("raw_short_name") or "").strip()

            for d_id in ("0", "1"):
                vkey = default_variants.get(f"{r_id}_{d_id}")
                if not vkey or vkey not in variants_lookup:
                    for cand_k, cand_v in variants_lookup.items():
                        if cand_v.get("route_id") == r_id and cand_v.get("direction_id") == d_id:
                            vkey = cand_k
                            break
                if not vkey or vkey not in variants_lookup:
                    continue
                if (r_id, d_id) in seen_route_dirs:
                    continue
                seen_route_dirs.add((r_id, d_id))

                v_obj = variants_lookup[vkey]
                v_stops = v_obj.get("stops") or []
                dest = v_obj.get("destination") or r_long or "終點站"
                origin = v_obj.get("origin") or "起點站"
                if v_stops:
                    mid = v_stops[len(v_stops) // 2]
                    c_lon, c_lat = float(mid["lon"]), float(mid["lat"])
                else:
                    c_lon, c_lat = -123.1207, 49.2827

                is_rapid = r_num.upper().startswith("R") and len(r_num) <= 3
                is_night = r_num.upper().startswith("N") and len(r_num) <= 4
                badge = "RapidBus 快速巴士" if is_rapid else ("夜間巴士路線" if is_night else "巴士路線")
                dir_title = f"{r_num} · 往 {dest}" if dest else f"{r_num} {r_long}".strip()

                self._add_doc(
                    snap,
                    item_id=f"route_{r_id}_{d_id}",
                    title=dir_title,
                    subtitle=f"{badge} · {r_long} (由 {origin} 開出)".strip(" ·"),
                    category="bus_route",
                    badge=f"{r_num} 號巴士" if r_num.isdigit() else badge,
                    icon="🚌",
                    lon=c_lon,
                    lat=c_lat,
                    zoom=13,
                    layer_key="busRoutes",
                    meta={
                        "route_id": r_id,
                        "route_number": r_num,
                        "route_name": r_long,
                        "direction_id": d_id,
                        "variant_key": vkey,
                        "destination": dest,
                        "origin": origin,
                        "color": r_info.get("color", "#10b981"),
                    },
                    extra_keywords=f"{r_num} {r_long} bus route 巴士 公車 路線 {r_raw} {'rapidbus b-line 快速巴士' if is_rapid else ''}",
                    exact_codes=[r_num, r_raw] if r_raw else [r_num],
                )

        # 6b. SkyTrain Stations (from skytrain_network.json, deduplicated by clean station name)
        skytrain_station_ids: set[str] = set()
        skytrain_seen_names: dict[str, dict[str, Any]] = {}
        skynet_path = os.path.join(self.data_dir, "skytrain_network.json")
        if os.path.exists(skynet_path):
            try:
                with open(skynet_path, "r", encoding="utf-8") as f:
                    skynet = json.load(f)
                for pat in skynet.get("patterns") or []:
                    line_name = str(pat.get("line_name") or "SkyTrain").strip()
                    for st in pat.get("stations") or []:
                        sid = str(st.get("stop_id") or "").strip()
                        sname = str(st.get("name") or "").strip()
                        if not sid or not sname:
                            continue
                        skytrain_station_ids.add(sid)
                        norm_sname = sname.lower()
                        if norm_sname not in skytrain_seen_names:
                            skytrain_seen_names[norm_sname] = {
                                "stop_id": sid,
                                "name": sname,
                                "lat": float(st["lat"]),
                                "lon": float(st["lon"]),
                                "lines": [line_name],
                            }
                        elif line_name not in skytrain_seen_names[norm_sname]["lines"]:
                            skytrain_seen_names[norm_sname]["lines"].append(line_name)
            except Exception as exc:
                print(f"[SearchEngine] skytrain_network.json warning: {exc}")

        for st_obj in skytrain_seen_names.values():
            lines_str = " / ".join(st_obj["lines"])
            self._add_doc(
                snap,
                item_id=f"stop_{st_obj['stop_id']}",
                title=st_obj["name"],
                subtitle=f"SkyTrain 天車站 · {lines_str} (#{st_obj['stop_id']})",
                category="skytrain",
                badge="天車站",
                icon="🚇",
                lon=st_obj["lon"],
                lat=st_obj["lat"],
                zoom=16,
                layer_key="skytrainRoutes",
                meta={"stop_id": st_obj["stop_id"], "lines": st_obj["lines"]},
                extra_keywords=f"skytrain station 天車 天車站 地鐵 捷運 {lines_str}",
                exact_codes=[st_obj["stop_id"]],
            )

        # 6c. SeaBus Terminals
        seabus_terminals = [
            ("8035", "Waterfront Station SeaBus Terminal", "海上巴士碼頭 · 溫哥華市中心濱海站 (往返北溫 Lonsdale Quay)", -123.1118, 49.2861),
            ("8036", "Lonsdale Quay SeaBus Terminal", "海上巴士碼頭 · 北溫哥華朗斯代爾碼頭 (往返市中心 Waterfront)", -123.0815, 49.3105),
        ]
        for sb_id, sb_title, sb_sub, sb_lon, sb_lat in seabus_terminals:
            self._add_doc(
                snap,
                item_id=f"stop_{sb_id}",
                title=sb_title,
                subtitle=sb_sub,
                category="seabus",
                badge="海上巴士",
                icon="⛴️",
                lon=sb_lon,
                lat=sb_lat,
                zoom=16,
                layer_key="seabusRoutes",
                meta={"stop_id": sb_id},
                extra_keywords="seabus 海上巴士 渡輪 碼頭 translink north vancouver waterfront lonsdale",
                exact_codes=[sb_id],
            )

        # 6d. Bus Stops: Aggregate from GTFS variants (includes 5-digit stop_code + route numbers!)
        bus_stops_map: dict[str, dict[str, Any]] = {}
        for v_obj in variants_lookup.values():
            r_num = str(v_obj.get("route_number") or "").strip()
            for st in v_obj.get("stops") or []:
                sid = str(st.get("stop_id") or "").strip()
                if not sid or sid in skytrain_station_ids or sid in ("8035", "8036"):
                    continue
                existing = bus_stops_map.get(sid)
                if existing is None:
                    bus_stops_map[sid] = {
                        "stop_id": sid,
                        "stop_code": str(st.get("stop_code") or "").strip(),
                        "name": str(st.get("name") or "").strip(),
                        "lat": float(st["lat"]),
                        "lon": float(st["lon"]),
                        "routes": [r_num] if r_num else [],
                    }
                elif r_num and r_num not in existing["routes"] and len(existing["routes"]) < 10:
                    existing["routes"].append(r_num)

        # Also merge any extra stops from PostgreSQL TransitStop if DB is online
        if db_session_factory is not None:
            try:
                import models
                db = db_session_factory()
                try:
                    db_stops = db.query(
                        models.TransitStop.stop_id,
                        models.TransitStop.name,
                        models.TransitStop.lat,
                        models.TransitStop.lon,
                        models.TransitStop.stop_group,
                    ).all()
                    for sid, sname, slat, slon, stype in db_stops:
                        sid_s = str(sid).strip()
                        if not sid_s or slat is None or slon is None:
                            continue
                        if stype == "skytrain":
                            if sid_s not in skytrain_station_ids and (sname or "").lower() not in skytrain_seen_names:
                                skytrain_station_ids.add(sid_s)
                                self._add_doc(
                                    snap,
                                    item_id=f"stop_{sid_s}",
                                    title=sname,
                                    subtitle=f"SkyTrain 天車站 (#{sid_s})",
                                    category="skytrain",
                                    badge="天車站",
                                    icon="🚇",
                                    lon=float(slon),
                                    lat=float(slat),
                                    zoom=16,
                                    layer_key="skytrainRoutes",
                                    meta={"stop_id": sid_s},
                                    extra_keywords="skytrain station 天車 天車站 地鐵",
                                    exact_codes=[sid_s],
                                )
                        elif stype != "seabus" and sid_s not in bus_stops_map:
                            bus_stops_map[sid_s] = {
                                "stop_id": sid_s,
                                "stop_code": "",
                                "name": sname or f"Stop #{sid_s}",
                                "lat": float(slat),
                                "lon": float(slon),
                                "routes": [],
                            }
                finally:
                    db.close()
            except Exception:
                pass

        for bstop in bus_stops_map.values():
            scode = bstop["stop_code"]
            sid = bstop["stop_id"]
            routes_served = ", ".join(bstop["routes"][:6])
            code_label = f"站牌 #{scode}" if scode else f"ID #{sid}"
            sub = f"巴士站 · {code_label}" + (f" · 途經: {routes_served}" if routes_served else "")
            codes = [c for c in (scode, sid) if c]
            self._add_doc(
                snap,
                item_id=f"stop_{sid}",
                title=bstop["name"],
                subtitle=sub,
                category="bus_stop",
                badge="巴士站",
                icon="🚏",
                lon=bstop["lon"],
                lat=bstop["lat"],
                zoom=17,
                layer_key="busRoutes",
                meta={"stop_id": sid, "stop_code": scode, "routes": bstop["routes"]},
                addr_text="",
                extra_keywords=f"bus stop 巴士站 公車站 站牌 {routes_served}",
                exact_codes=codes,
            )

    def _load_neighbourhood_polygons(self) -> list[tuple[str, float, float, float, float, list[list[list[float]]]]]:
        """Load 22 City of Vancouver neighbourhood polygons for fast Point-in-Polygon local_area enrichment."""
        polys: list[tuple[str, float, float, float, float, list[list[list[float]]]]] = []
        bpath = os.path.join(self.data_dir, "vancouver_local_area_boundary.geojson")
        if not os.path.exists(bpath):
            return polys
        try:
            with open(bpath, "r", encoding="utf-8") as f:
                bdata = json.load(f)
            for feat in bdata.get("features") or []:
                name = str((feat.get("properties") or {}).get("name") or "").strip()
                geom = feat.get("geometry") or {}
                gtype = geom.get("type")
                coords = geom.get("coordinates") or []
                if not name or not coords:
                    continue
                rings: list[list[list[float]]] = []
                if gtype == "Polygon" and coords:
                    rings.append(coords[0])
                elif gtype == "MultiPolygon":
                    for poly in coords:
                        if poly:
                            rings.append(poly[0])
                if not rings:
                    continue
                xs = [pt[0] for ring in rings for pt in ring if len(pt) >= 2]
                ys = [pt[1] for ring in rings for pt in ring if len(pt) >= 2]
                if xs and ys:
                    polys.append((name, min(xs), max(xs), min(ys), max(ys), rings))
        except Exception:
            pass
        return polys

    @staticmethod
    def _resolve_neighbourhood(
        lon: float,
        lat: float,
        polys: list[tuple[str, float, float, float, float, list[list[list[float]]]]],
    ) -> str:
        for name, min_x, max_x, min_y, max_y, rings in polys:
            if lon < min_x or lon > max_x or lat < min_y or lat > max_y:
                continue
            for ring in rings:
                inside = False
                n = len(ring)
                j = n - 1
                for i in range(n):
                    xi, yi = ring[i][0], ring[i][1]
                    xj, yj = ring[j][0], ring[j][1]
                    if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
                        inside = not inside
                    j = i
                if inside:
                    return name
        return ""

    def _index_geojson_layers(self, snap: _IndexSnapshot) -> None:
        nb_polys = self._load_neighbourhood_polygons()
        for (
            fstem,
            search_cat,
            meta_ftype,
            badge_zh,
            icon,
            layer_key,
            zoom,
            dedup_mode,
        ) in GEOJSON_LAYER_CONFIGS:
            fpath = os.path.join(self.data_dir, f"vancouver_{fstem}.geojson")
            if not os.path.exists(fpath):
                continue
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as exc:
                print(f"[SearchEngine] Error reading {fpath}: {exc}")
                continue

            seen_dedup_keys: set[str] = set()
            alias_kw = _LAYER_ALIAS_KEYWORDS.get(search_cat, "")

            for feat in data.get("features") or []:
                props = feat.get("properties") or {}
                geom = feat.get("geometry") or {}
                gtype = geom.get("type")

                lon, lat = _extract_representative_coord(geom, props)
                if lon is None or lat is None:
                    continue

                raw_name = str(props.get("name") or "").strip()
                title = raw_name
                exact_codes: list[str] = []

                if fstem == "schools":
                    title = raw_name or "學校"
                elif fstem == "parks_facilities":
                    pname = str(props.get("park_name") or "").strip()
                    ftype_name = str(props.get("facility_type_name") or props.get("facility_type") or "").strip()
                    title = f"{pname} — {ftype_name}".strip(" —") if (pname and ftype_name and ftype_name != "parks_facilities") else (pname or raw_name or "公園設施")
                elif fstem == "drinking_fountains":
                    title = re.sub(r"^Fountain location:\s*", "", str(props.get("location") or props.get("park_or_site") or raw_name or "飲水器"), flags=re.I).strip()
                elif fstem == "public_washrooms":
                    title = re.sub(r"\s*(?:公園公廁|公廁|公共洗手間|洗手間)$", "", raw_name).strip() or raw_name or "公共洗手間"
                elif fstem == "zoning_districts":
                    zd = str(props.get("zoning_district") or raw_name or "").strip()
                    title = zd or "土地規劃分區"
                    if zd:
                        exact_codes.append(zd)
                elif fstem == "public_art":
                    title = str(props.get("title_of_work") or props.get("sitename") or raw_name or "公共藝術").strip()
                elif fstem == "motorcycle_parking":
                    mid = str(props.get("meter_id") or "").strip()
                    if mid:
                        exact_codes.append(mid)
                        title = f"摩托車位 #{mid}"
                    else:
                        title = raw_name or "摩托車停車位"
                elif fstem == "accessible_parking":
                    loc = str(props.get("location") or raw_name or "").strip()
                    title = loc or "無障礙停車位"
                elif fstem == "escooter":
                    snum = str(props.get("station_number") or "").strip()
                    sname = str(props.get("name") or props.get("station_name") or "").strip()
                    if snum:
                        exact_codes.append(snum)
                    title = f"Lime {snum} - {sname}".strip(" -") if sname else (raw_name or "Lime 共享滑板車")
                elif fstem == "shared_bikes":
                    sname = raw_name or str(props.get("station_name") or "Mobi 共享單車站")
                    sid = str(props.get("station_id") or props.get("id") or "").strip()
                    if sid and len(sid) <= 8:
                        exact_codes.append(sid)
                    title = sname
                elif fstem == "impark":
                    lnum = str(props.get("lot_number") or "").strip()
                    if lnum:
                        exact_codes.append(lnum)
                    title = str(props.get("lot_name") or (f"ImPark Lot #{lnum}" if lnum else "ImPark 停車場")).strip()
                elif fstem == "canada_post":
                    title = str(props.get("name") or props.get("postaladdress") or "Canada Post").strip()
                elif fstem == "fedex":
                    comp = str(props.get("company_name") or props.get("c_companyName") or "").strip()
                    fname = str(props.get("fedex_name") or raw_name or "FedEx").strip()
                    bldg = str(props.get("building") or props.get("c_building") or "").strip()
                    if comp and fname.lower() not in comp.lower():
                        title = f"{comp} ({fname})"
                    elif bldg and fname.lower() not in bldg.lower():
                        title = f"{bldg} ({fname})"
                    else:
                        title = comp or bldg or fname
                elif fstem == "purolator":
                    title = str(props.get("locationName") or raw_name or "Purolator").strip()
                elif fstem == "banks":
                    title = str(props.get("bank_full_name") or raw_name or "銀行").strip()
                elif fstem == "bikeways":
                    r_name = str(props.get("bike_route_name") or props.get("bikeway_name") or "").strip()
                    s_name = str(props.get("street_name") or "").strip()
                    if r_name and s_name and r_name.lower() != s_name.lower():
                        title = f"{r_name} ({s_name}) (單車徑)"
                    elif r_name:
                        title = f"{r_name} (單車徑)"
                    elif s_name:
                        title = f"{s_name} (單車徑)"
                    else:
                        title = str(raw_name or "單車徑").strip()
                    if not title or title == "(單車徑)":
                        continue
                elif fstem == "railways":
                    rname = raw_name
                    if not rname or rname.lower() == "unknown":
                        continue
                    zh_rail = {
                        "canadian pacific": "加拿大太平洋鐵路 (Canadian Pacific / CPKC)",
                        "canadian national": "加拿大國家鐵路 (Canadian National / CN)",
                        "burlington northern": "伯靈頓北方聖塔菲鐵路 (BNSF Railway)",
                        "via": "維亞鐵路客運線 (VIA Rail Canada)",
                        "downtown historical railway": "市中心歷史電車鐵路 (Downtown Historical Railway)",
                        "wisconsin central railway": "威斯康辛中央鐵路 (Wisconsin Central)",
                    }.get(rname.lower(), f"{rname} (鐵路軌道)")
                    title = zh_rail
                elif fstem == "snow_removal_routes":
                    sname = raw_name or str(props.get("street") or "").strip()
                    if not sname:
                        continue
                    title = sname
                elif fstem == "one_way_streets":
                    hblock = str(props.get("hblock") or raw_name or "").strip()
                    if not hblock:
                        continue
                    title = hblock
                elif fstem == "traffic_speed_limits":
                    hblock = str(props.get("hblock") or raw_name or "").strip()
                    if not hblock:
                        continue
                    title = hblock
                elif fstem == "traffic_turn_restrictions":
                    title = str(props.get("signal_location") or raw_name or "轉向限制路口").strip()
                elif fstem == "traffic_signals":
                    title = str(props.get("location") or raw_name or props.get("geo_local_area") or "交通信號燈").strip()
                elif fstem == "truck_routes":
                    if gtype != "Point" and not raw_name:
                        continue
                    title = raw_name or "貨車路線限制"
                elif fstem == "road_closures":
                    if raw_name.startswith("交通封閉項目 #") and not props.get("location"):
                        continue
                    title = re.sub(r"\s+", " ", raw_name).strip()
                elif fstem == "road_construction":
                    if raw_name.startswith("道路施工項目 #") and not props.get("location"):
                        continue
                    title = re.sub(r"\s+", " ", raw_name).strip()
                elif fstem == "local_area_boundary":
                    if not raw_name:
                        continue
                    zh_nb = _NEIGHBOURHOOD_ZH_ALIASES.get(raw_name.lower(), "")
                    zh_first = zh_nb.split()[0] if zh_nb else ""
                    title = f"{raw_name} ({zh_first})" if zh_first else f"{raw_name} (區域邊界)"
                elif fstem == "postal_code_fsa":
                    fsa = str(props.get("fsa") or "").strip()
                    if not fsa:
                        continue
                    exact_codes.append(fsa)
                    title = str(props.get("name") or f"郵遞編號分區 {fsa}").strip()
                elif fstem == "crime_areas":
                    title = str(props.get("name_zh") or raw_name or "社區治安分區").strip()
                elif fstem == "garbage_collection":
                    title = str(props.get("zone_name") or raw_name or "廢物回收分區").strip()
                elif fstem == "fire_hydrants":
                    street_h = re.sub(r"[&\s]+$", "", str(props.get("street") or raw_name or "")).strip()
                    if not street_h:
                        continue
                    title = f"消防栓 · {street_h}"

                if not title:
                    title = badge_zh

                # Deduplication for multi-segment linear/polygon datasets
                if dedup_mode == "name":
                    dkey = title.strip().lower()
                    if dkey in seen_dedup_keys:
                        continue
                    seen_dedup_keys.add(dkey)
                elif dedup_mode == "point_or_name" and gtype != "Point":
                    dkey = title.strip().lower()
                    if dkey in seen_dedup_keys:
                        continue
                    seen_dedup_keys.add(dkey)

                addr = str(
                    props.get("siteaddress")
                    or props.get("postaladdress")
                    or props.get("address1")
                    or (props.get("address") if isinstance(props.get("address"), str) else "")
                    or props.get("street_address")
                    or props.get("location")
                    or props.get("hblock")
                    or props.get("street")
                    or props.get("street_name")
                    or ""
                ).strip()
                if isinstance(props.get("address"), dict):
                    ad = props["address"]
                    addr = " ".join(
                        str(ad.get(k) or "") for k in ("streetNumber", "streetName", "streetType", "city", "postalCode")
                    ).strip()

                local_area = str(
                    props.get("local_area")
                    or props.get("geo_local_area")
                    or props.get("neighbourhood")
                    or ""
                ).strip()
                if (not local_area or local_area.lower() == "vancouver") and nb_polys and fstem != "local_area_boundary":
                    resolved_nb = self._resolve_neighbourhood(lon, lat, nb_polys)
                    if resolved_nb:
                        local_area = resolved_nb

                nb_zh = _NEIGHBOURHOOD_ZH_ALIASES.get(local_area.lower(), "") if local_area else ""
                if fstem == "local_area_boundary":
                    nb_zh = _NEIGHBOURHOOD_ZH_ALIASES.get(raw_name.lower(), "")

                cat_extra = str(
                    props.get("school_category_zh")
                    or props.get("facility_type_name")
                    or props.get("brand")
                    or props.get("operator")
                    or props.get("priority_zh")
                    or props.get("density_label")
                    or props.get("zoning_classification")
                    or ""
                ).strip()

                sub_parts = [badge_zh]
                if cat_extra and cat_extra != badge_zh and cat_extra not in title:
                    sub_parts.append(cat_extra)
                if addr and addr.lower() != title.lower():
                    sub_parts.append(addr)
                if local_area and local_area.lower() not in title.lower() and local_area.lower() not in addr.lower():
                    sub_parts.append(local_area)
                subtitle = " · ".join(sub_parts)

                raw_phone = str(
                    props.get("phone")
                    or (props.get("mainPhone", {}).get("display") if isinstance(props.get("mainPhone"), dict) else props.get("mainPhone"))
                    or props.get("phone_number")
                    or props.get("telephone")
                    or ""
                ).strip()
                phone_digits = re.sub(r"\D", "", raw_phone) if raw_phone else ""

                extra_fields = " ".join(
                    str(v)
                    for v in (
                        raw_name,
                        local_area,
                        nb_zh,
                        raw_phone,
                        phone_digits,
                        props.get("bank_name"),
                        props.get("bank_full_name"),
                        props.get("postal_code"),
                        props.get("organization"),
                        props.get("school_category"),
                        props.get("sitename"),
                        props.get("title_of_work"),
                        props.get("description"),
                        props.get("summary_text"),
                        props.get("clearance"),
                        props.get("fsa"),
                        props.get("zone_code"),
                        alias_kw,
                    )
                    if v
                )

                fac_id = str(feat.get("id") or props.get("id") or f"{fstem}_{lon:.5f}_{lat:.5f}")
                actual_meta_ftype = (
                    "truck_routes_restriction"
                    if fstem == "truck_routes" and gtype == "Point"
                    else meta_ftype
                )
                addr_for_index = "" if addr.lower() == title.lower() else addr

                self._add_doc(
                    snap,
                    item_id=fac_id,
                    title=title,
                    subtitle=subtitle,
                    category=search_cat,
                    badge=badge_zh,
                    icon=icon,
                    lon=lon,
                    lat=lat,
                    zoom=zoom,
                    layer_key=layer_key,
                    meta={
                        "id": fac_id,
                        "facility_type": actual_meta_ftype,
                        "name": title,
                        "local_area": local_area,
                        "properties": props,
                    },
                    addr_text=addr_for_index,
                    extra_keywords=extra_fields,
                    exact_codes=exact_codes if exact_codes else None,
                )

    def _index_db_parking_meters(
        self,
        snap: _IndexSnapshot,
        db_session_factory: Callable[[], Any],
    ) -> None:
        try:
            import models
            db = db_session_factory()
            try:
                meters = (
                    db.query(
                        models.RoadFacility.id,
                        models.RoadFacility.name,
                        models.RoadFacility.local_area,
                        models.RoadFacility.lat,
                        models.RoadFacility.lon,
                        models.RoadFacility.details,
                    )
                    .filter(models.RoadFacility.facility_type == "parking_meters")
                    .limit(12000)
                    .all()
                )
                for mid_pk, mname, marea, mlat, mlon, mdetails in meters:
                    if mlat is None or mlon is None:
                        continue
                    props = dict(mdetails) if isinstance(mdetails, dict) else {}
                    meter_num = str(props.get("meter_id") or "").strip()
                    addr = str(props.get("address") or props.get("street") or marea or "").strip()
                    title = f"收費錶 #{meter_num}" if meter_num else (mname or "停車收費錶")
                    sub_parts = ["停車收費錶"]
                    if addr:
                        sub_parts.append(addr)
                    if props.get("r_mf_9a_6p"):
                        sub_parts.append(f"日間 {props['r_mf_9a_6p']}")
                    self._add_doc(
                        snap,
                        item_id=str(mid_pk),
                        title=title,
                        subtitle=" · ".join(sub_parts),
                        category="parking_meters",
                        badge="停車收費錶",
                        icon="🅿️",
                        lon=float(mlon),
                        lat=float(mlat),
                        zoom=18,
                        layer_key="parkingMeters",
                        meta={
                            "id": str(mid_pk),
                            "facility_type": "parking_meters",
                            "name": title,
                            "local_area": marea or "",
                            "properties": props,
                        },
                        addr_text=addr,
                        extra_keywords="parking meter 停車收費錶 咪錶 paybyphone",
                        exact_codes=[meter_num] if meter_num else None,
                    )
            finally:
                db.close()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Dynamic Live Overlays (AIS Vessels & BC Ferries Live Fleet)
    # ------------------------------------------------------------------
    def _search_live_overlays(
        self,
        q_tokens: list[str],
        q_phrase: str,
        intent_cats: set[str],
        live_vessels: Optional[list[dict[str, Any]]],
        live_ferries: Optional[list[dict[str, Any]]],
    ) -> list[tuple[float, dict[str, Any]]]:
        scored_live: list[tuple[float, dict[str, Any]]] = []

        # 1. BC Ferries Live Vessels
        if live_ferries:
            ferry_intent = "ferry_vehicle" in intent_cats
            for fv in live_ferries:
                vname = str(fv.get("vessel_name") or "").strip()
                if not vname or fv.get("lat") is None or fv.get("lon") is None:
                    continue
                dep = str(fv.get("dep_name") or "")
                arr = str(fv.get("arr_name") or "")
                blob = to_traditional(f"{vname} {dep} {arr} bc ferries 渡輪 航行").lower()
                if ferry_intent or all(tok in blob for tok in q_tokens):
                    sc = 155.0 if vname.lower().startswith(q_phrase) else (125.0 if q_phrase in vname.lower() else 95.0)
                    scored_live.append(
                        (
                            sc,
                            {
                                "id": str(fv.get("id") or f"ferry_v_{vname}"),
                                "title": vname,
                                "subtitle": f"BC Ferries 航行船隻 · {dep} → {arr}".strip(" ·→"),
                                "category": "ferry_vehicle",
                                "badge": "BC Ferries 船隻",
                                "icon": "⛴️",
                                "lon": float(fv["lon"]),
                                "lat": float(fv["lat"]),
                                "zoom": 13,
                                "layer_key": "bcferriesVehicles",
                                "meta": fv,
                            },
                        )
                    )

        # 2. Live AIS Maritime Vessels
        if live_vessels:
            ship_intent = "maritime_vessel" in intent_cats
            matched_ships = 0
            for v in live_vessels:
                if matched_ships >= 12:
                    break
                vname = str(v.get("name") or "").strip()
                mmsi = str(v.get("mmsi") or "").strip()
                if not vname or v.get("lat") is None or v.get("lon") is None:
                    continue
                callsign = str(v.get("callsign") or "")
                dest = str(v.get("destination") or "")
                tname = str(v.get("type_name") or "商船")
                blob = to_traditional(f"{vname} {mmsi} {callsign} {dest} {tname} 商船 貨輪 船運").lower()
                if ship_intent or mmsi == q_phrase or all(tok in blob for tok in q_tokens):
                    sc = (
                        240.0
                        if mmsi == q_phrase
                        else (150.0 if vname.lower().startswith(q_phrase) else 100.0)
                    )
                    matched_ships += 1
                    scored_live.append(
                        (
                            sc,
                            {
                                "id": f"vessel_{mmsi}",
                                "title": vname,
                                "subtitle": f"{tname} · MMSI: {mmsi}" + (f" · 往 {dest}" if dest else ""),
                                "category": "maritime_vessel",
                                "badge": "海事船舶",
                                "icon": "🚢",
                                "lon": float(v["lon"]),
                                "lat": float(v["lat"]),
                                "zoom": 14,
                                "layer_key": "maritimeShipping",
                                "meta": v,
                            },
                        )
                    )

        return scored_live

    # ------------------------------------------------------------------
    # Smart Connection-Pooled Civic Address Lookup (City of Vancouver OpenData)
    # ------------------------------------------------------------------
    def _lookup_civic_addresses(self, raw_q: str, q_phrase: str) -> list[tuple[float, dict[str, Any]]]:
        with self._cache_lock:
            cached = self._addr_cache.get(q_phrase)
            if cached is not None:
                if time.time() - cached[0] < 1800.0:
                    self._addr_cache.move_to_end(q_phrase)
                    return cached[1]
                self._addr_cache.pop(q_phrase, None)

        safe_tokens = [re.sub(r"[^a-zA-Z0-9\-]", "", t) for t in raw_q.strip().split() if t][:6]
        safe_tokens = [t for t in safe_tokens if t]
        if not safe_tokens:
            return []

        safe_q = " ".join(safe_tokens)
        encoded_where = urllib.parse.quote(f'search(*, "{safe_q}")')
        url = (
            "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
            f"property-addresses/records?where={encoded_where}&limit=10"
        )

        items: list[tuple[float, dict[str, Any]]] = []
        try:
            resp = self._http.get(url, timeout=0.45)
            if resp.status_code == 200:
                records = resp.json().get("results") or []
                for idx, r in enumerate(records):
                    p_lon: Optional[float] = None
                    p_lat: Optional[float] = None
                    gp2d = r.get("geo_point_2d")
                    if isinstance(gp2d, dict) and gp2d.get("lon") is not None and gp2d.get("lat") is not None:
                        p_lon = float(gp2d["lon"])
                        p_lat = float(gp2d["lat"])
                    else:
                        pt = r.get("geom", {}).get("geometry", {}) if isinstance(r.get("geom"), dict) else {}
                        coords = pt.get("coordinates") or []
                        if len(coords) >= 2:
                            p_lon = float(coords[0])
                            p_lat = float(coords[1])

                    if p_lon is not None and p_lat is not None:
                        c_num = str(r.get("civic_number") or "").strip()
                        street = str(r.get("std_street") or "").strip()
                        full_addr = str(r.get("full_address") or f"{c_num} {street}").strip()
                        if not full_addr:
                            continue
                        local_area = str(r.get("geo_local_area") or "Vancouver").strip()
                        pcoord = str(r.get("site_id") or r.get("pcoord") or full_addr)
                        _, norm_full = extract_tokens_and_phrase(full_addr)
                        base_sc = 158.0 if norm_full.startswith(q_phrase) else 118.0
                        items.append(
                            (
                                base_sc - idx * 1.5,
                                {
                                    "id": f"addr_{pcoord}",
                                    "title": full_addr,
                                    "subtitle": f"溫哥華門牌地址 · {local_area}",
                                    "category": "address",
                                    "badge": "門牌地址",
                                    "icon": "🏠",
                                    "lon": p_lon,
                                    "lat": p_lat,
                                    "zoom": 17,
                                    "layer_key": None,
                                    "meta": {
                                        "id": f"addr_{pcoord}",
                                        "facility_type": "address",
                                        "name": full_addr,
                                        "civic_number": c_num,
                                        "street": street,
                                        "local_area": local_area,
                                        "full_address": full_addr,
                                        "properties": r,
                                    },
                                },
                            )
                        )
                with self._cache_lock:
                    if len(self._addr_cache) >= 600:
                        self._addr_cache.popitem(last=False)
                    self._addr_cache[q_phrase] = (time.time(), items)
        except Exception:
            pass
        return items

    # ------------------------------------------------------------------
    # Direct Coordinate Search ("49.2827, -123.1207")
    # ------------------------------------------------------------------
    def _handle_coordinate_query(
        self,
        snap: _IndexSnapshot,
        raw_q: str,
    ) -> Optional[list[dict[str, Any]]]:
        m = _COORD_QUERY_RE.match(raw_q)
        if not m:
            return None
        try:
            lat = float(m.group(1))
            ns = (m.group(2) or "").upper()
            lon = float(m.group(3))
            ew = (m.group(4) or "").upper()
            if ns == "S" and lat > 0:
                lat = -lat
            if ew == "W" and lon > 0:
                lon = -lon
            # Auto-swap if user pasted (lon, lat) in Vancouver range
            if -125.5 <= lat <= -121.0 and 48.0 <= lon <= 50.5:
                lat, lon = lon, lat
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                return None
        except ValueError:
            return None

        coord_title = f"{lat:.6f}, {lon:.6f}"
        results: list[dict[str, Any]] = [
            {
                "id": f"coord_{lat:.6f}_{lon:.6f}",
                "title": coord_title,
                "subtitle": "直接定位至經緯度坐標 · 點擊飛往此位置",
                "category": "coordinate",
                "ui_group": "area",
                "badge": "地理坐標",
                "icon": "📍",
                "lon": lon,
                "lat": lat,
                "zoom": 17,
                "layer_key": None,
                "distance_km": 0.0,
                "score": 999.0,
                "meta": {
                    "id": f"coord_{lat:.6f}_{lon:.6f}",
                    "facility_type": "coordinate",
                    "name": coord_title,
                    "local_area": "GPS 坐標定位",
                    "properties": {"lat": lat, "lon": lon},
                },
            }
        ]

        # Find nearest indexed POIs within 500m
        nearby: list[tuple[float, SearchDoc]] = []
        for doc in snap.docs:
            if abs(doc.lat - lat) > 0.0055 or abs(doc.lon - lon) > 0.0085:
                continue
            dkm = haversine_km(lat, lon, doc.lat, doc.lon)
            if dkm <= 0.55:
                nearby.append((dkm, doc))
        nearby.sort(key=lambda x: (x[0], -x[1].tier_bonus))
        for dkm, doc in nearby[:15]:
            results.append(self._serialize_doc(doc, score=300.0 - dkm * 100.0, distance_km=dkm))
        return results

    @staticmethod
    def _serialize_doc(doc: SearchDoc, score: float, distance_km: Optional[float]) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": doc.id,
            "title": doc.title,
            "subtitle": doc.subtitle,
            "category": doc.category,
            "ui_group": CATEGORY_UI_GROUP.get(doc.category, "poi"),
            "badge": doc.badge,
            "icon": doc.icon,
            "lon": doc.lon,
            "lat": doc.lat,
            "zoom": doc.zoom,
            "layer_key": doc.layer_key,
            "score": round(score, 1),
            "meta": doc.meta,
        }
        if distance_km is not None:
            payload["distance_km"] = round(distance_km, 2)
        return payload

    # ------------------------------------------------------------------
    # Primary Search Entry Point
    # ------------------------------------------------------------------
    def search(
        self,
        q: str,
        *,
        ref_lat: Optional[float] = None,
        ref_lon: Optional[float] = None,
        limit: int = 80,
        gtfs_provider: Optional[Callable[[], dict[str, Any]]] = None,
        db_session_factory: Optional[Callable[[], Any]] = None,
        live_vessels: Optional[list[dict[str, Any]]] = None,
        live_ferries: Optional[list[dict[str, Any]]] = None,
    ) -> list[dict[str, Any]]:
        if not q or not isinstance(q, str):
            return []
        raw_q = q.strip()[:100]
        if not raw_q:
            return []

        snap = self.ensure_ready(gtfs_provider, db_session_factory)

        # 1. Direct GPS Coordinate check ("49.2827, -123.1207")
        coord_res = self._handle_coordinate_query(snap, raw_q)
        if coord_res is not None:
            return coord_res[:limit]

        # Normalize query (Simplified -> Traditional, ordinals normalized)
        q_tokens, q_phrase = extract_tokens_and_phrase(raw_q)
        if not q_tokens:
            return []

        # Canadian 6-char postal code support ("V6B 2W9" or "V6B2W9" -> also match FSA "v6b")
        postal_m = _POSTAL_CODE_RE.match(raw_q)
        postal_fsa_code: Optional[str] = None
        if postal_m:
            postal_fsa_code = postal_m.group(1).lower()
            if postal_m.group(2) and postal_fsa_code not in q_tokens:
                q_tokens = [postal_fsa_code, postal_m.group(2).lower()]
                q_phrase = f"{postal_fsa_code} {postal_m.group(2).lower()}"

        has_ref_coords = (
            ref_lat is not None
            and ref_lon is not None
            and -90.0 <= ref_lat <= 90.0
            and -180.0 <= ref_lon <= 180.0
        )
        # Quantize ref coords to ~110m grid (3 decimal places) for high cache hit rate
        cache_key = (
            f"{q_phrase}|{round(ref_lat, 3)}|{round(ref_lon, 3)}|{limit}"
            if has_ref_coords
            else f"{q_phrase}|none|{limit}"
        )
        with self._cache_lock:
            cached_entry = self._query_cache.get(cache_key)
            if cached_entry is not None:
                if time.time() - cached_entry[0] < 45.0:
                    self._query_cache.move_to_end(cache_key)
                    return cached_entry[1]
                self._query_cache.pop(cache_key, None)

        # 2. Detect explicit Category Intents (e.g. "銀行", "洗手間", "tesla", "ev", "油站")
        trad_q_lower = to_traditional(raw_q).strip().lower().lstrip("#")
        intent_cats: set[str] = set()
        if trad_q_lower in CATEGORY_INTENTS:
            intent_cats.update(CATEGORY_INTENTS[trad_q_lower])
        if q_phrase in CATEGORY_INTENTS:
            intent_cats.update(CATEGORY_INTENTS[q_phrase])

        # Also check if multi-token query contains a category token + location token (e.g. "kitsilano 銀行" or "downtown washroom")
        sub_intent_cats: set[str] = set()
        non_intent_tokens: list[str] = []
        if not intent_cats and len(q_tokens) >= 2:
            for tok in q_tokens:
                if tok in CATEGORY_INTENTS:
                    sub_intent_cats.update(CATEGORY_INTENTS[tok])
                else:
                    non_intent_tokens.append(tok)

        # 3. Candidate Retrieval via Inverted Index Postings Intersection (Sub-Millisecond!)
        candidate_ids: set[int] = set()

        # 3a. Exact Code Matches (route numbers "99", "r4", stop pole "#50031", airport "yvr", FSA "v6b")
        exact_code_doc_ids: set[int] = set()
        for code_probe in {trad_q_lower, q_phrase, postal_fsa_code or ""}:
            if code_probe and code_probe in snap.code_index:
                exact_code_doc_ids.update(snap.code_index[code_probe])
        candidate_ids.update(exact_code_doc_ids)

        # 3b. Pure Category Intent (e.g. "銀行", "洗手間"): pull entire category in O(1)
        if intent_cats:
            for icat in intent_cats:
                candidate_ids.update(snap.category_index.get(icat, ()))

        # 3c. Token / Prefix / CJK Intersection across all query tokens
        explicit_ordinal_nums = {
            m.group(1) for m in re.finditer(r"\b(\d+)(?:st|nd|rd|th)\b", raw_q, re.IGNORECASE)
        }
        token_sets: list[set[int]] = []
        all_tokens_resolvable = True
        for idx, tok in enumerate(q_tokens):
            tset: set[int] = set()
            if tok in snap.word_index:
                tset |= snap.word_index[tok]
            if tok.isascii() and not (tok.isdigit() and tok in explicit_ordinal_nums):
                plen = min(len(tok), 6)
                if tok[:plen] in snap.prefix_index:
                    pk_docs = snap.prefix_index[tok[:plen]]
                    if len(tok) <= 6:
                        tset |= pk_docs
                    else:
                        # Verify full >6-char prefix against doc tokens
                        tset |= {
                            did
                            for did in pk_docs
                            if any(w.startswith(tok) for w in snap.docs[did].all_tokens)
                        }
            elif not tok.isascii() and _CJK_RUN_RE.match(tok):
                # Intersect individual CJK character postings for instant CJK substring match!
                char_sets = [snap.cjk_char_index[ch] for ch in tok if ch in snap.cjk_char_index]
                if len(char_sets) == len(tok):
                    char_sets.sort(key=len)
                    c_inter = set(char_sets[0])
                    for cs in char_sets[1:]:
                        c_inter &= cs
                    tset |= c_inter

            if not tset:
                all_tokens_resolvable = False
                break
            token_sets.append(tset)

        if all_tokens_resolvable and token_sets:
            token_sets.sort(key=len)
            inter = set(token_sets[0])
            for ts in token_sets[1:]:
                inter &= ts
                if not inter:
                    break
            candidate_ids |= inter
        elif postal_fsa_code and postal_fsa_code in snap.code_index:
            # e.g. user typed full postal code "V6B 9Z9" where "9z9" isn't in a static facility, still return FSA V6B!
            candidate_ids.update(snap.code_index[postal_fsa_code])

        # 4. Score All Candidates on Unified Multi-Field Scale
        scored_items: list[tuple[float, Optional[float], SearchDoc]] = []
        is_pure_category_query = bool(intent_cats) and len(q_tokens) == 1
        combined_intents = intent_cats | sub_intent_cats
        wants_financial_bank = "banks" in combined_intents and "food_banks" not in combined_intents
        tier4_cats = {
            "litter_containers",
            "fire_hydrants",
            "bike_racks",
            "traffic_signals",
            "traffic_crosswalks",
            "one_way_streets",
            "snow_removal_routes",
        }

        for did in candidate_ids:
            doc = snap.docs[did]
            score = float(doc.tier_bonus)

            # A. Exact Code Match
            if did in exact_code_doc_ids:
                score += 260.0

            # B. Explicit Category Intent Boost
            if doc.category in intent_cats:
                score += 145.0
            elif sub_intent_cats and doc.category in sub_intent_cats:
                score += 110.0
            elif wants_financial_bank and doc.category == "food_banks":
                score -= 80.0

            # C & D. Unified Title / Address Phrase Match (no double-counting when title == street)
            is_unrequested_tier4 = doc.category in tier4_cats and doc.category not in combined_intents
            phrase_scale = 0.42 if is_unrequested_tier4 else 1.0

            title_phrase_sc = 0.0
            if doc.norm_title == q_phrase:
                title_phrase_sc = 215.0 * phrase_scale
            elif doc.norm_title.startswith(q_phrase):
                title_phrase_sc = (155.0 + max(0.0, 20.0 - len(doc.title_tokens) * 2.0)) * phrase_scale
            elif q_phrase in doc.norm_title:
                title_phrase_sc = (115.0 + max(0.0, 14.0 - len(doc.title_tokens) * 1.5)) * phrase_scale

            addr_phrase_sc = 0.0
            if doc.norm_addr:
                if doc.norm_addr == q_phrase or doc.norm_addr.startswith(q_phrase):
                    addr_phrase_sc = 142.0 * phrase_scale
                elif q_phrase in doc.norm_addr:
                    addr_phrase_sc = 92.0 * phrase_scale

            score += max(title_phrase_sc, addr_phrase_sc)
            if title_phrase_sc > 0.0 and addr_phrase_sc > 0.0:
                score += 10.0

            # E. Per-Token Field Weighting
            title_hits = 0
            addr_hits = 0
            for tok in q_tokens:
                is_num = tok.isdigit()
                if tok in doc.title_tokens:
                    score += 36.0 if not is_unrequested_tier4 else 16.0
                    title_hits += 1
                elif not tok.isascii() and tok in doc.norm_title:
                    score += 32.0
                    title_hits += 1
                elif tok.isascii() and not is_num and any(w.startswith(tok) for w in doc.title_tokens):
                    score += 24.0 if not is_unrequested_tier4 else 12.0
                    title_hits += 1
                elif is_num and tok not in explicit_ordinal_nums and any(w.startswith(tok) for w in doc.title_tokens):
                    score += 6.0
                elif tok in doc.addr_tokens:
                    score += 22.0 if not is_unrequested_tier4 else 12.0
                    addr_hits += 1
                elif not tok.isascii() and tok in doc.norm_addr:
                    score += 20.0
                    addr_hits += 1
                elif tok.isascii() and not is_num and any(w.startswith(tok) for w in doc.addr_tokens):
                    score += 18.0 if not is_unrequested_tier4 else 10.0
                    addr_hits += 1
                else:
                    score += 9.0

            if title_hits == len(q_tokens):
                # All query tokens matched directly in title (or landmark title alias): conciseness bonus
                concise_bonus = 36.0 + max(0.0, 20.0 - len(doc.title_tokens) * 1.8)
                score += concise_bonus * phrase_scale
            elif title_hits + addr_hits == len(q_tokens):
                score += 18.0 * phrase_scale

            # F. Proximity Distance Calculation & Tie-Breaking
            dist_km: Optional[float] = None
            if has_ref_coords:
                dist_km = haversine_km(ref_lat, ref_lon, doc.lat, doc.lon)  # type: ignore[arg-type]
                if is_pure_category_query:
                    score += 55.0 / (1.0 + dist_km * 0.65)
                else:
                    score += 22.0 / (1.0 + dist_km * 0.45)

            scored_items.append((score, dist_km, doc))

        # 5. Live Overlays (AIS Ships & BC Ferries Live Fleet)
        live_hits = self._search_live_overlays(q_tokens, q_phrase, intent_cats, live_vessels, live_ferries)

        # 6. Smartly Gated Civic Address Lookup (NEVER blocks CJK, landmarks, codes, or category queries!)
        civic_hits: list[tuple[float, dict[str, Any]]] = []
        looks_like_civic_addr = bool(_CIVIC_ADDR_RE.match(raw_q))
        high_conf_local = sum(1 for sc, _, _ in scored_items if sc >= 145.0)
        should_query_civic = (
            looks_like_civic_addr
            or (
                raw_q.isascii()
                and len(q_phrase) >= 4
                and not intent_cats
                and not exact_code_doc_ids
                and high_conf_local < 3
            )
        )
        if should_query_civic:
            civic_hits = self._lookup_civic_addresses(raw_q, q_phrase)

        # 7. Merge, Sort Globally by Relevance, Deduplicate & Apply Category Diversity Guard
        merged: list[tuple[float, dict[str, Any]]] = []
        for sc, dkm, doc in scored_items:
            merged.append((sc, self._serialize_doc(doc, sc, dkm)))

        for sc, item in live_hits:
            if has_ref_coords:
                dkm = haversine_km(ref_lat, ref_lon, item["lat"], item["lon"])  # type: ignore[arg-type]
                item["distance_km"] = round(dkm, 2)
                sc += 18.0 / (1.0 + dkm * 0.4)
            item["ui_group"] = CATEGORY_UI_GROUP.get(item["category"], "transit")
            item["score"] = round(sc, 1)
            merged.append((sc, item))

        for sc, item in civic_hits:
            if has_ref_coords:
                dkm = haversine_km(ref_lat, ref_lon, item["lat"], item["lon"])  # type: ignore[arg-type]
                item["distance_km"] = round(dkm, 2)
                sc += 18.0 / (1.0 + dkm * 0.4)
            item["ui_group"] = "area"
            item["score"] = round(sc, 1)
            merged.append((sc, item))

        merged.sort(key=lambda x: (-x[0], x[1].get("distance_km", 9999.0)))

        explicit_bus_stop = "bus_stop" in intent_cats or "bus_stop" in sub_intent_cats or bool(exact_code_doc_ids)
        explicit_tier4 = bool(
            (intent_cats | sub_intent_cats)
            & {"traffic_signals", "traffic_crosswalks", "bike_racks", "litter_containers", "fire_hydrants"}
        )

        final_results: list[dict[str, Any]] = []
        deferred_overflow: list[dict[str, Any]] = []
        seen_dedup: set[tuple[str, str, int, int]] = set()
        cat_counts: dict[str, int] = defaultdict(int)

        for _, item in merged:
            cat = item["category"]
            if cat != "bus_route":
                dedup_sig = (
                    cat,
                    item["title"].strip().lower(),
                    int(round(item["lat"] * 500)),
                    int(round(item["lon"] * 500)),
                )
                if dedup_sig in seen_dedup:
                    continue
                seen_dedup.add(dedup_sig)

            # Diversity guard: keep top 12 suggestions diverse so bus stops / street hardware don't drown POIs
            if not explicit_bus_stop and cat == "bus_stop":
                if len(final_results) < 12 and cat_counts["bus_stop"] >= 3:
                    if len(deferred_overflow) < 15:
                        deferred_overflow.append(item)
                    continue
                if cat_counts["bus_stop"] >= 18:
                    continue

            if not explicit_tier4 and cat in (
                "traffic_signals",
                "traffic_crosswalks",
                "bike_racks",
                "litter_containers",
                "fire_hydrants",
            ):
                if len(final_results) < 15 and cat_counts[cat] >= 2:
                    if len(deferred_overflow) < 10:
                        deferred_overflow.append(item)
                    continue
                if cat_counts[cat] >= 10:
                    continue

            cat_counts[cat] += 1
            final_results.append(item)
            if len(final_results) >= limit:
                break

        if len(final_results) < limit and deferred_overflow:
            for ov in deferred_overflow:
                final_results.append(ov)
                if len(final_results) >= limit:
                    break

        with self._cache_lock:
            if len(self._query_cache) >= 400:
                self._query_cache.popitem(last=False)
            self._query_cache[cache_key] = (time.time(), final_results)

        return final_results


# Singleton engine instance
search_engine = LayerSearchEngine(os.path.dirname(os.path.abspath(__file__)))
