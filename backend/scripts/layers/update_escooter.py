#!/usr/bin/env python3
"""
Automated updater for Vancouver Lime E-Scooter dataset.
Source 1 (Station Locations):
  Proxy: https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv1%2Fgbfs%2Fvancouver_bc%2Fstation_information.json
  Direct: https://data.lime.bike/api/partners/v1/gbfs/vancouver_bc/station_information.json
Source 2 (Real-time Scooter Count & Docks):
  Proxy: https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv2%2Fgbfs%2Fvancouver_bc%2Fstation_status.json
  Direct: https://data.lime.bike/api/partners/v2/gbfs/vancouver_bc/station_status.json
"""

import os
import sys
import json
import re
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson

LIME_INFO_URLS = [
    "https://data.lime.bike/api/partners/v1/gbfs/vancouver_bc/station_information.json",
    "https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv1%2Fgbfs%2Fvancouver_bc%2Fstation_information.json"
]

LIME_STATUS_URLS = [
    "https://data.lime.bike/api/partners/v2/gbfs/vancouver_bc/station_status.json",
    "https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv2%2Fgbfs%2Fvancouver_bc%2Fstation_status.json"
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.li.me/"
}

def fetch_json_with_fallback(urls):
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                if data and "data" in data:
                    return data
        except Exception as e:
            continue
    return None

def update_escooter():
    print("🛴 正在拉取 Lime 共享滑板車最新站點與即時車況...")
    info_json = fetch_json_with_fallback(LIME_INFO_URLS)
    if not info_json:
        print("❌ 無法取得 Lime 站點資訊 (Information)")
        return []

    status_json = fetch_json_with_fallback(LIME_STATUS_URLS)
    raw_stations = info_json.get("data", {}).get("stations", [])
    raw_status = status_json.get("data", {}).get("stations", []) if status_json else []

    print(f"📡 取得 {len(raw_stations)} 處站點資訊，{len(raw_status)} 筆即時狀態記錄...")

    status_map = {
        s.get("station_id"): s
        for s in raw_status if s.get("station_id")
    }

    features = []
    for st in raw_stations:
        sid = st.get("station_id")
        lon = st.get("lon")
        lat = st.get("lat")
        if lon is None or lat is None:
            continue

        st_stat = status_map.get(sid, {})
        avail_vehicles = st_stat.get("num_vehicles_available", 0)
        avail_docks = st_stat.get("num_docks_available", 0)
        capacity = avail_vehicles + avail_docks

        station_number = ""
        full_name = st.get("name") or "Lime 共享滑板車站"
        station_title = full_name

        m = re.match(r"^(#\d+)\s*[-–—:]\s*(.+)$", full_name)
        if m:
            station_number = m.group(1)
            station_title = m.group(2).strip()
        else:
            m2 = re.match(r"^(#\d+)", full_name)
            if m2:
                station_number = m2.group(1)

        features.append({
            "type": "Feature",
            "id": sid,
            "geometry": {
                "type": "Point",
                "coordinates": [float(lon), float(lat)]
            },
            "properties": {
                "station_id": sid,
                "station_number": station_number,
                "name": station_title,
                "full_name": full_name,
                "available_vehicles": avail_vehicles,
                "available_docks": avail_docks,
                "capacity": capacity if capacity > 0 else 8,
                "is_renting": bool(st_stat.get("is_renting", True)),
                "is_returning": bool(st_stat.get("is_returning", True)),
                "operator": "Lime",
                "facility_type": "escooter"
            }
        })

    save_layer_geojson("vancouver_escooter.geojson", features)
    print(f"✅ Lime 共享滑板車更新完成！共寫入 {len(features)} 處站點與即時車況。")
    return features

if __name__ == "__main__":
    update_escooter()
