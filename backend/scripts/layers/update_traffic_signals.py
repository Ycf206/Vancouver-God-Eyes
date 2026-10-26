#!/usr/bin/env python3
"""
Automated updater for Vancouver Traffic Signals dataset.
Source: opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/traffic-signals/
"""

import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

SIGNAL_TYPE_MAP = {
    "Pedestrian Actuated Signal": "行人感應信號燈",
    "RRFB": "行人穿越道信號燈",
    "FH": "消防局出入口信號燈",
    "Fully Actuated": "全感應式交通燈",
    "Semi Actuated": "半感應式交通燈",
    "Fixed Time": "固定式交通燈",
    "CS": "車道管制信號燈"
}

def update_traffic_signals():
    print("🚦 正在更新溫哥華交通信號燈 (Traffic Signals)...")
    records = fetch_all_records("traffic-signals")
    features = []

    for idx, r in enumerate(records):
        geom_dict = r.get("geom") or {}
        geometry = geom_dict.get("geometry") or geom_dict
        if not geometry or not geometry.get("coordinates"):
            continue

        local_area = r.get("geo_local_area") or "Vancouver"
        sig_type = r.get("type") or "Traffic Signal"
        sig_type_zh = SIGNAL_TYPE_MAP.get(sig_type, sig_type)

        props = {
            "id": f"traffic_signal_{idx+1}",
            "facility_type": "traffic_signals",
            "name": local_area,
            "geo_local_area": local_area,
            "signal_type": sig_type,
            "signal_type_zh": sig_type_zh,
            "display_type": f"{sig_type} {sig_type_zh}".strip()
        }

        feat = {
            "type": "Feature",
            "id": f"traffic_signal_{idx+1}",
            "geometry": geometry,
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_traffic_signals.geojson")
        features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_traffic_signals.geojson", features)
        print(f"✅ 交通信號燈更新完成，共 {len(features)} 處站點。")
    return features

if __name__ == "__main__":
    update_traffic_signals()
