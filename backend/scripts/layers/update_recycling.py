import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_recycling():
    print("♻️ 正在更新環保廢物分類回收站 (Recycling Depots)...")
    existing = load_existing_geojson("vancouver_recycling.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_recycling.geojson", features)
        sync_facility_to_db("recycling", features)
        print(f"✅ 回收站更新完成，共 {len(features)} 處站點。")
    return features

if __name__ == "__main__":
    update_recycling()
