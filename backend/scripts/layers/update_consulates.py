#!/usr/bin/env python3
"""
Automated updater for Foreign Consulates in BC (領事館) dataset.
Scrapes the official Consular Corps of B.C. Directory (gov.bc.ca),
geocodes consular mailing addresses via BC Address Geocoder (geocoder.api.gov.bc.ca),
and saves to backend/data/vancouver_consulates.geojson and frontend/public/vancouver_consulates.geojson.
"""

import os
import sys
import re
import time
import hashlib
import requests
from bs4 import BeautifulSoup

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from base import (
    HEADERS,
    save_layer_geojson,
    load_existing_geojson,
    get_source_endpoint_url,
    update_admin_source_metadata,
)

DEFAULT_DIRECTORY_URL = (
    "https://www2.gov.bc.ca/gov/content/governments/organizational-structure/"
    "office-of-the-premier/intergovernmental-relations-secretariat/protocol/"
    "consular-corps/directory"
)
GEOBC_URL = "https://geocoder.api.gov.bc.ca/addresses.json"

COUNTRY_ZH_MAP = {
    "afghanistan": "阿富汗",
    "albania": "阿爾巴尼亞",
    "antigua and barbuda": "安地卡及巴布達",
    "argentina": "阿根廷",
    "australia": "澳洲 澳大利亞",
    "austria": "奧地利",
    "bahamas": "巴哈馬",
    "bangladesh": "孟加拉",
    "barbados": "巴貝多",
    "belgium": "比利時",
    "belize": "貝里斯",
    "bolivia": "玻利維亞",
    "bosnia and herzegovina": "波士尼亞與赫塞哥維納 波斯尼亞",
    "brazil": "巴西",
    "bulgaria": "保加利亞",
    "burkina faso": "布吉納法索",
    "cambodia": "柬埔寨",
    "cape verde": "維德角",
    "chile": "智利",
    "china": "中國 中華人民共和國",
    "colombia": "哥倫比亞",
    "costa rica": "哥斯大黎加",
    "cote d'ivoire": "象牙海岸 科特迪瓦",
    "côte d'ivoire": "象牙海岸 科特迪瓦",
    "croatia": "克羅埃西亞",
    "cyprus": "賽普勒斯",
    "czech republic": "捷克",
    "czechia": "捷克",
    "denmark": "丹麥",
    "dominica": "多米尼克",
    "ecuador": "厄瓜多",
    "el salvador": "薩爾瓦多",
    "estonia": "愛沙尼亞",
    "ethiopia": "衣索比亞",
    "fiji": "斐濟",
    "finland": "芬蘭",
    "france": "法國 法蘭西",
    "germany": "德國",
    "ghana": "迦納",
    "greece": "希臘",
    "guatemala": "瓜地馬拉",
    "guinea": "幾內亞",
    "guyana": "蓋亞那",
    "honduras": "宏都拉斯",
    "hungary": "匈牙利",
    "iceland": "冰島",
    "india": "印度",
    "indonesia": "印尼 印度尼西亞",
    "ireland": "愛爾蘭",
    "israel": "以色列",
    "italy": "義大利",
    "jamaica": "牙買加",
    "jordan": "約旦",
    "japan": "日本",
    "kazakhstan": "哈薩克",
    "kenya": "肯亞",
    "korea (south)": "南韓 韓國 大韓民國",
    "korea (republic of)": "南韓 韓國 大韓民國",
    "korea": "南韓 韓國",
    "laos": "寮國 老撾",
    "latvia": "拉脫維亞",
    "lebanon": "黎巴嫩",
    "liberia": "賴比瑞亞",
    "lithuania": "立陶宛",
    "luxembourg": "盧森堡",
    "malaysia": "馬來西亞",
    "mali": "馬利",
    "malta": "馬爾他",
    "mauritius": "模里西斯",
    "mexico": "墨西哥",
    "monaco": "摩納哥",
    "mongolia": "蒙古",
    "montenegro": "蒙特內哥羅 黑山",
    "morocco": "摩洛哥",
    "myanmar": "緬甸",
    "nepal": "尼泊爾",
    "netherlands": "荷蘭",
    "new zealand": "紐西蘭 新西蘭",
    "nigeria": "奈及利亞",
    "north macedonia": "北馬其頓",
    "norway": "挪威",
    "pakistan": "巴基斯坦",
    "panama": "巴拿馬",
    "paraguay": "巴拉圭",
    "peru": "秘魯",
    "philippines": "菲律賓",
    "poland": "波蘭",
    "portugal": "葡萄牙",
    "romania": "羅馬尼亞",
    "russian federation": "俄羅斯 俄國",
    "russia": "俄羅斯 俄國",
    "rwanda": "盧安達",
    "senegal": "塞內加爾",
    "serbia": "塞爾維亞",
    "seychelles": "塞席爾",
    "sierra leone": "獅子山",
    "singapore": "新加坡",
    "slovak republic": "斯洛伐克",
    "slovakia": "斯洛伐克",
    "slovenia": "斯洛維尼亞",
    "solomon islands": "所羅門群島",
    "south africa": "南非",
    "spain": "西班牙",
    "sri lanka": "斯里蘭卡",
    "st. vincent and the grenadines": "聖文森及格瑞那丁",
    "saint vincent and the grenadines": "聖文森及格瑞那丁",
    "sweden": "瑞典",
    "switzerland": "瑞士",
    "taiwan": "台灣 臺灣 中華民國",
    "thailand": "泰國",
    "togo": "多哥",
    "trinidad and tobago": "千里達及托巴哥",
    "tunisia": "突尼西亞",
    "turkey": "土耳其",
    "türkiye": "土耳其",
    "uganda": "烏干達",
    "ukraine": "烏克蘭",
    "united kingdom": "英國 聯合王國",
    "united states": "美國",
    "united states of america": "美國",
    "uruguay": "烏拉圭",
    "venezuela": "委內瑞拉",
    "vietnam": "越南",
}

