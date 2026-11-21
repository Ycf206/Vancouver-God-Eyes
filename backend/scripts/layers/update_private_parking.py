import html
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import (
    get_source_endpoint_url,
    load_existing_geojson,
    save_layer_geojson,
    update_admin_source_metadata,
)

IMPARK_DEFAULT_URL = (
    "https://lots.impark.com/api/lots/IMP/en?"
    "latLoc=49.231405747636195&lngLoc=-123.10900119980765"
    "&latMin=49.098730747823055&lngMin=-123.48699955185843"
    "&latMax=49.36372538454293&lngMax=-122.73100284775687&csr=0&branchName="
)

EASYPARK_API_URL = (
    "https://easypark-api-489514297582.northamerica-northeast1.run.app/public/lots"
    "?org=6a60f81f5e9fe19bedcf61c4"
)
EASYPARK_WEB_BASE = "https://findparking.easypark.ca"

INDIGO_LIST_URL = (
    "https://salesforce.parkindigo.com/locations"
    "?location.language=en&location.address.countries=CA"
    "&box.first.x=49.42&box.first.y=-123.55"
    "&box.second.x=49.00&box.second.y=-122.45"
)
INDIGO_DETAIL_TEMPLATE = "https://salesforce.parkindigo.com/locations/{slug}?language=en"
INDIGO_WEB_BASE = "https://indigoneo.ca/en/car-park"

METRO_VANCOUVER_CITIES = {
    "vancouver",
    "burnaby",
    "richmond",
    "surrey",
    "north vancouver",
    "west vancouver",
    "new westminster",
    "coquitlam",
    "port coquitlam",
    "port moody",
    "delta",
    "langley",
    "langley city",
    "langley twp",
    "maple ridge",
    "pitt meadows",
    "white rock",
    "bowen island",
    "lions bay",
    "anmore",
    "belcarra",
    "tsawwassen",
    "university endowment lands",
}

CITY_DISPLAY_MAP = {
    "vancouver": "Vancouver",
    "burnaby": "Burnaby",
    "richmond": "Richmond",
    "surrey": "Surrey",
    "north vancouver": "North Vancouver",
    "west vancouver": "West Vancouver",
    "new westminster": "New Westminster",
    "coquitlam": "Coquitlam",
    "port coquitlam": "Port Coquitlam",
    "port moody": "Port Moody",
    "delta": "Delta",
    "langley": "Langley",
    "langley city": "Langley City",
    "langley twp": "Langley Twp",
    "maple ridge": "Maple Ridge",
    "pitt meadows": "Pitt Meadows",
    "white rock": "White Rock",
    "bowen island": "Bowen Island",
    "lions bay": "Lions Bay",
    "anmore": "Anmore",
    "belcarra": "Belcarra",
    "tsawwassen": "Tsawwassen",
    "university endowment lands": "University Endowment Lands",
}

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
)

EASYPARK_HEADERS = {
    "accept": "*/*",
    "accept-language": "zh-HK,zh;q=0.9,en-HK;q=0.8,en-US;q=0.7,en;q=0.6,zh-TW;q=0.5",
    "origin": "https://findparking.easypark.ca",
    "referer": "https://findparking.easypark.ca/",
    "user-agent": CHROME_UA,
}

INDIGO_HEADERS = {
    "accept": "*/*",
    "accept-language": "zh-HK,zh;q=0.9,en-HK;q=0.8,en-US;q=0.7,en;q=0.6,zh-TW;q=0.5",
    "origin": "https://indigoneo.ca",
    "referer": "https://indigoneo.ca/",
    "user-agent": CHROME_UA,
}


