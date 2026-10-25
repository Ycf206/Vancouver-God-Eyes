import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_litter_containers():
    print("🗑️ 正在更新公共垃圾桶與回收箱 (Litter Containers)...")
    existing = load_existing_geojson("vancouver_litter_containers.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_litter_containers.geojson", features)
        sync_facility_to_db("litter_containers", features)
        print(f"✅ 公共垃圾箱更新完成，共 {len(features)} 處箱位。")
    return features

if __name__ == "__main__":
    update_litter_containers()
