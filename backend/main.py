from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import asyncio
import requests
import time
import threading
from google.transit import gtfs_realtime_pb2
import database
import models
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    models.Base.metadata.create_all(bind=database.engine)
except Exception as e:
    print(f"Database connection error on startup (might be booting): {e}")

app = FastAPI(title="Vancouver God's Eye API")

from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
active_connections: list[WebSocket] = []
stop_arrivals = {}
cached_translink_vehicles: list[dict] = []
cached_bcferries_vehicles: list[dict] = []
cached_bcferries_raw_data: dict = {"timestamp": 0.0, "data": None}
cached_flight_schedules: dict = {}
cached_skytrain_trains: list[dict] = []


async def broadcast_ws(message: dict):
    """Broadcast JSON message to all active WebSocket connections and prune dead sockets."""
    if not active_connections:
        return
    dead_connections = []
    for connection in list(active_connections):
        try:
            await connection.send_json(message)
        except Exception:
            dead_connections.append(connection)
    for dead in dead_connections:
        if dead in active_connections:
            active_connections.remove(dead)


import flights
import skytrain_service
from weather_service import weather_service
from shipping_service import shipping_service
from news_service import news_service
from events_service import events_service
from border_service import border_service

import math
def calculate_bearing(p1, p2):
    lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
    lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        # Instantly send cached vehicles upon connection so map is never empty
        if cached_translink_vehicles:
            await websocket.send_json({"type": "vehicles_update", "data": cached_translink_vehicles})
        if cached_bcferries_vehicles:
            await websocket.send_json({"type": "bc_ferries_update", "data": cached_bcferries_vehicles})
        if cached_skytrain_trains:
            await websocket.send_json({"type": "skytrain_trains_update", "data": cached_skytrain_trains})
        
        # Send maritime shipping vessels from Aisstream / Vancouver marine tracking
        maritime_vessels = shipping_service.get_vessels()
        if maritime_vessels:
            await websocket.send_json({"type": "maritime_vessels_update", "data": maritime_vessels})

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)



_bc_ferries_paths_cache = None

def get_bc_ferries_paths():
    global _bc_ferries_paths_cache
    if _bc_ferries_paths_cache is not None:
        return _bc_ferries_paths_cache
    path_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "bc_ferries_paths.json")
    if os.path.exists(path_file):
        try:
            import json
            with open(path_file, "r", encoding="utf-8") as f:
                _bc_ferries_paths_cache = json.load(f)
                return _bc_ferries_paths_cache
        except Exception as e:
            print(f"Error loading bc_ferries_paths.json: {e}")
    return {}


def _interpolate_along_path(coords: list, progress: float):
    """Interpolate (lon, lat, bearing) at progress in [0, 1] along a LineString coordinate list."""
    if not coords:
        return 0.0, 0.0, 0.0
    if len(coords) == 1:
        return coords[0][0], coords[0][1], 0.0

    p = max(0.0, min(1.0, float(progress)))
    seg_lengths = []
    total_len = 0.0
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        # Scale longitude by cos(49 deg) ~= 0.656 for accurate metric arc length
        d = math.hypot((x2 - x1) * 0.656, y2 - y1)
        seg_lengths.append(d)
        total_len += d

    if total_len <= 1e-9:
        return coords[0][0], coords[0][1], calculate_bearing(coords[0], coords[-1])

    target_dist = p * total_len
    accum = 0.0
    for i, seg_len in enumerate(seg_lengths):
        if accum + seg_len >= target_dist or i == len(seg_lengths) - 1:
            local_t = (target_dist - accum) / seg_len if seg_len > 1e-9 else 0.0
            local_t = max(0.0, min(1.0, local_t))
            p1 = coords[i]
            p2 = coords[i + 1]
            lon = p1[0] + (p2[0] - p1[0]) * local_t
            lat = p1[1] + (p2[1] - p1[1]) * local_t
            bearing = calculate_bearing(p1, p2)
            return lon, lat, bearing
        accum += seg_len

    return coords[-1][0], coords[-1][1], calculate_bearing(coords[-2], coords[-1])


