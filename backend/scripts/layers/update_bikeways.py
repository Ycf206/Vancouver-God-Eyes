import os
import sys
import json
import re

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson

BIKEWAY_TYPE_ZH_MAP = {
    "Protected Bike Lanes": "受保護獨立街道",
    "Painted Lanes": "路面標線單車路",
    "Local Street": "社區慢速單車街",
    "Shared Lanes": "混合共用車道",
}

def clean_direction_zh(dir_val):
    if not dir_val:
        return None
    d = str(dir_val).strip()
    d_lower = d.lower()
    if "bidirectional" in d_lower or "two-way" in d_lower or "two way" in d_lower or d == "2W" or "雙向" in d:
        return "雙向通行"
    if "cflow" in d_lower or "contra" in d_lower or "counter" in d_lower or "逆向" in d:
        return "逆向通行"
    if "one-way" in d_lower or "one way" in d_lower or d == "1W" or d == "OW" or "單向" in d:
        return "單向通行"
    if d_lower in ("eb", "eastbound"):
        return "東行"
    if d_lower in ("wb", "westbound"):
        return "西行"
    if d_lower in ("nb", "northbound"):
        return "北行"
    if d_lower in ("sb", "southbound"):
        return "南行"
    # Remove any English/parenthesized notes, keeping only Chinese characters if available
    zh_chars = re.sub(r"[a-zA-Z\(\)\s\-_]+", "", d).strip()
    return zh_chars if zh_chars else d

def clean_snow_removal(val):
    if not val:
        return None
    s = str(val).strip()
    s = s.replace("❄️", "").replace("❄", "").strip()
    if s.lower() == "yes" or "優先" in s:
        return "優先除雪路線"
    if s.lower() == "no" or "一般" in s:
        return "一般維護"
    return s if s else None

def clean_speed_limit(val):
    if val is None or val == "":
        return None
    try:
        num = int(re.sub(r"[^\d]", "", str(val)))
        return num if num > 0 else None
    except Exception:
        return None

def _round_coords(geom_coords):
    if not geom_coords:
        return []
    if isinstance(geom_coords[0], (int, float)):
        return [round(float(geom_coords[0]), 6), round(float(geom_coords[1]), 6)]
    return [_round_coords(c) for c in geom_coords]

