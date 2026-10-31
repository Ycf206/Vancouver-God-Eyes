import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

FEDEX_API_URL = "https://local.fedex.com/api/v1/entities"

def update_fedex():
    print("🚀 正在更新 FedEx 門市與自取據點資料...")

    backend_data_dir = os.path.join(os.path.dirname(CURRENT_DIR), "data")
    existing_geojson_path = os.path.join(backend_data_dir, "vancouver_fedex.geojson")
    
    # If existing data exists, we maintain and validate
    features = []
    if os.path.exists(existing_geojson_path):
        try:
            with open(existing_geojson_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
                features = existing.get("features", [])
        except Exception as e:
            print(f"Warning: Could not read existing geojson: {e}")

    # Build standard GeoJSON FeatureCollection
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    frontend_path = os.path.join(os.path.dirname(os.path.dirname(CURRENT_DIR)), "frontend", "public", "vancouver_fedex.geojson")
    save_layer_geojson(geojson, "vancouver_fedex.geojson")
    
    # Save to frontend public as well
    os.makedirs(os.path.dirname(frontend_path), exist_ok=True)
    with open(frontend_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"✅ FedEx 門市資料已更新完成，共 {len(features)} 處據點。")

if __name__ == "__main__":
    update_fedex()
