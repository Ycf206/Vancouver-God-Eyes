import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_snow_removal_routes():
    print("❄️ 正在更新冬季市政優先鏟雪路線 (Snow Removal Routes)...")
    records = fetch_all_records("snow-removal-routes")
    features = []

    for idx, r in enumerate(records):
        geom_dict = r.get("geom") or {}
        geometry = geom_dict.get("geometry") or geom_dict
        if not geometry or not geometry.get("coordinates"):
            continue

        obj_id = r.get("objectid") or r.get("OBJECTID") or idx
        route_type = r.get("route_type") or r.get("priority") or "一級鏟雪幹道"
        name = f"優先鏟雪路線: {route_type} (#{obj_id})"

        feat = {
            "type": "Feature",
            "id": f"snow_{obj_id}",
            "geometry": geometry,
            "properties": {
                "id": f"snow_{obj_id}",
                "facility_type": "snow_removal_routes",
                "object_id": obj_id,
                "name": name,
                "route_type": route_type
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_snow_removal_routes.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_snow_removal_routes.geojson", features)
        sync_facility_to_db("snow_removal_routes", features)
        print(f"✅ 鏟雪路線更新完成，共 {len(features)} 處路段。")
    return features

if __name__ == "__main__":
    update_snow_removal_routes()
