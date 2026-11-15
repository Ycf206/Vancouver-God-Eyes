from __future__ import annotations
import os
import sys
import time
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_LAYERS_DIR = os.path.join(BACKEND_DIR, "scripts", "layers")
if SCRIPTS_LAYERS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_LAYERS_DIR)

BACKEND_DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_DATA_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))


def log_data_source_update(
    source_id: str,
    source_name: str,
    record_count: Optional[int],
    target_file: str,
    file_path: str,
    error: Optional[Exception | str] = None,
    runner: str = "oci"
) -> None:
    """
    詳細記錄資料源更新紀錄至系統日誌 (system_logs.json) 與排程歷史 (admin_schedule_history.json)
    無論伺服器在背景自動運行、或管理員手動觸發，成功與失敗皆留存詳細資料。
    """
    try:
        from system_log_service import system_log_service
        now_iso = datetime.now(timezone.utc).isoformat()
        is_success = error is None and (record_count is not None and record_count >= 0)
        level = "SUCCESS" if is_success else "ERROR"
        action = "DATA_SOURCE_SYNC" if is_success else "DATA_SOURCE_SYNC_ERROR"

        if is_success:
            msg = f"資料源更新完成：{source_name} ({source_id})，成功更新 {record_count} 筆資料至 {target_file}。"
        else:
            msg = f"資料源更新失敗：{source_name} ({source_id})，錯誤原因: {str(error)}"

        details = {
            "source_id": source_id,
            "source_name": source_name,
            "record_count": record_count if is_success else 0,
            "target_file": target_file,
            "runner": runner,
            "status": "success" if is_success else "error",
            "error": str(error) if error else None
        }

        # 1. 寫入系統日誌 (System Logs)
        system_log_service.add_system_log(
            level=level,
            file=file_path,
            action=action,
            message=msg,
            details=details
        )

        # 2. 寫入排程歷史 (Schedule History)
        sched_entry = {
            "id": f"log-{int(time.time() * 1000)}",
            "timestamp": now_iso,
            "action": f"{runner.upper()}_DAEMON_SYNC",
            "source_name": source_name,
            "runner": runner,
            "status": "success" if is_success else "error",
            "detail": msg,
            "record_count": record_count if is_success else 0
        }
        system_log_service.append_schedule_log(sched_entry)

    except Exception as log_err:
        print(f"⚠️ [Dynamic Layers] 寫入系統日誌失敗: {log_err}")


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
    """更新 Mobi 共享單車站點與即時車況 (full=True 為每月全量站點結構，full=False 為每小時即時車位)"""
    file_path = "backend/scripts/layers/update_shared_bikes.py"
    target_file = "vancouver_shared_bikes.geojson"
    mode_text = "每月全量站點" if full else "每小時即時車位"
    try:
        from update_shared_bikes import update_mobi_stations, update_mobi_status
        if full:
            features = update_mobi_stations()
        else:
            features = update_mobi_status()
        cnt = len(features) if features else 0
        log_data_source_update("shared_bikes", f"Mobi 共享單車 ({mode_text})", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_shared_bikes 異常: {e}")
        log_data_source_update("shared_bikes", f"Mobi 共享單車 ({mode_text})", None, target_file, file_path, error=e)
        return 0


def refresh_escooter(full: bool = True) -> int:
    """更新 Lime 共享滑板車站點與即時可用車況 (full=True 為每月全量站點結構，full=False 為每小時即時車況)"""
    file_path = "backend/scripts/layers/update_escooter.py"
    target_file = "vancouver_escooter.geojson"
    mode_text = "每月全量站點" if full else "每小時即時車況"
    try:
        from update_escooter import update_escooter_stations, update_escooter_status
        if full:
            features = update_escooter_stations()
        else:
            features = update_escooter_status()
        cnt = len(features) if features else 0
        log_data_source_update("escooter", f"Lime 共享滑板車 ({mode_text})", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_escooter 異常: {e}")
        log_data_source_update("escooter", f"Lime 共享滑板車 ({mode_text})", None, target_file, file_path, error=e)
        return 0


def refresh_311(target_count: int = 1000) -> int:
    """更新溫哥華 3-1-1 市政服務請求最新工單"""
    file_path = "backend/scripts/layers/update_311.py"
    target_file = "vancouver_311.json"
    try:
        from update_311 import update_311
        data = update_311(target_count=target_count)
        cnt = len(data["results"]) if isinstance(data, dict) and "results" in data else 0
        log_data_source_update("service_requests_311", "3-1-1 市政服務請求", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_311 異常: {e}")
        log_data_source_update("service_requests_311", "3-1-1 市政服務請求", None, target_file, file_path, error=e)
        return 0


def refresh_food_vendors() -> int:
    """更新市區街頭熟食餐車 (StreetFoodApp)"""
    file_path = "backend/scripts/layers/update_food_vendors.py"
    target_file = "vancouver_food_vendors.geojson"
    try:
        from update_food_vendors import update_food_vendors
        features = update_food_vendors()
        cnt = len(features) if features else 0
        log_data_source_update("food_vendors", "街頭熟食餐車", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_food_vendors 異常: {e}")
        log_data_source_update("food_vendors", "街頭熟食餐車", None, target_file, file_path, error=e)
        return 0


def refresh_yvr_news() -> int:
    """更新 YVR 機場官方最新要聞 RSS"""
    file_path = "backend/yvr_airport_service.py"
    target_file = "yvr_news_rss.json"
    try:
        import yvr_airport_service
        items = yvr_airport_service.fetch_yvr_news_rss(force_refresh=True)
        cnt = len(items) if items else 0
        log_data_source_update("yvr_news_rss", "YVR 機場官方最新要聞", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_yvr_news 異常: {e}")
        log_data_source_update("yvr_news_rss", "YVR 機場官方最新要聞", None, target_file, file_path, error=e)
        return 0


def refresh_bchydro_outages(outage_type: str = "all") -> int:
    """更新 BC Hydro 卑詩水電局停電資料 (現正停電、恢復供電、預期停電)"""
    file_path = "backend/scripts/layers/update_bchydro_outages.py"
    try:
        from update_bchydro_outages import update_current_outages, update_restored_outages, update_planned_outages
        total_cnt = 0
        if outage_type in ("all", "current"):
            res_c = update_current_outages()
            cnt_c = res_c.get("count", 0) if isinstance(res_c, dict) else 0
            total_cnt += cnt_c
            log_data_source_update("bchydro_current", "BC Hydro 現正停電與警報", cnt_c, "bchydro_outages_current.json", file_path)
        if outage_type in ("all", "restored"):
            res_r = update_restored_outages()
            cnt_r = res_r.get("count", 0) if isinstance(res_r, dict) else 0
            total_cnt += cnt_r
            log_data_source_update("bchydro_restored", "BC Hydro 恢復供電 (14天)", cnt_r, "bchydro_outages_restored.json", file_path)
        if outage_type in ("all", "planned"):
            res_p = update_planned_outages()
            cnt_p = res_p.get("count", 0) if isinstance(res_p, dict) else 0
            total_cnt += cnt_p
            log_data_source_update("bchydro_planned", "BC Hydro 預期停電", cnt_p, "bchydro_outages_planned.json", file_path)
        return total_cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_bchydro_outages 異常: {e}")
        log_data_source_update("bchydro_current", "BC Hydro 停電資料", None, "bchydro_outages_current.json", file_path, error=e)
        return 0


def _refresh_mv_utility_layer(source_id: str, source_name: str, updater_fn, target_file: str) -> int:
    """Shared OCI updater wrapper for Metro Vancouver water & sewer infrastructure layers."""
    file_path = "backend/scripts/layers/update_mv_utilities.py"
    try:
        cnt = updater_fn()
        log_data_source_update(source_id, source_name, cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] {source_id} 更新異常: {e}")
        log_data_source_update(source_id, source_name, None, target_file, file_path, error=e)
        return 0


def refresh_water_supply() -> int:
    """每 1 小時刷新大溫哥華區域供水系統設施點位 (Metro Vancouver Water Supply)."""
    from scripts.layers.update_mv_utilities import update_water_supply
    return _refresh_mv_utility_layer(
        "water_supply", "Metro Vancouver 供水系統設施", update_water_supply, "vancouver_water_supply.geojson"
    )


def refresh_sewer_system() -> int:
    """每 1 小時刷新大溫哥華區域污水與排水系統設施點位 (Metro Vancouver Sewerage)."""
    from scripts.layers.update_mv_utilities import update_sewer_system
    return _refresh_mv_utility_layer(
        "sewer_system", "Metro Vancouver 污水系統設施", update_sewer_system, "vancouver_sewer_system.geojson"
    )


def refresh_yvr_indoor() -> int:
    """每日 1 次刷新 YVR 機場內部地圖設施與樓層資訊 (經 map.yvr.ca 動態解析 LocusLabs pois-3.0-yvr.json)."""
    file_path = "backend/scripts/layers/update_yvr_indoor.py"
    try:
        from scripts.layers.update_yvr_indoor import fetch_and_save_yvr_indoor
        cnt = fetch_and_save_yvr_indoor()
        log_data_source_update("yvr_indoor", "YVR 機場內部地圖", cnt, "yvr_indoor_pois.json", file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_yvr_indoor 異常: {e}")
        log_data_source_update("yvr_indoor", "YVR 機場內部地圖", None, "yvr_indoor_pois.json", file_path, error=e)
        return 0


def refresh_air_quality() -> int:
    """每 24 小時刷新 Metro Vancouver 空氣質素健康指數 (AQHI) 區塊圖層"""
    file_path = "backend/scripts/layers/update_air_quality.py"
    target_file = "vancouver_air_quality.geojson"
    try:
        from update_air_quality import update_air_quality
        features = update_air_quality()
        cnt = len(features) if features else 0
        log_data_source_update("air_quality", "Metro Vancouver 空氣質素健康指數圖層", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_air_quality 異常: {e}")
        log_data_source_update("air_quality", "Metro Vancouver 空氣質素健康指數圖層", None, target_file, file_path, error=e)
        return 0


def refresh_wildfire() -> int:
    """每 24 小時刷新 BC Wildfire Service 山火通報與火災危險等級圖層"""
    file_path = "backend/scripts/layers/update_wildfire.py"
    target_file = "vancouver_wildfire.geojson"
    try:
        from update_wildfire import update_wildfire
        features = update_wildfire()
        cnt = len(features) if features is not None else 0
        log_data_source_update("wildfire", "BC Wildfire Service 山火通報與火災危險等級", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_wildfire 異常: {e}")
        log_data_source_update("wildfire", "BC Wildfire Service 山火通報與火災危險等級", None, target_file, file_path, error=e)
        return 0


def refresh_business_licences(target_count: int = 1000) -> int:
    """每 24 小時刷新溫哥華市政府商業牌照 (Business Licences) 最新快取"""
    file_path = "backend/scripts/layers/update_business_licences.py"
    target_file = "vancouver_business_licences.json"
    try:
        from update_business_licences import update_business_licences
        data = update_business_licences(target_count=target_count)
        cnt = len(data["results"]) if isinstance(data, dict) and "results" in data else 0
        log_data_source_update("business_licences", "溫哥華商業牌照 (Business Licences)", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_business_licences 異常: {e}")
        log_data_source_update("business_licences", "溫哥華商業牌照 (Business Licences)", None, target_file, file_path, error=e)
        return 0


def refresh_building_permits(target_count: int = 1000) -> int:
    """每 24 小時刷新溫哥華市政府已簽發建築許可 (Issued Building Permits) 最新快取"""
    file_path = "backend/scripts/layers/update_building_permits.py"
    target_file = "vancouver_building_permits.json"
    try:
        from update_building_permits import update_building_permits
        data = update_building_permits(target_count=target_count)
        cnt = len(data["results"]) if isinstance(data, dict) and "results" in data else 0
        log_data_source_update("building_permits", "溫哥華建築許可 (Building Permits)", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_building_permits 異常: {e}")
        log_data_source_update("building_permits", "溫哥華建築許可 (Building Permits)", None, target_file, file_path, error=e)
        return 0


_flo_ev_task: Optional[asyncio.Future[Any]] = None
_flo_fast_task: Optional[asyncio.Future[Any]] = None
_cp_ev_task: Optional[asyncio.Future[Any]] = None
_cp_fast_task: Optional[asyncio.Future[Any]] = None


def refresh_flo_ev() -> int:
    """每 1 小時刷新 FLO 電動車充電站詳細費率與即時可用狀態 (API2 + API1 同步)"""
    file_path = "backend/scripts/layers/update_flo_ev.py"
    target_file = "flo_ev_live_cache.json"
    try:
        from update_flo_ev import refresh_flo_api2
        features = refresh_flo_api2(update_admin_meta=True)
        cnt = len(features) if features else 0
        log_data_source_update("ev_charging_flo", "FLO 電動車充電站即時狀態 (API2)", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_flo_ev 異常: {e}")
        log_data_source_update("ev_charging_flo", "FLO 電動車充電站即時狀態 (API2)", None, target_file, file_path, error=e)
        return 0


def refresh_flo_ev_fast() -> int:
    """高頻輕量 (~3.5s) FLO API1 即時狀態校對，消弭站點 Available / InUse 顯示延遲"""
    try:
        from update_flo_ev import sync_flo_live_statuses_fast
        features = sync_flo_live_statuses_fast(update_admin_meta=True)
        return len(features) if features else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_flo_ev_fast 異常: {e}")
        return 0


def refresh_chargepoint_ev() -> int:
    """每 1 小時刷新 ChargePoint 電動車充電站詳細費率與即時可用狀態 (API2 + API1 同步)"""
    file_path = "backend/scripts/layers/update_chargepoint_ev.py"
    target_file = "chargepoint_ev_live_cache.json"
    try:
        from update_chargepoint_ev import refresh_chargepoint_api2
        features = refresh_chargepoint_api2(update_admin_meta=True)
        cnt = len(features) if features else 0
        log_data_source_update("ev_charging_chargepoint", "ChargePoint 電動車充電站即時狀態 (API2)", cnt, target_file, file_path)
        return cnt
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_chargepoint_ev 異常: {e}")
        log_data_source_update("ev_charging_chargepoint", "ChargePoint 電動車充電站即時狀態 (API2)", None, target_file, file_path, error=e)
        return 0


def refresh_chargepoint_ev_fast() -> int:
    """高頻輕量 (~2s) ChargePoint API1 即時狀態校對，消弭站點 Available / In Use 顯示延遲"""
    try:
        from update_chargepoint_ev import sync_chargepoint_live_statuses_fast
        features = sync_chargepoint_live_statuses_fast(update_admin_meta=True)
        return len(features) if features else 0
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] refresh_chargepoint_ev_fast 異常: {e}")
        return 0


def _schedule_flo_ev_background(loop: asyncio.AbstractEventLoop) -> None:
    """Launch FLO API2 hydration asynchronously so hourly rate-limit waits never stall other live layers."""
    global _flo_ev_task
    if _flo_ev_task is not None and not _flo_ev_task.done():
        print("⏳ [Dynamic Layers] FLO 充電站 (API2) 背景更新仍在執行中，略過重複排程。")
        return
    _flo_ev_task = loop.run_in_executor(None, refresh_flo_ev)


def _schedule_flo_fast_background(loop: asyncio.AbstractEventLoop) -> None:
    """Launch fast ~3.5s FLO API1 status sync asynchronously unless API2 or fast sync is already active."""
    global _flo_fast_task
    if _flo_ev_task is not None and not _flo_ev_task.done():
        return
    if _flo_fast_task is not None and not _flo_fast_task.done():
        return
    _flo_fast_task = loop.run_in_executor(None, refresh_flo_ev_fast)


def _schedule_cp_ev_background(loop: asyncio.AbstractEventLoop) -> None:
    """Launch ChargePoint API2 hydration asynchronously."""
    global _cp_ev_task
    if _cp_ev_task is not None and not _cp_ev_task.done():
        print("⏳ [Dynamic Layers] ChargePoint 充電站 (API2) 背景更新仍在執行中，略過重複排程。")
        return
    _cp_ev_task = loop.run_in_executor(None, refresh_chargepoint_ev)


def _schedule_cp_fast_background(loop: asyncio.AbstractEventLoop) -> None:
    """Launch fast ~2s ChargePoint API1 status sync asynchronously."""
    global _cp_fast_task
    if _cp_ev_task is not None and not _cp_ev_task.done():
        return
    if _cp_fast_task is not None and not _cp_fast_task.done():
        return
    _cp_fast_task = loop.run_in_executor(None, refresh_chargepoint_ev_fast)


async def run_dynamic_layers_background_loop():
    """
    OCI 常駐後台背景更新排程 (動態圖層與高頻資料):
    - shared_bikes (Mobi 共享單車): 每 1 小時 (3600s)
    - escooter (Lime 共享滑板車): 每 1 小時 (3600s)
    - service_requests_311 (3-1-1 市政工單): 每 12 小時 (43200s)
    - food_vendors (街頭熟食餐車): 每 24 小時 (86400s)
    - bchydro_* (BC Hydro 停電): 每 1 小時 (3600s)
    - water_supply / sewer_system (大溫供水與污水設施): 每 1 小時 (3600s)
    - yvr_indoor (YVR 機場內部地圖): 每日 1 次 (86400s)
    - air_quality (大溫空氣質素健康指數 AQHI 區塊): 每 24 小時 (86400s)
    - ev_charging_flo (FLO 充電站即時狀態 API2): 每 1 小時 (3600s)
    - ev_charging_chargepoint (ChargePoint 充電站即時狀態 API2): 每 1 小時 (3600s)
    """
    print("🚲🛴🍔💧 [Dynamic Layers Service] 常駐快取排程服務啟動 (單車/滑板車/停電/供水污水 每小時, 3-1-1 每 12 小時, 餐車/YVR 內部地圖每日)...")
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
        if not _is_layer_recent("bchydro_outages_current.json", 3600):
            print("⚡ [Dynamic Layers] 初始預熱 BC Hydro 停電即時數據...")
            await loop.run_in_executor(None, refresh_bchydro_outages, "all")
        if not _is_layer_recent("vancouver_water_supply.geojson", 3600):
            print("🚰 [Dynamic Layers] 初始預熱 Metro Vancouver 供水系統設施...")
            await loop.run_in_executor(None, refresh_water_supply)
        if not _is_layer_recent("vancouver_sewer_system.geojson", 3600):
            print("💧 [Dynamic Layers] 初始預熱 Metro Vancouver 污水系統設施...")
            await loop.run_in_executor(None, refresh_sewer_system)
        if not _is_layer_recent("yvr_indoor_pois.json", 86400):
            print("🗺️ [Dynamic Layers] 初始預熱 YVR 機場內部地圖數據...")
            await loop.run_in_executor(None, refresh_yvr_indoor)
        if not _is_layer_recent("vancouver_air_quality.geojson", 86400):
            print("🌬️ [Dynamic Layers] 初始預熱大溫空氣質素 (AQHI) 區塊圖層...")
            await loop.run_in_executor(None, refresh_air_quality)
        if not _is_layer_recent("vancouver_wildfire.geojson", 86400):
            print("🔥 [Dynamic Layers] 初始預熱 BC 山火通報與火災危險等級圖層...")
            await loop.run_in_executor(None, refresh_wildfire)
        if not _is_layer_recent("vancouver_business_licences.json", 86400):
            print("🏢 [Dynamic Layers] 初始預熱溫哥華商業牌照 (Business Licences) 快取...")
            await loop.run_in_executor(None, refresh_business_licences, 1000)
        if not _is_layer_recent("vancouver_building_permits.json", 86400):
            print("🔨 [Dynamic Layers] 初始預熱溫哥華建築許可 (Building Permits) 快取...")
            await loop.run_in_executor(None, refresh_building_permits, 1000)
        if not _is_layer_recent("flo_ev_live_cache.json", 3600):
            print("⚡ [Dynamic Layers] 初始預熱 FLO 電動車充電站即時可用狀態 (API2 背景執行)...")
            _schedule_flo_ev_background(loop)
        elif not _is_layer_recent("flo_ev_live_cache.json", 180):
            print("⚡ [Dynamic Layers] 初始快速校對 FLO 即時充電狀態 (API1)...")
            _schedule_flo_fast_background(loop)
        if not _is_layer_recent("chargepoint_ev_live_cache.json", 3600):
            print("⚡ [Dynamic Layers] 初始預熱 ChargePoint 電動車充電站即時可用狀態 (API2 背景執行)...")
            _schedule_cp_ev_background(loop)
        elif not _is_layer_recent("chargepoint_ev_live_cache.json", 180):
            print("⚡ [Dynamic Layers] 初始快速校對 ChargePoint 即時充電狀態 (API1)...")
            _schedule_cp_fast_background(loop)
    except Exception as e:
        print(f"⚠️ [Dynamic Layers] 初始預熱異常: {e}")

    last_bike_time = time.time()
    last_scooter_time = time.time()
    last_monthly_bikes_time = time.time()
    last_monthly_scooter_time = time.time()
    last_311_time = time.time()
    last_food_time = time.time()
    last_bchydro_time = time.time()
    last_mv_utilities_time = time.time()
    last_yvr_indoor_time = time.time()
    last_air_quality_time = time.time()
    last_wildfire_time = time.time()
    last_business_licences_time = time.time()
    last_building_permits_time = time.time()
    last_flo_ev_time = time.time()
    last_flo_fast_time = time.time()
    last_cp_ev_time = time.time()
    last_cp_fast_time = time.time()

    while True:
        try:
            await asyncio.sleep(60)  # 每分鐘心跳檢查
            now = time.time()

            # 1. 共享單車 (每 3600 秒更新即時車位；每 30 天自動觸發全量站點位置與名稱同步)
            if now - last_bike_time >= 3600:
                last_bike_time = now
                need_monthly_bikes = (now - last_monthly_bikes_time >= 30 * 86400)
                if need_monthly_bikes:
                    last_monthly_bikes_time = now
                    print("🚲 [Dynamic Layers] 觸發排程: Mobi 共享單車每月全量站點同步 (full=True)...")
                    await loop.run_in_executor(None, refresh_shared_bikes, True)
                else:
                    print("🚲 [Dynamic Layers] 觸發排程: Mobi 共享單車每小時即時車況更新 (full=False)...")
                    await loop.run_in_executor(None, refresh_shared_bikes, False)

            # 2. 共享滑板車 (每 3600 秒更新即時可用車況；每 30 天自動觸發全量站點位置與名稱同步)
            if now - last_scooter_time >= 3600:
                last_scooter_time = now
                need_monthly_scooter = (now - last_monthly_scooter_time >= 30 * 86400)
                if need_monthly_scooter:
                    last_monthly_scooter_time = now
                    print("🛴 [Dynamic Layers] 觸發排程: Lime 共享滑板車每月全量站點同步 (full=True)...")
                    await loop.run_in_executor(None, refresh_escooter, True)
                else:
                    print("🛴 [Dynamic Layers] 觸發排程: Lime 共享滑板車每小時即時狀態更新 (full=False)...")
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

            # 5. BC Hydro 停電即時數據 (每 3600 秒 = 1 小時)
            if now - last_bchydro_time >= 3600:
                last_bchydro_time = now
                print("⚡ [Dynamic Layers] 觸發排程: BC Hydro 停電即時數據同步 (Current, Restored, Planned)...")
                await loop.run_in_executor(None, refresh_bchydro_outages, "all")

            # 6. Metro Vancouver 供水與污水系統設施 (每 3600 秒 = 1 小時)
            if now - last_mv_utilities_time >= 3600:
                last_mv_utilities_time = now
                print("🚰💧 [Dynamic Layers] 觸發排程: Metro Vancouver 供水與污水系統設施每小時同步...")
                await loop.run_in_executor(None, refresh_water_supply)
                await loop.run_in_executor(None, refresh_sewer_system)

            # 7. YVR 機場內部地圖設施與樓層資訊 (每 86400 秒 = 每日 1 次)
            if now - last_yvr_indoor_time >= 86400:
                last_yvr_indoor_time = now
                print("🗺️ [Dynamic Layers] 觸發排程: YVR 機場內部地圖數據同步...")
                await loop.run_in_executor(None, refresh_yvr_indoor)

            # 8. Metro Vancouver 空氣質素健康指數 AQHI 區塊 (每 86400 秒 = 每日 1 次)
            if now - last_air_quality_time >= 86400:
                last_air_quality_time = now
                print("🌬️ [Dynamic Layers] 觸發排程: 大溫空氣質素 (AQHI) 區塊圖層 24 小時同步...")
                await loop.run_in_executor(None, refresh_air_quality)

            # 8.2. BC Wildfire Service 山火與火災危險等級 (每 86400 秒 = 每日 1 次)
            if now - last_wildfire_time >= 86400:
                last_wildfire_time = now
                print("🔥 [Dynamic Layers] 觸發排程: BC 山火通報與火災危險等級 24 小時同步...")
                await loop.run_in_executor(None, refresh_wildfire)

            # 8.5. 溫哥華商業牌照與建築許可 (每 86400 秒 = 每日 1 次)
            if now - last_business_licences_time >= 86400:
                last_business_licences_time = now
                print("🏢 [Dynamic Layers] 觸發排程: 溫哥華商業牌照 (Business Licences) 24 小時同步...")
                await loop.run_in_executor(None, refresh_business_licences, 1000)
            if now - last_building_permits_time >= 86400:
                last_building_permits_time = now
                print("🔨 [Dynamic Layers] 觸發排程: 溫哥華建築許可 (Building Permits) 24 小時同步...")
                await loop.run_in_executor(None, refresh_building_permits, 1000)

            # 9. FLO 電動車充電站即時可用狀態 API2 詳細更新 (每 3600 秒) + 輕量 API1 即時狀態校對 (每 180 秒)
            if now - last_flo_ev_time >= 3600:
                last_flo_ev_time = now
                last_flo_fast_time = now
                print("⚡ [Dynamic Layers] 觸發排程: FLO 充電站詳細費率與即時可用狀態 (API2) 每小時背景同步...")
                _schedule_flo_ev_background(loop)
            elif now - last_flo_fast_time >= 180:
                last_flo_fast_time = now
                _schedule_flo_fast_background(loop)

            # 10. ChargePoint 電動車充電站即時可用狀態 API2 詳細更新 (每 3600 秒) + 輕量 API1 即時狀態校對 (每 180 秒)
            if now - last_cp_ev_time >= 3600:
                last_cp_ev_time = now
                last_cp_fast_time = now
                print("⚡ [Dynamic Layers] 觸發排程: ChargePoint 充電站詳細費率與即時可用狀態 (API2) 每小時背景同步...")
                _schedule_cp_ev_background(loop)
            elif now - last_cp_fast_time >= 180:
                last_cp_fast_time = now
                _schedule_cp_fast_background(loop)

        except asyncio.CancelledError:
            print("🛑 [Dynamic Layers Service] 常駐背景排程已停止。")
            break
        except Exception as e:
            print(f"⚠️ [Dynamic Layers Service] 背景排程執行異常: {e}")
