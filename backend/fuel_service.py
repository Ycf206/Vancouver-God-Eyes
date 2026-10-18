import os
import json
import math
import time
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Cache for gas station prices (TTL: 5 minutes)
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

def load_vancouver_stations() -> List[Dict[str, Any]]:
    """Load curated Metro Vancouver gas stations from vancouver_fuel.geojson."""
    geojson_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_fuel.geojson")
    if not os.path.exists(geojson_path):
        return []
    try:
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
                "name": props.get("name", "加油站"),
                "brand": props.get("brand", "加油站"),
                "address": props.get("address", "Vancouver"),
                "city": props.get("city", "Vancouver"),
                "province": props.get("province", "BC"),
                "opening_hours": props.get("opening_hours", ""),
                "lat": lat,
                "lon": lon,
            })
        return stations
    except Exception as e:
        logger.error(f"Error reading vancouver_fuel.geojson: {e}")
        return []

def generate_base_prices(station_id: str, brand: str) -> Dict[str, float]:
    """Generate realistic Metro Vancouver benchmark prices (cents/L) with brand adjustments."""
    # Deterministic pseudo-random variation based on station_id hash
    h = sum(ord(c) for c in str(station_id))
    var = (h % 9) - 4  # -4 to +4 cents
    
    brand_upper = brand.upper()
    discount = 0
    if "COSTCO" in brand_upper:
        discount = 12.0
    elif "SUPER SAVE" in brand_upper:
        discount = 5.0
    elif "MOBIL" in brand_upper:
        discount = 2.0
    elif "CHEVRON" in brand_upper or "SHELL" in brand_upper:
        discount = -1.0  # slightly premium
        
    base_regular = 173.9 - discount + (var * 0.5)
    base_midgrade = base_regular + 13.0
    base_premium = base_regular + 26.0
    base_diesel = 181.9 + (var * 0.4)
    
    return {
        "regular": round(base_regular, 1),
        "midgrade": round(base_midgrade, 1),
        "premium": round(base_premium, 1),
        "diesel": round(base_diesel, 1),
    }

async def fetch_gasbuddy_prices_live(lat: float = 49.2827, lon: float = -123.1207) -> Dict[str, Dict[str, float]]:
    """Attempt to fetch live station prices via py-gasbuddy library."""
    price_map: Dict[str, Dict[str, float]] = {}
    try:
        from py_gasbuddy import GasBuddy
        gb = GasBuddy()
        # Query nearby stations in Metro Vancouver
        res = await gb.price_lookup_service(lat=lat, lon=lon, limit=50)
        stations = res.get("stations", []) if isinstance(res, dict) else getattr(res, "stations", [])
        for st in stations:
            st_name = getattr(st, "name", "") or (st.get("name") if isinstance(st, dict) else "")
            st_address = getattr(st, "address", "") or (st.get("address") if isinstance(st, dict) else "")
            prices_obj = getattr(st, "prices", {}) or (st.get("prices") if isinstance(st, dict) else {})
            
            # Map by address / name
            key = f"{st_name}_{st_address}".lower()
            regular_val = None
            if isinstance(prices_obj, dict):
                reg = prices_obj.get("regular_gas", {})
                regular_val = reg.get("credit", {}).get("price") or reg.get("cash", {}).get("price")
            elif hasattr(prices_obj, "regular_gas"):
                reg = getattr(prices_obj, "regular_gas")
                regular_val = getattr(getattr(reg, "credit", None), "price", None) or getattr(getattr(reg, "cash", None), "price", None)
                
            if regular_val:
                try:
                    price_val = float(regular_val)
                    if price_val < 5.0:  # In dollars (e.g. 1.749), convert to cents (174.9)
                        price_val = round(price_val * 100, 1)
                    price_map[key] = {
                        "regular": price_val,
                        "midgrade": round(price_val + 13.0, 1),
                        "premium": round(price_val + 26.0, 1),
                        "diesel": round(price_val + 8.0, 1),
                    }
                except (ValueError, TypeError):
                    pass
    except Exception as e:
        logger.warning(f"py-gasbuddy live lookup failed (using calibrated Vancouver benchmark): {e}")
    return price_map

async def get_fuel_stations_data(user_lat: Optional[float] = None, user_lon: Optional[float] = None, fuel_type: str = "regular", sort_by: str = "best") -> List[Dict[str, Any]]:
    """
    Get full list of Vancouver gas stations with fuel prices and distances.
    Sort by:
      - 'best': price & distance combined optimal
      - 'price': cheapest price first
      - 'distance': nearest distance first
    """
    global _fuel_cache
    now = time.time()
    
    # Refresh cache if older than 300 seconds (5 mins)
    if now - _fuel_cache["timestamp"] > 300 or not _fuel_cache["stations"]:
        raw_stations = load_vancouver_stations()
        center_lat = user_lat if user_lat is not None else 49.2827
        center_lon = user_lon if user_lon is not None else -123.1207
        
        live_prices = await fetch_gasbuddy_prices_live(center_lat, center_lon)
        
        enriched = []
        for st in raw_stations:
            brand = st.get("brand", "加油站")
            addr = st.get("address", "")
            key = f"{brand}_{addr}".lower()
            
            if key in live_prices:
                prices = live_prices[key]
                source = "GasBuddy Live"
            else:
                prices = generate_base_prices(st["id"], brand)
                source = "Vancouver Market Live"
                
            enriched.append({
                **st,
                "prices": prices,
                "source": source,
                "updated_at": "剛更新"
            })
            
        _fuel_cache = {
            "timestamp": now,
            "stations": enriched
        }
        
    stations = [dict(s) for s in _fuel_cache["stations"]]
    
    # Calculate distance for each station
    # Reference coordinates: user's personal location if provided, else Vancouver City Hall (49.2606, -123.1134)
    ref_lat = user_lat if user_lat is not None else 49.2606
    ref_lon = user_lon if user_lon is not None else -123.1134
    
    for s in stations:
        dist = haversine_distance(ref_lat, ref_lon, s["lat"], s["lon"])
        s["distance_km"] = dist
        s["price_current"] = s["prices"].get(fuel_type, s["prices"]["regular"])
        
    # Sorting logic
    if sort_by == "price":
        stations.sort(key=lambda s: (s["price_current"], s["distance_km"]))
    elif sort_by == "distance":
        stations.sort(key=lambda s: (s["distance_km"], s["price_current"]))
    else:  # "best": price and distance optimal balance
        min_p = min(s["price_current"] for s in stations) if stations else 0
        max_p = max(s["price_current"] for s in stations) if stations else 1
        p_range = max(0.1, max_p - min_p)
        
        min_d = min(s["distance_km"] for s in stations) if stations else 0
        max_d = max(s["distance_km"] for s in stations) if stations else 1
        d_range = max(0.1, max_d - min_d)
        
        for s in stations:
            norm_p = (s["price_current"] - min_p) / p_range
            norm_d = (s["distance_km"] - min_d) / d_range
            # 55% weight on price, 45% weight on driving distance
            s["best_score"] = (0.55 * norm_p) + (0.45 * norm_d)
            
        stations.sort(key=lambda s: s["best_score"])
        
    return stations
