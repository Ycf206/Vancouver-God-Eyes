import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_food_banks():
    print("🍲 正在更新大溫食物援助銀行 (Food Banks & Meal Programs)...")
    existing = load_existing_geojson("vancouver_food_banks.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_food_banks.geojson", features)
        sync_facility_to_db("food_banks", features)
        print(f"✅ 食物銀行更新完成，共 {len(features)} 處派發站點。")
    return features

if __name__ == "__main__":
    update_food_banks()