STREET_LINE_RE = re.compile(
    r"^(?:"
    r"\d+"
    r"|(?:Suite|Ste\.?|Unit|Apt\.?|Room|Rm\.?|Floor|Fl\.?|Level|Lvl\.?)\b"
    r"|(?:P\.?\s*O\.?\s*)?Box\b"
    r"|#\s*\d+"
    r")",
    re.IGNORECASE,
)

POSTAL_RE = re.compile(r"\b([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)\b")


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return cleaned[:48] or "consulate"


def get_country_zh(country: str) -> str:
    low = normalize_space(country).lower()
    if low in COUNTRY_ZH_MAP:
        return COUNTRY_ZH_MAP[low]
    for k, v in COUNTRY_ZH_MAP.items():
        if k in low:
            return v
    return ""


def split_mailing_address(raw_addr: str, country: str, rank: str) -> tuple[str, str, str]:
    """
    Splits multi-line Mailing Address into:
    (office_name, formatted_address, city)
    """
    lines = [normalize_space(ln) for ln in (raw_addr or "").splitlines() if normalize_space(ln)]
    if not lines:
        return "", "", ""

    if len(lines) >= 2 and not STREET_LINE_RE.match(lines[0]):
        office_name = lines[0]
        addr_lines = lines[1:]
    else:
        rank_l = (rank or "").lower()
        if "honorary" in rank_l:
            office_name = f"Honorary Consulate of {country}"
        elif "consul general" in rank_l:
            office_name = f"Consulate General of {country}"
        else:
            office_name = f"Consulate of {country}"
        addr_lines = lines

    while len(addr_lines) > 1 and addr_lines[-1].lower() in ("canada", "b.c.", "bc"):
        addr_lines.pop()

    formatted_address = ", ".join(addr_lines)
    formatted_address = re.sub(r"\s*,\s*,+", ", ", formatted_address).strip(", ")

    # Fix missing comma before BC (e.g. "Vancouver BC, V6E 4M3" -> "Vancouver, BC V6E 4M3")
    formatted_address = re.sub(
        r"\b([A-Za-z .'-]+)\s+BC,\s*([A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d)",
        r"\1, BC \2",
        formatted_address,
    )

    city = "Vancouver"
    m_city = re.search(r"([A-Za-z][A-Za-z .'-]+?)[,]?\s+(?:BC|B\.C\.)\b", formatted_address)
    if m_city:
        candidate = normalize_space(m_city.group(1)).split(",")[-1].strip()
        if candidate:
            city = candidate

    return office_name, formatted_address, city


