import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_homeless_shelters():
    print("🏠 正在更新溫哥華無家者庇護所 (Homeless Shelters)...")
    records = fetch_all_records("homeless-shelters")
    features = []

    for r in records:
        geo = r.get("geo_point_2d") or {}
        lat = geo.get("lat")
        lon = geo.get("lon")

        if lat is None or lon is None:
            geom = r.get("geom") or {}
            coords = geom.get("geometry", {}).get("coordinates", [])
            if len(coords) >= 2:
                lon, lat = coords[0], coords[1]

        if lat is None or lon is None:
            continue

        name = r.get("name") or "庇護所"
        feat = {
            "type": "Feature",
            "id": f"shelter_{r.get('id') or name.replace(' ', '_')}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"shelter_{r.get('id') or name.replace(' ', '_')}",
                "facility_type": "homeless_shelters",
                "name": name,
                "category": r.get("category"),
                "phone": r.get("phone"),
                "address": r.get("address"),
                "local_area": r.get("geo_local_area") or r.get("local_area") or "",
                "details": r.get("details")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_homeless_shelters.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_homeless_shelters.geojson", features)
        sync_facility_to_db("homeless_shelters", features)
        print(f"✅ 庇護所更新完成，共 {len(features)} 處收容機構。")
    return features

if __name__ == "__main__":
    update_homeless_shelters()
