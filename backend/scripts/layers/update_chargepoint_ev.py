"""
ChargePoint EV Charging Stations Crawler (API1 Monthly Grid + Pagination) & Live Status Hydrator (API2 Hourly).

API1 (monthly via GitHub Actions):
  Crawls Greater Vancouver on POST https://mc-ca.chargepoint.com/map-prod/v2
  using grid slicing + cursor pagination (`page_offset`), persisting all discovered
  devices to backend/data/chargepoint_ev_devices.json.

API2 (hourly via OCI Dynamic Layers Service):
  Fetches detailed station & pricing info from GET https://mc-ca.chargepoint.com/map-prod/v3/station/info?deviceId={id},
  maintains a persistent details cache (`chargepoint_ev_details_cache.json`), synchronizes real-time port
  availability via a fast API1 sweep, filters strictly to stations with Available status, and atomically writes
  backend/data/chargepoint_ev_live_cache.json.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
import sys
import tempfile
import threading
import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import BACKEND_DATA_DIR, update_admin_source_metadata

API1_URL = "https://mc-ca.chargepoint.com/map-prod/v2"
API2_URL = "https://mc-ca.chargepoint.com/map-prod/v3/station/info"

DEVICES_CATALOG_FILE = os.path.join(BACKEND_DATA_DIR, "chargepoint_ev_devices.json")
DETAILS_CACHE_FILE = os.path.join(BACKEND_DATA_DIR, "chargepoint_ev_details_cache.json")
LIVE_CACHE_FILE = os.path.join(BACKEND_DATA_DIR, "chargepoint_ev_live_cache.json")

# Greater Vancouver bounding box (West Van / Lions Bay / Bowen Island -> Maple Ridge / Langley / White Rock)
MV_BOUNDS = {
    "lat_min": 49.00,
    "lat_max": 49.55,
    "lon_min": -123.45,
    "lon_max": -122.40,
}

CP_HEADERS = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "https://driver.chargepoint.com",
    "referer": "https://driver.chargepoint.com/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

_EMPTY_FILTER = {
    "price_free": False,
    "status_available": False,
    "dc_fast_charging": False,
    "disabled_parking": False,
    "van_accessible": False,
    "network_chargepoint": False,
    "network_mercedes": False,
    "connector_l1": False,
    "connector_l2": False,
    "connector_l2_nema_1450": False,
    "connector_l2_tesla": False,
    "connector_chademo": False,
    "connector_combo": False,
    "connector_tesla": False,
}

_thread_local = threading.local()


class _RateLimitGate:
    """Shared cross-thread cooldown gate when ChargePoint API2 throttles requests."""

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
            if target > self._pause_until:
                self._pause_until = target
            return round(self._pause_until - time.time(), 1)


def _get_session() -> requests.Session:
    sess = getattr(_thread_local, "session", None)
    if sess is None:
        sess = requests.Session()
        sess.headers.update(CP_HEADERS)
        retry = Retry(
            total=2,
            backoff_factor=0.6,
            status_forcelist=(500, 502, 503, 504),
            allowed_methods=("GET", "POST"),
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
        sess.mount("https://", adapter)
        sess.mount("http://", adapter)
        _thread_local.session = sess
    return sess


def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_cp_", suffix=".json", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, target_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _normalize_cp_status(raw: str | None) -> str:
    val = str(raw or "").strip().lower()
    if val == "available":
        return "Available"
    if val in ("in_use", "in use", "occupied", "busy", "charging"):
        return "In Use"
    if val in ("unknown", ""):
        return "Unknown"
    if val in ("maintenance_required", "out_of_service", "out_of_order", "unavailable", "offline"):
        return val.replace("_", " ").title()
    return str(raw or "Unknown").strip()


def _connector_filter_token(display_plug: str | None, plug_type: str | None) -> str:
    raw = str(display_plug or plug_type or "").strip()
    if not raw:
        return "J1772"
    low = raw.lower()
    if "combo" in low and "ccs" not in low:
        return f"CCS ({raw})"
    if "tesla" in low or "nacs" in low:
        if "Tesla" not in raw:
            return f"{raw} (Tesla)"
    return raw


def _format_cp_fee_unit(unit: str | None) -> str:
    u = str(unit or "").strip().upper()
    return {
        "KWH": "kWh",
        "HOUR": "hr",
        "MINUTE": "min",
        "SESSION": "次",
    }.get(u, u.lower() if u else "次")


def _format_cp_cost_summary(station_price: dict[str, Any] | None, is_free: bool) -> str:
    if is_free:
        return "免費"
    sp = station_price if isinstance(station_price, dict) else {}
    ef = sp.get("energyFee") if isinstance(sp.get("energyFee"), dict) else {}
    fixed = ef.get("fixedFee") if isinstance(ef.get("fixedFee"), dict) else None
    if fixed and fixed.get("amount") is not None:
        try:
            amt = float(fixed["amount"])
            unit = _format_cp_fee_unit(fixed.get("unit"))
            return f"${amt:g}/{unit}"
        except (TypeError, ValueError):
            pass
    tou_list = ef.get("touFeeList") if isinstance(ef.get("touFeeList"), list) else []
    if tou_list:
        return "分時計費"
    pf = sp.get("parkingFee") if isinstance(sp.get("parkingFee"), dict) else {}
    cbf = pf.get("chargingBasedFee") if isinstance(pf.get("chargingBasedFee"), dict) else {}
    wc = cbf.get("whileCharging") if isinstance(cbf.get("whileCharging"), dict) else None
    if wc and wc.get("amount") is not None:
        try:
            amt = float(wc["amount"])
            if amt > 0:
                return f"${amt:g}/{_format_cp_fee_unit(wc.get('unit'))}"
        except (TypeError, ValueError):
            pass
    if pf.get("chargingBasedTouFee"):
        return "分時計費"
    return "依現場計費"


def _post_api1_cell(
    sw_lat: float,
    sw_lon: float,
    ne_lat: float,
    ne_lon: float,
    page_offset: str = "",
) -> dict[str, Any]:
    sess = _get_session()
    query_obj = {
        "station_list": {
            "screen_width": 1200,
            "screen_height": 800,
            "ne_lat": round(ne_lat, 6),
            "ne_lon": round(ne_lon, 6),
            "sw_lat": round(sw_lat, 6),
            "sw_lon": round(sw_lon, 6),
            "page_size": 100,
            "page_offset": page_offset,
            "sort_by": "distance",
            "reference_lat": round((sw_lat + ne_lat) / 2.0, 6),
            "reference_lon": round((sw_lon + ne_lon) / 2.0, 6),
            "include_map_bound": True,
            "filter": _EMPTY_FILTER,
            "bound_output": True,
        }
    }
    url = f"{API1_URL}?{json.dumps(query_obj, separators=(',', ':'))}"
    resp = sess.post(url, timeout=18)
    resp.raise_for_status()
    return resp.json()


def crawl_chargepoint_api1(save_catalog: bool = True) -> dict[str, Any]:
    """
    Crawl Greater Vancouver ChargePoint stations via 2x2 grid slices + cursor pagination on API1.
    """
    t0 = time.time()
    lat_min, lat_max = MV_BOUNDS["lat_min"], MV_BOUNDS["lat_max"]
    lon_min, lon_max = MV_BOUNDS["lon_min"], MV_BOUNDS["lon_max"]
    lat_mid = (lat_min + lat_max) / 2.0
    lon_mid = (lon_min + lon_max) / 2.0

    cells = [
        (lat_min, lon_min, lat_mid + 0.01, lon_mid + 0.01),
        (lat_min, lon_mid - 0.01, lat_mid + 0.01, lon_max),
        (lat_mid - 0.01, lon_min, lat_max, lon_mid + 0.01),
        (lat_mid - 0.01, lon_mid - 0.01, lat_max, lon_max),
    ]

    devices_by_id: dict[str, dict[str, Any]] = {}
    req_count = 0

    for sw_lat, sw_lon, ne_lat, ne_lon in cells:
        offset = ""
        for _ in range(30):
            req_count += 1
            try:
                data = _post_api1_cell(sw_lat, sw_lon, ne_lat, ne_lon, page_offset=offset)
            except Exception as err:
                print(f"  ⚠️ [ChargePoint API1] 區塊 ({sw_lat:.2f},{sw_lon:.2f}) 請求失敗: {err}")
                break
            st_list = (data or {}).get("station_list") or {}
            stations = st_list.get("stations") or []
            for st in stations:
                did = str(st.get("device_id") or "").strip()
                lat = st.get("lat")
                lon = st.get("lon")
                if not did or lat is None or lon is None:
                    continue
                devices_by_id[did] = {
                    "device_id": did,
                    "lat": float(lat),
                    "lon": float(lon),
                    "name1": str(st.get("name1") or "").strip(),
                    "name2": str(st.get("name2") or "").strip(),
                    "address1": str(st.get("address1") or "").strip(),
                    "city": str(st.get("city") or "").strip(),
                    "state_name": str(st.get("state_name") or "").strip(),
                    "network_display_name": str(st.get("network_display_name") or "ChargePoint Network").strip(),
                    "station_status": str(st.get("station_status") or "").strip(),
                    "station_status_v2": str(st.get("station_status_v2") or "").strip(),
                    "payment_type": str(st.get("payment_type") or "").strip(),
                    "display_level": str(st.get("display_level") or "").strip(),
                    "max_power": st.get("max_power") or {},
                    "total_port_count": int(st.get("total_port_count") or len(st.get("ports") or []) or 1),
                    "access_restriction": str(st.get("access_restriction") or "NONE").strip(),
                    "ports": [
                        {
                            "outlet_number": p.get("outlet_number"),
                            "status": str(p.get("status") or "").strip(),
                            "status_v2": str(p.get("status_v2") or "").strip(),
                            "available_power": p.get("available_power"),
                        }
                        for p in (st.get("ports") or [])
                    ],
                }
            next_offset = str(st_list.get("page_offset") or "").strip()
            if not next_offset or next_offset == offset or not stations:
                break
            offset = next_offset

    devices = sorted(
        devices_by_id.values(),
        key=lambda d: (
            (d["lat"] - 49.26) ** 2 + (d["lon"] + 123.12) ** 2,
            d["device_id"],
        ),
    )

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    catalog = {
        "updated_at": now_iso,
        "source": "ChargePoint Map API v2 (Greater Vancouver Grid + Pagination)",
        "bounds": MV_BOUNDS,
        "total_devices": len(devices),
        "devices": devices,
    }
    if save_catalog and devices:
        _atomic_write_json(DEVICES_CATALOG_FILE, catalog)
    elapsed = round(time.time() - t0, 1)
    print(
        f"⚡ [ChargePoint API1] 網格切片掃描完成 ({req_count} 次請求, {elapsed}s): "
        f"共 {len(devices)} 座充電站點",
        flush=True,
    )
    return catalog


def _fetch_cp_info(device_id: str, gate: _RateLimitGate) -> dict[str, Any] | None:
    sess = _get_session()
    url = f"{API2_URL}?deviceId={device_id}"
    for attempt in range(4):
        gate.wait_if_paused()
        try:
            resp = sess.get(url, timeout=15)
            if resp.status_code == 429:
                retry_hdr = resp.headers.get("Retry-After")
                try:
                    wait_s = float(retry_hdr) if retry_hdr else (5.0 * (attempt + 1))
                except ValueError:
                    wait_s = 8.0 * (attempt + 1)
                gate.backoff(wait_s)
                continue
            if resp.status_code != 200 or not resp.text.strip():
                time.sleep(0.4 * (attempt + 1))
                continue
            data = resp.json()
            if isinstance(data, dict) and (data.get("deviceId") or data.get("hostName") or data.get("portsInfo")):
                return data
        except Exception:
            time.sleep(0.4 * (attempt + 1))
    return None


def _normalize_ports_from_api2(
    detail: dict[str, Any],
    live_ports_override: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    ports_raw = ((detail.get("portsInfo") or {}).get("ports") or [])
    override_by_outlet: dict[int, dict[str, Any]] = {}
    for lp in (live_ports_override or []):
        try:
            onum = int(lp.get("outlet_number"))
            override_by_outlet[onum] = lp
        except (TypeError, ValueError):
            pass

    normalized: list[dict[str, Any]] = []
    for idx, port in enumerate(ports_raw):
        try:
            outlet_num = int(port.get("outletNumber") or (idx + 1))
        except (TypeError, ValueError):
            outlet_num = idx + 1

        lp = override_by_outlet.get(outlet_num)
        raw_status = (lp.get("status") if lp else None) or port.get("status") or "unknown"
        norm_status = _normalize_cp_status(raw_status)

        pr = port.get("powerRange") or {}
        try:
            p_max = float(pr.get("max")) if pr.get("max") is not None else 0.0
        except (TypeError, ValueError):
            p_max = 0.0
        p_unit = str(pr.get("unit") or "kW").strip() or "kW"

        conn_list = []
        for c in (port.get("connectorList") or []):
            c_raw_st = (lp.get("status") if lp else None) or c.get("status") or raw_status
            conn_list.append({
                "plugType": str(c.get("plugType") or "").strip(),
                "displayPlugType": str(c.get("displayPlugType") or c.get("plugType") or "J1772").strip(),
                "status": _normalize_cp_status(c_raw_st),
            })

        normalized.append({
            "outletNumber": outlet_num,
            "status": norm_status,
            "level": str(port.get("level") or "").strip(),
            "displayLevel": str(port.get("displayLevel") or "").strip(),
            "powerRange": {
                "max": pr.get("max") if pr.get("max") is not None else p_max,
                "unit": p_unit,
            },
            "connectorList": conn_list,
        })
    return normalized


def _extract_details_entry(api1_item: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    addr = detail.get("address") or {}
    net = detail.get("network") or {}
    lat = detail.get("latitude") if detail.get("latitude") is not None else api1_item.get("lat")
    lon = detail.get("longitude") if detail.get("longitude") is not None else api1_item.get("lon")
    host_name = str(detail.get("hostName") or "").strip()
    if not host_name:
        host_name = " ".join(p for p in [api1_item.get("name1"), api1_item.get("name2")] if p).strip() or "ChargePoint"

    ports_norm = _normalize_ports_from_api2(detail, live_ports_override=None)
    start_methods = [
        str(cfg.get("type")).strip()
        for cfg in (detail.get("startChargeConfig") or [])
        if isinstance(cfg, dict) and cfg.get("type")
    ]
    sp = detail.get("stationPrice") if isinstance(detail.get("stationPrice"), dict) else {}

    return {
        "device_id": str(detail.get("deviceId") or api1_item.get("device_id")),
        "lat": float(lat),
        "lon": float(lon),
        "hostName": host_name,
        "address1": str(addr.get("address1") or api1_item.get("address1") or "").strip(),
        "city": str(addr.get("city") or api1_item.get("city") or "").strip(),
        "state": str(addr.get("state") or api1_item.get("state_name") or "").strip(),
        "networkDisplayName": str(
            net.get("displayName") or api1_item.get("network_display_name") or "ChargePoint Network"
        ).strip(),
        "description": str(detail.get("description") or "").strip() or None,
        "accessRestriction": str(
            detail.get("accessRestriction") or api1_item.get("access_restriction") or "NONE"
        ).strip(),
        "startChargeConfig": start_methods,
        "portCount": int(((detail.get("portsInfo") or {}).get("portCount")) or len(ports_norm) or 1),
        "ports": ports_norm,
        "stationPrice": sp,
    }


def _build_cp_feature(
    api1_item: dict[str, Any],
    details_entry: dict[str, Any] | None,
) -> dict[str, Any] | None:
    did = str(api1_item.get("device_id") or (details_entry or {}).get("device_id") or "").strip()
    if not did:
        return None

    live_ports = api1_item.get("ports") or []
    detail_ports = (details_entry or {}).get("ports") or []

    # Overlay live API1 port statuses onto persisted API2 port metadata
    live_by_outlet: dict[int, dict[str, Any]] = {}
    for lp in live_ports:
        try:
            live_by_outlet[int(lp.get("outlet_number"))] = lp
        except (TypeError, ValueError):
            pass

    merged_ports: list[dict[str, Any]] = []
    if detail_ports:
        for idx, dp in enumerate(detail_ports):
            onum = int(dp.get("outletNumber") or (idx + 1))
            lp = live_by_outlet.get(onum)
            raw_st = (lp.get("status") if lp else None) or dp.get("status") or api1_item.get("station_status")
            norm_st = _normalize_cp_status(raw_st)
            conn_list = [
                {
                    **c,
                    "status": _normalize_cp_status((lp.get("status") if lp else None) or c.get("status") or norm_st),
                }
                for c in (dp.get("connectorList") or [])
            ]
            merged_ports.append({**dp, "status": norm_st, "connectorList": conn_list})
    else:
        api1_lvl = "DC" if str(api1_item.get("display_level") or "").upper() == "DC" else "L2"
        api1_mp = api1_item.get("max_power") or {}
        for idx, lp in enumerate(live_ports):
            norm_st = _normalize_cp_status(lp.get("status") or api1_item.get("station_status"))
            merged_ports.append({
                "outletNumber": lp.get("outlet_number") or (idx + 1),
                "status": norm_st,
                "level": api1_lvl,
                "displayLevel": str(api1_item.get("display_level") or "AC"),
                "powerRange": {
                    "max": lp.get("available_power") or api1_mp.get("max") or 6.6,
                    "unit": api1_mp.get("unit") or "kW",
                },
                "connectorList": [
                    {
                        "plugType": "J1772" if api1_lvl != "DC" else "PLUG",
                        "displayPlugType": "J1772" if api1_lvl != "DC" else "Combo",
                        "status": norm_st,
                    }
                ],
            })

    # Enforce strict Available requirement: at least one port Available (or station_status == available if ports empty)
    avail_ports = [p for p in merged_ports if p.get("status") == "Available"]
    st_status_norm = _normalize_cp_status(api1_item.get("station_status"))
    is_station_available = len(avail_ports) > 0 or (len(merged_ports) == 0 and st_status_norm == "Available")
    if not is_station_available:
        return None

    lat = (details_entry or {}).get("lat") if (details_entry or {}).get("lat") is not None else api1_item.get("lat")
    lon = (details_entry or {}).get("lon") if (details_entry or {}).get("lon") is not None else api1_item.get("lon")
    if lat is None or lon is None:
        return None

    sp = (details_entry or {}).get("stationPrice") or {}
    is_free = bool(sp.get("free") is True or str(api1_item.get("payment_type") or "").strip().lower() == "free")

    # Collect searchable connector tokens + clean display specs + max power
    connector_tokens: list[str] = []
    display_specs: list[str] = []
    max_kw = 0.0
    power_unit = "kW"
    levels: list[str] = []

    for p in merged_ports:
        lvl = str(p.get("level") or "").strip()
        if lvl and lvl not in levels:
            levels.append(lvl)
        pr = p.get("powerRange") or {}
        if pr.get("unit"):
            power_unit = str(pr["unit"]).strip()
        try:
            kw_val = float(pr.get("max") or 0)
            if kw_val > max_kw:
                max_kw = kw_val
        except (TypeError, ValueError):
            pass
        for c in (p.get("connectorList") or []):
            dplug = str(c.get("displayPlugType") or c.get("plugType") or "").strip()
            if dplug and dplug not in display_specs:
                display_specs.append(dplug)
            tok = _connector_filter_token(dplug, c.get("plugType"))
            if tok and tok not in connector_tokens:
                connector_tokens.append(tok)

    if max_kw <= 0:
        try:
            max_kw = float((api1_item.get("max_power") or {}).get("max") or 6.6)
        except (TypeError, ValueError):
            max_kw = 6.6

    host_name = (details_entry or {}).get("hostName") or (
        " ".join(p for p in [api1_item.get("name1"), api1_item.get("name2")] if p).strip() or f"ChargePoint #{did}"
    )
    address1 = (details_entry or {}).get("address1") or api1_item.get("address1") or ""
    city = (details_entry or {}).get("city") or api1_item.get("city") or ""
    network_name = (details_entry or {}).get("networkDisplayName") or api1_item.get("network_display_name") or "ChargePoint Network"
    port_count = int((details_entry or {}).get("portCount") or api1_item.get("total_port_count") or len(merged_ports) or 1)
    cost_summary = _format_cp_cost_summary(sp, is_free=is_free)

    props = {
        "id": f"ev_cp_{did}",
        "device_id": did,
        "facility_type": "ev_charging",
        "source": "chargepoint",
        "name": host_name,
        "host_name": host_name,
        "address": address1,
        "address1": address1,
        "city": city,
        "local_area": address1 or city or "Metro Vancouver",
        "operator": network_name,
        "network_display_name": network_name,
        "status": "Available",
        "available_ports": len(avail_ports) or 1,
        "ports": port_count,
        "level": levels[0] if levels else ("DC" if max_kw >= 25 else "L2"),
        "connectors": ", ".join(connector_tokens) if connector_tokens else "J1772",
        "connector_specs": display_specs,
        "power_kw": round(max_kw, 2),
        "max_power_kw": round(max_kw, 2),
        "power_unit": power_unit,
        "voltage": f"{max_kw:g} {power_unit}",
        "is_free": is_free,
        "free_of_charge": is_free,
        "cost": cost_summary,
        "description": (details_entry or {}).get("description"),
        "access_restriction": (details_entry or {}).get("accessRestriction") or api1_item.get("access_restriction") or "NONE",
        "start_methods": (details_entry or {}).get("startChargeConfig") or [],
        "ports_info": merged_ports,
        "station_price": sp,
        "lat": round(float(lat), 6),
        "lon": round(float(lon), 6),
    }

    return {
        "type": "Feature",
        "id": f"ev_cp_{did}",
        "geometry": {
            "type": "Point",
            "coordinates": [round(float(lon), 6), round(float(lat), 6)],
        },
        "properties": props,
    }


def _load_details_cache() -> dict[str, dict[str, Any]]:
    if not os.path.exists(DETAILS_CACHE_FILE):
        return {}
    try:
        with open(DETAILS_CACHE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            return raw.get("devices") if isinstance(raw.get("devices"), dict) else {}
    except Exception:
        pass
    return {}


def _save_details_cache(devices_map: dict[str, dict[str, Any]]) -> None:
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_devices": len(devices_map),
        "devices": devices_map,
    }
    _atomic_write_json(DETAILS_CACHE_FILE, payload)


def _build_live_payload(
    features: list[dict[str, Any]],
    total_catalog_devices: int,
    ok_count: int,
    err_count: int,
    partial: bool = False,
    source_label: str = "ChargePoint API2 Hourly + Live Availability",
) -> tuple[str, dict[str, Any], int]:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total_avail_ports = sum(int((ft.get("properties") or {}).get("available_ports") or 0) for ft in features)
    payload = {
        "type": "FeatureCollection",
        "updated_at": now_iso,
        "source": source_label,
        "partial": partial,
        "total_catalog_devices": total_catalog_devices,
        "api2_ok": ok_count,
        "api2_errors": err_count,
        "available_stations": len(features),
        "available_ports": total_avail_ports,
        "features": features,
    }
    return now_iso, payload, total_avail_ports


def sync_chargepoint_live_statuses_fast(
    update_admin_meta: bool = True,
    details_by_device: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Fast ~2s live status sync via ChargePoint API1 grid sweep overlaid onto persisted API2 details cache.
    """
    t0 = time.time()
    live_catalog = crawl_chargepoint_api1(save_catalog=False)
    live_devices = live_catalog.get("devices") or []
    if not live_devices:
        return []

    if details_by_device is None:
        details_by_device = _load_details_cache()

    features: list[dict[str, Any]] = []
    for dev in live_devices:
        did = str(dev.get("device_id") or "").strip()
        feat = _build_cp_feature(dev, details_by_device.get(did))
        if feat is not None:
            features.append(feat)

    now_iso, payload_out, total_avail_ports = _build_live_payload(
        features,
        len(live_devices),
        len(features),
        0,
        partial=False,
        source_label="ChargePoint API1 Live + API2 Details Cache",
    )
    _atomic_write_json(LIVE_CACHE_FILE, payload_out)
    if update_admin_meta:
        update_admin_source_metadata("ev_charging_chargepoint", len(features), updated_at=now_iso)
    elapsed = round(time.time() - t0, 1)
    print(
        f"⚡ [ChargePoint Live Fast] 即時狀態同步完成 ({elapsed}s): 可用站點 {len(features)}/{len(live_devices)} 座 "
        f"(可用充電槍 {total_avail_ports} 支) -> {LIVE_CACHE_FILE}",
        flush=True,
    )
    return features


