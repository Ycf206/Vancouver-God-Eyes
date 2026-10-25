import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_museums():
    print("🏛️ 正在更新溫哥華歷史博物館與藝廊 (Museums & Galleries)...")
    existing = load_existing_geojson("vancouver_museums.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_museums.geojson", features)
        sync_facility_to_db("museums", features)
        print(f"✅ 博物館與藝廊更新完成，共 {len(features)} 處展館。")
    return features

if __name__ == "__main__":
    update_museums()
