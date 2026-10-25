import os
import sys
import re
import requests
import json
from html import unescape

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, sync_facility_to_db

BC_PAD_URL = "https://bcpadprogram.ca/admin/contentx/default.cfm?PageId=11521"

def update_aed():
    print("⚡ 正在從 BC PAD Program 官網爬取自動體外心臟去顫器 (AED) 資料...")
    
    # 載入現有 GeoJSON 快取以保留精確坐標
    existing_geojson = load_existing_geojson("vancouver_aed.geojson")
    features_map = {}
    if existing_geojson and "features" in existing_geojson:
        for f in existing_geojson["features"]:
            props = f.get("properties", {})
            name = (props.get("name") or "").strip().lower()
            addr = (props.get("address") or "").strip().lower()
            if name:
                features_map[name] = f
            if addr:
                features_map[addr] = f

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }

    try:
        resp = requests.get(BC_PAD_URL, headers=headers, timeout=20)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        print(f"⚠️ 連線 BC PAD 失敗: {e}，使用現有快取資料...")
        html = ""

    parsed_rows = []
    if html:
        table_match = re.search(r"<table[^>]*class=['\"]data['\"][^>]*>([\s\S]*?)</table>", html, re.I)
        if table_match:
            rows = re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", table_match.group(1), re.I)
            for r in rows:
                cols = re.findall(r"<td[^>]*>([\s\S]*?)</td>", r, re.I)
                clean_cols = [unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in cols]
                if len(clean_cols) >= 3:
                    venue, muni, addr = clean_cols[0], clean_cols[1], clean_cols[2]
                    if not venue or venue.lower() == "venue name":
                        continue
                    if re.search(r"vancouver", muni, re.I) or re.search(r"vancouver", addr, re.I):
                        parsed_rows.append({
                            "venue": venue,
                            "municipality": muni,
                            "address": addr
                        })

    print(f"ℹ️ 成功解析到大溫地區 {len(parsed_rows)} 處 BC PAD 去顫器點位。")

    features = []
    seen_ids = set()

    # 1. 處理爬取到的點位
    for idx, row in enumerate(parsed_rows):
        venue = row["venue"]
        addr = row["address"]
        muni = row["municipality"]

        venue_key = venue.strip().lower()
        addr_key = addr.strip().lower()

        matched_f = features_map.get(venue_key) or features_map.get(addr_key)
        
        if matched_f:
            lon, lat = matched_f["geometry"]["coordinates"]
            obj_id = matched_f["properties"].get("object_id") or matched_f["properties"].get("id") or idx + 1
            loc_desc = matched_f["properties"].get("location_description") or ""
            local_area = matched_f["properties"].get("local_area") or muni
        else:
            # 預設落點在溫哥華市區 (若為全新未匹配點)
            lon, lat = -123.1207, 49.2827
            obj_id = f"bcpad_{idx + 1}"
            loc_desc = ""
            local_area = muni or "Vancouver"

        fid = f"aed_{obj_id}"
        if fid in seen_ids:
            continue
        seen_ids.add(fid)

        feat = {
            "type": "Feature",
            "id": fid,
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": fid,
                "object_id": obj_id,
                "facility_type": "aed",
                "name": venue,
                "address": addr,
                "location_description": loc_desc,
                "municipality": muni or "Vancouver",
                "local_area": local_area,
                "source": "BC PAD Program"
            }
        }
        features.append(feat)

    # 2. 若爬取為空，回退使用現有快取
    if not features and existing_geojson and "features" in existing_geojson:
        features = existing_geojson["features"]

    if features:
        save_layer_geojson("vancouver_aed.geojson", features)
        sync_facility_to_db("aed", features)
        print(f"✅ AED 去顫器更新完成，共 {len(features)} 處機台。")

    return features

if __name__ == "__main__":
    update_aed()
