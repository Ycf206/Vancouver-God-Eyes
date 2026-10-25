import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_geojson_export, save_layer_geojson, load_existing_geojson

def update_sewer_mains():
    print("🚽 正在更新市區下水道與排水分流管線 (Sewer Mains)...")
    data = fetch_geojson_export("sewer-mains")
    features = data.get("features", []) if data else []

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_sewer_mains.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_sewer_mains.geojson", features)
        print(f"✅ 下水道管線更新完成，共 {len(features)} 處管線。")
    return features

if __name__ == "__main__":
    update_sewer_mains()
