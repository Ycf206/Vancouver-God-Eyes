import os
import sys
import requests
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

def update_impark_parking():
    print("🅿️ 正在更新 ImPark 私營停車場情報...")
    url = "https://lots.impark.com/api/lots/IMP/en?latLoc=49.25143536989855&lngLoc=-123.21715982244642&latMin=49.185169174402894&lngMin=-123.40358407781751&latMax=49.31761273382262&lngMax=-123.03073556707533&csr=0&branchName="
    features = []
    try:
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        if resp.status_code == 200:
            lots = resp.json()
            for lot in lots:
                addr = lot.get("address") or {}
                city = (addr.get("city") or "").strip().lower()
                if city != "vancouver":
                    continue

                loc = lot.get("location") or {}
                lat = float(loc.get("lat") or 0)
                lng = float(loc.get("lng") or 0)
                if lat == 0 or lng == 0:
                    continue

                feat_list = []
                for f in (lot.get("features") or []):
                    if isinstance(f, dict) and f.get("value"):
                        feat_list.append(f.get("value"))
                    elif isinstance(f, str) and f:
                        feat_list.append(f)

                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lng, 6), round(lat, 6)]
                    },
                    "properties": {
                        "id": f"impark_{lot.get('lotId') or lot.get('lotNumber')}",
                        "facility_type": "impark",
                        "lot_id": lot.get("lotId"),
                        "lot_number": lot.get("lotNumber"),
                        "lot_name": lot.get("lotName") or f"Lot {lot.get('lotNumber')}",
                        "address1": addr.get("address1") or "",
                        "address2": addr.get("address2") or "",
                        "city": addr.get("city") or "Vancouver",
                        "postal_code": addr.get("postalCode") or "",
                        "hasTransientRates": bool(lot.get("hasTransientRates")),
                        "lowestTransientRate": lot.get("lowestTransientRate"),
                        "hasMonthlyRates": bool(lot.get("hasMonthlyRates")),
                        "lowestMonthlyRate": lot.get("lowestMonthlyRate"),
                        "capacity": lot.get("capacity"),
                        "features": feat_list,
                        "rates": lot.get("rates") or [],
                        "street_view_url": lot.get("streetViewUrl") or "",
                        "directions_url": lot.get("directionsUrl") or ""
                    }
                })
    except Exception as e:
        print(f"⚠️ 線上更新 ImPark 停車場失敗: {e}")

    if not features:
        print("ℹ️ 使用現有快取資料備份...")
        existing = load_existing_geojson("vancouver_impark.geojson")
        if existing and "features" in existing:
            features = existing["features"]

    if features:
        save_layer_geojson("vancouver_impark.geojson", features)
        print(f"✅ ImPark 停車場更新完成，共 {len(features)} 處場站。")
    return features

if __name__ == "__main__":
    update_impark_parking()