def _clean_text(s: Any) -> str:
    if s is None:
        return ""
    txt = html.unescape(str(s))
    txt = txt.replace("\u200b", "").replace("\ufeff", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", txt).strip()


def _normalize_city(raw_city: Any) -> str:
    c = _clean_text(raw_city)
    if not c:
        return ""
    return CITY_DISPLAY_MAP.get(c.lower(), c)


def _html_to_clean_lines(raw_html: Any) -> tuple[list[str], str]:
    """Convert EasyPark rich-text HTML terms into clean text lines and optional apply URL."""
    if not raw_html or not isinstance(raw_html, str):
        return [], ""
    link_url = ""
    m_link = re.search(r'href=["\'](https?://[^"\']+)["\']', raw_html, re.I)
    if m_link:
        link_url = m_link.group(1).strip()

    body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", "\n", raw_html)
    body = re.sub(r"(?i)<(?:br\s*/?|/p|/div|/li|/tr|/h[1-6])>", "\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    lines: list[str] = []
    for raw_ln in body.splitlines():
        cleaned = _clean_text(raw_ln)
        if not cleaned:
            continue
        if cleaned.lower().startswith("learn more and apply for monthly parking"):
            continue
        lines.append(cleaned)
    return lines, link_url


# ===================== 1. ImPark =====================
def _fetch_impark_lots(url: str) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    try:
        resp = requests.get(url, headers={"User-Agent": CHROME_UA}, timeout=30)
        if resp.status_code != 200:
            print(f"⚠️ ImPark API HTTP {resp.status_code}")
            return features
        lots = resp.json()
        for lot in lots:
            addr = lot.get("address") or {}
            city = _normalize_city(addr.get("city"))
            if city.lower() not in METRO_VANCOUVER_CITIES:
                continue

            loc = lot.get("location") or {}
            lat = float(loc.get("lat") or 0)
            lng = float(loc.get("lng") or 0)
            if lat == 0 or lng == 0:
                continue

            fid = f"impark_{lot.get('lotId') or lot.get('lotNumber')}"
            if fid in seen_ids:
                continue
            seen_ids.add(fid)

            feat_list: list[str] = []
            for f in lot.get("features") or []:
                if isinstance(f, dict) and f.get("value"):
                    feat_list.append(_clean_text(f["value"]))
                elif isinstance(f, str) and f.strip():
                    feat_list.append(_clean_text(f))

            feat_lower = [x.lower() for x in feat_list]
            has_transient = bool(lot.get("hasTransientRates"))
            has_monthly = bool(lot.get("hasMonthlyRates"))
            has_ev = any("ev" in x or "charg" in x for x in feat_lower)
            has_sparc = any("sparc" in x or "accessible" in x for x in feat_lower)

            features.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lng, 6), round(lat, 6)],
                    },
                    "properties": {
                        "id": fid,
                        "facility_type": "impark",
                        "company": "impark",
                        "operator": "ImPark",
                        "lot_id": lot.get("lotId"),
                        "lot_number": lot.get("lotNumber"),
                        "lot_name": _clean_text(lot.get("lotName") or f"Lot {lot.get('lotNumber')}"),
                        "address1": _clean_text(addr.get("address1")),
                        "address2": _clean_text(addr.get("address2")),
                        "city": city or "Vancouver",
                        "postal_code": _clean_text(addr.get("postalCode")),
                        "hasTransientRates": has_transient,
                        "lowestTransientRate": lot.get("lowestTransientRate"),
                        "hasMonthlyRates": has_monthly,
                        "lowestMonthlyRate": lot.get("lowestMonthlyRate"),
                        "hasSeasonalRates": False,
                        "hasAnnualRates": False,
                        "hasSparc": has_sparc,
                        "hasEvCharger": has_ev,
                        "capacity": lot.get("capacity"),
                        "features": feat_list,
                        "rates": lot.get("rates") or [],
                        "street_view_url": lot.get("streetViewUrl") or "",
                        "directions_url": lot.get("directionsUrl") or "",
                    },
                }
            )
    except Exception as e:
        print(f"⚠️ 線上更新 ImPark 停車場失敗: {e}")
    features.sort(key=lambda f: str((f.get("properties") or {}).get("lot_number") or ""))
    return features


