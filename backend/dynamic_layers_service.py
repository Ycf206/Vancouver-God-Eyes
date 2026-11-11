from __future__ import annotations
import os
import sys
import time
import asyncio
from typing import Optional, Dict, Any

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_LAYERS_DIR = os.path.join(BACKEND_DIR, "scripts", "layers")
if SCRIPTS_LAYERS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_LAYERS_DIR)

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_DATA_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))

def _is_layer_recent(filename: str, ttl_seconds: int) -> bool:
    """檢查本地快取檔是否存在且在 TTL 秒內已更新"""
    for base_dir in (BACKEND_DATA_DIR, FRONTEND_DATA_DIR):
        p = os.path.join(base_dir, filename)
        if os.path.exists(p):
            try:
                mtime = os.path.getmtime(p)
                if (time.time() - mtime) < ttl_seconds:
                    return True
            except OSError:
                pass
    return False

def refresh_shared_bikes(full: bool = True) -> int:
    """更新 Mobi 共享單車站點與即時車況"""
    try:
        from update_shared_bikes import update_mobi_stations, update_mobi_status
        if full:
            features = update_mobi_stations()
        else:
            features = update_mobi_status()
        return len(features) if features else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_shared_bikes 異常: {e}")
        return 0

def refresh_escooter(full: bool = True) -> int:
    """更新 Lime 共享滑板車站點與即時可用車況"""
    try:
        from update_escooter import update_escooter_stations, update_escooter_status
        if full:
            features = update_escooter_stations()
        else:
            features = update_escooter_status()
        return len(features) if features else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_escooter 異常: {e}")
        return 0

def refresh_311(target_count: int = 1000) -> int:
    """更新溫哥華 3-1-1 市政服務請求最新工單"""
    try:
        from update_311 import update_311
        data = update_311(target_count=target_count)
        if isinstance(data, dict) and "results" in data:
            return len(data["results"])
        return 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_311 異常: {e}")
        return 0

def refresh_food_vendors() -> int:
    """更新市區街頭熟食餐車 (StreetFoodApp)"""
    try:
        from update_food_vendors import update_food_vendors
        features = update_food_vendors()
        return len(features) if features else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_food_vendors 異常: {e}")
        return 0

def refresh_yvr_news() -> int:
    """更新 YVR 機場官方最新要聞 RSS"""
    try:
        import yvr_airport_service
        items = yvr_airport_service.fetch_yvr_news_rss(force_refresh=True)
        return len(items) if items else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_yvr_news 異常: {e}")
        return 0

async def run_dynamic_layers_background_loop():
    """
    OCI 常駐後台背景更新排程 (動態圖層與高頻資料):
    - shared_bikes (Mobi 共享單車): 每 1 小時 (3600s)
    - escooter (Lime 共享滑板車): 每 1 小時 (3600s)
    - service_requests_311 (3-1-1 市政工單): 每 12 小時 (43200s)
    - food_vendors (街頭熟食餐車): 每 24 小時 (86400s)
    """
    print("🚲🛴🍔 [Dynamic Layers Service] 常駐快取排程服務啟動 (Mobi/Lime 每小時, 3-1-1 每 12 小時, 餐車每 24 小時)...")
    loop = asyncio.get_event_loop()

    # 啟動時先暫停 5 秒讓核心網路服務綁定完成
    await asyncio.sleep(5)

    # 檢查是否需要初始預熱 (若檔案不存在或過期則在線更新)
    try:
        if not _is_layer_recent("vancouver_shared_bikes.geojson", 3600):
            print("🚲 [Dynamic Layers] 初始預熱 Mobi 共享單車...")
            await loop.run_in_executor(None, refresh_shared_bikes, True)
        if not _is_layer_recent("vancouver_escooter.geojson", 3600):
            print("🛴 [Dynamic Layers] 初始預熱 Lime 共享滑板車...")
            await loop.run_in_executor(None, refresh_escooter, True)
        if not _is_layer_recent("vancouver_311.json", 43200):
            print("☎️ [Dynamic Layers] 初始預熱 3-1-1 市政工單...")
            await loop.run_in_executor(None, refresh_311, 1000)
        if not _is_layer_recent("vancouver_food_vendors.geojson", 86400):
            print("🍔 [Dynamic Layers] 初始預熱街頭熟食餐車...")
            await loop.run_in_executor(None, refresh_food_vendors)
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] 初始預熱異常: {e}")

    last_bike_time = time.time()
    last_scooter_time = time.time()
    last_311_time = time.time()
    last_food_time = time.time()

    while True:
        try:
            await asyncio.sleep(60)  # 每分鐘心跳檢查
            now = time.time()

            # 1. 共享單車 (每 3600 秒)
            if now - last_bike_time >= 3600:
                last_bike_time = now
                print("🚲 [Dynamic Layers] 觸發排程: Mobi 共享單車即時車況更新...")
                await loop.run_in_executor(None, refresh_shared_bikes, False)

            # 2. 共享滑板車 (每 3600 秒)
            if now - last_scooter_time >= 3600:
                last_scooter_time = now
                print("🛴 [Dynamic Layers] 觸發排程: Lime 共享滑板車即時狀態更新...")
                await loop.run_in_executor(None, refresh_escooter, False)

            # 3. 3-1-1 市政工單 (每 12 小時 = 43200 秒)
            if now - last_311_time >= 43200:
                last_311_time = now
                print("☎️ [Dynamic Layers] 觸發排程: 溫哥華 3-1-1 市政工單更新...")
                await loop.run_in_executor(None, refresh_311, 1000)

            # 4. 街頭熟食餐車 (每 24 小時 = 86400 秒)
            if now - last_food_time >= 86400:
                last_food_time = now
                print("🍔 [Dynamic Layers] 觸發排程: 街頭熟食餐車更新...")
                await loop.run_in_executor(None, refresh_food_vendors)

        except asyncio.CancelledError:
            print("🛑 [Dynamic Layers Service] 常駐背景排程已停止。")
            break
        except Exception as e:
            print(f"⚠️ [Dynamic Layers Service] 背景排程執行異常: {e}")
