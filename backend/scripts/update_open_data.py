import sys
import os
import requests
import json
import math
from datetime import datetime, timezone

# Ensure stdout handles UTF-8 on Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Set up paths
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

sys.path.append(BACKEND_DIR)

try:
    import database
    import models
    HAS_DB = True
except Exception as e:
    print(f"Notice: Database module not loaded ({e}), running in file-only mode.")
    HAS_DB = False

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, 'data')
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, 'frontend', 'public')

os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
if os.path.exists(os.path.join(PROJECT_ROOT, 'frontend')):
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

HEADERS = {"User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"}

def fetch_all_records(dataset_id):
    """Fetches all records from Vancouver Open Data API with pagination."""
    base_url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/records"
    limit = 100
    offset = 0
    all_records = []
    
    print(f"📡 Fetching dataset [{dataset_id}]...")
    while True:
        url = f"{base_url}?limit={limit}&offset={offset}&lang=en"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                print(f"  ❌ Error fetching {dataset_id} at offset {offset}: status {resp.status_code}")
                break
            data = resp.json()
            results = data.get("results", [])
            if not results:
                break
            all_records.extend(results)
            total = data.get("total_count", len(all_records))
            print(f"  -> Got {len(all_records)} / {total} records...")
            if len(all_records) >= total:
                break
            offset += limit
        except Exception as e:
            print(f"  ❌ Exception fetching {dataset_id}: {e}")
            break
            
    print(f"✅ Total fetched for [{dataset_id}]: {len(all_records)}")
    return all_records

