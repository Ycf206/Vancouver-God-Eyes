import os
import sys
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_parks():
    print("🌲 正在更新溫哥華都會與社區公園 (City Parks)...")
    records = fetch_all_records("parks")
    features = []

    for r in records:
        pid = r.get("parkid")
        name = r.get("name", "公園")
        gmap = r.get("googlemapdest") or {}
        lat = gmap.get("lat")
        lon = gmap.get("lon")

        if lat is None or lon is None:
            geo_p = r.get("geo_point_2d") or {}
            lat = geo_p.get("lat")
            lon = geo_p.get("lon")

        if lat is None or lon is None:
            continue

        feat = {
            "type": "Feature",
            "id": f"park_{pid}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"park_{pid}",
                "facility_type": "parks",
                "name": name,
                "parkid": pid,
                "street_number": r.get("streetnumber"),
                "street_name": r.get("streetname"),
                "street_address": f"{r.get('streetnumber', '')} {r.get('streetname', '')}".strip(),
                "neighbourhood_name": r.get("neighbourhoodname"),
                "local_area": r.get("neighbourhoodname") or "",
                "hectares": r.get("hectares"),
                "washrooms": r.get("washrooms"),
                "facilities": r.get("facilities")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_parks.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_parks.geojson", features)
        sync_facility_to_db("parks", features)
        print(f"✅ 公園圖資更新完成，共 {len(features)} 處公園。")
    return features

if __name__ == "__main__":
    update_parks()
