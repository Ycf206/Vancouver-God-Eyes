import os
import re
import json
import math
import time
import logging
import asyncio
import tempfile
import requests
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# 完全靜音 py_gasbuddy 函式庫內部錯誤日誌，避免 400 Bad Request 或 Cloudflare 告警污染終端與系統日誌
gb_logger = logging.getLogger("py_gasbuddy")
gb_logger.setLevel(logging.CRITICAL)
gb_logger.propagate = False

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend", "public"))
FUEL_CACHE_FILE = os.path.join(DATA_DIR, "vancouver_fuel_cache.json")
FRONTEND_FUEL_CACHE_FILE = os.path.join(FRONTEND_PUBLIC_DIR, "vancouver_fuel_cache.json")

# In-memory cache for gas station prices (TTL: 55 seconds for 1-minute live background sync)
_fuel_cache: Dict[str, Any] = {
    "timestamp": 0,
    "stations": []
}

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth (in km)."""
    R = 6371.0  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

_raw_stations_cache: Dict[str, Any] = {
    "mtime": 0.0,
    "stations": []
}

def load_vancouver_stations() -> List[Dict[str, Any]]:
    """Load curated Metro Vancouver gas stations from vancouver_fuel.geojson (with mtime cache)."""
    geojson_path = os.path.join(DATA_DIR, "vancouver_fuel.geojson")
    if not os.path.exists(geojson_path):
        return []
    try:
        mtime = os.path.getmtime(geojson_path)
        if _raw_stations_cache["stations"] and _raw_stations_cache["mtime"] == mtime:
            return _raw_stations_cache["stations"]

        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        stations = []
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [0, 0])
            lon, lat = coords[0], coords[1]
            stations.append({
                "id": str(props.get("id", "")),
                "name": props.get("name", "油站"),
                "brand": props.get("brand", "油站"),
                "address": props.get("address", "Vancouver"),
                "city": props.get("city", "Vancouver"),
                "province": props.get("province", "BC"),
                "opening_hours": props.get("opening_hours", ""),
                "lat": lat,
                "lon": lon,
            })
        _raw_stations_cache["mtime"] = mtime
        _raw_stations_cache["stations"] = stations
        return stations
    except Exception as e:
        logger.error(f"Error reading vancouver_fuel.geojson: {e}")
        return _raw_stations_cache["stations"] or []

def _atomic_write_json(target_path: str, payload: Any) -> None:
    parent_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(parent_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".fuel_", suffix=".tmp", dir=parent_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

def _load_persisted_fuel_cache() -> List[Dict[str, Any]]:
    """Loads authentic last-known gas prices from disk cache."""
    candidates = [FUEL_CACHE_FILE, FRONTEND_FUEL_CACHE_FILE]
    for p in candidates:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list) and len(data) > 0:
                        return data
                    if isinstance(data, dict) and isinstance(data.get("stations"), list):
                        return data["stations"]
            except Exception:
                pass
    return []

FUEL_GRID_POINTS: List[Tuple[float, float]] = [
    (49.2827, -123.1207),  # Downtown / West End / Burrard
    (49.2810, -123.0450),  # East Hastings / Burnaby Heights
    (49.2600, -123.1900),  # Kitsilano / UBC / West Broadway
    (49.2550, -123.0250),  # Burnaby / Renfrew / Boundary
    (49.2260, -123.1000),  # South Vancouver / Oak / Main / Kingsway
    (49.2050, -123.0250),  # SE Marine / South Burnaby / River District
    (49.3200, -123.0700),  # North Vancouver
    (49.1700, -123.1360),  # Richmond
]


def _normalize_brand(name: str) -> str:
    s = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    if "petro" in s:
        return "petrocanada"
    if "chevron" in s or "townpantry" in s:
        return "chevron"
    if "shell" in s:
        return "shell"
    if "esso" in s or "smartstop" in s or "7eleven" in s:
        return "esso"
    if "mobil" in s:
        return "mobil"
    if "husky" in s or "myhusky" in s:
        return "husky"
    if "superstore" in s or "supergas" in s:
        return "superstore"
    if "costco" in s:
        return "costco"
    if "coop" in s:
        return "coop"
    if "domo" in s:
        return "domo"
    if "canco" in s:
        return "canco"
    return s


def _normalize_address(addr: str) -> str:
    s = (addr or "").lower().strip()
    s = re.sub(r"\bstreet\b", "st", s)
    s = re.sub(r"\bavenue\b", "ave", s)
    s = re.sub(r"\bdrive\b", "dr", s)
    s = re.sub(r"\broad\b", "rd", s)
    s = re.sub(r"\bhighway\b", "hwy", s)
    s = re.sub(r"\bsoutheast\b", "se", s)
    s = re.sub(r"\bsouthwest\b", "sw", s)
    s = re.sub(r"\bnortheast\b", "ne", s)
    s = re.sub(r"\bnorthwest\b", "nw", s)
    s = re.sub(r"\bwest\b", "w", s)
    s = re.sub(r"\beast\b", "e", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _to_cents_per_litre(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        num = float(val)
    except (ValueError, TypeError):
        return None
    if num <= 0:
        return None
    if num < 10.0:  # Convert dollars/L (e.g. 1.859) to cents/L (185.9)
        return round(num * 100.0, 1)
    return round(num, 1)


def _extract_gb_grade_price(st: Any, product_key: str) -> Optional[float]:
    """Extract posted fuel price from both py_gasbuddy top-level dicts and legacy nested shapes."""
    node = st.get(product_key) if isinstance(st, dict) else getattr(st, product_key, None)
    if node is None and isinstance(st, dict):
        nested = st.get("prices")
        if isinstance(nested, dict):
            node = nested.get(product_key)

    if node is None:
        return None

    if isinstance(node, dict):
        raw = node.get("price")
        if raw is None:
            raw = node.get("cash_price")
        if raw is None and isinstance(node.get("credit"), dict):
            raw = node["credit"].get("price")
        if raw is None and isinstance(node.get("cash"), dict):
            raw = node["cash"].get("price")
        return _to_cents_per_litre(raw)

    raw = getattr(node, "price", None)
    if raw is None:
        raw = getattr(node, "cash_price", None)
    if raw is None:
        credit_obj = getattr(node, "credit", None)
        cash_obj = getattr(node, "cash", None)
        raw = getattr(credit_obj, "price", None) or getattr(cash_obj, "price", None)
    return _to_cents_per_litre(raw)


def _extract_gb_address_line(st: Any) -> str:
    addr_obj = st.get("address") if isinstance(st, dict) else getattr(st, "address", "")
    if isinstance(addr_obj, dict):
        return str(addr_obj.get("line1") or "").strip()
    if isinstance(addr_obj, str):
        return addr_obj.strip()
    return str(getattr(addr_obj, "line1", "") or "").strip()


async def fetch_gasbuddy_prices_live(lat: float = 49.2827, lon: float = -123.1207) -> Dict[str, Dict[str, Any]]:
    """
    Fetch real-time station prices via py-gasbuddy across Metro Vancouver grid coordinates.
    Strictly authentic: returns actual reported GasBuddy prices only without synthesizing grades.
    """
    price_map: Dict[str, Dict[str, Any]] = {}

    try:
        gb_logger.setLevel(logging.CRITICAL)
        gb_logger.propagate = False
        from py_gasbuddy import GasBuddy
        gb = GasBuddy()

        query_points = list(FUEL_GRID_POINTS)
        if all(haversine_distance(lat, lon, gx, gy) > 2.5 for gx, gy in query_points):
            query_points.insert(0, (lat, lon))

        tasks = [gb.price_lookup_service(lat=qlat, lon=qlon, limit=20) for qlat, qlon in query_points]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

        seen_ids: set = set()
        for res in responses:
            if isinstance(res, Exception) or res is None:
                continue
            stations = (
                (res.get("results") or res.get("stations") or [])
                if isinstance(res, dict)
                else (getattr(res, "results", None) or getattr(res, "stations", None) or [])
            )
            for st in stations:
                sid = str((st.get("station_id") if isinstance(st, dict) else getattr(st, "station_id", "")) or "").strip()
                if sid and sid in seen_ids:
                    continue

                st_name = str((st.get("name") if isinstance(st, dict) else getattr(st, "name", "")) or "").strip()
                st_address = _extract_gb_address_line(st)
                st_lat = st.get("latitude") if isinstance(st, dict) else getattr(st, "latitude", None)
                st_lon = st.get("longitude") if isinstance(st, dict) else getattr(st, "longitude", None)

                p_reg = _extract_gb_grade_price(st, "regular_gas")
                p_mid = _extract_gb_grade_price(st, "midgrade_gas")
                p_prem = _extract_gb_grade_price(st, "premium_gas")
                p_dsl = _extract_gb_grade_price(st, "diesel")

                if p_reg is None and p_mid is None and p_prem is None and p_dsl is None:
                    continue

                if sid:
                    seen_ids.add(sid)

                key = f"{sid}_{st_name}_{st_address}".lower().strip()
                price_map[key] = {
                    "regular": p_reg,
                    "midgrade": p_mid,
                    "premium": p_prem,
                    "diesel": p_dsl,
                    "_meta": {
                        "station_id": sid,
                        "name": st_name,
                        "brand_norm": _normalize_brand(st_name),
                        "address": _normalize_address(st_address),
                        "lat": float(st_lat) if st_lat is not None else None,
                        "lon": float(st_lon) if st_lon is not None else None,
                    },
                }
    except Exception as e:
        logger.debug(f"py-gasbuddy lookup failed: {e}")

    return price_map


def enrich_stations_with_real_prices(raw_stations: List[Dict[str, Any]], live_prices: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    真實性保證：結合官方即時報價與最後成功的官方真實價格快取。
    絕不生成任何硬編碼或演算法模擬的假價格。
    """
    persisted_stations = _load_persisted_fuel_cache()
    last_known_map: Dict[str, Dict[str, Any]] = {}
    for pst in persisted_stations:
        sid = str(pst.get("id") or "")
        brand_addr = f"{_normalize_brand(pst.get('brand', ''))}_{_normalize_address(pst.get('address', ''))}"
        if sid:
            last_known_map[sid] = pst
        if brand_addr != "_":
            last_known_map[brand_addr] = pst

    live_entries = list(live_prices.values())
    enriched = []

    for st in raw_stations:
        brand = st.get("brand", "油站")
        s_brand_norm = _normalize_brand(brand or st.get("name", ""))
        addr = st.get("address", "")
        s_addr_norm = _normalize_address(addr)
        sid = str(st.get("id", ""))
        slat = st.get("lat")
        slon = st.get("lon")

        prices = None
        source = "GasBuddy Live"
        best_match: Optional[Dict[str, Any]] = None
        best_score = 999.0

        # 1. 優先依地理座標距離 (+ 品牌相似度) 精準配對 GasBuddy 即時報價
        if slat is not None and slon is not None:
            for entry in live_entries:
                meta = entry.get("_meta") or {}
                elat = meta.get("lat")
                elon = meta.get("lon")
                if elat is None or elon is None:
                    continue
                d_km = haversine_distance(float(slat), float(slon), float(elat), float(elon))
                if d_km > 0.35:
                    continue
                ebrand = meta.get("brand_norm") or ""
                same_brand = bool(s_brand_norm and ebrand and s_brand_norm == ebrand)
                if not same_brand and d_km > 0.12:
                    continue
                score = d_km + (0.0 if same_brand else 0.15)
                if score < best_score:
                    best_score = score
                    best_match = entry

        # 次選以標準化品牌 + 完整地址配對
        if not best_match and s_addr_norm and s_addr_norm != "vancouver station":
            for entry in live_entries:
                meta = entry.get("_meta") or {}
                if meta.get("address") == s_addr_norm and (not s_brand_norm or meta.get("brand_norm") == s_brand_norm):
                    best_match = entry
                    break

        if best_match:
            prices = {
                "regular": best_match.get("regular"),
                "midgrade": best_match.get("midgrade"),
                "premium": best_match.get("premium"),
                "diesel": best_match.get("diesel"),
            }

        # 2. 若本次 API 暫無更新或該站無即時回報，維持最後一次成功的官方真實記錄
        if not prices:
            prev = last_known_map.get(sid) or last_known_map.get(f"{s_brand_norm}_{s_addr_norm}")
            if prev and isinstance(prev.get("prices"), dict) and any(prev["prices"].get(k) is not None for k in ("regular", "midgrade", "premium", "diesel")):
                prices = prev["prices"]
                source = prev.get("source") or "GasBuddy Official (Last Known)"

        # 3. 若全無官方真實紀錄，設置為空並標示待更新，嚴禁製造假價格
        if not prices:
            prices = {
                "regular": None,
                "midgrade": None,
                "premium": None,
                "diesel": None
            }
            source = "待官方即時更新"

        enriched.append({
            **st,
            "prices": prices,
            "source": source,
            "updated_at": "剛更新" if source == "GasBuddy Live" else "待官方即時更新" if source == "待官方即時更新" else "快取"
        })

    return enriched

