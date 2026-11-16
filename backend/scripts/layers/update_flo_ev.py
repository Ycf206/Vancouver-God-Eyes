"""
FLO EV Charging Stations Crawler (API1 Monthly Grid) & Live Status Hydrator (API2 Hourly).

API1 (monthly via GitHub Actions):
  Crawls Greater Vancouver on POST https://emobility.flo.ca/v3.0/map/markers/search
  using grid tiling + recursive quadtree subdivision whenever clusters appear,
  persisting all discovered park & station IDs to backend/data/flo_ev_parks.json.

API2 (hourly via OCI Dynamic Layers Service):
  Fetches live station details from GET https://emobility.flo.ca/v3.0/parks/station/{id}
  concurrently, filters strictly to stations with status == 'Available', maps connector
  metadata / freeOfCharge / fee / tariff details, and atomically writes
  backend/data/flo_ev_live_cache.json.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
import sys
import threading
import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import BACKEND_DATA_DIR, atomic_write_json as _shared_atomic_write_json, get_source_endpoint_url, update_admin_source_metadata

API1_URL = "https://emobility.flo.ca/v3.0/map/markers/search"
API2_URL = "https://emobility.flo.ca/v3.0/parks/station/{station_id}"
PARK_API2_URL = "https://emobility.flo.ca/v3.0/parks/{park_id}"

PARKS_CATALOG_FILE = os.path.join(BACKEND_DATA_DIR, "flo_ev_parks.json")
LIVE_CACHE_FILE = os.path.join(BACKEND_DATA_DIR, "flo_ev_live_cache.json")
DETAILS_CACHE_FILE = os.path.join(BACKEND_DATA_DIR, "flo_ev_details_cache.json")

# Greater Vancouver bounding box (West Van / Lions Bay / Bowen Island -> Maple Ridge / Langley / White Rock)
MV_BOUNDS = {
    "lat_min": 49.00,
    "lat_max": 49.55,
    "lon_min": -123.45,
    "lon_max": -122.40,
}

FLO_HEADERS = {
    "accept": "*/*",
    "accept-language": "zh-HK,zh;q=0.9,en-HK;q=0.8,en-US;q=0.7,en;q=0.6",
    "content-type": "application/json; charset=utf-8",
    "origin": "https://www.flo.com",
    "referer": "https://www.flo.com/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

CONNECTOR_DISPLAY_MAP = {
    "IEC_62196_T1": "J1772",
    "IEC_62196_T2": "Type 2",
    "IEC_62196_T1_COMBO": "CCS",
    "IEC_62196_T2_COMBO": "CCS",
    "COMBO_1": "CCS",
    "COMBO_2": "CCS",
    "CHADEMO": "CHAdeMO",
    "TESLA": "Tesla",
    "TESLA_S": "Tesla",
    "NACS": "Tesla",
}


_thread_local = threading.local()


class _RateLimitGate:
    """Shared cross-thread cooldown gate when FLO API2 returns HTTP 429 Retry-After."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pause_until = 0.0

    def wait_if_paused(self) -> None:
        while True:
            with self._lock:
                remaining = self._pause_until - time.time()
            if remaining <= 0:
                return
            time.sleep(min(remaining + 0.2, 5.0))

    def backoff(self, retry_after_sec: float) -> float:
        with self._lock:
            target = time.time() + max(1.0, retry_after_sec)
            should_log = target > self._pause_until + 1.0
            if target > self._pause_until:
                self._pause_until = target
            wait_sec = max(1.0, self._pause_until - time.time())
        if should_log:
            print(f"  ⏸️ [FLO API2] 觸發速率限制 (429)，所有執行緒暫停 {wait_sec:.0f}s 等待窗口重置...", flush=True)
        return wait_sec


