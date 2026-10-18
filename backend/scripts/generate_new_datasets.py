import os
import json
import requests
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FRONTEND_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "public")
os.makedirs(DATA_DIR, exist_ok=True)

def save_geojson_dual(filename, data, indent=None):
    b_path = os.path.join(DATA_DIR, filename)
    with open(b_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    if os.path.exists(FRONTEND_DATA_DIR):
        f_path = os.path.join(FRONTEND_DATA_DIR, filename)
        with open(f_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)

HEADERS = {
    "User-Agent": "VancouverGodsEye/1.0"
}

def fetch_all_records(dataset_id):
    base_url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/records"
    limit = 100
    offset = 0
    records = []
    while True:
        url = f"{base_url}?limit={limit}&offset={offset}&lang=en"
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code != 200:
                print(f"Error fetching {dataset_id} at {offset}: {r.status_code}")
                break
            data = r.json()
            results = data.get("results", [])
            if not results:
                break
            records.extend(results)
            total = data.get("total_count", 0)
            print(f"[{dataset_id}] {len(records)}/{total} fetched...")
            if len(records) >= total:
                break
            offset += limit
        except Exception as e:
            print(f"Exception fetching {dataset_id}: {e}")
            break
    return records

def generate_road_closures():
    print("Generating Road Closures (road-ahead-current-road-closures)...")
    records = fetch_all_records("road-ahead-current-road-closures")
    features = []
    for idx, r in enumerate(records):
        geom_field = r.get("geom", {})
        geometry = geom_field.get("geometry") if isinstance(geom_field, dict) else None
        pt = r.get("geo_point_2d") or {}
        if not geometry and pt.get("lon") and pt.get("lat"):
            geometry = {"type": "Point", "coordinates": [pt["lon"], pt["lat"]]}
        
        if not geometry:
            continue

        proj_name = r.get("project") or r.get("location") or r.get("street") or f"交通封閉項目 #{idx+1}"
        feat_id = f"closure_{idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "road_closures",
                "name": proj_name,
                "project": r.get("project") or "",
                "street": r.get("street") or "",
                "location": r.get("location") or "",
                "comp_date": r.get("comp_date") or "",
                "url_link": r.get("url_link") or "",
                "geo_point_2d": pt
            },
            "geometry": geometry
        })
    
    save_geojson_dual("vancouver_road_closures.geojson", {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每星期 1 次 (Weekly)",
        "features": features
    }, indent=2)
    print(f"[OK] Saved {len(features)} road closures to backend and frontend")

def generate_road_construction():
    print("Generating Road Construction (road-ahead-projects-under-construction)...")
    records = fetch_all_records("road-ahead-projects-under-construction")
    features = []
    for idx, r in enumerate(records):
        geom_field = r.get("geom", {})
        geometry = geom_field.get("geometry") if isinstance(geom_field, dict) else None
        pt = r.get("geo_point_2d") or {}
        if not geometry and pt.get("lon") and pt.get("lat"):
            geometry = {"type": "Point", "coordinates": [pt["lon"], pt["lat"]]}
        
        if not geometry:
            continue

        proj_name = r.get("project") or r.get("location") or r.get("street") or f"道路施工項目 #{idx+1}"
        feat_id = f"construction_{idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "road_construction",
                "name": proj_name,
                "project": r.get("project") or "",
                "street": r.get("street") or "",
                "location": r.get("location") or "",
                "comp_date": r.get("comp_date") or "",
                "url_link": r.get("url_link") or "",
                "geo_point_2d": pt
            },
            "geometry": geometry
        })
    
    save_geojson_dual("vancouver_road_construction.geojson", {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每星期 1 次 (Weekly)",
        "features": features
    }, indent=2)
    print(f"[OK] Saved {len(features)} road construction projects to backend and frontend")

def generate_street_lighting():
    generate_street_lighting_poles()
    generate_street_lighting_conduits()

def generate_street_lighting_poles():
    print("Generating Street Lighting Poles (street-lighting-poles)...")
    records = fetch_all_records("street-lighting-poles")
    features = []
    for idx, r in enumerate(records):
        geom_field = r.get("geom", {})
        geometry = geom_field.get("geometry") if isinstance(geom_field, dict) else None
        pt = r.get("geo_point_2d") or {}
        if not geometry:
            continue
        block = r.get("block_number") or ""
        node = r.get("node_number")
        area = r.get("geo_local_area") or ""
        feat_id = f"pole_{block or 'na'}_{node if node is not None else idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "street_lighting",
                "name": f"路燈燈柱 ({block} 號街區 #{node})" if block else f"路燈燈柱 #{idx+1}",
                "block_number": block,
                "node_number": node,
                "local_area": area,
                "geo_local_area": area,
                "geo_point_2d": pt,
                "update_frequency": "每3個月更新 1 次 (Quarterly)"
            },
            "geometry": geometry
        })
    save_geojson_dual("vancouver_street_lighting_poles.geojson", {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每3個月更新 1 次 (Quarterly)",
        "features": features
    })
    print(f"[OK] Saved {len(features)} street lighting poles to backend and frontend")

def generate_street_lighting_conduits():
    print("Generating Street Lighting Conduits (street-lighting-conduits)...")
    records = fetch_all_records("street-lighting-conduits")
    features = []
    for idx, r in enumerate(records):
        geom_field = r.get("geom", {})
        geometry = geom_field.get("geometry") if isinstance(geom_field, dict) else None
        pt = r.get("geo_point_2d") or {}
        
        if not geometry:
            continue

        wireset = r.get("wireset_type") or "標準"
        feat_id = f"conduit_{idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "street_lighting_conduits",
                "name": f"路燈地下配電管線 ({wireset})",
                "wireset_type": wireset,
                "geo_point_2d": pt,
                "update_frequency": "每3個月更新 1 次 (Quarterly)"
            },
            "geometry": geometry
        })
    
    save_geojson_dual("vancouver_street_lighting_conduits.geojson", {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每3個月更新 1 次 (Quarterly)",
        "features": features
    })
    print(f"[OK] Saved {len(features)} street lighting conduits to backend and frontend")

def generate_traffic_conditions():
    print("Generating Traffic Conditions GeoJSON (Lions Gate Bridge ATIS)...")
    features = [
        {
            "type": "Feature",
            "id": "bridge_traffic_lions_gate",
            "properties": {
                "id": "bridge_traffic_lions_gate",
                "facility_type": "traffic_conditions",
                "name": "獅門大橋 (Lions Gate Bridge) 即時路況",
                "bridge_name": "Lions Gate Bridge",
                "highway": "Hwy 99",
                "delay_gif": "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/atis_delay.gif",
                "camera_jpg": "https://www.drivebc.ca/images/18.jpg",
                "queue_map_gif": "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/queue_map.gif",
                "atis_url": "https://www.th.gov.bc.ca/atis/lgcws/index.html",
                "update_interval": "每 1 小時自動更新",
                "status": "即時監測中",
                "description": "卑詩省運輸廳 (BC MoTI / ATIS & DriveBC) 獅門大橋即時行車延誤、車流壅塞排隊地圖與現場監視影像",
                "source": "DriveBC / Advanced Traveller Information System (ATIS)"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [-123.1385, 49.3145]
            }
        }
    ]
    save_geojson_dual("vancouver_traffic_conditions.geojson", {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": "每 1 小時 (Hourly)",
        "features": features
    }, indent=2)
    print(f"[OK] Saved traffic conditions to backend and frontend")

if __name__ == "__main__":
    generate_road_closures()
    generate_road_construction()
    generate_street_lighting()
    generate_traffic_conditions()