# ===================== 2. EasyPark (Cloud Run API) =====================
def _fetch_easypark_lots(api_url: str = EASYPARK_API_URL) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    try:
        resp = requests.get(api_url, headers=EASYPARK_HEADERS, timeout=30)
        if resp.status_code != 200:
            print(f"⚠️ EasyPark API HTTP {resp.status_code}")
            return features
        lots = resp.json()
        if not isinstance(lots, list):
            return features

        for lot in lots:
            if not isinstance(lot, dict):
                continue
            city = _normalize_city(lot.get("city"))
            if city.lower() not in METRO_VANCOUVER_CITIES:
                continue

            lat = lot.get("latitude")
            lng = lot.get("longitude")
            if (lat is None or lng is None) and isinstance(lot.get("location"), dict):
                coords = lot["location"].get("coordinates") or []
                if len(coords) >= 2:
                    lng, lat = coords[0], coords[1]
            try:
                lat_f = float(lat)
                lng_f = float(lng)
            except (TypeError, ValueError):
                continue
            if lat_f == 0 or lng_f == 0:
                continue

            lot_number = lot.get("lotNumber")
            slug = _clean_text(lot.get("slug"))
            raw_id = _clean_text(lot.get("_id"))
            name = _clean_text(lot.get("name")) or _clean_text(lot.get("street"))
            street = _clean_text(lot.get("street")) or name

            fid_suffix = str(lot_number) if lot_number not in (None, "") else (slug or raw_id)
            fid = f"easypark_{fid_suffix}"
            if fid in seen_ids:
                fid = f"easypark_{fid_suffix}_{raw_id[-6:]}"
            seen_ids.add(fid)

            feat_list = [
                _clean_text(x) for x in (lot.get("features") or []) if _clean_text(x)
            ]
            feat_lower = {f.lower() for f in feat_list}

            zone_numbers: list[dict[str, str]] = []
            pay_zones: list[dict[str, str]] = []
            for z in lot.get("zoneNumbers") or []:
                if not isinstance(z, dict):
                    continue
                plat = _clean_text(z.get("platform"))
                num = _clean_text(z.get("number"))
                if num:
                    zone_numbers.append({"platform": plat, "number": num})
                    pay_zones.append({"provider": plat or "Zone", "code": num})

            payment_methods = [
                _clean_text(pm) for pm in (lot.get("paymentMethods") or []) if _clean_text(pm)
            ]

            images: list[str] = []
            for img in lot.get("images") or []:
                if isinstance(img, dict) and img.get("url"):
                    images.append(str(img["url"]).strip())
                elif isinstance(img, str) and img.strip():
                    images.append(img.strip())

            about_details = [
                _clean_text(x) for x in (lot.get("aboutDetails") or []) if _clean_text(x)
            ]

            rates_obj = lot.get("rates") if isinstance(lot.get("rates"), dict) else {}
            daily_terms_lines, _ = _html_to_clean_lines(
                (rates_obj.get("daily") or {}).get("terms") if isinstance(rates_obj.get("daily"), dict) else None
            )
            monthly_terms_lines, monthly_apply_url = _html_to_clean_lines(
                (rates_obj.get("monthly") or {}).get("terms") if isinstance(rates_obj.get("monthly"), dict) else None
            )
            event_terms_lines, _ = _html_to_clean_lines(
                (rates_obj.get("event") or {}).get("terms") if isinstance(rates_obj.get("event"), dict) else None
            )
            seasonal_terms_lines, _ = _html_to_clean_lines(
                (rates_obj.get("seasonal") or {}).get("terms") if isinstance(rates_obj.get("seasonal"), dict) else None
            )

            rate_val = _clean_text(lot.get("rate")) or None
            daily_max_val = _clean_text(lot.get("dailyMax")) or None
            monthly_rate_val = _clean_text(lot.get("monthlyRate")) or None
            height_restriction_val = _clean_text(lot.get("heightRestriction")) or None
            stalls_val = lot.get("stalls")

            has_transient = ("daily" in feat_lower) or bool(rate_val) or bool(daily_terms_lines)
            has_monthly = ("monthly" in feat_lower) or bool(monthly_rate_val) or bool(monthly_terms_lines)
            has_seasonal = ("seasonal" in feat_lower) or bool(seasonal_terms_lines)
            has_annual = "annual" in feat_lower
            has_sparc = "sparc" in feat_lower
            has_ev = ("evcharging" in feat_lower) or any("ev" in f for f in feat_lower)

            features.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lng_f, 6), round(lat_f, 6)],
                    },
                    "properties": {
                        "id": fid,
                        "facility_type": "impark",
                        "company": "easypark",
                        "operator": "EasyPark",
                        "lot_id": raw_id or fid,
                        "lot_number": lot_number,
                        "name": name,
                        "lot_name": name,
                        "address1": street,
                        "address2": "",
                        "city": city or "Vancouver",
                        "postal_code": "",
                        "slug": slug,
                        "rate": rate_val,
                        "daily_max": daily_max_val,
                        "monthly_rate": monthly_rate_val,
                        "stalls": stalls_val,
                        "capacity": stalls_val,
                        "height_restriction": height_restriction_val,
                        "zone_numbers": zone_numbers,
                        "pay_zones": pay_zones,
                        "payment_methods": payment_methods,
                        "features": feat_list,
                        "about_details": about_details,
                        "images": images,
                        "rates_daily_terms": daily_terms_lines,
                        "rates_monthly_terms": monthly_terms_lines,
                        "rates_monthly_apply_url": monthly_apply_url,
                        "rates_event_terms": event_terms_lines,
                        "rates_seasonal_terms": seasonal_terms_lines,
                        "hasTransientRates": has_transient,
                        "lowestTransientRate": {"label": "時租費率", "value": rate_val} if rate_val else None,
                        "hasMonthlyRates": has_monthly,
                        "lowestMonthlyRate": {"label": "月租費率", "value": monthly_rate_val} if monthly_rate_val else None,
                        "hasSeasonalRates": has_seasonal,
                        "hasAnnualRates": has_annual,
                        "hasSparc": has_sparc,
                        "hasEvCharger": has_ev,
                        "street_view_url": "",
                        "directions_url": f"https://www.google.com/maps/dir/?api=1&destination={lat_f},{lng_f}",
                        "lot_url": f"{EASYPARK_WEB_BASE}/",
                    },
                }
            )
    except Exception as e:
        print(f"⚠️ 線上更新 EasyPark 停車場失敗: {e}")

    features.sort(key=lambda f: str((f.get("properties") or {}).get("lot_number") or ""))
    return features