def build_geocode_candidates(addr: str) -> list[str]:
    """Generate progressively cleaner address strings for GeoBC geocoder."""
    candidates: list[str] = []

    def add_cand(s: str):
        s = normalize_space(s).strip(", ")
        if s and s not in candidates:
            candidates.append(s)

    base = re.sub(r"[\u2013\u2014]", "-", addr)
    add_cand(base)

    # Fix malformed partial duplicate postal code (e.g. "V7X V6E 3Z3" -> "V6E 3Z3")
    fixed_postal = re.sub(r"\b[A-Za-z]\d[A-Za-z]\s+([A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d)\b", r"\1", base)
    add_cand(fixed_postal)

    no_pobox = re.sub(r"(?:P\.?\s*O\.?\s*)?Box\s+[A-Za-z0-9-]+,?\s*", "", fixed_postal, flags=re.IGNORECASE)
    add_cand(no_pobox)

    stripped = re.sub(
        r"^(?:(?:Suite|Ste\.?|Unit|Apt\.?|Floor|Fl\.?|Room|Rm\.?|Office)\s*[A-Za-z0-9-]+\s*[-,]?\s*|#\s*[A-Za-z0-9-]+\s*[-,]?\s*|[A-Za-z0-9-]{1,6}\s*[-/]\s*(?=\d))",
        "",
        no_pobox,
        flags=re.IGNORECASE,
    )
    add_cand(stripped)

    stripped_mid = re.sub(
        r",?\s*(?:Suite|Ste\.?|Unit|Apt\.?|Floor|Fl\.?)\s*[A-Za-z0-9-]+",
        "",
        stripped,
        flags=re.IGNORECASE,
    )
    add_cand(stripped_mid)

    no_postal = re.sub(r"\b(?:[A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d|[A-Za-z]\d[A-Za-z])\b", "", stripped_mid).strip(", ")
    add_cand(no_postal)

    return candidates


def geocode_address(addr: str, cache: dict[str, tuple[float, float]]) -> tuple[float | None, float | None, int]:
    key = normalize_space(addr).lower()
    if key in cache:
        return cache[key][0], cache[key][1], 100

    for cand in build_geocode_candidates(addr):
        try:
            resp = requests.get(
                GEOBC_URL,
                params={"addressString": cand, "maxResults": 1, "minScore": 50},
                headers=HEADERS,
                timeout=12,
            )
            if resp.status_code == 200:
                feats = resp.json().get("features") or []
                if feats:
                    coords = feats[0].get("geometry", {}).get("coordinates", [])
                    score = int(feats[0].get("properties", {}).get("score") or 0)
                    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
                        lon, lat = round(float(coords[0]), 6), round(float(coords[1]), 6)
                        if -139.5 <= lon <= -114.0 and 48.0 <= lat <= 60.0:
                            cache[key] = (lon, lat)
                            return lon, lat, score
        except Exception as exc:
            print(f"  ⚠️ GeoBC 查詢錯誤 [{cand}]: {exc}")
        time.sleep(0.05)

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": f"{addr}, Canada", "format": "json", "limit": 1, "countrycodes": "ca"},
            headers={"User-Agent": HEADERS["User-Agent"]},
            timeout=12,
        )
        if resp.status_code == 200:
            rows = resp.json() or []
            if rows:
                lon = round(float(rows[0]["lon"]), 6)
                lat = round(float(rows[0]["lat"]), 6)
                if -139.5 <= lon <= -114.0 and 48.0 <= lat <= 60.0:
                    cache[key] = (lon, lat)
                    return lon, lat, 65
        time.sleep(1.0)
    except Exception as exc:
        print(f"  ⚠️ Nominatim 查詢錯誤 [{addr}]: {exc}")

    return None, None, 0


def build_existing_coord_cache() -> dict[str, tuple[float, float]]:
    cache: dict[str, tuple[float, float]] = {}
    existing = load_existing_geojson("vancouver_consulates.geojson")
    if not existing or not isinstance(existing, dict):
        return cache
    for feat in existing.get("features") or []:
        props = feat.get("properties") or {}
        coords = feat.get("geometry", {}).get("coordinates") or []
        addr = normalize_space(str(props.get("address") or "")).lower()
        if addr and len(coords) >= 2:
            try:
                cache[addr] = (float(coords[0]), float(coords[1]))
            except (TypeError, ValueError):
                pass
    return cache


