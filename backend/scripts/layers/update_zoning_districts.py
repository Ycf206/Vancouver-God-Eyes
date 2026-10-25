import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_geojson_export, save_layer_geojson, load_existing_geojson

def update_zoning_districts():
    print("📐 正在更新土地規劃分區 (Zoning Districts)...")
    data = fetch_geojson_export("zoning-districts-and-labels")
    features = data.get("features", []) if data else []

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_zoning_districts.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_zoning_districts.geojson", features)
        print(f"✅ 土地規劃分區更新完成，共 {len(features)} 個分區區塊。")
    return features

if __name__ == "__main__":
    update_zoning_districts()
