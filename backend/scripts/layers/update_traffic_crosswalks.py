import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_traffic_crosswalks():
    print("🚶 正在更新行人斑馬線過路處 (Pedestrian Crosswalks)...")
    existing = load_existing_geojson("vancouver_traffic_crosswalks.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_traffic_crosswalks.geojson", features)
        sync_facility_to_db("traffic_crosswalks", features)
        print(f"✅ 行人穿越道更新完成，共 {len(features)} 處路口。")
    return features

if __name__ == "__main__":
    update_traffic_crosswalks()
