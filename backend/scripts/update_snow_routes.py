import sys
import os
import requests
import json
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
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

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
            resp = requests.get(url, headers=HEADERS, timeout=25)
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

def _round_coords(coords):
    """Recursively round GeoJSON LineString / MultiLineString coordinates to 5 decimal places."""
    if not isinstance(coords, list):
        return coords
    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        return [round(float(coords[0]), 5), round(float(coords[1]), 5)]
    return [_round_coords(c) for c in coords]

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

def update_snow_removal_routes():
    """Fetches and transforms Vancouver Snow Removal Routes (每年更新1次)."""
    records = fetch_all_records("snow-removal-routes")
    features = []

    route_type_map_zh = {
        "Major Street Network": "主要幹道網絡 (Major Arterials)",
        "Priority Hills": "高優先陡坡路段 (Priority Hills)",
        "School & Care Facilities": "學校與安養機構周邊 (School & Care Facilities)",
        "Bridge Deck Sidewalks": "橋樑人行道 (Bridge Sidewalks)",
        "Bike Route": "優先單車路線 (Priority Bike Route)",
        "Pedestrian Pathway": "行人主要通道 (Pedestrian Pathway)"
    }

    priority_map_zh = {
        1: "第 1 優先路段 (主要幹道與緊急路網)",
        2: "第 2 優先路段 (陡坡/學校/單車道/人行道)"
    }

    for idx, r in enumerate(records):
        geom_wrapper = r.get("geom") or {}
        if isinstance(geom_wrapper, dict) and geom_wrapper.get("type") == "Feature":
            geom = geom_wrapper.get("geometry")
        else:
            geom = geom_wrapper if isinstance(geom_wrapper, dict) else None

        if not geom or geom.get("type") not in ("LineString", "MultiLineString"):
            continue

        raw_coords = geom.get("coordinates")
        if not raw_coords:
            continue

        obj_id = r.get("object_id") or (idx + 1)
        name = (r.get("name") or "").strip()
        route_type = (r.get("route_type") or "").strip()
        route_type_zh = route_type_map_zh.get(route_type, route_type or "冬季鏟雪路線")

        priority_val = r.get("priority")
        if priority_val is not None:
            try:
                priority_val = int(priority_val)
            except Exception:
                pass
        priority_zh = priority_map_zh.get(priority_val, "一般冬季除雪規劃路段")

        shape_len = r.get("shape_length")
        length_km = None
        length_str = ""
        if shape_len is not None:
            try:
                shape_len_float = float(shape_len)
                if shape_len_float >= 1000:
                    length_km = round(shape_len_float / 1000.0, 2)
                    length_str = f"{length_km} 公里"
                else:
                    length_str = f"{int(shape_len_float)} 公尺"
            except Exception:
                pass

        gp = r.get("geo_point_2d") or {}
        center_lon = gp.get("lon")
        center_lat = gp.get("lat")

        disp_name = name if name else f"{route_type_zh} #{obj_id}"
        feat_id = f"snow_{obj_id}"

        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "snow_removal_routes",
                "object_id": obj_id,
                "name": disp_name,
                "route_type": route_type,
                "route_type_zh": route_type_zh,
                "priority": priority_val,
                "priority_zh": priority_zh,
                "shape_length": shape_len,
                "length_display": length_str,
                "length_km": length_km,
                "geo_point_2d": {
                    "lon": round(float(center_lon), 5) if center_lon is not None else None,
                    "lat": round(float(center_lat), 5) if center_lat is not None else None
                }
            },
            "geometry": {
                "type": geom["type"],
                "coordinates": _round_coords(raw_coords)
            }
        })

    save_geojson("vancouver_snow_removal_routes", features)

    # Record metadata
    meta_path = os.path.join(BACKEND_DATA_DIR, "last_snow_routes_update.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "last_updated": datetime.now(timezone.utc).isoformat() + "Z",
            "cycle_years": 1,
            "dataset": "snow_removal_routes",
            "total_features": len(features)
        }, f, indent=2)

    return len(features)

def main():
    start_time = datetime.now(timezone.utc)
    print("=" * 60)
    print("❄️ Starting Annual Snow Removal Routes Update (1-Year Cycle)")
    print(f"⏰ Start Time: {start_time.isoformat()}Z")
    print("=" * 60)
    count = update_snow_removal_routes()
    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    print("=" * 60)
    print(f"🎉 Snow removal routes updated ({count} features) in {duration:.1f}s!")
    print("=" * 60)

if __name__ == "__main__":
    main()
