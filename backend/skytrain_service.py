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
        {'name': 'Alstom Mark V (次世代天車)', 'cars': 5, 'speed_max': 80},
    ],
    'millennium': [
        {'name': 'Bombardier Innovia ART 300 (Mark III)', 'cars': 4, 'speed_max': 80},
        {'name': 'Bombardier Innovia ART 200 (Mark II)', 'cars': 4, 'speed_max': 80},
    ],
    'canada': [
        {'name': 'Hyundai Rotem EMU (加拿大線電力動車組)', 'cars': 2, 'speed_max': 80},
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
            seg_elapsed = elapsed - st_curr['time_sec']
            seg_fraction = max(0.0, min(1.0, seg_elapsed / seg_duration))

            # SkyTrain dwell time at stations is typically ~20-25 seconds
            dwell_time = min(22.0, seg_duration * 0.25)
            is_dwelling = (seg_elapsed < dwell_time) and (curr_st_idx < len(stations) - 1)

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
            eta_time_str = next_eta_dt.strftime("%H:%M:%S")

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
                    s_eta_str = s_dt.strftime("%H:%M:%S")

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
                'next_stop_time': eta_time_str if not is_dwelling else now_van.strftime("%H:%M:%S"),
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

    departures_by_dest = {}

    # 1. 先從當前地圖上行駛中的真實推算列車提取該站預計抵達班次
    for train in active_trains:
        dest_name = train.get('destination', '')
        line_name = train.get('line_name', '')
        key = f"{line_name} · 往 {dest_name}"

        if key not in departures_by_dest:
            departures_by_dest[key] = {
                'line_name': line_name,
                'color': train.get('color', '#0033a0'),
                'destination': dest_name,
                'direction': train.get('direction', ''),
                'line_id': train.get('line_id', 'expo'),
                'departures': []
            }

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
                        eta_time = dt.strftime("%H:%M:%S")

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
                'time': dt.strftime("%H:%M:%S"),
                'formatted': f"{base_min} 分鐘"
            })

        group['departures'] = group['departures'][:4]

    return {
        'stop_id': st_info.get('stop_id'),
        'name': st_info.get('name'),
        'raw_name': st_info.get('raw_name'),
        'lat': st_info.get('lat'),
        'lon': st_info.get('lon'),
        'lines': st_info.get('lines', []),
        'schedules': list(departures_by_dest.values()),
        'updated_at': now_van.strftime("%H:%M:%S")
    }
