"""
SkyTrain Real-time Simulation Engine & Schedule Estimator
Estimates SkyTrain fleet positions (Expo, Millennium, Canada Line)
based on TransLink published timetables, headways, and GTFS track geometry.
Provides real-time train positions, ETA countdowns, and station departure schedules.
"""

import json
import os
import math
import time
from datetime import datetime, timezone, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ_VAN = ZoneInfo("America/Vancouver")
except Exception:
    TZ_VAN = timezone(timedelta(hours=-7))

_skytrain_data = None
_station_maps_data = None

def get_station_maps_lookup():
    global _station_maps_data
    if _station_maps_data is not None:
        return _station_maps_data
    file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "SkytrainStationMap.json")
    lookup = {}
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
                for line, stations in raw.items():
                    for st_name, urls in stations.items():
                        norm = _normalize_station_name(st_name)
                        lookup[norm] = urls
        except Exception as e:
            print(f"Error loading SkytrainStationMap.json: {e}")
    _station_maps_data = lookup
    return _station_maps_data

def _normalize_station_name(name: str) -> str:
    s = (name or "").lower()
    s = s.replace("站", "").replace("station", "")
    for dash in ["\u2013", "\u2014", "-"]:
        s = s.replace(dash, " ")
    for quote in ["\u2019", "'"]:
        s = s.replace(quote, "")
    return " ".join(s.split()).strip()

def _find_station_maps(st_name: str, lines: list = None):
    lookup = get_station_maps_lookup()
    if not lookup:
        return None
    norm = _normalize_station_name(st_name)
    if norm in lookup:
        return lookup[norm]
    for k, v in lookup.items():
        if k and (k in norm or norm in k):
            return v
    return None

def get_skytrain_data():
    global _skytrain_data
    if _skytrain_data is not None:
        return _skytrain_data
    file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "skytrain_network.json")
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                _skytrain_data = json.load(f)
                return _skytrain_data
        except Exception as e:
            print(f"Error loading skytrain_network.json: {e}")
    return {"lines": {}, "patterns": [], "stations": {}}

def calculate_bearing(p1, p2):
    lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
    lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)

def _get_headways_for_time(now_van: datetime):
    """
    Returns (expo_branch_hw, mln_hw, can_branch_hw) in seconds
    based on TransLink standard operating schedule.
    """
    hour = now_van.hour + now_van.minute / 60.0
    weekday = now_van.weekday() < 5

    # Late night / early morning (01:15 - 05:00)
    if 1.25 <= hour < 5.0:
        return 900, 900, 900 # 15 min
    
    # Morning Peak (06:30 - 09:30 on weekdays)
    if weekday and (6.5 <= hour < 9.5):
        return 300, 210, 360 # Expo branches 5m, Millennium 3.5m, Canada branches 6m
    
    # Evening Peak (15:00 - 18:30 on weekdays)
    if weekday and (15.0 <= hour < 18.5):
        return 300, 210, 360
    
    # Midday / Weekend (09:30 - 15:00 or 06:00 - 19:00 weekends)
    if (5.0 <= hour < 21.0):
        return 360, 300, 420 # Expo branches 6m, Millennium 5m, Canada branches 7m
    
    # Evening / Night (21:00 - 01:15)
    return 540, 480, 600 # Expo branches 9m, Millennium 8m, Canada branches 10m

# Train Models by Line
FLEET_MODELS = {
    'expo': [
        {'name': 'Bombardier Innovia ART 200 (Mark II)', 'cars': 4, 'speed_max': 80},
        {'name': 'Bombardier Innovia ART 300 (Mark III)', 'cars': 4, 'speed_max': 80},
        {'name': 'Alstom Mark V', 'cars': 5, 'speed_max': 80},
    ],
    'millennium': [
        {'name': 'Bombardier Innovia ART 300 (Mark III)', 'cars': 4, 'speed_max': 80},
        {'name': 'Bombardier Innovia ART 200 (Mark II)', 'cars': 4, 'speed_max': 80},
    ],
    'canada': [
        {'name': 'Hyundai Rotem EMU', 'cars': 2, 'speed_max': 80},
    ]
}

def _find_closest_shape_index(shape, lat, lon):
    """Find the index in shape closest to (lat, lon)."""
    min_dist = float('inf')
    best_idx = 0
    for i, pt in enumerate(shape):
        d = (pt[0] - lon) ** 2 + (pt[1] - lat) ** 2
        if d < min_dist:
            min_dist = d
            best_idx = i
    return best_idx

