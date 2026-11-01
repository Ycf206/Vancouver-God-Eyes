import os
import sys
import json
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
from base import BACKEND_DATA_DIR, FRONTEND_DATA_DIR, update_admin_source_metadata

def update_crashes():
    print("🚀 正在更新溫哥華車禍事故熱點資料...")
    crashes_json_path = os.path.join(BACKEND_DATA_DIR, "vancouver_crashes.json")

    if not os.path.exists(crashes_json_path):
        print("❌ 找不到 vancouver_crashes.json")
        return

    with open(crashes_json_path, "r", encoding="utf-8") as f:
        records = json.load(f)

    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
    frontend_path = os.path.join(FRONTEND_DATA_DIR, "vancouver_crashes.json")
    with open(frontend_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False)

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    count = len(records) if isinstance(records, list) else len(records.get("features", records.get("results", [])))
    update_admin_source_metadata("vancouver_crashes", record_count=count, updated_at=now_iso)
    print(f"✅ 車禍事故資料同步完成，共 {count} 筆記錄。")

if __name__ == "__main__":
    update_crashes()
