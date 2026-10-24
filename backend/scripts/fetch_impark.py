import urllib.request
import json
import os

url = "https://lots.impark.com/api/lots/IMP/en?latLoc=49.25143536989855&lngLoc=-123.21715982244642&latMin=49.185169174402894&lngMin=-123.40358407781751&latMax=49.31761273382262&lngMax=-123.03073556707533&csr=0&branchName="

req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode("utf-8"))

print(f"Total returned: {len(data)}")

vancouver_lots = []
for lot in data:
    addr = lot.get("address") or {}
    city = (addr.get("city") or "").strip().lower()
    if city == "vancouver":
        vancouver_lots.append(lot)

print(f"Filtered Vancouver lots: {len(vancouver_lots)}")

features = []
for lot in vancouver_lots:
    loc = lot.get("location") or {}
    lat = float(loc.get("lat") or 0)
    lng = float(loc.get("lng") or 0)
    if lat == 0 or lng == 0:
        continue
    
    addr = lot.get("address") or {}
    feat_list = []
    for f in (lot.get("features") or []):
        if isinstance(f, dict):
            val = f.get("value")
            if val:
                feat_list.append(val)
        elif isinstance(f, str) and f:
            feat_list.append(f)

    # Street view URL: user specified streetViewUrl from API
    street_view = lot.get("streetViewUrl") or ""

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
            "hasPromotions": bool(lot.get("hasPromotions")),
            "promotions": lot.get("promotions"),
            "features": feat_list,
            "streetViewUrl": street_view,
            "url": f"https://lots.impark.com/imp/en?lot={lot.get('lotNumber') or lot.get('lotId')}"
        }
    })

geojson_data = {
    "type": "FeatureCollection",
    "features": features
}

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_path = os.path.join(base_dir, "..", "frontend", "public", "vancouver_impark.geojson")
frontend_path = os.path.abspath(frontend_path)
backend_path = os.path.join(base_dir, "data", "vancouver_impark.geojson")

with open(frontend_path, "w", encoding="utf-8") as f:
    json.dump(geojson_data, f, ensure_ascii=False, indent=2)

with open(backend_path, "w", encoding="utf-8") as f:
    json.dump(geojson_data, f, ensure_ascii=False, indent=2)

print(f"Successfully generated {len(features)} ImPark features to {frontend_path} and {backend_path}!")
