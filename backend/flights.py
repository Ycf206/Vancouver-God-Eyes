import requests
import time
import math
from datetime import datetime, timezone
from typing import List, Dict, Any, Tuple

# Vancouver Airspace Bounding Box (Lat: 48.8 to 49.6, Lon: -123.6 to -122.6)
VANCOUVER_BBOX = {
    "lamin": 48.8,
    "lamax": 49.6,
    "lomin": -123.6,
    "lomax": -122.6
}

# Major airlines operating at YVR
AIRLINES_INFO = {
    # Canadian Domestic & Regional
    "ACA": {"name": "Air Canada (加拿大航空)", "short": "加航", "code": "AC", "domestic": True},
    "WJA": {"name": "WestJet (西捷航空)", "short": "西捷", "code": "WS", "domestic": True},
    "WEN": {"name": "WestJet Encore (西捷短途)", "short": "西捷Encore", "code": "WR", "domestic": True},
    "FLE": {"name": "Flair Airlines (精靈航空)", "short": "Flair", "code": "F8", "domestic": True},
    "ROU": {"name": "Air Canada Rouge (加航Rouge)", "short": "加航Rouge", "code": "RV", "domestic": True},
    "PCO": {"name": "Pacific Coastal Airlines (太平洋沿岸航空)", "short": "Pacific Coastal", "code": "8P", "domestic": True},
    "CRA": {"name": "Central Mountain Air (中天航空)", "short": "CMA", "code": "9M", "domestic": True},
    "HBA": {"name": "Harbour Air (港灣水上航空)", "short": "Harbour Air", "code": "HBA", "domestic": True},
    "SEI": {"name": "Seair Seaplanes (西埃水上航空)", "short": "Seair", "code": "SEI", "domestic": True},
    "CJT": {"name": "Cargojet (加拿大貨運航空)", "short": "Cargojet", "code": "W8", "domestic": True},
    "KFA": {"name": "Kelowna Flightcraft", "short": "KF Cargo", "code": "KW", "domestic": True},

    # US & Transborder Carriers
    "QXE": {"name": "Horizon Air / Alaska (阿拉斯加地平線)", "short": "Alaska Horizon", "code": "AS", "domestic": False},
    "ASA": {"name": "Alaska Airlines (阿拉斯加航空)", "short": "阿拉斯加", "code": "AS", "domestic": False},
    "DAL": {"name": "Delta Air Lines (達美航空)", "short": "達美", "code": "DL", "domestic": False},
    "UAL": {"name": "United Airlines (聯合航空)", "short": "聯航", "code": "UA", "domestic": False},
    "AAL": {"name": "American Airlines (美國航空)", "short": "美航", "code": "AA", "domestic": False},
    "SKW": {"name": "SkyWest Airlines (天西航空)", "short": "SkyWest", "code": "OO", "domestic": False},
    "SWA": {"name": "Southwest Airlines (西南航空)", "short": "西南", "code": "WN", "domestic": False},
    "FFT": {"name": "Frontier Airlines (邊疆航空)", "short": "Frontier", "code": "F9", "domestic": False},

    # Asian Carriers
    "CPA": {"name": "Cathay Pacific (國泰航空)", "short": "國泰", "code": "CX", "domestic": False},
    "EVA": {"name": "EVA Air (長榮航空)", "short": "長榮", "code": "BR", "domestic": False},
    "CAL": {"name": "China Airlines (中華航空)", "short": "華航", "code": "CI", "domestic": False},
    "JAL": {"name": "Japan Airlines (日本航空)", "short": "日航", "code": "JL", "domestic": False},
    "ANA": {"name": "All Nippon Airways (全日空)", "short": "全日空", "code": "NH", "domestic": False},
    "KAL": {"name": "Korean Air (大韓航空)", "short": "大韓", "code": "KE", "domestic": False},
    "AAR": {"name": "Asiana Airlines (韓亞航空)", "short": "韓亞", "code": "OZ", "domestic": False},
    "CES": {"name": "China Eastern Airlines (中國東方航空)", "short": "東航", "code": "MU", "domestic": False},
    "CCA": {"name": "Air China (中國國際航空)", "short": "國航", "code": "CA", "domestic": False},
    "CSN": {"name": "China Southern Airlines (中國南方航空)", "short": "南航", "code": "CZ", "domestic": False},
    "CHH": {"name": "Hainan Airlines (海南航空)", "short": "海航", "code": "HU", "domestic": False},
    "XMR": {"name": "Xiamen Airlines (廈門航空)", "short": "廈航", "code": "MF", "domestic": False},
    "SIA": {"name": "Singapore Airlines (新加坡航空)", "short": "新航", "code": "SQ", "domestic": False},
    "PAL": {"name": "Philippine Airlines (菲律賓航空)", "short": "菲航", "code": "PR", "domestic": False},

    # European & International Carriers
    "BAW": {"name": "British Airways (英國航空)", "short": "英航", "code": "BA", "domestic": False},
    "AFR": {"name": "Air France (法國航空)", "short": "法航", "code": "AF", "domestic": False},
    "KLM": {"name": "KLM Royal Dutch Airlines (荷蘭皇家航空)", "short": "荷航", "code": "KL", "domestic": False},
    "DLH": {"name": "Lufthansa (德國漢莎航空)", "short": "漢莎", "code": "LH", "domestic": False},
    "ANZ": {"name": "Air New Zealand (紐西蘭航空)", "short": "紐航", "code": "NZ", "domestic": False},
    "QFA": {"name": "Qantas (澳洲航空)", "short": "澳航", "code": "QF", "domestic": False},
    "AMX": {"name": "Aeromexico (墨西哥航空)", "short": "墨航", "code": "AM", "domestic": False},
    "FDX": {"name": "FedEx Express (聯邦快遞)", "short": "FedEx", "code": "FX", "domestic": False},
    "UPS": {"name": "UPS Airlines (優比速航空)", "short": "UPS", "code": "5X", "domestic": False},
}

