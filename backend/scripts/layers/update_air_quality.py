"""
Metro Vancouver Air Quality Health Index (AQHI) Polygon Layer Updater.

Scrapes Metro Vancouver AirMap AQHI Health Index boundary polygons
(gis.metrovancouver.org/arcgis/rest/services/MV2U/MVMapX/MapServer/1) and
joins live Environment Canada HPFX AQHI zone observations (AQ_OBS_{CGNDB}_CURRENT.xml)
to color each Metro Vancouver / Fraser Valley zone on the 1-10+ AQHI scale.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import sys
import xml.etree.ElementTree as ET
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import HEADERS, get_source_endpoint_url, load_existing_geojson, save_layer_geojson

AIR_BOUNDARIES_URL = (
    "https://gis.metrovancouver.org/arcgis/rest/services/MV2U/MVMapX/MapServer/1/query"
    "?where=OBJECTID%3E0&outFields=OBJECTID,CGNDB,NAME,NOM&outSR=4326&f=geojson"
)

HPFX_XML_TEMPLATE = (
    "https://hpfx.collab.science.gc.ca/{ymd}/WXO-DD/air_quality/aqhi/pyr/observation/realtime/xml/"
    "AQ_OBS_{cgndb}_CURRENT.xml"
)

# Exact 11-step AQHI palette matching ExplorePanel AQHI indicator bar (1..10, 10+)
AQHI_COLORS = [
    "#56b4e9",  # 1
    "#3399ff",  # 2
    "#0072b2",  # 3
    "#f0e442",  # 4
    "#e69f00",  # 5
    "#d55e00",  # 6
    "#cc3333",  # 7
    "#b22222",  # 8
    "#8b0000",  # 9
    "#882255",  # 10
    "#4a101d",  # 10+
]

ZONE_NAME_ZH = {
    "JBJFI": "大溫哥華西南部 (Metro Vancouver SW)",
    "JAZBU": "大溫哥華東南部 (Metro Vancouver SE)",
    "JBXHZ": "大溫哥華東北部 (Metro Vancouver NE)",
    "JBRIK": "大溫哥華西北部 (Metro Vancouver NW)",
    "JABNO": "菲沙河谷中部 (Central Fraser Valley)",
    "JCVCC": "菲沙河谷東部 (Eastern Fraser Valley)",
}

AIRMAP_HEADERS = {
    **HEADERS,
    "Referer": "https://gis.metrovancouver.org/maps/air",
}


def _aqhi_visuals(raw_value: float | None) -> tuple[int | None, str, str, str]:
    """Return (rounded_1_to_11, display_str, hex_color, risk_zh) matching ExplorePanel."""
    if raw_value is None:
        return None, "N/A", "#64748b", "暫無數據"

    rounded = int(raw_value + 0.5)
    if rounded < 1:
        rounded = 1
    idx = 11 if rounded > 10 else rounded
    color = AQHI_COLORS[idx - 1]
    display = "10+" if idx >= 11 else str(idx)
    if idx <= 3:
        risk_zh = "低風險"
    elif idx <= 6:
        risk_zh = "中風險"
    elif idx <= 10:
        risk_zh = "高風險"
    else:
        risk_zh = "極高風險"
    return idx, display, color, risk_zh


def _fetch_zone_observation(session: requests.Session, cgndb: str) -> dict[str, Any] | None:
    """Fetch live AQHI XML observation for one zone code from Environment Canada HPFX."""
    now_utc = datetime.now(timezone.utc)
    candidate_days = [
        now_utc.strftime("%Y%m%d"),
        (now_utc - timedelta(days=1)).strftime("%Y%m%d"),
    ]
    for ymd in candidate_days:
        url = HPFX_XML_TEMPLATE.format(ymd=ymd, cgndb=cgndb)
        try:
            resp = session.get(url, headers=AIRMAP_HEADERS, timeout=20)
            if resp.status_code != 200 or not resp.text.strip():
                continue
            root = ET.fromstring(resp.text)
            aqhi_node = root.find("airQualityHealthIndex")
            raw_text = (aqhi_node.text or "").strip() if aqhi_node is not None else ""
            raw_val = float(raw_text) if raw_text else None
            utc_node = root.find("./dateStamp/UTCStamp")
            summary_node = root.find("./dateStamp/textSummary[@lang='EN']")
            return {
                "aqhi_raw": round(raw_val, 1) if raw_val is not None else None,
                "observed_utc": (utc_node.text or "").strip() if utc_node is not None else "",
                "observed_text": (summary_node.text or "").strip() if summary_node is not None else "",
            }
        except Exception:
            continue
    return None


def update_air_quality() -> list[dict[str, Any]]:
    """Fetch Metro Vancouver AQHI polygons + live zone indices and save vancouver_air_quality.geojson."""
    configured = get_source_endpoint_url("air_quality", AIR_BOUNDARIES_URL)
    boundary_url = (
        configured
        if configured and ("MapServer" in configured or "geojson" in configured)
        else AIR_BOUNDARIES_URL
    )
    print(f"🌬️ 正在更新 Metro Vancouver 空氣質素健康指數 (AQHI) 區塊圖層...")

    existing = load_existing_geojson("vancouver_air_quality.geojson") or {}
    existing_by_cgndb: dict[str, dict[str, Any]] = {}
    for feat in existing.get("features") or []:
        props = feat.get("properties") or {}
        code = str(props.get("cgndb") or "").strip().upper()
        if code:
            existing_by_cgndb[code] = feat

    boundary_features: list[dict[str, Any]] = []
    session = requests.Session()
    try:
        resp = session.get(boundary_url, headers=AIRMAP_HEADERS, timeout=30)
        if resp.status_code == 200:
            gj = resp.json()
            if isinstance(gj, dict) and isinstance(gj.get("features"), list):
                boundary_features = gj["features"]
    except Exception as e:
        print(f"  ⚠️ 抓取 AirMap 區塊邊界異常，改用快取幾何: {e}")

    if not boundary_features and existing_by_cgndb:
        boundary_features = list(existing_by_cgndb.values())

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_features: list[dict[str, Any]] = []

    for feat in boundary_features:
        props = dict(feat.get("properties") or {})
        geom = feat.get("geometry")
        if not geom:
            continue
        cgndb = str(props.get("CGNDB") or props.get("cgndb") or "").strip().upper()
        if not cgndb:
            continue

        zone_name = str(props.get("NAME") or props.get("name") or ZONE_NAME_ZH.get(cgndb, cgndb)).strip()
        obs = _fetch_zone_observation(session, cgndb)
        prev_props = (existing_by_cgndb.get(cgndb) or {}).get("properties") or {}

        raw_val = obs["aqhi_raw"] if obs and obs.get("aqhi_raw") is not None else prev_props.get("aqhi_raw")
        aqhi_value, aqhi_display, color, risk_zh = _aqhi_visuals(raw_val)

        out_features.append(
            {
                "type": "Feature",
                "id": f"air_{cgndb}",
                "geometry": geom,
                "properties": {
                    "id": f"air_{cgndb}",
                    "cgndb": cgndb,
                    "name": zone_name,
                    "name_zh": ZONE_NAME_ZH.get(cgndb, zone_name),
                    "aqhi_raw": raw_val,
                    "aqhi_value": aqhi_value,
                    "aqhi_display": aqhi_display,
                    "color": color,
                    "risk_zh": risk_zh,
                    "observed_utc": obs.get("observed_utc", "") if obs else prev_props.get("observed_utc", ""),
                    "observed_text": obs.get("observed_text", "") if obs else prev_props.get("observed_text", ""),
                    "updated_at": now_iso,
                },
            }
        )

    if out_features:
        save_layer_geojson("vancouver_air_quality.geojson", out_features)
        print(f"✅ 空氣質素圖層更新完成，共 {len(out_features)} 個 AQHI 分區。")
    else:
        print("❌ 未取得任何 AQHI 分區資料。")
    return out_features


if __name__ == "__main__":
    update_air_quality()
