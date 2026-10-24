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

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, 'data')
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, 'frontend', 'public')

os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
if os.path.exists(os.path.join(PROJECT_ROOT, 'frontend')):
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

HEADERS = {"User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"}

def fetch_all_records(dataset_id: str):
    """Fetches all records from Vancouver Open Data API v2.1."""
    base_url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/records"
    limit = 100
    offset = 0
    records = []
    print(f"📡 正在抓取每週圖資資料集 [{dataset_id}]...")
    while True:
        url = f"{base_url}?limit={limit}&offset={offset}&lang=en"
        try:
            r = requests.get(url, headers=HEADERS, timeout=25)
            if r.status_code != 200:
                print(f"  ❌ 抓取 {dataset_id} 失敗 (offset {offset}, status {r.status_code})")
                break
            data = r.json()
            results = data.get("results", [])
            if not results:
                break
            records.extend(results)
            total = data.get("total_count", len(records))
            print(f"  -> 已載入 {len(records)} / {total} 筆資料...")
            if len(records) >= total:
                break
            offset += limit
        except Exception as e:
            print(f"  ❌ 抓取 {dataset_id} 發生異常: {e}")
            break
    print(f"✅ [{dataset_id}] 抓取完成，共 {len(records)} 筆記錄")
    return records

def save_geojson(name: str, features: list, frequency: str = "每星期 1 次 (Weekly)"):
    """Saves GeoJSON to backend/data and frontend/public."""
    fc = {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(features),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "update_frequency": frequency,
        "features": features
    }
    b_path = os.path.join(BACKEND_DATA_DIR, f"{name}.geojson")
    with open(b_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    if os.path.exists(FRONTEND_DATA_DIR):
        f_path = os.path.join(FRONTEND_DATA_DIR, f"{name}.geojson")
        with open(f_path, "w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False)
    print(f"💾 成功儲存 {name}.geojson ({len(features)} 個地理要素)")

def update_road_closures():
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

        url = r.get("url_link") or ""
        proj_val = r.get("project") or ""
        loc_val = r.get("location") or ""
        street_val = r.get("street") or ""
        comp_date_val = r.get("comp_date") or ""
        sched_val = ""

        if "3d8e433d" in url:
            proj_val = proj_val or "Hawks Ave Closure Pilot"
            loc_val = loc_val or "Hawks Ave Closure Pilot"
            street_val = street_val or "Hawks Ave"
            sched_val = "Mar 19, 2025 - Jan 1, 2028"
            comp_date_val = comp_date_val or "2028-01-01"
        elif "36e847e9" in url:
            proj_val = proj_val or "W 14th Av, Birch St, and Alder St"
            loc_val = loc_val or "W 14th Av, Birch St, and Alder St"
            street_val = street_val or "W 14th Av, Birch St, and Alder St"
            sched_val = "Jul 27, 2026 - Oct 19, 2026; Weekdays; 7:00 AM - 3:00 PM"
            comp_date_val = comp_date_val or "2026-10-19"

        proj_name = proj_val or loc_val or street_val or f"交通封閉項目 #{idx+1}"
        feat_id = f"closure_{idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "road_closures",
                "name": proj_name,
                "project": proj_val,
                "street": street_val,
                "location": loc_val,
                "schedule": sched_val,
                "comp_date": comp_date_val,
                "url_link": url,
                "geo_point_2d": pt
            },
            "geometry": geometry
        })
    save_geojson("vancouver_road_closures", features)

