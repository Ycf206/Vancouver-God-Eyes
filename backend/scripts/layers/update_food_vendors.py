import os
import sys
import re
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_food_vendors():
    print("🍔 正在更新市區街頭熟食攤販 (Street Food Vendors)...")
    features = []

    # 1. 溫哥華市政官方街頭熟食攤位開放資料 (City of Vancouver Food Vendors Open Data)
    try:
        url = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/food-vendors/records?limit=100"
        resp = requests.get(url, timeout=25)
        if resp.status_code == 200:
            data = resp.json()
            records = data.get("results", [])
            for idx, r in enumerate(records):
                geo_point = r.get("geo_point_2d") or {}
                lat = geo_point.get("lat")
                lon = geo_point.get("lon")
                if lat is not None and lon is not None:
                    desc = r.get("description") or "街頭熟食攤位"
                    key = r.get("key") or f"{idx+1}"
                    bname = r.get("business_name")
                    name = bname if bname else (f"街頭熟食攤位 ({desc})" if desc else f"街頭熟食攤位 #{key}")
                    features.append({
                        "type": "Feature",
                        "id": f"food_vendor_{key}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [round(float(lon), 6), round(float(lat), 6)]
                        },
                        "properties": {
                            "id": f"food_vendor_{key}",
                            "facility_type": "food_vendors",
                            "name": name,
                            "business_name": bname or name,
                            "description": desc,
                            "status": r.get("status") or "open",
                            "address": r.get("location") or "Vancouver, BC",
                            "local_area": r.get("geo_localarea") or "Vancouver",
                            "key": key,
                            "has_credit_card": True
                        }
                    })
            print(f"  -> 從溫哥華市政 Open Data 載入 {len(features)} 處街頭攤位。")
    except Exception as e:
        print(f"⚠️ 載入市政開放資料失敗: {e}")

    # 2. 補充即時營業中的街頭餐車 (StreetFoodApp.com)
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        resp = requests.get("https://streetfoodapp.com/vancouver", headers=headers, timeout=25)
        if resp.status_code == 200:
            html = resp.text
            card_regex = re.compile(r'<a\s+[^>]*class="[^"]*__vendor-card[^"]*"[^>]*data-latitude="([^"]+)"[^>]*data-longitude="([^"]+)"[^>]*data-vendor-name="([^"]+)"[\s\S]*?</a>')

            other_cities = ['port moody', 'burnaby', 'richmond', 'surrey', 'coquitlam', 'north vancouver', 'west vancouver', 'new westminster', 'delta', 'langley']
            s_idx = 1000
            for m in card_regex.finditer(html):
                lat_str, lon_str, name = m.group(1), m.group(2), m.group(3)
                try:
                    lat = float(lat_str)
                    lon = float(lon_str)
                except ValueError:
                    continue

                card_html = m.group(0)
                name = name.replace("&amp;", "&").strip()

                addr_m = re.search(r'<h6 class="card-subtitle mb-2">([^<]+)</h6>', card_html)
                address = addr_m.group(1).replace("&amp;", "&").strip() if addr_m else ""

                hours_m = re.search(r'<h6 class="card-subtitle d-none d-lg-block">([^<]+)</h6>', card_html) or re.search(r'data-time="([^"]+)"', card_html)
                hours = hours_m.group(1).replace("&amp;", "&").strip() if hours_m else ""

                addr_lower = address.lower()
                is_other = any(c in addr_lower for c in other_cities)
                is_van_addr = "vancouver" in addr_lower and not is_other
                is_van_coords = 49.195 <= lat <= 49.315 and -123.275 <= lon <= -123.023 and not is_other

                if is_van_addr or is_van_coords:
                    # 避免與現有重複
                    if not any(f["properties"].get("name") == name for f in features):
                        features.append({
                            "type": "Feature",
                            "id": f"food_vendor_sfa_{s_idx}",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [round(lon, 6), round(lat, 6)]
                            },
                            "properties": {
                                "id": f"food_vendor_sfa_{s_idx}",
                                "facility_type": "food_vendors",
                                "name": name,
                                "business_name": name,
                                "address": address or "Vancouver, BC",
                                "hours": hours,
                                "has_credit_card": "fa-credit-card" in card_html,
                                "local_area": "Vancouver"
                            }
                        })
                        s_idx += 1
    except Exception as e:
        print(f"⚠️ 線上更新 StreetFoodApp 失敗: {e}")

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_food_vendors.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_food_vendors.geojson", features)
        sync_facility_to_db("food_vendors", features)
        print(f"✅ 街頭熟食攤販更新完成，共 {len(features)} 處攤位。")
    return features

if __name__ == "__main__":
    update_food_vendors()
