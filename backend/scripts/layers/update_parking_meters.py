import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_parking_meters():
    print("🅿️ 正在更新路邊停車收費錶 (Parking Meters)...")
    records = fetch_all_records("parking-meters")
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

        meter_id = r.get("meter_id") or r.get("meterid") or r.get("object_id") or f"pm_{idx}"
        name = f"收費錶 #{meter_id}"

        props = {
            "id": f"meter_{meter_id}",
            "facility_type": "parking_meters",
            "name": name,
            "meter_id": str(meter_id),
            "local_area": r.get("geo_local_area") or r.get("local_area") or "",
            "rate_9am_6pm": r.get("rate_9am_6pm"),
            "rate_6pm_10pm": r.get("rate_6pm_10pm"),
            "time_limit_9am_6pm": r.get("time_limit_9am_6pm"),
            "time_limit_6pm_10pm": r.get("time_limit_6pm_10pm"),
            "credit_card": r.get("credit_card"),
            "pay_by_phone": r.get("pay_by_phone"),
            "meter_head": r.get("meter_head")
        }

        feat = {
            "type": "Feature",
            "id": f"meter_{meter_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_parking_meters.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_parking_meters.geojson", features)
        sync_facility_to_db("parking_meters", features)
        print(f"✅ 路邊停車收費錶更新完成，共 {len(features)} 處收費錶。")
    return features

if __name__ == "__main__":
    update_parking_meters()