def _build_session(pool_maxsize: int = 8) -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0.25,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
    )
    adapter = HTTPAdapter(pool_connections=pool_maxsize, pool_maxsize=pool_maxsize, max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(FLO_HEADERS)
    return session


def _get_thread_session(pool_maxsize: int = 8) -> requests.Session:
    sess = getattr(_thread_local, "session", None)
    if sess is None:
        sess = _build_session(pool_maxsize=pool_maxsize)
        _thread_local.session = sess
    return sess


def _atomic_write_json(path: str, payload: dict[str, Any]) -> None:
    _shared_atomic_write_json(path, payload, indent=2, prefix=".tmp_flo_", suffix=".json")


def _query_api1_box(
    session: requests.Session,
    api1_url: str,
    sw_lat: float,
    sw_lon: float,
    ne_lat: float,
    ne_lon: float,
    zoom_level: int,
) -> dict[str, Any]:
    body = {
        "zoomLevel": zoom_level,
        "bounds": {
            "SouthWest": {"Latitude": sw_lat, "Longitude": sw_lon},
            "NorthEast": {"Latitude": ne_lat, "Longitude": ne_lon},
        },
        "filter": {
            "networkIds": [],
            "connectors": None,
            "levels": [],
            "rates": [],
            "statuses": [],
            "minChargingSpeed": None,
            "maxChargingSpeed": None,
        },
    }
    resp = session.post(api1_url, json=body, timeout=25)
    resp.raise_for_status()
    return resp.json()


def crawl_flo_api1(save_catalog: bool = True) -> dict[str, Any]:
    """
    Crawl FLO API1 across Greater Vancouver using a 4x4 grid + recursive quadtree
    subdivision whenever `clusters` are returned.
    Returns catalog dict containing unique parks and all station IDs.
    """
    api1_url = get_source_endpoint_url("ev_charging", API1_URL)
    if not api1_url or "emobility.flo.ca" not in api1_url:
        api1_url = API1_URL

    print("⚡ [FLO API1] 開始以網格切片與四分樹遞迴抓取大溫哥華 FLO 充電站目錄...")
    session = _build_session(pool_maxsize=16)
    parks_by_id: dict[str, dict[str, Any]] = {}
    lock = threading.Lock()
    req_count = 0

    def _crawl_tile(sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float, depth: int, zoom: int) -> None:
        nonlocal req_count
        data = _query_api1_box(session, api1_url, sw_lat, sw_lon, ne_lat, ne_lon, zoom)
        parks = data.get("parks") or []
        clusters = data.get("clusters") or []
        with lock:
            req_count += 1
            for p in parks:
                pid = str(p.get("id") or "").strip()
                if not pid:
                    continue
                geo = p.get("geoCoordinates") or {}
                lat = geo.get("latitude")
                lon = geo.get("longitude")
                if lat is None or lon is None:
                    continue
                existing = parks_by_id.get(pid)
                stations_in = p.get("stations") or []
                if existing is None:
                    parks_by_id[pid] = {
                        "id": pid,
                        "name": str(p.get("name") or "").strip(),
                        "networkId": p.get("networkId"),
                        "lat": float(lat),
                        "lon": float(lon),
                        "stations": {
                            str(st.get("id")): {
                                "id": str(st.get("id")),
                                "name": str(st.get("name") or ""),
                                "status": str(st.get("status") or "").strip(),
                                "level": st.get("level"),
                                "freeOfCharge": bool(st.get("freeOfCharge")),
                                "connectors": st.get("connectors") or [],
                                "chargingSpeed": st.get("chargingSpeed"),
                            }
                            for st in stations_in
                            if st.get("id")
                        },
                    }
                else:
                    for st in stations_in:
                        sid = str(st.get("id") or "")
                        if sid and sid not in existing["stations"]:
                            existing["stations"][sid] = {
                                "id": sid,
                                "name": str(st.get("name") or ""),
                                "status": str(st.get("status") or "").strip(),
                                "level": st.get("level"),
                                "freeOfCharge": bool(st.get("freeOfCharge")),
                                "connectors": st.get("connectors") or [],
                                "chargingSpeed": st.get("chargingSpeed"),
                            }

        if clusters and depth < 5:
            mid_lat = (sw_lat + ne_lat) / 2.0
            mid_lon = (sw_lon + ne_lon) / 2.0
            next_zoom = min(18, zoom + 2)
            sub_boxes = [
                (sw_lat, sw_lon, mid_lat, mid_lon),
                (sw_lat, mid_lon, mid_lat, ne_lon),
                (mid_lat, sw_lon, ne_lat, mid_lon),
                (mid_lat, mid_lon, ne_lat, ne_lon),
            ]
            for b_sw_lat, b_sw_lon, b_ne_lat, b_ne_lon in sub_boxes:
                _crawl_tile(b_sw_lat, b_sw_lon, b_ne_lat, b_ne_lon, depth + 1, next_zoom)

    lat_min, lat_max = MV_BOUNDS["lat_min"], MV_BOUNDS["lat_max"]
    lon_min, lon_max = MV_BOUNDS["lon_min"], MV_BOUNDS["lon_max"]
    rows, cols = 4, 4
    d_lat = (lat_max - lat_min) / rows
    d_lon = (lon_max - lon_min) / cols
    initial_boxes = [
        (lat_min + r * d_lat, lon_min + c * d_lon, lat_min + (r + 1) * d_lat, lon_min + (c + 1) * d_lon)
        for r in range(rows)
        for c in range(cols)
    ]

    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(_crawl_tile, b[0], b[1], b[2], b[3], 0, 14) for b in initial_boxes]
        for fut in as_completed(futs):
            fut.result()

    parks_list: list[dict[str, Any]] = []
    total_stations = 0
    for pid, p in sorted(parks_by_id.items()):
        stations_list = list(p["stations"].values())
        total_stations += len(stations_list)
        parks_list.append(
            {
                "id": pid,
                "name": p["name"],
                "networkId": p["networkId"],
                "lat": p["lat"],
                "lon": p["lon"],
                "stations": stations_list,
            }
        )

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    catalog = {
        "updated_at": now_iso,
        "bounds": MV_BOUNDS,
        "api1_requests": req_count,
        "total_parks": len(parks_list),
        "total_stations": total_stations,
        "parks": parks_list,
    }
    if save_catalog and parks_list:
        _atomic_write_json(PARKS_CATALOG_FILE, catalog)
        print(
            f"✅ [FLO API1] 目錄爬取完成 ({req_count} 次網格請求): "
            f"{len(parks_list)} 處站點園區, {total_stations} 支充電樁 -> {PARKS_CATALOG_FILE}"
        )
    return catalog


