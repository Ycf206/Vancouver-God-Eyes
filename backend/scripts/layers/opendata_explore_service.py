from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

try:
    from .base import (
        BACKEND_DATA_DIR,
        FRONTEND_DATA_DIR,
        HEADERS,
        _extract_lon_lat,
        get_source_endpoint_url,
        update_admin_source_metadata,
    )
except ImportError:
    from base import (
        BACKEND_DATA_DIR,
        FRONTEND_DATA_DIR,
        HEADERS,
        _extract_lon_lat,
        get_source_endpoint_url,
        update_admin_source_metadata,
    )

DATASET_CONFIGS: dict[str, dict[str, Any]] = {
    "business-licences": {
        "source_id": "business_licences",
        "dataset_slug": "business-licences",
        "default_url": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/business-licences/records?lang=en",
        "facets_url": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/business-licences/facets?lang=en",
        "cache_filename": "vancouver_business_licences.json",
        "default_sort": "extract_desc",
        "sort_map": {
            "extract_desc": "extractdate desc, issueddate desc",
            "issued_desc": "issueddate desc",
            "issued_asc": "issueddate asc",
            "expired_desc": "expireddate desc",
            "employees_desc": "numberofemployees desc",
        },
        "filter_fields": ["status", "localarea", "businesstype"],
        "date_field": "issueddate",
        "date_is_datetime": True,
    },
    "issued-building-permits": {
        "source_id": "building_permits",
        "dataset_slug": "issued-building-permits",
        "default_url": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/records?lang=en",
        "facets_url": "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/facets?lang=en",
        "cache_filename": "vancouver_building_permits.json",
        "default_sort": "issuedate_desc",
        "sort_map": {
            "issuedate_desc": "issuedate desc",
            "issuedate_asc": "issuedate asc",
            "value_desc": "projectvalue desc",
            "value_asc": "projectvalue asc",
        },
        "filter_fields": ["permitcategory", "typeofwork", "geolocalarea"],
        "date_field": "issuedate",
        "date_is_datetime": False,
    },
}

_QUERY_CACHE: dict[tuple, tuple[float, dict[str, Any]]] = {}
_QUERY_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SEC = 90
_YESTERDAY_COUNT_CACHE: dict[tuple[str, str], tuple[float, int]] = {}
_YESTERDAY_CACHE_TTL_SEC = 300
_OPENDATA_MAX_OFFSET = 9900

# 卑詩省自 2026 年 11 月起實施永久太平洋時間 (PCT = 常年固定 UTC-7)
_VANCOUVER_TZ = timezone(timedelta(hours=-7))