def _interpolate_along_slice(slice_coords, fraction):
    """Interpolate along a slice of [lon, lat] coordinates."""
    if not slice_coords:
        return 0.0, 0.0, 0.0
    if len(slice_coords) == 1 or fraction <= 0.0:
        b = 0.0
        if len(slice_coords) >= 2:
            b = calculate_bearing(slice_coords[0], slice_coords[1])
        return slice_coords[0][0], slice_coords[0][1], b
    if fraction >= 1.0:
        b = 0.0
        if len(slice_coords) >= 2:
            b = calculate_bearing(slice_coords[-2], slice_coords[-1])
        return slice_coords[-1][0], slice_coords[-1][1], b

    # Metric arc length
    seg_lens = []
    total_len = 0.0
    for i in range(len(slice_coords) - 1):
        x1, y1 = slice_coords[i]
        x2, y2 = slice_coords[i + 1]
        d = math.hypot((x2 - x1) * 0.656, y2 - y1)
        seg_lens.append(d)
        total_len += d

    if total_len <= 1e-9:
        return slice_coords[0][0], slice_coords[0][1], 0.0

    target = fraction * total_len
    accum = 0.0
    for i, seg_len in enumerate(seg_lens):
        if accum + seg_len >= target or i == len(seg_lens) - 1:
            local_t = (target - accum) / seg_len if seg_len > 1e-9 else 0.0
            local_t = max(0.0, min(1.0, local_t))
            p1 = slice_coords[i]
            p2 = slice_coords[i + 1]
            lon = p1[0] + (p2[0] - p1[0]) * local_t
            lat = p1[1] + (p2[1] - p1[1]) * local_t
            bearing = calculate_bearing(p1, p2)
            return lon, lat, bearing
        accum += seg_len

    return slice_coords[-1][0], slice_coords[-1][1], 0.0

# Cache shape indices for stations in patterns
_pattern_shape_indices = {}

def _get_station_shape_indices(pattern):
    pid = pattern['pattern_id']
    if pid in _pattern_shape_indices:
        return _pattern_shape_indices[pid]
    shape = pattern['shape']
    indices = []
    for st in pattern['stations']:
        idx = _find_closest_shape_index(shape, st['lat'], st['lon'])
        indices.append(idx)
    _pattern_shape_indices[pid] = indices
    return indices

