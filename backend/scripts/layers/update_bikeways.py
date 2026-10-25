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

def update_bikeways():
    print("🚲 正在更新單車專用徑道路網 (Bikeways Network)...")
    records = fetch_all_records("bikeways")
    features = []

    for idx, r in enumerate(records):
        geom_dict = r.get("geom") or {}
        geometry = geom_dict.get("geometry") or geom_dict
        if not geometry or not geometry.get("coordinates"):
            continue

        geometry["coordinates"] = _round_coords(geometry["coordinates"])
        route_name = r.get("bikeway_name") or r.get("route_name") or r.get("name") or "單車徑"
        street_name = r.get("street_name") or ""
        type_desc = r.get("subtype") or r.get("type") or "單車道"

        props = {
            "id": f"bikeway_{idx}",
            "facility_type": "bikeways",
            "name": f"{route_name} ({street_name})".strip() if street_name else route_name,
            "bike_route_name": route_name,
            "street_name": street_name,
            "route_type": type_desc,
            "status": r.get("status") or "Active"
        }

        feat = {
            "type": "Feature",
            "id": f"bikeway_{idx}",
            "geometry": geometry,
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_bikeways.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_bikeways.geojson", features)
        print(f"✅ 單車徑路網更新完成，共 {len(features)} 處路段。")
    return features

if __name__ == "__main__":
    update_bikeways()
