import os
import sys
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import BACKEND_DATA_DIR, FRONTEND_DATA_DIR

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

    print(f"✅ 車禍事故資料同步完成，共 {len(records)} 筆記錄。")

if __name__ == "__main__":
    update_crashes()
