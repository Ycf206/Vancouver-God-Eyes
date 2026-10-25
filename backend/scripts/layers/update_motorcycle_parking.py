import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_motorcycle_parking():
    print("🏍️ 正在更新摩托車專屬車位 (Motorcycle Parking)...")
    records = fetch_all_records("motorcycle-parking")
    features = []

    for idx, r in enumerate(records):
        geo = r.get("geo_point_2d") or {}
        lat = geo.get("lat")
        lon = geo.get("lon")

        if lat is None or lon is None:
            geom = r.get("geom") or {}
            coords = geom.get("geometry", {}).get("coordinates", [])
            if len(coords) >= 2:
                lon, lat = coords[0], coords[1]

        if lat is None or lon is None:
            continue

        obj_id = r.get("object_id") or r.get("meter_id") or idx
        street = r.get("street") or ""
        block = r.get("block") or ""
        name = f"{block} {street}".strip() or "摩托車停車位"

        props = {
            "id": f"moto_{obj_id}",
            "facility_type": "motorcycle_parking",
            "name": name,
            "meter_id": r.get("meter_id"),
            "street": street,
            "block": block,
            "address": name,
            "local_area": r.get("geo_local_area") or r.get("local_area") or "",
            "rate_9am_6pm": r.get("rate_9am_6pm"),
            "rate_6pm_10pm": r.get("rate_6pm_10pm"),
            "flat_rate": r.get("flat_rate"),
            "credit_card": r.get("credit_card")
        }

        feat = {
            "type": "Feature",
            "id": f"moto_{obj_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_motorcycle_parking.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_motorcycle_parking.geojson", features)
        sync_facility_to_db("motorcycle_parking", features)
        print(f"✅ 摩托車車位更新完成，共 {len(features)} 處車位。")
    return features

if __name__ == "__main__":
    update_motorcycle_parking()
