import sys
import os
import json
from datetime import datetime

# Windows encoding safety
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database
import models

def import_shared_bikes(db=None):
    """
    Imports Vancouver Shared Bikes (Mobi by Rogers) stations into RoadFacility DB
    """
    should_close = False
    if db is None:
        models.Base.metadata.create_all(bind=database.engine)
        db = database.SessionLocal()
        should_close = True

    try:
        print("=" * 60)
        print("🚲 Starting Vancouver Shared Bikes (Mobi) Import")
        print(f"📅 Timestamp: {datetime.utcnow().isoformat()}Z")
        print("=" * 60)

        geojson_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "vancouver_shared_bikes.geojson")
        if not os.path.exists(geojson_path):
            print(f"❌ Error: {geojson_path} does not exist.")
            return []

        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        features = data.get("features", [])
        print(f"  Loaded {len(features)} stations from {geojson_path}...")

        objects_to_add = []
        for feat in features:
            props = feat.get("properties", {})
            coords = feat.get("geometry", {}).get("coordinates", [])
            if len(coords) < 2:
                continue

            lon, lat = coords[0], coords[1]
            obj_id = feat.get("id") or props.get("id")
            name = props.get("name") or "Mobi Bike Station"

            details = {k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")}

            facility = models.RoadFacility(
                id=str(obj_id),
                facility_type="shared_bikes",
                name=name,
                local_area=props.get("local_area") or "Vancouver",
                lat=lat,
                lon=lon,
                geom=f"SRID=4326;POINT({lon} {lat})",
                details=details,
                last_updated=datetime.utcnow()
            )
            objects_to_add.append(facility)

        db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == "shared_bikes").delete()
        for fac in objects_to_add:
            db.add(fac)
        db.commit()

        print(f"✅ Successfully imported {len(objects_to_add)} Vancouver shared bike stations into database!")
        return objects_to_add

    except Exception as e:
        db.rollback()
        print(f"❌ Error importing shared bikes: {e}")
        return []
    finally:
        if should_close:
            db.close()

if __name__ == "__main__":
    import_shared_bikes()
