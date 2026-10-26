#!/usr/bin/env python3
"""
Automated updater for Vancouver Mobi Shared Bikes dataset.
Source 1 (Station list & locations): https://www.mobibikes.ca/api/client/entities
Source 2 (Real-time bikes & docks availability): https://www.mobibikes.ca/api/client/entities/stations/{id}
"""

import os
import sys
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson

MOBIBIKES_ENTITIES_URL = "https://www.mobibikes.ca/api/client/entities"
MOBIBIKES_STATION_DETAIL_URL = "https://www.mobibikes.ca/api/client/entities/stations/{station_id}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9"
}

def fetch_station_detail(station_id, fallback_bikes, fallback_slots):
    """Fetch real-time updated available bikes and slots for an individual Mobi station."""
    url = MOBIBIKES_STATION_DETAIL_URL.format(station_id=station_id)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=6)
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

def update_shared_bikes():
    print("🚲 正在拉取 Mobi 共享單車最新站點與即時車況...")
    try:
        resp = requests.get(MOBIBIKES_ENTITIES_URL, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f"❌ 無法取得 Mobi entities: HTTP {resp.status_code}")
            return []
        data = resp.json()
        raw_stations = data.get("data", {}).get("stations", [])
        print(f"📡 成功取得 {len(raw_stations)} 處 Mobi 站點清單，正在同步即時單車與還車槽資料...")
    except Exception as e:
        print(f"❌ 請求 Mobi entities 例外: {e}")
        return []

    if not raw_stations:
        print("⚠️ 未取得任何站點資料")
        return []

    # 並行查詢各站點即時車況
    realtime_map = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(
                fetch_station_detail,
                st.get("id"),
                st.get("availableBikes", 0),
                st.get("availableSlots", 0)
            ): st.get("id")
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

        # 取即時查詢或 entities 快取車位數
        bikes, slots = realtime_map.get(
            st_id,
            (st.get("availableBikes", 0), st.get("availableSlots", 0))
        )
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
    print(f"✅ Mobi 共享單車更新完成！共寫入 {len(features)} 處站點與即時車況。")
    return features

if __name__ == "__main__":
    update_shared_bikes()
