import os
import sys
import json
import urllib.request

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
BACKEND_DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, "frontend", "public")

API_URL = "https://www.tntsupermarket.com/rest/V3/xmapi/get-store-eflyers?postcode=V6B1A1"

def update_tnt_eflyers():
    print("🛒 正在更新大統華 T&T 超市每週特價海報 (T&T Store E-flyers)...")
    req = urllib.request.Request(
        API_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                
                os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
                os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
                
                out_path_be = os.path.join(BACKEND_DATA_DIR, "tnt_eflyers.json")
                out_path_fe = os.path.join(FRONTEND_DATA_DIR, "tnt_eflyers.json")
                
                with open(out_path_be, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                with open(out_path_fe, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                flyers = data.get("data", {}).get("eflyer_list", [])
                print(f"✅ 大統華特價海報更新完成，共取得 {len(flyers)} 張特價頁面。")
                return data
            else:
                print(f"❌ 取得大統華特價海報失敗，HTTP 狀態碼: {response.status}")
    except Exception as e:
        print(f"❌ 更新大統華特價海報發生錯誤: {e}")
    return None

if __name__ == "__main__":
    update_tnt_eflyers()
