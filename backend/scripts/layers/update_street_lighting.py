#!/usr/bin/env python3
"""
Vancouver Street Lighting Infrastructure Updater (路燈網絡 / 路燈 / 路燈接線盒).

Fetches the three City of Vancouver Open Data v2.1 datasets monthly via GitHub Actions:
1. 路燈網絡 (Conduits): street-lighting-conduits -> LineString segments + centroid clusters
2. 路燈 (Poles): street-lighting-poles -> Point locations
3. 路燈接線盒 (Junction Boxes): street-lighting-junction-boxes -> Point locations

No popup metadata is attached on the map (`properties: {}` for minimal payload & fast rendering).
"""

from __future__ import annotations

import os
import sys
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    HEADERS,
    fetch_all_records,
    fetch_geojson_export,
    load_existing_geojson,
    save_layer_geojson,
    update_admin_source_metadata,
)

CONDUITS_DATASET_ID = "street-lighting-conduits"
POLES_DATASET_ID = "street-lighting-poles"
JUNCTION_BOXES_DATASET_ID = "street-lighting-junction-boxes"

CONDUITS_DEFAULT_URL = (
    "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
    "street-lighting-conduits/records/?lang=en"
)
POLES_DEFAULT_URL = (
    "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
    "street-lighting-poles/records/?lang=en"
)
JUNCTION_BOXES_DEFAULT_URL = (
    "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
    "street-lighting-junction-boxes/records/?lang=en"
)

CONDUITS_FILE = "vancouver_street_lighting_conduits.geojson"
CONDUITS_CLUSTERS_FILE = "vancouver_street_lighting_conduits_clusters.geojson"
POLES_FILE = "vancouver_street_lighting_poles.geojson"
JUNCTION_BOXES_FILE = "vancouver_street_lighting_junction_boxes.geojson"


def _get_subsource_urls() -> dict[str, str]:
    """Read optional custom sub-URLs from admin_sources_config.json `street_lighting.source_links`."""
    urls = {
        "conduits": CONDUITS_DEFAULT_URL,
        "poles": POLES_DEFAULT_URL,
        "junction_boxes": JUNCTION_BOXES_DEFAULT_URL,
    }
    cfg_path = os.path.join(BACKEND_DATA_DIR, "admin_sources_config.json")
    if not os.path.exists(cfg_path):
        return urls
    try:
        import json

        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        for src in cfg.get("sources", []):
            if src.get("id") != "street_lighting":
                continue
            for lnk in src.get("source_links", []):
                u = str(lnk.get("url") or "").strip()
                if not u:
                    continue
                if "street-lighting-conduits" in u:
                    urls["conduits"] = u
                elif "street-lighting-poles" in u:
                    urls["poles"] = u
                elif "street-lighting-junction-boxes" in u:
                    urls["junction_boxes"] = u
    except Exception:
        pass
    return urls


def _records_url_to_geojson_export(url: str, dataset_id: str) -> str:
    clean = (url or "").split("?")[0].rstrip("/")
    if clean.endswith("/exports/geojson"):
        return clean
    if "/records" in clean:
        return clean.rsplit("/records", 1)[0] + "/exports/geojson"
    return f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset_id}/exports/geojson"


def _round_coord_pair(pt: Any, precision: int = 6) -> list[float] | None:
    if not isinstance(pt, (list, tuple)) or len(pt) < 2:
        return None
    try:
        lon = round(float(pt[0]), precision)
        lat = round(float(pt[1]), precision)
    except (TypeError, ValueError):
        return None
    if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        return None
    return [lon, lat]


def _midpoint_from_line(coords: list[list[float]]) -> list[float] | None:
    if not coords:
        return None
    pt = coords[len(coords) // 2]
    return [round(pt[0], 5), round(pt[1], 5)]


def _download_raw_features(dataset_id: str, configured_url: str) -> list[dict[str, Any]]:
    export_url = _records_url_to_geojson_export(configured_url, dataset_id)
    print(f"📡 正在下載 [{dataset_id}] GeoJSON 匯出檔: {export_url}")
    try:
        resp = requests.get(export_url, headers=HEADERS, timeout=120)
        if resp.status_code == 200:
            data = resp.json()
            feats = data.get("features") if isinstance(data, dict) else None
            if isinstance(feats, list) and feats:
                print(f"  ✅ [{dataset_id}] 下載成功，共 {len(feats):,} 筆圖徵")
                return feats
    except Exception as exc:
        print(f"  ⚠️ [{dataset_id}] GeoJSON 匯出失敗 ({exc})，改用 records 分頁拉取...")

    # Fallback via shared OpenData fetcher
    data = fetch_geojson_export(dataset_id, timeout=120, custom_url=export_url)
    if isinstance(data, dict) and isinstance(data.get("features"), list) and data["features"]:
        return data["features"]

    records = fetch_all_records(dataset_id, timeout=30, custom_url=configured_url)
    raw_feats: list[dict[str, Any]] = []
    for rec in records:
        geom = rec.get("geom")
        if isinstance(geom, dict) and geom.get("type") == "Feature" and isinstance(geom.get("geometry"), dict):
            raw_feats.append({"type": "Feature", "geometry": geom["geometry"], "properties": {}})
        elif isinstance(geom, dict) and geom.get("type") in ("Point", "MultiPoint", "LineString", "MultiLineString"):
            raw_feats.append({"type": "Feature", "geometry": geom, "properties": {}})
        elif isinstance(rec.get("geo_point_2d"), dict):
            gp = rec["geo_point_2d"]
            if gp.get("lon") is not None and gp.get("lat") is not None:
                raw_feats.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [gp["lon"], gp["lat"]]},
                        "properties": {},
                    }
                )
    return raw_feats


