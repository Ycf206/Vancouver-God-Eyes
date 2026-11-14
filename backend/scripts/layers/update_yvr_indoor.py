import os
import re
import sys
import json
import time
import tempfile
from datetime import datetime, timezone
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    FRONTEND_DATA_DIR,
    HEADERS,
    get_source_endpoint_url,
    update_admin_source_metadata,
)

DEFAULT_YVR_MAP_CONFIG_URL = "https://map.yvr.ca/config.json"
LOCUSLABS_MANIFEST_TEMPLATE = "https://a.locuslabs.com/accounts/{account_id}/v5.json"

TERMINAL_ZH_MAP = {
    "yvr-mainterminal": "主客運大樓",
    "yvr-southterminal": "南客運大樓",
}


def format_yvr_floor_id(floor_id: str | None, structures_lookup: dict | None = None) -> str:
    """Format YVR LocusLabs floorId (e.g. yvr-mainterminal-level1 -> Main Terminal - Level 1)."""
    if not floor_id:
        return ""
    raw = str(floor_id).strip()
    if structures_lookup and raw in structures_lookup:
        return structures_lookup[raw]

    parts = raw.split("-")
    # Expected pattern: yvr-<terminal>-<level>
    if len(parts) >= 3 and parts[0].lower() == "yvr":
        term_raw = parts[1].lower()
        lvl_raw = "-".join(parts[2:]).lower()

        term_map = {
            "mainterminal": "Main Terminal",
            "southterminal": "South Terminal",
            "northconcourse": "North Concourse",
        }
        term_label = term_map.get(term_raw)
        if not term_label:
            term_label = re.sub(r"terminal$", " Terminal", parts[1], flags=re.I).title()

        m_lvl = re.match(r"^level(\d+)$", lvl_raw, re.I)
        if m_lvl:
            lvl_label = f"Level {m_lvl.group(1)}"
        else:
            lvl_label = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", "-".join(parts[2:])).replace("-", " ").title()

        return f"{term_label} - {lvl_label}"

    return raw


def _normalize_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    u = str(raw_url).strip()
    if not u:
        return None
    if u.startswith(("http://", "https://", "mailto:", "tel:")):
        return u
    if u.startswith("//"):
        return f"https:{u}"
    return f"https://{u}"


