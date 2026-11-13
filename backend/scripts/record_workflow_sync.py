#!/usr/bin/env python3
"""
Record GitHub Actions workflow execution results directly on the OCI VM.
Updates:
1. `backend/data/admin_sources_config.json` (`last_updated`, `record_count`, `status`)
2. `backend/data/admin_schedule_history.json` (persistent audit log, deduplicated by GitHub run ID)
"""

import os
import sys
import json
import time
import argparse
import tempfile
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(BACKEND_DIR, "data")
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "frontend", "public")

CONFIG_FILE = os.path.join(DATA_DIR, "admin_sources_config.json")
HISTORY_FILE = os.path.join(DATA_DIR, "admin_schedule_history.json")
HISTORY_CFG_FILE = os.path.join(DATA_DIR, "schedule_history_config.json")

SOURCE_DATA_FILES = {
    "beach_water": ["vancouver_beach_water.geojson"],
    "impark_parking": ["vancouver_impark.geojson"],
    "schools": ["vancouver_schools.geojson"],
    "libraries": ["vancouver_libraries.geojson"],
    "parks": ["vancouver_parks.geojson"],
    "community_centres": ["vancouver_community_centres.geojson"],
    "public_art": ["vancouver_public_art.geojson"],
    "museums": ["vancouver_museums.geojson"],
    "garbage_collection": ["vancouver_garbage_collection.geojson"],
    "recycling": ["vancouver_recycling.geojson"],
    "homeless_shelters": ["vancouver_homeless_shelters.geojson"],
    "food_banks": ["vancouver_food_banks.geojson"],
    "food_vendors": ["vancouver_food_vendors.geojson"],
    "aed": ["vancouver_aed.geojson"],
    "zoning_districts": ["vancouver_zoning_districts.geojson"],
    "parking_meters": ["vancouver_parking_meters.geojson"],
    "motorcycle_parking": ["vancouver_motorcycle_parking.geojson"],
    "bikeways": ["vancouver_bikeways.geojson"],
    "public_trees": ["vancouver_public_trees.geojson"],
    "fire_hydrants": ["vancouver_fire_hydrants.geojson"],
    "drinking_fountains": ["vancouver_drinking_fountains.geojson"],
    "public_washrooms": ["vancouver_public_washrooms.geojson"],
    "traffic_speed_limits": ["vancouver_traffic_speed_limits.geojson"],
    "traffic_crosswalks": ["vancouver_traffic_crosswalks.geojson"],
    "litter_containers": ["vancouver_litter_containers.geojson"],
    "one_way_streets": ["vancouver_one_way_streets.geojson"],
    "snow_removal_routes": ["vancouver_snow_removal_routes.geojson"],
    "contours": ["vancouver_contours.geojson", "vancouver_contours_10m.geojson"],
    "ev_charging": ["vancouver_ev_charging.geojson"],
    "canada_post": ["vancouver_canada_post.geojson"],
    "property_addresses": ["vancouver_property_addresses_meta.json"],
    "banks": ["vancouver_banks.geojson"],
    "shared_bikes": ["vancouver_shared_bikes.geojson"],
    "escooter": ["vancouver_escooter.geojson"],
    "truck_routes": ["vancouver_truck_routes.geojson"],
    "traffic_signals": ["vancouver_traffic_signals.geojson"],
    "turn_restrictions": ["vancouver_traffic_turn_restrictions.geojson"],
    "service_requests_311": ["vancouver_311.json"],
    "tnt_eflyers": ["tnt_eflyers.json"],
    "vancouver_railways": ["vancouver_railways.geojson"],
    "fedex": ["vancouver_fedex.geojson"],
    "purolator": ["vancouver_purolator.geojson"],
    "vancouver_crashes": ["vancouver_crashes.json"],
}


def _atomic_write_json(path: str, payload) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=parent, prefix=".tmp_sync_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def _extract_record_count(source_id: str) -> int:
    import re
    filenames = SOURCE_DATA_FILES.get(source_id, [])
    for fname in filenames:
        for base_dir in (DATA_DIR, PUBLIC_DIR):
            fpath = os.path.join(base_dir, fname)
            if not os.path.exists(fpath):
                continue
            try:
                fsize = os.path.getsize(fpath)
                with open(fpath, "r", encoding="utf-8") as f:
                    head = f.read(4096)
                m = re.search(r'"total_count"\s*:\s*(\d+)', head)
                if m:
                    cnt = int(m.group(1))
                    if cnt > 0:
                        return cnt
                if fsize > 15 * 1024 * 1024:
                    continue
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    return len(data)
                if isinstance(data, dict):
                    if "features" in data and isinstance(data["features"], list):
                        return len(data["features"])
                    if "results" in data and isinstance(data["results"], list):
                        return len(data["results"])
                    if "data" in data and isinstance(data["data"], dict) and isinstance(data["data"].get("eflyer_list"), list):
                        return len(data["data"]["eflyer_list"])
                    if isinstance(data.get("total_count"), int) and data["total_count"] > 0:
                        return data["total_count"]
            except Exception:
                continue
    return 0


