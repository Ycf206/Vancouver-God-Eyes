import os
import sys
import math
import requests
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, HEADERS

def compute_centroid(rings):
    if not rings or not rings[0]:
        return [0, 0]
    ring = rings[0]
    sum_lon = 0.0
    sum_lat = 0.0
    count = 0
    for pt in ring:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            sum_lon += pt[0]
            sum_lat += pt[1]
            count += 1
    return [round(sum_lon / count, 6), round(sum_lat / count, 6)] if count > 0 else [0, 0]

def update_beach_water():
    print("🏖️ 正在更新 Metro Vancouver 泳灘水質監測...")
    url = "https://gis.metrovancouver.org/arcgis/rest/services/Beach_Site_Area/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=json"
    features = []
    try:
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            raw_features = data.get("features", [])
            for f in raw_features:
                a = f.get("attributes", {})
                g = f.get("geometry", {})
                rings = g.get("rings", [])
                center_lon, center_lat = compute_centroid(rings)
                if center_lon == 0 and center_lat == 0:
                    continue

                val = a.get("LastValue")
                if isinstance(val, (int, float)):
                    val = round(val, 1)
                else:
                    val = None

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
                        date_formatted = datetime.fromtimestamp(last_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                    except Exception:
                        pass

                feat = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [center_lon, center_lat]
                    },
                    "properties": {
                        "id": f"beach_{a.get('OBJECTID')}",
                        "object_id": a.get("OBJECTID"),
                        "facility_type": "beach_water_quality",
                        "name": a.get("BeachName") or "未知海灘",
                        "area": a.get("BeachArea") or "",
                        "municipality": a.get("Municipality") or "",
                        "health_authority": a.get("HealthAuthority") or "",
                        "last_value": val,
                        "last_timestamp": last_ts,
                        "last_date": date_formatted,
                        "status": status,
                        "status_label": status_label,
                        "status_color": status_color,
                        "internet_link": a.get("InternetLink") or "",
                        "photo_link": a.get("PhotoLink") or "",
                        "data_tag": a.get("DataTag") or ""
                    }
                }
                features.append(feat)
    except Exception as e:
        print(f"⚠️ 線上更新泳灘水質失敗: {e}")

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_beach_water.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_beach_water.geojson", features)
        print(f"✅ 泳灘水質更新完成，共 {len(features)} 處監測點。")
    return features

if __name__ == "__main__":
    update_beach_water()
