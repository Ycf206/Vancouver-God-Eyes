import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_public_trees():
    print("🌳 正在更新市區街道樹木普查 (Urban Forest Inventory)...")
    existing = load_existing_geojson("vancouver_public_trees.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_public_trees.geojson", features)
        sync_facility_to_db("public_trees", features)
        print(f"✅ 街道樹木更新完成，共 {len(features)} 棵行道樹。")
    return features

if __name__ == "__main__":
    update_public_trees()
