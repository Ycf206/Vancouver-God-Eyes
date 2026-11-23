#!/usr/bin/env python3
"""
Canada Service Map — Public Services Monthly Directory Updater.

Fetches polite, read-only public JSON summaries from https://canadaservicemap.ca
once per month (strictly respecting Fair Use: <= 60 req/min, NO bulk export of places):
  1. All 15 English service categories & 140 public services (`GET /api/services?category=...`)
  2. All 13 Canadian provinces & territories overview (`GET /provinces/{slug}.json`)
  3. Federal & provincial benefit payment dates (`GET /benefit-payment-dates.json`)

Language policy: English only (French `nameFr` fields are omitted).
Writes atomically to `backend/data/canada_public_services.json` and
`frontend/public/canada_public_services.json`.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    FRONTEND_DATA_DIR,
    atomic_write_json,
    update_admin_source_metadata,
)

BASE_URL = "https://canadaservicemap.ca"
OUTPUT_FILENAME = "canada_public_services.json"

HEADERS = {
    "User-Agent": (
        "VancouverGodsEye/1.0 (+https://canadaservicemap.ca/developers; monthly directory cache)"
    ),
    "Accept": "application/json",
}

PROVINCES: list[dict[str, str]] = [
    {"code": "bc", "name": "British Columbia", "slug": "british-columbia", "default_city": "Vancouver"},
    {"code": "ab", "name": "Alberta", "slug": "alberta", "default_city": "Calgary"},
    {"code": "sk", "name": "Saskatchewan", "slug": "saskatchewan", "default_city": "Saskatoon"},
    {"code": "mb", "name": "Manitoba", "slug": "manitoba", "default_city": "Winnipeg"},
    {"code": "on", "name": "Ontario", "slug": "ontario", "default_city": "Toronto"},
    {"code": "qc", "name": "Quebec", "slug": "quebec", "default_city": "Montreal"},
    {"code": "nb", "name": "New Brunswick", "slug": "new-brunswick", "default_city": "Moncton"},
    {"code": "ns", "name": "Nova Scotia", "slug": "nova-scotia", "default_city": "Halifax"},
    {"code": "pe", "name": "Prince Edward Island", "slug": "prince-edward-island", "default_city": "Charlottetown"},
    {"code": "nl", "name": "Newfoundland and Labrador", "slug": "newfoundland-and-labrador", "default_city": "St. John's"},
    {"code": "yt", "name": "Yukon", "slug": "yukon", "default_city": "Whitehorse"},
    {"code": "nt", "name": "Northwest Territories", "slug": "northwest-territories", "default_city": "Yellowknife"},
    {"code": "nu", "name": "Nunavut", "slug": "nunavut", "default_city": "Iqaluit"},
]


def _get_json(session: requests.Session, path_or_url: str, timeout: int = 20) -> dict[str, Any]:
    url = path_or_url if path_or_url.startswith("http") else f"{BASE_URL}{path_or_url}"
    for attempt in range(3):
        resp = session.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 429:
            retry_after = float(resp.headers.get("Retry-After") or "5")
            time.sleep(min(max(retry_after, 2.0), 15.0))
            continue
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict):
            return data
        raise RuntimeError(f"Unexpected non-object JSON from {url}")
    raise RuntimeError(f"Rate-limited repeatedly fetching {url}")


def update_public_services(update_admin_meta: bool = True) -> dict[str, Any]:
    print("🏛️ Updating Canada Public Services directory from canadaservicemap.ca (English only)...")
    session = requests.Session()
    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    # 1. Fetch categories + all English services across each category (15 polite calls)
    root_services = _get_json(session, "/api/services")
    raw_categories = root_services.get("categories") or []
    categories: list[dict[str, str]] = [
        {"id": str(c.get("id") or "").strip(), "name": str(c.get("name") or "").strip()}
        for c in raw_categories
        if isinstance(c, dict) and c.get("id") and c.get("name")
    ]

    services_by_id: dict[str, dict[str, Any]] = {}

    def _ingest_services(items: list[Any]) -> None:
        for item in items:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or "").strip()
            if not sid:
                continue
            services_by_id[sid] = {
                "id": sid,
                "name": str(item.get("name") or "").strip(),
                "category": str(item.get("category") or "").strip(),
                "level": str(item.get("level") or "").strip(),
                "summary": str(item.get("summary") or "").strip(),
                "url": str(item.get("url") or f"{BASE_URL}/services/{sid}").strip(),
            }

    _ingest_services(root_services.get("results") or [])

    for cat in categories:
        time.sleep(0.35)
        try:
            cat_data = _get_json(session, f"/api/services?category={cat['id']}")
            _ingest_services(cat_data.get("results") or [])
        except Exception as exc:
            print(f"⚠️ Category '{cat['id']}' fetch failed: {exc}")

    services_list = sorted(services_by_id.values(), key=lambda s: (s["category"], s["name"]))

    # 2. Fetch all 13 provinces & territories overview JSON
    provinces_data: dict[str, dict[str, Any]] = {}
    province_summaries: list[dict[str, Any]] = []
    latest_reviewed = ""

    for prov in PROVINCES:
        time.sleep(0.35)
        code = prov["code"]
        slug = prov["slug"]
        try:
            pdata = _get_json(session, f"/provinces/{slug}.json")
            reviewed = str(pdata.get("lastReviewed") or "").strip()
            if reviewed and reviewed > latest_reviewed:
                latest_reviewed = reviewed

            p_services = []
            for s in (pdata.get("services") or []):
                if not isinstance(s, dict):
                    continue
                p_services.append({
                    "id": str(s.get("id") or "").strip(),
                    "topic": str(s.get("topic") or "").strip(),
                    "name": str(s.get("name") or "").strip(),
                    "url": str(s.get("url") or "").strip(),
                    "handledBy": str(s.get("handledBy") or "").strip(),
                    "detail": str(s.get("detail") or "").strip() or None,
                })

            p_cities = []
            for c in (pdata.get("cities") or []):
                if not isinstance(c, dict):
                    continue
                p_cities.append({
                    "name": str(c.get("name") or "").strip(),
                    "url": str(c.get("url") or "").strip(),
                    "population": c.get("population"),
                    "places": c.get("places"),
                })

            p_bodies = []
            for b in (pdata.get("bodies") or []):
                if not isinstance(b, dict):
                    continue
                b_url = str(b.get("url") or "").strip()
                b_slug = b_url.rstrip("/").split("/")[-1] if "/bodies/" in b_url else ""
                p_bodies.append({
                    "slug": b_slug,
                    "name": str(b.get("name") or "").strip(),
                    "url": b_url,
                    "website": str(b.get("website") or "").strip() or None,
                })

            p_payments = []
            for pm in (pdata.get("paymentDates") or []):
                if not isinstance(pm, dict):
                    continue
                p_payments.append({
                    "name": str(pm.get("name") or "").strip(),
                    "next": str(pm.get("next") or "").strip() or None,
                    "dates": [str(x) for x in (pm.get("dates") or [])],
                    "source": str(pm.get("source") or "").strip() or None,
                    "checked": str(pm.get("checked") or "").strip() or None,
                    "url": str(pm.get("url") or "").strip() or None,
                })

            p_facts = []
            for ft in (pdata.get("facts") or []):
                if isinstance(ft, dict):
                    lbl = str(ft.get("label") or ft.get("name") or "").strip()
                    val = str(ft.get("value") or ft.get("text") or "").strip()
                    if lbl or val:
                        p_facts.append({"label": lbl, "value": val})
                elif isinstance(ft, str) and ft.strip():
                    p_facts.append({"label": "", "value": ft.strip()})

            default_city = p_cities[0]["name"] if p_cities else prov["default_city"]
            provinces_data[code] = {
                "code": code,
                "name": prov["name"],
                "slug": slug,
                "default_city": default_city,
                "url": str(pdata.get("url") or f"{BASE_URL}/provinces/{slug}").strip(),
                "description": str(pdata.get("description") or "").strip(),
                "summary": str(pdata.get("summary") or "").strip(),
                "lastReviewed": reviewed,
                "bodyCount": pdata.get("bodyCount"),
                "serviceCount": len(p_services),
                "services": p_services,
                "paymentDates": p_payments,
                "cities": p_cities,
                "bodies": p_bodies,
                "facts": p_facts,
            }
            province_summaries.append({
                "code": code,
                "name": prov["name"],
                "slug": slug,
                "default_city": default_city,
                "serviceCount": len(p_services),
                "bodyCount": pdata.get("bodyCount") or len(p_bodies),
                "lastReviewed": reviewed,
                "url": provinces_data[code]["url"],
            })
        except Exception as exc:
            print(f"⚠️ Province '{slug}' fetch failed: {exc}")

    # 3. Fetch federal & provincial benefit payment dates
    time.sleep(0.35)
    benefits_list: list[dict[str, Any]] = []
    benefits_reviewed = ""
    try:
        bdata = _get_json(session, "/benefit-payment-dates.json")
        benefits_reviewed = str(bdata.get("lastReviewed") or "").strip()
        if benefits_reviewed and benefits_reviewed > latest_reviewed:
            latest_reviewed = benefits_reviewed
        for b in (bdata.get("benefits") or []):
            if not isinstance(b, dict):
                continue
            benefits_list.append({
                "id": str(b.get("id") or "").strip(),
                "name": str(b.get("name") or "").strip(),
                "where": str(b.get("where") or "Canada").strip(),
                "next": str(b.get("next") or "").strip() or None,
                "dates": [str(x) for x in (b.get("dates") or [])],
                "source": str(b.get("source") or "").strip() or None,
                "checked": str(b.get("checked") or "").strip() or None,
                "note": str(b.get("note") or "").strip() or None,
                "url": str(b.get("url") or "").strip() or None,
                "service": str(b.get("service") or "").strip() or None,
            })
    except Exception as exc:
        print(f"⚠️ Benefit payment dates fetch failed: {exc}")

    payload = {
        "status": "ok",
        "source": "Canada Service Map",
        "source_url": f"{BASE_URL}/provinces",
        "developers_url": f"{BASE_URL}/developers",
        "disclaimer": "Not a government website. The official page always has the final word.",
        "licence": (
            "Built entirely from public data: open data and official government pages. "
            "Each record keeps the licence of its source, listed at https://canadaservicemap.ca/data."
        ),
        "updated_at": now_iso,
        "last_reviewed": latest_reviewed or benefits_reviewed or now_iso[:10],
        "total_count": len(services_list),
        "provinces_count": len(province_summaries),
        "benefits_count": len(benefits_list),
        "categories": categories,
        "services": services_list,
        "provinces_index": province_summaries,
        "provinces": provinces_data,
        "benefits": benefits_list,
    }

    os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
    backend_out = os.path.join(BACKEND_DATA_DIR, OUTPUT_FILENAME)
    frontend_out = os.path.join(FRONTEND_DATA_DIR, OUTPUT_FILENAME)
    atomic_write_json(backend_out, payload, indent=None, separators=(",", ":"), prefix=".tmp_pubsvc_", suffix=".json")
    atomic_write_json(frontend_out, payload, indent=None, separators=(",", ":"), prefix=".tmp_pubsvc_", suffix=".json")

    if update_admin_meta:
        try:
            update_admin_source_metadata("public_services", record_count=len(services_list), updated_at=now_iso)
        except Exception:
            pass

    print(
        f"✅ Canada Public Services updated: {len(services_list)} services, "
        f"{len(province_summaries)} provinces/territories, {len(benefits_list)} benefit schedules."
    )
    return payload


if __name__ == "__main__":
    update_public_services(update_admin_meta=True)