def save_geojson(name, features):
    """Saves GeoJSON to both backend/data and frontend/public."""
    fc = {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat() + "Z",
        "features": features
    }
    b_path = os.path.join(BACKEND_DATA_DIR, f"{name}.geojson")
    with open(b_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=2)
    
    if os.path.exists(FRONTEND_DATA_DIR):
        f_path = os.path.join(FRONTEND_DATA_DIR, f"{name}.geojson")
        with open(f_path, "w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, indent=2)
            
    print(f"💾 Saved {name}.geojson ({len(features)} features)")

def sync_to_db(facility_type, features):
    """Optionally syncs features into PostgreSQL road_facilities table."""
    if not HAS_DB:
        return
    try:
        models.Base.metadata.create_all(bind=database.engine)
        db = database.SessionLocal()
        try:
            db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).delete()
            for feat in features:
                props = feat.get("properties", {})
                coords = feat.get("geometry", {}).get("coordinates", [])
                if len(coords) < 2:
                    continue
                lon, lat = coords[0], coords[1]
                fac = models.RoadFacility(
                    id=str(feat.get("id") or props.get("id")),
                    facility_type=facility_type,
                    name=props.get("name", "Unknown"),
                    local_area=props.get("local_area") or "",
                    lat=lat,
                    lon=lon,
                    geom=f"SRID=4326;POINT({lon} {lat})",
                    details={k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")},
                    last_updated=datetime.now(timezone.utc)
                )
                db.add(fac)
            db.commit()
            print(f"🗄️ Database synced for [{facility_type}] ({len(features)} records)")
        finally:
            db.close()
    except Exception as e:
        print(f"⚠️ DB sync skipped or failed for [{facility_type}]: {e}")

# ----------------- Processors for Each Dataset -----------------

def update_parks():
    records = fetch_all_records("parks")
    features = []
    park_coords_map = {}
    
    for r in records:
        pid = r.get("parkid")
        name = r.get("name", "公園")
        gmap = r.get("googlemapdest") or {}
        lat = gmap.get("lat")
        lon = gmap.get("lon")
        
        if lat is None or lon is None:
            geo_p = r.get("geo_point_2d") or {}
            lat = geo_p.get("lat")
            lon = geo_p.get("lon")
            
        if lat is None or lon is None:
            continue
            
        park_coords_map[pid] = (lon, lat, name)
        features.append({
            "type": "Feature",
            "id": f"park_{pid}",
            "properties": {
                "id": f"park_{pid}",
                "facility_type": "parks",
                "name": name,
                "parkid": pid,
                "street_address": r.get("streetnumber", "") + " " + r.get("streetname", ""),
                "intersection": r.get("intersection", ""),
                "neighbourhood": r.get("neighbourhood", ""),
                "hectare": r.get("hectare"),
                "facilities": "有" if r.get("facilities") == "Y" else "無",
                "washrooms": "有" if r.get("washrooms") == "Y" else "無",
                "advisories": r.get("advisories", "N"),
                "specialfeatures": r.get("specialfeatures", "N"),
                "local_area": r.get("neighbourhood") or "Vancouver"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_parks", features)
    sync_to_db("parks", features)
    return park_coords_map

def update_parks_facilities(park_coords_map):
    records = fetch_all_records("parks-facilities")
    features = []
    park_fac_count = {}
    
    for idx, r in enumerate(records):
        pid = r.get("parkid")
        fac_type = r.get("facilitytype", "休閒設施")
        fac_count = r.get("facilitycount", 1)
        url = r.get("facilityurl", "")
        
        if pid not in park_coords_map:
            continue
            
        base_lon, base_lat, park_name = park_coords_map[pid]
        current_fac_idx = park_fac_count.get(pid, 0)
        park_fac_count[pid] = current_fac_idx + 1
        
        # Radially offset around park centroid
        angle = (current_fac_idx * 137.5) * (math.pi / 180.0)
        dist_m = 30.0 + (current_fac_idx * 5.0)
        d_lat = (dist_m * math.cos(angle)) / 111320.0
        d_lon = (dist_m * math.sin(angle)) / (111320.0 * math.cos(math.radians(base_lat)))
        
        feat_lon = round(base_lon + d_lon, 6)
        feat_lat = round(base_lat + d_lat, 6)
        
        features.append({
            "type": "Feature",
            "id": f"pf_{pid}_{current_fac_idx}",
            "properties": {
                "id": f"pf_{pid}_{current_fac_idx}",
                "facility_type": "parks_facilities",
                "name": f"{park_name} - {fac_type}",
                "park_name": park_name,
                "parkid": pid,
                "facility_type_name": fac_type,
                "facility_count": fac_count,
                "facility_url": url,
                "local_area": "Vancouver"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [feat_lon, feat_lat]
            }
        })
    save_geojson("vancouver_parks_facilities", features)
    sync_to_db("parks_facilities", features)

def update_community_gardens():
    records = fetch_all_records("community-gardens-and-food-trees")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        mapid = r.get("mapid", f"G{idx+1}")
        features.append({
            "type": "Feature",
            "id": f"garden_{mapid}",
            "properties": {
                "id": f"garden_{mapid}",
                "facility_type": "community_gardens",
                "name": r.get("name", "社區花園"),
                "mapid": mapid,
                "year_created": r.get("year_created", ""),
                "address": r.get("public_e_address", ""),
                "plots": r.get("number_of_plots", 0),
                "food_trees": r.get("number_of_food_trees", 0),
                "managing_org": r.get("steward_or_managing_organization", ""),
                "website": r.get("jurisdiction_url", ""),
                "food_tree_varieties": r.get("food_tree_varieties", ""),
                "notes": r.get("other_food_activities", ""),
                "local_area": r.get("geo_local_area") or "Vancouver"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_community_gardens", features)
    sync_to_db("community_gardens", features)

def update_drinking_fountains():
    records = fetch_all_records("drinking-fountains")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        mapid = r.get("mapid", f"DF{idx+1}")
        park_or_site = r.get("park_or_site", "公共飲水器")
        in_op = "全年開放" if r.get("in_operation") == "Y" else "春季至秋季開放"
        pet = "附寵物友善水盆 🐾" if r.get("pet_friendly") == "Y" else "一般飲水"
        features.append({
            "type": "Feature",
            "id": f"fountain_{mapid}",
            "properties": {
                "id": f"fountain_{mapid}",
                "facility_type": "drinking_fountains",
                "name": f"{park_or_site} 飲水機",
                "park_or_site": park_or_site,
                "mapid": mapid,
                "location": r.get("location", ""),
                "maintainer": r.get("maintainer", "Parks"),
                "in_operation": in_op,
                "pet_friendly": pet,
                "local_area": r.get("geo_local_area") or "Vancouver"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_drinking_fountains", features)
    sync_to_db("drinking_fountains", features)

def update_public_washrooms():
    records = fetch_all_records("public-washrooms")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        name = r.get("name") or (r.get("park_name") + " 公園公廁" if r.get("park_name") else f"{r.get('location', '')} 公廁")
        w_type = r.get("type", "公共廁所")
        if "Automated" in w_type:
            w_type_zh = "自動公廁 (Automated)"
        elif "Park" in w_type:
            w_type_zh = "公園洗手間"
        else:
            w_type_zh = w_type
            
        features.append({
            "type": "Feature",
            "id": f"washroom_{idx+1}",
            "properties": {
                "id": f"washroom_{idx+1}",
                "facility_type": "public_washrooms",
                "name": name,
                "park_name": r.get("park_name", ""),
                "location": r.get("location", ""),
                "washroom_type": w_type_zh,
                "summer_hours": r.get("summer_hours", "未載明"),
                "winter_hours": r.get("winter_hours", "未載明"),
                "wheelchair_access": "無障礙友善 ♿" if r.get("wheelchair_access") == "Yes" else "一般規格",
                "notes": r.get("notes", ""),
                "local_area": r.get("geo_local_area") or "Vancouver"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_public_washrooms", features)
    sync_to_db("public_washrooms", features)

def update_schools():
    records = fetch_all_records("schools")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        name = r.get("school_name") or "學校"
        cat = r.get("school_category") or "學校"
        cat_zh = "公立學校" if "Public" in cat else ("私立/獨立學校" if "Independent" in cat else cat)
        features.append({
            "type": "Feature",
            "id": f"school_{idx+1}",
            "properties": {
                "id": f"school_{idx+1}",
                "facility_type": "schools",
                "name": name,
                "school_category": cat,
                "school_category_zh": cat_zh,
                "address": r.get("address") or "",
                "local_area": r.get("geo_local_area") or "溫哥華市"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_schools", features)
    sync_to_db("schools", features)

def update_libraries():
    records = fetch_all_records("libraries")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        name = r.get("name") or "溫哥華市立圖書館"
        if not name.endswith("Library") and not "圖書館" in name:
            disp_name = f"{name} 分館 (VPL)"
        else:
            disp_name = name
        features.append({
            "type": "Feature",
            "id": f"lib_{idx+1}",
            "properties": {
                "id": f"lib_{idx+1}",
                "facility_type": "libraries",
                "name": disp_name,
                "branch_name": r.get("name") or "",
                "address": r.get("address") or "",
                "urllink": r.get("urllink") or "https://www.vpl.ca",
                "local_area": r.get("geo_local_area") or "溫哥華市"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_libraries", features)
    sync_to_db("libraries", features)

def update_food_vendors():
    records = fetch_all_records("food-vendors")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        desc = r.get("description") or "特色餐飲食品"
        bname = r.get("business_name")
        name = f"{bname} ({desc})" if bname else desc
        key = r.get("key") or f"FV{idx+1}"
        features.append({
            "type": "Feature",
            "id": f"food_{key}",
            "properties": {
                "id": f"food_{key}",
                "facility_type": "food_vendors",
                "name": name,
                "vendor_code": key,
                "description": desc,
                "business_name": bname or "餐車攤商",
                "status": "營運中" if r.get("status") == "open" else (r.get("status") or "未知"),
                "location_desc": r.get("location") or "",
                "local_area": r.get("geo_localarea") or "溫哥華市"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_food_vendors", features)
    sync_to_db("food_vendors", features)

def update_homeless_shelters():
    records = fetch_all_records("homeless-shelter-locations")
    features = []
    for idx, r in enumerate(records):
        gp = r.get("geo_point_2d") or {}
        lon = gp.get("lon")
        lat = gp.get("lat")
        if lon is None or lat is None:
            continue
        name = r.get("facility") or "緊急庇護所"
        meals = "有提供熱食 🍲" if (r.get("meals") or "").lower() == "yes" else "無供餐"
        pets = "允許攜帶寵物 🐾" if (r.get("pets") or "").lower() == "yes" else "不可攜帶寵物"
        carts = "可停放推車 🛒" if (r.get("carts") or "").lower() == "yes" else "不可推車"
        features.append({
            "type": "Feature",
            "id": f"shelter_{idx+1}",
            "properties": {
                "id": f"shelter_{idx+1}",
                "facility_type": "homeless_shelters",
                "name": name,
                "category": r.get("category") or "通用受助對象",
                "phone": r.get("phone") or "",
                "meals": meals,
                "pets": pets,
                "carts": carts,
                "local_area": r.get("geo_local_area") or "溫哥華市"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
    save_geojson("vancouver_homeless_shelters", features)
    sync_to_db("homeless_shelters", features)

def _round_coords(coords):
    """Recursively round GeoJSON LineString / MultiLineString coordinates to 5 decimal places."""
    if not isinstance(coords, list):
        return coords
    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        return [round(float(coords[0]), 5), round(float(coords[1]), 5)]
    return [_round_coords(c) for c in coords]

def update_bikeways():
    """Fetches Vancouver bikeways LineString dataset from Vancouver Open Data v2.1 API."""
    records = fetch_all_records("bikeways")
    features = []

    type_map_zh = {
        "Protected Bike Lanes": "實體分隔單車道 (Protected)",
        "Painted Lanes": "標線專用單車道 (Painted)",
        "Local Street": "街區單車綠道 (Local Street)",
        "Shared Lanes": "共享車道 (Shared)"
    }
    dir_map_zh = {
        "2W": "雙向通行 (Two-Way)",
        "1W": "單向通行 (One-Way)"
    }
    surf_map_zh = {
        "Paved": "柏油鋪面 (Paved)",
        "Unpaved": "非鋪面/碎石 (Unpaved)",
        "Concrete": "混凝土鋪面 (Concrete)"
    }

    for idx, r in enumerate(records):
        status = r.get("status") or "Active"
        if status == "Temporarily Removed":
            continue

        geom_wrapper = r.get("geom") or {}
        geom = geom_wrapper.get("geometry") if isinstance(geom_wrapper, dict) else None
        if not geom or geom.get("type") not in ("LineString", "MultiLineString"):
            continue

        raw_coords = geom.get("coordinates")
        if not raw_coords:
            continue

        gp = r.get("geo_point_2d") or {}
        center_lon = gp.get("lon")
        center_lat = gp.get("lat")

        obj_id = r.get("object_id") or str(idx + 1)
        route_name = (r.get("bike_route_name") or "").strip()
        street_name = (r.get("street_name") or "").strip()
        if route_name and street_name and route_name.lower() not in street_name.lower():
            disp_name = f"{route_name} 單車徑 ({street_name})"
        elif route_name:
            disp_name = f"{route_name} 單車徑"
        elif street_name:
            disp_name = f"{street_name} 單車道"
        else:
            disp_name = f"溫哥華單車專用道 #{obj_id}"

        b_type = r.get("bikeway_type") or "Local Street"
        b_type_zh = type_map_zh.get(b_type, b_type)
        b_dir = r.get("bikeway_direction") or "2W"
        b_dir_zh = dir_map_zh.get(b_dir, b_dir)
        surf = r.get("surface_type") or "Paved"
        surf_zh = surf_map_zh.get(surf, surf)
        aaa = "全齡友善安全路網 (AAA)" if (r.get("aaa_network") or "").upper() == "YES" else "一般單車路網"
        snow = "優先除雪路線 ❄️" if (r.get("snow_removal") or "").lower() == "yes" else "一般維護"

        features.append({
            "type": "Feature",
            "id": f"bikeway_{obj_id}",
            "properties": {
                "id": f"bikeway_{obj_id}",
                "facility_type": "bikeways",
                "name": disp_name,
                "bike_route_name": route_name or "市區單車網",
                "street_name": street_name or "",
                "bikeway_type": b_type,
                "bikeway_type_zh": b_type_zh,
                "bikeway_direction": b_dir_zh,
                "surface_type": surf_zh,
                "speed_limit": r.get("speed_limit") or "",
                "aaa_network": aaa,
                "snow_removal": snow,
                "year_of_construction": r.get("year_of_construction") or "",
                "upgrade_year": r.get("upgrade_year") or "",
                "center_lon": round(float(center_lon), 5) if center_lon is not None else None,
                "center_lat": round(float(center_lat), 5) if center_lat is not None else None,
                "local_area": "溫哥華市"
            },
            "geometry": {
                "type": geom["type"],
                "coordinates": _round_coords(raw_coords)
            }
        })

    save_geojson("vancouver_bikeways", features)

def run_all_updates():
    start_time = datetime.now(timezone.utc)
    print("=" * 60)
    print("🚀 Starting Semi-Annual Open Data Update (6-Month Cycle)")
    print(f"⏰ Start Time: {start_time.isoformat()}Z")
    print("=" * 60)
    
    # 1. Parks
    park_map = update_parks()
    
    # 2. Parks Facilities
    update_parks_facilities(park_map)
    
    # 3. Community Gardens
    update_community_gardens()
    
    # 4. Drinking Fountains
    update_drinking_fountains()
    
    # 5. Public Washrooms
    update_public_washrooms()
    
    # 6. Schools
    update_schools()
    
    # 7. Libraries
    update_libraries()
    
    # 8. Food Vendors
    update_food_vendors()
    
    # 9. Homeless Shelters
    update_homeless_shelters()

    # 10. Bikeways (LineString)
    update_bikeways()
    
    # Record metadata
    meta_path = os.path.join(BACKEND_DATA_DIR, "last_open_data_update.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
            "cycle_months": 6,
            "datasets": [
                "parks", "parks_facilities", "community_gardens", 
                "drinking_fountains", "public_washrooms",
                "schools", "libraries", "food_vendors", "homeless_shelters",
                "bikeways"
            ]
        }, f, indent=2)
        
    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    print("=" * 60)
    print(f"🎉 All 10 datasets successfully refreshed in {duration:.1f}s!")
    print("=" * 60)

if __name__ == "__main__":
    run_all_updates()
