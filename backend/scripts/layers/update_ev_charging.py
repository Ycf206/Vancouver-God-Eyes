import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_ev_charging():
    print("🔋 正在更新電動車充電站點 (EV Charging Stations)...")
    records = fetch_all_records("electric-vehicle-charging-stations")
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

        obj_id = r.get("map_id") or r.get("object_id") or idx
        name = r.get("location") or r.get("address") or f"充電站 #{obj_id}"
        props = {
            "id": f"ev_{obj_id}",
            "facility_type": "ev_charging",
            "name": name,
            "address": r.get("address") or name,
            "local_area": r.get("geo_local_area") or r.get("local_area") or "",
            "location": r.get("location") or "",
            "lot_type": r.get("lot_type") or "",
            "operator": r.get("operator") or "",
            "connectors": r.get("connectors") or "",
            "ports": r.get("ports") or 2,
            "cost": r.get("cost") or "",
            "status": "Active",
            "lat": float(lat),
            "lon": float(lon)
        }

        feat = {
            "type": "Feature",
            "id": f"ev_{obj_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": props
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_ev_charging.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_ev_charging.geojson", features)
        sync_facility_to_db("ev_charging", features)
        print(f"✅ 電動車充電站更新完成，共 {len(features)} 處站點。")
    return features

if __name__ == "__main__":
    update_ev_charging()