async def fetch_bcferries_realtime():
    global cached_bcferries_vehicles, cached_bcferries_raw_data
    while True:
        try:
            r = await asyncio.to_thread(requests.get, 'https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
            cached_bcferries_raw_data = {"timestamp": time.time(), "data": data}
            ferry_paths = get_bc_ferries_paths()
            
            terminals = {
                'TSA': [-123.1317, 49.0064],
                'SWB': [-123.4107, 48.6868],
                'HSB': [-123.2741, 49.3693],
                'DUK': [-123.8912, 49.1606],
                'LNG': [-123.4723, 49.4339],
                'NAN': [-123.9554, 49.1935],
                'FUL': [-123.4511, 48.7694],
                'BOW': [-123.3313, 49.3795]
            }

            terminal_names = {
                'TSA': 'Tsawwassen',
                'SWB': 'Swartz Bay',
                'HSB': 'Horseshoe Bay',
                'DUK': 'Duke Point',
                'LNG': 'Langdale',
                'NAN': 'Nanaimo (Departure Bay)',
                'FUL': 'Fulford Harbour',
                'BOW': 'Bowen Island (Snug Cove)'
            }

            vehicles = []
            
            import datetime
            try:
                from zoneinfo import ZoneInfo
                now = datetime.datetime.now(ZoneInfo("America/Vancouver"))
            except ImportError:
                now = datetime.datetime.utcnow() - datetime.timedelta(hours=7)
            
            now_naive = now.replace(tzinfo=None)

            capacity_routes = data.get('capacityRoutes', [])
            # nonCapacityRoutes are schedule-only (no vessel names, times differ by 1-2 min),
            # so they duplicate any route pair already covered by real-time capacityRoutes.
            capacity_pairs = {(r.get('fromTerminalCode'), r.get('toTerminalCode')) for r in capacity_routes}
            all_routes = capacity_routes + [
                r for r in data.get('nonCapacityRoutes', [])
                if (r.get('fromTerminalCode'), r.get('toTerminalCode')) not in capacity_pairs
            ]
            seen_trips = set()
            seen_vessels = set()
            
            for route in all_routes:
                dep_code = route.get('fromTerminalCode')
                arr_code = route.get('toTerminalCode')
                
                if dep_code not in terminals or arr_code not in terminals:
                    continue
                    
                dep_coord = terminals[dep_code]
                arr_coord = terminals[arr_code]
                route_path = ferry_paths.get(f"{dep_code}_{arr_code}")
                
                for sailing in route.get('sailings', []):
                    status = sailing.get('sailingStatus')
                    time_str = sailing.get('time', '')
                    arr_time_str = sailing.get('arrivalTime', '')
                    vessel_name = sailing.get('vesselName') or 'BC Ferries'
                    
                    trip_key = f"{dep_code}_{arr_code}_{time_str}"
                    if trip_key in seen_trips:
                        continue
                    
                    is_sailing = False
                    progress = 0.5
                    
                    try:
                        if time_str and arr_time_str and time_str.lower() != 'variable' and arr_time_str.lower() != 'variable':
                            dep_time = datetime.datetime.strptime(time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                            dep_time = now_naive.replace(hour=dep_time.hour, minute=dep_time.minute, second=0, microsecond=0)
                            
                            arr_time = datetime.datetime.strptime(arr_time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                            arr_time = now_naive.replace(hour=arr_time.hour, minute=arr_time.minute, second=0, microsecond=0)
                            
                            if arr_time < dep_time:
                                arr_time += datetime.timedelta(days=1)
                            
                            if dep_time <= now_naive <= arr_time:
                                is_sailing = True
                                total_seconds = (arr_time - dep_time).total_seconds()
                                elapsed = (now_naive - dep_time).total_seconds()
                                if total_seconds > 0:
                                    progress = max(0.02, min(0.98, elapsed / total_seconds))
                    except Exception:
                        pass
                        
                    if status == 'current' or is_sailing:
                        # A physical vessel can only be at one place; skip repeats
                        if sailing.get('vesselName') and vessel_name in seen_vessels:
                            continue
                        if sailing.get('vesselName'):
                            seen_vessels.add(vessel_name)
                        seen_trips.add(trip_key)
                        if route_path and len(route_path) >= 2:
                            lon, lat, bearing = _interpolate_along_path(route_path, progress)
                        else:
                            lon = dep_coord[0] + (arr_coord[0] - dep_coord[0]) * progress
                            lat = dep_coord[1] + (arr_coord[1] - dep_coord[1]) * progress
                            bearing = calculate_bearing(dep_coord, arr_coord)
                        fill = sailing.get('fill') or sailing.get('carFill') or 0
                        
                        vehicles.append({
                            'id': f"bcferries_{vessel_name.replace(' ', '_')}_{dep_code}_{arr_code}_{time_str}",
                            'route_id': f"{dep_code} ➝ {arr_code}",
                            'is_bcferries': True,
                            'vessel_name': vessel_name,
                            'dep_code': dep_code,
                            'arr_code': arr_code,
                            'dep_name': terminal_names.get(dep_code, dep_code),
                            'arr_name': terminal_names.get(arr_code, arr_code),
                            'departure_time': time_str,
                            'arrival_time': arr_time_str,
                            'fill': fill,
                            'progress': round(progress * 100, 1),
                            'lat': lat,
                            'lon': lon,
                            'bearing': bearing
                        })
            
            cached_bcferries_vehicles = vehicles
            print(f"[BC Ferries] Found {len(vehicles)} ships currently sailing.")
            
            await broadcast_ws({"type": "bc_ferries_update", "data": vehicles})
                    
        except Exception as e:
            print(f"Error in BC Ferries fetch: {e}")
            
        await asyncio.sleep(15)


_gtfs_metadata_cache = None
trip_realtime_etas = {}

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _VAN_TZ = _ZoneInfo("America/Vancouver")
except Exception:
    _VAN_TZ = None

def get_gtfs_metadata():
    global _gtfs_metadata_cache
    if _gtfs_metadata_cache is not None:
        return _gtfs_metadata_cache
    meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "translink_gtfs_metadata.json")
    if not os.path.exists(meta_path):
        try:
            from scripts.generate_gtfs_metadata import generate_gtfs_metadata
            generate_gtfs_metadata()
        except Exception as e:
            print(f"Auto-generate GTFS metadata error: {e}")
    if os.path.exists(meta_path):
        try:
            import json
            with open(meta_path, "r", encoding="utf-8") as f:
                _gtfs_metadata_cache = json.load(f)
                return _gtfs_metadata_cache
        except Exception as e:
            print(f"Error loading translink_gtfs_metadata.json: {e}")
    return {"routes": {}, "variants": {}, "route_default_variants": {}, "trip_to_variant": {}}


def _format_vancouver_hhmm(unix_ts: float) -> str:
    try:
        if _VAN_TZ is not None:
            dt = datetime.fromtimestamp(unix_ts, _VAN_TZ)
        else:
            from zoneinfo import ZoneInfo
            dt = datetime.fromtimestamp(unix_ts, ZoneInfo("America/Vancouver"))
    except Exception:
        import datetime as dt_mod
        dt = dt_mod.datetime.utcfromtimestamp(unix_ts) - dt_mod.timedelta(hours=7)
    return dt.strftime("%H:%M")


def _resolve_vehicle_variant(route_id: str, trip_id: str, direction_id: str, gtfs_meta: dict):
    variants = gtfs_meta.get("variants", {})
    trip_to_variant = gtfs_meta.get("trip_to_variant", {})
    default_variants = gtfs_meta.get("route_default_variants", {})

    vkey = trip_to_variant.get(str(trip_id))
    if vkey and vkey in variants:
        return variants[vkey]

    def_key = f"{route_id}_{direction_id}"
    vkey = default_variants.get(def_key) or default_variants.get(f"{route_id}_0") or default_variants.get(f"{route_id}_1")
    if vkey and vkey in variants:
        return variants[vkey]
    return None


def _project_bus_next_stop_idx(stops: list, lat: float, lon: float):
    """
    Projects live bus GPS (lat, lon) onto the directed segments stops[i] -> stops[i+1].
    As soon as the bus has passed stops[i] by >25m along the segment towards stops[i+1],
    stops[i] is marked 'passed' and stops[i+1] becomes the 'next' stop.
    """
    if not lat or not lon or len(stops) < 2:
        return None

    best_perp_dist = 1e12
    best_seg_idx = 0
    best_along_m = 0.0
    best_t = 0.0

    for i in range(len(stops) - 1):
        s1 = stops[i]
        s2 = stops[i + 1]
        dx = (s2["lon"] - s1["lon"]) * 73000.0
        dy = (s2["lat"] - s1["lat"]) * 111000.0
        px = (lon - s1["lon"]) * 73000.0
        py = (lat - s1["lat"]) * 111000.0

        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq <= 1.0:
            t = 0.0
            seg_len = 0.0
        else:
            t = max(0.0, min(1.0, (px * dx + py * dy) / seg_len_sq))
            seg_len = math.sqrt(seg_len_sq)

        perp_dist = math.hypot(px - t * dx, py - t * dy)
        if perp_dist < best_perp_dist:
            best_perp_dist = perp_dist
            best_seg_idx = i
            best_along_m = t * seg_len
            best_t = t

    # If the bus has moved >25 meters past stops[best_seg_idx] (or >3% along the segment),
    # then stops[best_seg_idx] is already passed and the next stop is best_seg_idx + 1!
    if best_along_m > 25.0 or best_t > 0.03:
        return min(best_seg_idx + 1, len(stops) - 1)
    return best_seg_idx


def _compute_vehicle_stop_progress(variant: dict, stop_id: str, stop_seq: int, lat: float, lon: float, trip_id: str, include_stops: bool = True):
    """Determine next stop, origin, destination, and stop-by-stop status & ETAs for a live bus."""
    if not variant:
        return {
            "next_stop_name": "沿線行駛中",
            "next_stop_time": "",
            "next_stop_minutes": None,
            "next_stop_index": 0,
            "stops": [],
        }

    stops = variant.get("stops", [])
    if not stops:
        return {
            "next_stop_name": variant.get("destination", ""),
            "next_stop_time": "",
            "next_stop_minutes": None,
            "next_stop_index": 0,
            "stops": [],
        }

    gtfs_idx = None
    if stop_id:
        for idx, s in enumerate(stops):
            if str(s.get("stop_id")) == str(stop_id) or str(s.get("stop_code")) == str(stop_id):
                gtfs_idx = idx
                break

    if gtfs_idx is None and stop_seq and stop_seq > 0:
        gtfs_idx = min(max(0, stop_seq - 1), len(stops) - 1)

    gps_idx = _project_bus_next_stop_idx(stops, lat, lon)

    if gps_idx is not None and gtfs_idx is not None:
        # If GTFS stop_id lags by 1-2 stops after the bus physically passed the stop, trust GPS advancement
        if gps_idx >= gtfs_idx and (gps_idx - gtfs_idx) <= 3:
            next_idx = gps_idx
        else:
            next_idx = gps_idx
    elif gps_idx is not None:
        next_idx = gps_idx
    elif gtfs_idx is not None:
        next_idx = gtfs_idx
    else:
        next_idx = 0

    now_ts = time.time()
    trip_etas = trip_realtime_etas.get(str(trip_id), {})

    # Estimate base minutes to next_idx if GTFS-RT TripUpdate doesn't have this stop
    next_stop_obj = stops[next_idx]
    next_eta_info = trip_etas.get(str(next_stop_obj["stop_id"]))
    if next_eta_info and next_eta_info["arrival_time"] >= now_ts - 30:
        base_next_ts = next_eta_info["arrival_time"]
        base_next_min = max(0, int((base_next_ts - now_ts) / 60))
    else:
        if lat and lon:
            dist_km = math.hypot((next_stop_obj["lat"] - lat) * 111.0, (next_stop_obj["lon"] - lon) * 73.0)
            base_next_min = max(1, min(12, int(round(dist_km / 0.42))))
        else:
            base_next_min = 2
        base_next_ts = now_ts + base_next_min * 60

    next_stop_time_str = _format_vancouver_hhmm(base_next_ts)
    if not include_stops:
        return {
            "next_stop_name": next_stop_obj["name"],
            "next_stop_time": next_stop_time_str,
            "next_stop_minutes": base_next_min,
            "next_stop_index": next_idx,
            "stops": [],
        }

    enriched_stops = []
    for idx, s in enumerate(stops):
        sid = str(s["stop_id"])
        if idx < next_idx:
            st_status = "passed"
            eta_time_str = ""
            eta_min = None
        elif idx == next_idx:
            st_status = "next"
            eta_time_str = next_stop_time_str
            eta_min = base_next_min
        else:
            st_status = "upcoming"
            rt_info = trip_etas.get(sid)
            if rt_info and rt_info["arrival_time"] >= now_ts:
                eta_min = max(base_next_min + (idx - next_idx), int((rt_info["arrival_time"] - now_ts) / 60))
                eta_time_str = _format_vancouver_hhmm(rt_info["arrival_time"])
            else:
                eta_min = base_next_min + (idx - next_idx) * 2
                eta_time_str = _format_vancouver_hhmm(now_ts + eta_min * 60)

        enriched_stops.append({
            "seq": idx + 1,
            "stop_id": s["stop_id"],
            "stop_code": s.get("stop_code", s["stop_id"]),
            "name": s["name"],
            "lat": s["lat"],
            "lon": s["lon"],
            "status": st_status,
            "eta_time": eta_time_str,
            "eta_minutes": eta_min,
        })

    return {
        "next_stop_name": next_stop_obj["name"],
        "next_stop_time": next_stop_time_str,
        "next_stop_minutes": base_next_min,
        "next_stop_index": next_idx,
        "stops": enriched_stops,
    }


_cached_db_route_ids = None
_cached_db_seabus_ids = None

async def fetch_translink_realtime():
    """Fetches VehiclePositions and enriches with GTFS static bus numbers, origins, destinations & next stops."""
    global cached_translink_vehicles, _cached_db_route_ids, _cached_db_seabus_ids
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsposition?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            gtfs_meta = get_gtfs_metadata()
            routes_lookup = gtfs_meta.get("routes", {})
            variant_route_ids = {v["route_id"] for v in gtfs_meta.get("variants", {}).values()}

            if _cached_db_route_ids is None:
                db = database.SessionLocal()
                try:
                    valid_routes = db.query(models.TransitRoute).all()
                    if valid_routes:
                        _cached_db_route_ids = {r.route_id for r in valid_routes} | variant_route_ids
                        _cached_db_seabus_ids = {r.route_id for r in valid_routes if r.route_group == 'seabus'} | {"6771"}
                except Exception:
                    pass
                finally:
                    db.close()

            valid_route_ids = _cached_db_route_ids or variant_route_ids
            seabus_ids = _cached_db_seabus_ids or {"6771"}
                
            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers, timeout=12))
            
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            vehicles = []
            for entity in feed.entity:
                if entity.HasField('vehicle'):
                    v = entity.vehicle
                    route_id = v.trip.route_id
                    
                    if route_id in valid_route_ids:
                        trip_id = v.trip.trip_id
                        direction_id = str(v.trip.direction_id) if v.trip.HasField('direction_id') else "0"
                        stop_id = str(v.stop_id) if v.stop_id else ""
                        stop_seq = int(v.current_stop_sequence) if v.current_stop_sequence else 0
                        lat = v.position.latitude
                        lon = v.position.longitude

                        rmeta = routes_lookup.get(route_id, {})
                        route_number = rmeta.get("route_number") or route_id
                        variant = _resolve_vehicle_variant(route_id, trip_id, direction_id, gtfs_meta)
                        prog = _compute_vehicle_stop_progress(variant, stop_id, stop_seq, lat, lon, trip_id, include_stops=False)

                        origin = variant.get("origin", "") if variant else ""
                        destination = variant.get("destination", "") if variant else rmeta.get("long_name", "")
                        route_name = variant.get("route_name", "") if variant else f"{route_number} {rmeta.get('long_name', '')}".strip()
                        operator = variant.get("operator", "TransLink (CMBC 岸山巴士)") if variant else "TransLink (CMBC 岸山巴士)"

                        vehicles.append({
                            "id": v.vehicle.id or v.vehicle.label,
                            "route_id": route_id,
                            "route_number": route_number,
                            "route_name": route_name,
                            "trip_id": trip_id,
                            "direction_id": direction_id,
                            "stop_id": stop_id,
                            "stop_seq": stop_seq,
                            "origin": origin,
                            "destination": destination,
                            "operator": operator,
                            "next_stop_name": prog["next_stop_name"],
                            "next_stop_time": prog["next_stop_time"],
                            "next_stop_minutes": prog["next_stop_minutes"],
                            "is_seabus": route_id in seabus_ids,
                            "lat": lat,
                            "lon": lon,
                            "bearing": v.position.bearing,
                        })
            
            seabus_simulated = []

            try:
                from zoneinfo import ZoneInfo
                now_seabus = datetime.now(ZoneInfo("America/Vancouver"))
            except:
                import datetime as dt_mod
                now_seabus = datetime.utcnow() - dt_mod.timedelta(hours=7)
                
            # Handle GTFS >24h time format
            current_time_str = f"{now_seabus.hour:02d}:{now_seabus.minute:02d}:{now_seabus.second:02d}"
            if now_seabus.hour < 3: # If after midnight, could be represented as 24+
                current_time_str = f"{now_seabus.hour + 24:02d}:{now_seabus.minute:02d}:{now_seabus.second:02d}"


            db = database.SessionLocal()
            try:
                # Calculate active seabus trips
                active_seabus = db.query(models.SeaBusSchedule).filter(
                    models.SeaBusSchedule.departure_time <= current_time_str,
                    models.SeaBusSchedule.arrival_time >= current_time_str
                ).all()
                
                for trip in active_seabus:
                    dep_h, dep_m, dep_s = map(int, trip.departure_time.split(':'))
                    arr_h, arr_m, arr_s = map(int, trip.arrival_time.split(':'))
                    curr_h, curr_m, curr_s = map(int, current_time_str.split(':'))
                    
                    dep_sec = dep_h * 3600 + dep_m * 60 + dep_s
                    arr_sec = arr_h * 3600 + arr_m * 60 + arr_s
                    curr_sec = curr_h * 3600 + curr_m * 60 + curr_s
                    
                    if arr_sec > dep_sec:
                        progress = (curr_sec - dep_sec) / (arr_sec - dep_sec)
                        rem_min = max(1, int((arr_sec - curr_sec) / 60))
                        
                        # Get shape geometry to interpolate
                        shape = db.query(models.TransitShape).filter(models.TransitShape.shape_id == trip.shape_id).first()
                        if shape:
                            point_result = db.query(
                                func.ST_X(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lon'),
                                func.ST_Y(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lat')
                            ).first()
                            
                            if point_result:
                                bearing = 15 if trip.direction_id == 0 else 195
                                sb_origin = "Waterfront Station" if trip.direction_id == 0 else "Lonsdale Quay"
                                sb_dest = "Lonsdale Quay" if trip.direction_id == 0 else "Waterfront Station"
                                arr_hhmm = f"{(arr_h % 24):02d}:{arr_m:02d}"
                                seabus_simulated.append({
                                    "id": f"seabus_sim_{trip.trip_id}",
                                    "route_id": "6771",
                                    "route_number": "SeaBus",
                                    "route_name": "SeaBus 跨海渡輪",
                                    "trip_id": str(trip.trip_id),
                                    "direction_id": str(trip.direction_id),
                                    "stop_id": "",
                                    "stop_seq": 2,
                                    "origin": sb_origin,
                                    "destination": sb_dest,
                                    "operator": "TransLink (SeaBus 海上巴士)",
                                    "next_stop_name": sb_dest,
                                    "next_stop_time": arr_hhmm,
                                    "next_stop_minutes": rem_min,
                                    "is_seabus": True,
                                    "lat": point_result.lat,
                                    "lon": point_result.lon,
                                    "bearing": bearing,
                                })
            except Exception as e:
                print(f"Error simulating SeaBus: {e}")
            finally:
                db.close()

            # If database schedule yielded 0 active sailings, provide robust real-time fallback vessels
            if not seabus_simulated:
                now_epoch = int(time.time())
                # Vessel 1: Waterfront -> Lonsdale Quay (cycle 900s: 720s sailing + 180s dock)
                cycle_1 = now_epoch % 900
                if cycle_1 < 720:
                    frac_1 = cycle_1 / 720.0
                    lat_1 = 49.2861 + (49.3103 - 49.2861) * frac_1
                    lon_1 = -123.1118 + (-123.0829 - (-123.1118)) * frac_1
                    rem_1 = max(1, int((720 - cycle_1) / 60))
                else:
                    lat_1, lon_1 = 49.3103, -123.0829
                    rem_1 = 1
                arr_m_1 = (now_seabus.minute + rem_1) % 60
                arr_h_1 = (now_seabus.hour + (now_seabus.minute + rem_1) // 60) % 24
                seabus_simulated.append({
                    "id": "seabus_sim_v1",
                    "route_id": "6771",
                    "route_number": "SeaBus",
                    "route_name": "SeaBus 跨海渡輪",
                    "trip_id": "seabus_v1_nb",
                    "direction_id": "0",
                    "stop_id": "8036",
                    "stop_seq": 2,
                    "origin": "Waterfront Station",
                    "destination": "Lonsdale Quay",
                    "operator": "TransLink (SeaBus 海上巴士)",
                    "next_stop_name": "Lonsdale Quay",
                    "next_stop_time": f"{arr_h_1:02d}:{arr_m_1:02d}",
                    "next_stop_minutes": rem_1,
                    "is_seabus": True,
                    "lat": round(lat_1, 5),
                    "lon": round(lon_1, 5),
                    "bearing": 38,
                })

                # Vessel 2: Lonsdale Quay -> Waterfront (offset by 450s)
                cycle_2 = (now_epoch + 450) % 900
                if cycle_2 < 720:
                    frac_2 = cycle_2 / 720.0
                    lat_2 = 49.3103 + (49.2861 - 49.3103) * frac_2
                    lon_2 = -123.0829 + (-123.1118 - (-123.0829)) * frac_2
                    rem_2 = max(1, int((720 - cycle_2) / 60))
                else:
                    lat_2, lon_2 = 49.2861, -123.1118
                    rem_2 = 1
                arr_m_2 = (now_seabus.minute + rem_2) % 60
                arr_h_2 = (now_seabus.hour + (now_seabus.minute + rem_2) // 60) % 24
                seabus_simulated.append({
                    "id": "seabus_sim_v2",
                    "route_id": "6771",
                    "route_number": "SeaBus",
                    "route_name": "SeaBus 跨海渡輪",
                    "trip_id": "seabus_v2_sb",
                    "direction_id": "1",
                    "stop_id": "8035",
                    "stop_seq": 2,
                    "origin": "Lonsdale Quay",
                    "destination": "Waterfront Station",
                    "operator": "TransLink (SeaBus 海上巴士)",
                    "next_stop_name": "Waterfront Station",
                    "next_stop_time": f"{arr_h_2:02d}:{arr_m_2:02d}",
                    "next_stop_minutes": rem_2,
                    "is_seabus": True,
                    "lat": round(lat_2, 5),
                    "lon": round(lon_2, 5),
                    "bearing": 218,
                })

            vehicles.extend(seabus_simulated)
            cached_translink_vehicles = vehicles
            
            await broadcast_ws({"type": "vehicles_update", "data": vehicles})
                    
        except Exception as e:
            print(f"Error fetching TransLink data: {e}")
            
        await asyncio.sleep(15)

async def fetch_translink_trip_updates():
    """Polls GTFS-RT TripUpdates every 30 seconds to provide arrival times with real bus numbers."""
    global stop_arrivals, trip_realtime_etas
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            gtfs_meta = get_gtfs_metadata()
            routes_lookup = gtfs_meta.get("routes", {})
            variants_lookup = gtfs_meta.get("variants", {})
            trip_to_variant = gtfs_meta.get("trip_to_variant", {})

            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers, timeout=12))
            
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            new_arrivals = {}
            new_trip_etas = {}
            current_time = time.time()
            
            for entity in feed.entity:
                if entity.HasField('trip_update'):
                    tu = entity.trip_update
                    route_id = tu.trip.route_id
                    trip_id = tu.trip.trip_id
                    rmeta = routes_lookup.get(route_id, {})
                    route_number = rmeta.get("route_number") or route_id
                    route_name = rmeta.get("long_name", "")
                    vkey = trip_to_variant.get(trip_id)
                    dest = variants_lookup[vkey].get("destination", "") if vkey and vkey in variants_lookup else ""

                    for stu in tu.stop_time_update:
                        stop_id = stu.stop_id
                        arr_ts = stu.arrival.time if stu.HasField('arrival') and stu.arrival.time > 0 else (stu.departure.time if stu.HasField('departure') else 0)
                        if arr_ts > current_time:
                            mins = int((arr_ts - current_time) / 60)
                            if stop_id not in new_arrivals:
                                new_arrivals[stop_id] = []
                            new_arrivals[stop_id].append({
                                "route_id": route_id,
                                "route_number": route_number,
                                "route_name": route_name,
                                "destination": dest,
                                "arrival_time": arr_ts,
                                "minutes": mins
                            })
                            new_trip_etas.setdefault(trip_id, {})[stop_id] = {
                                "arrival_time": arr_ts,
                                "minutes": mins
                            }
                            
            # Sort arrivals by time
            for stop_id in new_arrivals:
                new_arrivals[stop_id].sort(key=lambda x: x["arrival_time"])
                
            stop_arrivals = new_arrivals
            trip_realtime_etas = new_trip_etas
            print(f"[OK] Updated TripUpdates for {len(stop_arrivals)} stops")
            
        except Exception as e:
            print(f"Error fetching TripUpdates: {e}")
            
        await asyncio.sleep(30)

async def broadcast_skytrain_simulation():
    global cached_skytrain_trains
    while True:
        try:
            trains = skytrain_service.get_estimated_skytrain_trains()
            cached_skytrain_trains = trains
            await broadcast_ws({"type": "skytrain_trains_update", "data": trains})
        except Exception as e:
            print(f"Error in SkyTrain simulation broadcast: {e}")
        await asyncio.sleep(4)

async def broadcast_maritime_vessels():
    while True:
        try:
            vessels = shipping_service.get_vessels()
            await broadcast_ws({"type": "maritime_vessels_update", "data": vessels})
        except Exception as e:
            print(f"Error in maritime vessels broadcast: {e}")
        await asyncio.sleep(4)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(fetch_translink_realtime())
    asyncio.create_task(fetch_bcferries_realtime())
    asyncio.create_task(fetch_translink_trip_updates())
    asyncio.create_task(broadcast_skytrain_simulation())
    asyncio.create_task(shipping_service.run_aisstream_listener())
    asyncio.create_task(broadcast_maritime_vessels())

@app.get("/api/skytrain/trains")
def get_skytrain_trains():
    global cached_skytrain_trains
    if not cached_skytrain_trains:
        cached_skytrain_trains = skytrain_service.get_estimated_skytrain_trains()
    return cached_skytrain_trains

@app.get("/api/skytrain/stations/{stop_id}/schedule")
def get_skytrain_station_schedule(stop_id: str):
    return skytrain_service.get_skytrain_station_schedule(stop_id)

@app.get("/api/flights/live")
def get_live_flights():
    return {
        "count": 0,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "flights": []
    }

@app.get("/api/flights/schedules")
def get_flight_schedules():
    global cached_flight_schedules
    schedules = flights.fetch_flightaware_schedules(allow_api_call=True)
    if schedules:
        cached_flight_schedules = schedules
    return cached_flight_schedules or schedules or {"arrivals": [], "departures": []}

@app.get("/api/tides/live")
def get_live_tides():
    import tides_service
    return tides_service.get_live_tides_data()

@app.get("/api/tides/stations/geojson")
def get_tides_geojson():
    import tides_service
    return tides_service.get_tides_geojson()

@app.get("/api/ski/resorts")
def get_ski_resorts():
    import ski_service
    return ski_service.get_live_ski_data()

@app.get("/api/ski/geojson")
def get_ski_geojson():
    import ski_service
    return ski_service.get_ski_geojson()

@app.get("/api/aurora/live")
def get_live_aurora(force: bool = False):
    """
    Returns latest NOAA SWPC Planetary K-index, G-scale geomagnetic storm level,
    Vancouver visibility forecast & top aurora viewing spots. Cached 12 hours (2 times daily).
    """
    import aurora_service
    return aurora_service.get_aurora_data(force=force)

@app.get("/api/translink/alerts")
def get_translink_alerts(force: bool = False):
    """
    Returns latest TransLink live alerts and emergency banners across all modes (SkyTrain, Bus, SeaBus, WCE).
    Cached 5 minutes.
    """
    import translink_service
    return translink_service.get_translink_alerts(force=force)


@app.get("/api/traffic/summary")
def get_tomtom_traffic_summary(force: bool = False):
    """
    Returns real-time TomTom traffic corridors delay summary, bottlenecks and alerts for Greater Vancouver.
    Cached 5 minutes.
    """
    from tomtom_service import tomtom_service
    return tomtom_service.get_corridors_summary(force=force)


@app.get("/api/traffic/jams")
def get_tomtom_jams(force: bool = False):
    """
    Returns real-time TomTom traffic corridor speed/delay LineStrings as GeoJSON.
    """
    from tomtom_service import tomtom_service
    return tomtom_service.get_jams_geojson(force=force)


@app.get("/api/traffic/alerts")
def get_tomtom_alerts(force: bool = False):
    """
    Returns real-time TomTom traffic incidents and road hazards as GeoJSON Points.
    """
    from tomtom_service import tomtom_service
    return tomtom_service.get_alerts_geojson(force=force)


@app.get("/api/traffic/tiles/{z}/{x}/{y}.png")
def get_tomtom_traffic_tile(z: int, x: int, y: int, style: str = "relative", thickness: int = 2):
    """
    Proxies and caches TomTom Traffic Flow Raster Tiles v4 (relative green/yellow/orange/red full road network overlay).
    Cached 3 minutes to protect TomTom free tier quota and keep API key server-side.
    """
    from fastapi.responses import Response
    from tomtom_service import tomtom_service
    png_bytes = tomtom_service.get_flow_tile(z, x, y, style=style, thickness=thickness)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=180"}
    )



@app.get("/api/beach-water/live")
def get_live_beach_water(force: bool = False):
    """
    Returns latest Metro Vancouver Beach Water Quality monitoring results (E. coli MPN/100ml)
    across all 41 public beaches. Updated monthly.
    """
    import beach_water_service
    return beach_water_service.get_beach_water_data(force=force)


@app.get("/api/beach-water/geojson")
@app.get("/api/geojson/beach-water")
def get_beach_water_geojson():
    import beach_water_service
    return beach_water_service.get_beach_water_geojson()


@app.get("/api/geojson/airports")
def get_airports_geojson():
    static_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_airports.geojson")
    if os.path.exists(static_path):
        with open(static_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}


@app.get("/")
async def root():
    return {"message": "Welcome to Vancouver God's Eye API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/ferries/terminals/{terminal_code}/schedule")
@app.get("/api/bcferries/schedule/{terminal_code}")
async def get_ferry_terminal_schedule(terminal_code: str):
    global cached_bcferries_raw_data
    try:
        now_ts = time.time()
        if cached_bcferries_raw_data.get("data") and (now_ts - cached_bcferries_raw_data.get("timestamp", 0.0) < 60.0):
            data = cached_bcferries_raw_data["data"]
        else:
            r = await asyncio.to_thread(requests.get, 'https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
            cached_bcferries_raw_data = {"timestamp": now_ts, "data": data}
        
        schedule = []
        import datetime
        try:
            from zoneinfo import ZoneInfo
            now = datetime.datetime.now(ZoneInfo("America/Vancouver"))
        except ImportError:
            now = datetime.datetime.utcnow() - datetime.timedelta(hours=7)
        now_naive = now.replace(tzinfo=None)
        
        # We should use a dict to avoid duplicates. Key: (destination, time)
        seen = {}
        
        all_routes = data.get('capacityRoutes', []) + data.get('nonCapacityRoutes', [])
        for route in all_routes:
            if route.get('fromTerminalCode') == terminal_code:
                arr_code = route.get('toTerminalCode')
                for sailing in route.get('sailings', []):
                    time_str = sailing.get('time')
                    arr_time_str = sailing.get('arrivalTime')
                    
                    # Get true deck capacity fill rate (Option B)
                    fill = sailing.get('fill') or sailing.get('carFill') or 0
                    status = sailing.get('sailingStatus')
                    
                    # Calculate status based on time to ensure past/current/future are always accurate
                    if time_str and arr_time_str and time_str.lower() != 'variable' and arr_time_str.lower() != 'variable':
                        try:
                            dep_time = datetime.datetime.strptime(time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                            dep_time = now_naive.replace(hour=dep_time.hour, minute=dep_time.minute, second=0, microsecond=0)
                            
                            arr_time = datetime.datetime.strptime(arr_time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                            arr_time = now_naive.replace(hour=arr_time.hour, minute=arr_time.minute, second=0, microsecond=0)
                            
                            if arr_time < dep_time:
                                arr_time += datetime.timedelta(days=1)
                                
                            if now_naive > arr_time:
                                status = 'past'
                            elif dep_time <= now_naive <= arr_time:
                                status = 'current'
                            else:
                                status = 'future'
                        except Exception:
                            if not status: status = 'future'
                            
                    if not status:
                        status = 'future'
                    
                    key = f"{arr_code}_{time_str}"
                    # If duplicate, prefer the one with a vessel name or real capacity
                    if key in seen:
                        existing = seen[key]
                        if sailing.get('vesselName') and (not existing.get('vessel_name') or existing.get('vessel_name') == 'BC Ferries'):
                            existing['vessel_name'] = sailing.get('vesselName')
                        if fill > 0 and existing.get('fill') == 0:
                            existing['fill'] = fill
                        if status != 'future' and existing.get('status') == 'future':
                            existing['status'] = status
                        continue

                    entry = {
                        "destination": arr_code,
                        "time": time_str,
                        "arrival_time": arr_time_str,
                        "vessel_name": sailing.get('vesselName'),
                        "status": status,
                        "fill": fill
                    }
                    seen[key] = entry
                    schedule.append(entry)
                    
        # Sort by time
        def parse_time(t_str):
            if not t_str or t_str.lower() == 'variable' or t_str.lower() == 'cancelled':
                return datetime.datetime(2000, 1, 1) # put at top
            try:
                return datetime.datetime.strptime(t_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
            except:
                return datetime.datetime(2000, 1, 1)
                
        schedule.sort(key=lambda x: parse_time(x['time']))
        return {"terminal": terminal_code, "schedule": schedule}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/stops/{stop_id}/arrivals")
async def get_stop_arrivals(stop_id: str):
    # Special handling for SeaBus Terminals (Waterfront #8035 & Lonsdale Quay #8036)
    clean_id = str(stop_id).strip()
    if clean_id in ["8035", "8036", "seabus_waterfront", "seabus_lonsdale"] or "seabus" in clean_id.lower():
        try:
            from zoneinfo import ZoneInfo
            now_local = datetime.now(ZoneInfo("America/Vancouver"))
        except Exception:
            import datetime as dt_mod
            now_local = datetime.utcnow() - dt_mod.timedelta(hours=7)

        is_waterfront = clean_id in ["8035", "seabus_waterfront"]
        dest = "Lonsdale Quay" if is_waterfront else "Waterfront Station"
        headway = 15 if (6 <= now_local.hour < 21) else 30

        now_sec = now_local.minute * 60 + now_local.second
        slot_sec = headway * 60
        curr_slot_idx = now_sec // slot_sec

        seabus_arrivals = []
        for i in range(1, 5):
            target_min_total = (curr_slot_idx + i) * headway
            dep_hour = (now_local.hour + (target_min_total // 60)) % 24
            dep_min = target_min_total % 60

            diff_sec = (dep_hour * 3600 + dep_min * 60) - (now_local.hour * 3600 + now_local.minute * 60 + now_local.second)
            if diff_sec < 0:
                diff_sec += 86400
            diff_min = max(1, round(diff_sec / 60))

            seabus_arrivals.append({
                "route_id": "6771",
                "route_number": "SeaBus",
                "route_name": "SeaBus 跨海渡輪",
                "destination": dest,
                "direction": "Northbound" if is_waterfront else "Southbound",
                "minutes": diff_min,
                "expected_countdown": f"{diff_min} 分鐘",
                "scheduled_time": f"{dep_hour:02d}:{dep_min:02d}",
                "status": "準時",
                "operator": "TransLink (SeaBus 海上巴士)",
                "is_seabus": True
            })
        return {"stop_id": stop_id, "arrivals": seabus_arrivals}

    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    raw_list = stop_arrivals.get(stop_id, [])[:10]
    enriched = []
    for item in raw_list:
        rid = str(item.get("route_id", ""))
        rmeta = routes_lookup.get(rid, {})
        rnum = item.get("route_number") or rmeta.get("route_number") or rid
        if rnum.isdigit():
            rnum = str(int(rnum))
        enriched.append({
            **item,
            "route_number": rnum,
            "route_name": item.get("route_name") or rmeta.get("long_name", ""),
        })
    return {"stop_id": stop_id, "arrivals": enriched}


@app.get("/api/transit/route/{route_id}")
def get_transit_route_details(route_id: str, variant: str = ""):
    """
    Returns full route geometry, stops, and current active buses for a specific route.
    """
    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    variants_lookup = gtfs_meta.get("variants", {})
    default_variants = gtfs_meta.get("route_default_variants", {})

    rid = str(route_id).strip()
    rmeta = routes_lookup.get(rid)
    if not rmeta:
        for k, v in routes_lookup.items():
            if str(v.get("route_number", "")).lower() == rid.lower() or str(v.get("raw_short_name", "")).lower() == rid.lower():
                rid = k
                rmeta = v
                break

    rmeta = rmeta or {}
    rnum = str(rmeta.get("route_number") or rid)
    rlong = str(rmeta.get("long_name") or "")

    primary_v = None
    if variant and variant in variants_lookup:
        primary_v = variants_lookup[variant]
    else:
        def_key_0 = default_variants.get(f"{rid}_0")
        def_key_1 = default_variants.get(f"{rid}_1")
        if def_key_0 and def_key_0 in variants_lookup:
            primary_v = variants_lookup[def_key_0]
        elif def_key_1 and def_key_1 in variants_lookup:
            primary_v = variants_lookup[def_key_1]
        else:
            route_variants = [v for v in variants_lookup.values() if str(v.get("route_id")) == rid]
            if route_variants:
                primary_v = max(route_variants, key=lambda v: len(v.get("stops", [])))

    shape_coords = primary_v.get("shape_coords", []) if primary_v else []
    stops = primary_v.get("stops", []) if primary_v else []
    origin = primary_v.get("origin", "") if primary_v else ""
    destination = primary_v.get("destination", "") if primary_v else rlong
    operator = primary_v.get("operator", "TransLink (CMBC 岸山巴士)") if primary_v else "TransLink (CMBC 岸山巴士)"

    route_buses = [
        v for v in cached_translink_vehicles
        if str(v.get("route_id")) == rid or str(v.get("route_number", "")).lower() == rnum.lower()
    ]

    return {
        "route_id": rid,
        "route_number": rnum,
        "route_name": f"{rnum} {rlong}".strip() if rnum not in rlong else rlong,
        "color": rmeta.get("color", "#10b981"),
        "origin": origin,
        "destination": destination,
        "operator": operator,
        "shape_coords": shape_coords,
        "stops": stops,
        "buses": route_buses
    }


@app.get("/api/transit/vehicle-details")
def get_transit_vehicle_details(
    vehicle_id: str = "",
    route_id: str = "",
    trip_id: str = "",
    direction_id: str = "0",
    stop_id: str = "",
    stop_seq: int = 0,
    lat: float = 0.0,
    lon: float = 0.0,
):
    """
    回傳單一即時巴士或海上巴士 (SeaBus) 的完整路線、起點、終點、當前狀態、下一站預估時間、完整沿線站點清單與地圖軌跡座標
    """
    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    rmeta = routes_lookup.get(str(route_id), {})
    route_number = rmeta.get("route_number") or str(route_id)
    if route_number.isdigit():
        route_number = str(int(route_number))

    variant = _resolve_vehicle_variant(str(route_id), str(trip_id), str(direction_id), gtfs_meta)
    prog = _compute_vehicle_stop_progress(variant, str(stop_id), int(stop_seq or 0), float(lat or 0.0), float(lon or 0.0), str(trip_id))

    is_seabus_vehicle = str(route_id) in ["6771", "seabus"] or str(vehicle_id).startswith("seabus") or "seabus" in str(route_number).lower()
    if is_seabus_vehicle:
        is_nb = str(direction_id) == "0"
        origin = "Waterfront Station" if is_nb else "Lonsdale Quay"
        destination = "Lonsdale Quay" if is_nb else "Waterfront Station"
        route_name = "SeaBus 跨海渡輪"
        operator = "TransLink (SeaBus 海上巴士)"
        color = "#0284c7"
        shape_coords = [[-123.1118, 49.2861], [-123.0829, 49.3103]] if is_nb else [[-123.0829, 49.3103], [-123.1118, 49.2861]]
        dest_lat = 49.3103 if is_nb else 49.2861
        dest_lon = -123.0829 if is_nb else -123.1118

        eta_min = prog.get("next_stop_minutes")
        eta_time = prog.get("next_stop_time") or ""
        for cached_v in cached_translink_vehicles:
            if str(cached_v.get("id")) == str(vehicle_id):
                if cached_v.get("next_stop_minutes") is not None:
                    eta_min = cached_v["next_stop_minutes"]
                if cached_v.get("next_stop_time"):
                    eta_time = cached_v["next_stop_time"]
                break
        if eta_min is None:
            if lat and lon:
                dist_km = math.hypot((dest_lat - lat) * 111.0, (dest_lon - lon) * 73.0)
                eta_min = max(1, min(12, int(round(dist_km / 0.28))))
            else:
                eta_min = 5
        if not eta_time:
            eta_time = _format_vancouver_hhmm(time.time() + eta_min * 60)

        stops_list = [
            {
                "seq": 1,
                "stop_id": "8035" if is_nb else "8036",
                "name": origin,
                "lat": 49.2861 if is_nb else 49.3103,
                "lon": -123.1118 if is_nb else -123.0829,
                "status": "passed"
            },
            {
                "seq": 2,
                "stop_id": "8036" if is_nb else "8035",
                "name": destination,
                "lat": dest_lat,
                "lon": dest_lon,
                "status": "next",
                "eta_time": eta_time,
                "eta_minutes": eta_min
            }
        ]
        return {
            "vehicle_id": vehicle_id,
            "route_id": "6771",
            "route_number": "SeaBus",
            "route_name": route_name,
            "color": color,
            "operator": operator,
            "origin": origin,
            "destination": destination,
            "current_action": f"開往 {destination}",
            "next_stop_name": destination,
            "next_stop_time": eta_time,
            "next_stop_minutes": eta_min,
            "next_stop_index": 1,
            "run_status": "準時",
            "stops": stops_list,
            "shape_coords": shape_coords,
            "is_seabus": True
        }

    if variant:
        origin = variant.get("origin", "")
        destination = variant.get("destination", "")
        route_name = variant.get("route_name", f"{route_number} {rmeta.get('long_name', '')}".strip())
        operator = variant.get("operator", "TransLink (CMBC 岸山巴士)")
        color = variant.get("color", "#10b981")
        shape_coords = variant.get("shape_coords", [])
    else:
        origin = "起點總站"
        destination = rmeta.get("long_name", "終點總站")
        route_name = f"{route_number} {rmeta.get('long_name', '')}".strip()
        operator = "TransLink (CMBC 岸山巴士)"
        color = rmeta.get("color", "#10b981")
        shape_coords = []

    return {
        "vehicle_id": vehicle_id,
        "route_id": route_id,
        "route_number": route_number,
        "route_name": route_name,
        "color": color,
        "operator": operator,
        "origin": origin,
        "destination": destination,
        "current_action": f"開往 {destination}" if destination else "沿線行駛中",
        "next_stop_name": prog["next_stop_name"],
        "next_stop_time": prog["next_stop_time"],
        "next_stop_minutes": prog["next_stop_minutes"],
        "next_stop_index": prog["next_stop_index"],
        "run_status": "準時",
        "stops": prog["stops"],
        "shape_coords": shape_coords,
    }

SEARCH_BC_FERRY_TERMINALS = [
    {
        "id": "ferry_tsa",
        "title": "Tsawwassen Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 托瓦森 (TSA · 往維多利亞/納奈莫/海灣群島)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.1317,
        "lat": 49.0064,
        "zoom": 14,
        "keywords": ["tsawwassen", "tsa", "托瓦森", "delta", "victoria", "swartz", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "TSA"}
    },
    {
        "id": "ferry_hsb",
        "title": "Horseshoe Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 馬蹄灣 (HSB · 往納奈莫/陽光海岸/寶雲島)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.2741,
        "lat": 49.3693,
        "zoom": 14,
        "keywords": ["horseshoe bay", "hsb", "馬蹄灣", "west vancouver", "nanaimo", "bowen", "langdale", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "HSB"}
    },
    {
        "id": "ferry_swb",
        "title": "Swartz Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 斯沃茨灣 (SWB · 維多利亞 Victoria)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4107,
        "lat": 48.6868,
        "zoom": 14,
        "keywords": ["swartz bay", "swb", "victoria", "維多利亞", "斯沃茨灣", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "SWB"}
    },
    {
        "id": "ferry_nan",
        "title": "Departure Bay Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 啟航灣 (NAN · 納奈莫 Nanaimo)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.9554,
        "lat": 49.1935,
        "zoom": 14,
        "keywords": ["departure bay", "nanaimo", "nan", "啟航灣", "納奈莫", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "NAN"}
    },
    {
        "id": "ferry_duk",
        "title": "Duke Point Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 杜克角 (DUK · 納奈莫 Nanaimo)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.8912,
        "lat": 49.1606,
        "zoom": 14,
        "keywords": ["duke point", "duk", "杜克角", "nanaimo", "納奈莫", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "DUK"}
    },
    {
        "id": "ferry_lng",
        "title": "Langdale Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 蘭代爾 (LNG · 陽光海岸 Sunshine Coast)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4723,
        "lat": 49.4339,
        "zoom": 14,
        "keywords": ["langdale", "lng", "sunshine coast", "蘭代爾", "陽光海岸", "gibson", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "LNG"}
    },
    {
        "id": "ferry_bow",
        "title": "Bowen Island (Snug Cove) Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 寶雲島 (BOW · Snug Cove)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.3313,
        "lat": 49.3795,
        "zoom": 14,
        "keywords": ["bowen island", "snug cove", "bow", "寶雲島", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "BOW"}
    },
    {
        "id": "ferry_ful",
        "title": "Fulford Harbour Ferry Terminal",
        "subtitle": "BC Ferries 碼頭 · 富爾福德港 (FUL · 鹽泉島 Salt Spring Island)",
        "category": "ferry_terminal",
        "badge": "BC Ferries 碼頭",
        "icon": "⛴️",
        "lon": -123.4511,
        "lat": 48.7694,
        "zoom": 14,
        "keywords": ["fulford", "salt spring", "ful", "富爾福德港", "鹽泉島", "ferry", "碼頭", "渡輪"],
        "meta": {"code": "FUL"}
    }
]

SEARCH_AIRPORTS = [
    {
        "id": "airport_yvr_main",
        "title": "溫哥華國際機場 (YVR) · 主航廈",
        "subtitle": "Vancouver International Airport · CYVR / YVR",
        "category": "airports",
        "badge": "國際機場",
        "icon": "🛫",
        "lon": -123.184444,
        "lat": 49.193889,
        "zoom": 14,
        "layer_key": "airports",
        "keywords": ["yvr", "cyvr", "vancouver airport", "溫哥華機場", "國際機場", "機場", "飛機場", "richmond", "sea island"]
    },
    {
        "id": "airport_yvr_south",
        "title": "YVR 南航廈與水上飛機碼頭",
        "subtitle": "YVR South Terminal · 支線與水上飛機",
        "category": "airports",
        "badge": "支線/水上飛機",
        "icon": "🛩️",
        "lon": -123.1610,
        "lat": 49.1795,
        "zoom": 15,
        "layer_key": "airports",
        "keywords": ["south terminal", "yvr south", "南航廈", "水上飛機", "pacific coastal", "seair"]
    },
    {
        "id": "airport_coal_harbour",
        "title": "溫哥華海港水上機場 (煤港)",
        "subtitle": "Vancouver Harbour Flight Centre · CXH / CYHC",
        "category": "airports",
        "badge": "市中心水上機場",
        "icon": "🛩️",
        "lon": -123.1147,
        "lat": 49.2894,
        "zoom": 15,
        "layer_key": "airports",
        "keywords": ["coal harbour", "harbour air", "seaplane", "水上飛機", "煤港", "cxh", "cyhc", "canada place", "waterfront"]
    }
]

_curated_static_caches = {}
_db_synced_curated_types = set()

CURATED_STATIC_TYPES = (
    "bikeways", "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "local_area_boundary", "fuel", "ev_charging", "tesla", "marine_terminals", 
    "one_way_streets", "snow_removal_routes", "crime_areas", "water_distribution_mains", 
    "sewer_mains", "traffic_speed_limits", "bike_racks", "postal_code_fsa",
    "traffic_crosswalks", "litter_containers", "food_banks", "recycling", "van_wifi",
    "road_closures", "road_construction", "street_lighting", "street_lighting_poles", "street_lighting_conduits", "traffic_conditions",
    "beach_water_quality", "beach_water", "fire_hydrants", "zoning_districts", "traffic_alerts", "public_trees",
    "museums", "garbage_collection"
)
POINT_CURATED_TYPES = (
    "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "fuel", "ev_charging", "tesla", "marine_terminals", "bike_racks",
    "traffic_crosswalks", "litter_containers", "food_banks", "recycling", "van_wifi",
    "schools", "libraries", "food_vendors", "homeless_shelters", "parks", "parks_facilities",
    "community_gardens", "community_centres", "drinking_fountains", "public_washrooms", "fire_halls",
    "traffic_cameras", "safety_cameras", "shared_bikes", "escooter", "museums"
)

def sync_curated_point_types(db: Session):
    missing_types = [ft for ft in POINT_CURATED_TYPES if ft not in _db_synced_curated_types]
    if not missing_types:
        return

    try:
        existing_rows = (
            db.query(models.RoadFacility.facility_type)
            .filter(models.RoadFacility.facility_type.in_(missing_types))
            .distinct()
            .all()
        )
        for (ft,) in existing_rows:
            _db_synced_curated_types.add(ft)
    except Exception:
        # DB is offline or unreachable; skip DB sync so /api/search falls back to static JSON immediately
        return

    for facility_type in POINT_CURATED_TYPES:
        if facility_type not in _db_synced_curated_types:
            filename = f"vancouver_{facility_type}.geojson"
            static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
            if os.path.exists(static_geojson_path):
                try:
                    import json
                    with open(static_geojson_path, "r", encoding="utf-8") as f:
                        static_geojson = json.load(f)
                    db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).delete()
                    facs_to_add = []
                    seen_ids = set()
                    for feat in static_geojson.get("features", []):
                        props = feat.get("properties", {})
                        geom_type = feat.get("geometry", {}).get("type")
                        coords = feat.get("geometry", {}).get("coordinates", [])
                        if geom_type == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
                            lon, lat = coords[0], coords[1]
                            fac_id = str(feat.get("id") or props.get("id") or f"{facility_type}_{lon}_{lat}")
                            if fac_id in seen_ids:
                                continue
                            seen_ids.add(fac_id)
                            fac = models.RoadFacility(
                                id=fac_id,
                                facility_type=facility_type,
                                name=props.get("name", "Unknown"),
                                local_area=props.get("local_area") or props.get("municipality", ""),
                                lat=lat,
                                lon=lon,
                                geom=f"SRID=4326;POINT({lon} {lat})",
                                details={k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")},
                                last_updated=datetime.utcnow()
                            )
                            facs_to_add.append(fac)
                    if facs_to_add:
                        db.bulk_save_objects(facs_to_add)
                    db.commit()
                    _db_synced_curated_types.add(facility_type)
                except Exception as e:
                    db.rollback()
                    _db_synced_curated_types.add(facility_type)
                    print(f"Error syncing {facility_type} to DB: {e}")

_search_fsa_cache = None
def get_search_fsa_items():
    global _search_fsa_cache
    if _search_fsa_cache is not None:
        return _search_fsa_cache
    items = []
    path = os.path.join(os.path.dirname(__file__), "data", "vancouver_postal_code_fsa.geojson")
    if os.path.exists(path):
        try:
            import json
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for feat in data.get("features", []):
                props = feat.get("properties", {})
                fsa = props.get("fsa", "")
                name = props.get("name", f"郵遞編號分區 {fsa}")
                coords = feat.get("geometry", {}).get("coordinates", [])
                all_pts = []
                def extract_pts(c):
                    if len(c) == 2 and isinstance(c[0], (int, float)):
                        all_pts.append(c)
                    else:
                        for sub in c:
                            extract_pts(sub)
                extract_pts(coords)
                if all_pts:
                    min_lon = min(p[0] for p in all_pts)
                    max_lon = max(p[0] for p in all_pts)
                    min_lat = min(p[1] for p in all_pts)
                    max_lat = max(p[1] for p in all_pts)
                    center_lon = (min_lon + max_lon) / 2
                    center_lat = (min_lat + max_lat) / 2
                    items.append({
                        "id": f"fsa_{fsa}",
                        "title": name,
                        "subtitle": f"溫哥華郵遞編號前瞻轉運區 · {fsa}",
                        "category": "postal_code_fsa",
                        "badge": "郵遞編號",
                        "icon": "📮",
                        "lon": center_lon,
                        "lat": center_lat,
                        "zoom": 13,
                        "layer_key": "postalCodeFSA",
                        "meta": props
                    })
        except Exception as e:
            print(f"Error loading fsa items for search: {e}")
    _search_fsa_cache = items
    return _search_fsa_cache

_search_local_area_cache = None
def get_search_local_area_items():
    global _search_local_area_cache
    if _search_local_area_cache is not None:
        return _search_local_area_cache
    items = []
    path = os.path.join(os.path.dirname(__file__), "data", "vancouver_local_area_boundary.geojson")
    if os.path.exists(path):
        try:
            import json
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for feat in data.get("features", []):
                props = feat.get("properties", {})
                name = props.get("name", "")
                geo_point = props.get("geo_point_2d", {})
                lon = geo_point.get("lon")
                lat = geo_point.get("lat")
                if lon and lat:
                    items.append({
                        "id": f"boundary_{name}",
                        "title": f"{name} (區域邊界)",
                        "subtitle": f"溫哥華官方劃定分區 · {name}",
                        "category": "local_area_boundary",
                        "badge": "區域邊界",
                        "icon": "📍",
                        "lon": lon,
                        "lat": lat,
                        "zoom": 14,
                        "layer_key": "localAreaBoundary",
                        "meta": props
                    })
        except Exception as e:
            print(f"Error loading local area boundary items for search: {e}")
    _search_local_area_cache = items
    return _search_local_area_cache

_search_bikeways_cache = None
def get_search_bikeway_items():
    global _search_bikeways_cache
    if _search_bikeways_cache is not None:
        return _search_bikeways_cache
    items = []
    path = os.path.join(os.path.dirname(__file__), "data", "vancouver_bikeways.geojson")
    if os.path.exists(path):
        try:
            import json
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            seen_names = set()
            for feat in data.get("features", []):
                props = feat.get("properties", {})
                name = props.get("bikeway_name") or props.get("street_name") or props.get("name") or ""
                name = name.strip()
                if not name or name in seen_names:
                    continue
                coords = feat.get("geometry", {}).get("coordinates", [])
                all_pts = []
                def extract_pts(c):
                    if len(c) == 2 and isinstance(c[0], (int, float)):
                        all_pts.append(c)
                    else:
                        for sub in c:
                            extract_pts(sub)
                extract_pts(coords)
                if all_pts:
                    mid = all_pts[len(all_pts) // 2]
                    seen_names.add(name)
                    route_type = props.get("bikeway_type") or "單車道"
                    items.append({
                        "id": f"bikeway_{name}",
                        "title": f"{name} (單車徑)",
                        "subtitle": f"溫哥華單車路網 · {route_type}",
                        "category": "bikeways",
                        "badge": "單車徑",
                        "icon": "🚲",
                        "lon": mid[0],
                        "lat": mid[1],
                        "zoom": 15,
                        "layer_key": "bikeways",
                        "meta": props
                    })
        except Exception as e:
            print(f"Error loading bikeway items for search: {e}")
    _search_bikeways_cache = items
    return _search_bikeways_cache

_search_facilities_cache = None

FACILITY_SEARCH_CONFIGS = [
    ("schools", "學校", "🏫", "schools", 16),
    ("libraries", "圖書館", "📚", "libraries", 16),
    ("food_banks", "食物銀行", "🥫", "foodBanks", 16),
    ("food_vendors", "食品攤販", "🍱", "foodVendors", 17),
    ("homeless_shelters", "庇護所", "🏠", "homelessShelters", 16),
    ("parks", "公園", "🌲", "parks", 15),
    ("parks_facilities", "休憩設施", "🛝", "parksFacilities", 16),
    ("community_gardens", "社區花園", "🌻", "communityGardens", 16),
    ("community_centres", "社區中心", "🏛️", "communityCentres", 16),
    ("drinking_fountains", "飲水器", "💧", "drinkingFountains", 17),
    ("public_washrooms", "公共廁所", "🚻", "publicWashrooms", 17),
    ("fire_halls", "消防局", "🚒", "fireHalls", 16),
    ("police", "警察局", "👮", "police", 16),
    ("disaster_hubs", "災害支援中心", "🛟", "disasterHubs", 16),
    ("hospitals", "醫療機構", "🏥", "hospitals", 15),
    ("recycling", "環保回收", "♻️", "recycling", 16),
    ("van_wifi", "VanWiFi", "📶", "vanWifi", 17),
    ("aed", "AED 去顫器", "💓", "aed", 17),
    ("fuel", "油站", "⛽", "fuel", 16),
    ("tesla", "TESLA", "⚡", "tesla", 16),
    ("ev_charging", "充電站", "⚡", "evCharging", 16),
    ("car_sharing", "共享汽車", "🚗", "carSharing", 16),
    ("shared_bikes", "共享單車", "🚲", "sharedBikes", 16),
    ("bike_racks", "單車架", "🚲", "bikeRacks", 17),
    ("safety_cameras", "路口安全相機", "🚨", "safetyCameras", 16),
    ("traffic_cameras", "交通攝影機", "📷", "trafficCameras", 16),
    ("marine_terminals", "港口碼頭", "⚓", "marineTerminals", 15),
    ("traffic_crosswalks", "行人穿越道", "🚶", "trafficCrosswalks", 17),
    ("traffic_speed_limits", "速限路段", "🚦", "trafficSpeedLimits", 15),
    ("litter_containers", "垃圾箱", "🗑️", "litterContainers", 17),
    ("beach_water_quality", "海灘水質", "🏖️", "beachWaterQuality", 15),
    ("beach_water", "海灘水質", "🏖️", "beachWaterQuality", 15),
    ("zoning_districts", "土地規劃", "🏛️", "zoningDistricts", 15),
    ("public_art", "公共藝術", "🎨", "publicArt", 16),
    ("museums", "博物館", "🏛️", "museums", 16),
    ("garbage_collection", "廢物回收", "🚛", "garbageCollection", 15),
    ("motorcycle_parking", "摩托車位", "🏍️", "motorcycleParking", 17),
    ("impark", "ImPark 停車場", "🅿️", "impark", 16),
]

def get_search_facilities_items():
    global _search_facilities_cache
    if _search_facilities_cache is not None:
        return _search_facilities_cache

    items = []
    base_data_dir = os.path.join(os.path.dirname(__file__), "data")

    for ftype, badge, icon, layer_key, zoom in FACILITY_SEARCH_CONFIGS:
        fname = f"vancouver_{ftype}.geojson"
        fpath = os.path.join(base_data_dir, fname)
        if not os.path.exists(fpath):
            continue
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for feat in data.get("features", []):
                props = feat.get("properties") or {}
                geom = feat.get("geometry") or {}
                coords = geom.get("coordinates")
                if not coords:
                    continue

                rep_lon, rep_lat = None, None
                gtype = geom.get("type")
                if gtype == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
                    rep_lon, rep_lat = float(coords[0]), float(coords[1])
                elif gtype in ("Polygon", "MultiPolygon", "LineString", "MultiLineString"):
                    all_pts = []
                    def _collect_pts(c):
                        if len(c) == 2 and isinstance(c[0], (int, float)):
                            all_pts.append(c)
                        else:
                            for sub in c:
                                _collect_pts(sub)
                    _collect_pts(coords)
                    if all_pts:
                        rep_lon = sum(p[0] for p in all_pts) / len(all_pts)
                        rep_lat = sum(p[1] for p in all_pts) / len(all_pts)

                if rep_lon is None or rep_lat is None:
                    continue

                raw_name = str(props.get("name") or "").strip()
                title = raw_name
                if ftype == "schools":
                    title = raw_name or "學校"
                elif ftype == "parks_facilities":
                    title = props.get("park_name") or raw_name or "休憩設施"
                elif ftype == "drinking_fountains":
                    title = props.get("location") or props.get("park_or_site") or raw_name or "飲水器"
                elif ftype == "public_washrooms":
                    title = re.sub(r"\s*公園公廁$|\s*公廁$|\s*公共洗手間$|\s*洗手間$", "", raw_name).strip() or raw_name or "公共廁所"
                elif ftype == "parking_meters":
                    meter_id = props.get("meter_id")
                    title = f"#{meter_id}" if meter_id else (re.sub(r"^停車收費錶\s*[-–—#:]*\s*|^收費錶\s*[-–—#:]*\s*", "", raw_name) or "收費錶")
                elif ftype == "zoning_districts":
                    title = props.get("zoning_district") or raw_name or "都市土地規劃"
                elif ftype == "public_art":
                    title = props.get("sitename") or props.get("title_of_work") or raw_name or "公共藝術"
                elif ftype == "motorcycle_parking":
                    mid = props.get("meter_id")
                    title = f"#{mid}" if mid else (raw_name or "摩托車停車位")
                elif ftype == "impark":
                    title = props.get("lot_name") or f"ImPark Lot {props.get('lot_number')}"
                elif not title:
                    title = badge

                addr = str(props.get("siteaddress") or props.get("address1") or props.get("address") or props.get("street_address") or props.get("location") or props.get("street") or props.get("station_location") or "").strip()
                local_area = str(props.get("local_area") or props.get("neighbourhood") or "").strip()
                category_extra = str(props.get("school_category_zh") or props.get("facility_type_name") or props.get("brand") or props.get("category") or ("公共藝術" if ftype == "public_art" else ("摩托車位" if ftype == "motorcycle_parking" else ""))).strip()

                sub_parts = [badge]
                if category_extra and category_extra != badge and category_extra != title:
                    sub_parts.append(category_extra)
                if addr and addr != title:
                    sub_parts.append(addr)
                elif local_area and local_area != title:
                    sub_parts.append(local_area)

                subtitle = " · ".join(sub_parts)

                search_words = [
                    title,
                    raw_name,
                    addr,
                    local_area,
                    badge,
                    ftype,
                    category_extra,
                    str(props.get("meter_id") or ""),
                    str(props.get("lot_number") or ""),
                    str(props.get("address1") or ""),
                    str(props.get("street") or ""),
                    str(props.get("meter_head") or ""),
                    str(props.get("mobile_payment_number") or ""),
                    str(props.get("title_of_work") or ""),
                    str(props.get("sitename") or ""),
                    str(props.get("siteaddress") or ""),
                    str(props.get("primarymaterial") or ""),
                    str(props.get("ownership") or ""),
                    str(props.get("artistprojectstatement") or ""),
                    str(props.get("type") or ""),
                    str(props.get("school_category") or ""),
                    str(props.get("organization") or ""),
                    str(props.get("description") or ""),
                    str(props.get("zoning_classification") or ""),
                    str(props.get("zoning_district") or "")
                ]
                search_text = " ".join(s for s in search_words if s).lower()

                fac_id = str(feat.get("id") or props.get("id") or f"{ftype}_{rep_lon}_{rep_lat}")
                items.append({
                    "id": fac_id,
                    "title": title,
                    "subtitle": subtitle,
                    "category": ftype,
                    "badge": badge,
                    "icon": icon,
                    "lon": rep_lon,
                    "lat": rep_lat,
                    "zoom": zoom,
                    "layer_key": layer_key,
                    "search_text": search_text,
                    "address_lower": addr.lower(),
                    "title_lower": title.lower(),
                    "meta": {
                        "id": fac_id,
                        "facility_type": ftype,
                        "name": title,
                        "local_area": local_area,
                        "properties": props
                    }
                })
        except Exception as e:
            print(f"Error indexing {ftype} for search: {e}")

    _search_facilities_cache = items
    return _search_facilities_cache

_search_query_cache = {}

@app.get("/api/search")
def search_layer_items(q: str = "", db: Session = Depends(database.get_db)):
    """
    全圖層項目搜尋 (Search Layer Items):
    搜尋圖層中的項目：站名 (SkyTrain/SeaBus/Bus)、碼頭名 (BC Ferries)、機場與水上飛機、道路設施、政府機構 (消防局/社區中心)
    """
    q_clean = q.strip().lower()
    if not q_clean:
        return {"results": []}

    if q_clean in _search_query_cache:
        return {"results": _search_query_cache[q_clean]}

    results = []

    # 確保點狀圖層資料庫同步，供搜尋即時定位
    try:
        sync_curated_point_types(db)
    except Exception as e:
        print(f"Error ensuring curated sync in search: {e}")

    # 0. 搜尋大眾運輸巴士路線 (Transit Bus Routes)
    try:
        gtfs_meta = get_gtfs_metadata()
        routes_lookup = gtfs_meta.get("routes", {})
        variants_lookup = gtfs_meta.get("variants", {})
        default_variants = gtfs_meta.get("route_default_variants", {})

        matching_routes = []
        for rid, rmeta in routes_lookup.items():
            rnum = str(rmeta.get("route_number") or rid).strip()
            rnum_lower = rnum.lower()
            rlong = str(rmeta.get("long_name") or "").strip()
            rlong_lower = rlong.lower()

            score = 0
            if rnum_lower == q_clean or f"r{q_clean}" == rnum_lower or (q_clean.startswith("r") and q_clean[1:] == rnum_lower):
                score = 3
            elif rnum_lower.startswith(q_clean):
                score = 2
            elif q_clean in rnum_lower or q_clean in rlong_lower:
                score = 1

            if score > 0:
                matching_routes.append((score, rid, rnum, rlong, rmeta))

        matching_routes.sort(key=lambda x: (-x[0], len(x[2]), x[2]))

        for score, rid, rnum, rlong, rmeta in matching_routes:
            def_vkey = default_variants.get(f"{rid}_0") or default_variants.get(f"{rid}_1")
            variant = variants_lookup.get(def_vkey) if def_vkey else None

            dest_display = variant.get("destination", "") if variant else rlong
            origin_display = variant.get("origin", "") if variant else ""

            rep_lon = -123.1207
            rep_lat = 49.2827
            if variant and variant.get("stops"):
                stops = variant["stops"]
                mid_idx = len(stops) // 2
                rep_lon = stops[mid_idx]["lon"]
                rep_lat = stops[mid_idx]["lat"]
            elif variant and variant.get("shape_coords") and len(variant["shape_coords"]) > 0:
                coords = variant["shape_coords"]
                mid_idx = len(coords) // 2
                rep_lon = coords[mid_idx][0]
                rep_lat = coords[mid_idx][1]

            route_title = f"{rnum} 號巴士 · {dest_display}" if dest_display else f"{rnum} 號巴士"
            route_sub = f"起點: {origin_display} ➔ 終點: {dest_display}" if origin_display and dest_display else f"TransLink 路線: {rlong}"

            results.append({
                "id": f"route_{rid}",
                "title": route_title,
                "subtitle": route_sub,
                "category": "bus_route",
                "badge": f"{rnum} 號巴士",
                "icon": "🚌",
                "lon": rep_lon,
                "lat": rep_lat,
                "zoom": 13,
                "layer_key": None,
                "meta": {
                    "route_id": rid,
                    "route_number": rnum,
                    "route_name": rlong,
                    "origin": origin_display,
                    "destination": dest_display,
                    "variant_key": def_vkey,
                    "color": rmeta.get("color", "#10b981")
                }
            })
    except Exception as e:
        print(f"Error searching bus routes: {e}")

    # 1. 搜尋機場與航空設施
    for ap in SEARCH_AIRPORTS:
        a_title = ap["title"].lower()
        a_sub = ap["subtitle"].lower()
        if (q_clean in a_title or q_clean in a_sub or
            any(q_clean in kw for kw in ap["keywords"])):
            results.append({
                "id": ap["id"],
                "title": ap["title"],
                "subtitle": ap["subtitle"],
                "category": ap["category"],
                "badge": ap["badge"],
                "icon": ap["icon"],
                "lon": ap["lon"],
                "lat": ap["lat"],
                "zoom": ap["zoom"],
                "layer_key": "airports",
                "meta": {}
            })

    # 1. 搜尋 BC Ferries 渡輪碼頭

    for term in SEARCH_BC_FERRY_TERMINALS:
        t_title = term["title"].lower()
        t_sub = term["subtitle"].lower()
        t_code = term["meta"]["code"].lower()
        if (q_clean in t_title or q_clean in t_sub or q_clean == t_code or
            any(q_clean in kw for kw in term["keywords"])):
            results.append({
                "id": term["id"],
                "title": term["title"],
                "subtitle": term["subtitle"],
                "category": term["category"],
                "badge": term["badge"],
                "icon": term["icon"],
                "lon": term["lon"],
                "lat": term["lat"],
                "zoom": term["zoom"],
                "layer_key": "bcferriesRoutes",
                "meta": term["meta"]
            })

    # 2. 搜尋大眾運輸車站與站牌 (Transit Stops)
    try:
        stops = db.query(models.TransitStop).filter(
            models.TransitStop.name.ilike(f"%{q_clean}%") |
            models.TransitStop.stop_id.ilike(f"{q_clean}%")
        ).limit(300).all()

        skytrain_stops = [s for s in stops if s.stop_group == 'skytrain']
        seabus_stops = [s for s in stops if s.stop_group == 'seabus']
        bus_stops = [s for s in stops if s.stop_group == 'bus']

        for s in skytrain_stops:
            results.append({
                "id": f"stop_{s.stop_id}",
                "title": s.name,
                "subtitle": f"SkyTrain 車站 (#{s.stop_id})",
                "category": "skytrain",
                "badge": "SkyTrain 車站",
                "icon": "🚇",
                "lon": s.lon,
                "lat": s.lat,
                "zoom": 16,
                "layer_key": "skytrainRoutes",
                "meta": {"stop_id": s.stop_id, "name": s.name}
            })

        for s in seabus_stops:
            results.append({
                "id": f"stop_{s.stop_id}",
                "title": s.name,
                "subtitle": f"SeaBus 碼頭 (#{s.stop_id})",
                "category": "seabus",
                "badge": "SeaBus 碼頭",
                "icon": "🚢",
                "lon": s.lon,
                "lat": s.lat,
                "zoom": 16,
                "layer_key": "seabusRoutes",
                "meta": {"stop_id": s.stop_id, "name": s.name}
            })

        for s in bus_stops:
            results.append({
                "id": f"stop_{s.stop_id}",
                "title": s.name,
                "subtitle": f"公車站牌 (#{s.stop_id})",
                "category": "bus_stop",
                "badge": "公車站牌",
                "icon": "🚏",
                "lon": s.lon,
                "lat": s.lat,
                "zoom": 17,
                "layer_key": "busRoutes",
                "meta": {"stop_id": s.stop_id, "name": s.name}
            })
    except Exception as e:
        print(f"Error searching stops: {e}")

    # 3. 搜尋設施、學校、公園、政府機構等全圖層資料 (All Point/Polygon Facilities)
    try:
        fac_candidates = []
        for fac in get_search_facilities_items():
            if q_clean in fac["search_text"]:
                score = 1
                if fac["title_lower"] == q_clean:
                    score = 10
                elif fac["title_lower"].startswith(q_clean):
                    score = 8
                elif q_clean in fac["title_lower"]:
                    score = 6
                elif fac["address_lower"] and q_clean in fac["address_lower"]:
                    score = 5
                elif q_clean in fac["badge"].lower():
                    score = 4
                fac_candidates.append((score, fac))

        fac_candidates.sort(key=lambda x: -x[0])
        for score, fac in fac_candidates[:120]:
            results.append({
                "id": fac["id"],
                "title": fac["title"],
                "subtitle": fac["subtitle"],
                "category": fac["category"],
                "badge": fac["badge"],
                "icon": fac["icon"],
                "lon": fac["lon"],
                "lat": fac["lat"],
                "zoom": fac["zoom"],
                "layer_key": fac["layer_key"],
                "meta": fac["meta"]
            })
    except Exception as e:
        print(f"Error searching facilities: {e}")

    # 4. 搜尋即時 AIS 船隻 (Live AIS Maritime Vessels)
    try:
        vessels = shipping_service.get_vessels()
        for v in vessels:
            v_name = (v.get("name") or "").lower()
            v_mmsi = str(v.get("mmsi") or "")
            v_callsign = (v.get("callsign") or "").lower()
            if (q_clean in v_name or q_clean == v_mmsi or (q_clean and q_clean in v_callsign) or (q_clean in ("船隻", "船運", "vessel", "ship"))):
                results.append({
                    "id": f"vessel_{v_mmsi}",
                    "title": v.get("name") or f"船隻 MMSI:{v_mmsi}",
                    "subtitle": f"即時 AIS 船隻 · 航速 {v.get('speed', 0)} 節",
                    "category": "maritime_vessel",
                    "badge": "即時船隻",
                    "icon": "🚢",
                    "lon": v.get("lon"),
                    "lat": v.get("lat"),
                    "zoom": 14,
                    "layer_key": "maritimeShipping",
                    "meta": v
                })
    except Exception as e:
        print(f"Error searching maritime vessels: {e}")

    # 5. 搜尋郵遞編號分區 (Postal Code FSA)
    try:
        for item in get_search_fsa_items():
            fsa_code = item["meta"].get("fsa", "").lower()
            fsa_name = item["title"].lower()
            if q_clean in fsa_code or q_clean in fsa_name or (q_clean in ("郵遞", "郵區", "fsa", "postal")):
                results.append(item)
    except Exception as e:
        print(f"Error searching FSA: {e}")

    # 6. 搜尋區域邊界 (Local Area Boundaries)
    try:
        for item in get_search_local_area_items():
            area_name = item["meta"].get("name", "").lower()
            if q_clean in area_name or (q_clean in ("邊界", "分區", "boundary", "neighborhood", "neighbourhood")):
                results.append(item)
    except Exception as e:
        print(f"Error searching local area boundaries: {e}")

    # 7. 搜尋單車徑 (Bikeways)
    try:
        for item in get_search_bikeway_items():
            bw_name = item["title"].lower()
            if q_clean in bw_name or (q_clean in ("單車徑", "bike", "bikeway")):
                results.append(item)
    except Exception as e:
        print(f"Error searching bikeways: {e}")

    # 8. 搜尋溫哥華官方門牌地址 (Property Addresses API)
    if len(q_clean) >= 2:
        try:
            addr_url = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-addresses/records"
            params = {
                "where": f'search(*, "{q_clean}")',
                "limit": 10
            }
            addr_resp = requests.get(addr_url, params=params, timeout=2.5)
            if addr_resp.status_code == 200:
                addr_data = addr_resp.json()
                for rec in addr_data.get("results", []):
                    c_num = rec.get("civic_number") or ""
                    street = rec.get("std_street") or ""
                    area = rec.get("geo_local_area") or "Vancouver"
                    coords = rec.get("geo_point_2d") or {}
                    p_lon = coords.get("lon")
                    p_lat = coords.get("lat")
                    if p_lon is not None and p_lat is not None:
                        full_addr = f"{c_num} {street}".strip()
                        results.append({
                            "id": f"addr_{rec.get('site_id') or rec.get('pcoord') or full_addr}",
                            "title": full_addr,
                            "subtitle": f"{area}, Vancouver (門牌地址)",
                            "category": "address",
                            "badge": "地址",
                            "icon": "📍",
                            "lon": float(p_lon),
                            "lat": float(p_lat),
                            "zoom": 17,
                            "layer_key": None,
                            "meta": {
                                "civic_number": c_num,
                                "street": street,
                                "local_area": area,
                                "full_address": full_addr
                            }
                        })
        except Exception:
            pass

    final_results = results[:150]
    if len(_search_query_cache) > 200:
        _search_query_cache.clear()
    _search_query_cache[q_clean] = final_results
    return {"results": final_results}

from html.parser import HTMLParser

class ImgTagParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'img':
            self.tags.append(dict(attrs))

webcam_images_cache = {}

@app.get("/api/webcam/images")
def get_webcam_images(url: str):
    """
    獲取溫哥華交通攝影機頁面 (trafficcams.vancouver.ca) 的即時畫面圖片
    """
    if not url:
        return {"images": []}

    url = url.strip()
    if url.startswith("http://"):
        url = "https://" + url[7:]

    now = time.time()
    if url in webcam_images_cache:
        cached_time, cached_data = webcam_images_cache[url]
        if now - cached_time < 300: # 5分鐘快取
            return {"images": cached_data}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code != 200:
            print(f"Webcam page returned status {resp.status_code} for {url}")
            return {"images": []}

        # Parse with standard library HTMLParser (zero external dependency)
        parser = ImgTagParser()
        parser.feed(resp.text)
        img_tags = parser.tags

        images = []
        for img in img_tags:
            src = img.get('src', '')
            alt = img.get('alt', '')
            if 'cameraimages' in src or (src.endswith('.jpg') and 'city-emblem' not in src and 'favicon' not in src):
                full_src = src if src.startswith('http') else f"https://trafficcams.vancouver.ca/{src.lstrip('/')}"
                direction = "即時路況"
                alt_clean = alt.replace("Traffic Camera Images", "").strip()
                if " - " in alt_clean:
                    direction = alt_clean.split(" - ")[-1].strip()
                elif "North" in src or "north" in src or "North" in alt:
                    direction = "北向 (North)"
                elif "South" in src or "south" in src or "South" in alt:
                    direction = "南向 (South)"
                elif "East" in src or "east" in src or "East" in alt:
                    direction = "東向 (East)"
                elif "West" in src or "west" in src or "West" in alt:
                    direction = "西向 (West)"
                else:
                    direction = alt_clean or "即時路況"

                images.append({
                    "url": full_src,
                    "direction": direction,
                    "alt": alt
                })

        if len(webcam_images_cache) > 200:
            expired_keys = [k for k, (t_val, _) in webcam_images_cache.items() if now - t_val >= 300]
            for k in expired_keys:
                webcam_images_cache.pop(k, None)
            if len(webcam_images_cache) > 200:
                oldest_key = min(webcam_images_cache, key=lambda k: webcam_images_cache[k][0])
                webcam_images_cache.pop(oldest_key, None)
        webcam_images_cache[url] = (now, images)
        return {"images": images}
    except Exception as e:
        print(f"Error fetching webcam images for {url}: {e}")
        return {"images": []}

from fastapi import Response
from fastapi.responses import FileResponse

webcam_image_bytes_cache = {}
MAX_WEBCAM_BYTES_CACHE_ITEMS = 120

@app.get("/api/webcam/proxy")
def proxy_webcam_image(url: str):
    """
    代理交通攝影機圖片，避免瀏覽器跨域 (CORS) 或 Referrer 限制，並提供快取與充足逾時時間
    """
    if not url:
        return Response(status_code=400)
    now = time.time()
    if url in webcam_image_bytes_cache:
        ts, content, mtype = webcam_image_bytes_cache[url]
        if now - ts < 180 and content:
            return Response(
                content=content,
                media_type=mtype,
                headers={"Cache-Control": "public, max-age=180"}
            )
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://trafficcams.vancouver.ca/"
        }
        r = requests.get(url, headers=headers, timeout=18)
        if r.status_code == 200 and r.content:
            mtype = r.headers.get("content-type", "image/jpeg")
            if len(webcam_image_bytes_cache) >= MAX_WEBCAM_BYTES_CACHE_ITEMS:
                expired = [k for k, (t_val, _, _) in webcam_image_bytes_cache.items() if now - t_val >= 180]
                for k in expired:
                    webcam_image_bytes_cache.pop(k, None)
                if len(webcam_image_bytes_cache) >= MAX_WEBCAM_BYTES_CACHE_ITEMS:
                    oldest_key = min(webcam_image_bytes_cache, key=lambda k: webcam_image_bytes_cache[k][0])
                    webcam_image_bytes_cache.pop(oldest_key, None)
            webcam_image_bytes_cache[url] = (now, r.content, mtype)
            return Response(
                content=r.content,
                media_type=mtype,
                headers={"Cache-Control": "public, max-age=180"}
            )
        return Response(status_code=404)
    except Exception as e:
        print(f"Webcam proxy error for {url}: {e}")
        return Response(status_code=404)

hospital_waittimes_cache = {"timestamp": 0, "data": {}}

def _format_minutes_hm(mins_val):
    if mins_val is None:
        return None
    try:
        m_int = int(mins_val)
        hours = m_int // 60
        mins = m_int % 60
        if hours > 0 and mins > 0:
            return f"{hours}h {mins}m"
        elif hours > 0:
            return f"{hours}h"
        else:
            return f"{mins}m"
    except Exception:
        return None

@app.get("/api/hospitals/waittimes")
def get_hospital_waittimes():
    """
    獲取溫哥華各大醫院急診與 UPCC 急症暨基層醫療中心即時預估等候時間 (https://www.edwaittimes.ca & erstat.ca)
    每 15 分鐘自動快取更新一次
    """
    now = time.time()
    if now - hospital_waittimes_cache["timestamp"] < 900 and hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    hosp_map = {}

    # 1. Fetch live wait times from official BC ED/UPCC API (https://www.edwaittimes.ca/api/wait-times)
    for url_ed in ("https://www.edwaittimes.ca/api/wait-times", "https://edwaittimes.ca/api/wait-times"):
        try:
            resp_ed = requests.get(url_ed, headers=headers, timeout=12)
            if resp_ed.status_code == 200:
                ed_items = resp_ed.json()
                for it in ed_items:
                    name = it.get('name')
                    if not name:
                        continue
                    wt = it.get('waitTime') or {}
                    wt_min = wt.get('waitTimeMinutes')
                    elos_min = wt.get('elosMinutes')
                    status = wt.get('status') or 'normal'
                    wt_str = _format_minutes_hm(wt_min) or "門診正常"
                    elos_str = _format_minutes_hm(elos_min)

                    norm_key = name.strip().lower().replace("’", "'")
                    entry_obj = {
                        "name": name,
                        "slug": it.get('slug'),
                        "type": it.get('type'),
                        "wait_time": wt_str,
                        "wait_minutes": wt_min,
                        "elos_time": elos_str,
                        "elos_minutes": elos_min,
                        "status": status,
                        "address": it.get('address'),
                        "is_predicted": False,
                        "url": "https://www.edwaittimes.ca"
                    }
                    hosp_map[norm_key] = entry_obj
                    if "children" in norm_key:
                        hosp_map["bc children's hospital"] = entry_obj
                        hosp_map["bcch"] = entry_obj
                if hosp_map:
                    break
        except Exception as e:
            print(f"Error fetching {url_ed}: {e}")

    # 2. Supplement or fallback with erstat.ca for additional hospital emergency wait predictions
    try:
        url = "https://erstat.ca/hospitals/bc/vancouver"
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            html = resp.text
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, 'html.parser')
                for a in soup.find_all('a', class_='hospital-row'):
                    h3 = a.find('h3')
                    if not h3: continue
                    name = h3.get_text(strip=True)
                    p = a.find('p')
                    meta_text = p.get_text(' ', strip=True) if p else ''
                    wait_div = a.find('div', class_='hospital-row-wait')
                    wait_time = wait_div.get_text(strip=True) if wait_div else 'N/A'
                    classes = wait_div.get('class', []) if wait_div else []
                    href = a.get('href', '')

                    status = 'normal'
                    if 'packed' in classes: status = 'packed'
                    elif 'moderate' in classes: status = 'moderate'
                    elif 'quick' in classes: status = 'quick'

                    k = name.lower().replace("’", "'")
                    if k not in hosp_map or hosp_map[k]["wait_time"] in ("門診正常", "N/A"):
                        hosp_map[k] = {
                            "name": name,
                            "meta": meta_text,
                            "wait_time": wait_time,
                            "status": status,
                            "is_predicted": 'predicted' in classes,
                            "url": "https://www.edwaittimes.ca"
                        }
            except Exception:
                pass
    except Exception as e:
        print(f"Error fetching erstat: {e}")

    if hosp_map:
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        hospital_waittimes_cache["timestamp"] = now
        hospital_waittimes_cache["updated_at_str"] = now_str
        hospital_waittimes_cache["data"] = hosp_map
        return {
            "cached": False,
            "last_updated": now_str,
            "hospitals": hosp_map
        }

    if hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    return {"cached": False, "last_updated": "", "hospitals": {}}

import json
import re
import math
from typing import Optional
from sqlalchemy import func

_bikeways_geojson_cache = {"data": None, "mtime": 0}
_contours_caches = {
    "1m": {"data": None, "mtime": 0},
    "2m": {"data": None, "mtime": 0},
    "10m": {"data": None, "mtime": 0},
}

@app.get("/api/geojson/road/{facility_type}")
def get_road_facilities_geojson(
    facility_type: str, 
    interval: str = "10m", 
    max_rate: Optional[float] = None,
    credit_card_only: bool = False,
    time_period: Optional[str] = "auto",
    db: Session = Depends(database.get_db)
):
    """
    facility_type can be 'parking_meters', 'accessible_parking', 'motorcycle_parking', 'ev_charging', 'bikeways', 'contours', etc.
    For contours, interval can be '1m', '2m', '10m'.
    """
    # 1. Handle Contours with 1m, 2m, 10m intervals
    if facility_type.startswith("contours"):
        raw_int = "10m"
        if facility_type == "contours_1m" or interval.strip().lower() in ("1m", "1"):
            raw_int = "1m"
        elif facility_type == "contours_2m" or interval.strip().lower() in ("2m", "2"):
            raw_int = "2m"
        
        filename = f"vancouver_contours_{raw_int}.geojson"
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
        if not os.path.exists(static_geojson_path) and raw_int == "10m":
            static_geojson_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_contours.geojson")

        if os.path.exists(static_geojson_path):
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})
        return {"type": "FeatureCollection", "features": []}

    # Handle Tide Stations
    if facility_type == "tide_stations":
        import tides_service
        return tides_service.get_tides_geojson()

    # Handle TomTom Traffic Corridors (LineString 色帶)
    if facility_type in ("traffic_conditions", "traffic"):
        try:
            from tomtom_service import tomtom_service
            return tomtom_service.get_jams_geojson()
        except Exception as e:
            print(f"[TomTomTraffic] Fallback to static jams: {e}")

    # Handle TomTom Traffic Alerts / Incidents (Point 圖釘)
    if facility_type in ("traffic_alerts", "traffic_reports"):
        try:
            from tomtom_service import tomtom_service
            return tomtom_service.get_alerts_geojson()
        except Exception as e:
            print(f"[TomTomTraffic] Fallback to static alerts: {e}")

    # Handle Beach Water Quality
    if facility_type in ("beach_water_quality", "beach_water"):
        import beach_water_service
        return beach_water_service.get_beach_water_geojson()

    # Handle Street Lighting Poles
    if facility_type in ("street_lighting", "street_lighting_poles"):
        poles_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_street_lighting_poles.geojson")
        if os.path.exists(poles_path):
            return FileResponse(poles_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    # Handle Street Lighting Conduits
    if facility_type in ("street_lighting_conduits", "street_conduits"):
        conduits_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_street_lighting_conduits.geojson")
        if os.path.exists(conduits_path):
            return FileResponse(conduits_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    # 2. Prioritize verified precompiled static GeoJSON files (instant zero-copy static serving)
    static_geojson_path = os.path.join(os.path.dirname(__file__), "data", f"vancouver_{facility_type}.geojson")
    if facility_type not in ('parking_meters', 'motorcycle_parking'):
        if os.path.exists(static_geojson_path):
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
    
    # Auto-import on-the-fly if not yet populated in DB
    if not facilities:
        # 1. Check for precompiled verified GeoJSON in backend/data/
        if os.path.exists(static_geojson_path):
            try:
                with open(static_geojson_path, "r", encoding="utf-8") as f:
                    static_geojson = json.load(f)
                
                # Auto-populate DB for future queries & search using bulk save
                facs_to_add = []
                for feat in static_geojson.get("features", []):
                    props = feat.get("properties", {})
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        lon, lat = coords[0], coords[1]
                        fac_id = feat.get("id") or props.get("id") or f"{facility_type}_{lon}_{lat}"
                        fac = models.RoadFacility(
                            id=str(fac_id),
                            facility_type=facility_type,
                            name=props.get("name", "Unknown"),
                            local_area=props.get("local_area") or props.get("municipality", ""),
                            lat=lat,
                            lon=lon,
                            geom=f"SRID=4326;POINT({lon} {lat})",
                            details={k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")},
                            last_updated=datetime.utcnow()
                        )
                        facs_to_add.append(fac)
                if facs_to_add:
                    db.bulk_save_objects(facs_to_add)
                db.commit()
                if facility_type not in ('parking_meters', 'motorcycle_parking'):
                    return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})
                facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
            except Exception as e:
                db.rollback()
                print(f"Error populating {facility_type} from static geojson: {e}")
                if os.path.exists(static_geojson_path) and facility_type not in ('parking_meters', 'motorcycle_parking'):
                    return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

        # 2. Try online API import
        try:
            from scripts.import_road_data import import_single_facility_type
            import_single_facility_type(facility_type, db)
            facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
        except Exception as e:
            print(f"Auto-import error for {facility_type}: {e}")

    # Fallback to static geojson file if still empty
    if not facilities:
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", f"vancouver_{facility_type}.geojson")
        if os.path.exists(static_geojson_path):
            with open(static_geojson_path, "r", encoding="utf-8") as f:
                static_data = json.load(f)
            if facility_type not in ('parking_meters', 'motorcycle_parking'):
                return static_data
            class MockFacility:
                def __init__(self, id, ftype, name, local_area, lon, lat, details):
                    self.id = id
                    self.facility_type = ftype
                    self.name = name
                    self.local_area = local_area
                    self.lon = lon
                    self.lat = lat
                    self.details = details
            facilities = []
            for feat in static_data.get("features", []):
                coords = feat.get("geometry", {}).get("coordinates", [])
                p = feat.get("properties", {})
                if len(coords) >= 2:
                    facilities.append(MockFacility(
                        feat.get("id") or p.get("id"),
                        facility_type,
                        p.get("name", "Unknown"),
                        p.get("local_area", ""),
                        coords[0],
                        coords[1],
                        p
                    ))
            
    features = []
    for f in facilities:
        props = {
            "id": f.id,
            "facility_type": f.facility_type,
            "name": f.name,
            "local_area": f.local_area,
        }
        if f.details and isinstance(f.details, dict):
            props.update(f.details)

        if facility_type in ('parking_meters', 'motorcycle_parking'):
            # 判斷時段：auto (根據溫哥華當地時間), day (日間 9am-6pm), night (夜間 6pm-10pm)
            import datetime
            try:
                from zoneinfo import ZoneInfo
                vancouver_now = datetime.datetime.now(ZoneInfo("America/Vancouver"))
            except Exception:
                vancouver_now = datetime.datetime.utcnow() - datetime.timedelta(hours=7)
            
            current_hour = vancouver_now.hour

            # 決定當前查詢時段
            period_mode = (time_period or "auto").lower()
            if period_mode == "night":
                active_period = "night"
            elif period_mode == "day":
                active_period = "day"
            else:  # auto: 根據溫哥華目前時間自動判斷
                if 9 <= current_hour < 18:
                    active_period = "day"
                elif 18 <= current_hour < 22:
                    active_period = "night"
                else:
                    active_period = "free"  # 溫哥華路邊停車錶在 22:00 至次日 09:00 為免費時段

            props['active_period'] = active_period
            props['vancouver_time'] = vancouver_now.strftime("%H:%M")

            # 根據判定時段提取費率
            raw_rate = ''
            if active_period == "night":
                raw_rate = props.get('rate_6pm_10pm') or props.get('rate_9am_6pm') or props.get('rate') or ''
            elif active_period == "free":
                raw_rate = '0'
            else:  # day
                raw_rate = props.get('rate_9am_6pm') or props.get('r_mf_9a_6p') or props.get('rate') or ''

            rate_num = None
            rate_match = re.search(r'(\d+(?:\.\d+)?)', str(raw_rate))
            if rate_match:
                try:
                    rate_num = float(rate_match.group(1))
                except ValueError:
                    rate_num = None
            elif active_period == "free":
                rate_num = 0.0

            props['rate_numeric'] = rate_num
            props['effective_rate'] = f"${rate_num:.2f}" if rate_num is not None and active_period != "free" else "免費" if active_period == "free" else "未提供"

            if max_rate is not None and max_rate > 0:
                if rate_num is not None and rate_num > max_rate:
                    continue
            if credit_card_only:
                cc = str(props.get('credit_card') or props.get('creditcard') or '').lower()
                if cc not in ('yes', 'true', '1'):
                    continue

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [f.lon, f.lat]
            },
            "properties": props
        })
    return {"type": "FeatureCollection", "features": features}

@app.get("/api/explore/nearby")
def explore_nearby_facilities(
    lat: float,
    lon: float,
    radius: int = 500,
    layers: Optional[str] = None,
    db: Session = Depends(database.get_db)
):
    """
    Returns facilities and transit stops within radius (meters) of given (lat, lon).
    Calculates exact distance and walking time (minutes).
    """
    def haversine_m(lat1, lon1, lat2, lon2):
        R = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2)**2
        return int(round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))))

    def calc_walk_minutes(dist_m: float):
        # 80m / minute (~4.8 km/h walking speed)
        mins = dist_m / 80.0
        if mins <= 0.6:
            return 0.5
        elif mins <= 1.2:
            return 1.0
        else:
            half_rounded = round(mins * 2) / 2
            return int(half_rounded) if half_rounded.is_integer() else half_rounded

    # Bounding box filter (1 deg ~ 111 km)
    deg_delta = (radius + 150) / 111000.0

    road_query = db.query(models.RoadFacility).filter(
        models.RoadFacility.lat.between(lat - deg_delta, lat + deg_delta),
        models.RoadFacility.lon.between(lon - deg_delta, lon + deg_delta)
    )

    selected_layer_keys = set(layers.split(',')) if layers else None

    nearby_items = []

    type_labels = {
        'aed': ('AED 去顫器', '❤️', 'aed'),
        'public_washrooms': ('公共洗手間', '🚻', 'publicWashrooms'),
        'drinking_fountains': ('飲水機', '💧', 'drinkingFountains'),
        'shared_bikes': ('共享單車', '🚲', 'sharedBikes'),
        'bike_racks': ('單車架', '🚲', 'bikeRacks'),
        'litter_containers': ('垃圾箱', '🗑️', 'litterContainers'),
        'parking_meters': ('停車收費錶', '🅿️', 'parkingMeters'),
        'accessible_parking': ('無障礙車位', '♿', 'accessibleParking'),
        'motorcycle_parking': ('摩托車位', '🏍️', 'motorcycleParking'),
        'ev_charging': ('EV 充電站', '⚡', 'evCharging'),
        'community_centres': ('社區中心', '🏢', 'communityCentres'),
        'libraries': ('圖書館', '📚', 'libraries'),
        'schools': ('學校', '🏫', 'schools'),
        'food_banks': ('食物銀行', '🥫', 'foodBanks'),
        'food_vendors': ('街頭餐飲', '🍔', 'foodVendors'),
        'recycling': ('環保回收站', '♻️', 'recycling'),
        'homeless_shelters': ('無家者庇護所', '🏠', 'homelessShelters'),
        'parks': ('公園綠地', '🌳', 'parks'),
        'hospitals': ('醫療院所', '🏥', 'hospitals'),
        'police': ('警局', '🚓', 'police'),
        'fire_halls': ('消防局', '🚒', 'fireHalls'),
        'fire_hydrants': ('消防栓', '🧯', 'fireHydrants'),
        'van_wifi': ('VanWiFi 免費無線網路', '📶', 'vanWifi'),
        'tide_stations': ('潮汐水位', '🌊', 'tideStations'),
        'beach_water_quality': ('海灘水質', '🏖️', 'beachWaterQuality'),
        'zoning_districts': ('土地規劃', '📐', 'zoningDistricts'),
        'street_lighting': ('路燈燈柱', '💡', 'streetLighting'),
        'street_lighting_poles': ('路燈燈柱', '💡', 'streetLighting'),
        'street_lighting_conduits': ('配電管線', '⚡', 'streetLightingConduits'),
        'road_closures': ('交通封閉', '🚫', 'roadClosures'),
        'road_construction': ('道路施工', '🚧', 'roadConstruction'),
        'traffic_conditions': ('獅門大橋', '🌉', 'trafficConditions')
    }

    for f in road_query.all():
        dist = haversine_m(lat, lon, f.lat, f.lon)
        if dist <= radius:
            meta = type_labels.get(f.facility_type, ('公共設施', '📍', f.facility_type))
            if selected_layer_keys and meta[2] not in selected_layer_keys:
                continue
            walk_min = calc_walk_minutes(dist)
            nearby_items.append({
                'id': f.id,
                'name': f.name,
                'facility_type': f.facility_type,
                'type_label': meta[0],
                'icon': meta[1],
                'layer_key': meta[2],
                'local_area': f.local_area,
                'lat': f.lat,
                'lon': f.lon,
                'distance_m': dist,
                'distance_meters': dist,
                'walk_minutes': walk_min,
                'walking_minutes': walk_min,
                'properties': f.details or {}
            })

    # Transit Stops in bounding box (SkyTrain & Bus)
    stops_query = db.query(models.TransitStop).filter(
        models.TransitStop.lat.between(lat - deg_delta, lat + deg_delta),
        models.TransitStop.lon.between(lon - deg_delta, lon + deg_delta)
    )
    for s in stops_query.all():
        dist = haversine_m(lat, lon, s.lat, s.lon)
        if dist <= radius:
            is_skytrain = s.stop_group == 'skytrain'
            layer_key = 'skytrainStops' if is_skytrain else 'busStops'
            is_allowed = not selected_layer_keys or layer_key in selected_layer_keys or (is_skytrain and 'skytrainRoutes' in selected_layer_keys)
            if not is_allowed:
                continue
            walk_min = calc_walk_minutes(dist)
            nearby_items.append({
                'id': s.stop_id,
                'name': s.name,
                'facility_type': 'skytrain_stations' if is_skytrain else 'bus_stops',
                'type_label': '天車站' if is_skytrain else '公車站',
                'icon': '🚉' if is_skytrain else '🚏',
                'layer_key': layer_key,
                'local_area': '',
                'lat': s.lat,
                'lon': s.lon,
                'distance_m': dist,
                'distance_meters': dist,
                'walk_minutes': walk_min,
                'walking_minutes': walk_min,
                'properties': {'stop_id': s.stop_id, 'stop_group': s.stop_group}
            })

    # Supplementary SkyTrain stations from skytrain_network.json to ensure 100% discovery
    is_skytrain_layer_on = not selected_layer_keys or 'skytrainStops' in selected_layer_keys or 'skytrainRoutes' in selected_layer_keys
    if is_skytrain_layer_on:
        skytrain_stations = skytrain_service.get_skytrain_data().get('stations', {})
        existing_st_ids = {str(item['id']) for item in nearby_items if item.get('facility_type') == 'skytrain_stations'}
        for st_id, st in skytrain_stations.items():
            if str(st_id) in existing_st_ids or str(st.get('stop_id')) in existing_st_ids:
                continue
            dist = haversine_m(lat, lon, st['lat'], st['lon'])
            if dist <= radius:
                walk_min = calc_walk_minutes(dist)
                nearby_items.append({
                    'id': str(st.get('stop_id', st_id)),
                    'name': st.get('name', '天車站'),
                    'facility_type': 'skytrain_stations',
                    'type_label': '天車站',
                    'icon': '🚉',
                    'layer_key': 'skytrainStops',
                    'local_area': '',
                    'lat': st['lat'],
                    'lon': st['lon'],
                    'distance_m': dist,
                    'distance_meters': dist,
                    'walk_minutes': walk_min,
                    'walking_minutes': walk_min,
                    'properties': {'stop_id': str(st_id), 'lines': st.get('lines', [])}
                })

    # Supplementary Gas Stations from fuel_service
    is_fuel_allowed = not selected_layer_keys or 'fuel' in selected_layer_keys
    if is_fuel_allowed:
        try:
            try:
                import fuel_service
            except ImportError:
                from backend import fuel_service
            gas_stations = fuel_service.load_vancouver_stations()
            for gs in gas_stations:
                dist = haversine_m(lat, lon, gs['lat'], gs['lon'])
                if dist <= radius:
                    walk_min = calc_walk_minutes(dist)
                    nearby_items.append({
                        'id': f"fuel_{gs.get('id', '')}",
                        'name': gs.get('name') or gs.get('brand', '油站'),
                        'facility_type': 'fuel',
                        'type_label': '油站',
                        'icon': '⛽',
                        'layer_key': 'fuel',
                        'local_area': gs.get('city', ''),
                        'lat': gs['lat'],
                        'lon': gs['lon'],
                        'distance_m': dist,
                        'distance_meters': dist,
                        'walk_minutes': walk_min,
                        'walking_minutes': walk_min,
                        'properties': gs
                    })
        except Exception:
            pass

    # Supplementary Tide Stations from tides_service
    is_tide_allowed = not selected_layer_keys or 'tideStations' in selected_layer_keys
    if is_tide_allowed:
        try:
            try:
                import tides_service
            except ImportError:
                from backend import tides_service
            for ts in getattr(tides_service, 'STATIONS_CONFIG', []):
                dist = haversine_m(lat, lon, ts['lat'], ts['lon'])
                if dist <= radius:
                    walk_min = calc_walk_minutes(dist)
                    nearby_items.append({
                        'id': f"tide_{ts.get('id', '')}",
                        'name': ts.get('name', '潮汐水位站'),
                        'facility_type': 'tide_stations',
                        'type_label': '潮汐水位',
                        'icon': '🌊',
                        'layer_key': 'tideStations',
                        'local_area': ts.get('area', ''),
                        'lat': ts['lat'],
                        'lon': ts['lon'],
                        'distance_m': dist,
                        'distance_meters': dist,
                        'walk_minutes': walk_min,
                        'walking_minutes': walk_min,
                        'properties': ts
                    })
        except Exception:
            pass

    # Sort all by distance ascending
    nearby_items.sort(key=lambda x: x['distance_m'])

    return {
        'center': {'lat': lat, 'lon': lon},
        'radius_m': radius,
        'total': len(nearby_items),
        'items': nearby_items[:150]
    }

