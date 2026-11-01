#!/usr/bin/env python3
"""
Automated updater for Vancouver Banks (銀行) dataset.
Scrapes bank listings and branch detail metadata from bankee.ca/bc/vancouver/atm/
and saves directly to backend/data/vancouver_banks.geojson and frontend/public/vancouver_banks.geojson.
"""

import os
import sys
import json
import time
import re
from datetime import datetime, timezone, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from base import BACKEND_DATA_DIR, FRONTEND_DATA_DIR

try:
    import requests
except ImportError:
    print("requests not installed. Please run: pip install requests")
    sys.exit(1)

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

BANK_FULL_NAMES = {
    'bmo': 'Bank of Montreal',
    'cibc': 'Canadian Imperial Bank of Commerce (CIBC)',
    'rbc': 'Royal Bank of Canada (RBC)',
    'scotiabank': 'Scotiabank',
    'td': 'TD Canada Trust',
    'vancity': 'Vancity Credit Union',
    'hsbc': 'HSBC Bank Canada',
    'national-bank': 'National Bank of Canada',
    'laurentian': 'Laurentian Bank',
    'cw-bank': 'Canadian Western Bank',
    'tangerine': 'Tangerine Bank',
    'manulife': 'Manulife Bank',
    'coast-capital': 'Coast Capital Savings',
    'beem': 'Beem Credit Union'
}

BANK_URLS = {
    'bmo': 'https://www.bmo.com',
    'cibc': 'https://www.cibc.com',
    'rbc': 'https://www.rbcroyalbank.com',
    'scotiabank': 'https://www.scotiabank.com',
    'td': 'https://www.td.com',
    'vancity': 'https://www.vancity.com',
    'hsbc': 'https://www.hsbc.ca',
    'national-bank': 'https://www.nbc.ca',
    'tangerine': 'https://www.tangerine.ca',
    'manulife': 'https://www.manulifebank.ca',
    'coast-capital': 'https://www.coastcapitalsavings.com',
    'beem': 'https://beemcreditunion.ca'
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
}


def fetch_page(url, retries=3):
    last_status = None
    for i in range(retries):
        if cffi_requests is not None:
            try:
                resp = cffi_requests.get(url, impersonate="chrome", headers=HEADERS, timeout=15)
                last_status = resp.status_code
                if resp.status_code == 200 and resp.text:
                    return resp.text
                if resp.status_code == 429:
                    time.sleep(3 + i * 2)
                    continue
            except Exception:
                pass

        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            last_status = resp.status_code
            if resp.status_code == 200 and resp.text:
                return resp.text
            if resp.status_code == 429:
                time.sleep(3 + i * 2)
            elif resp.status_code in (403, 503):
                # Avoid hammering if Cloudflare blocks plain requests without curl_cffi
                if cffi_requests is None and i >= 1:
                    break
                time.sleep(1.5)
        except Exception:
            time.sleep(1.5)

    if last_status and last_status != 200:
        print(f"  ⚠️ 無法讀取 {url} (HTTP {last_status})")
    return None


def get_vancouver_now():
    if ZoneInfo is not None:
        try:
            return datetime.now(ZoneInfo("America/Vancouver"))
        except Exception:
            pass
    return datetime.now(timezone(timedelta(hours=-7)))


def is_branch_open(opening_hours):
    """
    Check if branch is currently open based on opening_hours in America/Vancouver local time.
    """
    if not opening_hours or not isinstance(opening_hours, dict):
        return False

    van_now = get_vancouver_now()
    python_to_name = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    day_name = python_to_name[van_now.weekday()]

    today_str = opening_hours.get(day_name, '')
    if not today_str or 'closed' in today_str.lower() or '休息' in today_str:
        return False

    m = re.search(r'(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})', today_str)
    if m:
        start_min = int(m.group(1)) * 60 + int(m.group(2))
        end_min = int(m.group(3)) * 60 + int(m.group(4))
        cur_min = van_now.hour * 60 + van_now.minute
        return start_min <= cur_min < end_min

    return False