def update_road_construction():
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

        url = r.get("url_link") or ""
        proj_val = r.get("project") or ""
        street_val = r.get("street") or ""
        loc_val = r.get("location") or ""
        comp_date_val = r.get("comp_date") or ""
        sched_val = None

        if "0a4e0683" in url:
            proj_val = proj_val or "E King Edward Av, St Catherines St to Kingsway"
            loc_val = loc_val or "E King Edward Av, St Catherines St to Kingsway"
            street_val = street_val or "E King Edward Av"
            sched_val = "Sep 14, 2026 - Mar 5, 2027; Weekdays; 7:00 AM - 3:00 PM"
            comp_date_val = comp_date_val or "2027-03-05"
        elif "15675431" in url:
            proj_val = proj_val or "Dunbar West Sewer Package"
            loc_val = loc_val or "Dunbar West Sewer Package"
            street_val = street_val or "Dunbar St"
        elif "a484ab1c" in url:
            proj_val = proj_val or "Placeholder - Mt Pleasant Substation Transformer Install"
            loc_val = loc_val or "Placeholder - Mt Pleasant Substation Transformer Install"
        elif "5418cb71" in url:
            proj_val = proj_val or "E. 49th Ave Streets Renewal, Knight to Killarney"
            loc_val = loc_val or "E. 49th Ave Streets Renewal, Knight to Killarney"
            street_val = street_val or "E 49th Ave"
        elif "c19571ad" in url:
            proj_val = proj_val or "2026 RRFB Program"
            loc_val = loc_val or "2026 RRFB Program"

        proj_name = proj_val or loc_val or street_val or f"道路施工項目 #{idx+1}"
        feat_id = f"construction_{idx+1}"
        features.append({
            "type": "Feature",
            "id": feat_id,
            "properties": {
                "id": feat_id,
                "facility_type": "road_construction",
                "name": proj_name,
                "project": proj_val,
                "street": street_val,
                "location": loc_val,
                "schedule": sched_val,
                "comp_date": comp_date_val,
                "url_link": url,
                "geo_point_2d": pt
            },
            "geometry": geometry
        })
    save_geojson("vancouver_road_construction", features)

def update_fire_hydrants():
    records = fetch_all_records("water-hydrants")
    features = []
    for idx, r in enumerate(records):
        pt = r.get("geo_point_2d") or {}
        lon = pt.get("lon")
        lat = pt.get("lat")
        if lon is None or lat is None:
            geom_field = r.get("geom", {})
            if isinstance(geom_field, dict) and geom_field.get("coordinates"):
                lon, lat = geom_field["coordinates"][0], geom_field["coordinates"][1]
        if lon is None or lat is None:
            continue

        hyd_id = r.get("id") or f"WH_{idx+1}"
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)]
            },
            "properties": {
                "id": hyd_id,
                "facility_type": "fire_hydrants",
                "name": f"消防栓 ({r.get('street') or hyd_id})",
                "code": r.get("code") or "",
                "covwaterhydrantunittype": r.get("covwaterhydrantunittype") or "",
                "color": r.get("color") or "Blue",
                "street": r.get("street") or "",
                "status": r.get("status") or "IN_SERVICE",
                "geo_local_area": r.get("geo_local_area") or "",
                "geo_point_2d": {"lon": lon, "lat": lat}
            }
        })
    save_geojson("vancouver_fire_hydrants", features, frequency="每星期 1 次 (Weekly)")

def run_weekly_updates():
    start_time = datetime.now(timezone.utc)
    print("=" * 60)
    print("🚀 啟動每週開放資料定期更新排程 (Weekly Datasets Cron Update)")
    print(f"⏰ 開始時間: {start_time.isoformat()}")
    print("=" * 60)

    # 1. Road Closures (每星期更新)
    update_road_closures()

    # 2. Road Construction (每星期更新)
    update_road_construction()

    meta_path = os.path.join(BACKEND_DATA_DIR, "last_weekly_datasets_update.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "cycle": "weekly",
            "datasets": [
                "vancouver_road_closures",
                "vancouver_road_construction"
            ]
        }, f, indent=2)

    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    print("=" * 60)
    print(f"🎉 每週圖資更新順利完成！費時 {duration:.1f} 秒")
    print("=" * 60)

if __name__ == "__main__":
    run_weekly_updates()
