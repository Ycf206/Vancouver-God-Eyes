import html
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import get_source_endpoint_url, load_existing_geojson, save_layer_geojson

IMPARK_DEFAULT_URL = (
    "https://lots.impark.com/api/lots/IMP/en?"
    "latLoc=49.25143536989855&lngLoc=-123.21715982244642"
    "&latMin=49.185169174402894&lngMin=-123.40358407781751"
    "&latMax=49.31761273382262&lngMax=-123.03073556707533&csr=0&branchName="
)
EASYPARK_FIND_URL = "https://easypark.ca/find-parking"
EASYPARK_DETAIL_BASE = "https://easypark.ca/find-parking/locations-and-lot-information/lot-details"

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

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-CA,en;q=0.9",
}


def _clean_text(s: str) -> str:
    if not s:
        return ""
    s = html.unescape(s)
    s = s.replace("\u200b", "").replace("\ufeff", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def _html_to_lines(raw_html: str) -> list[str]:
    if not raw_html:
        return []
    body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", "\n", raw_html)
    body = re.sub(r"(?i)<(?:br\s*/?|/p|/div|/li|/tr|/h[1-6]|/td|/th)>", "\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    lines: list[str] = []
    for raw_ln in body.splitlines():
        cleaned = _clean_text(raw_ln)
        if cleaned:
            lines.append(cleaned)
    return lines


def _extract_tables(raw_html: str) -> list[list[list[str]]]:
    tables: list[list[list[str]]] = []
    for tbl_html in re.findall(r"(?is)<table[^>]*>(.*?)</table>", raw_html):
        rows: list[list[str]] = []
        for tr_html in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", tbl_html):
            cells = [
                _clean_text(re.sub(r"<[^>]+>", " ", c))
                for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", tr_html)
            ]
            cells = [c for c in cells if c]
            if cells:
                rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def _fetch_impark_lots(url: str) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    try:
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        if resp.status_code != 200:
            return features
        lots = resp.json()
        for lot in lots:
            addr = lot.get("address") or {}
            city = (addr.get("city") or "").strip()
            if city.lower() != "vancouver":
                continue

            loc = lot.get("location") or {}
            lat = float(loc.get("lat") or 0)
            lng = float(loc.get("lng") or 0)
            if lat == 0 or lng == 0:
                continue

            feat_list: list[str] = []
            for f in lot.get("features") or []:
                if isinstance(f, dict) and f.get("value"):
                    feat_list.append(_clean_text(str(f["value"])))
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
                    "id": f"impark_{lot.get('lotId') or lot.get('lotNumber')}",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lng, 6), round(lat, 6)],
                    },
                    "properties": {
                        "id": f"impark_{lot.get('lotId') or lot.get('lotNumber')}",
                        "facility_type": "impark",
                        "company": "impark",
                        "operator": "ImPark",
                        "lot_id": lot.get("lotId"),
                        "lot_number": lot.get("lotNumber"),
                        "lot_name": _clean_text(str(lot.get("lotName") or f"Lot {lot.get('lotNumber')}")),
                        "address1": _clean_text(str(addr.get("address1") or "")),
                        "address2": _clean_text(str(addr.get("address2") or "")),
                        "city": city or "Vancouver",
                        "postal_code": _clean_text(str(addr.get("postalCode") or "")),
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
    return features


def _parse_easypark_detail_html(raw_html: str) -> dict[str, Any]:
    if not raw_html or "oops! an error has occurred" in _clean_text(raw_html).lower():
        return {}

    lines = _html_to_lines(raw_html)
    tables = _extract_tables(raw_html)

    pay_zones: list[dict[str, str]] = []
    monthly_rates: list[dict[str, str]] = []
    seasonal_rates: list[dict[str, str]] = []
    annual_rates: list[dict[str, str]] = []

    for tbl in tables:
        flat = " ".join(" ".join(r) for r in tbl).lower()
        if "zone number" in flat or any(r[0].lower() in ("zipby", "honk", "parkmobile", "passport") for r in tbl if r):
            for r in tbl:
                if len(r) == 2 and r[0].lower() != "zone number":
                    pay_zones.append({"provider": r[0], "code": r[1]})
                elif len(r) == 2 and r[0].lower() == "zone number":
                    pay_zones.append({"provider": "Zone", "code": r[1]})
                elif len(r) >= 2 and r[0].lower() == "zone number":
                    pay_zones.append({"provider": "Zone", "code": " ".join(r[1:])})
        elif tbl and len(tbl[0]) >= 2 and tbl[0][0].lower() == "category" and tbl[0][1].lower() == "rate":
            row_texts = " ".join(" ".join(r) for r in tbl[1:]).lower()
            is_seasonal_tbl = any(
                k in row_texts for k in ("high season", "low season", "annual", "seasonal")
            )
            for r in tbl[1:]:
                if len(r) < 2:
                    continue
                lbl, val = r[0], r[1]
                if not lbl or not val:
                    continue
                low_lbl = lbl.lower()
                if is_seasonal_tbl:
                    if "annual" in low_lbl:
                        annual_rates.append({"label": lbl, "value": val})
                    else:
                        seasonal_rates.append({"label": lbl, "value": val})
                else:
                    monthly_rates.append({"label": lbl, "value": val})

    def _find_idx(target: str, start: int = 0) -> int:
        tl = target.lower()
        for i in range(start, len(lines)):
            if lines[i].lower() == tl or lines[i].lower().startswith(tl + " "):
                return i
        return -1

    def _next_boundary(start: int, stops: tuple[str, ...]) -> int:
        low_stops = tuple(s.lower() for s in stops)
        for i in range(start, len(lines)):
            ll = lines[i].lower()
            if any(ll == s or ll.startswith(s + ":") or ll.startswith(s + " ") for s in low_stops):
                return i
        return len(lines)


    zone_code_simple = ""
    zc_idx = _find_idx("Zone Code:")
    if zc_idx != -1 and zc_idx + 1 < len(lines):
        cand = lines[zc_idx + 1]
        if cand.lower() not in ("open in google maps", "n/a", "basic rates"):
            zone_code_simple = cand

    basic_rates_lines: list[str] = []
    sparc_note = ""
    ev_note = ""
    event_rate_note = ""

    br_idx = _find_idx("Basic Rates")
    if br_idx != -1:
        end_br = _next_boundary(br_idx + 1, ("About this Lot", "Detailed Rates", "Also in this Section"))
        chunk = lines[br_idx + 1 : end_br]
        skip_next_event = False
        for ln in chunk:
            ll = ln.lower()
            if skip_next_event:
                skip_next_event = False
                if ln not in ("-", "N/A"):
                    event_rate_note = ln
                continue
            if "stalls for people with disabilities" in ll or "sparc decals" in ll:
                sparc_note = (sparc_note + " " + ln).strip()
            elif "ev charging stations available" in ll or ("ev charging" in ll and "payment for parking" in ll):
                ev_note = (ev_note + " " + ln).strip()
            elif ll == "event rate":
                skip_next_event = True
            elif ll.startswith("event rate"):
                rest = ln[len("event rate") :].strip(" :-")
                if rest and rest != "-":
                    event_rate_note = rest
            elif not sparc_note and not ev_note:
                basic_rates_lines.append(ln)

    about_notes: list[str] = []
    capacity: int | None = None
    height_restriction = ""
    hours_summary = ""
    ab_idx = _find_idx("About this Lot")
    if ab_idx != -1:
        end_ab = _next_boundary(ab_idx + 1, ("Detailed Rates", "Also in this Section"))
        ab_chunk = lines[ab_idx + 1 : end_ab]
        # Skip inline Zone Number table rows already captured, or capture standalone Zone Number
        skip_tokens = {"zone number", "zipby", "honk", "parkmobile", "passport"}
        if not pay_zones:
            zn_idx = _find_idx("Zone Number", ab_idx + 1)
            if zn_idx != -1 and zn_idx + 1 < end_ab:
                zcand = lines[zn_idx + 1].strip()
                if zcand.isdigit() and len(zcand) >= 3:
                    pay_zones.append({"provider": "Zone Number", "code": zcand})
        pay_zone_codes = {z["code"] for z in pay_zones}
        for ln in ab_chunk:
            ll = ln.lower()
            if ll in skip_tokens or ln in pay_zone_codes:
                continue
            if ll.startswith(("see the", "view a pdf", "here")):
                continue
            if capacity is None:
                m_cap = re.search(r"(\d[\d,]*)\s+(?:parking\s+)?(?:stalls|spaces)\b", ln, re.I)
                if m_cap:
                    capacity = int(m_cap.group(1).replace(",", ""))
            if not height_restriction and "height restriction" in ll:
                height_restriction = ln
            if not hours_summary and any(
                k in ll for k in ("gated from", "24/7", "24 hours", "monday to", "mon-sun", "6am", "park is open")
            ):
                hours_summary = ln
            about_notes.append(ln)

    daily_rates: list[str] = []
    dr_tab = _find_idx("Detailed Rates")
    if dr_tab != -1:
        # Second occurrence marks actual tab content sections
        sec_start = dr_tab + 1
        d_heading = _find_idx("Daily Rates", sec_start)
        if d_heading != -1:
            # Skip tab header item if repeated right after
            next_d = _find_idx("Daily Rates", d_heading + 1)
            if next_d != -1 and next_d - d_heading <= 4:
                d_heading = next_d
        m_heading = _find_idx("Monthly Rates", d_heading if d_heading != -1 else sec_start)
        s_heading = _find_idx("Seasonal Rates", m_heading if m_heading != -1 else sec_start)
        end_all = _next_boundary(sec_start, ("Also in this Section", "Reserve Your Parking"))

        if d_heading != -1:
            d_end = min(x for x in (m_heading, s_heading, end_all) if x != -1 and x > d_heading)
            for ln in lines[d_heading + 1 : d_end]:
                ll = ln.lower()
                if ll in ("daily rates", "monthly rates", "seasonal rates"):
                    continue
                if "visa, mastercard" in ll or "pay by apps" in ll or "include gst" in ll or "cash payments" in ll:
                    continue
                daily_rates.append(ln)

    basic_summary = " ".join(basic_rates_lines).strip()
    if zone_code_simple and not pay_zones:
        pay_zones.append({"provider": "Zone", "code": zone_code_simple})

    return {
        "pay_zones": pay_zones,
        "basic_rates_summary": basic_summary,
        "daily_rates": daily_rates[:10],
        "monthly_rates": monthly_rates,
        "seasonal_rates": seasonal_rates,
        "annual_rates": annual_rates,
        "capacity": capacity,
        "height_restriction": height_restriction,
        "hours": hours_summary,
        "about_notes": about_notes[:8],
        "sparc_note": sparc_note,
        "ev_note": ev_note,
        "event_rate": event_rate_note,
    }


def _fetch_easypark_single(marker: dict[str, str]) -> dict[str, Any] | None:
    city = _clean_text(marker.get("city", ""))
    if city.lower() not in METRO_VANCOUVER_CITIES:
        return None
    try:
        lat = float(marker.get("lat") or 0)
        lng = float(marker.get("lng") or 0)
    except ValueError:
        return None
    if lat == 0 or lng == 0:
        return None

    lot_num_raw = _clean_text(marker.get("LotNumber", ""))
    locurl = _clean_text(marker.get("locurl", ""))
    lot_url = f"{EASYPARK_DETAIL_BASE}/{locurl}" if locurl else EASYPARK_FIND_URL
    title = _clean_text(marker.get("title", ""))
    street = _clean_text(marker.get("street", ""))
    reservation_url = _clean_text(marker.get("ReservationURL", ""))
    xml_feats = [
        _clean_text(x)
        for x in (marker.get("features") or "").split(",")
        if _clean_text(x)
    ]

    detail: dict[str, Any] = {}
    if locurl:
        try:
            resp = requests.get(lot_url, headers=REQUEST_HEADERS, timeout=20)
            if resp.status_code == 200:
                detail = _parse_easypark_detail_html(resp.text)
        except Exception:
            detail = {}

    feat_lower = {f.lower() for f in xml_feats}
    basic_summary = detail.get("basic_rates_summary") or ""
    daily_rates = detail.get("daily_rates") or []
    monthly_rates = detail.get("monthly_rates") or []
    seasonal_rates = detail.get("seasonal_rates") or []
    annual_rates = detail.get("annual_rates") or []

    has_transient = ("daily" in feat_lower) or (
        bool(basic_summary) and "customer parking only" not in basic_summary.lower() and "$" in basic_summary
    )
    has_monthly = ("monthly" in feat_lower) or bool(monthly_rates)
    has_seasonal = ("seasonal" in feat_lower) or bool(seasonal_rates)
    has_annual = ("annual" in feat_lower) or bool(annual_rates)
    has_sparc = ("sparc" in feat_lower) or bool(detail.get("sparc_note"))
    has_ev = any("ev" in x for x in feat_lower) or bool(detail.get("ev_note"))

    merged_features = list(xml_feats)
    if has_ev and not any("ev" in f.lower() for f in merged_features):
        merged_features.append("EV Charging")
    if has_sparc and not any("sparc" in f.lower() for f in merged_features):
        merged_features.append("SPARC")

    lowest_transient = None
    if basic_summary:
        lowest_transient = {
            "label": "臨停 / 日租費率" if has_transient else "場地說明",
            "value": basic_summary,
        }
    elif daily_rates:
        lowest_transient = {"label": "臨停 / 日租費率", "value": daily_rates[0]}

    lowest_monthly = monthly_rates[0] if monthly_rates else None
    try:
        lot_num: Any = int(lot_num_raw) if lot_num_raw.isdigit() else lot_num_raw
    except Exception:
        lot_num = lot_num_raw

    slug_key = re.sub(r"[^a-z0-9]+", "_", (locurl or lot_num_raw or title).lower()).strip("_")
    fid = f"easypark_{lot_num_raw or slug_key}"

    return {
        "type": "Feature",
        "id": fid,
        "geometry": {
            "type": "Point",
            "coordinates": [round(lng, 6), round(lat, 6)],
        },
        "properties": {
            "id": fid,
            "facility_type": "impark",
            "company": "easypark",
            "operator": "EasyPark",
            "lot_id": fid,
            "lot_number": lot_num,
            "lot_name": title or (f"EasyPark Lot {lot_num}" if lot_num else street),
            "address1": street,
            "address2": "",
            "city": city or "Vancouver",
            "postal_code": "",
            "hasTransientRates": has_transient,
            "lowestTransientRate": lowest_transient,
            "hasMonthlyRates": has_monthly,
            "lowestMonthlyRate": lowest_monthly,
            "hasSeasonalRates": has_seasonal,
            "hasAnnualRates": has_annual,
            "hasSparc": has_sparc,
            "hasEvCharger": has_ev,
            "daily_rates": daily_rates,
            "monthly_rates": monthly_rates,
            "seasonal_rates": seasonal_rates,
            "annual_rates": annual_rates,
            "pay_zones": detail.get("pay_zones") or [],
            "hours": detail.get("hours") or "",
            "height_restriction": detail.get("height_restriction") or "",
            "about_notes": detail.get("about_notes") or [],
            "sparc_note": detail.get("sparc_note") or "",
            "ev_note": detail.get("ev_note") or "",
            "event_rate": detail.get("event_rate") or "",
            "capacity": detail.get("capacity"),
            "features": merged_features,
            "rates": [],
            "street_view_url": "",
            "directions_url": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}",
            "lot_url": lot_url,
            "reservation_url": reservation_url,
        },
    }


