import os
import sys
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

GDRIVE_CANDIDATE_PATHS = [
    r"G:\我的雲端硬碟\GodEyes\community_center.geojson",
    r"G:\我的雲端硬碟\GodEyes\GeoJson\community_center.geojson",
]

def load_base_community_centres():
    """優先自 Google 雲端硬碟載入權威社區中心 GeoJSON，若無則讀取現有儲存庫快取。"""
    for p in GDRIVE_CANDIDATE_PATHS:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    feats = data.get("features", [])
                    if feats:
                        print(f"📂 成功自 Google 雲端硬碟載入社區活動中心資料: {p} (共 {len(feats)} 處中心)")
                        return feats
            except Exception as e:
                print(f"⚠️ 讀取 Google 雲端硬碟 GeoJSON 失敗 ({p}): {e}")

    # Fallback to local repository geojson
    existing = load_existing_geojson("vancouver_community_centres.geojson")
    if existing and "features" in existing and existing["features"]:
        print(f"📦 自本地儲存庫載入既有社區中心資料 (共 {len(existing['features'])} 處中心)")
        return existing["features"]

    return []

def update_community_centres():
    print("🏛️ 正在更新溫哥華社區活動中心 (Community Centres)...")
    base_features = load_base_community_centres()
    if not base_features:
        print("❌ 未能載入任何社區中心基礎資料，終止更新。")
        return []

    # 建立以名稱為索引的特徵字典 (以 GeoJSON 權威清單為準，新 GeoJSON 中沒有列出的舊位置予以排除)
    feature_map = {}
    normalized_features = []

    for idx, feat in enumerate(base_features):
        props = dict(feat.get("properties") or {})
        name = (props.get("name") or f"Community Centre {idx + 1}").strip()
        norm_key = name.lower()

        # 確保必要欄位皆正確
        props["facility_type"] = "community_centres"
        props["name"] = name
        if not props.get("id"):
            props["id"] = feat.get("id") or (idx + 1)

        # 確保 urllink 存在
        if not props.get("urllink") and props.get("website"):
            props["urllink"] = props["website"]

        feat["properties"] = props
        if "id" not in feat:
            feat["id"] = props["id"]

        feature_map[norm_key] = feat
        normalized_features.append(feat)

    # 5.6 用 OpenData 資料進行屬性輔助更新 (絕對不覆蓋 hours, email 等專用欄位，也不新增未在 GeoJSON 的中心)
    try:
        print("🌐 查詢 OpenData API 補充社區中心聯絡資訊...")
        opendata_records = fetch_all_records("community-centres")
        matched_count = 0
        for r in opendata_records:
            r_name = (r.get("name") or "").strip().lower()
            if r_name in feature_map:
                feat = feature_map[r_name]
                p = feat["properties"]
                # 僅補充 OpenData 中有值且原先缺失的屬性，或同步更新電話 / 官方網址
                if r.get("phone") and not p.get("phone"):
                    p["phone"] = r.get("phone")
                if r.get("fax") and not p.get("fax"):
                    p["fax"] = r.get("fax")
                if r.get("urllink") and not p.get("urllink"):
                    p["urllink"] = r.get("urllink")
                if r.get("geo_local_area") and not p.get("geo_local_area"):
                    p["geo_local_area"] = r.get("geo_local_area")
                matched_count += 1
        print(f"ℹ️ OpenData 輔助屬性比對更新完成，共匹配 {matched_count} 筆資料。")
    except Exception as e:
        print(f"⚠️ OpenData API 查詢失敗或跳過，保留權威 GeoJSON 資料: {e}")

    # 5.5 確保地圖與後端資料均使用完整保留欄位的 GeoJSON
    save_layer_geojson("vancouver_community_centres.geojson", normalized_features)
    sync_facility_to_db("community_centres", normalized_features)
    print(f"✅ 社區中心更新完成，共儲存 {len(normalized_features)} 處中心。")
    return normalized_features

if __name__ == "__main__":
    update_community_centres()
