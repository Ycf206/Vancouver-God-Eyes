import urllib.request
import json
import os
import time
import datetime
import re

ALL_ALERTS_URL = "https://getaway.translink.ca/api/allalerts"
BANNER_ALERTS_URL = "https://getaway.translink.ca/api/webbanneralerts"

CACHE_FILE_BACKEND = os.path.join(os.path.dirname(__file__), "data", "vancouver_translink_alerts_cache.json")
CACHE_FILE_FRONTEND = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "public", "vancouver_translink_alerts_cache.json")
CACHE_TTL = 300  # 5 分鐘快取

_alerts_memory_cache = {
    "timestamp": 0,
    "data": None
}

# Known station names in Metro Vancouver SkyTrain & SeaBus network
KNOWN_STATIONS = [
    {"name": "Waterfront", "aliases": ["waterfront", "waterfront station", "waterfront 站"], "lines": ["Expo", "Canada", "SeaBus", "WCE"]},
    {"name": "Burrard", "aliases": ["burrard", "burrard station"], "lines": ["Expo"]},
    {"name": "Granville", "aliases": ["granville", "granville station"], "lines": ["Expo"]},
    {"name": "Stadium-Chinatown", "aliases": ["stadium chinatown", "stadium-chinatown", "stadium station"], "lines": ["Expo"]},
    {"name": "Main Street-Science World", "aliases": ["main street science world", "main street-science world", "main street station"], "lines": ["Expo"]},
    {"name": "Commercial-Broadway", "aliases": ["commercial broadway", "commercial-broadway", "commercial station"], "lines": ["Expo", "Millennium"]},
    {"name": "Nanaimo", "aliases": ["nanaimo", "nanaimo station"], "lines": ["Expo"]},
    {"name": "29th Avenue", "aliases": ["29th avenue", "29th ave station", "29th avenue station"], "lines": ["Expo"]},
    {"name": "Joyce-Collingwood", "aliases": ["joyce collingwood", "joyce-collingwood", "joyce station"], "lines": ["Expo"]},
    {"name": "Patterson", "aliases": ["patterson", "patterson station"], "lines": ["Expo"]},
    {"name": "Metrotown", "aliases": ["metrotown", "metrotown station"], "lines": ["Expo"]},
    {"name": "Royal Oak", "aliases": ["royal oak", "royal oak station"], "lines": ["Expo"]},
    {"name": "Edmonds", "aliases": ["edmonds", "edmonds station"], "lines": ["Expo"]},
    {"name": "22nd Street", "aliases": ["22nd street", "22nd st station", "22nd street station"], "lines": ["Expo"]},
    {"name": "New Westminster", "aliases": ["new westminster", "new west station", "new westminster station"], "lines": ["Expo"]},
    {"name": "Columbia", "aliases": ["columbia", "columbia station"], "lines": ["Expo"]},
    {"name": "Scott Road", "aliases": ["scott road", "scott road station"], "lines": ["Expo"]},
    {"name": "Gateway", "aliases": ["gateway", "gateway station"], "lines": ["Expo"]},
    {"name": "Surrey Central", "aliases": ["surrey central", "surrey central station"], "lines": ["Expo"]},
    {"name": "King George", "aliases": ["king george", "king george station"], "lines": ["Expo"]},
    {"name": "Sapperton", "aliases": ["sapperton", "sapperton station"], "lines": ["Expo"]},
    {"name": "Braid", "aliases": ["braid", "braid station"], "lines": ["Expo"]},
    {"name": "Lougheed Town Centre", "aliases": ["lougheed town centre", "lougheed town center", "lougheed station"], "lines": ["Expo", "Millennium"]},
    {"name": "Production Way-University", "aliases": ["production way university", "production way-university", "production way station"], "lines": ["Expo", "Millennium"]},
    {"name": "Lake City Way", "aliases": ["lake city way", "lake city station"], "lines": ["Millennium"]},
    {"name": "Sperling-Burnaby Lake", "aliases": ["sperling burnaby lake", "sperling-burnaby lake", "sperling station"], "lines": ["Millennium"]},
    {"name": "Holdom", "aliases": ["holdom", "holdom station"], "lines": ["Millennium"]},
    {"name": "Brentwood Town Centre", "aliases": ["brentwood town centre", "brentwood town center", "brentwood station"], "lines": ["Millennium"]},
    {"name": "Gilmore", "aliases": ["gilmore", "gilmore station"], "lines": ["Millennium"]},
    {"name": "Rupert", "aliases": ["rupert", "rupert station"], "lines": ["Millennium"]},
    {"name": "Renfrew", "aliases": ["renfrew", "renfrew station"], "lines": ["Millennium"]},
    {"name": "VCC-Clark", "aliases": ["vcc clark", "vcc-clark", "vcc clark station"], "lines": ["Millennium"]},
    {"name": "Lafarge Lake-Douglas", "aliases": ["lafarge lake douglas", "lafarge lake-douglas", "lafarge lake station"], "lines": ["Millennium"]},
    {"name": "Lincoln", "aliases": ["lincoln", "lincoln station"], "lines": ["Millennium"]},
    {"name": "Coquitlam Central", "aliases": ["coquitlam central", "coquitlam central station"], "lines": ["Millennium", "WCE"]},
    {"name": "Inlet Centre", "aliases": ["inlet centre", "inlet center", "inlet centre station"], "lines": ["Millennium"]},
    {"name": "Moody Centre", "aliases": ["moody centre", "moody center", "moody centre station"], "lines": ["Millennium", "WCE"]},
    {"name": "Burquitlam", "aliases": ["burquitlam", "burquitlam station"], "lines": ["Millennium"]},
    {"name": "Vancouver City Centre", "aliases": ["vancouver city centre", "vancouver city center", "city centre station"], "lines": ["Canada"]},
    {"name": "Yaletown-Roundhouse", "aliases": ["yaletown roundhouse", "yaletown-roundhouse", "yaletown station"], "lines": ["Canada"]},
    {"name": "Olympic Village", "aliases": ["olympic village", "olympic village station"], "lines": ["Canada"]},
    {"name": "Broadway-City Hall", "aliases": ["broadway city hall", "broadway-city hall", "city hall station"], "lines": ["Canada"]},
    {"name": "King Edward", "aliases": ["king edward", "king edward station"], "lines": ["Canada"]},
    {"name": "Oakridge-41st Avenue", "aliases": ["oakridge 41st", "oakridge-41st", "oakridge station"], "lines": ["Canada"]},
    {"name": "Langara-49th Avenue", "aliases": ["langara 49th", "langara-49th", "langara station"], "lines": ["Canada"]},
    {"name": "Marine Drive", "aliases": ["marine drive", "marine drive station"], "lines": ["Canada"]},
    {"name": "Bridgeport", "aliases": ["bridgeport", "bridgeport station"], "lines": ["Canada"]},
    {"name": "Templeton", "aliases": ["templeton", "templeton station"], "lines": ["Canada"]},
    {"name": "Sea Island Centre", "aliases": ["sea island centre", "sea island center", "sea island station"], "lines": ["Canada"]},
    {"name": "YVR-Airport", "aliases": ["yvr airport", "yvr-airport", "yvr station", "airport station"], "lines": ["Canada"]},
    {"name": "Capstan", "aliases": ["capstan", "capstan station"], "lines": ["Canada"]},
    {"name": "Aberdeen", "aliases": ["aberdeen", "aberdeen station"], "lines": ["Canada"]},
    {"name": "Lansdowne", "aliases": ["lansdowne", "lansdowne station"], "lines": ["Canada"]},
    {"name": "Richmond-Brighouse", "aliases": ["richmond brighouse", "richmond-brighouse", "brighouse station"], "lines": ["Canada"]},
    {"name": "Lonsdale Quay", "aliases": ["lonsdale quay", "lonsdale quay seabus"], "lines": ["SeaBus"]}
]

