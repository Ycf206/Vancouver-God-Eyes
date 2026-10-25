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
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        resp = requests.get("https://streetfoodapp.com/vancouver", headers=headers, timeout=25)
        if resp.status_code == 200:
            html = resp.text
            card_regex = re.compile(r'<a\s+[^>]*class="[^"]*__vendor-card[^"]*"[^>]*data-latitude="([^"]+)"[^>]*data-longitude="([^"]+)"[^>]*data-vendor-name="([^"]+)"[\s\S]*?</a>')
            matches = card_regex.findall(html)

            other_cities = ['port moody', 'burnaby', 'richmond', 'surrey', 'coquitlam', 'north vancouver', 'west vancouver', 'new westminster', 'delta', 'langley']
            idx = 1
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
                    features.append({
                        "type": "Feature",
                        "id": f"food_vendor_{idx}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [round(lon, 6), round(lat, 6)]
                        },
                        "properties": {
                            "id": f"food_vendor_{idx}",
                            "facility_type": "food_vendors",
                            "name": name,
                            "business_name": name,
                            "address": address,
                            "hours": hours,
                            "has_credit_card": "fa-credit-card" in card_html,
                            "local_area": "Vancouver"
                        }
                    })
                    idx += 1
    except Exception as e:
        print(f"⚠️ 線上更新街頭熟食攤販失敗: {e}")

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
