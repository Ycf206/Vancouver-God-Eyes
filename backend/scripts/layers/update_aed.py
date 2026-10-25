import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_aed():
    print("⚡ 正在更新自動體外心臟去顫器 (AED)...")
    records = fetch_all_records("community-aed-locations")
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

        obj_id = r.get("objectid") or r.get("OBJECTID") or r.get("id")
        name = r.get("facility_name") or r.get("FACILITY_NAME") or "AED 去顫器"
        address = r.get("address") or r.get("ADDRESS") or ""
        loc_desc = r.get("location_description") or r.get("LOCATION_DESCRIPTION") or ""

        feat = {
            "type": "Feature",
            "id": f"aed_{obj_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"aed_{obj_id}",
                "object_id": obj_id,
                "facility_type": "aed",
                "name": name,
                "address": address,
                "location_description": loc_desc,
                "municipality": "Vancouver",
                "local_area": r.get("geo_local_area") or r.get("local_area") or "Vancouver",
                "source": "City of Vancouver / BC PAD"
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_aed.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_aed.geojson", features)
        sync_facility_to_db("aed", features)
        print(f"✅ AED 去顫器更新完成，共 {len(features)} 處機台。")
    return features

if __name__ == "__main__":
    update_aed()
