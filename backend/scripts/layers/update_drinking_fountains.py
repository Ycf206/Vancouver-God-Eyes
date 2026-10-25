import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_drinking_fountains():
    print("💧 正在更新公共飲水台 (Drinking Fountains)...")
    records = fetch_all_records("drinking-fountains")
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

        site_name = r.get("park_or_site") or r.get("name") or "飲水台"
        mapid = r.get("mapid") or idx
        feat = {
            "type": "Feature",
            "id": f"fountain_{mapid}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"fountain_{mapid}",
                "facility_type": "drinking_fountains",
                "name": f"飲水台 ({site_name})",
                "park_or_site": site_name,
                "mapid": mapid,
                "maintainer": r.get("maintainer"),
                "pet_bowl": r.get("pet_bowl"),
                "operational": r.get("operational"),
                "in_service": r.get("in_service")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_drinking_fountains.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_drinking_fountains.geojson", features)
        sync_facility_to_db("drinking_fountains", features)
        print(f"✅ 公共飲水台更新完成，共 {len(features)} 處水台。")
    return features

if __name__ == "__main__":
    update_drinking_fountains()