def get_estimated_skytrain_trains():
    """
    Returns real-time list of all estimated SkyTrain trains currently active across
    Expo, Millennium, and Canada Lines.
    """
    data = get_skytrain_data()
    patterns = data.get('patterns', [])
    if not patterns:
        return []

    now_van = datetime.now(TZ_VAN)
    # Total elapsed seconds today
    now_sec = now_van.hour * 3600 + now_van.minute * 60 + now_van.second + now_van.microsecond / 1e6
    hw_expo, hw_mln, hw_can = _get_headways_for_time(now_van)

    PATTERN_SCHEDULE_CONFIG = {
        'expo_kg_outbound': {'prefix': 'EXP', 'start_id': 101, 'phase_ratio': 0.0},
        'expo_pwu_outbound': {'prefix': 'EXP', 'start_id': 201, 'phase_ratio': 0.5},
        'expo_kg_inbound': {'prefix': 'EXP', 'start_id': 151, 'phase_ratio': 0.25},
        'expo_pwu_inbound': {'prefix': 'EXP', 'start_id': 251, 'phase_ratio': 0.75},
        'millennium_east': {'prefix': 'MLN', 'start_id': 301, 'phase_ratio': 0.0},
        'millennium_west': {'prefix': 'MLN', 'start_id': 351, 'phase_ratio': 0.5},
        'canada_rb_outbound': {'prefix': 'CAN', 'start_id': 401, 'phase_ratio': 0.0},
        'canada_yvr_outbound': {'prefix': 'CAN', 'start_id': 421, 'phase_ratio': 0.5},
        'canada_rb_inbound': {'prefix': 'CAN', 'start_id': 451, 'phase_ratio': 0.25},
        'canada_yvr_inbound': {'prefix': 'CAN', 'start_id': 471, 'phase_ratio': 0.75},
    }

    trains = []

    for pattern in patterns:
        pid = pattern['pattern_id']
        line_id = pattern['line_id']
        headway = hw_expo if line_id == 'expo' else (hw_mln if line_id == 'millennium' else hw_can)
        duration = pattern['duration_sec']
        if duration <= 0 or headway <= 0:
            continue

        num_trains = max(1, math.ceil(duration / headway))
        stations = pattern['stations']
        shape = pattern['shape']
        shape_indices = _get_station_shape_indices(pattern)
        models = FLEET_MODELS.get(line_id, FLEET_MODELS['expo'])

        cfg = PATTERN_SCHEDULE_CONFIG.get(pid, {
            'prefix': 'EXP' if line_id == 'expo' else ('MLN' if line_id == 'millennium' else 'CAN'),
            'start_id': 501,
            'phase_ratio': 0.0
        })

        branch_offset = cfg['phase_ratio'] * headway

        for k in range(num_trains):
            # Interleaved phase offset for each train on its branch and trunk
            train_phase = (k * headway + branch_offset) % duration
            elapsed = (now_sec + train_phase) % duration

            # Find bounding stations
            curr_st_idx = 0
            for i in range(len(stations) - 1):
                if stations[i]['time_sec'] <= elapsed < stations[i + 1]['time_sec']:
                    curr_st_idx = i
                    break
            else:
                curr_st_idx = len(stations) - 1

            st_curr = stations[curr_st_idx]
            st_next = stations[min(curr_st_idx + 1, len(stations) - 1)]

            seg_duration = max(1.0, float(st_next['time_sec'] - st_curr['time_sec']))
            seg_elapsed = max(0.0, float(elapsed - st_curr['time_sec']))
            # SkyTrain dwell time at stations is typically ~20-25 seconds (terminal ~35s)
            dwell_time = min(25.0, seg_duration * 0.3) if curr_st_idx > 0 else min(35.0, seg_duration * 0.35)
            is_dwelling = (seg_elapsed < dwell_time) and (curr_st_idx < len(stations) - 1)

            if is_dwelling:
                # 停靠月台期間：位置嚴格鎖定於本站月台中心點，靜止不動
                seg_fraction = 0.0
            else:
                # 出發開出後：於剩餘區間行車時間內行駛至下一站
                travel_duration = max(1.0, seg_duration - dwell_time)
                travel_elapsed = seg_elapsed - dwell_time
                seg_fraction = max(0.0, min(1.0, travel_elapsed / travel_duration))

            # Interpolate position
            idx_start = shape_indices[curr_st_idx]
            idx_end = shape_indices[min(curr_st_idx + 1, len(stations) - 1)]

            if idx_end >= idx_start:
                sub_slice = shape[idx_start:idx_end + 1]
            else:
                sub_slice = shape[idx_start:] + shape[:idx_end + 1]

            if not sub_slice:
                sub_slice = [[st_curr['lon'], st_curr['lat']], [st_next['lon'], st_next['lat']]]

            lon, lat, bearing = _interpolate_along_slice(sub_slice, seg_fraction)

            # ETA calculations
            rem_to_next = max(0, int(st_next['time_sec'] - elapsed))
            rem_min = int(math.ceil(rem_to_next / 60.0))

            next_eta_dt = now_van + timedelta(seconds=rem_to_next)
            eta_time_str = next_eta_dt.strftime("%H:%M")

            # Strictly unique Vehicle ID (e.g. CAN-401, CAN-421, EXP-101, MLN-301)
            train_id = f"{cfg['prefix']}-{cfg['start_id'] + k:03d}"

            # Train model assignment
            model_info = models[k % len(models)]

            speed = 0 if is_dwelling else int(52 + (math.sin(elapsed / 15.0) * 15))
            status_text = f"停靠中 ({st_curr['name']})" if is_dwelling else "行駛中"

            # Enrich station stop list with ETA for this train
            stops_with_eta = []
            for s_idx, s in enumerate(stations):
                if s_idx < curr_st_idx:
                    s_status = 'passed'
                    s_eta_min = None
                    s_eta_str = None
                elif s_idx == curr_st_idx:
                    s_status = 'next' if is_dwelling else 'passed'
                    s_eta_min = 0 if is_dwelling else None
                    s_eta_str = "現在" if is_dwelling else None
                elif s_idx == curr_st_idx + 1:
                    s_status = 'next'
                    s_eta_min = rem_min
                    s_eta_str = eta_time_str
                else:
                    s_status = 'upcoming'
                    diff_sec = max(0, int(s['time_sec'] - elapsed))
                    s_eta_min = int(math.ceil(diff_sec / 60.0))
                    s_dt = now_van + timedelta(seconds=diff_sec)
                    s_eta_str = s_dt.strftime("%H:%M")

                stops_with_eta.append({
                    'seq': s['seq'],
                    'stop_id': s['stop_id'],
                    'name': s['name'],
                    'lat': s['lat'],
                    'lon': s['lon'],
                    'status': s_status,
                    'eta_minutes': s_eta_min,
                    'eta_time': s_eta_str
                })

            trains.append({
                'id': train_id,
                'line_id': line_id,
                'line_name': pattern['line_name'],
                'color': pattern['color'],
                'headsign': pattern['headsign'],
                'origin': pattern['origin'],
                'destination': pattern['destination'],
                'direction': pattern['direction'],
                'lat': round(lat, 6),
                'lon': round(lon, 6),
                'bearing': bearing,
                'status': status_text,
                'is_dwelling': is_dwelling,
                'speed_kmh': speed,
                'model': model_info['name'],
                'cars': model_info['cars'],
                'current_station': st_curr['name'],
                'next_station': st_next['name'],
                'next_stop_minutes': rem_min if not is_dwelling else 0,
                'next_stop_time': eta_time_str if not is_dwelling else now_van.strftime("%H:%M"),
                'operator': pattern.get('operator') or ('TransLink (ProTrans BC)' if line_id == 'canada' else 'TransLink (BC Rapid Transit Company)'),
                'pattern_id': pattern['pattern_id'],
                'stops': stops_with_eta,
                'shape_coords': shape
            })
    # Proximity filter: Ensure no two trains on the same line traveling in the same direction are within ~300m
    deduped_trains = []
    for t in trains:
        collision = False
        for existing in deduped_trains:
            if existing['line_id'] == t['line_id'] and existing['direction'] == t['direction']:
                # Distance squared in approximate degrees (~1 deg lat ~ 111km, 0.0025 deg ~ 250m)
                d_sq = (existing['lat'] - t['lat']) ** 2 + ((existing['lon'] - t['lon']) * 0.65) ** 2
                if d_sq < 0.000008:  # within ~300 meters
                    collision = True
                    break
        if not collision:
            deduped_trains.append(t)

    return deduped_trains


