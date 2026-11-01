import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def to_yes_no(val):
    if val is None or val == "":
        return "否"
    s = str(val).strip().upper()
    if s in ("Y", "YES", "TRUE", "1", "有", "是"):
        return "是"
    return "否"

def clean_hectare(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        return round(f, 2)
    except Exception:
        return None

def update_parks():
    print("🌲 正在更新溫哥華都會與社區公園 (City Parks)...")

    # 1.1 載入儲存庫既有公園 GeoJSON，以既有圖資為骨幹，絕對不直接被 OpenData 取代
    existing_data = load_existing_geojson("vancouver_parks.geojson")
    existing_features = existing_data.get("features", []) if existing_data else []
    print(f"📦 已載入現有公園快取資料，共 {len(existing_features)} 處公園。")

    feature_id_map = {}
    feature_name_map = {}

    for f in existing_features:
        props = f.get("properties") or {}
        pid = props.get("parkid")
        if pid is not None:
            feature_id_map[str(pid)] = f
        name = (props.get("name") or "").strip().lower()
        if name:
            feature_name_map[name] = f

        # 標準化既有屬性：1.2 綠地面積 hectare 與 1.3 facilities / washrooms 改為 "是/否"
        props["facility_type"] = "parks"
        if props.get("hectare") is not None:
            props["hectare"] = clean_hectare(props.get("hectare"))
            props["hectares"] = props["hectare"]
        elif props.get("hectares") is not None:
            props["hectare"] = clean_hectare(props.get("hectares"))
            props["hectares"] = props["hectare"]

        props["facilities"] = to_yes_no(props.get("facilities"))
        props["washrooms"] = to_yes_no(props.get("washrooms"))

    # 2. 查詢 OpenData API 進行屬性更新比對
    matched_count = 0
    new_count = 0
    try:
        records = fetch_all_records("parks")
        print(f"🌐 自 OpenData 取得 {len(records)} 筆公園更新紀錄...")

        for r in records:
            pid = str(r.get("parkid") or "").strip()
            name = (r.get("name") or "公園").strip()
            name_key = name.lower()

            target_feat = None
            if pid and pid in feature_id_map:
                target_feat = feature_id_map[pid]
            elif name_key in feature_name_map:
                target_feat = feature_name_map[name_key]

            # 1.2 綠地面積 hectare
            hect = clean_hectare(r.get("hectare") or r.get("hectares"))

            # 1.3 休閒設施與洗手間改為 "是/否"
            fac_val = to_yes_no(r.get("facilities"))
            wash_val = to_yes_no(r.get("washrooms"))

            addr = f"{r.get('streetnumber', '')} {r.get('streetname', '')}".strip()
            nb_name = r.get("neighbourhoodname")

            if target_feat:
                p = target_feat["properties"]
                if name:
                    p["name"] = name
                if pid:
                    p["parkid"] = int(pid) if pid.isdigit() else pid
                if hect is not None:
                    p["hectare"] = hect
                    p["hectares"] = hect
                p["facilities"] = fac_val
                p["washrooms"] = wash_val
                if addr:
                    p["street_address"] = addr
                if nb_name:
                    p["neighbourhood"] = nb_name
                    p["local_area"] = nb_name
                if r.get("advisories"):
                    p["advisories"] = r.get("advisories")
                if r.get("specialfeatures"):
                    p["specialfeatures"] = r.get("specialfeatures")
                matched_count += 1
            else:
                # OpenData 中有但既有檔案中未收錄的新公園
                gmap = r.get("googlemapdest") or {}
                lat = gmap.get("lat") or (r.get("geo_point_2d") or {}).get("lat")
                lon = gmap.get("lon") or (r.get("geo_point_2d") or {}).get("lon")
                if lat is None or lon is None:
                    continue

                new_fid = f"park_{pid}" if pid else f"park_{len(existing_features) + new_count + 1}"
                new_feat = {
                    "type": "Feature",
                    "id": new_fid,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(float(lon), 6), round(float(lat), 6)]
                    },
                    "properties": {
                        "id": new_fid,
                        "facility_type": "parks",
                        "name": name,
                        "parkid": int(pid) if pid.isdigit() else pid,
                        "street_address": addr,
                        "neighbourhood": nb_name or "",
                        "local_area": nb_name or "Vancouver",
                        "hectare": hect,
                        "hectares": hect,
                        "facilities": fac_val,
                        "washrooms": wash_val,
                        "advisories": r.get("advisories", "N"),
                        "specialfeatures": r.get("specialfeatures", "N")
                    }
                }
                existing_features.append(new_feat)
                if pid:
                    feature_id_map[pid] = new_feat
                new_count += 1

        print(f"ℹ️ OpenData 公園比對完成: 更新 {matched_count} 筆公園屬性，新增 {new_count} 筆公園。")
    except Exception as e:
        print(f"⚠️ 擷取 OpenData 時發生例外，保留既有資料屬性: {e}")

    # 3. 儲存更新後的 GeoJSON 至後端與前端公共目錄
    save_layer_geojson("vancouver_parks.geojson", existing_features)
    sync_facility_to_db("parks", existing_features)
    print(f"✅ 公園圖資更新完成，共 {len(existing_features)} 處公園。")
    return existing_features

if __name__ == "__main__":
    update_parks()