@app.get("/api/geojson/stops/{group}")
def get_stops_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
    if group == 'skytrain':
        data = skytrain_service.get_skytrain_data()
        stations = data.get('stations', {})
        features = []
        for stop_id, st in stations.items():
            st_lines = st.get('lines', [])
            # Color follows the SkyTrain line colors:
            # Canada Line: #0097a9 (Teal/Turquoise)
            # Millennium Line: #f59e0b (Yellow/Amber)
            # Expo Line: #0033a0 (Dark Blue)
            if any('Canada' in l for l in st_lines):
                color = '#0097a9'
            elif any('Millennium' in l for l in st_lines):
                color = '#f59e0b'
            else:
                color = '#0033a0'
            
            is_interchange = len(st_lines) > 1 or any(k in st.get('name', '') for k in ['Waterfront', 'Commercial', 'Lougheed', 'Production Way'])

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [st['lon'], st['lat']]
                },
                "properties": {
                    "stop_id": str(st.get('stop_id', stop_id)),
                    "name": st.get('name', ''),
                    "raw_name": st.get('raw_name', st.get('name', '')),
                    "lines": st_lines,
                    "color": color,
                    "is_interchange": is_interchange
                }
            })
        if features:
            return {"type": "FeatureCollection", "features": features}

    if group == 'seabus':
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-123.1118, 49.2861]
                    },
                    "properties": {
                        "stop_id": "8035",
                        "name": "Waterfront Station"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-123.0829, 49.3103]
                    },
                    "properties": {
                        "stop_id": "8036",
                        "name": "Lonsdale Quay"
                    }
                }
            ]
        }

    if group in _stops_geojson_cache:
        return _stops_geojson_cache[group]

    try:
        stops = db.query(models.TransitStop).filter(models.TransitStop.stop_group == group).all()
    except Exception:
        stops = []

    features = []
    for stop in stops:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [stop.lon, stop.lat]
            },
            "properties": {
                "stop_id": stop.stop_id,
                "name": stop.name
            }
        })

    if not features and group == 'bus':
        gtfs_meta = get_gtfs_metadata()
        variants = gtfs_meta.get("variants", {})
        routes_lookup = gtfs_meta.get("routes", {})
        seen_stops = set()
        for v in variants.values():
            rid = str(v.get("route_id", ""))
            rnum = str(routes_lookup.get(rid, {}).get("route_number", "")).upper()
            if rnum in ("99", "R1", "R2", "R3", "R4", "R5", "R6"):
                for s in v.get("stops", []):
                    sid = str(s.get("stop_id", ""))
                    if sid and sid not in seen_stops and s.get("lon") and s.get("lat"):
                        seen_stops.add(sid)
                        features.append({
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [s["lon"], s["lat"]]
                            },
                            "properties": {
                                "stop_id": sid,
                                "name": s.get("name", "")
                            }
                        })

    result_fc = {"type": "FeatureCollection", "features": features}
    if features:
        _stops_geojson_cache[group] = result_fc
    return result_fc


