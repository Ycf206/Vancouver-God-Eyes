import os
import sys
import re

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def clean_fountain_name(raw_name):
    if not raw_name:
        return "公共飲水台"
    name = str(raw_name).strip()
    cleaned = re.sub(r"^(?:Temporary\s+)?(?:Fountain|Fountian|Bottle Filling Station|Misting Station|Handwashing Station)?\s*(?:location|Location)?\s*:\s*", "", name, flags=re.IGNORECASE).strip()
    return cleaned if cleaned else name

def clean_in_operation(val):
    if not val:
        return None
    s = str(val).strip().lower()
    if "spring" in s and "fall" in s:
        return "春季至秋季開放"
    if "year" in s:
        return "全年開放"
    if "may" in s and "october" in s:
        return "5月至10月開放"
    return str(val).strip()

def clean_pet_friendly(val):
    if val is None or val == "":
        return None
    s = str(val).strip().upper()
    if s in ("Y", "YES", "TRUE", "1", "是"):
        return "是"
    if s in ("N", "NO", "FALSE", "0", "否"):
        return "否"
    return None

def clean_maintainer(val):
    if not val:
        return None
    s = str(val).strip()
    if "park" in s.lower():
        return "Parks"
    if "engineering" in s.lower():
        return "Engineering"
    return s

def update_drinking_fountains():
    print("💧 正在更新公共飲水台 (Drinking Fountains)...")

    # 1. 載入儲存庫既有飲水台 GeoJSON，以既有圖資為骨幹，絕對不直接被 OpenData 取代
    existing_data = load_existing_geojson("vancouver_drinking_fountains.geojson")
    existing_features = existing_data.get("features", []) if existing_data else []
    print(f"📦 已載入現有公共飲水台快取資料，共 {len(existing_features)} 處水台。")

    feature_id_map = {}
    feature_mapid_map = {}
    feature_name_map = {}

    for f in existing_features:
        fid = f.get("id")
        if fid:
            feature_id_map[str(fid).lower()] = f
        props = f.get("properties") or {}
        mapid = props.get("mapid")
        if mapid:
            feature_mapid_map[str(mapid).lower()] = f
            feature_mapid_map[str(mapid).replace("fountain_", "").lower()] = f

        # Clean existing properties
        props["facility_type"] = "drinking_fountains"
        props["name"] = clean_fountain_name(props.get("name") or props.get("park_or_site"))
        props["in_operation"] = clean_in_operation(props.get("in_operation"))
        props["pet_friendly"] = clean_pet_friendly(props.get("pet_friendly") or props.get("pet_bowl"))
        if props.get("location"):
            props["location"] = str(props["location"]).strip() or None
        if props.get("maintainer"):
            props["maintainer"] = clean_maintainer(props.get("maintainer"))

        name_key = props["name"].lower()
        if name_key and name_key != "公共飲水台":
            feature_name_map[name_key] = f

    # 2. 獲取 OpenData API 資料並進行增量屬性補充與更新
    matched_count = 0
    new_count = 0
    try:
        records = fetch_all_records("drinking-fountains")
        print(f"🌐 自 OpenData 取得 {len(records)} 筆飲水台更新紀錄...")

        for r in records:
            mapid = str(r.get("mapid") or "").strip()
            raw_name = r.get("name") or r.get("park_or_site") or ""
            name = clean_fountain_name(raw_name)
            location = (r.get("location") or "").strip() or None
            maintainer = clean_maintainer(r.get("maintainer"))
            in_op = clean_in_operation(r.get("in_operation"))
            pet_friendly = clean_pet_friendly(r.get("pet_friendly") or r.get("pet_bowl"))
            local_area = (r.get("geo_local_area") or r.get("local_area") or "").strip() or None

            target_feat = None
            if mapid:
                mid_key = mapid.lower()
                target_feat = feature_mapid_map.get(mid_key) or feature_mapid_map.get(mid_key.replace("fountain_", ""))
                if not target_feat:
                    target_feat = feature_id_map.get(f"fountain_{mid_key}")
            if not target_feat and name and name.lower() in feature_name_map:
                target_feat = feature_name_map[name.lower()]

            if target_feat:
                p = target_feat["properties"]
                if name:
                    p["name"] = name
                    p["park_or_site"] = name
                if mapid:
                    p["mapid"] = mapid
                if location is not None:
                    p["location"] = location
                if maintainer is not None:
                    p["maintainer"] = maintainer
                if in_op is not None:
                    p["in_operation"] = in_op
                if pet_friendly is not None:
                    p["pet_friendly"] = pet_friendly
                if local_area is not None:
                    p["local_area"] = local_area
                matched_count += 1
            else:
                # OpenData 中有但既有檔案中未收錄的新飲水台
                geo = r.get("geo_point_2d") or {}
                lat = geo.get("lat")
                lon = geo.get("lon")
                if lat is None or lon is None:
                    geom = r.get("geom") or {}
                    coords = geom.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        lon, lat = coords[0], coords[1]
                if lat is None or lon is None:
                    continue

                new_fid = f"fountain_{mapid}" if mapid else f"fountain_new_{len(existing_features) + new_count + 1}"
                new_feat = {
                    "type": "Feature",
                    "id": new_fid,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(float(lon), 6), round(float(lat), 6)]
                    },
                    "properties": {
                        "id": new_fid,
                        "facility_type": "drinking_fountains",
                        "name": name,
                        "park_or_site": name,
                        "mapid": mapid or new_fid,
                        "location": location,
                        "maintainer": maintainer,
                        "in_operation": in_op,
                        "pet_friendly": pet_friendly,
                        "local_area": local_area or "Vancouver"
                    }
                }
                existing_features.append(new_feat)
                if mapid:
                    feature_mapid_map[mapid.lower()] = new_feat
                new_count += 1

        print(f"ℹ️ OpenData 飲水台比對完成: 更新 {matched_count} 筆飲水台屬性，新增 {new_count} 筆飲水台。")
    except Exception as e:
        print(f"⚠️ 擷取 OpenData 時發生例外，保留既有資料屬性: {e}")

    # 3. 儲存更新後的 GeoJSON 至後端與前端公共目錄
    save_layer_geojson("vancouver_drinking_fountains.geojson", existing_features)
    sync_facility_to_db("drinking_fountains", existing_features)
    print(f"✅ 公共飲水台更新完成，共 {len(existing_features)} 處水台。")
    return existing_features

if __name__ == "__main__":
    update_drinking_fountains()
