from __future__ import annotations
import os
import json
import time
import re
import html
import subprocess
import email.utils
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import requests

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_DATA_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public", "data"))
SUMMARY_CACHE_FILE = os.path.join(CACHE_DIR, "yvr_weathercams_summary.json")
NEWS_CACHE_FILE = os.path.join(CACHE_DIR, "yvr_news_rss.json")
FRONTEND_NEWS_FILE = os.path.join(FRONTEND_DATA_DIR, "yvr_news.json")

# In-memory caches
_summary_cache = {
    "timestamp": 0,
    "data": None
}

_news_cache = {
    "timestamp": 0,
    "data": None
}

def _normalize_summary_data(data: Dict[str, Any], airport_id: str = "CYVR") -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {"success": False, "cameras": [], "metars": []}
    
    payload = data.get("payload") or {}
    site_container = payload.get("site") or data.get("site") or {}
    site_inner = site_container.get("site") or site_container

    site_id = site_inner.get("siteIdentifier") or data.get("siteIdentifier") or (airport_id.replace("C", "") if airport_id.startswith("C") else airport_id)
    icao_code = site_inner.get("icao") or data.get("icao") or airport_id
    
    data["siteIdentifier"] = site_id
    data["icao"] = icao_code
    data["name"] = data.get("name") or site_inner.get("siteName") or "Vancouver International Airport"
    data["address"] = data.get("address") or "3211 Grant McConachie Wy, Richmond, BC V7B 0A4"
    data["timeZone"] = site_inner.get("timeZone") or data.get("timeZone") or "America/Vancouver"
    data["operatedBy"] = site_inner.get("operatedBy") or data.get("operatedBy") or "NAV CANADA"
    data["sunrise"] = site_inner.get("sunrise") or data.get("sunrise")
    data["sunset"] = site_inner.get("sunset") or data.get("sunset")
    data["latitude"] = site_inner.get("latitude") if site_inner.get("latitude") is not None else data.get("latitude", 49.195)
    data["longitude"] = site_inner.get("longitude") if site_inner.get("longitude") is not None else data.get("longitude", -123.17824)
    data["elevation"] = site_inner.get("elevation") or data.get("elevation", 13)
    
    # Extract cameras & metars
    cameras = site_container.get("cameras") or payload.get("cameras") or data.get("cameras") or []
    metars = payload.get("metars") or data.get("metars") or []
    data["cameras"] = cameras
    data["metars"] = metars
    data["success"] = True
    return data

