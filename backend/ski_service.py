import urllib.request
import gzip
import json
import datetime
import time
import os

RESORTS_CONFIG = [
    {
        "id": "cypress",
        "uid": 425,
        "name": "賽普里斯山滑雪場",
        "english_name": "Cypress Mountain",
        "area": "西溫哥華 · 賽普里斯省立公園 (West Vancouver)",
        "lat": 49.3957,
        "lon": -123.2045,
        "zoom": 14,
        "vertical_drop": "616 m",
        "official_url": "https://cypressmountain.com",
        "skiresort_url": "https://www.skiresort.com/en/ski-resort/cypress-mountain/snow-report/"
    },
    {
        "id": "grouse",
        "uid": 427,
        "name": "松雞山滑雪場",
        "english_name": "Grouse Mountain",
        "area": "北溫哥華 · 溫哥華之峰 (North Vancouver)",
        "lat": 49.3795,
        "lon": -123.0825,
        "zoom": 14,
        "vertical_drop": "400 m",
        "official_url": "https://www.grousemountain.com",
        "skiresort_url": "https://www.skiresort.com/en/ski-resort/grouse-mountain/snow-report/"
    },
    {
        "id": "seymour",
        "uid": 443,
        "name": "西摩山滑雪場",
        "english_name": "Mount Seymour",
        "area": "北溫哥華 · 西摩山省立公園 (North Vancouver)",
        "lat": 49.3672,
        "lon": -122.9486,
        "zoom": 14,
        "vertical_drop": "330 m",
        "official_url": "https://mtseymour.ca",
        "skiresort_url": "https://www.skiresort.com/en/ski-resort/mount-seymour/snow-report/"
    }
]

_ski_cache = {
    "timestamp": 0,
    "data": None
}

CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "vancouver_ski_resorts_cache.json")

def translate_status(raw_status: str) -> str:
    if not raw_status:
        return "季節休園"
    s = raw_status.strip().lower()
    if "open" in s and "closed" not in s and "soon" not in s:
        return "開放中"
    if "soon" in s:
        return "即將開放"
    if "weekend" in s:
        return "週末營運"
    return "季節休園"

def fetch_single_resort(cfg: dict) -> dict:
    url = f"https://www.skiresort.com/livedata.json?uid={cfg['uid']}&l=en"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        "Accept-Encoding": "gzip, deflate"
    }
    raw_json = {}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as response:
            content_encoding = response.info().get("Content-Encoding")
            data = response.read()
            if content_encoding == "gzip":
                data = gzip.decompress(data)
            raw_json = json.loads(data.decode("utf-8"))
    except Exception as e:
        print(f"[SkiService] Warning: Failed to fetch live data for {cfg['english_name']}: {e}")

    status_raw = raw_json.get("statusLabel") or raw_json.get("status") or "Ski resort closed"
    status_zh = translate_status(status_raw)

    slopes_open = raw_json.get("slopeOpen", 0)
    slopes_tot = raw_json.get("slopeTot", 0)
    slope_label = raw_json.get("slopeLabel") or f"{slopes_open} of {slopes_tot} km"

    lifts_open = raw_json.get("liftsOpen", 0)
    lifts_tot = raw_json.get("liftsTot", 0)
    lift_label = raw_json.get("liftLabel") or f"{lifts_open} of {lifts_tot} lifts"

    snow_base = raw_json.get("snowBase") or "-"
    snow_top = raw_json.get("snowTop") or "-"
    if snow_base != "-" and not str(snow_base).endswith("cm"):
        snow_base = f"{snow_base} cm"
    if snow_top != "-" and not str(snow_top).endswith("cm"):
        snow_top = f"{snow_top} cm"

    alt_base = raw_json.get("altitudeBase") or "800"
    alt_top = raw_json.get("altitudeTop") or "1400"

    season_range = raw_json.get("seasonRangeLabel") or ""
    last_snow = raw_json.get("snowreportLastsnowLabel") or "-"
    night_ski = bool(raw_json.get("nightskiingAvailable", True))

    weather_list = raw_json.get("weather", [])
    today_weather = None
    if weather_list and len(weather_list) > 0:
        w = weather_list[0]
        today_weather = {
            "day": w.get("day", ""),
            "date": w.get("dateFull", ""),
            "temp_min": w.get("tMinB", ""),
            "temp_max": w.get("tMaxB", ""),
            "condition": w.get("conditionTitleB", ""),
            "weather_text": w.get("weatherTextB", "")
        }

    return {
        "id": cfg["id"],
        "uid": cfg["uid"],
        "name": cfg["name"],
        "english_name": cfg["english_name"],
        "area": cfg["area"],
        "lat": cfg["lat"],
        "lon": cfg["lon"],
        "zoom": cfg["zoom"],
        "vertical_drop": cfg["vertical_drop"],
        "official_url": cfg["official_url"],
        "skiresort_url": cfg["skiresort_url"],
        "status_raw": status_raw,
        "status_zh": status_zh,
        "is_open": status_zh == "開放中",
        "season_range": season_range,
        "slopes_open": slopes_open,
        "slopes_total": slopes_tot,
        "slopes_label": slope_label,
        "lifts_open": lifts_open,
        "lifts_total": lifts_tot,
        "lifts_label": lift_label,
        "snow_base": snow_base,
        "snow_top": snow_top,
        "altitude_base": f"{alt_base} m",
        "altitude_top": f"{alt_top} m",
        "last_snow": last_snow,
        "night_skiing": night_ski,
        "today_weather": today_weather,
        "data_source": "Skiresort.info / Skiresort.com Live Data API (每日更新)"
    }

