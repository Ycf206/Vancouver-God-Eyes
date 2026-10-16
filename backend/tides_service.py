import urllib.request
import json
import datetime
import time

STATIONS_CONFIG = [
    {
        "id": "5cebf1de3d0f4a073c4bb94c",
        "code": "07795",
        "name": "Point Atkinson (阿特金森岬)",
        "english_name": "Point Atkinson",
        "area": "西溫哥華 · 伯拉德內灣入口",
        "lat": 49.3375,
        "lon": -123.253583,
        "is_primary": True,
        "has_sensor": True
    },
    {
        "id": "5cebf1de3d0f4a073c4bb943",
        "code": "07735",
        "name": "Vancouver Harbour (溫哥華港市中心碼頭)",
        "english_name": "Vancouver Harbour",
        "area": "市中心水前 · 加拿大廣場",
        "lat": 49.2863,
        "lon": -123.0997,
        "is_primary": True,
        "has_sensor": True
    },
    {
        "id": "5cebf1e13d0f4a073c4bbf8c",
        "code": "07607",
        "name": "Steveston (列治文漁人碼頭)",
        "english_name": "Steveston",
        "area": "列治文 · 菲沙河南臂出海口",
        "lat": 49.1245,
        "lon": -123.1922,
        "is_primary": False,
        "has_sensor": True
    },
    {
        "id": "5cebf1de3d0f4a073c4bb935",
        "code": "07590",
        "name": "Tsawwassen (吐瓦森渡輪港)",
        "english_name": "Tsawwassen",
        "area": "三角洲 · 喬治亞海峽渡輪碼頭",
        "lat": 49.00677,
        "lon": -123.12933,
        "is_primary": False,
        "has_sensor": False
    },
    {
        "id": "5cebf1de3d0f4a073c4bb933",
        "code": "07577",
        "name": "White Rock (白石鎮棧橋)",
        "english_name": "White Rock",
        "area": "白石鎮 · 邊界灣 (Boundary Bay)",
        "lat": 49.016667,
        "lon": -122.8,
        "is_primary": False,
        "has_sensor": False
    }
]

_tide_cache = {
    "timestamp": 0,
    "data": None
}

