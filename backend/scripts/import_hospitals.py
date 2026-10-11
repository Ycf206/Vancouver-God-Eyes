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

# 5 Major Emergency Hospitals in Vancouver Area
# Sourced from hospital.geojson and aligned with https://erstat.ca/hospitals/bc/vancouver
VANCOUVER_HOSPITALS = [
    {
        "id": "hosp_vgh",
        "name": "Vancouver General Hospital",
        "chinese_name": "溫哥華綜合醫院 (VGH)",
        "short_name": "VGH",
        "address": "899 W 12th Ave, Vancouver, BC V5Z 1M9",
        "local_area": "Fairview",
        "lat": 49.2614,
        "lon": -123.1230,
        "phone": "+1-604-875-4111",
        "operator": "Vancouver Coastal Health (VCH)",
        "emergency": "yes",
        "hours": "24/7 全天候急診 (Adult Level 1 Trauma)",
        "website": "https://www.vch.ca/en/location/vancouver-general-hospital",
        "erstat_name": "Vancouver General Hospital",
        "erstat_url": "https://erstat.ca/hospitals/bc/vancouver-general-hospital"
    },
    {
        "id": "hosp_sph",
        "name": "St. Paul's Hospital",
        "chinese_name": "聖保祿醫院 (SPH)",
        "short_name": "SPH",
        "address": "1081 Burrard St, Vancouver, BC V6Z 1Y6",
        "local_area": "Downtown",
        "lat": 49.2807,
        "lon": -123.1285,
        "phone": "+1-604-682-2344",
        "operator": "Providence Health Care",
        "emergency": "yes",
        "hours": "24/7 全天候急診",
        "website": "https://www.providencehealthcare.org/locations/st-pauls-hospital",
        "erstat_name": "St. Paul's Hospital",
        "erstat_url": "https://erstat.ca/hospitals/bc/st-pauls-hospital"
    },
    {
        "id": "hosp_msj",
        "name": "Mount Saint Joseph Hospital",
        "chinese_name": "聖若瑟醫院 (MSJ)",
        "short_name": "MSJ",
        "address": "3080 Prince Edward St, Vancouver, BC V5T 3N4",
        "local_area": "Mount Pleasant",
        "lat": 49.2580,
        "lon": -123.0950,
        "phone": "+1-604-874-1141",
        "operator": "Providence Health Care",
        "emergency": "yes",
        "hours": "08:00 - 20:00 (急診日間門診)",
        "website": "https://www.providencehealthcare.org/locations/mount-saint-joseph-hospital",
        "erstat_name": "Mount Saint Joseph Hospital",
        "erstat_url": "https://erstat.ca/hospitals/bc/providence-health-care-mount-saint-joseph-hospital"
    },
    {
        "id": "hosp_bcch",
        "name": "BC Children's Hospital",
        "chinese_name": "卑詩省兒童醫院 (BC Children's)",
        "short_name": "BCCH",
        "address": "4480 Oak St (Entrance 55), Vancouver, BC V6H 3V4",
        "local_area": "South Cambie",
        "lat": 49.2455,
        "lon": -123.1236,
        "phone": "+1-604-875-2345",
        "operator": "Provincial Health Services Authority (PHSA)",
        "emergency": "yes",
        "hours": "24/7 全天候兒科專門急診 (Paediatric Emergency)",
        "website": "http://www.bcchildrens.ca",
        "erstat_name": "BC Children's Hospital",
        "erstat_url": "https://erstat.ca/hospitals/bc/bc-childrens-hospital"
    },
    {
        "id": "hosp_ubc",
        "name": "UBC Hospital",
        "chinese_name": "卑詩大學醫院 (UBC Hospital)",
        "short_name": "UBCH",
        "address": "2211 Wesbrook Mall, Vancouver, BC V6T 2B5",
        "local_area": "University Endowment Lands",
        "lat": 49.2644,
        "lon": -123.2458,
        "phone": "+1-604-822-7121",
        "operator": "Vancouver Coastal Health (VCH)",
        "emergency": "yes",
        "hours": "08:00 - 20:00 (Urgent Care 急症醫療中心)",
        "website": "https://www.vch.ca/en/location/ubc-hospital",
        "erstat_name": "Ubc Hospital",
        "erstat_url": "https://erstat.ca/hospitals/bc/ubc-hospital"
    }
]

def import_hospitals(db=None):
    """Imports or updates Vancouver hospitals in RoadFacility DB"""
    should_close = False
    if db is None:
        models.Base.metadata.create_all(bind=database.engine)
        db = database.SessionLocal()
        should_close = True

    try:
        print("=" * 60)
        print("🏥 Starting Vancouver Hospitals Import")
        print(f"📅 Timestamp: {datetime.utcnow().isoformat()}Z")
        print("=" * 60)

        # Clear existing hospitals
        db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == "hospitals").delete()

        objects_to_add = []
        for hosp in VANCOUVER_HOSPITALS:
            details = {
                "name": hosp["name"],
                "chinese_name": hosp["chinese_name"],
                "short_name": hosp["short_name"],
                "address": hosp["address"],
                "phone": hosp["phone"],
                "operator": hosp["operator"],
                "emergency": hosp["emergency"],
                "hours": hosp["hours"],
                "website": hosp["website"],
                "erstat_name": hosp["erstat_name"],
                "erstat_url": hosp["erstat_url"],
                "source": "OpenStreetMap & erstat.ca"
            }

            facility = models.RoadFacility(
                id=hosp["id"],
                facility_type="hospitals",
                name=hosp["name"],
                local_area=hosp["local_area"],
                lat=hosp["lat"],
                lon=hosp["lon"],
                geom=f"SRID=4326;POINT({hosp['lon']} {hosp['lat']})",
                details=details,
                last_updated=datetime.utcnow()
            )
            objects_to_add.append(facility)
            db.add(facility)

        db.commit()
        print(f"✅ Successfully imported {len(objects_to_add)} Vancouver hospitals into database!")
        return objects_to_add

    except Exception as e:
        db.rollback()
        print(f"❌ Error importing hospitals: {e}")
        return []
    finally:
        if should_close:
            db.close()

if __name__ == "__main__":
    import_hospitals()
