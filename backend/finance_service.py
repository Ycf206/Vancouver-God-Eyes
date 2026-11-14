"""Finance market search, quote chart, and business news service (Yahoo Finance + CBC Business)."""

from __future__ import annotations

import html
import logging
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

_YAHOO_HOSTS = (
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
)
_CBC_BUSINESS_RSS_URL = "https://www.cbc.ca/cmlink/rss-business"

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_IMG_SRC_RE = re.compile(r'src=["\']([^"\']+)["\']', re.IGNORECASE)


class _BoundedTTLCache:
    def __init__(self, max_items: int = 128):
        self._max_items = max_items
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str, ttl_seconds: float) -> Any:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            ts, value = entry
            if now - ts > ttl_seconds:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        now = time.monotonic()
        with self._lock:
            self._store[key] = (now, value)
            self._store.move_to_end(key)
            while len(self._store) > self._max_items:
                self._store.popitem(last=False)


_cache = _BoundedTTLCache(max_items=128)


def _fetch_yahoo_json(path_and_query: str, timeout: float = 8.0) -> tuple[int, Optional[dict[str, Any]], str]:
    last_status = 502
    last_text = ""
    for host in _YAHOO_HOSTS:
        url = f"{host}{path_and_query}"
        try:
            resp = requests.get(url, headers=_DEFAULT_HEADERS, timeout=timeout)
            last_status = resp.status_code
            last_text = resp.text or ""
            if resp.ok:
                return resp.status_code, resp.json(), last_text
            if resp.status_code not in (429, 500, 502, 503, 504):
                return resp.status_code, None, last_text
        except Exception as exc:
            logger.warning("[Finance] Yahoo request failed (%s): %s", host, exc)
            last_status = 502
            last_text = str(exc)
    return last_status, None, last_text


def _strip_html(raw: str) -> str:
    return html.unescape(_HTML_TAG_RE.sub("", raw or "")).strip()


