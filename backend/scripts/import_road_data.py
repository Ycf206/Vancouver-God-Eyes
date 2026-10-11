import sys
import os
import requests
import json
from datetime import datetime

# Add parent dir to path to import models and database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database
import models

DATASETS = [
    {
        "facility_type": "parking_meters",
        "dataset_id": "parking-meters",
        "name_field": lambda r: f"收費錶 #{r.get('meter_id', '')}".strip(),
        "id_func": lambda r, idx: f"meter_{r.get('meter_id') or r.get('object_id') or idx}"
    },
    {
        "facility_type": "accessible_parking",
        "dataset_id": "disability-parking",
        "name_field": lambda r: r.get('location') or r.get('street_name') or "無障礙停車位",
        "id_func": lambda r, idx: f"acc_{r.get('object_id') or idx}"
    },
    {
        "facility_type": "motorcycle_parking",
        "dataset_id": "motorcycle-parking",
        "name_field": lambda r: f"{r.get('block', '')} {r.get('street', '')}".strip() or "摩托車停車位",
        "id_func": lambda r, idx: f"moto_{r.get('object_id') or r.get('meter_id') or idx}"
    },
    {
        "facility_type": "ev_charging",
        "dataset_id": "electric-vehicle-charging-stations",
        "name_field": lambda r: r.get('location') or r.get('address') or "電動車充電站",
        "id_func": lambda r, idx: f"ev_{r.get('map_id') or r.get('object_id') or idx}"
    }
]

def fetch_dataset_records(dataset_id):
    """Fetches all records from Open Data Vancouver v2.1 API with pagination"""
    base_url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/records"
    limit = 100
    offset = 0
    all_records = []
    
    headers = {"User-Agent": "VancouverGodsEye/1.0"}
    
    while True:
        url = f"{base_url}?limit={limit}&offset={offset}&lang=en"
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code != 200:
                print(f"  ❌ Error fetching {dataset_id} at offset {offset}: status {resp.status_code}")
                break
            
            data = resp.json()
            total_count = data.get("total_count", 0)
            results = data.get("results", [])
            
            if not results:
                break
                
            all_records.extend(results)
            print(f"  Fetched {len(all_records)} / {total_count} records for {dataset_id}...")
            
            if len(all_records) >= total_count:
                break
                
            offset += limit
        except Exception as e:
            print(f"  ❌ Exception fetching {dataset_id}: {e}")
            break
            
    return all_records

def import_road_facilities():
    print("=" * 60)
    print("🚦 Starting Municipal Road Facilities Data Import")
    print(f"📅 Timestamp: {datetime.utcnow().isoformat()}Z")
    print("=" * 60)
    
    # Ensure tables exist
    models.Base.metadata.create_all(bind=database.engine)
    db = database.SessionLocal()
    
    try:
        for conf in DATASETS:
            facility_type = conf["facility_type"]
            dataset_id = conf["dataset_id"]
            
            print(f"\n📥 Downloading [{facility_type}] from Open Data Vancouver ({dataset_id})...")
            records = fetch_dataset_records(dataset_id)
            print(f"  Total records fetched: {len(records)}")
            
            if not records:
                print(f"  ⚠️ Skipping {facility_type} (no records).")
                continue
                
            # Clear old records for this facility type
            deleted = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).delete()
            print(f"  Cleared {deleted} existing records for {facility_type}.")
            
            objects_to_add = []
            seen_ids = set()
            
            for idx, r in enumerate(records):
                # Extract lat/lon
                geo_point = r.get("geo_point_2d") or {}
                lon = geo_point.get("lon")
                lat = geo_point.get("lat")
                
                if lon is None or lat is None:
                    # Fallback to geom
                    geom_data = r.get("geom", {})
                    if isinstance(geom_data, dict):
                        coords = geom_data.get("geometry", {}).get("coordinates", [])
                        if len(coords) >= 2:
                            lon, lat = coords[0], coords[1]
                            
                if lon is None or lat is None:
                    continue
                    
                obj_id = conf["id_func"](r, idx)
                if obj_id in seen_ids:
                    obj_id = f"{obj_id}_{idx}"
                seen_ids.add(obj_id)
                
                name = conf["name_field"](r)
                local_area = r.get("local_area") or r.get("geo_local_area") or ""
                
                # Clean details: remove large geom objects from json details to save space
                details = {k: v for k, v in r.items() if k not in ("geom", "geo_point_2d")}
                
                facility = models.RoadFacility(
                    id=obj_id,
                    facility_type=facility_type,
                    name=name,
                    local_area=local_area,
                    lat=lat,
                    lon=lon,
                    geom=f"SRID=4326;POINT({lon} {lat})",
                    details=details,
                    last_updated=datetime.utcnow()
                )
                objects_to_add.append(facility)
                
            db.bulk_save_objects(objects_to_add)
            db.commit()
            print(f"  ✅ Successfully imported {len(objects_to_add)} {facility_type} records.")
            
    except Exception as e:
        db.rollback()
        print(f"❌ Error during road facility import: {e}")
        raise e
    finally:
        db.close()
        
    print("\n🎉 Road facilities data import finished successfully!")

if __name__ == "__main__":
    import_road_facilities()