def _yesterday_vancouver_str() -> str:
    return (datetime.now(_VANCOUVER_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")


def _get_yesterday_count(dataset_key: str, force: bool = False) -> int | None:
    """Count records in OpenData whose extractdate (business) or issuedate (permits) is yesterday (Vancouver time)."""
    y_str = _yesterday_vancouver_str()
    cache_key = (dataset_key, y_str)
    now = time.time()
    if not force:
        with _QUERY_CACHE_LOCK:
            hit = _YESTERDAY_COUNT_CACHE.get(cache_key)
            if hit and (now - hit[0]) < _YESTERDAY_CACHE_TTL_SEC:
                return hit[1]

    if dataset_key == "business-licences":
        y_start = datetime.strptime(y_str, "%Y-%m-%d").replace(tzinfo=_VANCOUVER_TZ)
        y_end = y_start + timedelta(days=1) - timedelta(seconds=1)
        start_utc = y_start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        end_utc = y_end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        where_expr = f"extractdate >= '{start_utc}' and extractdate <= '{end_utc}'"
    else:
        where_expr = f"issuedate = date'{y_str}'"

    try:
        resp = requests.get(
            _base_records_url(dataset_key),
            params={"lang": "en", "limit": 0, "where": where_expr},
            headers=HEADERS,
            timeout=12,
        )
        resp.raise_for_status()
        cnt = int((resp.json() or {}).get("total_count") or 0)
        with _QUERY_CACHE_LOCK:
            _YESTERDAY_COUNT_CACHE[cache_key] = (now, cnt)
        return cnt
    except Exception:
        return None


def _clean_str(val: Any) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _extract_coords(row: dict[str, Any]) -> tuple[float | None, float | None]:
    gp = row.get("geo_point_2d")
    if isinstance(gp, dict) and gp.get("lat") is not None and gp.get("lon") is not None:
        try:
            return round(float(gp["lat"]), 7), round(float(gp["lon"]), 7)
        except (TypeError, ValueError):
            pass
    geom_wrap = row.get("geom")
    geom = geom_wrap.get("geometry") if isinstance(geom_wrap, dict) and "geometry" in geom_wrap else geom_wrap
    if isinstance(geom, dict):
        lon, lat = _extract_lon_lat(geom)
        if lat is not None and lon is not None:
            return round(float(lat), 7), round(float(lon), 7)
    return None, None


def normalize_business_licence(row: dict[str, Any]) -> dict[str, Any]:
    lat, lon = _extract_coords(row)
    emp_raw = row.get("numberofemployees")
    employees: int | None = None
    if emp_raw is not None:
        try:
            employees = int(round(float(emp_raw)))
        except (TypeError, ValueError):
            employees = None
    return {
        "licencenumber": _clean_str(row.get("licencenumber")),
        "businesstype": _clean_str(row.get("businesstype")),
        "businesstradename": _clean_str(row.get("businesstradename")),
        "issueddate": _clean_str(row.get("issueddate")),
        "expireddate": _clean_str(row.get("expireddate")),
        "numberofemployees": employees,
        "localarea": _clean_str(row.get("localarea")),
        "status": _clean_str(row.get("status")),
        "extractdate": _clean_str(row.get("extractdate")),
        "lat": lat,
        "lon": lon,
    }


def normalize_building_permit(row: dict[str, Any]) -> dict[str, Any]:
    lat, lon = _extract_coords(row)
    val_raw = row.get("projectvalue")
    project_val: float | None = None
    if val_raw is not None:
        try:
            project_val = float(val_raw)
        except (TypeError, ValueError):
            project_val = None
    return {
        "permitnumber": _clean_str(row.get("permitnumber")),
        "typeofwork": _clean_str(row.get("typeofwork")),
        "permitcategory": _clean_str(row.get("permitcategory")),
        "address": _clean_str(row.get("address")),
        "issuedate": _clean_str(row.get("issuedate")),
        "projectvalue": project_val,
        "buildingcontractor": _clean_str(row.get("buildingcontractor")),
        "geolocalarea": _clean_str(row.get("geolocalarea")),
        "projectdescription": _clean_str(row.get("projectdescription")),
        "lat": lat,
        "lon": lon,
    }


def _normalize_record(dataset_key: str, row: dict[str, Any]) -> dict[str, Any]:
    if dataset_key == "business-licences":
        return normalize_business_licence(row)
    return normalize_building_permit(row)


def _atomic_write_json(path: str, payload: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp_od_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def _base_records_url(dataset_key: str) -> str:
    cfg = DATASET_CONFIGS[dataset_key]
    configured = get_source_endpoint_url(cfg["source_id"], cfg["default_url"])
    return (configured or cfg["default_url"]).split("?")[0].rstrip("/")


def _fetch_facets(dataset_key: str) -> dict[str, list[dict[str, Any]]]:
    cfg = DATASET_CONFIGS[dataset_key]
    base_url = _base_records_url(dataset_key)
    facets_endpoint = base_url[:-len("/records")] + "/facets" if base_url.endswith("/records") else cfg["facets_url"].split("?")[0]
    facets_out: dict[str, list[dict[str, Any]]] = {f: [] for f in cfg["filter_fields"]}
    try:
        params: list[tuple[str, str]] = [("lang", "en"), ("limit", "100")]
        for field in cfg["filter_fields"]:
            params.append(("facet", field))
        resp = requests.get(facets_endpoint, params=params, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            for grp in data.get("facets") or []:
                fname = grp.get("name")
                if fname in facets_out:
                    items = []
                    for fval in grp.get("facets") or []:
                        val = fval.get("value")
                        if val is not None and str(val).strip():
                            items.append({"value": str(val).strip(), "count": int(fval.get("count") or 0)})
                    facets_out[fname] = items
    except Exception as e:
        print(f"  ⚠️ 取得 {dataset_key} facets 失敗: {e}")
    return facets_out


def fetch_latest_dataset(dataset_key: str, target_count: int = 1000) -> dict[str, Any]:
    """
    從溫哥華 OpenData v2.1 擷取最新 1000 筆資料與分類統計 (facets)，
    並寫入 backend/data 與 frontend/public 快取檔。
    """
    cfg = DATASET_CONFIGS[dataset_key]
    base_url = _base_records_url(dataset_key)
    order_by = cfg["sort_map"][cfg["default_sort"]]

    print(f"📥 [{dataset_key}] 正在向溫哥華 OpenData v2.1 下載最新 {target_count} 筆資料...")
    records: list[dict[str, Any]] = []
    api_total_count = 0
    limit = 100

    for offset in range(0, target_count, limit):
        try:
            resp = requests.get(
                base_url,
                params={"lang": "en", "limit": limit, "offset": offset, "order_by": order_by},
                headers=HEADERS,
                timeout=30,
            )
            resp.raise_for_status()
            payload = resp.json()
            if offset == 0:
                api_total_count = int(payload.get("total_count") or 0)
            batch = payload.get("results") or []
            if not batch:
                break
            for row in batch:
                records.append(_normalize_record(dataset_key, row))
            if len(batch) < limit:
                break
        except Exception as e:
            print(f"  ⚠️ [{dataset_key}] 分頁擷取異常 (offset={offset}): {e}")
            break

    facets = _fetch_facets(dataset_key)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    latest_date = None
    if records:
        latest_date = records[0].get("extractdate") if dataset_key == "business-licences" else records[0].get("issuedate")

    out_payload = {
        "updated_at": now_iso,
        "dataset": cfg["dataset_slug"],
        "api_total_count": api_total_count or len(records),
        "total_count": len(records),
        "latest_recency_date": latest_date,
        "facets": facets,
        "results": records,
    }

    if records:
        be_path = os.path.join(BACKEND_DATA_DIR, cfg["cache_filename"])
        _atomic_write_json(be_path, out_payload)
        if os.path.exists(FRONTEND_DATA_DIR):
            fe_path = os.path.join(FRONTEND_DATA_DIR, cfg["cache_filename"])
            _atomic_write_json(fe_path, out_payload)
        update_admin_source_metadata(cfg["source_id"], record_count=api_total_count or len(records), updated_at=now_iso)
        print(f"✅ [{dataset_key}] 快取寫入完成: 本機 {len(records)} 筆 (OpenData 總數 {api_total_count}) -> {be_path}")

    return out_payload


def _load_local_cache(dataset_key: str) -> dict[str, Any] | None:
    cfg = DATASET_CONFIGS[dataset_key]
    for d in (BACKEND_DATA_DIR, FRONTEND_DATA_DIR):
        p = os.path.join(d, cfg["cache_filename"])
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("results"), list):
                    return data
            except Exception:
                pass
    return None


def _escape_odsql_str(val: str) -> str:
    # ODSQL single-quoted string escaping: strip control characters and escape single quotes cleanly
    cleaned = re.sub(r"[\x00-\x1f\x7f]", " ", str(val)).strip()
    return cleaned.replace("\\", "").replace("'", "''")


def _filter_local_fallback(
    dataset_key: str,
    cached: dict[str, Any],
    page: int,
    page_size: int,
    q: str,
    filters: dict[str, str],
    date_str: str,
    sort_key: str,
) -> dict[str, Any]:
    items = list(cached.get("results") or [])
    cfg = DATASET_CONFIGS[dataset_key]
    date_field = cfg["date_field"]

    for field, fval in filters.items():
        if fval and fval != "all":
            items = [it for it in items if str(it.get(field) or "") == fval]

    if date_str:
        items = [it for it in items if str(it.get(date_field) or "")[:10] == date_str]

    if q:
        ql = q.lower()
        items = [
            it for it in items
            if any(ql in str(v).lower() for k, v in it.items() if k not in ("lat", "lon") and v is not None)
        ]

    if dataset_key == "business-licences":
        rev = sort_key not in ("issued_asc",)
        if sort_key == "employees_desc":
            items.sort(key=lambda x: x.get("numberofemployees") or -1, reverse=True)
        elif sort_key == "expired_desc":
            items.sort(key=lambda x: str(x.get("expireddate") or ""), reverse=True)
        elif sort_key in ("issued_desc", "issued_asc"):
            items.sort(key=lambda x: str(x.get("issueddate") or ""), reverse=rev)
        else:
            items.sort(key=lambda x: (str(x.get("extractdate") or ""), str(x.get("issueddate") or "")), reverse=True)
    else:
        if sort_key == "issuedate_asc":
            items.sort(key=lambda x: str(x.get("issuedate") or ""))
        elif sort_key == "value_desc":
            items.sort(key=lambda x: x.get("projectvalue") if x.get("projectvalue") is not None else -1, reverse=True)
        elif sort_key == "value_asc":
            items.sort(key=lambda x: x.get("projectvalue") if x.get("projectvalue") is not None else 1e18)
        else:
            items.sort(key=lambda x: str(x.get("issuedate") or ""), reverse=True)

    total = len(items)
    start = (page - 1) * page_size
    return {
        "total_count": total,
        "yesterday_count": _get_yesterday_count(dataset_key) or cached.get("yesterday_count"),
        "page": page,
        "page_size": page_size,
        "latest_recency_date": cached.get("latest_recency_date"),
        "facets": cached.get("facets") or {},
        "results": items[start : start + page_size],
        "source": "cache",
    }


def query_explore_dataset(
    dataset_key: str,
    page: int = 1,
    page_size: int = 20,
    q: str = "",
    filters: dict[str, str] | None = None,
    date_str: str = "",
    sort_key: str = "",
    force: bool = False,
) -> dict[str, Any]:
    """
    混合快取與溫哥華 OpenData v2.1 即時查詢：
    - 預設無篩選第 1 頁直接從本機快取提供 (毫秒級回應)
    - 有搜尋/篩選/日期/排序/翻頁時向 OpenData v2.1 即時檢索全量資料 (含 90s 記憶體快取)
    """
    cfg = DATASET_CONFIGS[dataset_key]
    page = max(1, int(page or 1))
    page_size = max(1, min(100, int(page_size or 20)))
    q = (q or "").strip()
    date_str = (date_str or "").strip()
    if date_str and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
        date_str = ""
    clean_filters = {
        k: (v or "").strip()
        for k, v in (filters or {}).items()
        if k in cfg["filter_fields"] and (v or "").strip() and (v or "").strip() != "all"
    }
    if sort_key not in cfg["sort_map"]:
        sort_key = cfg["default_sort"]

    cached = _load_local_cache(dataset_key)
    is_default_first_page = (
        not force
        and page == 1
        and page_size <= 20
        and not q
        and not clean_filters
        and not date_str
        and sort_key == cfg["default_sort"]
    )
    if is_default_first_page and cached and cached.get("results"):
        y_cnt = _get_yesterday_count(dataset_key)
        return {
            "total_count": cached.get("api_total_count") or len(cached["results"]),
            "yesterday_count": y_cnt if y_cnt is not None else cached.get("yesterday_count"),
            "page": 1,
            "page_size": page_size,
            "latest_recency_date": cached.get("latest_recency_date"),
            "facets": cached.get("facets") or {},
            "results": cached["results"][:page_size],
            "updated_at": cached.get("updated_at"),
            "source": "local_cache",
        }

    offset = (page - 1) * page_size
    if offset > _OPENDATA_MAX_OFFSET:
        offset = _OPENDATA_MAX_OFFSET
        page = (offset // page_size) + 1

    cache_key = (
        dataset_key,
        page,
        page_size,
        q,
        tuple(sorted(clean_filters.items())),
        date_str,
        sort_key,
    )
    now = time.time()
    if not force:
        with _QUERY_CACHE_LOCK:
            hit = _QUERY_CACHE.get(cache_key)
            if hit and (now - hit[0]) < _CACHE_TTL_SEC:
                return hit[1]

    where_clauses: list[str] = []
    for ffield, fval in clean_filters.items():
        where_clauses.append(f"{ffield} = '{_escape_odsql_str(fval)}'")

    if date_str:
        date_field = cfg["date_field"]
        if cfg["date_is_datetime"]:
            next_day = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
            # Accommodate PST (-08) & PDT (-07): [date 07:00Z .. next_day 08:59:59Z]
            where_clauses.append(f"{date_field} >= '{date_str}T07:00:00Z' and {date_field} <= '{next_day}T08:59:59Z'")
        else:
            where_clauses.append(f"{date_field} = date'{date_str}'")

    if q:
        # Handle hyphenated numbers/addresses safely inside search() or field LIKE
        escaped_q = _escape_odsql_str(q)
        if dataset_key == "business-licences":
            where_clauses.append(
                f"(search('{escaped_q}') or licencenumber like '%{escaped_q}%' or businesstradename like '%{escaped_q}%')"
            )
        else:
            where_clauses.append(
                f"(search('{escaped_q}') or permitnumber like '%{escaped_q}%' or address like '%{escaped_q}%')"
            )

    params: dict[str, Any] = {
        "lang": "en",
        "limit": page_size,
        "offset": offset,
        "order_by": cfg["sort_map"][sort_key],
    }
    if where_clauses:
        params["where"] = " and ".join(where_clauses)

    base_url = _base_records_url(dataset_key)
    try:
        resp = requests.get(base_url, params=params, headers=HEADERS, timeout=18)
        resp.raise_for_status()
        od_json = resp.json()
        raw_results = od_json.get("results") or []
        norm_results = [_normalize_record(dataset_key, row) for row in raw_results]
        total_count = int(od_json.get("total_count") or len(norm_results))
        facets = (cached or {}).get("facets")
        if not facets or not any(facets.values()):
            facets = _fetch_facets(dataset_key)

        recency = (cached or {}).get("latest_recency_date")
        if not recency and norm_results:
            recency = norm_results[0].get("extractdate") if dataset_key == "business-licences" else norm_results[0].get("issuedate")

        y_cnt = _get_yesterday_count(dataset_key, force=force)
        result_payload = {
            "total_count": total_count,
            "yesterday_count": y_cnt if y_cnt is not None else (cached or {}).get("yesterday_count"),
            "page": page,
            "page_size": page_size,
            "latest_recency_date": recency,
            "facets": facets or {},
            "results": norm_results,
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "opendata_live",
        }
        with _QUERY_CACHE_LOCK:
            if len(_QUERY_CACHE) > 200:
                _QUERY_CACHE.clear()
            _QUERY_CACHE[cache_key] = (now, result_payload)
        return result_payload
    except Exception as e:
        print(f"  ⚠️ [{dataset_key}] OpenData 即時查詢失敗 ({e})，回退至本機快取")
        if cached:
            return _filter_local_fallback(dataset_key, cached, page, page_size, q, clean_filters, date_str, sort_key)
        return {
            "total_count": 0,
            "page": page,
            "page_size": page_size,
            "latest_recency_date": None,
            "facets": {},
            "results": [],
            "source": "error",
        }