def _parse_cbc_rss(xml_text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    now_ts = int(time.time())
    try:
        root = ET.fromstring(xml_text)
        xml_items = root.findall(".//item")[:15]
        for node in xml_items:
            title = _strip_html(node.findtext("title") or "")
            link = (node.findtext("link") or "").strip()
            if not title or not link:
                continue
            pub_raw = (node.findtext("pubDate") or "").strip()
            pub_ts = now_ts
            if pub_raw:
                try:
                    pub_ts = int(parsedate_to_datetime(pub_raw).timestamp())
                except Exception:
                    pub_ts = now_ts
            raw_desc = node.findtext("description") or ""
            img_match = _IMG_SRC_RE.search(raw_desc)
            thumb = img_match.group(1) if img_match else ""
            clean_desc = _strip_html(raw_desc)[:200]
            items.append(
                {
                    "id": link,
                    "title": title,
                    "publisher": "CBC Business (Canada)",
                    "link": link,
                    "publishTime": pub_ts,
                    "thumbnail": thumb,
                    "summary": clean_desc,
                }
            )
        return items
    except ET.ParseError:
        pass

    # Fallback regex parser if CBC feed contains malformed XML characters
    item_blocks = re.findall(r"<item>[\s\S]*?</item>", xml_text, flags=re.IGNORECASE)[:15]
    for block in item_blocks:
        title_m = re.search(
            r"<title><!\[CDATA\[(.*?)\]\]></title>|<title>(.*?)</title>",
            block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        link_m = re.search(r"<link>(.*?)</link>", block, flags=re.IGNORECASE | re.DOTALL)
        if not title_m or not link_m:
            continue
        title = _strip_html(title_m.group(1) or title_m.group(2) or "")
        link = (link_m.group(1) or "").strip()
        if not title or not link:
            continue
        pub_m = re.search(r"<pubDate>(.*?)</pubDate>", block, flags=re.IGNORECASE | re.DOTALL)
        pub_ts = now_ts
        if pub_m:
            try:
                pub_ts = int(parsedate_to_datetime(pub_m.group(1).strip()).timestamp())
            except Exception:
                pub_ts = now_ts
        desc_m = re.search(
            r"<description><!\[CDATA\[(.*?)\]\]></description>|<description>(.*?)</description>",
            block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        raw_desc = (desc_m.group(1) or desc_m.group(2) or "") if desc_m else ""
        img_match = _IMG_SRC_RE.search(raw_desc)
        thumb = img_match.group(1) if img_match else ""
        items.append(
            {
                "id": link,
                "title": title,
                "publisher": "CBC Business (Canada)",
                "link": link,
                "publishTime": pub_ts,
                "thumbnail": thumb,
                "summary": _strip_html(raw_desc)[:200],
            }
        )
    return items


def _fetch_cbc_news() -> list[dict[str, Any]]:
    try:
        resp = requests.get(
            _CBC_BUSINESS_RSS_URL,
            headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"]},
            timeout=6.0,
        )
        if resp.ok and resp.text:
            return _parse_cbc_rss(resp.text)
    except Exception as exc:
        logger.warning("[Finance News] CBC RSS fetch failed: %s", exc)
    return []


def _fetch_yahoo_news(query: str) -> list[dict[str, Any]]:
    encoded_q = urllib.parse.quote(query, safe="")
    status, data, _ = _fetch_yahoo_json(
        f"/v1/finance/search?q={encoded_q}&newsCount=25",
        timeout=8.0,
    )
    if status != 200 or not data:
        return []
    now_ts = int(time.time())
    items: list[dict[str, Any]] = []
    for raw in data.get("news") or []:
        title = raw.get("title")
        link = raw.get("link")
        if not title or not link:
            continue
        thumb = ""
        resolutions = (raw.get("thumbnail") or {}).get("resolutions") or []
        if resolutions:
            thumb = resolutions[-1].get("url") or ""
        items.append(
            {
                "id": raw.get("uuid") or link,
                "title": title,
                "publisher": raw.get("publisher") or "Yahoo Finance",
                "link": link,
                "publishTime": raw.get("providerPublishTime") or now_ts,
                "thumbnail": thumb,
                "summary": raw.get("summary") or "",
            }
        )
    return items


def get_finance_news(query: str = "market") -> dict[str, Any]:
    clean_query = (query or "").strip() or "market"
    cache_key = f"news:{clean_query.lower()}"
    cached = _cache.get(cache_key, ttl_seconds=120.0)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=2) as pool:
        yf_future = pool.submit(_fetch_yahoo_news, clean_query)
        cbc_future = pool.submit(_fetch_cbc_news)
        combined = yf_future.result() + cbc_future.result()

    seen_urls: set[str] = set()
    unique_items: list[dict[str, Any]] = []
    for item in combined:
        link = item.get("link")
        if not link or link in seen_urls:
            continue
        seen_urls.add(link)
        unique_items.append(item)

    unique_items.sort(key=lambda x: x.get("publishTime") or 0, reverse=True)
    payload = {
        "success": True,
        "total": len(unique_items),
        "news": unique_items,
    }
    if unique_items:
        _cache.set(cache_key, payload)
    return payload


def get_stock_suggestions(q: str) -> tuple[int, dict[str, Any]]:
    clean_q = (q or "").strip()
    if not clean_q:
        return 200, {"success": True, "suggestions": []}

    cache_key = f"search:{clean_q.lower()}"
    cached = _cache.get(cache_key, ttl_seconds=60.0)
    if cached is not None:
        return 200, cached

    encoded_q = urllib.parse.quote(clean_q, safe="")
    status, data, _ = _fetch_yahoo_json(
        f"/v1/finance/search?q={encoded_q}&quotesCount=8&newsCount=0&enableFuzzyQuery=true",
        timeout=6.0,
    )
    if status != 200 or data is None:
        return status, {"success": False, "suggestions": []}

    quotes = data.get("quotes") if isinstance(data.get("quotes"), list) else []
    suggestions: list[dict[str, Any]] = []
    for item in quotes:
        sym = item.get("symbol")
        if not sym:
            continue
        suggestions.append(
            {
                "symbol": sym,
                "name": item.get("shortname") or item.get("longname") or sym,
                "exchange": item.get("exchDisp") or item.get("exchange") or "",
                "type": item.get("quoteType") or "EQUITY",
            }
        )
        if len(suggestions) >= 8:
            break

    payload = {"success": True, "suggestions": suggestions}
    _cache.set(cache_key, payload)
    return 200, payload


def _friendly_stock_error(status: int, raw_text: str, interval: str, range_val: str) -> str:
    try:
        import json as _json

        parsed = _json.loads(raw_text)
        desc = ((parsed.get("chart") or {}).get("error") or {}).get("description") or ""
        if desc:
            if "data not available for range" in desc:
                return (
                    f"「{interval}」K線週期不支援目前選取的「{range_val}」時間範圍"
                    "（分鐘級數據如 1m 僅支援 7 天以內範圍）。請縮小時間範圍或將週期改為「1d」。"
                )
            return f"Yahoo Finance: {desc}"
    except Exception:
        pass

    if status == 422:
        return f"K線週期「{interval}」與時間範圍「{range_val}」不相容。請縮小時間範圍或選擇較大週期（如 1d）。"
    if status == 404:
        return "查無此股票代號之報價數據，請確認代號是否正確。"
    return f"Yahoo Finance API 回傳錯誤 ({status})"


def get_stock_quote(
    symbol: str,
    interval: str = "1d",
    range_val: str = "1mo",
    period1: Optional[str] = None,
    period2: Optional[str] = None,
    include_pre_post: bool = False,
) -> tuple[int, dict[str, Any]]:
    sym = (symbol or "").strip().upper()
    if not sym:
        return 400, {"success": False, "error": "請輸入股票代號 (如 TSLA, RY.TO)"}

    iv = (interval or "1d").strip() or "1d"
    rng = (range_val or "1mo").strip() or "1mo"
    p1 = period1.strip() if period1 else None
    p2 = period2.strip() if period2 else None

    if iv == "1m" and not p1 and rng in ("1mo", "3mo", "6mo", "1y", "5y", "max"):
        rng = "5d"
    elif iv in ("2m", "5m", "15m", "30m") and not p1 and rng in ("3mo", "6mo", "1y", "5y", "max"):
        rng = "1mo"

    cache_key = f"stock:{sym}:{iv}:{rng}:{p1 or ''}:{p2 or ''}:{int(include_pre_post)}"
    cached = _cache.get(cache_key, ttl_seconds=15.0)
    if cached is not None:
        return 200, cached

    params: dict[str, str] = {
        "interval": iv,
        "includePrePost": "true" if include_pre_post else "false",
        "events": "div,splits",
    }
    if p1 and p2:
        params["period1"] = p1
        params["period2"] = p2
    else:
        params["range"] = rng

    encoded_sym = urllib.parse.quote(sym, safe="")
    qs = urllib.parse.urlencode(params)
    status, data, raw_text = _fetch_yahoo_json(
        f"/v8/finance/chart/{encoded_sym}?{qs}",
        timeout=10.0,
    )

    if status != 200 or data is None:
        return status, {
            "success": False,
            "error": _friendly_stock_error(status, raw_text, iv, rng),
        }

    chart_obj = data.get("chart") or {}
    results = chart_obj.get("result") or []
    if not results:
        err = (chart_obj.get("error") or {}).get("description") or "查無此股票代號之數據"
        return 404, {"success": False, "error": err}

    result = results[0] or {}
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0] or {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    chart_points: list[dict[str, Any]] = []
    for idx, ts in enumerate(timestamps):
        close_val = closes[idx] if idx < len(closes) else None
        if close_val is None:
            continue
        chart_points.append(
            {
                "time": ts,
                "open": opens[idx] if idx < len(opens) else None,
                "high": highs[idx] if idx < len(highs) else None,
                "low": lows[idx] if idx < len(lows) else None,
                "close": close_val,
                "volume": volumes[idx] if idx < len(volumes) else None,
            }
        )

    raw_regular = meta.get("regularMarketPrice")
    if raw_regular is not None:
        regular_price = raw_regular
    elif chart_points:
        regular_price = chart_points[-1]["close"]
    else:
        regular_price = 0

    prev_close = meta.get("chartPreviousClose")
    if prev_close is None:
        prev_close = meta.get("previousClose")
    if prev_close is None:
        prev_close = regular_price

    change = (regular_price or 0) - (prev_close or 0)
    change_percent = (change / prev_close) * 100 if prev_close and prev_close > 0 else 0

    payload = {
        "success": True,
        "data": {
            "symbol": meta.get("symbol") or sym,
            "shortName": meta.get("shortName") or meta.get("symbol") or sym,
            "longName": meta.get("longName") or meta.get("shortName") or meta.get("symbol") or sym,
            "currency": meta.get("currency") or "USD",
            "exchangeName": meta.get("exchangeName") or "",
            "instrumentType": meta.get("instrumentType") or "",
            "firstTradeDate": meta.get("firstTradeDate"),
            "regularMarketTime": meta.get("regularMarketTime"),
            "timezone": meta.get("timezone") or "America/New_York",
            "regularMarketPrice": regular_price,
            "regularMarketDayHigh": meta.get("regularMarketDayHigh"),
            "regularMarketDayLow": meta.get("regularMarketDayLow"),
            "regularMarketVolume": meta.get("regularMarketVolume"),
            "previousClose": prev_close,
            "change": change,
            "changePercent": change_percent,
            "chartPoints": chart_points,
        },
    }
    _cache.set(cache_key, payload)
    return 200, payload
