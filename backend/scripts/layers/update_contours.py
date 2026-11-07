#!/usr/bin/env python3
"""
Automated updater for Vancouver Elevation Contours dataset.
Sources (OpenData v2.1):
  1m : https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-1-metre-contours/records/?lang=en
  2m : https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-2-metre-contours/records/?lang=en
  10m: https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-10-metre-contours/records/?lang=en
"""

import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

CONTOUR_DATASETS = {
    "1m": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-1-metre-contours/records/?lang=en",
    "2m": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-2-metre-contours/records/?lang=en",
    "10m": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/elevation-contour-lines-10-metre-contours/records/?lang=en",
}

def fetch_records_v2_1(url: str, limit: int = 100):
    """Fetch paginated records from Vancouver OpenData v2.1 API."""
    features = []
    offset = 0
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        "Accept": "application/json"
    }

    while True:
        paged_url = f"{url}&limit={limit}&offset={offset}"
        try:
            resp = requests.get(paged_url, headers=headers, timeout=20)
            if resp.status_code != 200:
                print(f"⚠️ Fetch returned HTTP {resp.status_code} at offset {offset}")
                break
            data = resp.json()
            records = data.get("results") or []
            if not records:
                break

            for idx, r in enumerate(records):
                geo = r.get("geo_shape") or r.get("geometry")
                geom = geo.get("geometry") if geo and "geometry" in geo else geo
                if not geom:
                    continue
                elev = r.get("elevation") or r.get("contour") or 0
                features.append({
                    "type": "Feature",
                    "id": f"contour_{offset + idx}",
                    "geometry": geom,
                    "properties": {
                        "elevation": elev,
                        "facility_type": "contours",
                        "unit": "m"
                    }
                })

            offset += len(records)
            total_count = data.get("total_count", 0)
            if offset >= total_count or len(records) < limit:
                break
        except Exception as e:
            print(f"⚠️ Error fetching contours: {e}")
            break

    return features

def update_contours(resolution: str = "10m"):
    print(f"🏔️ 正在更新等高線地形高程 ({resolution} Elevation Contours)...")
    url = CONTOUR_DATASETS.get(resolution, CONTOUR_DATASETS["10m"])
    features = fetch_records_v2_1(url, limit=100)

    if not features:
        print("ℹ️ API 無法連線或限制，使用快取圖資備份...")
        existing = load_existing_geojson("vancouver_contours.geojson")
        features = existing.get("features", []) if existing else []

    if features:
        save_layer_geojson("vancouver_contours.geojson", features)
        print(f"✅ 等高線圖資更新完成，共 {len(features)} 條等高線。")
    return features

if __name__ == "__main__":
    update_contours("10m")
