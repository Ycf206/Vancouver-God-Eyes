import os
import sys
import json
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson

# FedEx Locator / Yext Content Delivery Entities API
FEDEX_API_URL = "https://local.fedex.com/api/v1/entities"

def parse_fedex_entity(item):
    """
    從 FedEx / Yext 實體 API 回傳的原始資料中篩選並轉換為標準 GeoJSON Feature
    """
    coords = item.get("coordinates") or {}
    lat = coords.get("lat")
    lon = coords.get("long")
    if not lat or not lon:
        return None
    
    # 僅篩選啟用中且位於有效地理邊界之門市據點
    if str(item.get("c_activeOnPages", "")).lower() == "no":
        return None
    
    company = item.get("c_companyName") or ""
    fedex_name = item.get("name") or "FedEx"
    display_name = f"{company} ({fedex_name})" if company else fedex_name
    
    addr = item.get("address") or {}
    main_phone = item.get("mainPhone") or {}
    
    props = {
        "id": item.get("id"),
        "facility_type": "fedex",
        "name": display_name,
        "company_name": company,
        "building": item.get("c_building") or "",
        "fedex_name": fedex_name,
        "address_line1": addr.get("line1") or "",
        "city": addr.get("city") or "Vancouver",
        "postal_code": addr.get("postalCode") or "",
        "phone": main_phone.get("display") or "",
        "phone_raw": main_phone.get("number") or "",
        "website_url": item.get("websiteUrl") or "",
        "google_maps_url": item.get("googleMapsUrl") or "",
        "accepts_cash": str(item.get("c_acceptsCash", "")).lower() in ["yes", "true"],
        "shipping_assistance": bool(item.get("c_locatorShippingAssistance")),
        "locator_dropoff": bool(item.get("c_locatorDropoff")),
        "locator_pickup": bool(item.get("c_locatorPickup")),
        "max_weight": f"{item.get('c_maxAcceptedPackageWeight', '')} {item.get('c_maxAcceptedPackageWeightUnitOfMeasurment', 'LB')}".strip(),
        "min_weight": f"{item.get('c_minAcceptedPackageWeight', '')} {item.get('c_maxAcceptedPackageWeightUnitOfMeasurment', 'LB')}".strip(),
        "max_dimensions": f"{item.get('c_maxPackageLength', '')} × {item.get('c_maxPackageWidth', '')} × {item.get('c_maxPackageHeight', '')} {item.get('c_maxPackageDimensionUnitOfMeasurement', 'IN')}".strip(),
        "special_instructions": item.get("c_specialInstructions") or "",
        "description": item.get("description") or "",
        "additional_services": item.get("c_additionalServices") or [],
        "hours": item.get("hours") or {},
        "express_last_pickup": item.get("c_expressLastPickUp") or {},
        "ground_last_pickup": item.get("c_groundLastPickUpHours") or {},
        "raw_item": item
    }
    
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [float(lon), float(lat)]
        },
        "properties": props
    }

def update_fedex():
    print("🚀 正在更新 FedEx 門市與自取據點資料...")

    backend_data_dir = os.path.join(os.path.dirname(CURRENT_DIR), "data")
    existing_geojson_path = os.path.join(backend_data_dir, "vancouver_fedex.geojson")
    
    features = []
    
    # 嘗試由 FedEx 實體 API 取得最新門市清單
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        resp = requests.get(
            FEDEX_API_URL,
            params={"location": "Vancouver, BC", "radius": 50, "limit": 100},
            headers=headers,
            timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            entities = data.get("response", {}).get("entities", [])
            for item in entities:
                feat = parse_fedex_entity(item)
                if feat:
                    features.append(feat)
            print(f"📡 從 FedEx API 成功解析 {len(features)} 處即時據點。")
    except Exception as e:
        print(f"⚠️ 連線 FedEx API 異常或受限: {e}，切換為現有快取資料庫驗證更新。")

    # 若 API 回傳為空或失敗，使用本機現有已爬取完整資料集
    if not features and os.path.exists(existing_geojson_path):
        try:
            with open(existing_geojson_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
                features = existing.get("features", [])
        except Exception as e:
            print(f"Warning: Could not read existing geojson: {e}")

    # 建立標準 GeoJSON FeatureCollection
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    frontend_path = os.path.join(os.path.dirname(os.path.dirname(CURRENT_DIR)), "frontend", "public", "vancouver_fedex.geojson")
    save_layer_geojson(geojson, "vancouver_fedex.geojson")
    
    os.makedirs(os.path.dirname(frontend_path), exist_ok=True)
    with open(frontend_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"✅ FedEx 門市資料已更新完成，共 {len(features)} 處據點。")
    return geojson

if __name__ == "__main__":
    update_fedex()