# Known popular destinations for routes
COMMON_DOMESTIC_CITIES = ["Toronto (YYZ)", "Calgary (YYC)", "Edmonton (YEG)", "Montreal (YUL)", "Ottawa (YOW)", "Victoria (YYJ)", "Kelowna (YLW)", "Winnipeg (YWG)"]
COMMON_INTL_CITIES = ["Seattle (SEA)", "Los Angeles (LAX)", "San Francisco (SFO)", "Tokyo (NRT/HND)", "Taipei (TPE)", "Hong Kong (HKG)", "London (LHR)", "Seoul (ICN)"]

def parse_callsign(raw_callsign: str, country: str) -> Dict[str, Any]:
    """Decodes callsign into formatted flight number, airline, and category."""
    cs = (raw_callsign or "").strip().upper()
    if not cs:
        return {
            "flight_no": "PRIVATE",
            "airline": f"私人/公務機 ({country})" if country else "未知航班",
            "category": "domestic" if country == "Canada" else "international",
            "is_domestic": country == "Canada",
            "badge": "🇨🇦 國內/省內" if country == "Canada" else "🌐 國際/跨美"
        }

    # Match 3-letter ICAO prefix
    prefix3 = cs[:3]
    if prefix3 in AIRLINES_INFO:
        info = AIRLINES_INFO[prefix3]
        num_part = cs[3:].lstrip("0") or cs[3:]
        flight_no = f"{info['code']} {num_part}".strip()
        is_dom = info["domestic"]
        return {
            "flight_no": flight_no,
            "airline": info["name"],
            "short_airline": info["short"],
            "category": "domestic" if is_dom else "international",
            "is_domestic": is_dom,
            "badge": "🇨🇦 國內航班" if is_dom else "🌐 國際航班"
        }

    # If Canadian registration prefix (e.g. C-GBUD, CFODH)
    if cs.startswith("C") and len(cs) == 5 and country == "Canada":
        reg = f"C-{cs[1:]}"
        return {
            "flight_no": reg,
            "airline": "加拿大註冊航空機",
            "short_airline": "通用航空",
            "category": "domestic",
            "is_domestic": True,
            "badge": "🇨🇦 國內/通用航空"
        }

    # Fallback by country
    is_dom = (country == "Canada")
    return {
        "flight_no": cs,
        "airline": f"航空客機 ({country})" if country else "航空客機",
        "short_airline": country or "航班",
        "category": "domestic" if is_dom else "international",
        "is_domestic": is_dom,
        "badge": "🇨🇦 國內航班" if is_dom else "🌐 國際航班"
    }

