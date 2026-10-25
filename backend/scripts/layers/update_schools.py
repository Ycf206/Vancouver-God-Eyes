import os
import sys
import re
import json
import requests
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

def clean_str(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", str(s).lower())).strip()

def get_num(s):
    if not s:
        return ""
    m = re.search(r"\d+", str(s))
    return m.group(0) if m else ""

def update_schools():
    print("🏫 正在更新溫哥華學校及教育設施 (VSB API)...")
    existing = load_existing_geojson("vancouver_schools.geojson")
    features = existing.get("features", []) if existing else []

    try:
        payload = {
            "CategoryName": "FindASchoolGeoJsons",
            "MethodName": "GetSchoolListView",
            "Parameters": {"schools": ""}
        }
        resp = requests.post(
            "https://cicmsapi.azurewebsites.net/vsb/_ci/15/ci/vsb/webservice.ashx",
            data={"ansp": json.dumps(payload)},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=25
        )
        if resp.status_code == 200:
            raw_data = resp.json()
            vsb_list = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
            print(f"  -> 從 VSB API 取得 {len(vsb_list)} 間學校資訊")

            matched_count = 0
            for feat in features:
                p = feat.get("properties", {})
                p_num = get_num(p.get("address"))
                p_addr = clean_str(p.get("address"))
                p_name = clean_str(p.get("name"))

                match = None
                if p_num:
                    for v in vsb_list:
                        v_num = get_num(v.get("Address1") or v.get("Address"))
                        if v_num != p_num:
                            continue
                        v_addr = clean_str(v.get("Address1") or v.get("Address"))
                        p_words = [w for w in p_addr.split() if w != p_num and len(w) > 2]
                        v_words = [w for w in v_addr.split() if w != v_num and len(w) > 2]
                        if any(w in v_words for w in p_words):
                            match = v
                            break

                if not match:
                    for v in vsb_list:
                        v_name = clean_str(v.get("Name"))
                        if p_name == v_name or p_name in v_name or v_name in p_name:
                            match = v
                            break

                if match:
                    matched_count += 1
                    if match.get("Phone"):
                        p["phone"] = match["Phone"]
                    if match.get("Principal"):
                        p["principal"] = match["Principal"]
                    if match.get("Grades"):
                        p["grades"] = match["Grades"]
                    if match.get("Url"):
                        p["website"] = match["Url"]

            print(f"  -> 成功配對並更新 {matched_count} 間學校資訊")
    except Exception as e:
        print(f"⚠️ 線上更新學校資訊失敗: {e}")

    if features:
        save_layer_geojson("vancouver_schools.geojson", features)
        print(f"✅ 學校資料更新完成，共 {len(features)} 間學校。")
    return features

if __name__ == "__main__":
    update_schools()
