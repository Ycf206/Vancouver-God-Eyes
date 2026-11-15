"""
BC Wildfire Service Active Wildfires & Metro Vancouver Current Fire Danger Rating Updater.

1. Fetches active wildfire incidents across BC from BC Wildfire Service (WFNews API):
   https://wildfiresituation.nrs.gov.bc.ca/wfnews-api/publicPublishedIncident
2. Scrapes the current Metro Vancouver / North Shore Fire Danger Rating (LOW / MODERATE / HIGH / EXTREME)
   from City of North Vancouver Fire Department:
   https://www.cnv.org/home-property/fire-department/fire-danger-rating
3. Persists vancouver_wildfire.geojson (in backend/data & frontend/public) with 24h OCI cache sync.
"""

from __future__ import annotations

from datetime import datetime, timezone
import html as html_lib
import os
import re
import sys
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import HEADERS, get_source_endpoint_url, load_existing_geojson, save_layer_geojson

DEFAULT_WFNEWS_API_URL = (
    "https://wildfiresituation.nrs.gov.bc.ca/wfnews-api/publicPublishedIncident"
    "?pageNumber=1&pageRowCount=100"
    "&stageOfControlList=OUT_CNTRL"
    "&stageOfControlList=HOLDING"
    "&stageOfControlList=UNDR_CNTRL"
    "&newFires=false"
    "&orderBy=lastUpdatedTimestamp%20DESC"
)

CNV_FIRE_DANGER_URL = "https://www.cnv.org/home-property/fire-department/fire-danger-rating"
BC_WILDFIRE_MAP_URL = "https://wildfiresituation.nrs.gov.bc.ca/map"

STAGE_OF_CONTROL_ZH = {
    "OUT_CNTRL": "失控",
    "HOLDING": "進行中",
    "UNDR_CNTRL": "受控",
}

FIRE_DANGER_LEVELS: dict[str, dict[str, str]] = {
    "LOW": {
        "level": "LOW",
        "label_en": "LOW",
        "label_zh": "低",
        "color": "#55a654",
        "header_bg": "#94c595",
        "banner_bg": "#ecf7ed",
        "text_color": "#166534",
    },
    "MODERATE": {
        "level": "MODERATE",
        "label_en": "MODERATE",
        "label_zh": "中",
        "color": "#f3df46",
        "header_bg": "#f5eb92",
        "banner_bg": "#fefce8",
        "text_color": "#854d0e",
    },
    "HIGH": {
        "level": "HIGH",
        "label_en": "HIGH",
        "label_zh": "高",
        "color": "#df9035",
        "header_bg": "#eab77d",
        "banner_bg": "#fff7ed",
        "text_color": "#9a3412",
    },
    "EXTREME": {
        "level": "EXTREME",
        "label_en": "EXTREME",
        "label_zh": "極高",
        "color": "#d3352f",
        "header_bg": "#df8a71",
        "banner_bg": "#fef2f2",
        "text_color": "#991b1b",
    },
}

WF_HEADERS = {
    **HEADERS,
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://wildfiresituation.nrs.gov.bc.ca",
    "Referer": "https://wildfiresituation.nrs.gov.bc.ca/map",
}

CNV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-CA,en;q=0.9",
}


def _to_float(val: Any) -> float | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(str(val).strip())
        if num != num:  # NaN guard
            return None
        return num
    except Exception:
        return None


def _to_int_or_none(val: Any) -> int | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        return int(float(str(val).strip()))
    except Exception:
        return None


