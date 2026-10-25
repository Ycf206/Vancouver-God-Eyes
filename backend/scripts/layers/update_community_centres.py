import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_community_centres():
    print("🏛️ 正在更新溫哥華社區活動中心 (Community Centres)...")
    records = fetch_all_records("community-centres")
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

        name = r.get("name") or "社區中心"
        feat = {
            "type": "Feature",
            "id": f"cc_{name.replace(' ', '_')}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"cc_{name.replace(' ', '_')}",
                "facility_type": "community_centres",
                "name": name,
                "address": r.get("address") or "",
                "phone": r.get("phone") or "",
                "fax": r.get("fax") or "",
                "website": r.get("urllink") or "",
                "local_area": r.get("geo_local_area") or r.get("local_area") or ""
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_community_centres.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_community_centres.geojson", features)
        sync_facility_to_db("community_centres", features)
        print(f"✅ 社區中心更新完成，共 {len(features)} 處中心。")
    return features

if __name__ == "__main__":
    update_community_centres()