def _normalize_connector_names(raw_types: list[str]) -> list[str]:
    names: list[str] = []
    for t in raw_types:
        key = str(t or "").strip().upper()
        mapped = CONNECTOR_DISPLAY_MAP.get(key, t)
        if mapped and mapped not in names:
            names.append(mapped)
    return names


def _fetch_url_with_gate(url: str, gate: _RateLimitGate) -> dict[str, Any] | None:
    session = _get_thread_session(pool_maxsize=8)
    for attempt in range(6):
        gate.wait_if_paused()
        try:
            resp = session.get(url, timeout=(5, 10))
            if resp.status_code == 429:
                retry_hdr = resp.headers.get("Retry-After") or "30"
                try:
                    delay = float(retry_hdr) + 1.0
                except ValueError:
                    delay = 31.0
                gate.backoff(delay)
                continue
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception:
            if attempt >= 2:
                return None
            time.sleep(0.4 * (attempt + 1))
    return None


def _fetch_park_api2(park_meta: dict[str, Any], gate: _RateLimitGate) -> list[dict[str, Any]]:
    stations = park_meta.get("stations") or []
    pid = str(park_meta.get("id") or "").strip()
    if len(stations) == 1:
        sid = str(stations[0].get("id") or "").strip()
        if sid:
            res = _fetch_url_with_gate(API2_URL.format(station_id=sid), gate)
            return [res] if isinstance(res, dict) and res.get("id") else []
    if pid:
        res = _fetch_url_with_gate(PARK_API2_URL.format(park_id=pid), gate)
        if isinstance(res, dict) and res.get("id"):
            return [res]
    # Fallback: query per-station endpoint
    payloads: list[dict[str, Any]] = []
    for st in stations:
        sid = str(st.get("id") or "").strip()
        if not sid:
            continue
        res = _fetch_url_with_gate(API2_URL.format(station_id=sid), gate)
        if isinstance(res, dict) and res.get("id"):
            payloads.append(res)
    return payloads


