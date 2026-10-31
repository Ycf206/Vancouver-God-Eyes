import os
import sys
import json
import urllib.request

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
BACKEND_DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, "frontend", "public")

API_URL = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/3-1-1-service-requests/records/?lang=en&limit=100&order_by=service_request_open_timestamp%20desc"

def update_311():
    print("☎️ 正在更新溫哥華 3-1-1 市政服務請求資料 (3-1-1 Service Requests)...")
    req = urllib.request.Request(
        API_URL,
        headers={"User-Agent": "VancouverGodsEye/1.0"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                
                os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
                os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
                
                out_path_be = os.path.join(BACKEND_DATA_DIR, "vancouver_311.json")
                out_path_fe = os.path.join(FRONTEND_DATA_DIR, "vancouver_311.json")
                
                with open(out_path_be, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                with open(out_path_fe, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                count = len(data.get("results", []))
                print(f"✅ 3-1-1 服務請求更新完成，共取得最新 {count} 筆記錄。")
                return data
            else:
                print(f"❌ 取得 3-1-1 資料失敗，HTTP 狀態碼: {response.status}")
    except Exception as e:
        print(f"❌ 更新 3-1-1 資料發生錯誤: {e}")
    return None

if __name__ == "__main__":
    update_311()