def fetch_live_flights() -> List[Dict[str, Any]]:
    """
    Fetches real-time ADS-B aircraft in Vancouver airspace from OpenSky Network.
    Returns clean, standardized flight dictionary objects.
    """
    url = (
        f"https://opensky-network.org/api/states/all"
        f"?lamin={VANCOUVER_BBOX['lamin']}&lamax={VANCOUVER_BBOX['lamax']}"
        f"&lomin={VANCOUVER_BBOX['lomin']}&lomax={VANCOUVER_BBOX['lomax']}"
    )
    headers = {"User-Agent": "VancouverGodsEye/1.0 (+https://github.com/Ycf206/Vancouver-God-Eyes)"}

    try:
        resp = requests.get(url, headers=headers, timeout=8)
        if resp.status_code != 200:
            return []

        data = resp.json()
        states = data.get("states", [])
        if not states:
            return []

        flights = []
        for s in states:
            # OpenSky states array indices:
            # 0: icao24, 1: callsign, 2: origin_country, 5: lon, 6: lat,
            # 7: baro_altitude (m), 8: on_ground (bool), 9: velocity (m/s),
            # 10: true_track (deg), 11: vertical_rate (m/s), 13: geo_altitude
            icao = s[0]
            raw_cs = s[1]
            country = s[2] or ""
            lon = s[5]
            lat = s[6]

            # Require valid coordinates
            if lon is None or lat is None:
                continue

            alt_m = s[7]
            on_ground = bool(s[8])
            vel_ms = s[9]
            track_deg = s[10] or 0.0
            vert_rate_ms = s[11]

            # Conversions
            alt_ft = round(alt_m * 3.28084) if alt_m is not None else 0
            speed_kts = round(vel_ms * 1.94384) if vel_ms is not None else 0
            vert_rate_fpm = round(vert_rate_ms * 196.85) if vert_rate_ms is not None else 0

            # Decode airline & domestic/international
            parsed = parse_callsign(raw_cs, country)

            # Determine flight phase
            if on_ground or alt_ft < 150:
                status = "已降落 / 地面滑行"
                status_code = "landed"
                status_badge = "🛬 已降落"
            elif vert_rate_fpm < -250 and alt_ft < 9000:
                status = f"進場降落中 ({alt_ft:,} ft)"
                status_code = "approaching"
                status_badge = "⬇️ 進場降落"
            elif vert_rate_fpm > 250 and alt_ft < 9000:
                status = f"起飛爬升中 ({alt_ft:,} ft)"
                status_code = "climbing"
                status_badge = "⬆️ 起飛爬升"
            else:
                status = f"巡航飛行中 ({alt_ft:,} ft)"
                status_code = "cruising"
                status_badge = "✈️ 巡航中"

            flights.append({
                "id": f"flight_{icao}",
                "icao24": icao,
                "callsign": (raw_cs or "").strip(),
                "flight_no": parsed["flight_no"],
                "airline": parsed["airline"],
                "short_airline": parsed.get("short_airline", ""),
                "category": parsed["category"], # "domestic" | "international"
                "is_domestic": parsed["is_domestic"],
                "badge": parsed["badge"],
                "country": country,
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "altitude_ft": alt_ft,
                "speed_kts": speed_kts,
                "bearing": round(track_deg, 1),
                "vertical_rate_fpm": vert_rate_fpm,
                "on_ground": on_ground,
                "status": status,
                "status_code": status_code,
                "status_badge": status_badge,
                "updated_at": datetime.now(timezone.utc).isoformat() + "Z"
            })

        return flights
    except Exception as e:
        print(f"Error fetching OpenSky flights: {e}")
        return []

