#!/usr/bin/env python3
"""
Automated updater for Vancouver Truck Routes dataset with Special Restrictions (Vertical Clearances & Weight Restrictions).
Source: opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/truck-routes/
"""

import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

# 12 Vertical Clearance Points requested by user
CLEARANCE_POINTS = [
    {
        "lat": 49.2687809, "lon": -123.1391959,
        "title": "Granville Bridge",
        "subtitle": "1508 W 3rd Ave",
        "restriction_text": "Vertical Clearances - 5.1m",
        "clearance": "5.1m"
    },
    {
        "lat": 49.2666347, "lon": -123.1148279,
        "title": "Cambie Bridge",
        "subtitle": "W 2nd Ave",
        "restriction_text": "Vertical Clearances - 4.95m",
        "clearance": "4.95m"
    },
    {
        "lat": 49.2648935, "lon": -123.0736911,
        "title": "N Grandview Hwy",
        "subtitle": "2222 Woodland Dr",
        "restriction_text": "Vertical Clearances - 4.3m",
        "clearance": "4.3m"
    },
    {
        "lat": 49.2580739, "lon": -123.0601001,
        "title": "South Grandview Highway",
        "subtitle": "South Grandview Highway",
        "restriction_text": "Vertical Clearances - 4.3m",
        "clearance": "4.3m"
    },
    {
        "lat": 49.2695639, "lon": -123.0276953,
        "title": "Trans-Canada Highway",
        "subtitle": "3401 E 1st Ave",
        "restriction_text": "Vertical Clearances - 4.8m",
        "clearance": "4.8m"
    },
    {
        "lat": 49.2891476, "lon": -123.0405671,
        "title": "Commissioner St",
        "subtitle": "Wall St",
        "restriction_text": "Vertical Clearances - 4.9m",
        "clearance": "4.9m"
    },
    {
        "lat": 49.2887019, "lon": -123.0362056,
        "title": "New Brighton Rd",
        "subtitle": "Wall St",
        "restriction_text": "Vertical Clearances - 4.18m",
        "clearance": "4.18m"
    },
    {
        "lat": 49.2905475, "lon": -123.0268953,
        "title": "Iron Workers Memorial Bridge",
        "subtitle": "Trans-Canada Highway",
        "restriction_text": "Vertical Clearances - 4.8m",
        "clearance": "4.8m"
    },
    {
        "lat": 49.208187, "lon": -123.0236626,
        "title": "SE Marine Drive",
        "subtitle": "Boundary Way",
        "restriction_text": "Vertical Clearances - 5.25m",
        "clearance": "5.25m"
    },
    {
        "lat": 49.2110453, "lon": -123.0240717,
        "title": "Grey Gum Trail",
        "subtitle": "Boundary Way",
        "restriction_text": "Vertical Clearances - 5.85m",
        "clearance": "5.85m"
    },
    {
        "lat": 49.2111431, "lon": -123.0770888,
        "title": "Knight Street Bridge",
        "subtitle": "SE Marine Drive",
        "restriction_text": "Vertical Clearances - 4.85m",
        "clearance": "4.85m"
    },
    {
        "lat": 49.203073, "lon": -123.1348706,
        "title": "Arthur Laing Bridge",
        "subtitle": "Hudson Street",
        "restriction_text": "Vertical Clearances - 4.15m",
        "clearance": "4.15m"
    }
]

# Granville Bridge Weight Restriction Point (User 1.2.2)
WEIGHT_RESTRICTION_POINTS = [
    {
        "lat": 49.27135, "lon": -123.13368,
        "title": "Granville Bridge",
        "subtitle": "Vancouver, BC",
        "restriction_text": "Weight Restriction",
        "clearance": "4.15m"
    }
]

# Granville Bridge Line Coordinates (Connecting Drake/Pacific Blvd Howe/Seymour St across False Creek down to 4th/5th Ave)
GRANVILLE_BRIDGE_COORDS = [
    [-123.1287, 49.2762], # Howe & Drake
    [-123.1303, 49.2749], # Howe & Pacific
    [-123.1337, 49.2713], # Bridge Center over False Creek
    [-123.1365, 49.2682], # Bridge South approach
    [-123.1388, 49.2657], # Granville & 4th Ave
    [-123.1392, 49.2648]  # Granville & 5th Ave
]

def update_truck_routes():
    print("🚛 正在更新溫哥華貨車路線網絡 (Truck Routes Network)...")
    records = fetch_all_records("truck-routes")
    features = []

    # 1. 處理路線線段
    for idx, r in enumerate(records):
        geom_dict = r.get("geom") or {}
        geometry = geom_dict.get("geometry") or geom_dict
        if not geometry or not geometry.get("coordinates"):
            continue

        feat = {
            "type": "Feature",
            "id": f"truck_route_{idx}",
            "geometry": geometry,
            "properties": {
                "id": f"truck_route_{idx}",
                "facility_type": "truck_routes",
                "route_type": "standard",
                "name": "溫哥華法定貨車路線 (Truck Route)",
                "color": "#0284c7"
            }
        }
        features.append(feat)

    # 2. 加入 Granville Bridge 橙色重量限制專屬線段 (Granville Bridge Orange Route)
    features.append({
        "type": "Feature",
        "id": "truck_route_granville_bridge",
        "geometry": {
            "type": "LineString",
            "coordinates": GRANVILLE_BRIDGE_COORDS
        },
        "properties": {
            "id": "truck_route_granville_bridge",
            "facility_type": "truck_routes",
            "route_type": "granville_bridge",
            "name": "Granville Bridge (重量限制路線 Weight Restriction)",
            "color": "#f97316",
            "is_weight_restricted": True
        }
    })

    # 3. 加入 12 個高度限制圓點 (Vertical Clearances)
    for idx, p in enumerate(CLEARANCE_POINTS):
        pt_id = f"truck_restriction_clearance_{idx+1}"
        features.append({
            "type": "Feature",
            "id": pt_id,
            "geometry": {
                "type": "Point",
                "coordinates": [p["lon"], p["lat"]]
            },
            "properties": {
                "id": pt_id,
                "facility_type": "truck_routes_restriction",
                "restriction_type": "clearance",
                "name": p["title"],
                "subtitle": p["subtitle"],
                "badge": "高度限制",
                "clearance": p["clearance"],
                "restriction_text": p["restriction_text"],
                "color": "#f59e0b"
            }
        })

    # 4. 加入 Granville Bridge 重量限制圓點 (Weight Restriction)
    for idx, p in enumerate(WEIGHT_RESTRICTION_POINTS):
        pt_id = f"truck_restriction_weight_{idx+1}"
        features.append({
            "type": "Feature",
            "id": pt_id,
            "geometry": {
                "type": "Point",
                "coordinates": [p["lon"], p["lat"]]
            },
            "properties": {
                "id": pt_id,
                "facility_type": "truck_routes_restriction",
                "restriction_type": "weight",
                "name": p["title"],
                "subtitle": p["subtitle"],
                "badge": "重量限制",
                "clearance": p["clearance"],
                "restriction_text": p["restriction_text"],
                "color": "#f97316"
            }
        })

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_truck_routes.geojson")
        features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_truck_routes.geojson", features)
        print(f"✅ 貨車路線更新完成，共 {len(features)} 筆圖資 (含路線及限制點)。")
    return features

if __name__ == "__main__":
    update_truck_routes()
