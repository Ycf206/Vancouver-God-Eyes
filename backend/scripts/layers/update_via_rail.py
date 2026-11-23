#!/usr/bin/env python3
"""
VIA Rail Canada Live Trains & Official GTFS Network Updater.

1. Live Trains (`fetch_via_rail_live` - runs every 15 seconds on OCI):
   - Source: https://tsimobile.viarail.ca/data/allData.json
   - Classifies `in_service` strictly as `departed === True and arrived === False`.
   - All other entries are classified under `not_in_service` (for collapsible list in Explore tab).
   - Writes atomically to `backend/data/vancouver_via_rail_live.json`.

2. Official GTFS Routes & Stations (`update_via_rail_network`):
   - Source: https://www.viarail.ca/sites/all/files/gtfs/viarail.zip
   - Extracts `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt`.
   - Generates simplified `via_rail_routes.geojson` & `via_rail_stations.geojson` in both
     `backend/data/` and `frontend/public/` for map display and TopBar station search.
"""

from __future__ import annotations

import csv
import io
import math
import os
import re
import sys
import time
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    atomic_write_json,
    save_layer_geojson,
    update_admin_source_metadata,
)

VIA_LIVE_URL = "https://tsimobile.viarail.ca/data/allData.json"
VIA_GTFS_URL = "https://www.viarail.ca/sites/all/files/gtfs/viarail.zip"
LIVE_OUTPUT_FILENAME = "vancouver_via_rail_live.json"
ROUTES_GEOJSON_FILENAME = "via_rail_routes.geojson"
STATIONS_GEOJSON_FILENAME = "via_rail_stations.geojson"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, */*;q=0.8",
}

_live_session = requests.Session()
_last_admin_meta_ts = 0.0
_ADMIN_META_THROTTLE_SEC = 300.0

MAJOR_VIA_STATION_CODES = {
    "VCVR", "KAMN", "JASP", "EDMO", "SASK", "WNPG", "CHUR", "PRUP",
    "SUDB", "TRTO", "OTTW", "MTRL", "QBEC", "LNDN", "WDON", "SARN",
    "NFLS", "KNGS", "OSHW", "ALDR", "MCTN", "HLFX", "CAMP", "SENN",
}


def _parse_train_sort_key(train_key: str) -> tuple[int, str]:
    m = re.match(r"^\s*(\d+)", str(train_key or ""))
    if m:
        return (int(m.group(1)), str(train_key))
    return (999999, str(train_key or ""))


def _extract_train_number(train_key: str) -> str:
    m = re.match(r"^\s*([A-Za-z0-9-]+)", str(train_key or "").strip())
    return m.group(1) if m else str(train_key or "").strip()


def _safe_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> int | None:
    if val is None or val == "":
        return None
    try:
        return int(round(float(val)))
    except (TypeError, ValueError):
        return None


def _normalize_live_train(train_key: str, raw: dict[str, Any]) -> dict[str, Any]:
    departed = bool(raw.get("departed"))
    arrived = bool(raw.get("arrived"))
    in_service = departed and (not arrived)

    if in_service:
        service_status = "in_service"
    elif arrived:
        service_status = "arrived"
    elif not departed:
        service_status = "scheduled"
    else:
        service_status = "not_in_service"

    lat = _safe_float(raw.get("lat"))
    lng = _safe_float(raw.get("lng"))
    has_gps = bool(
        lat is not None
        and lng is not None
        and not (abs(lat) < 0.001 and abs(lng) < 0.001)
        and (-90.0 <= lat <= 90.0)
        and (-180.0 <= lng <= 180.0)
    )

    speed = _safe_float(raw.get("speed"))
    direction = _safe_float(raw.get("direction"))
    if direction is not None:
        direction = round(direction % 360.0, 2)

    raw_times = raw.get("times") if isinstance(raw.get("times"), list) else []
    times_clean: list[dict[str, Any]] = []
    next_stop: dict[str, Any] | None = None
    last_stop: dict[str, Any] | None = None
    stops_completed = 0

    for idx, st in enumerate(raw_times):
        if not isinstance(st, dict):
            continue
        eta_val = str(st.get("eta") or "").strip()
        is_arr = eta_val.upper() == "ARR"
        if is_arr:
            stops_completed += 1

        arr_obj = st.get("arrival") if isinstance(st.get("arrival"), dict) else {}
        dep_obj = st.get("departure") if isinstance(st.get("departure"), dict) else {}
        plat_obj = st.get("platform") if isinstance(st.get("platform"), dict) else {}

        stop_item = {
            "seq": idx + 1,
            "station": str(st.get("station") or "").strip(),
            "code": str(st.get("code") or "").strip().upper(),
            "tz": str(st.get("tz") or "").strip(),
            "scheduled": str(st.get("scheduled") or "").strip() or None,
            "estimated": str(st.get("estimated") or "").strip() or None,
            "eta": eta_val or None,
            "diff": str(st.get("diff") or "").strip() or None,
            "diff_min": _safe_int(st.get("diffMin")),
            "arrival_scheduled": str(arr_obj.get("scheduled") or "").strip() or None,
            "arrival_estimated": str(arr_obj.get("estimated") or "").strip() or None,
            "departure_scheduled": str(dep_obj.get("scheduled") or "").strip() or None,
            "departure_estimated": str(dep_obj.get("estimated") or "").strip() or None,
            "platform": str(plat_obj.get("code") or "").strip() or None,
            "arrived": is_arr,
        }
        times_clean.append(stop_item)
        if is_arr:
            last_stop = stop_item
        elif next_stop is None:
            next_stop = stop_item

    # Determine effective delay minutes & status
    delay_src = next_stop or last_stop or (times_clean[-1] if times_clean else None)
    delay_min = delay_src.get("diff_min") if delay_src else None
    delay_status = delay_src.get("diff") if delay_src else None

    alerts_clean: list[dict[str, str]] = []
    for al in (raw.get("alerts") or []):
        if not isinstance(al, dict):
            continue
        hdr = al.get("header")
        desc = al.get("description")
        hdr_en = hdr.get("en", "") if isinstance(hdr, dict) else str(hdr or "")
        desc_en = desc.get("en", "") if isinstance(desc, dict) else str(desc or "")
        if hdr_en or desc_en:
            alerts_clean.append({"header": hdr_en.strip(), "description": desc_en.strip()})

    return {
        "id": str(train_key).strip(),
        "train_number": _extract_train_number(train_key),
        "instance": str(raw.get("instance") or "").strip(),
        "from": str(raw.get("from") or "").strip(),
        "to": str(raw.get("to") or "").strip(),
        "departed": departed,
        "arrived": arrived,
        "in_service": in_service,
        "service_status": service_status,
        "has_gps": has_gps,
        "lat": round(lat, 6) if has_gps and lat is not None else None,
        "lng": round(lng, 6) if has_gps and lng is not None else None,
        "speed": round(speed, 1) if speed is not None else None,
        "direction": direction,
        "poll": str(raw.get("poll") or "").strip() or None,
        "poll_min": _safe_int(raw.get("pollMin")),
        "delay_min": delay_min,
        "delay_status": delay_status,
        "stops_completed": stops_completed,
        "stops_total": len(times_clean),
        "last_stop": last_stop,
        "next_stop": next_stop,
        "alerts": alerts_clean,
        "times": times_clean,
    }


def fetch_via_rail_live(update_admin_meta: bool = True, force_admin_meta: bool = False) -> dict[str, Any]:
    """Fetch live VIA Rail train telemetry every 15s and write atomic JSON cache."""
    global _last_admin_meta_ts
    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    out_path = os.path.join(BACKEND_DATA_DIR, LIVE_OUTPUT_FILENAME)

    try:
        resp = _live_session.get(VIA_LIVE_URL, headers=HEADERS, timeout=12)
        if resp.status_code != 200:
            raise RuntimeError(f"VIA Rail API HTTP {resp.status_code}")
        raw_data = resp.json()
        if not isinstance(raw_data, dict):
            raise RuntimeError("VIA Rail API payload is not a JSON object")
    except Exception as exc:
        print(f"⚠️ [VIA Rail] 即時列車同步失敗: {exc}")
        if os.path.exists(out_path):
            try:
                import json
                with open(out_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "status": "error",
            "error": str(exc),
            "updated_at": now_iso,
            "total_count": 0,
            "in_service_count": 0,
            "in_service_gps_count": 0,
            "not_in_service_count": 0,
            "in_service": [],
            "not_in_service": [],
        }

    in_service: list[dict[str, Any]] = []
    not_in_service: list[dict[str, Any]] = []

    for train_key, raw_obj in raw_data.items():
        if not isinstance(raw_obj, dict):
            continue
        item = _normalize_live_train(str(train_key), raw_obj)
        if item["in_service"]:
            in_service.append(item)
        else:
            not_in_service.append(item)

    in_service.sort(key=lambda t: _parse_train_sort_key(t["id"]))
    not_in_service.sort(key=lambda t: (0 if t["service_status"] == "scheduled" else 1, _parse_train_sort_key(t["id"])))

    in_service_gps_count = sum(1 for t in in_service if t["has_gps"])
    payload = {
        "status": "ok",
        "error": None,
        "source": "VIA Rail Canada Live Train Tracker (tsimobile.viarail.ca)",
        "updated_at": now_iso,
        "total_count": len(in_service) + len(not_in_service),
        "in_service_count": len(in_service),
        "in_service_gps_count": in_service_gps_count,
        "not_in_service_count": len(not_in_service),
        "in_service": in_service,
        "not_in_service": not_in_service,
    }

    os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
    atomic_write_json(out_path, payload, indent=None, separators=(",", ":"), prefix=".tmp_via_live_", suffix=".json")

    now_ts = time.time()
    if update_admin_meta and (force_admin_meta or (now_ts - _last_admin_meta_ts >= _ADMIN_META_THROTTLE_SEC)):
        _last_admin_meta_ts = now_ts
        try:
            update_admin_source_metadata("via_rail", record_count=len(in_service), updated_at=now_iso)
        except Exception:
            pass

    return payload


# ===================== Official GTFS Network (Routes + Stations) =====================

def _point_line_dist_sq(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    if dx == 0.0 and dy == 0.0:
        return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    proj_x = a[0] + t * dx
    proj_y = a[1] + t * dy
    return (p[0] - proj_x) ** 2 + (p[1] - proj_y) ** 2


def _simplify_rdp(coords: list[tuple[float, float]], eps: float = 0.0006) -> list[list[float]]:
    """Iterative Ramer-Douglas-Peucker simplification for crisp lightweight Canada rail lines."""
    n = len(coords)
    if n <= 2:
        return [[round(x, 5), round(y, 5)] for x, y in coords]
    eps_sq = eps * eps
    keep = bytearray(n)
    keep[0] = 1
    keep[n - 1] = 1
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        max_d = -1.0
        idx = -1
        a = coords[start]
        b = coords[end]
        for i in range(start + 1, end):
            d = _point_line_dist_sq(coords[i], a, b)
            if d > max_d:
                max_d = d
                idx = i
        if max_d > eps_sq and idx != -1:
            keep[idx] = 1
            stack.append((start, idx))
            stack.append((idx, end))
    return [[round(coords[i][0], 5), round(coords[i][1], 5)] for i in range(n) if keep[i]]


def _infer_province_zh(lat: float, lon: float, tz: str) -> str:
    if tz == "America/Vancouver" or lon < -120.0:
        return "BC 卑詩省"
    if tz == "America/Edmonton" or (-120.0 <= lon < -110.0):
        return "AB 亞伯達省"
    if tz == "America/Regina" or (-110.0 <= lon < -101.5):
        return "SK 薩省"
    if tz == "America/Winnipeg" or (-101.5 <= lon < -95.15):
        return "MB 曼省"
    if tz == "America/Halifax" or tz == "America/Moncton" or lon > -66.5:
        if lat < 45.9 and lon > -64.5:
            return "NS 新斯科細亞省"
        return "NB 新布藍茲維省"
    if lon > -74.5:
        return "QC 魁北克省"
    return "ON 安大略省"


def _is_us_amtrak_partner_stop(lat: float, lon: float, tz: str, name: str = "") -> bool:
    """Exclude US-only Amtrak partner stations (e.g. New York, Albany, Yonkers, Buffalo)."""
    us_names = {
        "new york", "yonkers", "croton-harmon", "poughkeepsie", "rhinecliff",
        "hudson", "albany-rensselaer", "schenectady", "amsterdam", "utica",
        "rome", "syracuse", "rochester", "buffalo", "niagara falls (ny)",
    }
    if name.strip().lower() in us_names:
        return True
    if tz == "America/New_York" and not ("niagara falls" in name.strip().lower() and lon < -79.05):
        return True
    if lat < 41.6:
        return True
    return False


def update_via_rail_network() -> dict[str, int]:
    """Download official VIA Rail GTFS zip and build via_rail_routes.geojson + via_rail_stations.geojson."""
    print(f"🚆 正在下載 VIA Rail 官方 GTFS ({VIA_GTFS_URL}) 建立全加拿大鐵路路線與車站圖資...")
    resp = requests.get(VIA_GTFS_URL, headers=HEADERS, timeout=45)
    resp.raise_for_status()

    zf = zipfile.ZipFile(io.BytesIO(resp.content))

    def _read_csv(name: str) -> list[dict[str, str]]:
        with zf.open(name) as f:
            text = io.TextIOWrapper(f, encoding="utf-8-sig")
            return list(csv.DictReader(text))

    routes_rows = _read_csv("routes.txt")
    trips_rows = _read_csv("trips.txt")
    stops_rows = _read_csv("stops.txt")
    stop_times_rows = _read_csv("stop_times.txt")
    shapes_rows = _read_csv("shapes.txt")

    route_info: dict[str, dict[str, str]] = {}
    for r in routes_rows:
        rid = (r.get("route_id") or "").strip()
        if rid:
            route_info[rid] = {
                "route_id": rid,
                "name": (r.get("route_long_name") or r.get("route_short_name") or rid).strip(),
                "color": "#" + (r.get("route_color") or "FFCB06").strip().lstrip("#"),
            }

    trip_to_route: dict[str, str] = {}
    route_to_shapes: dict[str, set[str]] = defaultdict(set)
    for tr in trips_rows:
        tid = (tr.get("trip_id") or "").strip()
        rid = (tr.get("route_id") or "").strip()
        shid = (tr.get("shape_id") or "").strip()
        if tid and rid:
            trip_to_route[tid] = rid
        if rid and shid:
            route_to_shapes[rid].add(shid)

    stop_to_routes: dict[str, set[str]] = defaultdict(set)
    for st in stop_times_rows:
        tid = (st.get("trip_id") or "").strip()
        sid = (st.get("stop_id") or "").strip()
        rid = trip_to_route.get(tid)
        if sid and rid and rid in route_info:
            stop_to_routes[sid].add(route_info[rid]["name"])

    # Build shape coordinate sequences
    shape_pts: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for sh in shapes_rows:
        shid = (sh.get("shape_id") or "").strip()
        lat = _safe_float(sh.get("shape_pt_lat"))
        lon = _safe_float(sh.get("shape_pt_lon"))
        seq = _safe_int(sh.get("shape_pt_sequence"))
        if shid and lat is not None and lon is not None and seq is not None:
            shape_pts[shid].append((seq, lon, lat))

    # Build route features (pick the longest shape per unique route_id, clipping US-only Maple Leaf tail)
    route_features: list[dict[str, Any]] = []
    seen_route_names: set[str] = set()
    for rid, rmeta in route_info.items():
        rname = rmeta["name"]
        if "new york" in rname.lower():
            continue
        cand_shapes = list(route_to_shapes.get(rid) or [])
        if not cand_shapes:
            continue
        # Pick shape with most points (fullest corridor coverage)
        best_shid = max(cand_shapes, key=lambda s: len(shape_pts.get(s) or []))
        pts_sorted = sorted(shape_pts.get(best_shid) or [], key=lambda x: x[0])
        if len(pts_sorted) < 2:
            continue
        raw_coords = [(lon, lat) for _, lon, lat in pts_sorted]
        simplified = _simplify_rdp(raw_coords, eps=0.0006)
        if len(simplified) < 2:
            continue
        if rname in seen_route_names:
            continue
        seen_route_names.add(rname)
        route_features.append(
            {
                "type": "Feature",
                "id": f"via_route_{rid}",
                "geometry": {"type": "LineString", "coordinates": simplified},
                "properties": {
                    "id": f"via_route_{rid}",
                    "route_id": rid,
                    "name": rname,
                    "operator": "VIA Rail Canada",
                    "color": rmeta["color"],
                },
            }
        )

    # Build station features (all Canadian VIA Rail stations)
    station_features: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    for st in stops_rows:
        sid = (st.get("stop_id") or "").strip()
        code = (st.get("stop_code") or sid).strip().upper()
        name = (st.get("stop_name") or "").strip()
        lat = _safe_float(st.get("stop_lat"))
        lon = _safe_float(st.get("stop_lon"))
        tz = (st.get("stop_timezone") or "").strip()
        if not name or lat is None or lon is None:
            continue
        if _is_us_amtrak_partner_stop(lat, lon, tz, name):
            continue
        if code in seen_codes:
            continue
        seen_codes.add(code)

        served_routes = sorted(stop_to_routes.get(sid) or [])
        province = _infer_province_zh(lat, lon, tz)
        wheelchair = (st.get("wheelchair_boarding") or "").strip() == "1"
        is_major = code in MAJOR_VIA_STATION_CODES or len(served_routes) >= 2

        station_features.append(
            {
                "type": "Feature",
                "id": f"via_station_{code}",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 6), round(lat, 6)],
                },
                "properties": {
                    "id": f"via_station_{code}",
                    "facility_type": "via_rail_station",
                    "stop_id": sid,
                    "code": code,
                    "name": name,
                    "province": province,
                    "timezone": tz,
                    "wheelchair_accessible": wheelchair,
                    "is_major": is_major,
                    "routes": served_routes,
                    "operator": "VIA Rail Canada",
                },
            }
        )

    station_features.sort(key=lambda f: (not f["properties"]["is_major"], f["properties"]["name"]))
    route_features.sort(key=lambda f: f["properties"]["name"])

    save_layer_geojson(ROUTES_GEOJSON_FILENAME, route_features, compact=True)
    save_layer_geojson(STATIONS_GEOJSON_FILENAME, station_features, compact=True)

    print(
        f"✅ VIA Rail 官方路線與車站圖資更新完成：{len(route_features)} 條路線、{len(station_features)} 座加拿大車站。"
    )
    return {"routes": len(route_features), "stations": len(station_features)}


def update_via_rail() -> dict[str, Any]:
    """Entrypoint for sync_layer.py: refresh both network (if missing) and live trains."""
    routes_path = os.path.join(BACKEND_DATA_DIR, ROUTES_GEOJSON_FILENAME)
    stations_path = os.path.join(BACKEND_DATA_DIR, STATIONS_GEOJSON_FILENAME)
    if not (os.path.exists(routes_path) and os.path.exists(stations_path)):
        try:
            update_via_rail_network()
        except Exception as exc:
            print(f"⚠️ [VIA Rail] GTFS 路網初始化失敗: {exc}")
    return fetch_via_rail_live(update_admin_meta=True, force_admin_meta=True)


if __name__ == "__main__":
    if "--network" in sys.argv:
        update_via_rail_network()
    elif "--live" in sys.argv:
        res = fetch_via_rail_live(update_admin_meta=True, force_admin_meta=True)
        print(
            f"✅ VIA Rail 即時狀態：行駛中 {res['in_service_count']} 班 "
            f"(含 GPS {res['in_service_gps_count']} 班) / Not In Service {res['not_in_service_count']} 班。"
        )
    else:
        update_via_rail_network()
        res = fetch_via_rail_live(update_admin_meta=True, force_admin_meta=True)
        print(
            f"✅ VIA Rail 全部更新完成：行駛中 {res['in_service_count']} 班 "
            f"(含 GPS {res['in_service_gps_count']} 班) / Not In Service {res['not_in_service_count']} 班。"
        )
