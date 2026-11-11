import os
import sys
import json
import urllib.request
import io
import time
from datetime import datetime, timezone

if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
from base import update_admin_source_metadata, get_source_endpoint_url

PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
BACKEND_DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, "frontend", "public")

DEFAULT_API_URL = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/3-1-1-service-requests/records?lang=en&order_by=service_request_open_timestamp%20desc"

def update_311(target_count=1000, page_limit=100):
    base_api_url = get_source_endpoint_url("service_requests_311", DEFAULT_API_URL)
    if "order_by" not in base_api_url:
        sep = "&" if "?" in base_api_url else "?"
        base_api_url = f"{base_api_url}{sep}order_by=service_request_open_timestamp%20desc"
    print(f"☎️ 正在更新溫哥華 3-1-1 市政服務請求資料 (URL: {base_api_url}, 目標拉取最新 {target_count} 筆)...")
    
    all_results = []
    total_dataset_count = 0
    offset = 0
    
    while len(all_results) < target_count:
        fetch_limit = min(page_limit, target_count - len(all_results))
        sep = "&" if "?" in base_api_url else "?"
        url = f"{base_api_url}{sep}limit={fetch_limit}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "VancouverGodsEye/1.0"}
        )
        
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status == 200:
                    payload = json.loads(response.read().decode('utf-8'))
                    total_dataset_count = payload.get("total_count", total_dataset_count)
                    batch = payload.get("results", [])
                    if not batch:
                        break
                    all_results.extend(batch)
                    offset += len(batch)
                    if len(batch) < fetch_limit:
                        break
                else:
                    print(f"⚠️ 批次 offset={offset} 請求失敗，HTTP 狀態: {response.status}")
                    break
        except Exception as e:
            print(f"⚠️ 批次 offset={offset} 發生異常: {e}")
            break
        time.sleep(0.08)

    if not all_results:
        print("❌ 未能獲取任何 3-1-1 數據。")
        return None

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    final_data = {
        "total_count": total_dataset_count or len(all_results),
        "updated_at": now_iso,
        "results": all_results
    }
    
    os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
    
    out_path_be = os.path.join(BACKEND_DATA_DIR, "vancouver_311.json")
    out_path_fe = os.path.join(FRONTEND_DATA_DIR, "vancouver_311.json")
    
    with open(out_path_be, "w", encoding="utf-8") as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
    with open(out_path_fe, "w", encoding="utf-8") as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
    update_admin_source_metadata("service_requests_311", record_count=len(all_results), updated_at=now_iso)
        
    print(f"✅ 3-1-1 服務請求更新完成！成功儲存最新 {len(all_results)} 筆記錄 (OpenData 總數據庫筆數: {total_dataset_count:,})。")
    return final_data

if __name__ == "__main__":
    update_311()
