import os
import sys
import re
import requests
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

def update_libraries():
    print("📚 正在更新溫哥華公共圖書館 (VPL) 與閉館行事曆...")
    existing = load_existing_geojson("vancouver_libraries.geojson")
    features = existing.get("features", []) if existing else []

    current_year = datetime.now().year
    closures = []
    try:
        resp = requests.get("https://www.vpl.ca/hours-locations", headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        if resp.status_code == 200:
            html = resp.text
            matches = re.findall(r"(?:Closed|Closing early)[^<]*", html, re.IGNORECASE)
            if matches:
                closures = list(dict.fromkeys(m.strip() for m in matches))[:10]
    except Exception as e:
        print(f"⚠️ 爬取 VPL 網頁失敗: {e}")

    if not closures:
        closures = [
            f"Thursday, January 1, {current_year}: Closed (New Year's Day)",
            f"Monday, February 16, {current_year}: Closed (Family Day)",
            f"Friday, April 3, {current_year}: Closed (Good Friday)",
            f"Monday, April 6, {current_year}: Closed (Easter Monday)",
            f"Monday, May 18, {current_year}: Closed (Victoria Day)",
            f"Wednesday, July 1, {current_year}: Closed (Canada Day)",
            f"Monday, August 3, {current_year}: Closed (BC Day)",
            f"Monday, September 7, {current_year}: Closed (Labour Day)",
            f"Wednesday, September 30, {current_year}: Closed (National Day for Truth and Reconciliation)",
            f"Monday, October 12, {current_year}: Closed (Thanksgiving)",
            f"Wednesday, November 11, {current_year}: Closed (Remembrance Day)",
            f"Thursday, December 24, {current_year}: 9:30 am – 5:00 pm (Closing early for Christmas Eve)",
            f"Friday, December 25, {current_year}: Closed (Christmas Day)",
            f"Saturday, December 26, {current_year}: Closed (Boxing Day)"
        ]

    for feat in features:
        feat.setdefault("properties", {})["upcoming_closures"] = closures

    if features:
        save_layer_geojson("vancouver_libraries.geojson", features)
        print(f"✅ 公共圖書館資料更新完成，共 {len(features)} 間分館。")
    return features

if __name__ == "__main__":
    update_libraries()