def _fetch_easypark_lots(find_url: str = EASYPARK_FIND_URL) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    try:
        resp = requests.get(find_url, headers=REQUEST_HEADERS, timeout=25)
        if resp.status_code != 200:
            print(f"⚠️ EasyPark Find Parking HTTP {resp.status_code}")
            return features
        markers_raw = re.findall(r"<marker\s+([^>]+?)/?>", resp.text)
        markers = [dict(re.findall(r'([A-Za-z0-9_]+)="([^"]*)"', raw)) for raw in markers_raw]
        metro_markers = [
            mk for mk in markers if _clean_text(mk.get("city", "")).lower() in METRO_VANCOUVER_CITIES
        ]
        print(f"ℹ️ EasyPark 探索頁面共發現 {len(markers)} 筆據點，大溫哥華區共 {len(metro_markers)} 筆，正在並行擷取詳情...")
        with ThreadPoolExecutor(max_workers=12) as pool:
            futs = [pool.submit(_fetch_easypark_single, mk) for mk in metro_markers]
            for fut in as_completed(futs):
                feat = fut.result()
                if feat:
                    features.append(feat)
        features.sort(key=lambda f: str((f.get("properties") or {}).get("lot_number") or ""))
    except Exception as e:
        print(f"⚠️ 線上更新 EasyPark 停車場失敗: {e}")
    return features


def update_private_parking():
    print("🅿️ 正在更新大溫私人停車場情報 (ImPark + EasyPark)...")
    impark_url = get_source_endpoint_url("impark_parking", IMPARK_DEFAULT_URL)
    impark_features = _fetch_impark_lots(impark_url)
    easypark_features = _fetch_easypark_lots(EASYPARK_FIND_URL)

    if not impark_features or not easypark_features:
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

    combined = impark_features + easypark_features
    if combined:
        save_layer_geojson("vancouver_impark.geojson", combined)
        print(
            f"✅ 私人停車場更新完成：ImPark {len(impark_features)} 處 + "
            f"EasyPark {len(easypark_features)} 處，共 {len(combined)} 處場站。"
        )
    return combined


if __name__ == "__main__":
    update_private_parking()
