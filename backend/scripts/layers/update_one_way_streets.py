import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

def _round_coords(geom_coords):
    if not geom_coords:
        return []
    if isinstance(geom_coords[0], (int, float)):
        return [round(float(geom_coords[0]), 6), round(float(geom_coords[1]), 6)]
    return [_round_coords(c) for c in geom_coords]

def update_one_way_streets():
    print("➡️ 正在更新市區單程道路段 (One-Way Streets)...")
    records = fetch_all_records("road-ahead-one-way-streets")
    features = []

    for idx, r in enumerate(records):
        geom_dict = r.get("geom") or {}
        geometry = geom_dict.get("geometry") or geom_dict
        if not geometry or not geometry.get("coordinates"):
            continue

        geometry["coordinates"] = _round_coords(geometry["coordinates"])
        hblock = r.get("hblock") or f"單程路段 #{idx}"

        props = {
            "id": f"oneway_{idx}",
            "facility_type": "one_way_streets",
            "name": f"單程路 - {hblock}",
            "hblock": hblock,
            "direction": r.get("direction"),
            "streetuse": r.get("streetuse")
        }

        feat = {
            "type": "Feature",
            "id": f"oneway_{idx}",
            "geometry": geometry,
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_one_way_streets.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_one_way_streets.geojson", features)
        print(f"✅ 單程道路段更新完成，共 {len(features)} 處路段。")
    return features

if __name__ == "__main__":
    update_one_way_streets()