def map_effect_zh(effect_code: str) -> str:
    effect = (effect_code or "").upper()
    mapping = {
        "PLATFORM_CHANGE": "月台更換",
        "DETOUR": "路線改道",
        "DELAY": "班次延誤",
        "DELAYS": "班次延誤",
        "CANCELLATION": "班次取消",
        "CANCELLED_SERVICE": "班次停駛",
        "NO_SERVICE": "暫停服務",
        "STOP_CLOSURE": "站點暫停",
        "STOP_MOVE": "站點遷移",
        "STOP_MOVED": "站點遷移",
        "ELEVATORS": "電梯暫停",
        "ELEVATOR": "電梯暫停",
        "ESCALATORS": "電扶梯暫停",
        "STATION_ISSUE": "車站維護",
        "SERVICE_CHANGE": "服務調整",
        "MODIFIED_SERVICE": "服務調整",
        "SCHEDULE_CHANGE": "時刻變更",
        "ADDITIONAL_SERVICE": "加開班次",
        "EXTRA_SERVICE": "加開班次",
        "ADVISORY": "營運提示",
        "INFORMATIONAL": "營運警報",
        "OTHER_EFFECT": "營運提示",
        "UNKNOWN_EFFECT": "一般通知"
    }
    return mapping.get(effect, "營運警報")

