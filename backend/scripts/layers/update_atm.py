#!/usr/bin/env python3
"""
Automated updater for Vancouver Banks (銀行) dataset.
Scrapes bank listings and branch detail metadata from bankee.ca/bc/vancouver/atm/
and saves directly to backend/data/vancouver_atm.geojson and frontend/public/vancouver_atm.geojson.
"""

import os
import sys
import json
import time
import re
from datetime import datetime

try:
    import requests
except ImportError:
    print("requests not installed. Please run: pip install requests")
    sys.exit(1)

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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}

def fetch_page(url, retries=5):
    for i in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code == 429:
                time.sleep(3 + i * 2)
        except Exception:
            time.sleep(1.5)
    return None

def is_branch_open(opening_hours):
    """
    Check if branch is currently open based on opening_hours.
    """
    if not opening_hours or not isinstance(opening_hours, dict):
        return False
    # Days of week in lowercase
    days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    now_utc = datetime.utcnow()
    # Approx Vancouver offset UTC-7 (PDT) / UTC-8 (PST)
    # Using simple hour adjustment for Vancouver: UTC - 7
    van_hour = (now_utc.hour - 7) % 24
    van_dow_idx = now_utc.weekday() # Monday=0, Sunday=6
    # Python weekday(): Monday is 0 and Sunday is 6
    python_to_name = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    # If UTC-7 crossed midnight backwards
    day_name = python_to_name[van_dow_idx]
    if now_utc.hour < 7:
        day_name = python_to_name[(van_dow_idx - 1) % 7]

    today_str = opening_hours.get(day_name, '')
    if not today_str or 'closed' in today_str.lower() or '休息' in today_str:
        return False

    m = re.search(r'(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})', today_str)
    if m:
        start_min = int(m.group(1)) * 60 + int(m.group(2))
        end_min = int(m.group(3)) * 60 + int(m.group(4))
        cur_min = van_hour * 60 + now_utc.minute
        return start_min <= cur_min < end_min

    return False

def update_atm_dataset():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    backend_data_dir = os.path.join(os.path.dirname(script_dir), "data")
    repo_root = os.path.dirname(os.path.dirname(script_dir))
    public_data_dir = os.path.join(repo_root, "frontend", "public")

    out_file = os.path.join(backend_data_dir, "vancouver_atm.geojson")
    public_file = os.path.join(public_data_dir, "vancouver_atm.geojson")

    existing_features = []
    existing_urls = set()
    if os.path.exists(out_file):
        try:
            with open(out_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                existing_features = data.get('features', [])
                for feat in existing_features:
                    # Clean any legacy is_24_7
                    if 'is_24_7' in feat.get('properties', {}):
                        del feat['properties']['is_24_7']
                    u = feat.get('properties', {}).get('bankee_url')
                    if u:
                        existing_urls.add(u)
        except Exception as e:
            print("Notice: could not load existing file:", e)

    print(f"Loaded {len(existing_features)} existing bank branches.")

    # 1. Discover list items across 13 pages
    all_urls = []
    seen = set()
    for p in range(1, 14):
        url = "https://bankee.ca/bc/vancouver/atm/" if p == 1 else f"https://bankee.ca/bc/vancouver/atm/?page={p}"
        html = fetch_page(url)
        if not html:
            continue
        links = re.findall(r'href="(https://bankee\.ca/bc/vancouver/[^"/]+/(?:branch|atm)-[^"]+/)"', html)
        for link in links:
            if link not in seen:
                seen.add(link)
                all_urls.append(link)
        time.sleep(0.15)

    print(f"Discovered {len(all_urls)} total Bank URLs.")
    missing_urls = [u for u in all_urls if u not in existing_urls]
    print(f"Fetching details for {len(missing_urls)} new branches...")

    features = list(existing_features)
    for idx, u in enumerate(missing_urls):
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

            street_m = re.search(r'Address:\s*([^.]+)\.', html, re.I)
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
                "id": f"atm_{len(features) + 1}",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 6), round(lat, 6)]
                },
                "properties": {
                    "id": f"atm_{len(features) + 1}",
                    "facility_type": "atm",
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

    geojson_data = {
        "type": "FeatureCollection",
        "metadata": {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "source": "https://bankee.ca/bc/vancouver/atm/",
            "count": len(features)
        },
        "features": features
    }

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(features)} bank branches to {out_file}")

    if os.path.exists(public_data_dir):
        with open(public_file, 'w', encoding='utf-8') as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
        print(f"Saved copy to {public_file}")

if __name__ == '__main__':
    update_atm_dataset()