def _convert_bounds_polygon(raw_poly) -> list[list[float]]:
    """Convert LocusLabs boundsPolygon items into GeoJSON [lon, lat] ring coordinates."""
    if not isinstance(raw_poly, list) or not raw_poly:
        return []
    coords: list[list[float]] = []
    for pt in raw_poly:
        lat = lon = None
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            lat, lon = pt[0], pt[1]
        elif isinstance(pt, dict):
            lat = pt.get("lat") if pt.get("lat") is not None else pt.get("latitude")
            lon = pt.get("lng") if pt.get("lng") is not None else pt.get("lon")
            if lon is None:
                lon = pt.get("longitude")
        try:
            f_lat = float(lat)
            f_lon = float(lon)
            if -90 <= f_lat <= 90 and -180 <= f_lon <= 180:
                coords.append([round(f_lon, 7), round(f_lat, 7)])
        except (TypeError, ValueError):
            continue
    if len(coords) >= 3 and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def _atomic_save_json(target_path: str, payload: dict) -> None:
    target_dir = os.path.dirname(target_path)
    os.makedirs(target_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".yvr_indoor_", suffix=".tmp", dir=target_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, target_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _resolve_yvr_feed_urls(session: requests.Session) -> tuple[str, str | None]:
    """
    Resolve dynamic LocusLabs POIs & venueData URLs via https://map.yvr.ca/config.json -> v5.json.
    Falls back cleanly if the admin config already points directly to a pois json URL.
    """
    configured_url = get_source_endpoint_url("yvr_indoor", DEFAULT_YVR_MAP_CONFIG_URL) or DEFAULT_YVR_MAP_CONFIG_URL
    if "pois-3.0-yvr.json" in configured_url or configured_url.rstrip("/").endswith(".json") and "config.json" not in configured_url:
        if "v5.json" not in configured_url:
            return configured_url, None

    account_id = "A1BUZ3C41188B8"
    venue_id = "yvr"
    try:
        resp = session.get(configured_url, timeout=15)
        resp.raise_for_status()
        cfg = resp.json()
        loader = cfg.get("plugins", {}).get("venueDataLoader", {}) if isinstance(cfg, dict) else {}
        if loader.get("accountId"):
            account_id = str(loader["accountId"]).strip()
        if loader.get("venueId"):
            venue_id = str(loader["venueId"]).strip()
    except Exception as e:
        print(f"⚠️ [YVR Indoor] 讀取 map.yvr.ca config.json 失敗，使用預設 accountId/venueId: {e}")

    manifest_url = LOCUSLABS_MANIFEST_TEMPLATE.format(account_id=account_id)
    man_resp = session.get(manifest_url, timeout=20)
    man_resp.raise_for_status()
    manifest = man_resp.json()
    venue_entry = manifest.get(venue_id) or manifest.get("yvr") or {}
    files = venue_entry.get("files", {}) if isinstance(venue_entry, dict) else {}
    pois_url = files.get("pois")
    venue_data_url = files.get("venueData")
    if not pois_url:
        raise ValueError(f"LocusLabs manifest ({manifest_url}) 缺少 {venue_id}.files.pois")
    return pois_url, venue_data_url


def fetch_and_save_yvr_indoor() -> int:
    session = requests.Session()
    session.headers.update({
        **HEADERS,
        "Referer": "https://map.yvr.ca/",
        "Origin": "https://map.yvr.ca",
        "Accept": "application/json, text/plain, */*",
    })

    pois_url, venue_data_url = _resolve_yvr_feed_urls(session)
    print(f"🗺️ [YVR Indoor] Resolved POIs URL: {pois_url}")

    pois_resp = session.get(pois_url, timeout=30)
    pois_resp.raise_for_status()
    raw_pois_obj = pois_resp.json()

    if isinstance(raw_pois_obj, dict):
        raw_pois = list(raw_pois_obj.values())
    elif isinstance(raw_pois_obj, list):
        raw_pois = raw_pois_obj
    else:
        raw_pois = []

    raw_structures = {}
    if venue_data_url:
        try:
            vd_resp = session.get(venue_data_url, timeout=20)
            vd_resp.raise_for_status()
            vd_json = vd_resp.json()
            if isinstance(vd_json, dict):
                yvr_node = vd_json.get("yvr") if isinstance(vd_json.get("yvr"), dict) else vd_json
                raw_structures = yvr_node.get("structures", {}) or {}
        except Exception as e:
            print(f"⚠️ [YVR Indoor] 讀取 venueData 警告: {e}")

    # Build floor lookup from venueData
    floor_label_lookup: dict[str, str] = {}
    terminal_by_floor: dict[str, str] = {}
    for struct_id, struct_val in raw_structures.items():
        if not isinstance(struct_val, dict):
            continue
        struct_name = str(struct_val.get("name") or struct_id).strip()
        levels = struct_val.get("levels", {}) or {}
        for lvl_id, lvl_val in levels.items():
            if not isinstance(lvl_val, dict):
                continue
            lvl_name = str(lvl_val.get("name") or lvl_id).strip()
            floor_label_lookup[lvl_id] = f"{struct_name} - {lvl_name}"
            terminal_by_floor[lvl_id] = struct_id

    # Normalize POIs
    pois_list = []
    floor_poi_counts: dict[str, int] = {}
    for p in raw_pois:
        if not isinstance(p, dict):
            continue
        pos = p.get("position") or {}
        lat = pos.get("latitude")
        lon = pos.get("longitude")
        try:
            f_lat = float(lat)
            f_lon = float(lon)
        except (TypeError, ValueError):
            continue
        if not (-90 <= f_lat <= 90 and -180 <= f_lon <= 180):
            continue

        floor_id = str(pos.get("floorId") or "").strip()
        if not floor_id:
            continue

        poi_id = str(p.get("poiId") or p.get("id") or f"{floor_id}_{len(pois_list)}").strip()
        name = str(p.get("name") or "").strip()
        if not name:
            continue

        category = str(p.get("category") or "services").strip()
        terminal_id = terminal_by_floor.get(floor_id)
        if not terminal_id:
            parts = floor_id.split("-")
            terminal_id = f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else "yvr-mainterminal"

        floor_label = format_yvr_floor_id(floor_id, floor_label_lookup)

        raw_links = p.get("links") or []
        links = []
        if isinstance(raw_links, list):
            for lk in raw_links:
                if isinstance(lk, dict):
                    norm_u = _normalize_url(lk.get("url"))
                    if norm_u:
                        links.append({
                            "url": norm_u,
                            "type": lk.get("type"),
                            "displayName": lk.get("displayName") or "",
                        })
                elif isinstance(lk, str):
                    norm_u = _normalize_url(lk)
                    if norm_u:
                        links.append({"url": norm_u, "type": "website", "displayName": ""})

        kw_list = []
        for kw in (p.get("keywords") or []):
            if isinstance(kw, dict):
                kw_name = str(kw.get("name") or "").strip()
                if kw_name and not kw_name.startswith("category:") and kw_name != category:
                    if kw_name not in kw_list:
                        kw_list.append(kw_name)
            elif isinstance(kw, str):
                kw_name = kw.strip()
                if kw_name and kw_name not in kw_list:
                    kw_list.append(kw_name)

        phone = str(p.get("phone") or "").strip() or None
        desc = str(p.get("description") or "").strip() or None
        op_hours = p.get("operationHours")
        if isinstance(op_hours, str):
            op_hours = op_hours.strip() or None

        is_after_sec = p.get("isAfterSecurity")
        if isinstance(is_after_sec, str):
            low = is_after_sec.strip().lower()
            if low == "true":
                is_after_sec = True
            elif low == "false":
                is_after_sec = False

        pois_list.append({
            "poiId": poi_id,
            "name": name,
            "category": category,
            "terminalId": terminal_id,
            "floorId": floor_id,
            "floorLabel": floor_label,
            "latitude": round(f_lat, 7),
            "longitude": round(f_lon, 7),
            "operationHours": op_hours if op_hours else None,
            "phone": phone,
            "isAfterSecurity": is_after_sec if isinstance(is_after_sec, bool) else None,
            "description": desc,
            "nearbyLandmark": str(p.get("nearbyLandmark") or "").strip() or None,
            "gate": str(p.get("gate") or "").strip() or None,
            "isNavigable": bool(p.get("isNavigable", True)),
            "links": links,
            "keywords": kw_list[:16],
        })
        floor_poi_counts[floor_id] = floor_poi_counts.get(floor_id, 0) + 1

    # Assemble terminal + level metadata with boundsPolygon
    terminals_out = []
    sorted_struct_items = sorted(
        raw_structures.items(),
        key=lambda kv: (0 if "main" in kv[0].lower() else 1, kv[0]),
    )
    for struct_id, struct_val in sorted_struct_items:
        if not isinstance(struct_val, dict):
            continue
        levels_dict = struct_val.get("levels", {}) or {}
        levels_out = []
        for lvl_id, lvl_val in levels_dict.items():
            if not isinstance(lvl_val, dict):
                continue
            levels_out.append({
                "id": lvl_id,
                "name": str(lvl_val.get("name") or lvl_id).strip(),
                "details": str(lvl_val.get("details") or "").strip(),
                "ordinal": int(lvl_val.get("ordinal") or 0),
                "poiCount": floor_poi_counts.get(lvl_id, 0),
                "boundsPolygon": _convert_bounds_polygon(lvl_val.get("boundsPolygon")),
            })
        if not any(l["poiCount"] > 0 or l["boundsPolygon"] for l in levels_out):
            continue
        levels_out.sort(key=lambda x: (x["ordinal"], x["id"]))
        term_pois = [item for item in pois_list if item["terminalId"] == struct_id]
        centroid = None
        if term_pois:
            avg_lon = sum(item["longitude"] for item in term_pois) / len(term_pois)
            avg_lat = sum(item["latitude"] for item in term_pois) / len(term_pois)
            centroid = [round(avg_lon, 6), round(avg_lat, 6)]
        terminals_out.append({
            "id": struct_id,
            "name": str(struct_val.get("name") or struct_id).strip(),
            "nameZh": TERMINAL_ZH_MAP.get(struct_id, str(struct_val.get("name") or struct_id).strip()),
            "defaultLevelId": struct_val.get("defaultLevelId") or (levels_out[0]["id"] if levels_out else ""),
            "centroid": centroid,
            "levels": levels_out,
        })

    # Fallback if venueData had no structures
    if not terminals_out:
        by_term: dict[str, set[str]] = {}
        for item in pois_list:
            by_term.setdefault(item["terminalId"], set()).add(item["floorId"])
        for tid in sorted(by_term.keys(), key=lambda x: (0 if "main" in x else 1, x)):
            lvls = sorted(by_term[tid])
            terminals_out.append({
                "id": tid,
                "name": "Main Terminal" if "main" in tid else "South Terminal",
                "nameZh": TERMINAL_ZH_MAP.get(tid, tid),
                "defaultLevelId": "yvr-mainterminal-level3" if "main" in tid and "yvr-mainterminal-level3" in lvls else lvls[0],
                "levels": [
                    {
                        "id": lid,
                        "name": format_yvr_floor_id(lid).split(" - ")[-1],
                        "details": "",
                        "ordinal": idx,
                        "poiCount": floor_poi_counts.get(lid, 0),
                        "boundsPolygon": [],
                    }
                    for idx, lid in enumerate(lvls)
                ],
            })

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "updated_at": now_iso,
        "source_pois_url": pois_url,
        "source_venue_url": venue_data_url,
        "total_count": len(pois_list),
        "terminals": terminals_out,
        "pois": pois_list,
    }

    backend_out = os.path.join(BACKEND_DATA_DIR, "yvr_indoor_pois.json")
    _atomic_save_json(backend_out, payload)

    if os.path.exists(os.path.join(os.path.dirname(FRONTEND_DATA_DIR))):
        frontend_out = os.path.join(FRONTEND_DATA_DIR, "yvr_indoor_pois.json")
        _atomic_save_json(frontend_out, payload)

    update_admin_source_metadata("yvr_indoor", record_count=len(pois_list), updated_at=now_iso)
    print(f"💾 [YVR Indoor] 已成功更新並儲存 yvr_indoor_pois.json (共 {len(pois_list)} 筆設施資料)")
    return len(pois_list)


if __name__ == "__main__":
    start_ts = time.time()
    count = fetch_and_save_yvr_indoor()
    elapsed = time.time() - start_ts
    print(f"✅ [YVR Indoor] 任務完成，共寫入 {count} 筆 POI ({elapsed:.2f}s)")