def update_bikeways():
    print("🚲 正在更新單車專用徑道路網 (Bikeways Network)...")

    # 1. 載入儲存庫既有 3,744 筆詳細單車道圖資 (保證 bikeway_type 與屬性不被破壞)
    existing_data = load_existing_geojson("vancouver_bikeways.geojson")
    existing_features = existing_data.get("features", []) if existing_data else []
    print(f"📦 已載入現有單車徑快取資料，共 {len(existing_features)} 處路段。")

    feature_id_map = {}
    feature_name_map = {}

    for f in existing_features:
        fid = f.get("id")
        if fid:
            feature_id_map[str(fid)] = f
        props = f.get("properties") or {}
        r_name = (props.get("bike_route_name") or "").strip().lower()
        s_name = (props.get("street_name") or "").strip().lower()
        if r_name and s_name:
            feature_name_map[(r_name, s_name)] = f

        # 清理並標準化既有屬性
        b_type = props.get("bikeway_type") or "Local Street"
        props["bikeway_type"] = b_type
        props["bikeway_type_zh"] = BIKEWAY_TYPE_ZH_MAP.get(b_type, props.get("bikeway_type_zh") or "社區慢速單車街")
        props["bikeway_direction"] = clean_direction_zh(props.get("bikeway_direction"))
        props["snow_removal"] = clean_snow_removal(props.get("snow_removal"))
        props["speed_limit"] = clean_speed_limit(props.get("speed_limit"))
        if props.get("year_of_construction"):
            props["year_of_construction"] = str(props["year_of_construction"]).strip() or None
        if props.get("upgrade_year"):
            props["upgrade_year"] = str(props["upgrade_year"]).strip() or None

    # 2. 獲取 OpenData API 資料並進行增量屬性補充與更新
    matched_count = 0
    new_count = 0
    try:
        records = fetch_all_records("bikeways")
        print(f"🌐 自 OpenData 取得 {len(records)} 筆單車道更新紀錄...")

        for r in records:
            obj_id = str(r.get("object_id") or "").strip()
            fid_candidate = f"bikeway_{obj_id}" if obj_id else None
            r_name = (r.get("bike_route_name") or r.get("bikeway_name") or r.get("route_name") or "").strip()
            s_name = (r.get("street_name") or "").strip()

            target_feat = None
            if fid_candidate and fid_candidate in feature_id_map:
                target_feat = feature_id_map[fid_candidate]
            elif (r_name.lower(), s_name.lower()) in feature_name_map:
                target_feat = feature_name_map[(r_name.lower(), s_name.lower())]

            b_type = r.get("bikeway_type") or (target_feat["properties"].get("bikeway_type") if target_feat else "Local Street")
            zh_type = BIKEWAY_TYPE_ZH_MAP.get(b_type, "社區慢速單車街")
            dir_zh = clean_direction_zh(r.get("bikeway_direction") or (target_feat["properties"].get("bikeway_direction") if target_feat else None))
            spd = clean_speed_limit(r.get("speed_limit")) or (target_feat["properties"].get("speed_limit") if target_feat else None)
            snow = clean_snow_removal(r.get("snow_removal")) or (target_feat["properties"].get("snow_removal") if target_feat else None)
            y_const = r.get("year_of_construction") or (target_feat["properties"].get("year_of_construction") if target_feat else None)
            y_upg = r.get("upgrade_year") or (target_feat["properties"].get("upgrade_year") if target_feat else None)

            if target_feat:
                p = target_feat["properties"]
                if r_name:
                    p["bike_route_name"] = r_name
                if s_name:
                    p["street_name"] = s_name
                p["bikeway_type"] = b_type
                p["bikeway_type_zh"] = zh_type
                if dir_zh:
                    p["bikeway_direction"] = dir_zh
                if spd is not None:
                    p["speed_limit"] = spd
                if snow:
                    p["snow_removal"] = snow
                if y_const:
                    p["year_of_construction"] = str(y_const).strip()
                if y_upg:
                    p["upgrade_year"] = str(y_upg).strip()
                matched_count += 1
            else:
                # OpenData 發現的新路段
                geom_dict = r.get("geom") or {}
                geometry = geom_dict.get("geometry") or geom_dict
                if not geometry or not geometry.get("coordinates"):
                    continue
                geometry["coordinates"] = _round_coords(geometry["coordinates"])

                new_fid = fid_candidate or f"bikeway_{len(existing_features) + new_count + 1}"
                new_feat = {
                    "type": "Feature",
                    "id": new_fid,
                    "geometry": geometry,
                    "properties": {
                        "id": new_fid,
                        "facility_type": "bikeways",
                        "name": f"{r_name} ({s_name})".strip() if s_name else r_name or "單車徑",
                        "bike_route_name": r_name or "單車徑",
                        "street_name": s_name,
                        "bikeway_type": b_type,
                        "bikeway_type_zh": zh_type,
                        "bikeway_direction": dir_zh,
                        "speed_limit": spd,
                        "snow_removal": snow,
                        "year_of_construction": str(y_const).strip() if y_const else None,
                        "upgrade_year": str(y_upg).strip() if y_upg else None,
                        "local_area": "溫哥華市"
                    }
                }
                existing_features.append(new_feat)
                feature_id_map[new_fid] = new_feat
                new_count += 1

        print(f"ℹ️ OpenData 比對完成: 更新 {matched_count} 筆路段屬性，新增 {new_count} 筆路段。")
    except Exception as e:
        print(f"⚠️ 擷取 OpenData 時發生例外，保留既有資料屬性: {e}")

    # 3. 儲存至本地快取與前端
    save_layer_geojson("vancouver_bikeways.geojson", existing_features)
    print(f"✅ 單車徑路網更新完成，共 {len(existing_features)} 處路段。")
    return existing_features

if __name__ == "__main__":
    update_bikeways()