def fetch_single_chargepoint_live(device_id: str) -> dict[str, Any] | None:
    """
    Fetch real-time ChargePoint API2 station details & live port statuses when clicked on the map.
    """
    did = str(device_id or "").strip()
    if not did:
        return None
    gate = _RateLimitGate()
    payload = _fetch_cp_info(did, gate)
    if not isinstance(payload, dict):
        return None

    addr = payload.get("address") or {}
    net = payload.get("network") or {}
    ports = _normalize_ports_from_api2(payload, live_ports_override=None)
    avail_count = sum(1 for p in ports if p.get("status") == "Available")
    overall_status = (
        "Available"
        if avail_count > 0
        else (ports[0]["status"] if ports else _normalize_cp_status(payload.get("stationStatus")))
    )
    sp = payload.get("stationPrice") if isinstance(payload.get("stationPrice"), dict) else {}
    start_methods = [
        str(cfg.get("type")).strip()
        for cfg in (payload.get("startChargeConfig") or [])
        if isinstance(cfg, dict) and cfg.get("type")
    ]

    return {
        "device_id": did,
        "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "host_name": str(payload.get("hostName") or "").strip(),
        "address1": str(addr.get("address1") or "").strip(),
        "city": str(addr.get("city") or "").strip(),
        "network_display_name": str(net.get("displayName") or "ChargePoint Network").strip(),
        "description": str(payload.get("description") or "").strip() or None,
        "access_restriction": str(payload.get("accessRestriction") or "NONE").strip(),
        "start_methods": start_methods,
        "status": overall_status,
        "available_count": avail_count,
        "total_count": int(((payload.get("portsInfo") or {}).get("portCount")) or len(ports) or 1),
        "is_free": bool(sp.get("free") is True),
        "ports_info": ports,
        "station_price": sp,
    }


