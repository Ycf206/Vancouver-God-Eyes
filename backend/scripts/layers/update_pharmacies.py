#!/usr/bin/env python3
"""
Automated updater for Licensed Community Pharmacies in BC (藥房).
Scrapes the official College of Pharmacists of British Columbia directory
(https://www.bcpharmacists.org/list-community-pharmacies), geocodes addresses
using BC Address Geocoder (with persistent existing-GeoJSON coordinate cache),
and writes backend/data/vancouver_pharmacies.geojson & frontend/public/vancouver_pharmacies.geojson.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import os
import re
import sys
import threading
import time
from typing import Any

from bs4 import BeautifulSoup
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from base import (
    HEADERS,
    get_source_endpoint_url,
    load_existing_geojson,
    save_layer_geojson,
    update_admin_source_metadata,
)

DEFAULT_PHARMACY_DIRECTORY_URL = "https://www.bcpharmacists.org/list-community-pharmacies"
GEOBC_URL = "https://geocoder.api.gov.bc.ca/addresses.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OUTPUT_FILENAME = "vancouver_pharmacies.geojson"

_thread_local = threading.local()
_nominatim_lock = threading.Lock()


def _get_session() -> requests.Session:
    sess = getattr(_thread_local, "session", None)
    if sess is None:
        sess = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
        sess.mount("https://", adapter)
        sess.mount("http://", adapter)
        sess.headers.update(HEADERS)
        _thread_local.session = sess
    return sess


def _norm_space(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _clean_display_address(raw_addr: str) -> str:
    s = _norm_space(raw_addr)
    s = re.sub(r",?\s*\bCanada\b\.?$", "", s, flags=re.I).strip(" ,")
    return s


def _extract_city_and_postal(addr: str) -> tuple[str, str]:
    postal = ""
    m_post = re.search(r"\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b", addr, re.I)
    if m_post:
        p_raw = re.sub(r"\s+", "", m_post.group(1).upper())
        postal = f"{p_raw[:3]} {p_raw[3:]}"

    city = ""
    m_city = re.search(r",\s*([^,]+?)\s+BC\b", addr, re.I)
    if m_city:
        city = _norm_space(m_city.group(1))
    else:
        parts = [p.strip() for p in addr.split(",") if p.strip()]
        if len(parts) >= 2:
            cand = re.sub(r"\bBC\b.*$", "", parts[-1], flags=re.I).strip()
            if cand and not re.match(r"^[A-Z]\d[A-Z]", cand, re.I):
                city = cand
    return city, postal


def _build_geocode_variants(clean_addr: str) -> list[str]:
    """Generate progressive civic address variants for high BC Geocoder match rates."""
    variants: list[str] = []

    def _add(v: str) -> None:
        v = _norm_space(v).strip(" ,")
        if v and v not in variants:
            variants.append(v)

    # Strip Canadian postal code for clean street + city + BC matching
    no_postal = re.sub(r"\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b", "", clean_addr, flags=re.I)
    no_postal = re.sub(r"\s*,\s*$", "", _norm_space(no_postal))

    _add(no_postal)
    _add(clean_addr)

    # Remove PO Box clauses (e.g., "Box 1060, ")
    no_box = re.sub(r",?\s*\b(?:P\.?\s*O\.?\s*)?Box\s+\w+\b", "", no_postal, flags=re.I)
    _add(no_box)

    # Remove leading suite/unit tags: "#101 - ", "Unit 202A, ", "104 - ", "Suite 180, "
    no_unit = re.sub(r"^\s*(?:#\s*[A-Za-z0-9-]+\s*[-,]\s*)", "", no_box)
    no_unit = re.sub(
        r"^\s*(?:Unit|Suite|Ste|Apt|Rm|Room|Bay|Space|CRU|Lot)\s+[A-Za-z0-9-]+\s*[-,]\s*",
        "",
        no_unit,
        flags=re.I,
    )
    no_unit = re.sub(r"^\s*[A-Za-z]?\d+[A-Za-z]?\s*-\s*(?=\d+)", "", no_unit)
    # Remove trailing ", Suite 180" / ", Unit 2" before city
    no_unit = re.sub(
        r",\s*(?:Unit|Suite|Ste|Apt|Floor|Flr|Room|Rm|#)\s*[A-Za-z0-9-]+(?=\s*,)",
        "",
        no_unit,
        flags=re.I,
    )
    _add(no_unit)

    return variants


def _in_bc_bounds(lon: float, lat: float) -> bool:
    return -139.5 <= lon <= -114.0 and 48.0 <= lat <= 60.5


def _geocode_single(clean_addr: str, city: str) -> tuple[float, float, int] | None:
    sess = _get_session()
    variants = _build_geocode_variants(clean_addr)

    for q in variants:
        try:
            resp = sess.get(
                GEOBC_URL,
                params={
                    "addressString": q,
                    "locationDescriptor": "parcelPoint",
                    "maxResults": 1,
                    "echo": "false",
                },
                timeout=12,
            )
            if resp.status_code == 200:
                feats = (resp.json() or {}).get("features") or []
                if feats:
                    props = feats[0].get("properties") or {}
                    coords = (feats[0].get("geometry") or {}).get("coordinates") or []
                    score = int(props.get("score") or 0)
                    precision = str(props.get("matchPrecision") or "").upper()
                    if len(coords) >= 2 and score >= 50:
                        lon = round(float(coords[0]), 6)
                        lat = round(float(coords[1]), 6)
                        if _in_bc_bounds(lon, lat) and precision != "PROVINCE":
                            return (lon, lat, score)
        except Exception:
            continue

    # Last-resort Nominatim fallback (serialized cleanly for rate limit)
    for q in (variants[-1] if variants else clean_addr, f"{city}, BC, Canada" if city else ""):
        if not q:
            continue
        with _nominatim_lock:
            try:
                resp = sess.get(
                    NOMINATIM_URL,
                    params={"q": f"{q}, Canada", "format": "json", "limit": 1, "countrycodes": "ca"},
                    timeout=12,
                )
                time.sleep(1.0)
                if resp.status_code == 200:
                    rows = resp.json() or []
                    if rows:
                        lon = round(float(rows[0]["lon"]), 6)
                        lat = round(float(rows[0]["lat"]), 6)
                        if _in_bc_bounds(lon, lat):
                            return (lon, lat, 45)
            except Exception:
                pass
            break

    return None


def _build_existing_coord_cache() -> dict[str, tuple[float, float, int]]:
    cache: dict[str, tuple[float, float, int]] = {}
    existing = load_existing_geojson(OUTPUT_FILENAME)
    if not isinstance(existing, dict):
        return cache
    for feat in existing.get("features") or []:
        props = feat.get("properties") or {}
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        try:
            lon = float(coords[0])
            lat = float(coords[1])
            score = int(props.get("geocode_score") or 90)
        except (TypeError, ValueError):
            continue
        for key_field in (props.get("address"), props.get("raw_address")):
            k = _norm_space(str(key_field or "")).lower()
            if k:
                cache[k] = (lon, lat, score)
    return cache


def parse_directory_html(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        raise RuntimeError("無法在 College of Pharmacists of BC 頁面找到藥房清單表格")

    headers = [_norm_space(th.get_text(" ", strip=True)).lower() for th in table.find_all("th")]
    col_idx = {h: i for i, h in enumerate(headers)}
    i_name = col_idx.get("pharmacy", 0)
    i_addr = col_idx.get("address", 1)
    i_mgr = col_idx.get("manager", 2)
    i_phone = col_idx.get("phone", 3)
    i_fax = col_idx.get("fax", 4)

    rows: list[dict[str, str]] = []
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 2:
            continue
        vals = [_norm_space(td.get_text(" ", strip=True)) for td in tds]
        name = vals[i_name] if i_name < len(vals) else ""
        raw_addr = vals[i_addr] if i_addr < len(vals) else ""
        if not name or not raw_addr:
            continue
        rows.append(
            {
                "name": name,
                "raw_address": raw_addr,
                "address": _clean_display_address(raw_addr),
                "manager": vals[i_mgr] if i_mgr < len(vals) else "",
                "phone": vals[i_phone] if i_phone < len(vals) else "",
                "fax": vals[i_fax] if i_fax < len(vals) else "",
            }
        )
    return rows


def update_pharmacies() -> list[dict[str, Any]]:
    print("💊 正在爬取卑詩省藥劑師學會 (CPBC) 社區藥房名錄並進行地理編碼...")
    url = get_source_endpoint_url("pharmacies", DEFAULT_PHARMACY_DIRECTORY_URL) or DEFAULT_PHARMACY_DIRECTORY_URL

    try:
        resp = requests.get(url, headers=HEADERS, timeout=35)
        resp.raise_for_status()
        records = parse_directory_html(resp.text)
    except Exception as exc:
        print(f"❌ 藥房名錄抓取失敗 ({exc})，嘗試載入現有快取備份...")
        existing = load_existing_geojson(OUTPUT_FILENAME)
        if isinstance(existing, dict) and existing.get("features"):
            return existing["features"]
        return []

    print(f"📋 已從官網解析 {len(records):,} 間持牌社區藥房")
    coord_cache = _build_existing_coord_cache()

    to_geocode: list[tuple[int, str, str]] = []
    coords_by_idx: dict[int, tuple[float, float, int]] = {}

    for idx, rec in enumerate(records):
        city, _ = _extract_city_and_postal(rec["address"])
        hit = coord_cache.get(rec["address"].lower()) or coord_cache.get(rec["raw_address"].lower())
        if hit is not None:
            coords_by_idx[idx] = hit
        else:
            to_geocode.append((idx, rec["address"], city))

    if to_geocode:
        print(f"📍 使用 BC Address Geocoder 批次轉換 {len(to_geocode):,} 筆藥房地址（快取命中 {len(coords_by_idx):,} 筆）...")
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {
                pool.submit(_geocode_single, addr, city): idx
                for idx, addr, city in to_geocode
            }
            done_cnt = 0
            for fut in as_completed(futs):
                idx = futs[fut]
                done_cnt += 1
                try:
                    res = fut.result()
                    if res is not None:
                        coords_by_idx[idx] = res
                except Exception:
                    pass
                if done_cnt % 250 == 0 or done_cnt == len(to_geocode):
                    print(f"  -> 地理編碼進度 {done_cnt} / {len(to_geocode)} (成功累計 {len(coords_by_idx):,})")

    features: list[dict[str, Any]] = []
    skipped = 0
    seen_ids: set[str] = set()

    for idx, rec in enumerate(records):
        geo = coords_by_idx.get(idx)
        if geo is None:
            skipped += 1
            continue
        lon, lat, score = geo
        city, postal = _extract_city_and_postal(rec["address"])
        digest = hashlib.sha1(f"{rec['name'].lower()}|{rec['address'].lower()}".encode("utf-8")).hexdigest()[:10]
        feat_id = f"pharmacy_{digest}"
        if feat_id in seen_ids:
            feat_id = f"{feat_id}_{idx}"
        seen_ids.add(feat_id)

        features.append(
            {
                "type": "Feature",
                "id": feat_id,
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 6), round(lat, 6)],
                },
                "properties": {
                    "id": feat_id,
                    "facility_type": "pharmacies",
                    "name": rec["name"],
                    "address": rec["address"],
                    "raw_address": rec["raw_address"],
                    "city": city,
                    "local_area": city or "British Columbia",
                    "postal_code": postal,
                    "manager": rec["manager"],
                    "phone": rec["phone"],
                    "fax": rec["fax"],
                    "geocode_score": score,
                    "website": url,
                    "source": "College of Pharmacists of BC",
                },
            }
        )

    features.sort(
        key=lambda f: (
            str(f["properties"].get("name") or "").lower(),
            str(f["properties"].get("address") or "").lower(),
            str(f.get("id") or ""),
        )
    )

    if not features:
        existing = load_existing_geojson(OUTPUT_FILENAME)
        if isinstance(existing, dict) and existing.get("features"):
            return existing["features"]
        return []

    save_layer_geojson(OUTPUT_FILENAME, features, compact=True)
    update_admin_source_metadata("pharmacies", record_count=len(features))
    print(f"✅ 社區藥房圖資更新完成：共收錄 {len(features):,} 間藥房（略過無法定位 {skipped} 筆）。")
    return features


if __name__ == "__main__":
    update_pharmacies()