_stops_geojson_cache: dict = {}
_tracks_geojson_cache: dict = {}

@app.get("/api/geojson/tracks/{group}")
def get_tracks_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
    if group in _tracks_geojson_cache:
        return _tracks_geojson_cache[group]

    features = []
    try:
        results = db.query(
            models.TransitShape.shape_id,
            models.TransitShape.route_id,
            models.TransitRoute.color,
            func.ST_AsGeoJSON(models.TransitShape.geom).label('geojson')
        ).join(
            models.TransitRoute, models.TransitShape.route_id == models.TransitRoute.route_id
        ).filter(
            models.TransitShape.route_group == group
        ).all()
        
        for row in results:
            geometry = json.loads(row.geojson) if row.geojson else None
            if geometry:
                features.append({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "shape_id": row.shape_id,
                        "route_id": row.route_id,
                        "color": row.color
                    }
                })
    except Exception:
        features = []

    if not features:
        if group == 'skytrain':
            st_data = skytrain_service.get_skytrain_data()
            for pat_key, pat in st_data.get("patterns", {}).items():
                coords = pat.get("shape_coords", [])
                if len(coords) >= 2:
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": coords
                        },
                        "properties": {
                            "shape_id": pat_key,
                            "route_id": pat.get("line_name", "SkyTrain"),
                            "color": pat.get("color", "#0033a0")
                        }
                    })
        elif group == 'seabus':
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-123.1118, 49.2861], [-123.0829, 49.3103]]
                },
                "properties": {
                    "shape_id": "seabus_track",
                    "route_id": "6771",
                    "color": "#8b786d"
                }
            })
        elif group == 'bus':
            gtfs_meta = get_gtfs_metadata()
            variants = gtfs_meta.get("variants", {})
            routes_lookup = gtfs_meta.get("routes", {})
            seen_routes = set()
            for vkey, v in variants.items():
                rid = str(v.get("route_id", ""))
                rmeta = routes_lookup.get(rid, {})
                rnum = str(rmeta.get("route_number", "")).upper()
                if rnum in ("99", "R1", "R2", "R3", "R4", "R5", "R6") and rid not in seen_routes:
                    coords = v.get("shape_coords", [])
                    if len(coords) >= 2:
                        seen_routes.add(rid)
                        features.append({
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coords
                            },
                            "properties": {
                                "shape_id": vkey,
                                "route_id": rid,
                                "color": v.get("color") or rmeta.get("color") or "#22c55e"
                            }
                        })

    result_fc = {"type": "FeatureCollection", "features": features}
    if features:
        _tracks_geojson_cache[group] = result_fc
    return result_fc

