import os
import sys
import json
import tempfile
import requests
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

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(CURRENT_DIR)
BACKEND_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, 'data')
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, 'frontend', 'public')

os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
if os.path.exists(os.path.join(PROJECT_ROOT, 'frontend')):
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"
}

def fetch_all_records(dataset_id, timeout=25):
    """Fetches all records from Vancouver Open Data API with pagination."""
    base_url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/records"
    limit = 100
    offset = 0
    all_records = []
    
    print(f"📡 正在拉取溫哥華開放資料集 [{dataset_id}]...")
    while True:
        url = f"{base_url}?limit={limit}&offset={offset}&lang=en"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout)
            if resp.status_code != 200:
                print(f"  ❌ 抓取失敗 (offset {offset}): HTTP {resp.status_code}")
                break
            data = resp.json()
            results = data.get("results", [])
            if not results:
                break
            all_records.extend(results)
            total = data.get("total_count", len(all_records))
            print(f"  -> 已抓取 {len(all_records)} / {total} 筆記錄...")
            if len(all_records) >= total:
                break
            offset += limit
        except Exception as e:
            print(f"  ❌ 抓取發生例外異常: {e}")
            break
            
    print(f"✅ [{dataset_id}] 抓取完成，共 {len(all_records)} 筆記錄")
    return all_records