# ===================== 3. Indigo (API1 list + API2 detail) =====================
INDIGO_SERVICE_LABEL_MAP = {
    "electricCharging": "電動車充電樁",
    "electricPlugin": "電動車插座",
    "accessibilityForDisabled": "無障礙車位",
    "valetParking": "代客泊車",
    "toilets": "洗手間",
    "carWash": "洗車服務",
    "carService": "車輛維修保養",
    "jumpStartBattery": "電瓶救援充電",
    "tyreInflation": "輪胎打氣",
    "carRental": "租車服務",
    "bicycleRental": "單車租借",
    "parentAndChild": "親子車位",
    "umbrella": "雨傘借用",
}

INDIGO_PAYMENT_LABEL_MAP = {
    "visa": "Visa",
    "masterCard": "MasterCard",
    "americanExpress": "American Express",
    "debit": "Debit",
    "cash": "Cash",
    "phone": "Pay by Phone",
}


def _extract_indigo_lot_number(name: str, grs_id: str) -> str:
    m = re.search(r"\b(?:Lot\s*#?\s*|V)(\d{2,5}[A-Za-z]?)\b", name, re.I)
    if m:
        return m.group(0).replace("  ", " ").strip()
    return grs_id


def _format_indigo_opening_hours(detail: dict[str, Any]) -> str:
    if detail.get("isOpen247"):
        return "24 小時全天開放"
    oh = _clean_text(detail.get("openingHours"))
    if oh:
        return oh
    days = [
        ("openingHoursMonday", "週一"),
        ("openingHoursTuesday", "週二"),
        ("openingHoursWednesday", "週三"),
        ("openingHoursThursday", "週四"),
        ("openingHoursFriday", "週五"),
        ("openingHoursSaturday", "週六"),
        ("openingHoursSunday", "週日"),
    ]
    parts = [f"{lbl}: {_clean_text(detail.get(k))}" for k, lbl in days if _clean_text(detail.get(k))]
    return " · ".join(parts)


