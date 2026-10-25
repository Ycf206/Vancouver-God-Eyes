import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_geojson_export, save_layer_geojson, load_existing_geojson

def update_street_lighting_conduits():
    print("⚡ 正在更新路燈電網管道 (Street Lighting Conduits)...")
    data = fetch_geojson_export("street-lighting-conduits")
    features = data.get("features", []) if data else []

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_street_lighting_conduits.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_street_lighting_conduits.geojson", features)
        print(f"✅ 路燈電網管道更新完成，共 {len(features)} 處管道。")
    return features

if __name__ == "__main__":
    update_street_lighting_conduits()
