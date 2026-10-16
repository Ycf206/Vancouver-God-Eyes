import sys
import os
import requests
import json
from datetime import datetime, timezone

# Ensure stdout handles UTF-8 on Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, 'data')
FRONTEND_DATA_DIR = os.path.join(PROJECT_ROOT, 'frontend', 'public')

os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
if os.path.exists(os.path.join(PROJECT_ROOT, 'frontend')):
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"
}

UTILITIES_DATASETS = [
    {
        "id": "water-distribution-mains",
        "name": "自來水管道 (Water Distribution Mains)",
        "filename": "vancouver_water_distribution_mains.geojson",
        "update_frequency": "每 3 個月 (Quarterly)"
    },
    {
        "id": "sewer-mains",
        "name": "污水管道 (Sewer Mains)",
        "filename": "vancouver_sewer_mains.geojson",
        "update_frequency": "每 6 個月 (Semi-annually)"
    }
]

def download_dataset(ds):
    dataset_id = ds["id"]
    filename = ds["filename"]
    print(f"📡 正在下載公共事業資料集 [{ds['name']}] ({dataset_id})...")
    url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/exports/geojson"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=90)
        if resp.status_code != 200:
            print(f"  ❌ 下載失敗: HTTP {resp.status_code}")
            return False
        
        content = resp.content
        backend_path = os.path.join(BACKEND_DATA_DIR, filename)
        with open(backend_path, 'wb') as f:
            f.write(content)
        
        frontend_path = os.path.join(FRONTEND_DATA_DIR, filename)
        if os.path.exists(FRONTEND_DATA_DIR):
            with open(frontend_path, 'wb') as f:
                f.write(content)

        size_mb = len(content) / (1024 * 1024)
        print(f"  ✅ 成功更新 {filename} ({size_mb:.2f} MB)")
        return True
    except Exception as e:
        print(f"  ❌ 發生例外異常: {e}")
        return False

def main():
    print(f"🚀 開始執行公共事業資料同步 (自來水: 每3個月 / 污水: 每6個月): {datetime.now(timezone.utc).isoformat()}")
    results = {}
    for ds in UTILITIES_DATASETS:
        success = download_dataset(ds)
        results[ds["id"]] = {
            "success": success,
            "name": ds["name"],
            "update_frequency": ds.get("update_frequency", "每 6 個月")
        }

    status_file = os.path.join(BACKEND_DATA_DIR, "last_utilities_update.json")
    with open(status_file, "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "results": results
        }, f, indent=2, ensure_ascii=False)
    print("🎉 公共事業管網資料排程更新完成！")

if __name__ == "__main__":
    main()