def _fetch_indigo_detail(summary: dict[str, Any]) -> dict[str, Any] | None:
    slug = _clean_text(summary.get("id"))
    if not slug:
        return None

    detail = dict(summary)
    try:
        resp = requests.get(
            INDIGO_DETAIL_TEMPLATE.format(slug=slug),
            headers=INDIGO_HEADERS,
            timeout=20,
        )
        if resp.status_code == 200:
            djson = resp.json()
            if isinstance(djson, dict):
                detail.update(djson)
    except Exception:
        pass

    addr = detail.get("address") or {}
    city = _normalize_city(addr.get("city"))
    if city and city.lower() not in METRO_VANCOUVER_CITIES:
        return None

    geo = detail.get("geoLocation") or {}
    try:
        lat_f = float(geo.get("x") or 0)
        lng_f = float(geo.get("y") or 0)
    except (TypeError, ValueError):
        return None
    if lat_f == 0 or lng_f == 0:
        return None

    addr_lines = [_clean_text(ln) for ln in (addr.get("lines") or []) if _clean_text(ln)]
    address1 = ", ".join(addr_lines)
    postal_code = _clean_text(addr.get("zipCode"))
    name = _clean_text(detail.get("name")) or address1 or slug
    grs_id = _clean_text(detail.get("grsId") or detail.get("siteIdentification"))
    lot_number = _extract_indigo_lot_number(name, grs_id)

    services = detail.get("services") if isinstance(detail.get("services"), dict) else {}
    feat_list: list[str] = []
    for k, zh_lbl in INDIGO_SERVICE_LABEL_MAP.items():
        if services.get(k):
            feat_list.append(zh_lbl)

    if detail.get("isOpen247"):
        feat_list.append("24 小時開放")
    if detail.get("motorcyclesAllowed"):
        feat_list.append("電單車位")
    if detail.get("reservationsEnabled"):
        feat_list.append("支援線上預約")
    if detail.get("seasonTicketsEnabled"):
        feat_list.append("月租方案")
    if detail.get("payAsYouGoEnabled"):
        feat_list.append("隨停即付")

    structure_parts: list[str] = []
    if detail.get("garageIsUnderground"):
        structure_parts.append("地下停車場")
    if detail.get("mscpGarageIsAboveGround"):
        structure_parts.append("多層室內停車場")
    if detail.get("isOnSurface"):
        structure_parts.append("露天地面停車場")
    structure_type = " / ".join(structure_parts)

    payments = detail.get("payments") if isinstance(detail.get("payments"), dict) else {}
    payment_methods = [
        lbl for k, lbl in INDIGO_PAYMENT_LABEL_MAP.items() if payments.get(k)
    ]

    hr_raw = detail.get("heightRestriction")
    height_restriction = ""
    try:
        if hr_raw is not None and float(hr_raw) > 0:
            height_restriction = f"{float(hr_raw):.2f} m"
    except (TypeError, ValueError):
        pass
    if not height_restriction and detail.get("heightIsOver3m5"):
        height_restriction = "3.5 m 以上"

    long_desc_raw = str(detail.get("longDescription") or "").strip()
    long_desc_lines = [
        _clean_text(ln) for ln in long_desc_raw.splitlines() if _clean_text(ln)
    ]
    short_desc = _clean_text(detail.get("shortDescription"))
    desc_lower = f"{long_desc_raw} {short_desc}".lower()

    prices_raw = detail.get("prices") if isinstance(detail.get("prices"), list) else []
    prices_clean: list[dict[str, Any]] = []
    for pr in prices_raw:
        if isinstance(pr, dict):
            prices_clean.append(pr)

    has_monthly = bool(detail.get("seasonTicketsEnabled")) or ("monthly" in desc_lower)
    has_transient = (
        bool(detail.get("reservationsEnabled"))
        or bool(detail.get("payAsYouGoEnabled"))
        or bool(prices_clean)
        or any(k in desc_lower for k in ("hourly", "daily", "evening", "transient", "visitor", "customer"))
        or not has_monthly
    )
    has_ev = bool(services.get("electricCharging") or services.get("electricPlugin"))
    has_sparc = bool(services.get("accessibilityForDisabled"))

    fid = f"indigo_{slug}"
    return {
        "type": "Feature",
        "id": fid,
        "geometry": {
            "type": "Point",
            "coordinates": [round(lng_f, 6), round(lat_f, 6)],
        },
        "properties": {
            "id": fid,
            "facility_type": "impark",
            "company": "indigo",
            "operator": "Indigo",
            "lot_id": slug,
            "grs_id": grs_id,
            "lot_number": lot_number,
            "name": name,
            "lot_name": name,
            "address1": address1,
            "address2": "",
            "city": city or "Vancouver",
            "postal_code": postal_code,
            "capacity": detail.get("totalSpaces"),
            "phone": _clean_text(detail.get("phone")),
            "email": _clean_text(detail.get("email")),
            "is_open_247": bool(detail.get("isOpen247")),
            "hours": _format_indigo_opening_hours(detail),
            "height_restriction": height_restriction,
            "structure_type": structure_type,
            "stay_restrictions": _clean_text(detail.get("stayRestrictions")),
            "long_description_lines": long_desc_lines,
            "short_description": short_desc,
            "payment_methods": payment_methods,
            "prices": prices_clean,
            "reservations_enabled": bool(detail.get("reservationsEnabled")),
            "season_tickets_enabled": bool(detail.get("seasonTicketsEnabled")),
            "pay_as_you_go_enabled": bool(detail.get("payAsYouGoEnabled")),
            "hasTransientRates": has_transient,
            "lowestTransientRate": None,
            "hasMonthlyRates": has_monthly,
            "lowestMonthlyRate": None,
            "hasSeasonalRates": False,
            "hasAnnualRates": False,
            "hasSparc": has_sparc,
            "hasEvCharger": has_ev,
            "features": feat_list,
            "pay_zones": [],
            "rates": [],
            "street_view_url": "",
            "directions_url": f"https://www.google.com/maps/dir/?api=1&destination={lat_f},{lng_f}",
            "lot_url": f"{INDIGO_WEB_BASE}/{slug}",
            "reservation_url": detail.get("externalSeasonTicketUrl") or "",
        },
    }


