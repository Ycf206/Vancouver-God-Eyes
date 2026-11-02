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
            f"{current_year}-01-01 (New Year's Day)",
            f"{current_year}-02-16 (Family Day)",
            f"{current_year}-04-03 (Good Friday)",
            f"{current_year}-04-06 (Easter Monday)",
            f"{current_year}-05-18 (Victoria Day)",
            f"{current_year}-07-01 (Canada Day)",
            f"{current_year}-08-03 (BC Day)",
            f"{current_year}-09-07 (Labour Day)",
            f"{current_year}-09-30 (National Day for Truth and Reconciliation)",
            f"{current_year}-10-12 (Thanksgiving)",
            f"{current_year}-11-11 (Remembrance Day)",
            f"{current_year}-12-24: 9:30 am – 5:00 pm (Christmas Eve)",
            f"{current_year}-12-25 (Christmas Day)",
            f"{current_year}-12-26 (Boxing Day)"
        ]

    for feat in features:
        feat.setdefault("properties", {})["upcoming_closures"] = closures

    if features:
        save_layer_geojson("vancouver_libraries.geojson", features)
        print(f"✅ 公共圖書館資料更新完成，共 {len(features)} 間分館。")
    return features

if __name__ == "__main__":
    update_libraries()