def fetch_station_tide_data(station_cfg):
    now = datetime.datetime.utcnow()
    from_iso = (now - datetime.timedelta(hours=6)).isoformat() + "Z"
    to_iso = (now + datetime.timedelta(hours=24)).isoformat() + "Z"

    sid = station_cfg["id"]
    current_height = None
    state = "平潮"
    state_trend = "flat"
    series_code = "wlo" if station_cfg.get("has_sensor") else "wlp"

    # 1. Fetch current water level (observed or short predicted)
    url_level = f"https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/{sid}/data?time-series-code={series_code}&from={from_iso}&to={(now + datetime.timedelta(minutes=15)).isoformat()}Z"
    try:
        req = urllib.request.Request(url_level, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GodsEye/1.0"})
        with urllib.request.urlopen(req, timeout=4) as res:
            levels = json.loads(res.read().decode('utf-8'))
            if isinstance(levels, list) and len(levels) > 0:
                current_height = round(levels[-1]["value"], 2)
                if len(levels) >= 5:
                    prev_val = levels[-5]["value"]
                    diff = current_height - prev_val
                    if diff > 0.03:
                        state = "漲潮中"
                        state_trend = "rising"
                    elif diff < -0.03:
                        state = "退潮中"
                        state_trend = "falling"
    except Exception as e:
        print(f"Error fetching tide level for {station_cfg['name']}: {e}")

    # Fallback to wlp if sensor was offline
    if current_height is None and series_code == "wlo":
        try:
            url_fallback = f"https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/{sid}/data?time-series-code=wlp&from={(now - datetime.timedelta(minutes=30)).isoformat()}Z&to={(now + datetime.timedelta(minutes=30)).isoformat()}Z"
            req = urllib.request.Request(url_fallback, headers={"User-Agent": "Mozilla/5.0 GodsEye/1.0"})
            with urllib.request.urlopen(req, timeout=3) as res:
                pred_levels = json.loads(res.read().decode('utf-8'))
                if isinstance(pred_levels, list) and len(pred_levels) > 0:
                    current_height = round(pred_levels[-1]["value"], 2)
        except Exception:
            pass

    # 2. Fetch High/Low predictions (wlp-hilo)
    hilo_url = f"https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/{sid}/data?time-series-code=wlp-hilo&from={(now - datetime.timedelta(hours=4)).isoformat()}Z&to={to_iso}"
    next_high = None
    next_low = None
    predictions = []

    try:
        req = urllib.request.Request(hilo_url, headers={"User-Agent": "Mozilla/5.0 GodsEye/1.0"})
        with urllib.request.urlopen(req, timeout=4) as res:
            hilo_data = json.loads(res.read().decode('utf-8'))
            if isinstance(hilo_data, list):
                for item in hilo_data:
                    dt_str = item.get("eventDate", "")
                    val = round(item.get("value", 0.0), 2)
                    predictions.append({"time": dt_str, "value": val})

                # Classify high / low
                for i in range(len(hilo_data)):
                    curr = hilo_data[i]
                    prev_v = hilo_data[i-1]["value"] if i > 0 else None
                    next_v = hilo_data[i+1]["value"] if i < len(hilo_data)-1 else None
                    val = round(curr["value"], 2)
                    t_str = curr["eventDate"]
                    # If greater than neighbors -> high, else low
                    is_high = True
                    if prev_v is not None and val < prev_v:
                        is_high = False
                    if next_v is not None and val < next_v:
                        is_high = False

                    # If in the future
                    if t_str > now.isoformat() + "Z":
                        if is_high and next_high is None:
                            next_high = {"time": t_str, "value": val}
                        elif not is_high and next_low is None:
                            next_low = {"time": t_str, "value": val}
    except Exception as e:
        print(f"Error fetching hilo for {station_cfg['name']}: {e}")

    return {
        "station_id": station_cfg["id"],
        "code": station_cfg["code"],
        "name": station_cfg["name"],
        "english_name": station_cfg["english_name"],
        "area": station_cfg["area"],
        "lat": station_cfg["lat"],
        "lon": station_cfg["lon"],
        "current_water_level_m": current_height if current_height is not None else 2.5,
        "state": state,
        "state_trend": state_trend,
        "next_high": next_high,
        "next_low": next_low,
        "predictions": predictions[:8],
        "data_source": "加拿大漁業及海洋部 (DFO / CHS) 官方水文觀測網"
    }

def get_live_tides_data(force_refresh=False):
    global _tide_cache
    now_ts = time.time()
    if not force_refresh and _tide_cache["data"] and (now_ts - _tide_cache["timestamp"] < 180):
        return _tide_cache["data"]

    results = []
    for cfg in STATIONS_CONFIG:
        st_data = fetch_station_tide_data(cfg)
        results.append(st_data)

    payload = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "count": len(results),
        "stations": results
    }
    _tide_cache["timestamp"] = now_ts
    _tide_cache["data"] = payload
    return payload

def get_tides_geojson():
    data = get_live_tides_data()
    features = []
    for st in data.get("stations", []):
        trend_arrow = "↗" if st.get("state_trend") == "rising" else "↘" if st.get("state_trend") == "falling" else "→"
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [st["lon"], st["lat"]]
            },
            "properties": {
                "id": f"tide_{st['code']}",
                "station_code": st["code"],
                "name": st["name"],
                "english_name": st["english_name"],
                "area": st["area"],
                "facility_type": "tide_stations",
                "current_water_level_m": st["current_water_level_m"],
                "state": st["state"],
                "state_trend": st["state_trend"],
                "badge": f"{st['current_water_level_m']}m {trend_arrow}",
                "next_high_time": st.get("next_high", {}).get("time", "") if st.get("next_high") else "",
                "next_high_val": st.get("next_high", {}).get("value", 0) if st.get("next_high") else 0,
                "next_low_time": st.get("next_low", {}).get("time", "") if st.get("next_low") else "",
                "next_low_val": st.get("next_low", {}).get("value", 0) if st.get("next_low") else 0,
                "data_source": st.get("data_source", ""),
                "lat": st["lat"],
                "lon": st["lon"]
            }
        })
    return {
        "type": "FeatureCollection",
        "name": "Vancouver_Coastal_Tide_Stations",
        "features": features
    }