def detect_transport_mode(alert: dict) -> str:
    # 1. First trust TransLink's explicit numeric mode field if provided
    mode_val = alert.get("mode")
    if mode_val == 1 or mode_val == "1":
        return "skytrain"
    if mode_val == 2 or mode_val == "2":
        return "wce"
    if mode_val == 3 or mode_val == "3":
        return "bus"
    if mode_val == 4 or mode_val == "4":
        return "seabus"

    # 2. Check routeLongName and routeId
    route_name = str(alert.get("routeLongName", "")).strip().lower()
    route_id = str(alert.get("routeId", "")).strip().lower()

    if "seabus" in route_name:
        return "seabus"
    if "west coast express" in route_name or route_name == "wce":
        return "wce"
    if any(k in route_name for k in ["expo line", "millennium line", "canada line", "skytrain"]) or route_id in ["992", "991", "980"]:
        return "skytrain"
    if "bus" in route_name or "rapidbus" in route_name or "b-line" in route_name or re.search(r'^\d{1,3}[a-z]?$', route_id):
        return "bus"

    # 3. Check text content for unambiguous mode keywords
    text = f"{alert.get('alertText', '')} {alert.get('header', '')} {alert.get('description', '')}".lower()

    # If text mentions all or multiple transit modes (e.g. system-wide maintenance or fare notice), treat as general
    modes_mentioned = 0
    if "skytrain" in text or "expo line" in text or "millennium line" in text or "canada line" in text:
        modes_mentioned += 1
    if "seabus" in text:
        modes_mentioned += 1
    if "west coast express" in text:
        modes_mentioned += 1
    if "bus" in text:
        modes_mentioned += 1

    if modes_mentioned >= 2 or "compasscard" in text or "compass card" in text:
        return "general"

    if "seabus" in text:
        return "seabus"
    if "west coast express" in text or " wce " in f" {text} ":
        return "wce"
    if any(k in text for k in ["skytrain", "expo line", "millennium line", "canada line"]):
        return "skytrain"
    if "bus" in text or "rapidbus" in text:
        return "bus"

    return "general"

def extract_impacted_stations(text: str) -> list:
    matched = []
    text_lower = text.lower()
    for st in KNOWN_STATIONS:
        for alias in st["aliases"]:
            if alias in text_lower:
                matched.append(st["name"])
                break
    return list(set(matched))

