import os
import sys
import json
import urllib.request

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
BACKEND_DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, "frontend", "public")

API_URL = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/railways/exports/geojson"

def update_railways():
    print("🚂 正在更新溫哥華鐵路網絡圖資 (Vancouver Railways Network)...")
    req = urllib.request.Request(
        API_URL,
        headers={"User-Agent": "VancouverGodsEye/1.0"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                
                os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
                os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
                
                out_path_be = os.path.join(BACKEND_DATA_DIR, "vancouver_railways.geojson")
                out_path_fe = os.path.join(FRONTEND_DATA_DIR, "vancouver_railways.geojson")
                
                with open(out_path_be, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                with open(out_path_fe, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                
                features = data.get("features", [])
                print(f"✅ 鐵路網絡圖資更新完成，共 {len(features)} 處路軌路段。")
                return data
            else:
                print(f"❌ 取得鐵路網絡圖資失敗，HTTP 狀態碼: {response.status}")
    except Exception as e:
        print(f"❌ 更新鐵路網絡圖資發生錯誤: {e}")
    return None

if __name__ == "__main__":
    update_railways()
