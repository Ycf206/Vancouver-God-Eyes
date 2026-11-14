"""
Metro Vancouver Regional Water Supply & Sewerage System GIS Layer Updater.

Fetches public point and facility-centroid location features from Metro Vancouver's
ArcGIS MapServer (MV2U/MVMapX/MapServer — powering gis.metrovancouver.org/mvmaps/Water
and /mvmaps/sewer), decodes ArcGIS coded-value domains and subtypes into clean
bilingual properties, and saves normalized GeoJSONs atomically to backend/data and
frontend/public for the OCI hourly scheduler.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import re
import sys
from typing import Any
from zoneinfo import ZoneInfo

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import get_source_endpoint_url, save_layer_geojson, update_admin_source_metadata

DEFAULT_MV_MAPSERVER = "https://gis.metrovancouver.org/arcgis/rest/services/MV2U/MVMapX/MapServer"
EPOCH_UTC = datetime(1970, 1, 1, tzinfo=timezone.utc)
VAN_TZ = ZoneInfo("America/Vancouver")
SENTINEL_1900_MS = -2209132800000

HEADERS = {
    "User-Agent": "VancouverGodsEye/2.0 (+https://vancouvergodseye.ca)",
    "Accept": "application/json",
}

STREET_DIR_FIXES = {
    "N": "N", "S": "S", "E": "E", "W": "W",
    "Ne": "NE", "Nw": "NW", "Se": "SE", "Sw": "SW",
    "Bc": "BC", "Uv": "UV", "Cso": "CSO", "Sso": "SSO",
    "Wwtp": "WWTP", "Gv": "GV", "Gvw": "GVW", "Gvwd": "GVWD", "Gvrd": "GVRD",
}

INACTIVE_WATER_STATUSES = {
    "非運行", "已停用", "已除役", "除役中", "規劃中", "待核准", "已拆除",
    "inactive", "abandoned", "decommissioned", "decommissioning",
    "removed", "to be approved", "proposed", "future", "retired",
    "closed", "demolished", "not available", "unknown", "na", "n/a",
}

WATER_SUBTYPE_ZH = {
    "Ozonation Station": "臭氧水處理站",
    "Treatment Plant": "淨水廠",
    "Water Treatment Plant": "淨水廠",
    "Air Valve Chamber": "排氣閥井室",
    "Valve Chamber": "閥門井室",
    "Meter Chamber": "流量計井室",
    "Reservoir": "蓄水池 / 水庫",
    "Diversion Chamber": "分流井室",
    "Junction Chamber": "匯流井室",
    "Pump Station": "供水泵站",
    "Water Pump Station": "供水泵站",
    "Blowdown Chamber": "排空閥井室",
    "UV Facility": "紫外線消毒設施",
    "UV Disinfection Facility": "紫外線消毒設施",
    "Chlorination Building": "加氯消毒設施",
    "Re-Chlorination Station": "二次加氯站",
    "Energy Recovery Facility": "能量回收設施",
    "Reservoir - Tank": "蓄水塔槽",
    "Crossover Chamber": "聯絡管井室",
    "Water Main": "輸水幹管",
    "Water Manhole": "供水檢修井 / 人孔",
    "Water Pump": "供水泵",
    "Water Supply Dam": "供水水壩",
    "Water Ozonation Plant": "臭氧水處理廠",
    "Water Facility Building": "供水建築設施",
}

SEWER_SUBTYPE_ZH = {
    "Flushing Chamber": "沖洗井室",
    "Separation Chamber": "分離井室",
    "Inspection Chamber": "檢查井室",
    "Lift Station": "污水提升泵站",
    "Pump Station": "污水泵站",
    "PumpStation": "污水泵站",
    "PUMP STATION": "污水泵站管線",
    "Sewer Pump Station": "污水泵站",
    "Inlet Chamber": "進水井室",
    "Valve Chamber": "閥門井室",
    "Utility Chamber": "公用設施井室",
    "Billing Chamber": "計量收費井室",
    "Treatment Plant": "污水處理廠",
    "Wastewater Treatment Plant": "污水處理廠",
    "Siphon Chamber": "倒虹吸井室",
    "Outlet Chamber": "出水井室",
    "Regulating Chamber": "調節井室",
    "Sump Chamber": "集水井室",
    "Diversion Chamber": "分流井室",
    "Weir": "溢流堰",
    "CSO": "合流制污水溢流口",
    "SSO": "分流制污水排放口",
    "WWTP Outfall": "污水處理廠排放口",
    "Gate": "閘閥",
    "Control": "控制閥",
    "Isolation": "隔離閥",
    "Check": "止回閥",
    "Plug": "旋塞閥",
    "Knife": "刀閘閥",
    "Ball": "球閥",
    "Diaphragm": "隔膜閥",
    "Air": "排氣閥",
    "BlowDown": "排空閥",
    "Pressure Regulator": "減壓閥",
    "Regulator": "調節閥",
    "Three Way": "三通閥",
    "Globe": "截止閥",
    "Flow": "流量監測",
    "Level": "液位監測",
    "Permanent": "永久式",
    "Active": "運行中",
    "Acitve": "運行中",
    "Proposed": "規劃中",
    "Abandoned": "已停用",
    "Decommissioned": "已除役",
    "Decommissioning": "除役中",
    "Inactive": "非運行",
    "Removed": "已拆除",
    "To be approved": "待核准",
    "Temporary": "臨時",
    "TrunkSewer": "幹管污水管",
    "Interceptor": "截流污水管",
    "Force": "壓力污水輸送管",
    "Pressure": "壓力污水管",
    "Collector": "匯流污水支管",
    "Diversion": "污水分配管",
    "ReliefSewer": "減壓分流污水管",
    "Siphon": "倒虹吸污水管",
    "TrunkDrain": "排水幹線",
    "Outfall/Overflow": "排放 / 溢流管",
    "Intake": "進水管",
    "Other": "其他污水管線",
}

MATERIAL_ZH = {
    "CONC": "混凝土",
    "Concrete": "混凝土",
    "RCON": "鋼筋混凝土",
    "Concrete - Reinforced": "鋼筋混凝土",
    "PVC": "聚氯乙烯管",
    "Poly Vinyl Chloride": "聚氯乙烯管",
    "PLST": "塑膠管",
    "HDPE": "高密度聚乙烯管",
    "High-density polyethylene": "高密度聚乙烯管",
    "DI": "延性鑄鐵",
    "Iron - Ductile": "延性鑄鐵",
    "CI": "鑄鐵",
    "Iron - Cast": "鑄鐵",
    "STL": "鋼材",
    "Steel": "鋼材",
    "FRP": "玻璃纖維強化塑膠",
    "FGRP": "玻璃纖維強化塑膠",
    "Fiberglass Reinforced Plastic": "玻璃纖維強化塑膠",
    "AC": "石棉水泥管",
    "Asbestos Cement": "石棉水泥管",
    "BRK": "磚砌",
    "Brick": "磚砌",
    "CMP": "波紋金屬管",
    "Corrugated Metal": "波紋金屬管",
    "CL": "陶管",
    "Clay": "陶管",
    "VC": "玻璃化黏土陶管",
    "ALUM": "鋁材",
    "Aluminum": "鋁材",
    "OTH": "其他材質",
    "Other": "其他材質",
}

XSECTION_ZH = {
    "Crclr": "圓形",
    "Circular": "圓形",
    "Box": "箱形 / 矩形",
    "ArcCvt": "拱形涵洞",
    "Hrsshe": "馬蹄形",
    "BHS": "籃柄形",
    "STLHS": "鋼結構馬蹄形",
    "Othr": "其他斷面",
}

# (arcgis_layer_id, default_sub_type_en, default_sub_type_zh)
WATER_LAYERS: list[tuple[int, str, str]] = [
    (43, "Water Treatment Plant", "淨水廠"),
    (27, "Reservoir", "蓄水池 / 水庫"),
    (41, "Water Supply Dam", "供水水壩"),
    (65, "Water Pump Station", "供水泵站"),
    (63, "Chlorination Building", "加氯消毒設施"),
    (66, "Re-Chlorination Station", "二次加氯站"),
    (67, "UV Disinfection Facility", "紫外線消毒設施"),
    (64, "Water Ozonation Plant", "臭氧水處理廠"),
    (44, "Water Facility Building", "供水建築設施"),
    (40, "Water Pump", "供水泵"),
    (28, "Water Manhole", "供水檢修井 / 人孔"),
]

SEWER_LAYERS: list[tuple[int, str, str]] = [
    (22, "Wastewater Treatment Plant", "污水處理廠"),
    (194, "CSO Notification Site", "合流制污水溢流監測站"),
    (177, "SSO Notification Site", "分流制污水溢流通報"),
    (74, "Sewer Pump Station", "污水泵站"),
    (82, "Sewer Outfall", "污水排放口"),
    (199, "Permanent Sewer Flow Meter", "永久污水流量計"),
    (62, "Sewer Facility Building", "污水建築設施"),
    (25, "Sewer Pump", "污水泵"),
    (53, "Sewer Valve", "污水閥門"),
    (23, "Sewer Maintenance Hole", "污水檢修井 / 人孔"),
]


def _clean_str(val: Any) -> str:
    if val is None:
        return ""
    s = re.sub(r"\s+", " ", str(val)).strip()
    if s.lower() in ("none", "null", "unknown", "not available", "n/a", "na", "unk", "<null>"):
        return ""
    return s


def _strip_trailing_en(val: str) -> str:
    """移除中文名詞後綴之括號英文，並過濾純數字或無效代碼。"""
    s = _clean_str(val)
    if not s:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", s):
        return ""
    s = re.sub(r"\s*\([A-Za-z0-9\s\-/&,+.]+\)\s*$", "", s).strip()
    return s


def _is_water_operational(raw_status: str) -> bool:
    """檢查供水設施是否為運行中狀態（含無生命週期欄位之主力點位圖層）。"""
    s = _clean_str(raw_status)
    if not s:
        return True
    return s.lower() not in INACTIVE_WATER_STATUSES


def _translate_material(raw_mat: str) -> str:
    s = _clean_str(raw_mat)
    if not s:
        return ""
    if s in MATERIAL_ZH:
        return MATERIAL_ZH[s]
    s_lower = s.lower()
    for k, v in MATERIAL_ZH.items():
        if k.lower() == s_lower:
            return v
    return _strip_trailing_en(s)


def _smart_title(text: str) -> str:
    s = _clean_str(text)
    if not s:
        return ""
    # Preserve mixed-case strings unless all-uppercase (e.g. "4263 LYNN VALLEY RD")
    if not s.isupper():
        return s
    words = s.title().split(" ")
    fixed = [STREET_DIR_FIXES.get(w, w) for w in words]
    return " ".join(fixed)


def _format_epoch_ms(val: Any, with_time: bool = False) -> str:
    if val is None or isinstance(val, bool):
        return ""
    try:
        ms = float(val)
    except (TypeError, ValueError):
        return ""
    if with_time:
        if 0 <= ms < 86400000:
            return ""
    else:
        if abs(ms - SENTINEL_1900_MS) < 86400000 * 3:
            return ""
    try:
        dt = EPOCH_UTC + timedelta(milliseconds=ms)
        if with_time:
            return dt.astimezone(VAN_TZ).strftime("%Y-%m-%d %H:%M")
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""


def _ring_centroid(ring: list[list[float]]) -> tuple[float, float] | None:
    if not ring or len(ring) < 3:
        return None
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area) > 1e-12:
        area *= 0.5
        return round(cx / (6.0 * area), 6), round(cy / (6.0 * area), 6)
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return round(sum(xs) / len(xs), 6), round(sum(ys) / len(ys), 6)


def _extract_point_coords(geom: dict[str, Any] | None) -> tuple[float, float] | None:
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if gtype == "Point" and len(coords) >= 2:
        return round(float(coords[0]), 6), round(float(coords[1]), 6)
    if gtype == "MultiPoint" and isinstance(coords[0], (list, tuple)):
        return round(float(coords[0][0]), 6), round(float(coords[0][1]), 6)
    if gtype == "LineString" and len(coords) >= 1:
        mid = coords[len(coords) // 2]
        return round(float(mid[0]), 6), round(float(mid[1]), 6)
    if gtype == "MultiLineString" and coords:
        longest = max(coords, key=len)
        if longest:
            mid = longest[len(longest) // 2]
            return round(float(mid[0]), 6), round(float(mid[1]), 6)
    if gtype == "Polygon" and coords and coords[0]:
        return _ring_centroid(coords[0])
    if gtype == "MultiPolygon" and coords and coords[0] and coords[0][0]:
        return _ring_centroid(coords[0][0])
    return None


def _fetch_layer_metadata(base_url: str, layer_id: int) -> dict[str, Any]:
    resp = requests.get(f"{base_url}/{layer_id}", params={"f": "json"}, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    meta = resp.json()
    domains: dict[str, dict[str, str]] = {}
    for f in meta.get("fields") or []:
        dom = f.get("domain")
        if isinstance(dom, dict) and dom.get("codedValues"):
            domains[f["name"]] = {str(cv["code"]): str(cv["name"]) for cv in dom["codedValues"]}
    subtype_field = meta.get("subtypeField") or ""
    subtypes: dict[str, str] = {}
    for st in meta.get("types") or []:
        if st.get("id") is not None and st.get("name"):
            subtypes[str(st["id"])] = str(st["name"])
    return {
        "name": meta.get("name") or f"Layer {layer_id}",
        "max_record_count": min(int(meta.get("maxRecordCount") or 2000), 2000),
        "domains": domains,
        "subtype_field": subtype_field,
        "subtypes": subtypes,
    }


def _fetch_layer_geojson(
    base_url: str,
    layer_id: int,
    max_record_count: int,
    extra_params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    all_features: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, Any] = {
            "where": "1=1",
            "outFields": "*",
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": max_record_count,
            "f": "geojson",
        }
        if extra_params:
            params.update(extra_params)
        payload = None
        last_err: Exception | None = None
        for _attempt in range(3):
            try:
                resp = requests.get(
                    f"{base_url}/{layer_id}/query",
                    params=params,
                    headers=HEADERS,
                    timeout=(10, 45),
                )
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception as exc:
                last_err = exc
        if payload is None:
            raise RuntimeError(f"MapServer layer {layer_id} fetch failed: {last_err}")
        if "error" in payload:
            raise RuntimeError(f"MapServer layer {layer_id} error: {payload['error']}")
        batch = payload.get("features") or []
        all_features.extend(batch)
        if not payload.get("exceededTransferLimit") and len(batch) < max_record_count:
            break
        if not batch:
            break
        offset += len(batch)
    return all_features


def _decode_attr(raw: dict[str, Any], key: str, meta: dict[str, Any]) -> str:
    val = _clean_str(raw.get(key))
    if not val:
        return ""
    return meta["domains"].get(key, {}).get(val, val)


def _normalize_feature(
    raw_feat: dict[str, Any],
    facility_type: str,
    layer_id: int,
    default_sub_en: str,
    default_sub_zh: str,
    meta: dict[str, Any],
) -> dict[str, Any] | None:
    pt = _extract_point_coords(raw_feat.get("geometry"))
    if not pt:
        return None
    lon, lat = pt
    if not (-124.0 <= lon <= -121.0 and 48.5 <= lat <= 50.0):
        return None

    raw = raw_feat.get("properties") or {}
    oid = raw.get("OBJECTID") or raw_feat.get("id")
    feat_id = f"{facility_type}_{layer_id}_{oid}" if oid is not None else f"{facility_type}_{layer_id}_{lon:.5f}_{lat:.5f}"

    # Resolve coded subtype if present (Water Buildings 44, Sewer Buildings 62, Valves 53, Outfalls 82)
    sub_en = default_sub_en
    sub_zh = default_sub_zh
    subtype_code = ""
    for candidate_key in (meta.get("subtype_field"), "SubtypeField", "StructSubtype", "VSubtype", "DPSubtype"):
        if candidate_key and raw.get(candidate_key) is not None:
            subtype_code = _clean_str(raw.get(candidate_key))
            break
    if subtype_code and subtype_code in meta.get("subtypes", {}):
        resolved_st = meta["subtypes"][subtype_code]
        if resolved_st and resolved_st.lower() != "other":
            sub_en = resolved_st if layer_id != 53 else f"{resolved_st} Valve"
            domain_map = WATER_SUBTYPE_ZH if facility_type == "water_supply" else SEWER_SUBTYPE_ZH
            sub_zh = domain_map.get(resolved_st) or default_sub_zh
    sub_zh = _strip_trailing_en(sub_zh) or _strip_trailing_en(default_sub_zh)

    address = _smart_title(raw.get("StreetAddress") or raw.get("Location") or "")
    municipality = _smart_title(raw.get("Municipality") or "")
    owner = _decode_attr(raw, "Owner", meta)
    plan_area = _decode_attr(raw, "PlanArea", meta)
    sewerage_area = _decode_attr(raw, "SewerageArea", meta)
    raw_status = _decode_attr(raw, "LifeCycleStatus", meta) or _clean_str(raw.get("Status"))
    if facility_type == "water_supply" and not _is_water_operational(raw_status):
        return None
    status = "" if facility_type == "water_supply" else SEWER_SUBTYPE_ZH.get(raw_status, raw_status)
    acronym = _clean_str(raw.get("Acronym") or raw.get("DamAcronym"))
    site_code = _clean_str(raw.get("SiteCode") or raw.get("Code_id") or raw.get("MDB_code"))
    mh_name = _clean_str(raw.get("MHName"))
    parent_facility = _clean_str(raw.get("ParentFacility"))
    facility_section = _clean_str(raw.get("FacilitySection"))
    facility_desc = _clean_str(raw.get("FacilityDescription") or raw.get("MHDescription"))
    raw_name = _clean_str(raw.get("Name") or raw.get("DamName"))
    alt_name = _clean_str(raw.get("DamNameAlternate"))
    data_tag = _clean_str(raw.get("DataTag"))
    material_raw = _decode_attr(raw, "Material", meta)
    material = _translate_material(material_raw)

    # Construct clear, human-readable display name for map popup & TopBar search
    if layer_id == 41:
        title = f"{raw_name} ({alt_name})" if (raw_name and alt_name and alt_name.lower() not in raw_name.lower()) else (raw_name or default_sub_en)
    elif layer_id == 22 and raw_name:
        title = f"{raw_name} Wastewater Treatment Plant" if "treatment" not in raw_name.lower() else raw_name
    elif layer_id == 194:
        base_n = raw_name or site_code or "CSO Site"
        title = f"{base_n} CSO ({site_code})" if site_code and site_code not in base_n else f"{base_n} CSO"
    elif layer_id == 177:
        alarm_id = _clean_str(raw.get("AlarmID"))
        title = f"SSO Notification #{alarm_id}" if alarm_id else f"SSO Notification #{oid}"
    elif layer_id == 199:
        sc = site_code or _clean_str(raw.get("MDB_code"))
        is_coord_addr = bool(re.fullmatch(r"-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?", address))
        if sc and address and not is_coord_addr:
            title = f"Flow Meter {sc} · {address}"
        elif sc and municipality:
            title = f"Flow Meter {sc} ({municipality})"
        elif sc:
            title = f"Flow Meter {sc}"
        else:
            title = (municipality if is_coord_addr and municipality else address) or f"Flow Meter #{oid}"
    elif layer_id == 82 and raw_name:
        title = f"{raw_name} Outfall ({site_code})" if site_code else f"{raw_name} ({sub_en})"
    elif layer_id in (27, 43, 65, 66, 67, 74) and raw_name:
        title = raw_name
    elif layer_id == 28:
        label = mh_name or "Manhole"
        title = f"Water {label} · {address}" if address else (f"Water Manhole {mh_name}" if mh_name else f"Water Manhole #{oid}")
    elif layer_id == 23:
        if parent_facility and mh_name:
            title = f"{parent_facility} ({mh_name})"
        elif facility_desc and address:
            title = f"{facility_desc} · {address}"
        elif mh_name and address:
            title = f"Sewer {mh_name} · {address}"
        else:
            title = parent_facility or facility_desc or mh_name or (f"Sewer Manhole · {address}" if address else f"Sewer Manhole #{oid}")
    elif layer_id in (44, 62, 53):
        code_suffix = acronym or (f"#{oid}" if oid is not None else "")
        title = f"{sub_en} · {code_suffix}" if code_suffix else sub_en
    elif layer_id in (25, 40):
        code_suffix = data_tag or acronym or (f"#{oid}" if oid is not None else "")
        title = f"{default_sub_en} ({code_suffix})" if code_suffix else default_sub_en
    else:
        title = raw_name or (f"{sub_en} #{oid}" if oid is not None else sub_en)

    props: dict[str, Any] = {
        "id": feat_id,
        "facility_type": facility_type,
        "name": title,
        "sub_type": sub_en,
        "sub_type_zh": sub_zh,
        "source_layer_id": layer_id,
        "source_layer_name": meta.get("name"),
    }

    # Attach non-empty fields dynamically (so popup renders only retrieved values)
    optional_fields: dict[str, Any] = {
        "local_area": municipality or plan_area,
        "municipality": municipality,
        "address": address,
        "owner": "Metro Vancouver (GVRD)" if owner == "GV" else owner,
        "plan_area": plan_area,
        "sewerage_area": sewerage_area,
        "status": status,
        "acronym": acronym,
        "site_code": site_code,
        "parent_facility": parent_facility,
        "facility_section": facility_section,
        "description": facility_desc if facility_desc != title else "",
        "other_note": _clean_str(raw.get("OtherNote")) if _clean_str(raw.get("OtherNote")) != raw_name else "",
        "mh_name": mh_name,
        "mh_type": _clean_str(raw.get("MHType")),
        "mh_cover": _clean_str(raw.get("Cover")),
        "bolted": _clean_str(raw.get("Bolted")),
        "pressure_hatch": _clean_str(raw.get("PressureHatch")),
        "material": material,
        "x_section": _strip_trailing_en(XSECTION_ZH.get(_decode_attr(raw, "X_section", meta), _decode_attr(raw, "X_section", meta))),
        "diameter_mm": raw.get("Diameter") if raw.get("Diameter") not in (None, "", 0) else None,
        "width_barrel": raw.get("WidthBarrel") if raw.get("WidthBarrel") not in (None, "", 0) else None,
        "length_barrel": raw.get("LengthBarrel") if raw.get("LengthBarrel") not in (None, "", 0) else None,
        "chainage": _clean_str(raw.get("Chainage")),
        "invert_m": raw.get("Invert") if raw.get("Invert") is not None else None,
        "ground_elev_m": raw.get("Ground_Elev") if raw.get("Ground_Elev") is not None else None,
        "depth_to_invert_m": raw.get("DepthtoInvert") if raw.get("DepthtoInvert") not in (None, "", 0) else None,
        "measurement_type": SEWER_SUBTYPE_ZH.get(_decode_attr(raw, "MeasurementType", meta), _decode_attr(raw, "MeasurementType", meta)),
        "classification": _decode_attr(raw, "Classification", meta),
        "installation_type": SEWER_SUBTYPE_ZH.get(_decode_attr(raw, "InstallationType", meta), _decode_attr(raw, "InstallationType", meta)),
        "installed_date": _format_epoch_ms(raw.get("DateInstalled"), with_time=False),
        "basis_of_ownership": _decode_attr(raw, "BasisOfOwnership", meta),
        "ownership_ref": _clean_str(raw.get("OwnershipReference")),
        "facility_id": raw.get("FacilityID") if raw.get("FacilityID") is not None else None,
        "object_id": oid,
        "district_file_no": _clean_str(raw.get("DistrictFileNo") or raw.get("DamFileNoBC")),
        "drawing_no": _clean_str(raw.get("DrawingNo")),
        "sheet_no": _clean_str(raw.get("SheetNo")),
        "drawing_link_id": _clean_str(raw.get("DrawingLinkID")),
        "data_tag": data_tag,
        "comment": _clean_str(raw.get("Comment")),
        # Overflow / Alarm telemetry (SSO 177 & CSO 194)
        "alarm_id": _clean_str(raw.get("AlarmID")),
        "alarm_start": _format_epoch_ms(raw.get("AlarmStart"), with_time=True),
        "alarm_end": _format_epoch_ms(raw.get("AlarmEnd"), with_time=True),
        "threshold_exceeded": (
            "是 (超過警戒閾值)" if str(raw.get("isThresholdExceeded") or "").upper() == "T"
            else ("否 (正常)" if str(raw.get("isThresholdExceeded") or "").upper() == "F" else "")
        ),
        "incident_start": _format_epoch_ms(raw.get("IncidentStartDate"), with_time=True),
        "incident_end": _format_epoch_ms(raw.get("IncidentEndDate"), with_time=True),
    }

    for k, v in optional_fields.items():
        if v not in (None, ""):
            props[k] = v

    return {
        "type": "Feature",
        "id": feat_id,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": props,
    }


def _round_line_geometry(geom: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "LineString" and isinstance(coords, list) and len(coords) >= 2:
        pts = [[round(float(p[0]), 5), round(float(p[1]), 5)] for p in coords if len(p) >= 2]
        return {"type": "LineString", "coordinates": pts} if len(pts) >= 2 else None
    if gtype == "MultiLineString" and isinstance(coords, list):
        lines = [
            [[round(float(p[0]), 5), round(float(p[1]), 5)] for p in line if len(p) >= 2]
            for line in coords
            if isinstance(line, list) and len(line) >= 2
        ]
        lines = [ln for ln in lines if len(ln) >= 2]
        return {"type": "MultiLineString", "coordinates": lines} if lines else None
    return None


def _normalize_line_feature(
    raw_feat: dict[str, Any],
    facility_type: str,
    layer_id: int,
    default_sub_en: str,
    default_sub_zh: str,
    meta: dict[str, Any],
) -> dict[str, Any] | None:
    geom = _round_line_geometry(raw_feat.get("geometry"))
    if not geom:
        return None
    mid = _extract_point_coords(geom)
    if not mid or not (-124.0 <= mid[0] <= -121.0 and 48.5 <= mid[1] <= 50.0):
        return None

    raw = raw_feat.get("properties") or {}
    oid = raw.get("OBJECTID") or raw.get("objectid") or raw_feat.get("id")
    feat_id = f"{facility_type}_{layer_id}_{oid}" if oid is not None else f"{facility_type}_{layer_id}_{mid[0]:.5f}_{mid[1]:.5f}"

    raw_status = _decode_attr(raw, "LifeCycleStatus", meta) or _clean_str(raw.get("Status"))
    if facility_type == "water_supply" and not _is_water_operational(raw_status):
        return None
    status = "" if facility_type == "water_supply" else SEWER_SUBTYPE_ZH.get(raw_status, raw_status)

    parent_facility = _clean_str(raw.get("ParentFacility"))
    facility_section = _clean_str(raw.get("FacilitySection"))
    facility_desc = _clean_str(raw.get("FacilityDescription"))
    main_type = _clean_str(raw.get("MainType"))
    sub_en = main_type or default_sub_en
    domain_map = WATER_SUBTYPE_ZH if facility_type == "water_supply" else SEWER_SUBTYPE_ZH
    sub_zh = _strip_trailing_en(domain_map.get(main_type, default_sub_zh)) or _strip_trailing_en(default_sub_zh)

    if facility_type == "water_supply":
        title = parent_facility or facility_section or (f"{sub_zh} #{oid}" if oid is not None else sub_zh)
    else:
        title = parent_facility or facility_desc or facility_section or (f"{sub_zh} #{oid}" if oid is not None else sub_zh)

    owner = _decode_attr(raw, "Owner", meta)
    plan_area = _decode_attr(raw, "PlanArea", meta)
    sewerage_area = _decode_attr(raw, "SewerageArea", meta)
    material = _translate_material(_decode_attr(raw, "Material", meta))
    x_sec_raw = _decode_attr(raw, "CrossSectionShape", meta)
    x_section = _strip_trailing_en(XSECTION_ZH.get(x_sec_raw, x_sec_raw))
    dim_x = raw.get("DimX")
    dim_y = raw.get("DimY")

    props: dict[str, Any] = {
        "id": feat_id,
        "facility_type": facility_type,
        "name": title,
        "sub_type": sub_en,
        "sub_type_zh": sub_zh,
        "source_layer_id": layer_id,
        "source_layer_name": meta.get("name"),
        "is_line": True,
    }
    optional_fields: dict[str, Any] = {
        "owner": "Metro Vancouver (GVRD)" if owner == "GV" else owner,
        "plan_area": plan_area if facility_type != "water_supply" else "",
        "sewerage_area": sewerage_area,
        "status": status,
        "acronym": _clean_str(raw.get("Acronym")),
        "parent_facility": parent_facility if parent_facility != title else "",
        "facility_section": facility_section if facility_section != title else "",
        "description": facility_desc if facility_desc != title else "",
        "material": material,
        "x_section": x_section,
        "diameter_mm": dim_x if (dim_x not in (None, "", 0) and (not dim_y or dim_x == dim_y)) else None,
        "width_barrel": dim_x if (dim_x not in (None, "", 0) and dim_y not in (None, "", 0) and dim_x != dim_y) else None,
        "length_barrel": dim_y if (dim_x not in (None, "", 0) and dim_y not in (None, "", 0) and dim_x != dim_y) else None,
        "chainage": _clean_str(raw.get("Chainage")),
        "installed_date": _format_epoch_ms(raw.get("DateInstalled"), with_time=False),
        "facility_id": raw.get("FacilityID") if raw.get("FacilityID") is not None else None,
        "object_id": oid,
        "district_file_no": _clean_str(raw.get("DistrictFileNo")),
        "drawing_no": _clean_str(raw.get("DrawingNo")),
        "sheet_no": _clean_str(raw.get("SheetNo")),
        "comment": _clean_str(raw.get("Comments")),
    }
    for k, v in optional_fields.items():
        if v not in (None, ""):
            props[k] = v

    return {
        "type": "Feature",
        "id": feat_id,
        "geometry": geom,
        "properties": props,
    }


def _sync_mv_utility(
    source_id: str,
    facility_type: str,
    layers_cfg: list[tuple[int, str, str]],
    out_filename: str,
    line_layer_cfg: tuple[int, str, str] | None = None,
    line_out_filename: str | None = None,
) -> int:
    raw_url = get_source_endpoint_url(source_id, DEFAULT_MV_MAPSERVER)
    base_url = raw_url.rstrip("/") if raw_url and "MapServer" in raw_url else DEFAULT_MV_MAPSERVER
    features: list[dict[str, Any]] = []
    print(f"📡 開始抓取 Metro Vancouver [{source_id}] ({base_url})...")

    for layer_id, sub_en, sub_zh in layers_cfg:
        try:
            meta = _fetch_layer_metadata(base_url, layer_id)
            raw_feats = _fetch_layer_geojson(base_url, layer_id, meta["max_record_count"])
            added = 0
            for rf in raw_feats:
                norm = _normalize_feature(rf, facility_type, layer_id, sub_en, sub_zh, meta)
                if norm is not None:
                    features.append(norm)
                    added += 1
            print(f"  - [{layer_id}] {meta['name']}: {added} 筆點位")
        except Exception as e:
            print(f"  ⚠️ [{layer_id}] {sub_en} 抓取略過 ({e})")

    if not features:
        raise RuntimeError(f"Metro Vancouver [{source_id}] 未取得任何有效圖徵，中止覆寫！")

    line_features: list[dict[str, Any]] = []
    if line_layer_cfg and line_out_filename:
        l_id, l_en, l_zh = line_layer_cfg
        try:
            l_meta = _fetch_layer_metadata(base_url, l_id)
            raw_lines = _fetch_layer_geojson(
                base_url,
                l_id,
                l_meta["max_record_count"],
                extra_params={"maxAllowableOffset": "0.00005", "geometryPrecision": "5"},
            )
            for rl in raw_lines:
                norm_line = _normalize_line_feature(rl, facility_type, l_id, l_en, l_zh, l_meta)
                if norm_line is not None:
                    line_features.append(norm_line)
            print(f"  - [{l_id}] {l_meta['name']}: {len(line_features)} 條管線")
        except Exception as e:
            print(f"  ⚠️ [{l_id}] {l_en} 管線抓取略過 ({e})")

    save_layer_geojson(out_filename, features)
    if line_features and line_out_filename:
        save_layer_geojson(line_out_filename, line_features, compact=True)
    total_cnt = len(features) + len(line_features)
    update_admin_source_metadata(source_id, record_count=total_cnt)
    return total_cnt


def update_water_supply() -> int:
    """Fetch Metro Vancouver Water Supply points & Water Mains -> vancouver_water_supply.geojson + vancouver_water_mains.geojson."""
    return _sync_mv_utility(
        source_id="water_supply",
        facility_type="water_supply",
        layers_cfg=WATER_LAYERS,
        out_filename="vancouver_water_supply.geojson",
        line_layer_cfg=(29, "Water Main", "輸水幹管"),
        line_out_filename="vancouver_water_mains.geojson",
    )


def update_sewer_system() -> int:
    """Fetch Metro Vancouver Sewerage points & Sewers -> vancouver_sewer_system.geojson + vancouver_sewer_lines.geojson."""
    return _sync_mv_utility(
        source_id="sewer_system",
        facility_type="sewer_system",
        layers_cfg=SEWER_LAYERS,
        out_filename="vancouver_sewer_system.geojson",
        line_layer_cfg=(24, "Sewer", "污水幹管"),
        line_out_filename="vancouver_sewer_lines.geojson",
    )


if __name__ == "__main__":
    w_cnt = update_water_supply()
    s_cnt = update_sewer_system()
    print(f"🎉 Metro Vancouver 供水 ({w_cnt} 筆) & 污水 ({s_cnt} 筆) 圖層更新完成！")