def fetch_json_url(url: str, timeout: int = 8):
    headers = {
        "User-Agent": "VancouverGodsEye/2.0 (Translink Alert Service)",
        "Accept": "application/json"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return json.loads(data.decode("utf-8"))
    except Exception as e:
        print(f"[TransLinkService] Fetch error for {url}: {e}")
        return None

def fetch_translink_alerts_live() -> dict:
    all_alerts = fetch_json_url(ALL_ALERTS_URL)
    banner_alerts = fetch_json_url(BANNER_ALERTS_URL)

    # Fallback to local cache if network call fails
    if all_alerts is None:
        if os.path.exists(CACHE_FILE_BACKEND):
            try:
                with open(CACHE_FILE_BACKEND, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[TransLinkService] Error reading cache file: {e}")
        return {
            "alerts": [],
            "banners": [],
            "total": 0,
            "station_alerts_map": {},
            "updated_at": datetime.datetime.utcnow().isoformat() + "Z"
        }

    raw_alerts = all_alerts if isinstance(all_alerts, list) else []
    raw_banners = banner_alerts if isinstance(banner_alerts, list) else []

    processed_alerts = []
    station_alerts_map = {}  # { "Braid": { "critical": False, "count": 1, "alert_ids": [...] } }

    # 1. Process Banners (Emergency announcements)
    for b in raw_banners:
        if not isinstance(b, dict):
            continue
        alert_id = str(b.get("id") or b.get("alertId") or f"banner_{len(processed_alerts)}")
        header = b.get("header") or b.get("alertText") or "全網緊急公告"
        desc = b.get("description") or b.get("alertText") or ""
        
        impacted_stations = extract_impacted_stations(f"{header} {desc}")
        
        combined_text = f"{header} {desc}".lower()
        banner_mode = "general"
        banner_mode_name = "系統全網緊急廣播"
        if any(k in combined_text for k in ["skytrain", "expo line", "millennium line", "canada line", "single tracking", "platform"]):
            banner_mode = "skytrain"
            banner_mode_name = "天車緊急公告"
        elif "seabus" in combined_text:
            banner_mode = "seabus"
            banner_mode_name = "水上巴士緊急公告"
        elif "west coast express" in combined_text or "wce" in combined_text:
            banner_mode = "wce"
            banner_mode_name = "西岸快車緊急公告"
        elif "bus" in combined_text:
            banner_mode = "bus"
            banner_mode_name = "巴士緊急公告"

        item = {
            "id": alert_id,
            "alertId": alert_id,
            "is_banner": True,
            "mode": banner_mode,
            "mode_name": banner_mode_name,
            "routeId": "EMERGENCY",
            "routeLongName": banner_mode_name,
            "effect": "EMERGENCY_BANNER",
            "effect_zh": "緊急公告",
            "critical": True,
            "advisory": False,
            "alertText": b.get("alertText") or header,
            "header": header,
            "description": desc,
            "url": b.get("url") or "https://www.translink.ca/alerts",
            "startTime": b.get("startTime") or datetime.datetime.utcnow().isoformat() + "Z",
            "endTime": b.get("endTime"),
            "lastModified": b.get("lastModified") or datetime.datetime.utcnow().isoformat() + "Z",
            "impacted_stations": impacted_stations,
            "closed": False
        }
        processed_alerts.append(item)

        # 僅限明確為天車或水上巴士、且特定於少數車站 (1-3 站) 的緊急停駛/重大中斷，才標記車站
        if banner_mode in ["skytrain", "seabus"] and 0 < len(impacted_stations) <= 3:
            for st_name in impacted_stations:
                if st_name.lower() in ["expo line", "canada line", "millennium line", "skytrain", "seabus", "entire line"]:
                    continue
                if st_name not in station_alerts_map:
                    station_alerts_map[st_name] = {"critical": True, "count": 1, "alert_ids": [alert_id]}
                else:
                    station_alerts_map[st_name]["critical"] = True
                    station_alerts_map[st_name]["count"] += 1
                    station_alerts_map[st_name]["alert_ids"].append(alert_id)

    # 2. Process All Alerts
    for idx, a in enumerate(raw_alerts):
        if not isinstance(a, dict):
            continue
        if a.get("closed") is True:
            continue
        
        t_mode = detect_transport_mode(a)
        raw_id = str(a.get("id") or a.get("alertId") or "alt")
        alert_id = f"{raw_id}_{t_mode}_{idx}"
        effect_code = str(a.get("effect") or "GENERAL")
        effect_zh = map_effect_zh(effect_code)
        
        mode_names = {
            "skytrain": "天車",
            "bus": "巴士",
            "seabus": "水上巴士",
            "wce": "西岸快車",
            "general": "大眾運輸"
        }

        full_text = f"{a.get('alertText', '')} {a.get('header', '')} {a.get('description', '')} {a.get('stationName', '')}"
        impacted_stations = extract_impacted_stations(full_text)
        if a.get("stationName") and a["stationName"] not in impacted_stations:
            impacted_stations.append(a["stationName"])

        is_critical = bool(a.get("critical", False))
        is_advisory = bool(a.get("advisory", False))

        item = {
            "id": alert_id,
            "alertId": str(a.get("alertId") or alert_id),
            "is_banner": False,
            "mode": t_mode,
            "mode_name": mode_names.get(t_mode, "大眾運輸"),
            "routeId": str(a.get("routeId") or ""),
            "routeLongName": str(a.get("routeLongName") or a.get("routeId") or ""),
            "effect": effect_code,
            "effect_zh": effect_zh,
            "critical": is_critical,
            "advisory": is_advisory,
            "alertText": str(a.get("alertText") or ""),
            "header": str(a.get("header") or a.get("alertText") or ""),
            "description": str(a.get("description") or ""),
            "url": str(a.get("url") or "https://www.translink.ca/alerts"),
            "startTime": a.get("startTime"),
            "endTime": a.get("endTime"),
            "lastModified": a.get("lastModified"),
            "impacted_stations": impacted_stations,
            "closed": False
        }
        processed_alerts.append(item)

        # 僅限「天車」與「水上巴士」本身的特定車站警報才在地圖顯示三角標記
        # 排除公車改道公告（即使公車行經天車站），且排除全線廣播或全網維護宣導
        if t_mode in ["skytrain", "seabus"]:
            is_line_wide = any(k in full_text.lower() for k in [
                "entire line", "all stations", "system-wide", "system wide", "across the network", "regular service"
            ]) or (len(impacted_stations) > 4) or (not impacted_stations and str(a.get("stationName") or "") in ["Expo Line", "Canada Line", "Millennium Line", "SkyTrain", "SeaBus"])

            if not is_line_wide and 0 < len(impacted_stations) <= 4:
                for st_name in impacted_stations:
                    # 排除非車站的路線名稱
                    if st_name.lower() in ["expo line", "canada line", "millennium line", "skytrain", "seabus", "west coast express"]:
                        continue
                    if st_name not in station_alerts_map:
                        station_alerts_map[st_name] = {"critical": is_critical, "count": 1, "alert_ids": [alert_id]}
                    else:
                        if is_critical:
                            station_alerts_map[st_name]["critical"] = True
                        station_alerts_map[st_name]["count"] += 1
                        station_alerts_map[st_name]["alert_ids"].append(alert_id)

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    result = {
        "source": "TransLink (British Columbia)",
        "source_url": "https://www.translink.ca/alerts",
        "api_endpoint": ALL_ALERTS_URL,
        "banner_endpoint": BANNER_ALERTS_URL,
        "updated_at": now_iso,
        "total": len(processed_alerts),
        "banners_count": len(raw_banners),
        "alerts": processed_alerts,
        "station_alerts_map": station_alerts_map
    }

    # Save to backend & frontend caches
    try:
        os.makedirs(os.path.dirname(CACHE_FILE_BACKEND), exist_ok=True)
        with open(CACHE_FILE_BACKEND, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[TransLinkService] Error writing backend cache: {e}")

    try:
        os.makedirs(os.path.dirname(CACHE_FILE_FRONTEND), exist_ok=True)
        with open(CACHE_FILE_FRONTEND, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[TransLinkService] Error writing frontend cache: {e}")

    return result

def get_translink_alerts(force: bool = False) -> dict:
    global _alerts_memory_cache
    now = time.time()
    if not force and _alerts_memory_cache["data"] and (now - _alerts_memory_cache["timestamp"] < CACHE_TTL):
        return _alerts_memory_cache["data"]

    # Check disk cache
    if not force and not _alerts_memory_cache["data"] and os.path.exists(CACHE_FILE_BACKEND):
        try:
            mtime = os.path.getmtime(CACHE_FILE_BACKEND)
            if now - mtime < CACHE_TTL:
                with open(CACHE_FILE_BACKEND, "r", encoding="utf-8") as f:
                    cached_json = json.load(f)
                    _alerts_memory_cache["timestamp"] = mtime
                    _alerts_memory_cache["data"] = cached_json
                    return cached_json
        except Exception:
            pass

    data = fetch_translink_alerts_live()
    _alerts_memory_cache["timestamp"] = now
    _alerts_memory_cache["data"] = data
    return data