def fetch_geojson_export(dataset_id, timeout=90):
    """Directly downloads entire GeoJSON export from Vancouver Open Data API."""
    url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/exports/geojson"
    print(f"📡 正在下載完整 GeoJSON 匯出檔 [{dataset_id}]...")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            features = data.get("features", [])
            print(f"✅ [{dataset_id}] 匯出檔下載成功，包含 {len(features)} 個圖徵")
            return data
        else:
            print(f"  ❌ 下載失敗: HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"  ❌ 下載例外異常: {e}")
        return None

FILENAME_TO_SOURCE_ID = {
    "vancouver_beach_water.geojson": "beach_water",
    "vancouver_impark.geojson": "impark_parking",
    "vancouver_schools.geojson": "schools",
    "vancouver_libraries.geojson": "libraries",
    "vancouver_parks.geojson": "parks",
    "vancouver_community_centres.geojson": "community_centres",
    "vancouver_public_art.geojson": "public_art",
    "vancouver_museums.geojson": "museums",
    "vancouver_garbage_collection.geojson": "garbage_collection",
    "vancouver_recycling.geojson": "recycling",
    "vancouver_homeless_shelters.geojson": "homeless_shelters",
    "vancouver_food_banks.geojson": "food_banks",
    "vancouver_food_vendors.geojson": "food_vendors",
    "vancouver_aed.geojson": "aed",
    "vancouver_zoning_districts.geojson": "zoning_districts",
    "vancouver_parking_meters.geojson": "parking_meters",
    "vancouver_motorcycle_parking.geojson": "motorcycle_parking",
    "vancouver_bikeways.geojson": "bikeways",
    "vancouver_public_trees.geojson": "public_trees",
    "vancouver_fire_hydrants.geojson": "fire_hydrants",
    "vancouver_drinking_fountains.geojson": "drinking_fountains",
    "vancouver_public_washrooms.geojson": "public_washrooms",
    "vancouver_street_lighting.geojson": "street_lighting",
    "vancouver_street_lighting_poles.geojson": "street_lighting",
    "vancouver_street_lighting_conduits.geojson": "street_lighting_conduits",
    "vancouver_water_distribution_mains.geojson": "water_distribution_mains",
    "vancouver_sewer_mains.geojson": "sewer_mains",
    "vancouver_traffic_speed_limits.geojson": "traffic_speed_limits",
    "vancouver_traffic_crosswalks.geojson": "traffic_crosswalks",
    "vancouver_litter_containers.geojson": "litter_containers",
    "vancouver_one_way_streets.geojson": "one_way_streets",
    "vancouver_snow_removal_routes.geojson": "snow_removal_routes",
    "vancouver_contours.geojson": "contours",
    "vancouver_contours_10m.geojson": "contours",
    "vancouver_ev_charging.geojson": "ev_charging",
    "vancouver_canada_post.geojson": "canada_post",
    "vancouver_property_addresses_meta.json": "property_addresses",
    "vancouver_banks.geojson": "banks",
    "vancouver_shared_bikes.geojson": "shared_bikes",
    "vancouver_escooter.geojson": "escooter",
    "vancouver_truck_routes.geojson": "truck_routes",
    "vancouver_traffic_signals.geojson": "traffic_signals",
    "vancouver_traffic_turn_restrictions.geojson": "turn_restrictions",
    "vancouver_311.json": "service_requests_311",
    "tnt_eflyers.json": "tnt_eflyers",
    "vancouver_railways.geojson": "vancouver_railways",
    "vancouver_fedex.geojson": "fedex",
    "vancouver_purolator.geojson": "purolator",
    "vancouver_crashes.json": "vancouver_crashes",
}


def update_admin_source_metadata(source_id: str, record_count: int = None, updated_at: str = None):
    """原子更新本機 backend/data/admin_sources_config.json 中對應資料源的 last_updated 與 record_count。"""
    if not source_id:
        return
    cfg_path = os.path.join(BACKEND_DATA_DIR, "admin_sources_config.json")
    if not os.path.exists(cfg_path):
        return
    ts = updated_at or (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z")
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        changed = False
        for src in cfg.get("sources", []):
            if src.get("id") == source_id:
                src["last_updated"] = ts
                src["status"] = "healthy"
                if isinstance(record_count, int) and record_count > 0:
                    src["record_count"] = record_count
                changed = True
                break
        if changed:
            fd, tmp_path = tempfile.mkstemp(dir=BACKEND_DATA_DIR, prefix=".tmp_admin_cfg_", suffix=".json")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                os.replace(tmp_path, cfg_path)
            except Exception:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
    except Exception as e:
        print(f"  ⚠️ 無法同步更新 admin_sources_config.json [{source_id}]: {e}")


def save_layer_geojson(filename, data_or_features, is_feature_list=True):
    """Saves GeoJSON file to backend/data and frontend/public and syncs admin source metadata."""
    if not filename.endswith(".geojson"):
        filename = f"{filename}.geojson"
        
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    if is_feature_list:
        fc = {
            "type": "FeatureCollection",
            "generator": "VancouverGodsEye",
            "total_count": len(data_or_features),
            "updated_at": now_iso,
            "features": data_or_features
        }
    else:
        fc = data_or_features
        if isinstance(fc, dict):
            fc["updated_at"] = now_iso
            if "total_count" not in fc and "features" in fc:
                fc["total_count"] = len(fc["features"])

    backend_path = os.path.join(BACKEND_DATA_DIR, filename)
    with open(backend_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=2)

    if os.path.exists(FRONTEND_DATA_DIR):
        frontend_path = os.path.join(FRONTEND_DATA_DIR, filename)
        with open(frontend_path, "w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, indent=2)

    feat_count = len(fc.get("features", [])) if isinstance(fc, dict) else len(data_or_features)
    source_id = FILENAME_TO_SOURCE_ID.get(filename)
    if source_id:
        update_admin_source_metadata(source_id, record_count=feat_count, updated_at=now_iso)
    print(f"💾 已儲存 {filename} (共 {feat_count} 個圖徵，時間: {now_iso})")
    return backend_path

def load_existing_geojson(filename):
    """Loads existing GeoJSON file from backend/data or frontend/public."""
    if not filename.endswith(".geojson"):
        filename = f"{filename}.geojson"
    for d in [BACKEND_DATA_DIR, FRONTEND_DATA_DIR]:
        p = os.path.join(d, filename)
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return None

def sync_facility_to_db(facility_type, features):
    """Optional helper to sync road facilities into database if database module is loaded."""
    try:
        sys.path.append(BACKEND_DIR)
        import database
        import models
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
            print(f"🗄️ 已同步至資料庫 road_facilities [{facility_type}]")
        finally:
            db.close()
    except Exception:
        pass
