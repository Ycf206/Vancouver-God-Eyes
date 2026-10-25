import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_public_washrooms():
    print("🚻 正在更新公共洗手間 (Public Washrooms)...")
    records = fetch_all_records("public-washrooms")
    features = []

    for idx, r in enumerate(records):
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

        p_name = r.get("park_name") or r.get("name") or "公共洗手間"
        loc = r.get("location") or ""
        feat = {
            "type": "Feature",
            "id": f"washroom_{idx}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"washroom_{idx}",
                "facility_type": "public_washrooms",
                "name": f"公廁 - {p_name}",
                "park_name": p_name,
                "location": loc,
                "wheelchair_access": r.get("wheelchair_access"),
                "summer_hours": r.get("summer_hours"),
                "winter_hours": r.get("winter_hours"),
                "notes": r.get("notes")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_public_washrooms.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_public_washrooms.geojson", features)
        sync_facility_to_db("public_washrooms", features)
        print(f"✅ 公共洗手間更新完成，共 {len(features)} 處公廁。")
    return features

if __name__ == "__main__":
    update_public_washrooms()
