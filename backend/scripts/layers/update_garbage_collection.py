import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

def update_garbage_collection():
    print("🚛 正在更新溫哥華廢物回收分區 (Garbage Collection Zones)...")
    existing = load_existing_geojson("vancouver_garbage_collection.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_garbage_collection.geojson", features)
        print(f"✅ 廢物清運分區更新完成，共 {len(features)} 個分區。")
    return features

if __name__ == "__main__":
    update_garbage_collection()
