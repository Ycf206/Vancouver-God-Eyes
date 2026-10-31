import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson

# Purolator Locations API
PUROLATOR_API_BASE = "https://94r0mbpmce.execute-api.ca-central-1.amazonaws.com/prod/locations"

# 大溫哥華核心查詢中心座標 (包含溫哥華、列治文、本拿比、素里、北溫、高貴林)，確保完整覆蓋
QUERY_COORDINATES = [
    (49.2827291, -123.1207375),  # Vancouver Downtown
    (49.2488, -122.9805),        # Burnaby / New West
    (49.1666, -123.1336),        # Richmond
    (49.1913, -122.8490),        # Surrey
    (49.3200, -123.0724),        # North Vancouver
    (49.2838, -122.7932),        # Coquitlam / Port Coquitlam
]

def fetch_purolator_locations():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    seen_ids = set()
    features = []

    for lat, lng in QUERY_COORDINATES:
        try:
            url = f"{PUROLATOR_API_BASE}?lat={lat}&lng={lng}"
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code != 200:
                print(f"Warning: Purolator API returned {resp.status_code} for lat={lat}, lng={lng}")
                continue

            data = resp.json()
            locations = data.get("locations", []) if isinstance(data, dict) else []

            for loc in locations:
                # 僅保留 activeLocation == "True" 的店舖
                active = str(loc.get("activeLocation", "")).strip().lower()
                if active != "true":
                    continue

                loc_id = str(loc.get("locationId") or f"{loc.get('latitude')}_{loc.get('longitude')}")
                if loc_id in seen_ids:
                    continue
                seen_ids.add(loc_id)

                try:
                    lon_val = float(loc.get("longitude"))
                    lat_val = float(loc.get("latitude"))
                except (TypeError, ValueError):
                    continue

                # 確保在大溫哥華經緯度範圍內 (Lat: 48.9 ~ 49.6, Lon: -123.4 ~ -122.4)
                if not (48.9 <= lat_val <= 49.6 and -123.5 <= lon_val <= -122.3):
                    continue

                feat = {
                    "type": "Feature",
                    "id": loc_id,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon_val, lat_val]
                    },
                    "properties": {
                        **loc,
                        "id": loc_id,
                        "name": loc.get("locationName") or "Purolator",
                        "brand": "Purolator",
                        "category": "purolator"
                    }
                }
                features.append(feat)

        except Exception as e:
            print(f"Error fetching Purolator coords ({lat}, {lng}): {e}")

    return features

def update_purolator():
    print("🚀 正在更新 Purolator 門市與自取據點資料 (每個月更新 1 次)...")

    features = fetch_purolator_locations()
    geojson = {
        "type": "FeatureCollection",
        "generator": "Vancouver God's Eye Purolator Updater",
        "features": features
    }

    # 儲存至 backend/data 與 frontend/public
    save_layer_geojson("vancouver_purolator.geojson", features, is_feature_list=True)

    print(f"✅ Purolator 門市資料已更新完成，共收錄 {len(features)} 處活躍營業據點。")

if __name__ == "__main__":
    update_purolator()
