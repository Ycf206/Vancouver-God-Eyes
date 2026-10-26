#!/usr/bin/env python3
"""
Automated updater for Vancouver Lime E-Scooter dataset.
Source 1 (Monthly Station Locations):
  Proxy:  https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv1%2Fgbfs%2Fvancouver_bc%2Fstation_information.json
  Direct: https://data.lime.bike/api/partners/v1/gbfs/vancouver_bc/station_information.json
Source 2 (Hourly Real-time Scooter Count & Docks):
  Proxy:  https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv2%2Fgbfs%2Fvancouver_bc%2Fstation_status.json
  Direct: https://data.lime.bike/api/partners/v2/gbfs/vancouver_bc/station_status.json

Modes:
  --mode stations (Monthly): Full sync of station information and locations.
  --mode status   (Hourly) : Fast sync of real-time scooter and dock availability by station_id.
"""

import os
import sys
import json
import re
import argparse
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, BACKEND_DATA_DIR, FRONTEND_DATA_DIR

LIME_INFO_URLS = [
    "https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv1%2Fgbfs%2Fvancouver_bc%2Fstation_information.json",
    "https://data.lime.bike/api/partners/v1/gbfs/vancouver_bc/station_information.json"
]

LIME_STATUS_URLS = [
    "https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv2%2Fgbfs%2Fvancouver_bc%2Fstation_status.json",
    "https://data.lime.bike/api/partners/v2/gbfs/vancouver_bc/station_status.json"
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.li.me/"
}

def fetch_json_with_fallback(urls):
    """Fetches JSON trying proxy URL first and falling back to direct endpoint if blocked."""
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                if data and "data" in data:
                    return data
        except Exception:
            continue
    return None

def update_escooter_stations():
    """Monthly workflow: update station information, locations, and real-time status."""
    print("🛴 [Lime 每月站點資訊更新] 正在取得 Lime 共享滑板車站點清單...")
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
    print(f"✅ Lime 共享滑板車站點更新完成！共寫入 {len(features)} 處站點資料。")
    return features

def update_escooter_status():
    """Hourly workflow: update real-time available scooters and docks using station_status.json."""
    print("🛴 [Lime 每小時即時車況更新] 正在讀取 station_status.json 更新各站可用車輛與還車位...")
    source_file = os.path.join(BACKEND_DATA_DIR, "vancouver_escooter.geojson")
    if not os.path.exists(source_file):
        source_file = os.path.join(FRONTEND_DATA_DIR, "vancouver_escooter.geojson")

    if not os.path.exists(source_file):
        print("⚠️ 找不到現有共享滑板車 GeoJSON，自動切換至全量站點更新模式...")
        return update_escooter_stations()

    status_json = fetch_json_with_fallback(LIME_STATUS_URLS)
    if not status_json:
        print("❌ 無法取得 Lime station_status 數據")
        return []

    raw_status = status_json.get("data", {}).get("stations", [])
    print(f"📡 取得 {len(raw_status)} 筆即時狀態記錄...")

    status_map = {
        s.get("station_id"): s
        for s in raw_status if s.get("station_id")
    }

    with open(source_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    existing_features = data.get("features", [])
    updated_features = []

    for f in existing_features:
        props = f.get("properties") or {}
        sid = props.get("station_id") or f.get("id")
        if sid in status_map:
            st_stat = status_map[sid]
            avail_vehicles = st_stat.get("num_vehicles_available", 0)
            avail_docks = st_stat.get("num_docks_available", 0)
            props["available_vehicles"] = avail_vehicles
            props["available_docks"] = avail_docks
            props["capacity"] = avail_vehicles + avail_docks
            props["is_renting"] = bool(st_stat.get("is_renting", True))
            props["is_returning"] = bool(st_stat.get("is_returning", True))
        f["properties"] = props
        updated_features.append(f)

    save_layer_geojson("vancouver_escooter.geojson", updated_features)
    print(f"✅ Lime 共享滑板車即時狀態更新完成！共同步 {len(updated_features)} 處站點車況。")
    return updated_features

def main():
    parser = argparse.ArgumentParser(description="Vancouver Lime E-Scooters Updater")
    parser.add_argument(
        "--mode",
        choices=["stations", "status"],
        default="status",
        help="Update mode: 'stations' for monthly full information, 'status' for hourly real-time status"
    )
    args = parser.parse_args()

    if args.mode == "stations":
        update_escooter_stations()
    else:
        update_escooter_status()

if __name__ == "__main__":
    main()
