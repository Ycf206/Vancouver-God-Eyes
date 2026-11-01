import os
import sys
import json
import requests
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
from base import BACKEND_DATA_DIR, FRONTEND_DATA_DIR, update_admin_source_metadata

DATA_DIR = BACKEND_DATA_DIR

OPENDATA_ADDRESS_URL = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-addresses/records"

def update_property_addresses():
    print("⚡ 正在更新溫哥華門牌地址索引 (Property Addresses)...")
    os.makedirs(DATA_DIR, exist_ok=True)

    cache_file = os.path.join(DATA_DIR, "vancouver_property_addresses_meta.json")

    try:
        # 測試並快取門牌地址統計與總筆數
        resp = requests.get(f"{OPENDATA_ADDRESS_URL}?limit=1", timeout=20)
        resp.raise_for_status()
        data = resp.json()
        total_count = data.get("total_count", 0)
        print(f"ℹ️ 溫哥華 OpenData 全市門牌地址共 {total_count} 筆。")

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        meta = {
            "dataset_id": "property-addresses",
            "total_count": total_count,
            "updated_at": now_iso,
            "api_endpoint": OPENDATA_ADDRESS_URL,
            "status": "healthy"
        }

        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        if os.path.exists(FRONTEND_DATA_DIR):
            fe_meta = os.path.join(FRONTEND_DATA_DIR, "vancouver_property_addresses_meta.json")
            with open(fe_meta, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

        update_admin_source_metadata("property_addresses", record_count=total_count, updated_at=now_iso)
        print(f"✅ 溫哥華門牌地址索引更新完成，共 {total_count} 筆可用地址。")
        return meta
    except Exception as e:
        print(f"⚠️ 更新門牌地址索引失敗: {e}")
        return {}

if __name__ == "__main__":
    update_property_addresses()
