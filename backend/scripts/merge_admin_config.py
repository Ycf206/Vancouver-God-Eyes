#!/usr/bin/env python3
"""
Merge /tmp/godseye_admin_cfg.bak back into backend/data/admin_sources_config.json during deploy.yml.
Guarantees:
1. Never overwrites a newer `last_updated` timestamp with an older backup timestamp.
2. Preserves runtime secrets (`github_token`, `github_repo`), `enabled`, and `hidden_in_layer_panel`.
3. Synchronizes GitHub Actions `cron_expr` directly from `.github/workflows/*.yml` so repo workflow changes
   are never overwritten by stale VM backup schedules, while preserving custom OCI schedules.
"""

import os
import re
import json
import tempfile
from datetime import datetime, timezone


def _parse_ts(ts_str: str) -> float:
    if not ts_str or not isinstance(ts_str, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(ts_str.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def _max_iso(ts_a: str, ts_b: str) -> str:
    ta = _parse_ts(ts_a)
    tb = _parse_ts(ts_b)
    if tb > ta:
        return ts_b
    return ts_a or ts_b


def _read_workflow_cron(repo_root: str, wf_file: str) -> str:
    if not wf_file:
        return ""
    wf_path = os.path.join(repo_root, ".github", "workflows", wf_file)
    if not os.path.exists(wf_path):
        return ""
    try:
        with open(wf_path, "r", encoding="utf-8") as f:
            raw = f.read()
        m = re.search(r"-\s*cron:\s*['\"]([^'\"]+)['\"]", raw)
        return m.group(1).strip() if m else ""
    except Exception:
        return ""


def _cron_to_interval_zh(cron_expr: str, fallback: str = "") -> str:
    c = (cron_expr or "").strip()
    mapping = {
        "* * * * *": "每 1 分鐘",
        "*/1 * * * *": "每 1 分鐘",
        "*/2 * * * *": "每 2 分鐘",
        "*/5 * * * *": "每 5 分鐘",
        "*/10 * * * *": "每 10 分鐘",
        "*/15 * * * *": "每 15 分鐘",
        "*/30 * * * *": "每 30 分鐘",
        "*/30 * * * * *": "每 30 秒",
        "0 * * * *": "每 1 小時",
        "0 */1 * * *": "每 1 小時",
        "0 */2 * * *": "每 2 小時",
        "0 */6 * * *": "每 6 小時",
        "0 */12 * * *": "每 12 小時",
        "0 0 * * *": "每日 00:00",
        "0 4 * * *": "每日 04:00",
        "0 8 * * *": "每日 08:00",
        "0 0 * * 0": "每週日 00:00",
        "0 9 * * 5": "每週五 09:00",
        "0 0 1 * *": "每月 1 號 00:00",
        "0 3 1 * *": "每月 1 號 03:00",
        "0 4 1 * *": "每月 1 號 04:00",
        "30 4 1 * *": "每月 1 號 04:30",
        "0 0 1 */3 *": "每季 (3 個月)",
        "0 0 1 */6 *": "每半年",
        "0 0 1 1 *": "每年 1 月 1 日",
        "0 4 1 1 *": "每年 1 月 1 日",
    }
    return mapping.get(c, fallback or c)


def merge_admin_config():
    bak_p = "/tmp/godseye_admin_cfg.bak"
    cur_p = "backend/data/admin_sources_config.json"
    repo_root = os.path.abspath(".")

    if os.path.exists(cur_p):
        try:
            with open(cur_p, "r", encoding="utf-8") as f:
                cur = json.load(f)
            bak = {}
            if os.path.exists(bak_p):
                with open(bak_p, "r", encoding="utf-8") as f:
                    bak = json.load(f)

            bak_map = {s.get("id"): s for s in bak.get("sources", []) if isinstance(s, dict) and s.get("id")}
            for s in cur.get("sources", []):
                sid = s.get("id")
                if s.get("runner") == "github":
                    s["runner"] = "github_actions"

                bs = bak_map.get(sid, {})
                if bs:
                    # 永遠保留較新的更新時間，絕不用舊備份覆蓋新時間戳
                    s["last_updated"] = _max_iso(str(s.get("last_updated", "")), str(bs.get("last_updated", "")))
                    if "enabled" in bs:
                        s["enabled"] = bs["enabled"]
                    if "hidden_in_layer_panel" in bs:
                        s["hidden_in_layer_panel"] = bs["hidden_in_layer_panel"]
                    if isinstance(bs.get("record_count"), int) and bs["record_count"] > 0 and _parse_ts(str(bs.get("last_updated", ""))) >= _parse_ts(str(s.get("last_updated", ""))):
                        s["record_count"] = bs["record_count"]
                    if s.get("runner") == "oci":
                        if bs.get("cron_expr"):
                            s["cron_expr"] = bs["cron_expr"]
                        if bs.get("schedule_interval"):
                            s["schedule_interval"] = bs["schedule_interval"]
                    if bs.get("source_url"):
                        s["source_url"] = bs["source_url"]

                # YVR 航班即時同步強制維持每 1 分鐘，且修正舊版誤填 HTML 網頁連結為官方 OData API
                if sid in ("flight_schedules", "yvr_flights"):
                    s["cron_expr"] = "* * * * *"
                    s["schedule_interval"] = "每 1 分鐘"
                    cur_u = str(s.get("source_url") or "").strip()
                    if not cur_u or "/passengers/flights" in cur_u.lower() or ("yvr.ca" in cur_u.lower() and "/_api/" not in cur_u.lower()):
                        s["source_url"] = "https://www.yvr.ca/en/_api/Flights"

                if sid == "fuel_prices":
                    s["cron_expr"] = "* * * * *"
                    s["schedule_interval"] = "每 1 分鐘"

                if sid == "yvr_weathercams":
                    s["cron_expr"] = "0 * * * *"
                    s["schedule_interval"] = "每 1 小時"

                if sid in ("lottery_latest", "lottery"):
                    s["cron_expr"] = "0 */12 * * *"
                    s["schedule_interval"] = "每 12 小時"

                # GitHub Actions 管線強制與實際 .github/workflows/*.yml 的 cron 同步
                if s.get("runner") == "github_actions" and s.get("workflow_file"):
                    wf_cron = _read_workflow_cron(repo_root, s["workflow_file"])
                    if wf_cron:
                        s["cron_expr"] = wf_cron
                        s["schedule_interval"] = _cron_to_interval_zh(wf_cron, s.get("schedule_interval", ""))

            if bak.get("github_token"):
                cur["github_token"] = bak["github_token"]
            if bak.get("github_repo"):
                cur["github_repo"] = bak["github_repo"]
            if bak.get("logs") and not cur.get("logs"):
                cur["logs"] = bak["logs"][:150]

            parent_dir = os.path.dirname(os.path.abspath(cur_p))
            fd, tmp_p = tempfile.mkstemp(prefix=".admin_cfg_", suffix=".tmp", dir=parent_dir)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(cur, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_p, cur_p)
            except Exception:
                try:
                    os.unlink(tmp_p)
                except OSError:
                    pass
                raise
            print("✅ Merged admin_sources_config.json safely without overwriting newer timestamps!")
        except Exception as e:
            print(f"⚠️ Merge admin config warning: {e}")


if __name__ == "__main__":
    merge_admin_config()