def fetch_weathercams_summary(airport_id: str = "CYVR") -> Dict[str, Any]:
    """
    Fetches real-time airport summary, cameras, and METARs from FAA WeatherCams.
    Includes Referer and standard browser User-Agent to satisfy hotlinking protection.
    Strictly authentic: does not use any fake or hardcoded mock summary!
    """
    global _summary_cache
    now = time.time()
    if _summary_cache["data"] and (now - _summary_cache["timestamp"] < 50):
        return _summary_cache["data"]

    # Check disk cache if recent (< 60s)
    if os.path.exists(SUMMARY_CACHE_FILE):
        try:
            mtime = os.path.getmtime(SUMMARY_CACHE_FILE)
            if now - mtime < 60:
                with open(SUMMARY_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    norm = _normalize_summary_data(data, airport_id)
                    _summary_cache["data"] = norm
                    _summary_cache["timestamp"] = mtime
                    return norm
        except Exception:
            pass

    url = f"https://weathercams.faa.gov/api/summary?airportId={airport_id}"
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Referer": "https://weathercams.faa.gov/",
        "Accept": "application/json, text/plain, */*"
    }

    # 1. 優先使用 Python 原生 requests
    try:
        resp = requests.get(url, headers=req_headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            norm_data = _normalize_summary_data(data, airport_id)
            _summary_cache["data"] = norm_data
            _summary_cache["timestamp"] = now
            try:
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(SUMMARY_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(norm_data, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
            return norm_data
    except Exception as re_err:
        pass

    curl_bin = "curl.exe" if os.name == "nt" else "curl"
    headers = [
        "-H", f"User-Agent: {req_headers['User-Agent']}",
        "-H", f"Referer: {req_headers['Referer']}",
        "-H", f"Accept: {req_headers['Accept']}"
    ]

    try:
        res = subprocess.run(
            [curl_bin, "-s", url] + headers,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
            check=False
        )
        if res.returncode == 0 and res.stdout:
            stdout_clean = (res.stdout or b"").decode("utf-8", errors="replace").strip()
            if stdout_clean.startswith("{") and stdout_clean.endswith("}"):
                data = json.loads(stdout_clean)
                norm_data = _normalize_summary_data(data, airport_id)

                _summary_cache["data"] = norm_data
                _summary_cache["timestamp"] = now

                try:
                    os.makedirs(CACHE_DIR, exist_ok=True)
                    with open(SUMMARY_CACHE_FILE, "w", encoding="utf-8") as f:
                        json.dump(norm_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass

                return norm_data
    except Exception as e:
        print(f"⚠️ [FAA WeatherCams] Error fetching {airport_id}: {e}")

    # Fallback to existing disk file if available
    if os.path.exists(SUMMARY_CACHE_FILE):
        try:
            with open(SUMMARY_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return _normalize_summary_data(data, airport_id)
        except Exception:
            pass

    # Strictly authentic: if offline and no cache, return empty status, NEVER fake mock data
    return {
        "success": False,
        "siteIdentifier": airport_id.replace("C", "") if airport_id.startswith("C") else airport_id,
        "icao": airport_id,
        "name": "Vancouver International Airport",
        "address": "3211 Grant McConachie Wy, Richmond, BC V7B 0A4",
        "timeZone": "America/Vancouver",
        "operatedBy": "Vancouver Airport Authority",
        "sunrise": None,
        "sunset": None,
        "cameras": [],
        "metars": []
    }

YVR_NEWS_RSS_FEEDS = [
    {"url": "https://news.yvr.ca/tagfeed/en-ca/tags/trending", "category": "焦點趨勢 (Trending)"},
    {"url": "https://news.yvr.ca/tagfeed/en-ca/tags/airmail,import-blog", "category": "航空專欄 (Airmail & Blog)"},
    {"url": "https://news.yvr.ca/tagfeed/en-ca/tags/project", "category": "建設工程 (Projects)"},
    {"url": "https://news.yvr.ca/tagfeed/en-ca/tags/values", "category": "永續價值 (Values)"}
]

def fetch_yvr_news_rss(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Fetches and merges official YVR RSS news feeds once per day (86400s cache).
    Saves to backend and frontend public data.
    Strictly authentic: does not use hardcoded fake articles!
    """
    global _news_cache
    now = time.time()
    
    # 24-hour cache (每天 1 次)
    CACHE_EXPIRY = 86400
    
    if not force_refresh and _news_cache["data"] and (now - _news_cache["timestamp"] < CACHE_EXPIRY):
        return _news_cache["data"]

    # Check disk cache
    if not force_refresh and os.path.exists(NEWS_CACHE_FILE):
        try:
            mtime = os.path.getmtime(NEWS_CACHE_FILE)
            if now - mtime < CACHE_EXPIRY:
                with open(NEWS_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data and len(data) > 0:
                        _news_cache["data"] = data
                        _news_cache["timestamp"] = mtime
                        return data
        except Exception:
            pass

    items_dict: Dict[str, Dict[str, Any]] = {}
    curl_bin = "curl.exe" if os.name == "nt" else "curl"
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*"
    }

    for feed_info in YVR_NEWS_RSS_FEEDS:
        feed_url = feed_info["url"]
        category_name = feed_info["category"]
        stdout_str = ""
        # 1. 優先使用 requests
        try:
            r = requests.get(feed_url, headers=req_headers, timeout=15)
            if r.status_code == 200 and r.text:
                stdout_str = r.text
        except Exception:
            pass

        # 2. 次選 curl
        if not stdout_str:
            try:
                headers = [
                    "-H", f"User-Agent: {req_headers['User-Agent']}",
                    "-H", f"Accept: {req_headers['Accept']}"
                ]
                res = subprocess.run(
                    [curl_bin, "-s", feed_url] + headers,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=15,
                    check=False
                )
                stdout_str = (res.stdout or b"").decode("utf-8", errors="replace")
            except Exception:
                pass

        try:
            if stdout_str and ("<rss" in stdout_str or "<feed" in stdout_str):
                root = ET.fromstring(stdout_str)
                channel = root.find("channel")
                channel_items = channel.findall("item") if channel is not None else root.findall(".//item")
                for it in channel_items:
                    title_elem = it.find("title")
                    link_elem = it.find("link")
                    desc_elem = it.find("description")
                    pubdate_elem = it.find("pubDate")
                    guid_elem = it.find("guid")

                    title = html.unescape(title_elem.text.strip()) if title_elem is not None and title_elem.text else ""
                    
                    # Extract article story link
                    link = link_elem.text.strip() if link_elem is not None and link_elem.text else ""
                    guid = guid_elem.text.strip() if guid_elem is not None and guid_elem.text else ""
                    
                    # Prefer the specific article URL over the feed URL
                    actual_link = link
                    if "tagfeed" in actual_link and guid.startswith("http"):
                        actual_link = guid
                    elif not actual_link and guid.startswith("http"):
                        actual_link = guid

                    raw_desc = desc_elem.text.strip() if desc_elem is not None and desc_elem.text else ""
                    clean_desc = re.sub(r'<[^>]+>', ' ', raw_desc).strip()
                    clean_desc = html.unescape(re.sub(r'\s+', ' ', clean_desc))
                    if len(clean_desc) > 180:
                        clean_desc = clean_desc[:177] + "..."

                    # Parse image from media:content or description
                    image_url = ""
                    media_content = it.find("{http://search.yahoo.com/mrss/}content")
                    if media_content is not None and media_content.attrib.get("url"):
                        image_url = media_content.attrib["url"]
                    elif "<img" in raw_desc:
                        img_match = re.search(r'src=["\']([^"\']+)["\']', raw_desc)
                        if img_match:
                            image_url = img_match.group(1)

                    pub_str = pubdate_elem.text.strip() if pubdate_elem is not None and pubdate_elem.text else ""
                    ts = 0.0
                    date_display = pub_str
                    if pub_str:
                        try:
                            parsed_date = email.utils.parsedate_to_datetime(pub_str)
                            ts = parsed_date.timestamp()
                            date_display = parsed_date.strftime("%Y-%m-%d")
                        except Exception:
                            pass

                    item_key = actual_link or title
                    if item_key and item_key not in items_dict:
                        items_dict[item_key] = {
                            "title": title,
                            "link": actual_link,
                            "description": clean_desc,
                            "pubDate": date_display,
                            "timestamp": ts,
                            "category": category_name,
                            "image": image_url
                        }
        except Exception as e:
            print(f"⚠️ [YVR News RSS] Error fetching {feed_url}: {e}")

    items_list = list(items_dict.values())
    items_list.sort(key=lambda x: x["timestamp"], reverse=True)

    if items_list:
        _news_cache["data"] = items_list
        _news_cache["timestamp"] = now
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(NEWS_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(items_list, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        try:
            os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)
            with open(FRONTEND_NEWS_FILE, "w", encoding="utf-8") as f:
                json.dump(items_list, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        return items_list

    # Fallback to existing disk file if available
    if os.path.exists(NEWS_CACHE_FILE):
        try:
            with open(NEWS_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data and len(data) > 0:
                    return data
        except Exception:
            pass

    # Strictly authentic: return empty list if offline and no cache
    return []


async def run_yvr_airport_background_loop():
    """
    OCI 後台 24/7 自動排程預熱快取 (每 3 分鐘自動抓取真實 FAA 氣象攝影機與 METAR，每 2 小時抓取真實 YVR RSS 新聞)
    """
    import asyncio
    print("🛫 [YVR Airport Service] 機場氣象攝影機與官方資訊背景定時快取服務啟動 (3 分鐘週期)...")
    loop = asyncio.get_event_loop()
    # 啟動時先進行一次預熱
    try:
        await loop.run_in_executor(None, fetch_weathercams_summary, "CYVR")
        await loop.run_in_executor(None, fetch_yvr_news_rss, True)
    except Exception as e:
        print(f"⚠️ [YVR Airport Service] 啟動預熱失敗: {e}")

    counter = 0
    while True:
        try:
            await asyncio.sleep(180)  # 3 分鐘
            counter += 1
            await loop.run_in_executor(None, fetch_weathercams_summary, "CYVR")
            if counter >= 40:  # ~2 小時
                counter = 0
                await loop.run_in_executor(None, fetch_yvr_news_rss, True)
        except Exception as e:
            print(f"⚠️ [YVR Airport Service] 背景機場資料更新失敗: {e}")