async def get_fuel_stations_data(user_lat: Optional[float] = None, user_lon: Optional[float] = None, fuel_type: str = "regular", sort_by: str = "best") -> List[Dict[str, Any]]:
    """
    0ms 極速無卡頓：直接由記憶體或原子快取提供大溫油站真實油價。
    """
    global _fuel_cache
    now = time.time()

    # 1. 如果記憶體快取在 55 秒內且有站點資料，直接由記憶體提供 (0ms)
    if _fuel_cache.get("stations") and (now - _fuel_cache.get("timestamp", 0) < 55):
        stations = [dict(s) for s in _fuel_cache["stations"]]
    else:
        # 2. 檢查磁碟原子快取是否足夠新鮮且含有效油價
        persisted = _load_persisted_fuel_cache()
        disk_mtime = 0.0
        for cand in (FUEL_CACHE_FILE, FRONTEND_FUEL_CACHE_FILE):
            if os.path.exists(cand):
                try:
                    disk_mtime = max(disk_mtime, os.path.getmtime(cand))
                except OSError:
                    pass
        has_valid_persisted = any(
            isinstance(s.get("prices"), dict) and s["prices"].get("regular") is not None
            for s in persisted
        )
        if persisted and has_valid_persisted and (now - disk_mtime < 55):
            _fuel_cache["stations"] = persisted
            _fuel_cache["timestamp"] = disk_mtime
            stations = [dict(s) for s in persisted]
        else:
            # 觸發背景或即時更新
            raw_stations = load_vancouver_stations()
            center_lat = user_lat if user_lat is not None else 49.2827
            center_lon = user_lon if user_lon is not None else -123.1207

            live_prices = await fetch_gasbuddy_prices_live(center_lat, center_lon)
            enriched = enrich_stations_with_real_prices(raw_stations, live_prices)

            _fuel_cache = {
                "timestamp": now,
                "stations": enriched
            }
            try:
                _atomic_write_json(FUEL_CACHE_FILE, enriched)
                if os.path.exists(FRONTEND_PUBLIC_DIR):
                    _atomic_write_json(FRONTEND_FUEL_CACHE_FILE, enriched)
            except Exception as e:
                logger.warning(f"Failed to persist fuel cache: {e}")
            stations = [dict(s) for s in enriched]

    # Calculate distance for each station
    ref_lat = user_lat if user_lat is not None else 49.2606
    ref_lon = user_lon if user_lon is not None else -123.1134

    for s in stations:
        dist = haversine_distance(ref_lat, ref_lon, s["lat"], s["lon"])
        s["distance_km"] = dist
        p_val = s["prices"].get(fuel_type) if isinstance(s.get("prices"), dict) else None
        s["price_current"] = p_val if p_val is not None else 999.0

    # Sorting logic
    if sort_by == "price":
        stations.sort(key=lambda s: (s["price_current"], s["distance_km"]))
    elif sort_by == "distance":
        stations.sort(key=lambda s: (s["distance_km"], s["price_current"]))
    else:  # "best": price and distance optimal balance
        valid_prices = [s["price_current"] for s in stations if s["price_current"] < 900.0]
        min_p = min(valid_prices) if valid_prices else 0.0
        max_p = max(valid_prices) if valid_prices else 1.0
        p_range = max(0.1, max_p - min_p)

        min_d = min(s["distance_km"] for s in stations) if stations else 0.0
        max_d = max(s["distance_km"] for s in stations) if stations else 1.0
        d_range = max(0.1, max_d - min_d)

        for s in stations:
            norm_p = ((s["price_current"] - min_p) / p_range) if s["price_current"] < 900.0 else 1.0
            norm_d = (s["distance_km"] - min_d) / d_range
            s["best_score"] = (0.55 * norm_p) + (0.45 * norm_d)

        stations.sort(key=lambda s: s["best_score"])

    return stations