def _compact_point_features(raw_feats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for feat in raw_feats:
        geom = feat.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        pt: list[float] | None = None
        if gtype == "Point":
            pt = _round_coord_pair(coords, precision=6)
        elif gtype == "MultiPoint" and isinstance(coords, list) and coords:
            pt = _round_coord_pair(coords[0], precision=6)
        if pt is None:
            continue
        out.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": pt},
                "properties": {},
            }
        )
    return out


def _compact_conduit_features(
    raw_feats: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lines_out: list[dict[str, Any]] = []
    clusters_out: list[dict[str, Any]] = []

    for feat in raw_feats:
        geom = feat.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        if gtype == "LineString" and isinstance(coords, list):
            cleaned = [c for c in (_round_coord_pair(pt, 6) for pt in coords) if c is not None]
            if len(cleaned) >= 2:
                lines_out.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": cleaned},
                        "properties": {},
                    }
                )
                mid = _midpoint_from_line(cleaned)
                if mid is not None:
                    clusters_out.append(
                        {
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": mid},
                            "properties": {},
                        }
                    )
        elif gtype == "MultiLineString" and isinstance(coords, list):
            cleaned_multi: list[list[list[float]]] = []
            for seg in coords:
                if not isinstance(seg, list):
                    continue
                cleaned = [c for c in (_round_coord_pair(pt, 6) for pt in seg) if c is not None]
                if len(cleaned) >= 2:
                    cleaned_multi.append(cleaned)
            if cleaned_multi:
                lines_out.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "MultiLineString", "coordinates": cleaned_multi},
                        "properties": {},
                    }
                )
                mid = _midpoint_from_line(cleaned_multi[len(cleaned_multi) // 2])
                if mid is not None:
                    clusters_out.append(
                        {
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": mid},
                            "properties": {},
                        }
                    )

    return lines_out, clusters_out


def _fallback_features(filename: str) -> list[dict[str, Any]]:
    existing = load_existing_geojson(filename)
    if isinstance(existing, dict) and isinstance(existing.get("features"), list):
        return existing["features"]
    return []


def update_street_lighting() -> dict[str, int]:
    print("💡 正在更新溫哥華市區路燈照明系統圖資 (路燈網絡 / 路燈 / 路燈接線盒)...")
    urls = _get_subsource_urls()

    # 1. 路燈網絡 (Conduits)
    raw_conduits = _download_raw_features(CONDUITS_DATASET_ID, urls["conduits"])
    conduit_lines, conduit_clusters = _compact_conduit_features(raw_conduits)
    if not conduit_lines:
        print("ℹ️ 路燈網絡使用現有快取資料備份...")
        conduit_lines = _fallback_features(CONDUITS_FILE)
        conduit_clusters = _fallback_features(CONDUITS_CLUSTERS_FILE)
    if conduit_lines:
        save_layer_geojson(CONDUITS_FILE, conduit_lines, compact=True)
    if conduit_clusters:
        save_layer_geojson(CONDUITS_CLUSTERS_FILE, conduit_clusters, compact=True)

    # 2. 路燈 (Poles)
    raw_poles = _download_raw_features(POLES_DATASET_ID, urls["poles"])
    pole_points = _compact_point_features(raw_poles)
    if not pole_points:
        print("ℹ️ 路燈使用現有快取資料備份...")
        pole_points = _fallback_features(POLES_FILE)
    if pole_points:
        save_layer_geojson(POLES_FILE, pole_points, compact=True)

    # 3. 路燈接線盒 (Junction Boxes)
    raw_boxes = _download_raw_features(JUNCTION_BOXES_DATASET_ID, urls["junction_boxes"])
    box_points = _compact_point_features(raw_boxes)
    if not box_points:
        print("ℹ️ 路燈接線盒使用現有快取資料備份...")
        box_points = _fallback_features(JUNCTION_BOXES_FILE)
    if box_points:
        save_layer_geojson(JUNCTION_BOXES_FILE, box_points, compact=True)

    # 4. 夜間燈光 (NASA Black Marble VIIRS 一年夜晚中位數，經由 NASA GIBS)
    night_lights_count = 0
    try:
        from update_night_lights import update_night_lights
        nl_feats = update_night_lights()
        night_lights_count = len(nl_feats)
    except Exception as exc:
        print(f"⚠️ 夜間燈光更新失敗（不影響路燈資料）: {exc}")

    total = len(conduit_lines) + len(pole_points) + len(box_points) + night_lights_count
    update_admin_source_metadata("street_lighting", record_count=total)
    print(
        f"✅ 燈光圖層更新完成：路燈網絡 {len(conduit_lines):,} 條、"
        f"路燈 {len(pole_points):,} 座、路燈接線盒 {len(box_points):,} 處、"
        f"夜間燈光 {night_lights_count:,} 色塊（總計 {total:,} 筆）。"
    )
    return {
        "conduits": len(conduit_lines),
        "poles": len(pole_points),
        "junction_boxes": len(box_points),
        "night_lights": night_lights_count,
        "total": total,
    }


if __name__ == "__main__":
    update_street_lighting()
