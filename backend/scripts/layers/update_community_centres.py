import os
import sys
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import fetch_all_records, save_layer_geojson, load_existing_geojson, sync_facility_to_db

def update_community_centres():
    print("🏛️ 正在更新溫哥華社區活動中心 (Community Centres)...")

    # 3. 系統本身已有 GeoJSON 檔案，直接載入系統既有資料，不再 Hardcode Google 雲端硬碟路徑
    existing = load_existing_geojson("vancouver_community_centres.geojson")
    base_features = existing.get("features", []) if existing else []
    if not base_features:
        print("❌ 未能載入既有社區中心 GeoJSON 快取資料，終止更新。")
        return []

    print(f"📦 成功自現有系統載入 {len(base_features)} 處社區活動中心資料。")

    # 建立以名稱為索引的特徵字典
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

    # 用 OpenData 資料進行屬性輔助更新 (絕對不覆蓋 hours, email 等專用欄位，也不新增未在 GeoJSON 的中心)
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

    # 確保地圖與後端資料均使用完整保留欄位的 GeoJSON
    save_layer_geojson("vancouver_community_centres.geojson", normalized_features)
    sync_facility_to_db("community_centres", normalized_features)
    print(f"✅ 社區中心更新完成，共儲存 {len(normalized_features)} 處中心。")
    return normalized_features

if __name__ == "__main__":
    update_community_centres()