def get_live_ski_data(force_refresh=False):
    global _ski_cache
    now_ts = time.time()
    # Cache for 24 hours (86400 seconds) as user requested 每日 1 次
    if not force_refresh and _ski_cache["data"] and (now_ts - _ski_cache["timestamp"] < 86400):
        return _ski_cache["data"]

    # Try loading from disk cache first if available and recent
    if not force_refresh and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                file_ts = saved.get("_cache_timestamp", 0)
                if now_ts - file_ts < 86400 and saved.get("resorts"):
                    _ski_cache["timestamp"] = file_ts
                    _ski_cache["data"] = saved
                    return saved
        except Exception as e:
            print(f"[SkiService] Disk cache read warning: {e}")

    results = []
    for cfg in RESORTS_CONFIG:
        resort_data = fetch_single_resort(cfg)
        results.append(resort_data)

    payload = {
        "_cache_timestamp": now_ts,
        "updated_at": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "update_frequency": "每 1 日更新 (Daily)",
        "count": len(results),
        "resorts": results
    }

    _ski_cache["timestamp"] = now_ts
    _ski_cache["data"] = payload

    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SkiService] Failed to write disk cache: {e}")

    return payload

def get_ski_geojson():
    data = get_live_ski_data()
    features = []
    for r in data.get("resorts", []):
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [r["lon"], r["lat"]]
            },
            "properties": {
                "id": f"ski_{r['id']}",
                "facility_type": "ski_resort",
                "name": r["name"],
                "english_name": r["english_name"],
                "area": r["area"],
                "status_zh": r["status_zh"],
                "is_open": r["is_open"],
                "season_range": r["season_range"],
                "slopes_label": r["slopes_label"],
                "lifts_label": r["lifts_label"],
                "snow_base": r["snow_base"],
                "snow_top": r["snow_top"],
                "altitude_base": r["altitude_base"],
                "altitude_top": r["altitude_top"],
                "vertical_drop": r["vertical_drop"],
                "night_skiing": r["night_skiing"],
                "official_url": r["official_url"],
                "skiresort_url": r["skiresort_url"],
                "data_source": r["data_source"],
                "lat": r["lat"],
                "lon": r["lon"]
            }
        })
    return {
        "type": "FeatureCollection",
        "updated_at": data.get("updated_at"),
        "features": features
    }