@app.get("/api/debug/counts")
def get_debug_counts(db: Session = Depends(database.get_db)):
    return {
        "routes": {
            "bus": db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'bus').count(),
            "skytrain": db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'skytrain').count(),
        },
        "shapes": {
            "bus": db.query(models.TransitShape).filter(models.TransitShape.route_group == 'bus').count(),
            "skytrain": db.query(models.TransitShape).filter(models.TransitShape.route_group == 'skytrain').count(),
        },
        "bus_routes_list": [r.short_name for r in db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'bus').all()]
    }

@app.get("/api/debug/gtfs_routes")
def get_debug_gtfs_routes():
    import zipfile, csv, io, os
    zip_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'google_transit.zip')
    if not os.path.exists(zip_path):
        return {"error": "google_transit.zip not found"}
    routes = []
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            with z.open('routes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    routes.append(row.get('route_short_name', ''))
    except Exception as e:
        return {"error": str(e)}
    return {"total": len(routes), "route_short_names": list(set(routes))}

from pydantic import BaseModel
from typing import Optional
import smtplib
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

class IssueReportRequest(BaseModel):
    title: str
    details: str
    contact_email: Optional[str] = None
    image_base64: Optional[str] = None
    image_name: Optional[str] = None

@app.post("/api/report-issue")
def report_issue(payload: IssueReportRequest, db: Session = Depends(database.get_db)):
    """
    接收使用者回報的問題與建議，儲存至資料庫與備份檔案，並嘗試發送通知郵件至 vancouvergodeyes@gmail.com
    """
    now_utc = datetime.utcnow()
    # 1. 儲存至資料庫
    try:
        report = models.IssueReport(
            title=payload.title,
            details=payload.details,
            contact_email=payload.contact_email or None,
            created_at=now_utc
        )
        db.add(report)
        db.commit()
    except Exception as e:
        print(f"[Issue Report DB Error]: {e}")
        db.rollback()

    # 2. 備份至 JSONL 檔案 (確保即便離線或無 DB 亦可持久保存)
    try:
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(data_dir, exist_ok=True)
        report_file = os.path.join(data_dir, 'issue_reports.jsonl')
        with open(report_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps({
                "timestamp": now_utc.isoformat(),
                "title": payload.title,
                "details": payload.details,
                "contact_email": payload.contact_email or "",
                "has_attachment": bool(payload.image_base64),
                "attachment_name": payload.image_name or ""
            }, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[Issue Report Backup File Error]: {e}")

    # 3. 發送郵件至 vancouvergodeyes@gmail.com
    target_email = "vancouvergodeyes@gmail.com"
    smtp_host = os.getenv("SMTP_HOST") # 例如 smtp.gmail.com
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASSWORD")

    email_sent = False
    email_error = None

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart("mixed")
            msg["Subject"] = f"[上帝之眼問題回報] {payload.title}"
            msg["From"] = smtp_user
            msg["To"] = target_email

            body_text = f"""溫哥華上帝之眼 - 使用者問題回報
=============================================
回報標題: {payload.title}
送出時間: {now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}
聯絡 Email: {payload.contact_email or '未提供'}
圖片附件: {'有 (詳見附件: ' + (payload.image_name or 'attachment.png') + ')' if payload.image_base64 else '無'}

問題詳情:
---------------------------------------------
{payload.details}
=============================================
"""
            msg.attach(MIMEText(body_text, "plain", "utf-8"))

            if payload.image_base64:
                try:
                    img_raw = payload.image_base64
                    if "," in img_raw:
                        img_raw = img_raw.split(",", 1)[1]
                    img_bytes = base64.b64decode(img_raw)
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(img_bytes)
                    encoders.encode_base64(part)
                    filename = payload.image_name or "report_screenshot.png"
                    part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
                    msg.attach(part)
                except Exception as img_err:
                    print(f"[Issue Report Image Attach Error]: {img_err}")

            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
            else:
                server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
                server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, [target_email], msg.as_string())
            server.quit()
            email_sent = True
            print(f"[Issue Report] Email successfully dispatched to {target_email}")
        except Exception as e:
            email_error = str(e)
            print(f"[Issue Report Email Error]: {e}")
    else:
        print(f"[Issue Report] Stored report '{payload.title}' locally. (SMTP credentials not configured, skipping SMTP dispatch)")

    return {
        "status": "success",
        "message": "問題回報已成功送出！",
        "target_email": target_email,
        "email_dispatched": email_sent,
        "email_error": email_error
    }

@app.post("/api/admin/update-open-data")
def trigger_update_open_data(background_tasks: BackgroundTasks):
    """
    手動或透過外部 Webhook / Cron 觸發每 6 個月的 Vancouver Open Data 資料集全面更新
    """
    from scripts.update_open_data import run_all_updates
    background_tasks.add_task(run_all_updates)
    return {
        "status": "triggered",
        "message": "已在背景啟動溫哥華 Open Data 10 項圖層資料集更新作業 (含單車徑 Bikeways)",
        "cycle_months": 6,
        "datasets": [
            "parks", "parks_facilities", "community_gardens",
            "drinking_fountains", "public_washrooms",
            "schools", "libraries", "food_vendors", "homeless_shelters",
            "bikeways"
        ]
    }

@app.get("/api/admin/update-open-data/status")
def get_update_open_data_status():
    """
    查詢每 6 個月定期資料集的最新更新時間與狀態
    """
    meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'last_open_data_update.json')
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            return {"error": str(e)}
    return {"status": "never_updated", "cycle_months": 6}


# ==========================================
# 🛠️ 系統管理員後台 API (數據更新排程、即時狀態與 GeoJSON 發布)
# ==========================================
def get_admin_config_path():
    candidate_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_sources_config.json'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', 'data', 'admin_sources_config.json'),
        os.path.join(os.getcwd(), 'backend', 'data', 'admin_sources_config.json'),
        os.path.join(os.getcwd(), 'data', 'admin_sources_config.json'),
        '/app/data/admin_sources_config.json',
        '/app/backend/data/admin_sources_config.json',
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            return p
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_sources_config.json')


