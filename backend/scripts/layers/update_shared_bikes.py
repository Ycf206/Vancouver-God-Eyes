#!/usr/bin/env python3
"""
Automated updater for Vancouver Mobi Shared Bikes dataset.
Source 1 (Monthly Station list & locations): https://www.mobibikes.ca/api/client/entities
Source 2 (Hourly Real-time bikes & docks availability): https://www.mobibikes.ca/api/client/entities/stations/{id}

Modes:
  --mode stations (Monthly): Full sync of stations list, locations, and real-time status.
  --mode status   (Hourly) : Fast sync of real-time bikes and slots availability for existing stations.
"""

import os
import sys
import json
import argparse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, BACKEND_DATA_DIR, FRONTEND_DATA_DIR

MOBIBIKES_ENTITIES_URL = "https://www.mobibikes.ca/api/client/entities"
MOBIBIKES_STATION_DETAIL_URL = "https://www.mobibikes.ca/api/client/entities/stations/{station_id}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9"
}

def fetch_station_detail(station_id, fallback_bikes=0, fallback_slots=0):
    """Fetch real-time updated available bikes and slots for an individual Mobi station from detail endpoint."""
    url = MOBIBIKES_STATION_DETAIL_URL.format(station_id=station_id)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=7)
        if resp.status_code == 200:
            d = resp.json()
            st_data = d.get("data", {}).get("station", {})
            if st_data:
                return (
                    station_id,
                    st_data.get("availableBikes", fallback_bikes),
                    st_data.get("availableSlots", fallback_slots)
                )
    except Exception:
        pass
    return (station_id, fallback_bikes, fallback_slots)

def update_mobi_stations():
    """Monthly workflow: update station geometry, names, and real-time availability."""
    print("🚲 [Mobi 每月站點更新] 正在從 https://www.mobibikes.ca/api/client/entities 取得最新站點清單...")
    try:
        resp = requests.get(MOBIBIKES_ENTITIES_URL, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f"❌ 無法取得 Mobi entities: HTTP {resp.status_code}")
            return []
        data = resp.json()
        raw_stations = data.get("data", {}).get("stations", [])
        print(f"📡 成功取得 {len(raw_stations)} 處 Mobi 站點清單，正在並行拉取各站 /entities/stations/{{id}} 精確即時車況...")
    except Exception as e:
        print(f"❌ 請求 Mobi entities 例外: {e}")
        return []

    if not raw_stations:
        print("⚠️ 未取得任何站點資料")
        return []

    # 並行查詢各站點精確即時車況 (/entities/stations/{id})
    realtime_map = {}
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(fetch_station_detail, st.get("id"), st.get("availableBikes", 0), 0): st.get("id")
            for st in raw_stations if st.get("id")
        }
        for future in as_completed(futures):
            try:
                st_id, bikes, slots = future.result()
                realtime_map[st_id] = (bikes, slots)
            except Exception:
                pass

    features = []
    for st in raw_stations:
        st_id = st.get("id") or ""
        coords = st.get("coordinates") or [0, 0]
        if not coords or len(coords) < 2 or (coords[0] == 0 and coords[1] == 0):
            continue

        lon = float(coords[0])
        lat = float(coords[1])
        label = st.get("label") or "Mobi 共享單車站"

        # 取 /entities/stations/{id} 精確數值 (絕不使用 /entities 的 slots，因其不準確)
        bikes, slots = realtime_map.get(st_id, (st.get("availableBikes", 0), 0))
        total_cap = (bikes or 0) + (slots or 0)
        clean_id = st_id.replace("st_", "").strip().upper()[:8]

        feat = {
            "type": "Feature",
            "id": st_id,
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "id": st_id,
                "name": label,
                "station_id": clean_id,
                "full_id": st_id,
                "available_bikes": bikes,
                "available_slots": slots,
                "capacity": total_cap if total_cap > 0 else 10,
                "is_closed": bool(st.get("isClosed", False)),
                "operator": "Mobi by Rogers",
                "facility_type": "shared_bikes"
            }
        }
        features.append(feat)

    save_layer_geojson("vancouver_shared_bikes.geojson", features)
    print(f"✅ Mobi 共享單車站點更新完成！共寫入 {len(features)} 處站點資料。")
    return features

def update_mobi_status():
    """Hourly workflow: quickly update real-time bikes and slots for existing stations."""
    print("🚲 [Mobi 每小時即時車況更新] 正在讀取現有站點並透過 /entities/stations/{id} 同步最新可用車位...")
    source_file = os.path.join(BACKEND_DATA_DIR, "vancouver_shared_bikes.geojson")
    if not os.path.exists(source_file):
        source_file = os.path.join(FRONTEND_DATA_DIR, "vancouver_shared_bikes.geojson")

    if not os.path.exists(source_file):
        print("⚠️ 找不到現有共享單車 GeoJSON，自動切換至全量站點更新模式...")
        return update_mobi_stations()

    with open(source_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    existing_features = data.get("features", [])
    if not existing_features:
        return update_mobi_stations()

    station_ids = [
        f.get("properties", {}).get("full_id") or f.get("properties", {}).get("id") or f.get("id")
        for f in existing_features
    ]
    station_ids = [sid for sid in station_ids if sid]
    print(f"📡 現有 {len(station_ids)} 處站點，正在並行拉取最新 /entities/stations/{{id}} 數據...")

    realtime_map = {}
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(fetch_station_detail, sid, 0, 0): sid
            for sid in station_ids
        }
        for future in as_completed(futures):
            try:
                st_id, bikes, slots = future.result()
                realtime_map[st_id] = (bikes, slots)
            except Exception:
                pass

    updated_features = []
    for f in existing_features:
        props = f.get("properties") or {}
        st_id = props.get("full_id") or props.get("id") or f.get("id")
        if st_id in realtime_map:
            bikes, slots = realtime_map[st_id]
            props["available_bikes"] = bikes
            props["available_slots"] = slots
            cap = bikes + slots
            if cap > 0:
                props["capacity"] = cap
        f["properties"] = props
        updated_features.append(f)

    save_layer_geojson("vancouver_shared_bikes.geojson", updated_features)
    print(f"✅ Mobi 共享單車即時車況更新完成！共同步 {len(updated_features)} 處站點數據。")
    return updated_features

def main():
    parser = argparse.ArgumentParser(description="Vancouver Mobi Shared Bikes Updater")
    parser.add_argument(
        "--mode",
        choices=["stations", "status"],
        default="status",
        help="Update mode: 'stations' for monthly full structure, 'status' for hourly real-time availability"
    )
    args = parser.parse_args()

    if args.mode == "stations":
        update_mobi_stations()
    else:
        update_mobi_status()

if __name__ == "__main__":
    main()