def refresh_chargepoint_api2(
    max_workers: int = 6,
    update_admin_meta: bool = True,
    limit_devices: int | None = None,
) -> list[dict[str, Any]]:
    """
    Hourly API2 detail & pricing hydration across cataloged ChargePoint stations (`chargepoint_ev_details_cache.json`),
    followed by a synchronized API1 live status pass writing `chargepoint_ev_live_cache.json`.
    """
    t0 = time.time()
    catalog: dict[str, Any] | None = None
    if os.path.exists(DEVICES_CATALOG_FILE):
        try:
            with open(DEVICES_CATALOG_FILE, "r", encoding="utf-8") as f:
                catalog = json.load(f)
        except Exception as e:
            print(f"  ⚠️ 讀取 chargepoint_ev_devices.json 失敗，將重新執行 API1 爬取: {e}")

    if not catalog or not catalog.get("devices"):
        catalog = crawl_chargepoint_api1(save_catalog=True)

    devices_raw = catalog.get("devices") or []
    if limit_devices is not None and limit_devices > 0:
        devices_raw = devices_raw[:limit_devices]

    devices_by_id: dict[str, dict[str, Any]] = {
        str(d["device_id"]).strip(): d for d in devices_raw if d.get("device_id")
    }
    print(
        f"⚡ [ChargePoint API2] 正在查詢 {len(devices_by_id)} 座 ChargePoint 充電站詳細費率與規格 (max_workers={max_workers})...",
        flush=True,
    )

    details_by_device = _load_details_cache()
    gate = _RateLimitGate()
    ok_count = 0
    err_count = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {pool.submit(_fetch_cp_info, did, gate): did for did in devices_by_id}
        for fut in as_completed(future_map):
            did = future_map[fut]
            done_count += 1
            res = fut.result()
            if res:
                ok_count += 1
                details_by_device[did] = _extract_details_entry(devices_by_id[did], res)
            else:
                err_count += 1

            if done_count % 200 == 0 and done_count < len(devices_by_id):
                _save_details_cache(details_by_device)
                print(
                    f"  ⏳ [ChargePoint API2] 進度 {done_count}/{len(devices_by_id)} 座 "
                    f"(成功 {ok_count}, 失敗 {err_count}, {round(time.time() - t0, 1)}s)",
                    flush=True,
                )

    if details_by_device:
        _save_details_cache(details_by_device)

    if limit_devices is None:
        try:
            synced = sync_chargepoint_live_statuses_fast(
                update_admin_meta=update_admin_meta,
                details_by_device=details_by_device,
            )
            if synced:
                elapsed = round(time.time() - t0, 1)
                print(
                    f"✅ [ChargePoint API2 + Live] 完整更新完成 ({elapsed}s): 詳細快取 {len(details_by_device)} 座, "
                    f"目前可用 {len(synced)} 座",
                    flush=True,
                )
                return synced
        except Exception as sync_err:
            print(f"  ⚠️ [ChargePoint API2] 結束同步 API1 狀態失敗，改用 API2 批次結果: {sync_err}")

    features: list[dict[str, Any]] = []
    for did, dev in devices_by_id.items():
        feat = _build_cp_feature(dev, details_by_device.get(did))
        if feat is not None:
            features.append(feat)

    now_iso, payload_out, total_avail_ports = _build_live_payload(
        features,
        len(devices_by_id),
        ok_count,
        err_count,
        partial=False,
    )
    if features or ok_count > 0:
        _atomic_write_json(LIVE_CACHE_FILE, payload_out)
        if update_admin_meta:
            update_admin_source_metadata("ev_charging_chargepoint", len(features), updated_at=now_iso)
    elapsed = round(time.time() - t0, 1)
    print(
        f"✅ [ChargePoint API2] 即時狀態同步完成 ({elapsed}s): {ok_count}/{len(devices_by_id)} 成功, "
        f"可用站點 {len(features)} 座 (可用充電槍 {total_avail_ports} 支) -> {LIVE_CACHE_FILE}",
        flush=True,
    )
    return features


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode == "api1":
        crawl_chargepoint_api1(save_catalog=True)
    elif mode == "fast":
        sync_chargepoint_live_statuses_fast(update_admin_meta=True)
    elif mode == "api2":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else None
        refresh_chargepoint_api2(limit_devices=limit)
    else:
        crawl_chargepoint_api1(save_catalog=True)
        refresh_chargepoint_api2()
