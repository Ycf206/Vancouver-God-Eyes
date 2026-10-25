import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

def update_contours():
    print("🏔️ 正在更新等高線地形高程 (Elevation Contours)...")
    existing = load_existing_geojson("vancouver_contours.geojson")
    features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_contours.geojson", features)
        print(f"✅ 等高線圖資更新完成，共 {len(features)} 條等高線。")
    return features

if __name__ == "__main__":
    update_contours()
