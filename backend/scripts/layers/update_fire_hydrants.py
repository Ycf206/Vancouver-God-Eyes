import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_fire_hydrants():
    print("🚒 正在更新市政消防栓位置 (Fire Hydrants)...")
    records = fetch_all_records("water-hydrants")
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

        obj_id = r.get("id") or r.get("hydrant_id") or r.get("code") or idx
        feat = {
            "type": "Feature",
            "id": f"hydrant_{obj_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"hydrant_{obj_id}",
                "facility_type": "fire_hydrants",
                "name": f"消防栓 #{r.get('code') or obj_id}",
                "subsystem": r.get("subsystem"),
                "code": r.get("code"),
                "covwaterhydrantunittype": r.get("covwaterhydrantunittype"),
                "distancefromcorner": r.get("distancefromcorner")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_fire_hydrants.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_fire_hydrants.geojson", features)
        sync_facility_to_db("fire_hydrants", features)
        print(f"✅ 市政消防栓更新完成，共 {len(features)} 座消防栓。")
    return features

if __name__ == "__main__":
    update_fire_hydrants()