def get_live_fuel_prices(force: bool = True) -> List[Dict[str, Any]]:
    """
    同步取得大溫地區油站資料與即時油價快取（供 OCI 手動與 1 分鐘定時更新呼叫）。
    真實性保證：絕不製造假資料。
    """
    global _fuel_cache
    raw_stations = load_vancouver_stations()
    live_prices = {}
    try:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    live_prices = executor.submit(asyncio.run, fetch_gasbuddy_prices_live()).result(timeout=12)
            else:
                live_prices = loop.run_until_complete(fetch_gasbuddy_prices_live())
        except RuntimeError:
            live_prices = asyncio.run(fetch_gasbuddy_prices_live())
    except Exception as e:
        logger.warning(f"Error fetching live gas prices in sync runner: {e}")

    enriched = enrich_stations_with_real_prices(raw_stations, live_prices)
    _fuel_cache = {
        "timestamp": time.time(),
        "stations": enriched
    }
    try:
        _atomic_write_json(FUEL_CACHE_FILE, enriched)
        if os.path.exists(FRONTEND_PUBLIC_DIR):
            _atomic_write_json(FRONTEND_FUEL_CACHE_FILE, enriched)
    except Exception as e:
        logger.warning(f"Failed to persist fuel cache: {e}")

    return enriched

async def run_fuel_background_loop():
    """OCI 後台 24/7 自動排程預熱快取 (每 1 分鐘週期自動抓取真實即時油價)"""
    print("⛽ [FuelService] 大溫各大油站即時油價背景定時快取服務啟動 (1 分鐘週期)...")
    try:
        await get_fuel_stations_data()
    except Exception as e:
        logger.warning(f"⚠️ [FuelService] 啟動預熱失敗: {e}")

    while True:
        try:
            await asyncio.sleep(60)  # 每 1 分鐘 (60 秒)
            await get_fuel_stations_data()
        except Exception as e:
            logger.warning(f"⚠️ [FuelService] 背景油價更新失敗: {e}")