def get_skytrain_station_schedule(stop_id: str):
    """
    Returns upcoming departures and line connections for a given SkyTrain station stop_id.
    """
    data = get_skytrain_data()
    stations_dict = data.get('stations', {})
    patterns = data.get('patterns', [])
    
    st_info = stations_dict.get(str(stop_id))
    if not st_info:
        # Fallback search by string match
        for s in stations_dict.values():
            if str(s.get('stop_id')) == str(stop_id) or stop_id in s.get('name', ''):
                st_info = s
                break

    if not st_info:
        return {'error': 'Station not found'}

    now_van = datetime.now(TZ_VAN)
    now_sec = now_van.hour * 3600 + now_van.minute * 60 + now_van.second
    hw_expo, hw_mln, hw_can = _get_headways_for_time(now_van)

    # 取得當前即時推算的所有列車資料
    active_trains = get_estimated_skytrain_trains()
    target_name = st_info.get('name', '').strip()
    target_stop_id = str(st_info.get('stop_id', ''))

    # 找出實際停靠且從本站出發（非終點下客）的所有合法路線與方向
    departures_by_dest = {}
    valid_patterns = []
    for pattern in patterns:
        p_stations = pattern.get('stations', [])
        for idx, s in enumerate(p_stations):
            s_name = s.get('name', '').strip()
            s_id = str(s.get('stop_id', ''))
            if s_id == target_stop_id or s_name == target_name:
                # 只有非終點站（後續仍有站點可前往 destination）才具有從本站出發的班次
                if idx < len(p_stations) - 1:
                    valid_patterns.append(pattern)
                    dest_name = pattern.get('destination', '')
                    line_name = pattern.get('line_name', '')
                    key = f"{line_name} · 往 {dest_name}"
                    if key not in departures_by_dest:
                        departures_by_dest[key] = {
                            'line_name': line_name,
                            'color': pattern.get('color', '#0033a0'),
                            'destination': dest_name,
                            'direction': pattern.get('direction', ''),
                            'line_id': pattern.get('line_id', 'expo'),
                            'departures': []
                        }
                break

    # 1. 先從當前地圖上行駛中且符合本站路線方向的推算列車提取預計抵達班次
    for train in active_trains:
        dest_name = train.get('destination', '')
        line_name = train.get('line_name', '')
        key = f"{line_name} · 往 {dest_name}"

        # 嚴格過濾：僅處理屬於本站停靠之合法路線與方向
        if key not in departures_by_dest:
            continue

        # 檢查該車是否停靠或即將停靠本站
        stops = train.get('stops', [])
        for s in stops:
            s_name = s.get('name', '').strip()
            s_id = str(s.get('stop_id', ''))
            if s_id == target_stop_id or s_name == target_name:
                s_status = s.get('status')
                if s_status in ('next', 'upcoming') or (s_status == 'passed' and train.get('is_dwelling') and train.get('current_station') == target_name):
                    eta_min = s.get('eta_minutes')
                    if eta_min is None:
                        eta_min = 0 if train.get('is_dwelling') else 1

                    eta_time = s.get('eta_time')
                    if not eta_time:
                        dt = now_van + timedelta(minutes=eta_min)
                        eta_time = dt.strftime("%H:%M")

                    departures_by_dest[key]['departures'].append({
                        'minutes': max(0, int(eta_min)),
                        'time': eta_time,
                        'formatted': '即將進站' if eta_min <= 0 else f"{eta_min} 分鐘"
                    })
                break

    # 2. 若某些方向缺乏在途列車或班次不足 4 班，依照路線表定班距向後推算補齊
    for key, group in departures_by_dest.items():
        line_id = group['line_id']
        headway = hw_expo if line_id == 'expo' else (hw_mln if line_id == 'millennium' else hw_can)
        hw_min = max(2, int(round(headway / 60.0)))

        # 排序現有班次
        group['departures'].sort(key=lambda d: d['minutes'])

        # 去重：若兩班次間隔小於 2 分鐘（同目的地），僅保留第一班
        cleaned = []
        for dep in group['departures']:
            if not cleaned or (dep['minutes'] - cleaned[-1]['minutes'] >= 2):
                cleaned.append(dep)
        group['departures'] = cleaned

        # 補齊至 4 班
        while len(group['departures']) < 4:
            if not group['departures']:
                base_min = 2
            else:
                base_min = group['departures'][-1]['minutes'] + hw_min
            dt = now_van + timedelta(minutes=base_min)
            group['departures'].append({
                'minutes': base_min,
                'time': dt.strftime("%H:%M"),
                'formatted': f"{base_min} 分鐘"
            })

        group['departures'] = group['departures'][:4]

    station_name = st_info.get('name') or ''
    # 精確取得屬於該車站的路線（非轉乘站 1 條，轉乘站 2 條）
    st_lines = list(dict.fromkeys([p['line_name'] for p in valid_patterns]))
    if not st_lines:
        st_lines = st_info.get('lines', [])
    meta = _get_station_metadata(station_name, st_lines, str(st_info.get('stop_id', '')))

    return {
        'stop_id': st_info.get('stop_id'),
        'name': station_name,
        'raw_name': st_info.get('raw_name'),
        'lat': st_info.get('lat'),
        'lon': st_info.get('lon'),
        'lines': st_lines,
        'schedules': list(departures_by_dest.values()),
        'first_last': meta.get('first_last', {}),
        'frequencies': meta.get('frequencies', {}),
        'station_map_url': meta.get('station_map_url'),
        'entrance_map_url': meta.get('entrance_map_url', 'https://www.translink.ca/schedules-and-maps/skytrain'),
        'fare_zone': meta.get('fare_zone', 'Zone 1'),
        'has_park_and_ride': meta.get('has_park_and_ride', False),
        'has_bike_parkade': meta.get('has_bike_parkade', False),
        'is_accessible': meta.get('is_accessible', True),
        'updated_at': now_van.strftime("%H:%M")
    }