def _build_park_feature(
    park_meta: dict[str, Any],
    api2_payloads: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Build one GeoJSON Feature for a park if >= 1 station is currently Available.
    Extracts exact API2 fields matching popup/filter/search requirements.
    """
    entry = _extract_park_details_entry(park_meta, api2_payloads)
    if not entry:
        return None
    avail_records = [
        dict(st) for st in (entry.get("stations") or {}).values()
        if str(st.get("status") or "").strip() == "Available"
    ]
    return _assemble_park_feature(
        park_id=entry["id"],
        park_name=entry["name"],
        network_id=entry.get("networkId"),
        lat=entry.get("lat"),
        lon=entry.get("lon"),
        address1=entry.get("address1") or "",
        city=entry.get("city") or "",
        postal_code=entry.get("postal_code") or "",
        non_member_fee_amount=entry.get("non_member_fee_amount"),
        non_member_fee_currency=entry.get("non_member_fee_currency") or "CAD",
        avail_records=avail_records,
    )


def _parse_api2_station(st: dict[str, Any]) -> dict[str, Any]:
    conns = st.get("connectors") or []
    raw_types = [str(c.get("type") or "").strip() for c in conns if c.get("type")]
    power_w_vals = [int(c["power"]) for c in conns if isinstance(c.get("power"), (int, float))]
    max_power_w = max(power_w_vals) if power_w_vals else 0
    power_kw = round(max_power_w / 1000.0, 2) if max_power_w > 0 else (
        float(st["chargingSpeed"]) if isinstance(st.get("chargingSpeed"), (int, float)) and st["chargingSpeed"] > 0 else 0.0
    )
    power_types: list[str] = []
    for c in conns:
        pt = str(c.get("powerType") or "").strip()
        if pt and pt not in power_types:
            power_types.append(pt)
    tariff_desc = ((st.get("tariff") or {}).get("description") or {}).get("en") or ""
    return {
        "id": str(st.get("id") or ""),
        "name": str(st.get("name") or "").strip(),
        "status": str(st.get("status") or "").strip() or "Unknown",
        "level": str(st.get("level") or "").strip() or ("L3" if power_kw >= 50 else "L2"),
        "freeOfCharge": bool(st.get("freeOfCharge")),
        "startMethods": [str(m) for m in (st.get("startMethods") or []) if m],
        "connector_specs": raw_types,
        "connector_count": len(conns),
        "power_type": ", ".join(power_types) if power_types else "",
        "power": max_power_w,
        "power_kw": power_kw,
        "tariff_description_en": str(tariff_desc).strip(),
    }


def _extract_park_details_entry(
    park_meta: dict[str, Any],
    api2_payloads: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not api2_payloads:
        return None
    park_id = str(park_meta.get("id") or "").strip()
    park_name = park_meta.get("name") or ""
    lat = park_meta.get("lat")
    lon = park_meta.get("lon")
    address1 = ""
    city = ""
    postal_code = ""
    non_member_fee_amount: float | None = None
    non_member_fee_currency = "CAD"
    stations_map: dict[str, dict[str, Any]] = {}

    for payload in api2_payloads:
        if not park_name and payload.get("name"):
            park_name = str(payload["name"]).strip()
        geo = payload.get("geoCoordinates") or {}
        if geo.get("latitude") is not None and geo.get("longitude") is not None:
            lat = float(geo["latitude"])
            lon = float(geo["longitude"])
        addr = payload.get("address") or {}
        if not address1 and addr.get("address1"):
            address1 = str(addr["address1"]).strip()
        if not city and addr.get("city"):
            city = str(addr["city"]).strip()
        if not postal_code and addr.get("postalCode"):
            postal_code = str(addr["postalCode"]).strip()
        fees = payload.get("fees") or {}
        nmf = fees.get("nonMemberFee") if isinstance(fees, dict) else None
        if isinstance(nmf, dict) and nmf.get("amount") is not None and non_member_fee_amount is None:
            try:
                non_member_fee_amount = float(nmf["amount"])
                non_member_fee_currency = str(nmf.get("currency") or "CAD").strip()
            except (TypeError, ValueError):
                pass
        for st in payload.get("stations") or []:
            parsed = _parse_api2_station(st)
            if parsed["id"]:
                stations_map[parsed["id"]] = parsed

    if not park_id:
        return None
    return {
        "id": park_id,
        "name": park_name,
        "networkId": park_meta.get("networkId"),
        "lat": lat,
        "lon": lon,
        "address1": address1,
        "city": city,
        "postal_code": postal_code,
        "non_member_fee_amount": non_member_fee_amount,
        "non_member_fee_currency": non_member_fee_currency,
        "stations": stations_map,
    }


def _load_details_cache() -> dict[str, dict[str, Any]]:
    details_by_park: dict[str, dict[str, Any]] = {}
    if os.path.exists(DETAILS_CACHE_FILE):
        try:
            with open(DETAILS_CACHE_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            parks_dict = raw.get("parks") if isinstance(raw, dict) else None
            if isinstance(parks_dict, dict):
                for pid, entry in parks_dict.items():
                    if isinstance(entry, dict):
                        details_by_park[str(pid)] = entry
        except Exception:
            pass

    if os.path.exists(LIVE_CACHE_FILE):
        try:
            with open(LIVE_CACHE_FILE, "r", encoding="utf-8") as f:
                live_raw = json.load(f)
            for feat in live_raw.get("features") or []:
                props = feat.get("properties") or {}
                pid = str(props.get("park_id") or "").strip()
                if not pid:
                    continue
                entry = details_by_park.setdefault(
                    pid,
                    {
                        "id": pid,
                        "name": props.get("name") or "",
                        "networkId": props.get("network_id"),
                        "lat": props.get("lat"),
                        "lon": props.get("lon"),
                        "address1": props.get("address1") or props.get("address") or "",
                        "city": props.get("city") or "",
                        "postal_code": props.get("postal_code") or "",
                        "non_member_fee_amount": props.get("non_member_fee_amount"),
                        "non_member_fee_currency": props.get("non_member_fee_currency") or "CAD",
                        "stations": {},
                    },
                )
                if not isinstance(entry.get("stations"), dict):
                    entry["stations"] = {}
                for st in props.get("available_stations") or []:
                    sid = str(st.get("id") or "").strip()
                    if sid and sid not in entry["stations"]:
                        entry["stations"][sid] = st
        except Exception:
            pass
    return details_by_park


def _save_details_cache(details_by_park: dict[str, dict[str, Any]]) -> None:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "updated_at": now_iso,
        "parks_count": len(details_by_park),
        "parks": details_by_park,
    }
    _atomic_write_json(DETAILS_CACHE_FILE, payload)


def _assemble_park_feature(
    park_id: str,
    park_name: str,
    network_id: Any,
    lat: float | None,
    lon: float | None,
    address1: str,
    city: str,
    postal_code: str,
    non_member_fee_amount: float | None,
    non_member_fee_currency: str,
    avail_records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not avail_records or lat is None or lon is None:
        return None

    avail_records.sort(
        key=lambda r: (
            1 if str(r.get("level", "")).upper() == "L3" or (r.get("power_kw") or 0) >= 50 else 0,
            1 if r.get("freeOfCharge") else 0,
            r.get("power") or 0,
        ),
        reverse=True,
    )
    primary = avail_records[0]

    all_raw_types: list[str] = []
    all_levels: list[str] = []
    total_ports = 0
    max_kw = 0.0
    for r in avail_records:
        total_ports += int(r.get("connector_count") or 0)
        if (r.get("power_kw") or 0) > max_kw:
            max_kw = float(r["power_kw"])
        lv = str(r.get("level") or "")
        if lv and lv not in all_levels:
            all_levels.append(lv)
        for t in r.get("connector_specs") or r.get("connector_types") or []:
            if t not in all_raw_types:
                all_raw_types.append(t)

    norm_connectors = _normalize_connector_names(all_raw_types)
    any_free = any(bool(r.get("freeOfCharge")) for r in avail_records)
    has_fast = any(str(lv).upper() == "L3" for lv in all_levels) or max_kw >= 50
    level_label = "Level 3 (DC Fast)" if has_fast else "Level 2"
    primary_tariff = str(primary.get("tariff_description_en") or "").strip()
    cost_summary = "Free" if any_free else (
        primary_tariff.splitlines()[0].strip()
        if primary_tariff
        else (f"${non_member_fee_amount:.2f} {non_member_fee_currency}" if non_member_fee_amount is not None else "")
    )

    feat_id = f"ev_flo_{park_id}"
    primary_specs = primary.get("connector_specs") or primary.get("connector_types") or []
    return {
        "type": "Feature",
        "id": feat_id,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id": feat_id,
            "park_id": park_id,
            "network_id": network_id,
            "station_id": primary["id"],
            "station_name": primary["name"],
            "facility_type": "ev_charging",
            "source": "flo",
            "operator": "FLO",
            "name": park_name or address1 or "FLO EV Charging Station",
            "address": address1,
            "address1": address1,
            "city": city,
            "postal_code": postal_code,
            "local_area": city or "Metro Vancouver",
            "status": "Available",
            "start_methods": primary.get("startMethods") or [],
            "connector_specs": primary_specs,
            "connector_specs_str": ", ".join(primary_specs),
            "connector_count": primary.get("connector_count") or len(primary_specs) or 1,
            "connectors": ", ".join(norm_connectors) if norm_connectors else ", ".join(all_raw_types),
            "ports": total_ports,
            "level": primary.get("level") or "",
            "all_levels": ", ".join(all_levels),
            "level_1": level_label,
            "power_type": primary.get("power_type") or "",
            "power": primary.get("power") or 0,
            "power_kw": primary.get("power_kw") or 0.0,
            "max_power_kw": max_kw,
            "is_free": any_free,
            "free_of_charge": bool(primary.get("freeOfCharge")),
            "non_member_fee_amount": non_member_fee_amount,
            "non_member_fee_currency": non_member_fee_currency,
            "tariff_description_en": primary_tariff,
            "cost": cost_summary,
            "available_stations_count": len(avail_records),
            "available_stations": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "status": "Available",
                    "level": r.get("level") or "",
                    "freeOfCharge": bool(r.get("freeOfCharge")),
                    "startMethods": r.get("startMethods") or [],
                    "connector_specs": r.get("connector_specs") or r.get("connector_types") or [],
                    "connector_count": r.get("connector_count") or 1,
                    "power_type": r.get("power_type") or "",
                    "power": r.get("power") or 0,
                    "power_kw": r.get("power_kw") or 0.0,
                    "tariff_description_en": r.get("tariff_description_en") or "",
                }
                for r in avail_records
            ],
            "lat": lat,
            "lon": lon,
        },
    }


def _build_live_payload(
    features: list[dict[str, Any]],
    total_parks: int,
    total_stations: int,
    ok_count: int,
    err_count: int,
    partial: bool = False,
    source_label: str = "FLO eMobility API2",
) -> tuple[str, dict[str, Any], int]:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total_avail_stations = sum(int(f["properties"].get("available_stations_count") or 0) for f in features)
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "source": source_label,
            "source_url": "https://emobility.flo.ca/v3.0/parks/station/{id}",
            "updated_at": now_iso,
            "partial": partial,
            "total_parks_checked": total_parks,
            "total_stations_checked": total_stations,
            "api2_ok": ok_count,
            "api2_errors": err_count,
            "available_parks_count": len(features),
            "available_stations_count": total_avail_stations,
        },
        "features": features,
    }
    return now_iso, payload, total_avail_stations


def _build_feature_from_live_park(
    live_park: dict[str, Any],
    details_entry: dict[str, Any] | None,
) -> dict[str, Any] | None:
    stations_live = live_park.get("stations") or []
    detail_stations = (details_entry or {}).get("stations") or {}
    avail_records: list[dict[str, Any]] = []

    for st in stations_live:
        if str(st.get("status") or "").strip() != "Available":
            continue
        sid = str(st.get("id") or "").strip()
        det = detail_stations.get(sid) if isinstance(detail_stations, dict) else None
        if det:
            rec = dict(det)
            rec["status"] = "Available"
            rec["freeOfCharge"] = bool(st.get("freeOfCharge", det.get("freeOfCharge")))
            if st.get("level") and not rec.get("level"):
                rec["level"] = str(st["level"])
            avail_records.append(rec)
        else:
            raw_types = [str(c) for c in (st.get("connectors") or []) if c]
            speed_w = int(st["chargingSpeed"]) if isinstance(st.get("chargingSpeed"), (int, float)) and st["chargingSpeed"] > 0 else 0
            speed_kw = round(speed_w / 1000.0, 2) if speed_w > 0 else 0.0
            avail_records.append(
                {
                    "id": sid,
                    "name": str(st.get("name") or "").strip(),
                    "status": "Available",
                    "level": str(st.get("level") or "").strip() or "L2",
                    "freeOfCharge": bool(st.get("freeOfCharge")),
                    "startMethods": [],
                    "connector_specs": raw_types,
                    "connector_count": len(raw_types) or 1,
                    "power_type": "",
                    "power": speed_w,
                    "power_kw": speed_kw,
                    "tariff_description_en": "",
                }
            )

    if not avail_records:
        return None

    d = details_entry or {}
    return _assemble_park_feature(
        park_id=str(live_park.get("id") or ""),
        park_name=str(live_park.get("name") or d.get("name") or "").strip(),
        network_id=live_park.get("networkId", d.get("networkId")),
        lat=d.get("lat") if d.get("lat") is not None else live_park.get("lat"),
        lon=d.get("lon") if d.get("lon") is not None else live_park.get("lon"),
        address1=str(d.get("address1") or "").strip(),
        city=str(d.get("city") or "").strip(),
        postal_code=str(d.get("postal_code") or "").strip(),
        non_member_fee_amount=d.get("non_member_fee_amount"),
        non_member_fee_currency=str(d.get("non_member_fee_currency") or "CAD"),
        avail_records=avail_records,
    )


def sync_flo_live_statuses_fast(
    update_admin_meta: bool = True,
    details_by_park: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Fast ~3.5s live status sync via FLO API1 grid crawl (~60 POST requests, zero 429 limit),
    overlaid onto persisted API2 park/tariff details (`flo_ev_details_cache.json`).
    Eliminates multi-minute cache drift between FLO's website and the map pins.
    """
    t0 = time.time()
    live_catalog = crawl_flo_api1(save_catalog=False)
    live_parks = live_catalog.get("parks") or []
    if not live_parks:
        return []

    if details_by_park is None:
        details_by_park = _load_details_cache()

    features: list[dict[str, Any]] = []
    for lp in live_parks:
        pid = str(lp.get("id") or "").strip()
        feat = _build_feature_from_live_park(lp, details_by_park.get(pid))
        if feat is not None:
            features.append(feat)

    now_iso, payload_out, total_avail_stations = _build_live_payload(
        features,
        len(live_parks),
        int(live_catalog.get("total_stations") or 0),
        len(features),
        0,
        partial=False,
        source_label="FLO eMobility API1 Live + API2 Details Cache",
    )
    _atomic_write_json(LIVE_CACHE_FILE, payload_out)
    if update_admin_meta:
        update_admin_source_metadata("ev_charging_flo", len(features), updated_at=now_iso)
    elapsed = round(time.time() - t0, 1)
    print(
        f"⚡ [FLO Live Fast] 即時狀態同步完成 ({elapsed}s): 可用園區 {len(features)}/{len(live_parks)} 處 "
        f"(可用充電樁 {total_avail_stations} 支) -> {LIVE_CACHE_FILE}",
        flush=True,
    )
    return features


def fetch_single_park_live(park_id: str, station_id: str | None = None) -> dict[str, Any] | None:
    """
    Fetch real-time FLO API2 details and live status for a single park when clicked in Map UI.
    Returns all stations in the park (`Available`, `InUse`, etc.) sorted with Available first.
    """
    gate = _RateLimitGate()
    payload = None
    pid = (park_id or "").strip()
    if pid:
        payload = _fetch_url_with_gate(PARK_API2_URL.format(park_id=pid), gate)
    if not isinstance(payload, dict) or not payload.get("stations"):
        sid = (station_id or "").strip()
        if sid:
            payload = _fetch_url_with_gate(API2_URL.format(station_id=sid), gate)
    if not isinstance(payload, dict) or not payload.get("id"):
        return None

    addr = payload.get("address") or {}
    fees = payload.get("fees") or {}
    nmf = fees.get("nonMemberFee") if isinstance(fees, dict) else None
    fee_amt = None
    fee_curr = "CAD"
    if isinstance(nmf, dict) and nmf.get("amount") is not None:
        try:
            fee_amt = float(nmf["amount"])
            fee_curr = str(nmf.get("currency") or "CAD").strip()
        except (TypeError, ValueError):
            pass

    parsed_stations = [_parse_api2_station(st) for st in (payload.get("stations") or []) if st.get("id")]
    parsed_stations.sort(
        key=lambda r: (
            1 if r.get("status") == "Available" else 0,
            1 if str(r.get("level", "")).upper() == "L3" or (r.get("power_kw") or 0) >= 50 else 0,
            r.get("power") or 0,
        ),
        reverse=True,
    )
    avail_count = sum(1 for r in parsed_stations if r.get("status") == "Available")
    return {
        "park_id": str(payload.get("id") or pid),
        "network_id": payload.get("networkId"),
        "name": str(payload.get("name") or "").strip(),
        "address1": str(addr.get("address1") or "").strip(),
        "city": str(addr.get("city") or "").strip(),
        "postal_code": str(addr.get("postalCode") or "").strip(),
        "non_member_fee_amount": fee_amt,
        "non_member_fee_currency": fee_curr,
        "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "available_count": avail_count,
        "total_count": len(parsed_stations),
        "status": "Available" if avail_count > 0 else (parsed_stations[0]["status"] if parsed_stations else "Unknown"),
        "stations": parsed_stations,
    }


def refresh_flo_api2(
    max_workers: int = 4,
    update_admin_meta: bool = True,
    limit_parks: int | None = None,
) -> list[dict[str, Any]]:
    """
    Hourly API2 detail & tariff hydration across cataloged parks (`flo_ev_details_cache.json`),
    followed by a ~3.5s synchronized API1 live status snapshot (`flo_ev_live_cache.json`) so all
    parks reflect uniform real-time status at completion.
    """
    t0 = time.time()
    catalog: dict[str, Any] | None = None
    if os.path.exists(PARKS_CATALOG_FILE):
        try:
            with open(PARKS_CATALOG_FILE, "r", encoding="utf-8") as f:
                catalog = json.load(f)
        except Exception as e:
            print(f"  ⚠️ 讀取 flo_ev_parks.json 失敗，將重新執行 API1 爬取: {e}")

    if not catalog or not catalog.get("parks"):
        catalog = crawl_flo_api1(save_catalog=True)

    parks_raw = catalog.get("parks") or []
    parks_sorted = sorted(
        [p for p in parks_raw if p.get("id")],
        key=lambda p: (
            (float(p.get("lat") or 49.26) - 49.26) ** 2
            + (float(p.get("lon") or -123.12) + 123.12) ** 2
        ),
    )
    if limit_parks is not None and limit_parks > 0:
        parks_sorted = parks_sorted[:limit_parks]

    parks_by_id: dict[str, dict[str, Any]] = {str(p["id"]).strip(): p for p in parks_sorted}
    total_station_ids = sum(len(p.get("stations") or []) for p in parks_sorted)
    print(
        f"⚡ [FLO API2] 正在即時查詢 {len(parks_by_id)} 處園區詳細費率與規格 (涵蓋 {total_station_ids} 支充電樁, max_workers={max_workers})...",
        flush=True,
    )

    details_by_park = _load_details_cache()
    prev_features_by_park: dict[str, dict[str, Any]] = {}
    if os.path.exists(LIVE_CACHE_FILE):
        try:
            with open(LIVE_CACHE_FILE, "r", encoding="utf-8") as f:
                prev_data = json.load(f)
            for pf in prev_data.get("features") or []:
                pk = str((pf.get("properties") or {}).get("park_id") or "")
                if pk:
                    prev_features_by_park[pk] = pf
        except Exception:
            pass

    gate = _RateLimitGate()
    park_payloads: dict[str, list[dict[str, Any]]] = {}
    visited_parks: set[str] = set()
    ok_count = 0
    err_count = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {
            pool.submit(_fetch_park_api2, pmeta, gate): pid
            for pid, pmeta in parks_by_id.items()
        }
        for fut in as_completed(future_map):
            pid = future_map[fut]
            done_count += 1
            visited_parks.add(pid)
            res_list = fut.result()
            if res_list:
                ok_count += 1
                park_payloads[pid] = res_list
                entry = _extract_park_details_entry(parks_by_id[pid], res_list)
                if entry:
                    details_by_park[pid] = entry
            else:
                err_count += 1

            if done_count % 120 == 0 and done_count < len(parks_by_id):
                _save_details_cache(details_by_park)
                partial_feats: list[dict[str, Any]] = []
                for check_pid, pmeta in parks_by_id.items():
                    if check_pid in visited_parks:
                        feat = _build_park_feature(pmeta, park_payloads.get(check_pid) or [])
                        if feat is not None:
                            partial_feats.append(feat)
                    elif check_pid in prev_features_by_park:
                        partial_feats.append(prev_features_by_park[check_pid])
                if partial_feats:
                    _, partial_payload, _ = _build_live_payload(
                        partial_feats, len(parks_by_id), total_station_ids, ok_count, err_count, partial=True
                    )
                    _atomic_write_json(LIVE_CACHE_FILE, partial_payload)
                print(
                    f"  ⏳ [FLO API2] 進度 {done_count}/{len(parks_by_id)} 園區 "
                    f"(成功 {ok_count}, 失敗 {err_count}, {round(time.time() - t0, 1)}s)",
                    flush=True,
                )

    if details_by_park:
        _save_details_cache(details_by_park)

    # Synchronize all park statuses with a 3.5s full-grid API1 pass when doing full refresh
    if limit_parks is None:
        try:
            synced = sync_flo_live_statuses_fast(update_admin_meta=update_admin_meta, details_by_park=details_by_park)
            if synced:
                elapsed = round(time.time() - t0, 1)
                print(f"✅ [FLO API2 + Live] 完整更新完成 ({elapsed}s): 詳細快取 {len(details_by_park)} 園區, 目前可用 {len(synced)} 處", flush=True)
                return synced
        except Exception as sync_err:
            print(f"  ⚠️ [FLO API2] 結束同步 API1 狀態失敗，改用 API2 批次結果: {sync_err}")

    features: list[dict[str, Any]] = []
    for pid, pmeta in parks_by_id.items():
        feat = _build_park_feature(pmeta, park_payloads.get(pid) or [])
        if feat is not None:
            features.append(feat)

    if limit_parks is not None:
        for pk, pf in prev_features_by_park.items():
            if pk not in visited_parks:
                features.append(pf)

    now_iso, payload_out, total_avail_stations = _build_live_payload(
        features, len(parks_by_id), total_station_ids, ok_count, err_count, partial=False
    )
    if features or ok_count > 0:
        _atomic_write_json(LIVE_CACHE_FILE, payload_out)
        if update_admin_meta:
            update_admin_source_metadata("ev_charging_flo", len(features), updated_at=now_iso)
    elapsed = round(time.time() - t0, 1)
    print(
        f"✅ [FLO API2] 即時狀態同步完成 ({elapsed}s): {ok_count}/{len(parks_by_id)} 園區 API2 成功, "
        f"可用園區 {len(features)} 處 (可用充電樁 {total_avail_stations} 支) -> {LIVE_CACHE_FILE}",
        flush=True,
    )
    return features


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode == "api1":
        crawl_flo_api1(save_catalog=True)
    elif mode == "fast":
        sync_flo_live_statuses_fast(update_admin_meta=True)
    elif mode == "api2":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else None
        refresh_flo_api2(limit_parks=limit)
    else:
        crawl_flo_api1(save_catalog=True)
        refresh_flo_api2()