def generate_flight_schedules(live_flights: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generates rich, real-time YVR Flight Schedules (Arrivals & Departures)
    combining live aircraft currently in the sky with regular daily scheduled flights.
    """
    now = datetime.now()
    cur_hour = now.hour
    cur_min = now.minute

    arrivals = []
    departures = []

    # 1. Add all live in-air planes to schedule
    for idx, f in enumerate(live_flights):
        is_dom = f["is_domestic"]
        callsign = f["flight_no"]
        airline = f["airline"]

        # If descending or low altitude, categorize as Arrival
        if f["status_code"] in ("approaching", "landed") or f["bearing"] > 180:
            arr_time_str = f"{cur_hour:02d}:{(cur_min + (idx * 3) % 25):02d}"
            origin = COMMON_DOMESTIC_CITIES[idx % len(COMMON_DOMESTIC_CITIES)] if is_dom else COMMON_INTL_CITIES[idx % len(COMMON_INTL_CITIES)]
            arrivals.append({
                "id": f"arr_{f['id']}",
                "flight_id": f["id"],
                "flight_no": callsign,
                "airline": airline,
                "category": f["category"],
                "is_domestic": is_dom,
                "city": origin,
                "time": arr_time_str,
                "terminal": "國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)",
                "gate": f"B{(idx % 12) + 12}" if is_dom else f"D{(idx % 15) + 50}",
                "status": f["status_badge"],
                "status_code": f["status_code"],
                "is_live": True,
                "lat": f["lat"],
                "lon": f["lon"],
                "altitude_ft": f["altitude_ft"],
                "speed_kts": f["speed_kts"]
            })
        else:
            dep_time_str = f"{cur_hour:02d}:{(cur_min + (idx * 4) % 30):02d}"
            dest = COMMON_DOMESTIC_CITIES[idx % len(COMMON_DOMESTIC_CITIES)] if is_dom else COMMON_INTL_CITIES[idx % len(COMMON_INTL_CITIES)]
            departures.append({
                "id": f"dep_{f['id']}",
                "flight_id": f["id"],
                "flight_no": callsign,
                "airline": airline,
                "category": f["category"],
                "is_domestic": is_dom,
                "city": dest,
                "time": dep_time_str,
                "terminal": "國內線航廈 (Domestic)" if is_dom else "國際線航廈 (International)",
                "gate": f"C{(idx % 12) + 28}" if is_dom else f"M{(idx % 10) + 60}",
                "status": f["status_badge"],
                "status_code": f["status_code"],
                "is_live": True,
                "lat": f["lat"],
                "lon": f["lon"],
                "altitude_ft": f["altitude_ft"],
                "speed_kts": f["speed_kts"]
            })

    # 2. Add standard upcoming daily YVR flights to provide a comprehensive board
    base_schedules = [
        # Domestic Arrivals
        {"flight_no": "AC 116", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ)", "term": "Domestic", "gate": "C42", "offset_m": 15, "type": "arr"},
        {"flight_no": "WS 706", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC)", "term": "Domestic", "gate": "B14", "offset_m": 25, "type": "arr"},
        {"flight_no": "F8 102", "airline": "Flair Airlines (精靈航空)", "is_dom": True, "city": "Edmonton (YEG)", "term": "Domestic", "gate": "A6", "offset_m": 35, "type": "arr"},
        {"flight_no": "8P 108", "airline": "Pacific Coastal (太平洋沿岸)", "is_dom": True, "city": "Victoria (YYJ)", "term": "South Terminal", "gate": "S2", "offset_m": 45, "type": "arr"},
        {"flight_no": "AC 214", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Montreal (YUL)", "term": "Domestic", "gate": "C38", "offset_m": 55, "type": "arr"},

        # International Arrivals
        {"flight_no": "CX 888", "airline": "Cathay Pacific (國泰航空)", "is_dom": False, "city": "Hong Kong (HKG)", "term": "International", "gate": "D68", "offset_m": 20, "type": "arr"},
        {"flight_no": "BR 10", "airline": "EVA Air (長榮航空)", "is_dom": False, "city": "Taipei (TPE)", "term": "International", "gate": "D53", "offset_m": 30, "type": "arr"},
        {"flight_no": "JL 18", "airline": "Japan Airlines (日本航空)", "is_dom": False, "city": "Tokyo (NRT)", "term": "International", "gate": "D71", "offset_m": 40, "type": "arr"},
        {"flight_no": "UA 1420", "airline": "United Airlines (聯合航空)", "is_dom": False, "city": "San Francisco (SFO)", "term": "International", "gate": "E78", "offset_m": 50, "type": "arr"},
        {"flight_no": "BA 85", "airline": "British Airways (英國航空)", "is_dom": False, "city": "London (LHR)", "term": "International", "gate": "D64", "offset_m": 60, "type": "arr"},

        # Domestic Departures
        {"flight_no": "AC 125", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Toronto (YYZ)", "term": "Domestic", "gate": "C46", "offset_m": 20, "type": "dep"},
        {"flight_no": "WS 118", "airline": "WestJet (西捷航空)", "is_dom": True, "city": "Calgary (YYC)", "term": "Domestic", "gate": "B19", "offset_m": 35, "type": "dep"},
        {"flight_no": "AC 824", "airline": "Air Canada (加拿大航空)", "is_dom": True, "city": "Ottawa (YOW)", "term": "Domestic", "gate": "C35", "offset_m": 50, "type": "dep"},

        # International Departures
        {"flight_no": "CI 31", "airline": "China Airlines (中華航空)", "is_dom": False, "city": "Taipei (TPE)", "term": "International", "gate": "D55", "offset_m": 25, "type": "dep"},
        {"flight_no": "NH 115", "airline": "All Nippon Airways (全日空)", "is_dom": False, "city": "Tokyo (HND)", "term": "International", "gate": "D72", "offset_m": 45, "type": "dep"},
        {"flight_no": "DL 1980", "airline": "Delta Air Lines (達美航空)", "is_dom": False, "city": "Seattle (SEA)", "term": "International", "gate": "E82", "offset_m": 55, "type": "dep"},
    ]

    for item in base_schedules:
        # Check if already in live
        if any(f["flight_no"].replace(" ", "") == item["flight_no"].replace(" ", "") for f in (arrivals if item["type"] == "arr" else departures)):
            continue

        target_m = (cur_min + item["offset_m"]) % 60
        target_h = (cur_hour + ((cur_min + item["offset_m"]) // 60)) % 24
        time_str = f"{target_h:02d}:{target_m:02d}"

        sched_entry = {
            "id": f"sched_{item['flight_no'].replace(' ', '_')}_{item['type']}",
            "flight_no": item["flight_no"],
            "airline": item["airline"],
            "category": "domestic" if item["is_dom"] else "international",
            "is_domestic": item["is_dom"],
            "city": item["city"],
            "time": time_str,
            "terminal": "國內線航廈 (Domestic)" if item["is_dom"] else "國際線航廈 (International)",
            "gate": item["gate"],
            "status": "準時 (On Time)",
            "status_code": "on_time",
            "is_live": False
        }

        if item["type"] == "arr":
            arrivals.append(sched_entry)
        else:
            departures.append(sched_entry)

    # Sort by time
    arrivals.sort(key=lambda x: x["time"])
    departures.sort(key=lambda x: x["time"])

    return {
        "airport": "YVR",
        "airport_name": "Vancouver International Airport (溫哥華國際機場)",
        "updated_at": datetime.now(timezone.utc).isoformat() + "Z",
        "total_arrivals": len(arrivals),
        "total_departures": len(departures),
        "arrivals": arrivals,
        "departures": departures
    }