def main():
    parser = argparse.ArgumentParser(description="Record GitHub Actions workflow sync timestamp and audit log.")
    parser.add_argument("--source", required=True, help="Source ID (or comma-separated list of source IDs)")
    parser.add_argument("--workflow", default="", help="Workflow filename (e.g. update-banks.yml)")
    parser.add_argument("--has-changes", default="false", help="Whether git diff detected byte changes")
    parser.add_argument("--run-id", default="", help="GitHub Actions run_id")
    parser.add_argument("--event", default="schedule", help="GitHub Actions event_name")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    has_changes = str(args.has_changes).strip().lower() == "true"
    source_ids = [s.strip() for s in args.source.split(",") if s.strip()]

    cfg = {"sources": [], "logs": []}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"⚠️ Failed to read {CONFIG_FILE}: {e}")
            return

    history = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, list):
                    history = loaded
        except Exception:
            history = []

    existing_ids = {str(item.get("id", "")) for item in history if isinstance(item, dict)}
    cfg_logs = cfg.get("logs", []) if isinstance(cfg.get("logs"), list) else []

    trigger_label = "手動觸發" if args.event == "workflow_dispatch" else "排程自動執行"
    change_note = "已偵測資料異動並同步最新圖資" if has_changes else "資料校驗完成（上游資料無異動，維持最新狀態）"

    updated_any = False
    for sid in source_ids:
        rec_count = _extract_record_count(sid)
        src_name = sid
        runner = "github_actions"
        for src in cfg.get("sources", []):
            if src.get("id") == sid:
                src["last_updated"] = now_iso
                src["status"] = "healthy"
                if src.get("runner") == "github":
                    src["runner"] = "github_actions"
                if rec_count > 0:
                    src["record_count"] = rec_count
                src_name = src.get("name", sid)
                runner = src.get("runner", "github_actions")
                updated_any = True
                break

        log_id = f"gh-run-{args.run_id}-{sid}" if args.run_id else f"gh-sync-{int(time.time()*1000)}-{sid}"
        if log_id not in existing_ids:
            count_note = f"，目前共 {rec_count:,} 筆記錄" if rec_count > 0 else ""
            wf_label = f" [{args.workflow}]" if args.workflow else ""
            entry = {
                "id": log_id,
                "timestamp": now_iso,
                "action": "GITHUB_WORKFLOW_SYNC",
                "source_name": src_name,
                "runner": runner,
                "status": "success",
                "detail": f"GitHub Actions{wf_label} {trigger_label}完成：{change_note}{count_note}。"
            }
            history.insert(0, entry)
            cfg_logs.insert(0, entry)
            existing_ids.add(log_id)

            # 同步寫入系統運作日誌
            try:
                if BACKEND_DIR not in sys.path:
                    sys.path.append(BACKEND_DIR)
                from system_log_service import system_log_service
                system_log_service.add_system_log(
                    level="INFO",
                    file=f".github/workflows/{args.workflow}" if args.workflow else f"backend/scripts/layers/update_{sid}.py",
                    action="GITHUB_WORKFLOW_SYNC",
                    message=f"GitHub Actions [{src_name}] 同步完成：{change_note}{count_note}。",
                    details={
                        "source_id": sid,
                        "source_name": src_name,
                        "count": rec_count,
                        "has_changes": has_changes,
                        "run_id": args.run_id,
                        "workflow": args.workflow
                    }
                )
            except Exception:
                pass

    cfg["logs"] = cfg_logs[:150]
    if updated_any or source_ids:
        _atomic_write_json(CONFIG_FILE, cfg)
        _atomic_write_json(HISTORY_FILE, history[:1000])
        print(f"✅ 已同步更新後台資料源時間戳記與排程日誌: {', '.join(source_ids)} @ {now_iso}")


if __name__ == "__main__":
    main()
