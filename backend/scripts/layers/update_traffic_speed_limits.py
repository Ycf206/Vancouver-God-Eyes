import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

def update_traffic_speed_limits():
    print("🚗 正在更新全路網限速路段 (Speed Limits)...")
    existing = load_existing_geojson("vancouver_traffic_speed_limits.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_traffic_speed_limits.geojson", features)
        print(f"✅ 速限路段更新完成，共 {len(features)} 處路段。")
    return features

if __name__ == "__main__":
    update_traffic_speed_limits()
