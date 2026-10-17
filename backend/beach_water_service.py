import urllib.request
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Any, List

BEACH_API_URL = "https://gis.metrovancouver.org/arcgis/rest/services/Beach_Site_Area/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=json"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CACHE_FILE = os.path.join(DATA_DIR, "vancouver_beach_water_cache.json")
GEOJSON_FILE = os.path.join(DATA_DIR, "vancouver_beach_water.geojson")

# 每個月更新 1 次 (30 天 TTL)
CACHE_TTL = 30 * 86400

_beach_memory_cache = {
    "timestamp": 0,
    "data": None
}

def compute_centroid(rings: List[Any]) -> List[float]:
    if not rings or not rings[0]:
        return [0.0, 0.0]
    ring = rings[0]
    sum_lon = 0.0
    sum_lat = 0.0
    count = 0
    for pt in ring:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            sum_lon += float(pt[0])
            sum_lat += float(pt[1])
            count += 1
    if count > 0:
        return [sum_lon / count, sum_lat / count]
    return [0.0, 0.0]

def parse_beach_features(raw_features: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    cache_list = []
    geo_features = []
    
    for f in raw_features:
        a = f.get("attributes", {})
        g = f.get("geometry", {})
        rings = g.get("rings", [])
        center_lon, center_lat = compute_centroid(rings)
        
        last_val = a.get("LastValue")
        val = round(float(last_val), 1) if isinstance(last_val, (int, float)) else None
        
        status = "unknown"
        status_label = "未有數據"
        status_color = "#94a3b8"
        
        if val is not None:
            if val <= 200:
                status = "safe"
                status_label = "適合游泳 (優良)"
                status_color = "#10b981"
            elif val <= 400:
                status = "advisory"
                status_label = "需留意 (接近上限)"
                status_color = "#f59e0b"
            else:
                status = "warning"
                status_label = "超標警告 (不建議下水)"
                status_color = "#ef4444"
                
        last_ts = a.get("LastTimeStamp")
        date_formatted = ""
        if last_ts:
            try:
                date_formatted = datetime.fromtimestamp(last_ts / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                date_formatted = ""
                
        item = {
            "id": f"beach_{a.get('OBJECTID')}",
            "object_id": a.get("OBJECTID"),
            "facility_type": "beach_water_quality",
            "name": a.get("BeachName", "未知海灘"),
            "area": a.get("BeachArea", ""),
            "municipality": a.get("Municipality", ""),
            "health_authority": a.get("HealthAuthority", ""),
            "last_value": val,
            "last_timestamp": last_ts,
            "last_date": date_formatted,
            "status": status,
            "status_label": status_label,
            "status_color": status_color,
            "internet_link": a.get("InternetLink", ""),
            "photo_link": a.get("PhotoLink", ""),
            "data_tag": a.get("DataTag", ""),
            "center_lon": center_lon,
            "center_lat": center_lat,
            "update_frequency": "每個月更新 1 次 (Monthly)"
        }
        cache_list.append(item)
        
        geo_features.append({
            "type": "Feature",
            "id": item["id"],
            "geometry": {
                "type": "Polygon",
                "coordinates": rings
            },
            "properties": item
        })
        
    cache_list.sort(key=lambda x: x.get("name", ""))
    
    cache_payload = {
        "source": "Metro Vancouver ArcGIS Beach_Site_Area",
        "source_url": BEACH_API_URL,
        "update_frequency": "每個月更新 1 次 (Monthly)",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_count": len(cache_list),
        "beaches": cache_list
    }
    
    geojson_payload = {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(geo_features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每個月更新 1 次 (Monthly)",
        "features": geo_features
    }
    
    return cache_payload, geojson_payload

def get_beach_water_data(force: bool = False) -> Dict[str, Any]:
    global _beach_memory_cache
    now = time.time()
    
    # 1. Check in-memory cache
    if not force and _beach_memory_cache["data"] is not None:
        if now - _beach_memory_cache["timestamp"] < CACHE_TTL:
            return _beach_memory_cache["data"]
            
    # 2. Check disk cache if recent
    if not force and os.path.exists(CACHE_FILE):
        try:
            mtime = os.path.getmtime(CACHE_FILE)
            if now - mtime < CACHE_TTL:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _beach_memory_cache["data"] = data
                    _beach_memory_cache["timestamp"] = mtime
                    return data
        except Exception as e:
            print(f"Error reading beach water cache file: {e}")
            
    # 3. Fetch from remote ArcGIS FeatureServer
    try:
        req = urllib.request.Request(
            BEACH_API_URL, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VancouverGodsEye/1.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                raw_json = json.loads(resp.read().decode("utf-8"))
                raw_features = raw_json.get("features", [])
                if raw_features:
                    cache_payload, geojson_payload = parse_beach_features(raw_features)
                    
                    # Save to files
                    try:
                        os.makedirs(DATA_DIR, exist_ok=True)
                        with open(CACHE_FILE, "w", encoding="utf-8") as f:
                            json.dump(cache_payload, f, ensure_ascii=False, indent=2)
                        with open(GEOJSON_FILE, "w", encoding="utf-8") as f:
                            json.dump(geojson_payload, f, ensure_ascii=False, indent=2)
                    except Exception as e:
                        print(f"Error saving beach water cache: {e}")
                        
                    _beach_memory_cache["data"] = cache_payload
                    _beach_memory_cache["timestamp"] = now
                    return cache_payload
    except Exception as e:
        print(f"Error fetching live beach water from ArcGIS: {e}")
        
    # 4. Fallback to existing disk cache
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _beach_memory_cache["data"] = data
                _beach_memory_cache["timestamp"] = now
                return data
        except Exception as e:
            print(f"Error reading fallback beach water cache: {e}")
            
    return {
        "source": "Metro Vancouver ArcGIS Beach_Site_Area",
        "update_frequency": "每個月更新 1 次 (Monthly)",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_count": 0,
        "beaches": []
    }

def get_beach_water_geojson() -> Dict[str, Any]:
    if os.path.exists(GEOJSON_FILE):
        try:
            with open(GEOJSON_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading beach water geojson: {e}")
            
    # Trigger fetch
    get_beach_water_data()
    if os.path.exists(GEOJSON_FILE):
        try:
            with open(GEOJSON_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading newly generated beach water geojson: {e}")
            
    return {"type": "FeatureCollection", "features": []}
