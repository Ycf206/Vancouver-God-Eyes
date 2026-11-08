import os
import sys
import json
import urllib.request

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, get_source_endpoint_url

DEFAULT_API_URL = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/railways/exports/geojson"

def update_railways():
    api_url = get_source_endpoint_url("vancouver_railways", DEFAULT_API_URL)
    print(f"🚂 正在更新溫哥華鐵路網絡圖資 (URL: {api_url})...")
    req = urllib.request.Request(
        api_url,
        headers={"User-Agent": "VancouverGodsEye/1.0"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                features = data.get("features", [])
                if features:
                    save_layer_geojson("vancouver_railways.geojson", features)
                    print(f"✅ 鐵路網絡圖資更新完成，共 {len(features)} 處路軌路段。")
                    return data
            else:
                print(f"❌ 取得鐵路網絡圖資失敗，HTTP 狀態碼: {response.status}")
    except Exception as e:
        print(f"❌ 更新鐵路網絡圖資發生錯誤: {e}")

    existing = load_existing_geojson("vancouver_railways.geojson")
    if existing and existing.get("features"):
        save_layer_geojson("vancouver_railways.geojson", existing["features"])
        return existing
    return None

if __name__ == "__main__":
    update_railways()