def parse_directory_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    body = soup.find("div", id="body")
    if not body:
        raise RuntimeError("無法在 BC Consular Directory 頁面找到 div#body 容器")

    entries: list[dict] = []
    current_country: str | None = None
    current_subcity: str | None = None

    for el in body.children:
        if not getattr(el, "name", None):
            continue
        if el.name == "h2":
            txt = normalize_space(el.get_text(" ", strip=True))
            if len(txt) > 1:
                current_country = txt
                current_subcity = None
            else:
                current_country = None
        elif el.name == "h3":
            current_subcity = normalize_space(el.get_text(" ", strip=True))
        elif el.name == "table" and current_country:
            rec: dict = {
                "country": current_country,
                "subcity": current_subcity,
                "website": None,
                "fact_sheet_url": None,
            }
            for tr in el.find_all("tr"):
                cells = tr.find_all(["th", "td"])
                if len(cells) < 2:
                    continue
                k = normalize_space(cells[0].get_text(" ", strip=True)).rstrip(":")
                for br in cells[1].find_all("br"):
                    br.replace_with("\n")
                lines = [
                    normalize_space(ln)
                    for ln in cells[1].get_text("", strip=False).splitlines()
                    if normalize_space(ln)
                ]
                val = "\n".join(lines)
                rec[k] = val
                if k.lower() == "website":
                    a = cells[1].find("a", href=True)
                    if a:
                        rec["website"] = a["href"].strip()
                    elif val.startswith("http"):
                        rec["website"] = val
                    elif val:
                        rec["website"] = f"https://{val.lstrip('/')}"
                elif k.lower() == "email":
                    emails = []
                    for a in cells[1].find_all("a", href=True):
                        href = a["href"]
                        if href.lower().startswith("mailto:"):
                            em = normalize_space(href[7:].split("?")[0])
                            if em and em not in emails:
                                emails.append(em)
                    if emails:
                        rec[k] = "\n".join(emails)

            nxt = el.find_next_sibling()
            while nxt and getattr(nxt, "name", None) not in ("h2", "h3", "table"):
                for a in nxt.find_all("a", href=True):
                    href = a["href"].strip()
                    txt = a.get_text(" ", strip=True).lower()
                    if "international.gc.ca" in href or "fact sheet" in txt:
                        rec["fact_sheet_url"] = href
                nxt = nxt.find_next_sibling()

            entries.append(rec)

    return entries


def main() -> int:
    url = get_source_endpoint_url("consulates", DEFAULT_DIRECTORY_URL)
    print(f"📡 正在抓取 Consular Corps of B.C. 領事館目錄: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    raw_entries = parse_directory_html(resp.text)
    print(f"📋 頁面共解析到 {len(raw_entries)} 筆表格條目，過濾空缺後進行地址編碼...")

    coord_cache = build_existing_coord_cache()
    features: list[dict] = []
    skipped_vacant = 0
    failed_geocode: list[str] = []

    for entry in raw_entries:
        country = entry.get("country", "")
        raw_addr = entry.get("Mailing Address", "")
        head = normalize_space(entry.get("Head of Consular Post", ""))
        rank = normalize_space(entry.get("Rank", ""))

        if not raw_addr:
            skipped_vacant += 1
            continue

        office_name, formatted_addr, city = split_mailing_address(raw_addr, country, rank)
        if not formatted_addr:
            skipped_vacant += 1
            continue

        lon, lat, score = geocode_address(formatted_addr, coord_cache)
        if lon is None or lat is None:
            failed_geocode.append(f"{country} ({office_name}): {formatted_addr}")
            print(f"  ⚠️ 無法解析座標: {country} -> {formatted_addr}")
            continue

        phone = normalize_space(entry.get("Phone", "")) or None
        fax = normalize_space(entry.get("Fax", "")) or None
        email = entry.get("Email") or None
        if email:
            email = normalize_space(email.replace("\n", ", "))
        website = entry.get("website") or None
        fact_sheet_url = entry.get("fact_sheet_url") or None
        country_zh = get_country_zh(country)

        fid_base = f"consulate_{slugify(country)}_{slugify(city)}"
        short_hash = hashlib.md5(f"{country}|{office_name}|{formatted_addr}".encode("utf-8")).hexdigest()[:6]
        fid = f"{fid_base}_{short_hash}"

        feat = {
            "type": "Feature",
            "id": fid,
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": {
                "id": fid,
                "facility_type": "consulates",
                "name": office_name,
                "office_name": office_name,
                "country": country,
                "country_zh": country_zh or None,
                "subcity": entry.get("subcity") or None,
                "city": city,
                "local_area": city,
                "address": formatted_addr,
                "head_of_post": head if head and head.lower() != "vacant" else None,
                "rank": rank or None,
                "phone": phone,
                "fax": fax,
                "email": email,
                "website": website,
                "fact_sheet_url": fact_sheet_url,
                "hours": None,
                "services": None,
                "social": None,
                "geocode_score": score,
                "source": "Consular Corps of B.C. (gov.bc.ca)",
            },
        }
        features.append(feat)

    print(
        f"✅ 成功建置 {len(features)} 處領事館點位 "
        f"(略過空缺/無地址 {skipped_vacant} 筆，地理編碼失敗 {len(failed_geocode)} 筆)"
    )
    if failed_geocode:
        for fg in failed_geocode:
            print(f"   - 未定位: {fg}")

    if not features:
        print("❌ 沒有成功取得任何領事館資料，中止寫入！")
        return 1

    save_layer_geojson("vancouver_consulates.geojson", features)
    update_admin_source_metadata("consulates", record_count=len(features))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
