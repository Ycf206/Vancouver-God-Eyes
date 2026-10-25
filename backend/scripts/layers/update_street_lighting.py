import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_geojson_export, save_layer_geojson, load_existing_geojson

def update_street_lighting():
    print("💡 正在更新路燈燈桿 (Street Lighting Poles)...")
    data = fetch_geojson_export("street-lighting-poles")
    features = data.get("features", []) if data else []

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_street_lighting.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_street_lighting.geojson", features)
        print(f"✅ 路燈燈桿更新完成，共 {len(features)} 處燈桿。")
    return features

if __name__ == "__main__":
    update_street_lighting()