def _get_station_metadata(st_name: str, lines: list, stop_id: str):
    name_clean = st_name.replace(" Station", "").strip()
    lower = name_clean.lower()

    # 1. Fare Zone determination
    zone3_keywords = ["king george", "surrey", "gateway", "scott road", "coquitlam", "lafarge", "lincoln", "inlet", "moody", "burquitlam"]
    zone2_keywords = ["patterson", "metrotown", "royal oak", "edmonds", "22nd street", "new westminster", "columbia", "sapperton", "braid", "lougheed", "production way", "lake city", "sperling", "holdom", "brentwood", "gilmore", "bridgeport", "aberdeen", "lansdowne", "richmond-brighouse", "templeton", "sea island", "yvr-airport"]

    if any(k in lower for k in zone3_keywords):
        zone_label = "Zone 3"
    elif any(k in lower for k in zone2_keywords):
        zone_label = "Zone 2"
    else:
        zone_label = "Zone 1"

    # 2. Park & Ride
    park_and_ride_stations = ["bridgeport", "scott road", "coquitlam central", "lafarge lake-douglas", "moody centre", "inlet centre", "south burnaby", "pitt meadows"]
    has_park_and_ride = any(k in lower for k in park_and_ride_stations)

    # 3. Bike Parkade (室內安全單車停放庫)
    bike_parkade_stations = ["main street-science world", "commercial-broadway", "joyce-collingwood", "metrotown", "bridgeport", "king george", "burquitlam", "coquitlam central", "lafarge lake-douglas", "port moody", "moody centre"]
    has_bike_parkade = any(k in lower for k in bike_parkade_stations)

    # 4. First and Last Trains schedule estimate (TransLink standard timetable)
    is_canada_line = any("Canada" in l for l in lines) or any(k in lower for k in ["yvr", "richmond", "bridgeport", "oakridge", "langara", "broadway-city hall", "olympic village", "yaletown", "vancouver city centre", "marine drive"])

    if is_canada_line:
        first_last = {
            "weekday": {
                "first_train": "04:48 (往 YVR 機場) / 05:02 (往列治文)",
                "last_train": "01:05 (往 Waterfront) / 01:15"
            },
            "saturday": {
                "first_train": "05:05 (往 YVR 機場) / 05:32",
                "last_train": "01:05 (往 Waterfront) / 01:15"
            },
            "sunday_holiday": {
                "first_train": "05:05 (往 YVR 機場) / 05:32",
                "last_train": "00:05 (往 Waterfront) / 00:15"
            }
        }
        frequencies = {
            "peak": "每 3 - 3.5 分鐘 (分支每 6 分鐘)",
            "midday": "每 5 - 6 分鐘 (分支每 10 - 12 分鐘)",
            "evening": "每 7.5 - 10 分鐘 (分支每 15 分鐘)",
            "late_night": "每 12 - 20 分鐘"
        }
    elif any("Millennium" in l for l in lines) and not any("Expo" in l for l in lines):
        first_last = {
            "weekday": {
                "first_train": "05:05 (往 VCC-Clark) / 05:30 (往高貴林)",
                "last_train": "01:22 (往 Lafarge Lake) / 00:59"
            },
            "saturday": {
                "first_train": "06:05 (往 VCC-Clark) / 06:30",
                "last_train": "01:22 (往 Lafarge Lake) / 00:59"
            },
            "sunday_holiday": {
                "first_train": "07:05 (往 VCC-Clark) / 07:30",
                "last_train": "00:22 (往 Lafarge Lake) / 23:59"
            }
        }
        frequencies = {
            "peak": "每 3 - 4 分鐘",
            "midday": "每 5 - 6 分鐘",
            "evening": "每 6 - 8 分鐘",
            "late_night": "每 10 - 12 分鐘"
        }
    else:
        first_last = {
            "weekday": {
                "first_train": "05:32 (Waterfront 往素里) / 05:38 (往喬治王)",
                "last_train": "01:16 (往喬治王) / 01:11 (往本拿比)"
            },
            "saturday": {
                "first_train": "06:48 (往素里) / 06:38",
                "last_train": "01:16 (往喬治王) / 01:11"
            },
            "sunday_holiday": {
                "first_train": "07:48 (往素里) / 07:38",
                "last_train": "00:16 (往喬治王) / 00:11"
            }
        }
        frequencies = {
            "peak": "每 2 - 3 分鐘 (兩大分支每 4 - 5 分鐘)",
            "midday": "每 3 - 5 分鐘 (分支每 6 - 8 分鐘)",
            "evening": "每 6 - 8 分鐘",
            "late_night": "每 10 - 15 分鐘"
        }

    maps = _find_station_maps(st_name, lines)
    station_map_url = (maps.get('Station') if maps else None) or 'https://www.translink.ca/schedules-and-maps/skytrain'
    entrance_map_url = (maps.get('Entrance') if maps else None) or station_map_url

    return {
        "fare_zone": zone_label,
        "first_last": first_last,
        "frequencies": frequencies,
        "station_map_url": station_map_url,
        "entrance_map_url": entrance_map_url,
        "has_park_and_ride": has_park_and_ride,
        "has_bike_parkade": has_bike_parkade,
        "is_accessible": True
    }