def _fetch_indigo_lots(list_url: str = INDIGO_LIST_URL) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()
    try:
        page = 0
        total_pages = 1
        while page < total_pages and page < 30:
            sep = "&" if "?" in list_url else "?"
            url = f"{list_url}{sep}page={page}"
            resp = requests.get(url, headers=INDIGO_HEADERS, timeout=25)
            if resp.status_code != 200:
                print(f"⚠️ Indigo API1 page={page} HTTP {resp.status_code}")
                break
            data = resp.json()
            total_pages = int(data.get("totalPages") or 1)
            for item in data.get("content") or []:
                if not isinstance(item, dict) or item.get("toBeDeleted"):
                    continue
                slug = _clean_text(item.get("id"))
                if not slug or slug in seen_slugs:
                    continue
                seen_slugs.add(slug)
                summaries.append(item)
            page += 1
    except Exception as e:
        print(f"⚠️ 線上更新 Indigo 停車場清單失敗: {e}")
        return []

    if not summaries:
        return []

    print(f"ℹ️ Indigo API1 共取得 {len(summaries)} 筆大溫哥華場站，正在並行擷取 API2 詳情...")
    features: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(_fetch_indigo_detail, s) for s in summaries]
        for fut in as_completed(futs):
            feat = fut.result()
            if feat:
                features.append(feat)

    features.sort(key=lambda f: str((f.get("properties") or {}).get("lot_id") or ""))
    return features


# ===================== Combined Updater =====================
def update_private_parking():
    print("🅿️ 正在更新大溫私人停車場情報 (ImPark + EasyPark + Indigo)...")
    impark_url = get_source_endpoint_url("impark_parking", IMPARK_DEFAULT_URL)
    if not impark_url or "latMin=49.185169174402894" in impark_url:
        impark_url = IMPARK_DEFAULT_URL

    impark_features = _fetch_impark_lots(impark_url)
    easypark_features = _fetch_easypark_lots(EASYPARK_API_URL)
    indigo_features = _fetch_indigo_lots(INDIGO_LIST_URL)

    if not impark_features or not easypark_features or not indigo_features:
        existing = load_existing_geojson("vancouver_impark.geojson") or {}
        existing_feats = existing.get("features") or []
        if not impark_features:
            print("ℹ️ ImPark 本次未取得資料，保留現有快取...")
            impark_features = [
                f for f in existing_feats if ((f.get("properties") or {}).get("company") or "impark") == "impark"
            ]
        if not easypark_features:
            print("ℹ️ EasyPark 本次未取得資料，保留現有快取...")
            easypark_features = [
                f for f in existing_feats if (f.get("properties") or {}).get("company") == "easypark"
            ]
        if not indigo_features:
            print("ℹ️ Indigo 本次未取得資料，保留現有快取...")
            indigo_features = [
                f for f in existing_feats if (f.get("properties") or {}).get("company") == "indigo"
            ]

    combined = impark_features + easypark_features + indigo_features
    if combined:
        save_layer_geojson("vancouver_impark.geojson", combined)
        update_admin_source_metadata("impark_parking", record_count=len(combined))
        print(
            f"✅ 私人停車場更新完成：ImPark {len(impark_features)} 處 + "
            f"EasyPark {len(easypark_features)} 處 + Indigo {len(indigo_features)} 處，"
            f"共 {len(combined)} 處場站。"
        )
    return combined


if __name__ == "__main__":
    update_private_parking()