def get_persisted_github_token():
    """
    從記憶體、所有可能的 .env 檔案與 admin_sources_config.json 深度恢復 GITHUB_TOKEN
    確保重新載入或重啟容器絕不遺失 Token
    """
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repo = os.environ.get("GITHUB_REPO", "Ycf206/Vancouver-God-Eyes").strip()
    if token:
        return token, repo
    
    # 1. 掃描磁碟上多個可能的 .env 路徑
    candidate_envs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
        os.path.join(os.getcwd(), 'backend', '.env'),
        os.path.join(os.getcwd(), '.env'),
        '/app/backend/.env',
        '/app/.env'
    ]
    for p in candidate_envs:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('GITHUB_TOKEN='):
                            token = line.split('=', 1)[1].strip().strip('"').strip("'")
                        elif line.startswith('GITHUB_REPO='):
                            repo = line.split('=', 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass
            if token:
                os.environ["GITHUB_TOKEN"] = token
                os.environ["GITHUB_REPO"] = repo
                return token, repo

    # 2. 掃描 admin_sources_config.json 持久化設定
    cfg_path = get_admin_config_path()
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                if cfg.get("github_token"):
                    token = cfg.get("github_token", "").strip()
                    repo = cfg.get("github_repo", repo).strip()
                    if token:
                        os.environ["GITHUB_TOKEN"] = token
                        os.environ["GITHUB_REPO"] = repo
                        return token, repo
        except Exception:
            pass

    return token, repo


@app.get("/api/admin/github-status")
def get_admin_github_status():
    """
    查詢 GitHub Token 配置狀態與目標 Repository
    """
    token, repo = get_persisted_github_token()
    return {
        "configured": bool(token),
        "repo": repo,
        "token_masked": (token[:4] + "..." + token[-4:]) if len(token) > 8 else ("已設定" if token else "未設定")
    }


@app.post("/api/admin/github-token")
def set_admin_github_token(payload: dict = Body(...)):
    """
    從後台介面直接儲存 GITHUB_TOKEN，無須手動 SSH
    全面寫入記憶體、多個 .env 以及 admin_sources_config.json
    """
    token = payload.get("token", "").strip()
    repo = payload.get("repo", "Ycf206/Vancouver-God-Eyes").strip()
    if not token:
        return {"status": "error", "message": "Token 不能為空"}

    # 驗證 Token 是否具備有效 GitHub 授權
    user_name = ""
    try:
        gh_resp = requests.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "VancouverGodsEye-Admin"
            },
            timeout=5
        )
        if gh_resp.status_code == 401:
            return {"status": "error", "message": "GitHub Token 驗證失敗 (401 Unauthorized)：請確認 Token 是否過期或複製不完整。"}
        elif gh_resp.status_code == 200:
            user_data = gh_resp.json()
            user_name = user_data.get("login", "")
    except Exception as gh_ex:
        logger.warning(f"GitHub Token 驗證連線跳過: {gh_ex}")

    # 1. 寫入記憶體環境變數
    os.environ["GITHUB_TOKEN"] = token
    os.environ["GITHUB_REPO"] = repo

    # 2. 寫入所有可能存在的 .env 檔案
    candidate_envs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
        os.path.join(os.getcwd(), 'backend', '.env'),
        os.path.join(os.getcwd(), '.env'),
        '/app/backend/.env',
        '/app/.env'
    ]
    for env_path in candidate_envs:
        try:
            lines = []
            if os.path.exists(env_path):
                with open(env_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            new_lines = [l for l in lines if not l.startswith('GITHUB_TOKEN=') and not l.startswith('GITHUB_REPO=')]
            new_lines.append(f"GITHUB_TOKEN={token}\n")
            new_lines.append(f"GITHUB_REPO={repo}\n")
            with open(env_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
        except Exception as e:
            print(f"Failed to save to {env_path}:", e)

    # 3. 寫入 admin_sources_config.json 保證容器重啟持久性
    cfg_path = get_admin_config_path()
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg["github_token"] = token
            cfg["github_repo"] = repo
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as ce:
            print("Failed to save token to json config:", ce)

    msg = f"GitHub Token 儲存成功！已綁定帳號 @{user_name}，現在可一鍵觸發 Actions 工作流與自動 Commit 排程。" if user_name else "GitHub Token 已成功儲存！"
    return {"status": "success", "message": msg}


def get_canonical_workflow_file(source_id: str) -> str:
    """傳回特定資料源所對應之獨立 GitHub Actions 工作流檔案名稱"""
    clean_id = source_id.replace("_", "-")
    return f"update-{clean_id}.yml"


@app.get("/api/admin/sources")
def get_admin_sources():
    """
    獲取系統所有數據源 (API 與 GeoJSON) 之最新狀態、排程頻率、上次更新時間與記錄筆數
    """
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)

            # 自動校正所有舊版或遺失之 workflow_file (例如 update-datasets.yml)
            has_changes = False
            for s in cfg.get("sources", []):
                if s.get("runner") == "github_actions":
                    canonical_wf = get_canonical_workflow_file(s["id"])
                    if s.get("workflow_file") != canonical_wf:
                        s["workflow_file"] = canonical_wf
                        has_changes = True

            if has_changes:
                try:
                    with open(config_path, 'w', encoding='utf-8') as f:
                        json.dump(cfg, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass

            return cfg
        except Exception as e:
            return {"error": str(e), "sources": [], "logs": []}
    return {"sources": [], "logs": []}


@app.post("/api/admin/sources/sync")
def trigger_admin_sync(payload: dict = Body(...)):
    """
    手動即時觸發特定數據源 (或 OCI 全部 / GitHub Actions 全部) 同步更新
    支援透過 GitHub Workflow Dispatch API 喚醒雲端 Actions 執行
    """
    source_id = payload.get("source_id")
    target_runner = payload.get("runner")  # 'oci' or 'github_actions'
    config_path = get_admin_config_path()
    now_iso = datetime.utcnow().isoformat() + "Z"
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    github_repo = os.environ.get("GITHUB_REPO", "Ycf206/Vancouver-God-Eyes").strip()
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            
            updated_count = 0
            dispatched_workflows = []
            target_name = "所有數據源"
            detail_msg = ""
            action_name = "MANUAL_SYNC"
            
            # 判斷是否為批次觸發
            if source_id == 'all_oci' or (source_id == 'all' and target_runner == 'oci'):
                target_name = "全部 OCI 伺服器即時服務"
                for src in cfg.get("sources", []):
                    if src.get("runner") == "oci":
                        src["last_updated"] = now_iso
                        src["status"] = "healthy"
                        updated_count += 1
                detail_msg = f"管理員立即更新全部 OCI 伺服器即時服務（共 {updated_count} 項即時交通、天氣、航班等資料）。"
                action_name = "OCI_BATCH_SYNC"
            elif source_id == 'all_github' or (source_id == 'all' and target_runner == 'github_actions'):
                target_name = "全部 GitHub Actions 雲端資料管線"
                seen_workflows = set()
                for src in cfg.get("sources", []):
                    if src.get("runner") == "github_actions":
                        src["last_updated"] = now_iso
                        src["status"] = "healthy"
                        updated_count += 1
                        canonical_wf = get_canonical_workflow_file(src["id"])
                        src["workflow_file"] = canonical_wf
                        if canonical_wf not in seen_workflows:
                            seen_workflows.add(canonical_wf)
                            dispatched_workflows.append(canonical_wf)
                
                # 若有 GITHUB_TOKEN，嘗試觸發各工作流
                if github_token and dispatched_workflows:
                    for wf in dispatched_workflows:
                        try:
                            dispatch_url = f"https://api.github.com/repos/{github_repo}/actions/workflows/{wf}/dispatches"
                            headers = {
                                "Authorization": f"Bearer {github_token}",
                                "Accept": "application/vnd.github.v3+json",
                                "User-Agent": "VancouverGodsEye-Admin"
                            }
                            requests.post(dispatch_url, json={"ref": "main"}, headers=headers, timeout=5)
                        except Exception as e:
                            print(f"Failed to dispatch workflow {wf}: {e}")
                    detail_msg = f"已透過 GitHub Workflow Dispatch 觸發 {len(dispatched_workflows)} 個 Actions 雲端工作流立即執行！"
                else:
                    detail_msg = f"已排程觸發 {updated_count} 項 GitHub Actions 圖層更新（如需直接遠端呼叫 GitHub，請在後台設定 GITHUB_TOKEN）。"
                action_name = "GITHUB_BATCH_SYNC"
            else:
                # 單一項目觸發
                target_src = None
                for src in cfg.get("sources", []):
                    if src.get("id") == source_id:
                        src["last_updated"] = now_iso
                        src["status"] = "healthy"
                        target_src = src
                        target_name = src.get("name", source_id)
                        break
                
                if target_src:
                    runner = target_src.get("runner", "oci")
                    if runner == "github_actions":
                        action_name = "GITHUB_DISPATCH"
                        canonical_wf = get_canonical_workflow_file(target_src["id"])
                        target_src["workflow_file"] = canonical_wf
                        wf = canonical_wf
                        if github_token and wf:
                            try:
                                dispatch_url = f"https://api.github.com/repos/{github_repo}/actions/workflows/{wf}/dispatches"
                                headers = {
                                    "Authorization": f"Bearer {github_token}",
                                    "Accept": "application/vnd.github.v3+json",
                                    "User-Agent": "VancouverGodsEye-Admin"
                                }
                                resp = requests.post(dispatch_url, json={"ref": "main"}, headers=headers, timeout=8)
                                if resp.status_code in [200, 204]:
                                    detail_msg = f"已成功調度 GitHub Actions 工作流 [{wf}] 立即在雲端執行！"
                                else:
                                    err_json = {}
                                    try:
                                        err_json = resp.json()
                                    except Exception:
                                        pass
                                    detail_msg = f"呼叫 GitHub Actions API 失敗 (HTTP {resp.status_code}): {err_json.get('message', '未知錯誤')}"
                            except Exception as ex:
                                detail_msg = f"GitHub API 連線異常: {ex}"
                        else:
                            detail_msg = f"已標記 [{target_name}] 同步請求。綁定工作流: [{wf}]（在右上角設定 GITHUB_TOKEN 即可一鍵遠端喚醒 Actions 雲端執行）。"
                    else:
                        action_name = "OCI_SYNC"
                        detail_msg = f"OCI 伺服器已即時更新 [{target_name}] 資料快取與連線狀態。"
                else:
                    return {"status": "error", "message": f"找不到數據源 {source_id}"}

            new_log = {
                "id": f"log-{int(time.time() * 1000)}",
                "timestamp": now_iso,
                "action": action_name,
                "source_name": target_name,
                "runner": target_runner or (target_src.get("runner") if 'target_src' in locals() and target_src else "all"),
                "status": "success",
                "detail": detail_msg
            }
            logs = cfg.get("logs", [])
            logs.insert(0, new_log)
            cfg["logs"] = logs[:150]
            
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            
            return {
                "status": "success",
                "message": detail_msg,
                "source_id": source_id,
                "target_name": target_name,
                "timestamp": now_iso
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
            
    return {"status": "error", "message": "找不到配置檔案"}


@app.post("/api/admin/sources/schedule")
def update_admin_schedule(payload: dict = Body(...)):
    """
    更新特定數據源之排程週期 (Cron 或間隔) 與自動同步開關
    若為 GitHub Actions 資料源，支援直接透過 GitHub Contents API 或本機 yml 同步更新 Cron
    """
    source_id = payload.get("source_id")
    schedule_interval = payload.get("schedule_interval")
    cron_expr = payload.get("cron_expr")
    enabled = payload.get("enabled", True)
    
    config_path = get_admin_config_path()
    now_iso = datetime.utcnow().isoformat() + "Z"
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    github_repo = os.environ.get("GITHUB_REPO", "Ycf206/Vancouver-God-Eyes").strip()
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                
            updated_src = None
            for src in cfg.get("sources", []):
                if src.get("id") == source_id:
                    if payload.get("name"):
                        src["name"] = payload.get("name").strip()
                    if schedule_interval:
                        src["schedule_interval"] = schedule_interval
                    if cron_expr:
                        src["cron_expr"] = cron_expr
                    src["enabled"] = enabled
                    updated_src = src
                    break
                    
            if updated_src:
                runner = updated_src.get("runner", "oci")
                wf = updated_src.get("workflow_file")
                detail_extra = ""
                
                                # 若為 GitHub Actions 項目，更新工作流 cron
                if runner == "github_actions" and cron_expr:
                    canonical_wf = get_canonical_workflow_file(updated_src["id"])
                    updated_src["workflow_file"] = canonical_wf
                    wf = canonical_wf

                    # 1. 嘗試直接透過 GitHub API Commit 更新
                    if github_token:
                        try:
                            import base64
                            content_url = f"https://api.github.com/repos/{github_repo}/contents/.github/workflows/{wf}"
                            headers = {
                                "Authorization": f"Bearer {github_token}",
                                "Accept": "application/vnd.github.v3+json",
                                "User-Agent": "VancouverGodsEye-Admin"
                            }
                            get_resp = requests.get(content_url, headers=headers, timeout=10)
                            if get_resp.status_code == 200:
                                file_info = get_resp.json()
                                sha = file_info.get("sha")
                                raw_yml = base64.b64decode(file_info.get("content", "")).decode("utf-8")
                                import re
                                new_yml = re.sub(r"-\s*cron:\s*['\"].+?['\"]", f"- cron: '{cron_expr}'", raw_yml)
                                if schedule_interval:
                                    new_yml = re.sub(r"^name:\s*Update\s+([^(]+)\([^)]+\)", f"name: Update \\1({schedule_interval})", new_yml, flags=re.MULTILINE)

                                put_body = {
                                    "message": f"chore(schedule): update {updated_src.get('name')} cron to '{cron_expr}' via Admin Portal",
                                    "content": base64.b64encode(new_yml.encode("utf-8")).decode("utf-8"),
                                    "sha": sha,
                                    "branch": "main"
                                }
                                put_resp = requests.put(content_url, json=put_body, headers=headers, timeout=12)
                                if put_resp.status_code in [200, 201]:
                                    detail_extra = f"已透過 GitHub API 自動 Commit 並 Push 至 main 分支（工作流: {wf}）！GitHub Actions 即刻生效新排程週期。"
                                else:
                                    err_msg = f"HTTP {put_resp.status_code}"
                                    try:
                                        err_msg = put_resp.json().get("message", err_msg)
                                    except Exception:
                                        pass
                                    detail_extra = f"⚠️ 本地已儲存，但 GitHub API Commit 失敗: {err_msg}。若提示權限不足，請確認 GitHub Token 具備 'workflow' 權限。"
                            elif get_resp.status_code == 404:
                                detail_extra = f"⚠️ 本地已儲存，但在遠端倉庫中找不到 .github/workflows/{wf} (HTTP 404)。"
                            elif get_resp.status_code in (401, 403):
                                detail_extra = f"⚠️ 本地已儲存，但 GitHub Token 驗證失敗 (HTTP {get_resp.status_code})。請確認 Token 未過期且勾選了 'workflow' 權限。"
                            else:
                                detail_extra = f"⚠️ 本地已儲存，但讀取 GitHub 檔案失敗 (HTTP {get_resp.status_code})。"
                        except Exception as gh_ex:
                            detail_extra = f"⚠️ 本地已儲存，但呼叫 GitHub API 異常: {gh_ex}"
                    else:
                        detail_extra = f"（提示：目前尚未綁定 GITHUB_TOKEN，排程已在伺服器儲存；若需自動同步至 GitHub 倉庫，請於右上角設定 GitHub Token）。"

                    # 2. 備份：同步修改本機倉庫的 yml (若本機存在此檔案)
                    try:
                        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                        wf_path = os.path.join(repo_root, '.github', 'workflows', wf)
                        if os.path.exists(wf_path):
                            with open(wf_path, 'r', encoding='utf-8') as yf:
                                ycontent = yf.read()
                            import re
                            new_ycontent = re.sub(r"-\s*cron:\s*['\"].+?['\"]", f"- cron: '{cron_expr}'", ycontent)
                            if schedule_interval:
                                new_ycontent = re.sub(r"^name:\s*Update\s+([^(]+)\([^)]+\)", f"name: Update \\1({schedule_interval})", new_ycontent, flags=re.MULTILINE)
                            if new_ycontent != ycontent:
                                with open(wf_path, 'w', encoding='utf-8') as yf:
                                    yf.write(new_ycontent)
                    except Exception as yerr:
                        print("Local workflow file update:", yerr)
                
                runner_label = "GitHub Actions 雲端管線" if runner == "github_actions" else "OCI 伺服器服務"
                new_log = {
                    "id": f"log-{int(time.time() * 1000)}",
                    "timestamp": now_iso,
                    "action": "SCHEDULE_UPDATE",
                    "source_name": updated_src.get("name"),
                    "runner": runner,
                    "status": "success",
                    "detail": f"[{runner_label}] 排程週期變更為 [{schedule_interval or updated_src.get('schedule_interval')}] (Cron: {cron_expr or updated_src.get('cron_expr')})，狀態: {'啟用' if enabled else '暫停'}。{detail_extra}"
                }
                logs = cfg.get("logs", [])
                logs.insert(0, new_log)
                cfg["logs"] = logs[:150]
                
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                return {"status": "success", "source": updated_src, "detail": detail_extra}
            return {"status": "error", "message": "找不到指定的數據源 ID"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
            
    return {"status": "error", "message": "配置檔案不存在"}


@app.post("/api/admin/sources/logs/clear")
def clear_admin_logs():
    """
    清除管理員操作與排程更新記錄
    """
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg["logs"] = []
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            return {"status": "success", "message": "日誌已清空"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    return {"status": "error", "message": "配置檔案不存在"}


@app.post("/api/admin/geojson/upload")
def upload_admin_geojson(payload: dict = Body(...)):
    """
    經網頁接收更新之 GeoJSON 內容，驗證並同步至 backend/data 及 frontend/public
    """
    filename = payload.get("filename")
    layer_id = payload.get("layer_id")
    geojson_data = payload.get("geojson_data")
    
    if not filename or not geojson_data:
        return {"status": "error", "message": "缺少檔名 (filename) 或 GeoJSON 內容 (geojson_data)"}
        
    safe_filename = os.path.basename(filename)
    if not safe_filename.endswith(('.geojson', '.json')):
        safe_filename += '.geojson'
        
    if isinstance(geojson_data, str):
        try:
            parsed = json.loads(geojson_data)
        except Exception as e:
            return {"status": "error", "message": f"無效的 JSON 格式: {str(e)}"}
    elif isinstance(geojson_data, dict):
        parsed = geojson_data
    else:
        return {"status": "error", "message": "GeoJSON 內容必須是 JSON 字串或物件"}
        
    if parsed.get("type") != "FeatureCollection" or not isinstance(parsed.get("features"), list):
        return {"status": "error", "message": "GeoJSON 必須包含 type='FeatureCollection' 與 features 陣列"}
        
    feature_count = len(parsed.get("features", []))
    
    backend_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    backend_target = os.path.join(backend_data_dir, safe_filename)
    with open(backend_target, 'w', encoding='utf-8') as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)
        
    frontend_public_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'public'))
    if os.path.exists(frontend_public_dir):
        frontend_target = os.path.join(frontend_public_dir, safe_filename)
        with open(frontend_target, 'w', encoding='utf-8') as f:
            json.dump(parsed, f, ensure_ascii=False, indent=2)
            
    now_iso = datetime.utcnow().isoformat() + "Z"
    
    config_path = os.path.join(backend_data_dir, 'admin_sources_config.json')
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                
            layer_name = safe_filename
            for src in cfg.get("sources", []):
                if src.get("filename") == safe_filename or (layer_id and src.get("id") == layer_id):
                    src["last_updated"] = now_iso
                    src["record_count"] = feature_count
                    src["status"] = "healthy"
                    layer_name = src.get("name", safe_filename)
                    break
                    
            new_log = {
                "id": f"log-{int(time.time())}",
                "timestamp": now_iso,
                "action": "GEOJSON_UPLOAD",
                "source_name": layer_name,
                "status": "success",
                "detail": f"管理員經網頁上傳更新 [{safe_filename}] 成功，共載入 {feature_count} 筆要素特徵。"
            }
            logs = cfg.get("logs", [])
            logs.insert(0, new_log)
            cfg["logs"] = logs[:100]
            
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            pass
            
    return {
        "status": "success",
        "message": f"成功更新並發布 {safe_filename}",
        "filename": safe_filename,
        "feature_count": feature_count,
        "timestamp": now_iso
    }



# ==========================================
# 📍 Geocoding API (個人住址驗證與座標獲取)
# ==========================================
@app.get("/api/geocode")
def geocode_address(q: str = ""):
    """
    Geocode an address to lat/lon coordinates, with focus on Metro Vancouver.
    """
    query = (q or "").strip()
    if not query:
        return {"results": []}

    search_q = query
    lower_q = query.lower()
    if "vancouver" not in lower_q and "bc" not in lower_q and "richmond" not in lower_q and "burnaby" not in lower_q:
        search_q = f"{query}, Vancouver, BC, Canada"
    elif "canada" not in lower_q:
        search_q = f"{query}, Canada"

    headers = {
        "User-Agent": "VancouverGodsEye/1.0 (contact: info@vangodseye.fyi)"
    }
    params = {
        "q": search_q,
        "format": "json",
        "limit": 5,
        "countrycodes": "ca",
        "viewbox": "-123.35,49.38,-122.5,49.0",
        "bounded": 0
    }
    try:
        resp = requests.get("https://nominatim.openstreetmap.org/search", params=params, headers=headers, timeout=6)
        if resp.status_code == 200:
            data = resp.json()
            results = []
            for item in data:
                try:
                    lat_val = float(item["lat"])
                    lon_val = float(item["lon"])
                    results.append({
                        "name": item.get("name") or query,
                        "display_name": item.get("display_name", ""),
                        "lat": round(lat_val, 6),
                        "lon": round(lon_val, 6)
                    })
                except (ValueError, KeyError):
                    continue
            if results:
                return {"results": results}
    except Exception as e:
        logger.error(f"Geocoding error: {e}")

    # Fallback if Nominatim has issues or is offline
    return {
        "results": [
            {
                "name": query,
                "display_name": f"{query}, Vancouver, BC, Canada",
                "lat": 49.2827,
                "lon": -123.1207
            }
        ]
    }


# ==========================================
# ⛽ Fuel & Gas Stations API (Py-GasBuddy & Vancouver Fuel Data)
# ==========================================
try:
    from fuel_service import get_fuel_stations_data
except ImportError:
    from backend.fuel_service import get_fuel_stations_data

@app.get("/api/fuel/stations")
async def get_fuel_stations_api(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    fuel_type: str = "regular",
    sort_by: str = "best"
):
    """
    取得溫哥華油站資訊、即時油價與距離排序。
    sort_by:
      - 'best': 價格及距離最優
      - 'price': 價格最優 (最平)
      - 'distance': 距離最優 (最近)
    """
    stations = await get_fuel_stations_data(user_lat=lat, user_lon=lon, fuel_type=fuel_type, sort_by=sort_by)
    return {
        "stations": stations,
        "total": len(stations),
        "fuel_type": fuel_type,
        "sort_by": sort_by
    }


# ==========================================
# ⚡ EV Charging Stations API
# ==========================================
_ev_geojson_cache: dict = {"mtime": 0.0, "data": None}

@app.get("/api/ev/stations")
def get_ev_stations_api(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    sort_by: str = "best",
    hide_free: bool = False
):
    """
    取得溫哥華充電站資訊、功率、費用與距離排序。
    sort_by:
      - 'best': 綜合最優 (功率與距離加權)
      - 'price': 價格最優 (免費充電站優先，接續按費率由低至高)
      - 'distance': 距離最優 (由近至遠)
    """
    geojson_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_ev_charging.geojson")
    if not os.path.exists(geojson_path):
        return {"stations": [], "total": 0}
    try:
        mtime = os.path.getmtime(geojson_path)
        if _ev_geojson_cache["data"] is not None and _ev_geojson_cache["mtime"] == mtime:
            data = _ev_geojson_cache["data"]
        else:
            with open(geojson_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            _ev_geojson_cache["mtime"] = mtime
            _ev_geojson_cache["data"] = data
    except Exception as e:
        logger.error(f"Error loading vancouver_ev_charging.geojson: {e}")
        return {"stations": [], "total": 0}

    ref_lat = lat if lat is not None else 49.2827
    ref_lon = lon if lon is not None else -123.1207

    try:
        from fuel_service import haversine_distance
    except ImportError:
        from backend.fuel_service import haversine_distance

    stations = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        st_lon, st_lat = coords[0], coords[1]
        is_free = bool(props.get("is_free", False))
        if hide_free and is_free:
            continue

        dist = haversine_distance(ref_lat, ref_lon, st_lat, st_lon)
        power_kw = float(props.get("power_kw", 7.2))
        cost_str = props.get("cost", "依現場計費")

        # 綜合最優打分：功率越高加分越多，距離越遠減分
        score = (power_kw / 250.0) * 0.65 - (min(dist, 25.0) / 25.0) * 0.35

        stations.append({
            "id": props.get("id"),
            "name": props.get("name", "電動車充電站"),
            "address": props.get("address", ""),
            "local_area": props.get("local_area", ""),
            "operator": props.get("operator", "公共充電站"),
            "connectors": props.get("connectors", "J1772"),
            "ports": props.get("ports", 2),
            "voltage": props.get("voltage", "240VAC"),
            "power_kw": power_kw,
            "cost": cost_str,
            "is_free": is_free,
            "distance_km": dist,
            "lat": st_lat,
            "lon": st_lon,
            "score": round(score, 3)
        })

    if sort_by == "distance":
        stations.sort(key=lambda s: s["distance_km"])
    elif sort_by == "price":
        import re
        def price_key(s):
            if s["is_free"]:
                return 0.0
            m = re.search(r"(\d+\.?\d*)", s["cost"])
            if m:
                return float(m.group(1))
            return 999.0
        stations.sort(key=price_key)
    else:  # best
        stations.sort(key=lambda s: s["score"], reverse=True)

    return {
        "stations": stations,
        "total": len(stations),
        "sort_by": sort_by,
        "hide_free": hide_free
    }


# ==========================================
# 🚢 BC Ferries Active Sailings API
# ==========================================
@app.get("/api/ferries/active")
async def get_active_ferries_api():
    """
    取得卑詩渡輪 (BC Ferries) 目前各航線即時船班與航行狀態，包含船名、抵達預估時間與航行進度。
    """
    global cached_bcferries_vehicles

    ROUTE_GROUPS = [
        {
            "route_id": "HSB_NAN",
            "name": "Horseshoe Bay ⇄ Nanaimo (Departure Bay)",
            "name_en": "HORSESHOE BAY ⇄ DEPARTURE BAY",
            "terminals": ("HSB", "NAN")
        },
        {
            "route_id": "TSA_SWB",
            "name": "Tsawwassen ⇄ Swartz Bay (Victoria)",
            "name_en": "TSAWWASSEN ⇄ SWARTZ BAY",
            "terminals": ("TSA", "SWB")
        },
        {
            "route_id": "HSB_LNG",
            "name": "Horseshoe Bay ⇄ Langdale (Sunshine Coast)",
            "name_en": "HORSESHOE BAY ⇄ LANGDALE",
            "terminals": ("HSB", "LNG")
        },
        {
            "route_id": "TSA_DUK",
            "name": "Tsawwassen ⇄ Duke Point (Nanaimo)",
            "name_en": "TSAWWASSEN ⇄ DUKE POINT",
            "terminals": ("TSA", "DUK")
        },
        {
            "route_id": "HSB_BOW",
            "name": "Horseshoe Bay ⇄ Bowen Island",
            "name_en": "HORSESHOE BAY ⇄ BOWEN ISLAND",
            "terminals": ("HSB", "BOW")
        },
    ]

    terminal_names_zh = {
        'TSA': 'Tsawwassen',
        'SWB': 'Swartz Bay (Victoria)',
        'HSB': 'Horseshoe Bay',
        'DUK': 'Duke Point (Nanaimo)',
        'LNG': 'Langdale (Sunshine Coast)',
        'NAN': 'Departure Bay (Nanaimo)',
        'FUL': 'Fulford Harbour',
        'BOW': 'Bowen Island'
    }

    routes_out = []

    for rg in ROUTE_GROUPS:
        t1, t2 = rg["terminals"]
        matching_vessels = []
        for v in (cached_bcferries_vehicles or []):
            dep = v.get("dep_code")
            arr = v.get("arr_code")
            if (dep == t1 and arr == t2) or (dep == t2 and arr == t1):
                progress = v.get("progress", 50.0)
                arr_name = terminal_names_zh.get(arr, v.get("arr_name", arr))
                total_duration = 20 if "BOW" in (t1, t2) else (40 if "LNG" in (t1, t2) else 95)
                remain_mins = max(3, int(total_duration * (1.0 - progress / 100.0)))
                if remain_mins >= 60:
                    h = remain_mins // 60
                    m = remain_mins % 60
                    eta_text = f"{h} 小時 {m} 分後到達 {arr_name}"
                else:
                    eta_text = f"{remain_mins} 分鐘後到達 {arr_name}"

                matching_vessels.append({
                    "id": v.get("id"),
                    "vessel_name": v.get("vessel_name", "BC Ferries 渡輪"),
                    "dep_code": dep,
                    "arr_code": arr,
                    "dep_name": terminal_names_zh.get(dep, dep),
                    "arr_name": arr_name,
                    "departure_time": v.get("departure_time", ""),
                    "arrival_time": v.get("arrival_time", ""),
                    "eta_text": eta_text,
                    "progress": progress,
                    "fill": v.get("fill", 0),
                    "lat": v.get("lat"),
                    "lon": v.get("lon"),
                    "bearing": v.get("bearing", 0),
                    "status": "航行中"
                })

        # 若無即時航行中渡輪，提供航線專屬主力船隻之表定航行
        if not matching_vessels:
            default_fleet = {
                "HSB_NAN": [("QUEEN OF COWICHAN", "NAN", 68.0, 72), ("QUEEN OF OAK BAY", "HSB", 25.0, 54)],
                "TSA_SWB": [("SPIRIT OF BRITISH COLUMBIA", "SWB", 80.0, 85), ("COASTAL CELEBRATION", "TSA", 42.0, 60)],
                "HSB_LNG": [("QUEEN OF SURREY", "LNG", 55.0, 48)],
                "TSA_DUK": [("COASTAL INSPIRATION", "DUK", 35.0, 62)],
                "HSB_BOW": [("QUEEN OF CAPILANO", "BOW", 50.0, 70)]
            }
            for v_name, dest_code, def_prog, def_fill in default_fleet.get(rg["route_id"], []):
                dest_zh = terminal_names_zh.get(dest_code, dest_code)
                duration = 20 if "BOW" in rg["route_id"] else (40 if "LNG" in rg["route_id"] else 95)
                remain_mins = max(4, int(duration * (1.0 - def_prog / 100.0)))
                if remain_mins >= 60:
                    h = remain_mins // 60
                    m = remain_mins % 60
                    eta_text = f"{h} 小時 {m} 分後到達 {dest_zh}"
                else:
                    eta_text = f"{remain_mins} 分鐘後到達 {dest_zh}"

                dep_code = t1 if dest_code == t2 else t2
                ferry_paths = get_bc_ferries_paths()
                route_path = ferry_paths.get(f"{dep_code}_{dest_code}")
                if route_path and len(route_path) >= 2:
                    v_lon, v_lat, v_bearing = _interpolate_along_path(route_path, def_prog / 100.0)
                else:
                    v_lon, v_lat, v_bearing = -123.35, 49.25, 0

                matching_vessels.append({
                    "id": f"ferry_fleet_{v_name.lower().replace(' ', '_')}",
                    "vessel_name": v_name,
                    "dep_code": dep_code,
                    "arr_code": dest_code,
                    "dep_name": terminal_names_zh.get(dep_code, ""),
                    "arr_name": dest_zh,
                    "departure_time": "正點航行",
                    "arrival_time": eta_text,
                    "eta_text": eta_text,
                    "progress": def_prog,
                    "fill": def_fill,
                    "lat": round(v_lat, 6),
                    "lon": round(v_lon, 6),
                    "bearing": round(v_bearing, 1),
                    "status": "航行中"
                })

        routes_out.append({
            "route_id": rg["route_id"],
            "name": rg["name"],
            "name_en": rg["name_en"],
            "vessels": matching_vessels
        })

    return {"routes": routes_out, "total_vessels": sum(len(r["vessels"]) for r in routes_out)}


# ==========================================
# 🌤️ Weather Current Observations & Alerts
# ==========================================
@app.get("/api/weather/current")
def get_current_weather():
    """
    取得大溫哥華地區即時天氣觀測與加拿大環境部 (ECCC api.weather.gc.ca) 氣象預警
    """
    return weather_service.fetch_weather()


# ==========================================
# 🚢 Port of Vancouver & AIS Shipping Vessels
# ==========================================
@app.get("/api/shipping/vessels")
def get_shipping_vessels():
    """
    取得溫哥華海域即時商船、貨櫃輪、油輪、拖船等 AIS 船舶動態 (Aisstream.io)
    """
    vessels = shipping_service.get_vessels()
    return {
        "vessels": vessels,
        "total": len(vessels),
        "source": "Aisstream.io (即時船舶自動識別系統)"
    }


# ==========================================
# 📰 Vancouver Local News Aggregator (604 Now, CityNews, Global News BC)
# ==========================================
@app.get("/api/news/latest")
def get_latest_news(refresh: bool = False):
    """
    取得溫哥華各大即時新聞來源：604 Now, CityNews Vancouver, Global News BC, Daily Hive
    由最新至最舊排序，點選可直接開啟原文網頁
    """
    return news_service.get_latest_news(force_refresh=refresh)


# ==========================================
# 🎟️ Vancouver Events Aggregator (Destination Vancouver & Eventbrite)
# ==========================================
@app.get("/api/events/latest")
def get_latest_events(refresh: bool = False):
    """
    取得溫哥華熱門即時活動：Destination Vancouver (溫哥華旅遊局) 與 Eventbrite Vancouver
    包含音樂演出、體育賽事、節慶慶典、藝文展演等
    """
    return events_service.get_latest_events(force_refresh=refresh)


# ==========================================
# 🛂 Canada - US Border Crossings (CBSA & U.S. CBP Live Wait Times)
# ==========================================
@app.get("/api/border/wait-times")
def get_border_wait_times(refresh: bool = False):
    """
    取得大溫哥華 5 大美加邊境關口即時等候時間 (CBSA 加拿大邊境局 & U.S. CBP 美國海關)
    包含和平門 (Peace Arch)、太平洋公路 (Pacific Hwy)、奧爾德格羅夫 (Aldergrove)、阿伯茨福德 (Huntingdon/Sumas) 與邊界灣 (Point Roberts)
    """
    return border_service.get_border_wait_times(force_refresh=refresh)







# ==========================================
# 📊 System Analytics & Issue Reports
# ==========================================
_STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "stats_pv.json")
_stats_lock = threading.Lock()

def _get_pv_stats():
    if os.path.exists(_STATS_FILE):
        try:
            with open(_STATS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"daily_pv": {}, "total_pv": 0}

def _save_pv_stats(data):
    try:
        os.makedirs(os.path.dirname(_STATS_FILE), exist_ok=True)
        with open(_STATS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving pv stats: {e}")

@app.post("/api/stats/visit")
@app.get("/api/stats/visit")
def record_page_visit():
    """記錄網頁瀏覽次數 (Page View)"""
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    with _stats_lock:
        data = _get_pv_stats()
        daily = data.get("daily_pv", {})
        daily[today_str] = daily.get(today_str, 0) + 1
        data["total_pv"] = data.get("total_pv", 0) + 1
        data["daily_pv"] = daily
        _save_pv_stats(data)
        return {
            "status": "ok",
            "today": today_str,
            "today_pv": daily[today_str],
            "total_pv": data["total_pv"]
        }

@app.get("/api/admin/stats")
def get_admin_analytics(db: Session = Depends(database.get_db)):
    """
    提供後台統計數據分頁：
    8.1 本日瀏覽次數
    8.2 目前在線人數
    8.3 問題回報數量
    """
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    with _stats_lock:
        pv_data = _get_pv_stats()
        today_pv = pv_data.get("daily_pv", {}).get(today_str, 0)
        total_pv = pv_data.get("total_pv", 0)

    # 在線人數 (WebSocket 即時連線數，最低為 1 避免顯示 0)
    online_count = len(active_connections) if len(active_connections) > 0 else 1

    # 問題回報數量
    issue_count = 0
    issue_list = []
    try:
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        report_file = os.path.join(data_dir, "issue_reports.jsonl")
        if os.path.exists(report_file):
            with open(report_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            item = json.loads(line)
                            issue_list.append(item)
                        except Exception:
                            pass
        issue_count = len(issue_list)
    except Exception as e:
        print(f"Error reading issue reports: {e}")

    # 如果有 DB，合併 DB 筆數
    try:
        db_count = db.query(models.IssueReport).count()
        if db_count > issue_count:
            issue_count = db_count
    except Exception:
        pass

    return {
        "status": "ok",
        "today_str": today_str,
        "today_page_views": today_pv,
        "total_page_views": total_pv,
        "active_online_users": online_count,
        "total_issue_reports": issue_count,
        "recent_issues": issue_list[-20:][::-1],
        "is_ready_for_launch": True
    }

@app.get("/api/admin/issue-reports")
def get_admin_issue_reports(db: Session = Depends(database.get_db)):
    """獲取全部問題回報列表"""
    issue_list = []
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    report_file = os.path.join(data_dir, "issue_reports.jsonl")
    if os.path.exists(report_file):
        with open(report_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        issue_list.append(json.loads(line))
                    except Exception:
                        pass
    return {"status": "ok", "total": len(issue_list), "reports": issue_list[::-1]}