def normalize_bankee_url(raw_href):
    if not raw_href:
        return ""
    u = raw_href.strip()
    if u.startswith("/"):
        u = "https://bankee.ca" + u
    u = re.sub(r'^https?://(?:www\.)?bankee\.ca', 'https://bankee.ca', u, flags=re.I)
    if not u.endswith("/"):
        u += "/"
    return u


def update_banks():
    os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

    out_file = os.path.join(BACKEND_DATA_DIR, "vancouver_banks.geojson")
    public_file = os.path.join(FRONTEND_DATA_DIR, "vancouver_banks.geojson")

    existing_features = []
    existing_urls = set()

    candidate_files = [
        out_file,
        public_file,
        os.path.join(BACKEND_DATA_DIR, "vancouver_atm.geojson"),
        os.path.join(FRONTEND_DATA_DIR, "vancouver_atm.geojson")
    ]

    for candidate_path in candidate_files:
        if os.path.exists(candidate_path):
            try:
                with open(candidate_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    loaded = data.get('features', [])
                    if loaded:
                        existing_features = loaded
                        for feat in existing_features:
                            props = feat.get('properties', {})
                            props['facility_type'] = 'banks'
                            if 'is_24_7' in props:
                                del props['is_24_7']
                            hours = props.get('opening_hours')
                            if isinstance(hours, dict) and hours:
                                props['status_text'] = "營業中" if is_branch_open(hours) else "休息中"
                            u = props.get('bankee_url')
                            if u:
                                existing_urls.add(normalize_bankee_url(u))
                        break
            except Exception as e:
                print(f"Notice: could not load existing file {candidate_path}: {e}")

    print(f"Loaded {len(existing_features)} existing bank branches.")

    # 1. Discover list items across pages
    all_urls = []
    seen = set()
    consecutive_failures = 0

    for p in range(1, 16):
        url = "https://bankee.ca/bc/vancouver/atm/" if p == 1 else f"https://bankee.ca/bc/vancouver/atm/?page={p}"
        html = fetch_page(url)
        if not html:
            consecutive_failures += 1
            if consecutive_failures >= 2:
                print("ℹ️ 遠端清單頁面連線受限或已達末頁，停止繼續翻頁。")
                break
            continue

        consecutive_failures = 0
        # Match both absolute and relative branch/atm links on bankee.ca
        matches = re.findall(
            r'href=["\']((?:https?://(?:www\.)?bankee\.ca)?/bc/vancouver/[^"\'\s/]+/(?:branch|atm)-[^"\'\s/]+/?)["\']',
            html,
            re.I
        )
        if not matches:
            break

        new_on_page = 0
        for raw_link in matches:
            norm_link = normalize_bankee_url(raw_link)
            if norm_link and norm_link not in seen:
                seen.add(norm_link)
                all_urls.append(norm_link)
                new_on_page += 1

        if new_on_page == 0:
            break
        time.sleep(0.15)

    print(f"Discovered {len(all_urls)} total Bank URLs.")
    missing_urls = [u for u in all_urls if u not in existing_urls]
    print(f"Fetching details for {len(missing_urls)} new branches...")

    features = list(existing_features)
    for u in missing_urls:
        try:
            html = fetch_page(u)
            if not html:
                continue

            # Lat/lon
            m_lat = re.search(r'data-lat="([0-9.-]+)"', html)
            m_lng = re.search(r'data-lng="([0-9.-]+)"', html)
            lat = float(m_lat.group(1)) if m_lat else None
            lon = float(m_lng.group(1)) if m_lng else None

            if lat is None or lon is None:
                m_geo = re.search(r'latitude":([0-9.-]+),"longitude":([0-9.-]+)', html)
                if m_geo:
                    lat = float(m_geo.group(1))
                    lon = float(m_geo.group(2))

            if lat is None or lon is None:
                continue

            bank_m = re.search(r'/bc/vancouver/([^/]+)/', u)
            bank_code = bank_m.group(1).lower() if bank_m else 'bank'
            bank_full_name = BANK_FULL_NAMES.get(bank_code, bank_code.upper())
            official_url = BANK_URLS.get(bank_code, 'https://www.google.com')

            h1_m = re.search(r'<h1[^>]*class="[^"]*rd-hero__title[^"]*"[^>]*>([^<]+)</h1>', html, re.I)
            raw_name = h1_m.group(1).strip() if h1_m else bank_full_name
            name_parts = re.split(r'[—–-]', raw_name)
            branch_name = '—'.join(name_parts[1:]).strip() if len(name_parts) > 1 else raw_name

            street_m = re.search(r'Address:\s*([^.<]+)[.<]', html, re.I)
            street_address = street_m.group(1).strip() if street_m else ""
            postal_m = re.search(r'postal code\s+([A-Z0-9\s]{6,7})', html, re.I)
            postal_code = postal_m.group(1).strip() if postal_m else ""
            phone_m = re.search(r'tel:([+0-9-]+)', html)
            telephone = phone_m.group(1).strip() if phone_m else None

            services = []
            attrs_m = re.search(r'<div class="rd-hero__city rd-hero__attrs">([\s\S]*?)</div>', html, re.I)
            if attrs_m:
                span_items = re.findall(r'<span>(?:<svg[^>]*>[\s\S]*?</svg>)?([^<]+)</span>', attrs_m.group(1))
                for si in span_items:
                    t = si.strip()
                    if t and t not in services:
                        services.append(t)

            def extract_row(label):
                m = re.search(rf'<span>{label}[^<]*</span>\s*<span><b>([^<]+)</b></span>', html, re.I)
                return m.group(1).strip() if m else None

            transit_number = extract_row('Transit number')
            institution_number = extract_row('Institution number')
            routing_number = extract_row('Routing number')
            cheque_micr = extract_row('Cheque')
            swift_code = extract_row('SWIFT')

            # Extract hours table
            opening_hours = {}
            for day_en in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
                m_day = re.search(rf'{day_en}[^<]*</td>\s*<td[^>]*>([^<]+)</td>', html, re.I)
                if m_day:
                    h_val = m_day.group(1).strip()
                    if 'closed' not in h_val.lower() and h_val != '-':
                        opening_hours[day_en] = h_val

            if not opening_hours:
                opening_hours = {d: "00:00 - 23:59" for d in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']}

            is_open = is_branch_open(opening_hours)
            status_text = "營業中" if is_open else "休息中"

            clean_title = f"{bank_full_name} — {branch_name}".strip() if branch_name and branch_name != bank_full_name else raw_name

            feat = {
                "type": "Feature",
                "id": f"bank_{len(features) + 1}",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 6), round(lat, 6)]
                },
                "properties": {
                    "id": f"bank_{len(features) + 1}",
                    "facility_type": "banks",
                    "name": clean_title,
                    "bank_code": bank_code,
                    "bank_full_name": bank_full_name,
                    "branch_name": branch_name,
                    "address": street_address,
                    "postal_code": postal_code,
                    "local_area": "Vancouver",
                    "telephone": telephone,
                    "services": services,
                    "services_str": ", ".join(services),
                    "opening_hours": opening_hours,
                    "status_text": status_text,
                    "transit_number": transit_number,
                    "institution_number": institution_number,
                    "routing_number": routing_number,
                    "cheque_micr": cheque_micr,
                    "swift_code": swift_code,
                    "official_url": official_url,
                    "bankee_url": u
                }
            }
            features.append(feat)
            time.sleep(0.12)
        except Exception as ex:
            print(f"Error on {u}: {ex}")

    if not features:
        print("❌ 未能載入或擷取任何銀行分行資料，中止寫入以保護既有資料集。")
        sys.exit(1)

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    geojson_data = {
        "type": "FeatureCollection",
        "metadata": {
            "generated_at": now_iso,
            "source": "https://bankee.ca/bc/vancouver/atm/",
            "count": len(features)
        },
        "total_count": len(features),
        "updated_at": now_iso,
        "features": features
    }

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved {len(features)} bank branches to {out_file}")

    with open(public_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved copy to {public_file}")
    return geojson_data


# Backward-compatible aliases
update_atm = update_banks
update_atm_dataset = update_banks


if __name__ == '__main__':
    update_banks()