def _fetch_fire_danger_rating(
    session: requests.Session,
    fallback_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Scrape live Fire Danger Current Rating (LOW/MODERATE/HIGH/EXTREME) from CNV."""
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    detected_level: str | None = None
    description: str = ""

    try:
        resp = session.get(CNV_FIRE_DANGER_URL, headers=CNV_HEADERS, timeout=20)
        if resp.status_code == 200 and resp.text:
            html = resp.text
            img_match = re.search(
                r"fire-danger-rating-(LOW|MODERATE|HIGH|EXTREME)\.(?:png|jpg|jpeg|webp)",
                html,
                flags=re.IGNORECASE,
            )
            if img_match:
                detected_level = img_match.group(1).upper()

            p_match = re.search(
                r"<p[^>]*>\s*(A\s+<strong>\s*(LOW|MODERATE|HIGH|EXTREME)\s*</strong>\s*fire\s+rating.*?)</p>",
                html,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if p_match:
                if not detected_level:
                    detected_level = p_match.group(2).upper()
                raw_desc = html_lib.unescape(re.sub(r"<[^>]+>", "", p_match.group(1)))
                description = re.sub(r"\s+", " ", raw_desc.replace("\xa0", " ")).strip()
    except Exception as exc:
        print(f"  ⚠️ 爬取 CNV 火災危險等級失敗，改用快取狀態: {exc}")

    if not detected_level and isinstance(fallback_meta, dict):
        prev_lvl = str(fallback_meta.get("level") or "").upper()
        if prev_lvl in FIRE_DANGER_LEVELS:
            detected_level = prev_lvl
            if not description:
                description = str(fallback_meta.get("description") or "")

    level_key = detected_level if detected_level in FIRE_DANGER_LEVELS else "LOW"
    meta = dict(FIRE_DANGER_LEVELS[level_key])
    meta["description"] = description
    meta["source_url"] = CNV_FIRE_DANGER_URL
    meta["fetched_at"] = now_iso if detected_level else (fallback_meta or {}).get("fetched_at", now_iso)
    return meta


def _fetch_wildfire_incidents(
    session: requests.Session,
    api_url: str,
) -> tuple[list[dict[str, Any]], bool]:
    """Fetch paginated BC Wildfire Service publicPublishedIncident collection."""
    base_url = api_url.split("?", 1)[0] or DEFAULT_WFNEWS_API_URL.split("?", 1)[0]
    page = 1
    max_pages = 30
    all_rows: list[dict[str, Any]] = []
    api_ok = False

    while page <= max_pages:
        params: list[tuple[str, str]] = [
            ("pageNumber", str(page)),
            ("pageRowCount", "100"),
            ("stageOfControlList", "OUT_CNTRL"),
            ("stageOfControlList", "HOLDING"),
            ("stageOfControlList", "UNDR_CNTRL"),
            ("newFires", "false"),
            ("orderBy", "lastUpdatedTimestamp DESC"),
        ]
        try:
            resp = session.get(base_url, params=params, headers=WF_HEADERS, timeout=25)
            if resp.status_code != 200:
                print(f"  ⚠️ BC Wildfire API 第 {page} 頁回應 HTTP {resp.status_code}")
                break
            payload = resp.json()
            rows = payload.get("collection")
            if not isinstance(rows, list):
                break
            api_ok = True
            all_rows.extend(rows)
            total_pages = int(payload.get("totalPageCount") or 1)
            if page >= total_pages or not rows:
                break
            page += 1
        except Exception as exc:
            print(f"  ⚠️ 抓取 BC Wildfire API 第 {page} 頁失敗: {exc}")
            break

    return all_rows, api_ok


def update_wildfire() -> list[dict[str, Any]]:
    """Fetch BC active wildfires + CNV Fire Danger Current Rating and save vancouver_wildfire.geojson."""
    configured = get_source_endpoint_url("wildfire", DEFAULT_WFNEWS_API_URL)
    api_url = (
        configured
        if configured and "publicPublishedIncident" in configured
        else DEFAULT_WFNEWS_API_URL
    )
    print("🔥 正在更新 BC Wildfire Service 山火事件與火災危險等級...")

    existing = load_existing_geojson("vancouver_wildfire.geojson") or {}
    existing_features = list(existing.get("features") or [])
    prev_danger = existing.get("fire_danger_rating")

    session = requests.Session()
    danger_meta = _fetch_fire_danger_rating(session, fallback_meta=prev_danger)
    raw_rows, api_ok = _fetch_wildfire_incidents(session, api_url)

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_features: list[dict[str, Any]] = []

    if api_ok:
        seen_ids: set[str] = set()
        for idx, row in enumerate(raw_rows):
            if not isinstance(row, dict):
                continue
            lat = _to_float(row.get("latitude"))
            lon = _to_float(row.get("longitude"))
            if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue

            raw_guid = str(
                row.get("publishedIncidentDetailGuid")
                or row.get("incidentGuid")
                or row.get("incidentNumberLabel")
                or idx
            ).strip()
            fid = f"wildfire_{raw_guid}"
            if fid in seen_ids:
                continue
            seen_ids.add(fid)

            incident_name = str(row.get("incidentName") or row.get("incidentNumberLabel") or "Wildfire Incident").strip()
            incident_location = str(row.get("incidentLocation") or "").strip()
            stage_code = str(row.get("stageOfControlCode") or "").strip().upper() or None
            stage_zh = STAGE_OF_CONTROL_ZH.get(stage_code or "", stage_code) if stage_code else None

            size_ha = _to_float(row.get("incidentSizeEstimatedHa"))
            fire_centre = str(row.get("fireCentreName") or "").strip() or None
            crew_count = _to_int_or_none(row.get("crewResourceCount"))
            aviation_count = _to_int_or_none(row.get("aviationResourceCount"))
            create_ts = _to_int_or_none(row.get("createDate"))
            updated_ts = _to_int_or_none(row.get("lastUpdatedTimestamp"))

            out_features.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lon, 6), round(lat, 6)],
                    },
                    "properties": {
                        "id": fid,
                        "facility_type": "wildfire",
                        "publishedIncidentDetailGuid": row.get("publishedIncidentDetailGuid"),
                        "incidentGuid": row.get("incidentGuid"),
                        "incidentNumberLabel": row.get("incidentNumberLabel"),
                        "name": incident_name,
                        "incidentName": incident_name,
                        "incidentLocation": incident_location,
                        "local_area": incident_location,
                        "stageOfControlCode": stage_code,
                        "stage_of_control_zh": stage_zh,
                        "incidentSizeEstimatedHa": size_ha,
                        "fireCentreName": fire_centre,
                        "crewResourceCount": crew_count,
                        "aviationResourceCount": aviation_count,
                        "createDate": create_ts,
                        "lastUpdatedTimestamp": updated_ts,
                        "fireOfNoteInd": bool(row.get("fireOfNoteInd")),
                        "fire_danger_rating": danger_meta["level"],
                        "fire_danger_label_zh": danger_meta["label_zh"],
                        "fire_danger_color": danger_meta["color"],
                        "fire_danger_source_url": CNV_FIRE_DANGER_URL,
                        "fire_danger_updated_at": danger_meta["fetched_at"],
                        "official_url": BC_WILDFIRE_MAP_URL,
                        "updated_at": now_iso,
                    },
                }
            )
    elif existing_features:
        # Preserve cached incident geometry/fields on upstream API error while updating live fire danger rating
        for feat in existing_features:
            props = dict(feat.get("properties") or {})
            props["fire_danger_rating"] = danger_meta["level"]
            props["fire_danger_label_zh"] = danger_meta["label_zh"]
            props["fire_danger_color"] = danger_meta["color"]
            props["fire_danger_source_url"] = CNV_FIRE_DANGER_URL
            props["fire_danger_updated_at"] = danger_meta["fetched_at"]
            out_features.append({**feat, "properties": props})

    fc = {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "total_count": len(out_features),
        "updated_at": now_iso,
        "fire_danger_rating": danger_meta,
        "fire_danger_source_url": CNV_FIRE_DANGER_URL,
        "features": out_features,
    }
    save_layer_geojson("vancouver_wildfire.geojson", fc, is_feature_list=False)
    print(
        f"✅ 山火圖層更新完成：共 {len(out_features)} 起山火通報，"
        f"Current Fire Danger Rating = {danger_meta['level']} ({danger_meta['label_zh']})"
    )
    return out_features


if __name__ == "__main__":
    update_wildfire()
