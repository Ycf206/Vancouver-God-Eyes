import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_public_art():
    print("🎨 正在更新溫哥華公共藝術展品 (Public Art Registry)...")
    records = fetch_all_records("public-art")
    features = []

    for r in records:
        if r.get("status") != "In place":
            continue

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

        reg_id = r.get("registryid") or r.get("id")
        name = r.get("sitename") or r.get("title_of_work") or "公共藝術"
        feat = {
            "type": "Feature",
            "id": f"art_{reg_id}",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": f"art_{reg_id}",
                "facility_type": "public_art",
                "name": name,
                "registryid": reg_id,
                "sitename": r.get("sitename"),
                "siteaddress": r.get("siteaddress"),
                "title_of_work": r.get("title_of_work"),
                "type": r.get("type"),
                "status": r.get("status"),
                "primarymaterial": r.get("primarymaterial"),
                "ownership": r.get("ownership"),
                "locationonsite": r.get("locationonsite"),
                "artistprojectstatement": r.get("artistprojectstatement"),
                "descriptionofwork": r.get("descriptionofwork"),
                "url": r.get("url"),
                "photourl": r.get("photourl"),
                "yearofinstallation": r.get("yearofinstallation"),
                "local_area": r.get("geo_local_area") or r.get("local_area") or "",
                "photocredits": r.get("photocredits")
            }
        }
        features.append(feat)

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_public_art.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_public_art.geojson", features)
        sync_facility_to_db("public_art", features)
        print(f"✅ 公共藝術圖資更新完成，共 {len(features)} 件作品。")
    return features

if __name__ == "__main__":
    update_public_art()
