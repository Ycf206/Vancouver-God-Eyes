from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import asyncio
import requests
import time
from google.transit import gtfs_realtime_pb2
import database
import models
import os
from datetime import datetime

try:
    models.Base.metadata.create_all(bind=database.engine)
except Exception as e:
    print(f"Database connection error on startup (might be booting): {e}")

app = FastAPI(title="Vancouver God's Eye API")

from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
active_connections: list[WebSocket] = []
stop_arrivals = {}
cached_translink_vehicles: list[dict] = []
cached_bcferries_vehicles: list[dict] = []
cached_flight_schedules: dict = {}
cached_skytrain_trains: list[dict] = []

import flights
import skytrain_service
from weather_service import weather_service
from shipping_service import shipping_service

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
    global cached_bcferries_vehicles
    while True:
        try:
            r = requests.get('https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
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
            
            if active_connections:
                message = {"type": "bc_ferries_update", "data": vehicles}
                for connection in list(active_connections):
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass
                    
        except Exception as e:
            print(f"Error in BC Ferries fetch: {e}")
            
        await asyncio.sleep(15)


_gtfs_metadata_cache = None
trip_realtime_etas = {}

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


def _compute_vehicle_stop_progress(variant: dict, stop_id: str, stop_seq: int, lat: float, lon: float, trip_id: str):
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

    enriched_stops = []
    for idx, s in enumerate(stops):
        sid = str(s["stop_id"])
        if idx < next_idx:
            st_status = "passed"
            eta_time_str = ""
            eta_min = None
        elif idx == next_idx:
            st_status = "next"
            eta_time_str = _format_vancouver_hhmm(base_next_ts)
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
        "next_stop_time": _format_vancouver_hhmm(base_next_ts),
        "next_stop_minutes": base_next_min,
        "next_stop_index": next_idx,
        "stops": enriched_stops,
    }


async def fetch_translink_realtime():
    """Fetches VehiclePositions and enriches with GTFS static bus numbers, origins, destinations & next stops."""
    global cached_translink_vehicles
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsposition?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            gtfs_meta = get_gtfs_metadata()
            routes_lookup = gtfs_meta.get("routes", {})
            variant_route_ids = {v["route_id"] for v in gtfs_meta.get("variants", {}).values()}

            # Query the DB for the current active IDs!
            db = database.SessionLocal()
            try:
                valid_routes = db.query(models.TransitRoute).all()
                valid_route_ids = {r.route_id for r in valid_routes} | variant_route_ids
                seabus_ids = {r.route_id for r in valid_routes if r.route_group == 'seabus'} | {"6771"}
            except Exception:
                valid_route_ids = variant_route_ids
                seabus_ids = {"6771"}
            finally:
                db.close()
                
            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
            
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
                        prog = _compute_vehicle_stop_progress(variant, stop_id, stop_seq, lat, lon, trip_id)

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

            vehicles.extend(seabus_simulated)
            cached_translink_vehicles = vehicles
            
            if active_connections:
                message = {"type": "vehicles_update", "data": vehicles}
                for connection in list(active_connections):
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass
                    
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
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
            
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
            if active_connections:
                message = {"type": "skytrain_trains_update", "data": trains}
                for connection in list(active_connections):
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass
        except Exception as e:
            print(f"Error in SkyTrain simulation broadcast: {e}")
        await asyncio.sleep(4)

async def broadcast_maritime_vessels():
    while True:
        try:
            vessels = shipping_service.get_vessels()
            if active_connections:
                message = {"type": "maritime_vessels_update", "data": vessels}
                for connection in list(active_connections):
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass
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
async def get_ferry_terminal_schedule(terminal_code: str):
    try:
        r = requests.get('https://www.bcferriesapi.ca/v2/', timeout=10)
        data = r.json()
        
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
    },
    {
        "id": "spot_flight_path_park",
        "title": "飛機迷賞機公園 (Flight Path Park)",
        "subtitle": "Larry Berg Flight Path Park · 跑道賞機點",
        "category": "airports",
        "badge": "最佳賞機點",
        "icon": "📸",
        "lon": -123.1558,
        "lat": 49.2016,
        "zoom": 16,
        "layer_key": "airports",
        "keywords": ["flight path park", "賞機公園", "看飛機", "larry berg", "跑道"]
    }
]

_curated_static_caches = {}
_db_synced_curated_types = set()

CURATED_STATIC_TYPES = (
    "bikeways", "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "local_area_boundary", "fuel", "ev_charging", "tesla", "marine_terminals", 
    "one_way_streets", "snow_removal_routes", "crime_areas", "water_distribution_mains", 
    "sewer_mains", "traffic_speed_limits", "bike_racks", "postal_code_fsa", "wireless_facilities",
    "traffic_crosswalks", "litter_containers"
)
POINT_CURATED_TYPES = (
    "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "fuel", "ev_charging", "tesla", "marine_terminals", "bike_racks", "wireless_facilities",
    "traffic_crosswalks", "litter_containers"
)

def sync_curated_point_types(db: Session):
    for facility_type in POINT_CURATED_TYPES:
        if facility_type not in _db_synced_curated_types:
            filename = f"vancouver_{facility_type}.geojson"
            static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
            if os.path.exists(static_geojson_path):
                try:
                    import json
                    with open(static_geojson_path, "r", encoding="utf-8") as f:
                        static_geojson = json.load(f)
                    if facility_type in ("aed", "car_sharing", "bike_racks", "wireless_facilities", "traffic_crosswalks", "litter_containers"):
                        db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).delete()
                    for feat in static_geojson.get("features", []):
                        props = feat.get("properties", {})
                        geom_type = feat.get("geometry", {}).get("type")
                        coords = feat.get("geometry", {}).get("coordinates", [])
                        if geom_type == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
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
                            db.merge(fac)
                    db.commit()
                    _db_synced_curated_types.add(facility_type)
                except Exception as e:
                    db.rollback()
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

@app.get("/api/search")
def search_layer_items(q: str = "", db: Session = Depends(database.get_db)):
    """
    全圖層項目搜尋 (Search Layer Items):
    搜尋圖層中的項目：站名 (SkyTrain/SeaBus/Bus)、碼頭名 (BC Ferries)、機場與水上飛機、道路設施、政府機構 (消防局/社區中心)
    """
    q_clean = q.strip().lower()
    if not q_clean:
        return {"results": []}

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

        for score, rid, rnum, rlong, rmeta in matching_routes[:8]:
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
        ).limit(30).all()

        skytrain_stops = [s for s in stops if s.stop_group == 'skytrain']
        seabus_stops = [s for s in stops if s.stop_group == 'seabus']
        bus_stops = [s for s in stops if s.stop_group == 'bus']

        for s in skytrain_stops[:6]:
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

        for s in seabus_stops[:2]:
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

        for s in bus_stops[:6]:
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

    # 3. 搜尋道路設施與政府機構 (Road & Gov Facilities)
    try:
        from sqlalchemy import cast, String
        facilities = db.query(models.RoadFacility).filter(
            models.RoadFacility.name.ilike(f"%{q_clean}%") |
            models.RoadFacility.local_area.ilike(f"%{q_clean}%") |
            cast(models.RoadFacility.details, String).ilike(f"%{q_clean}%")
        ).limit(20).all()

        for f in facilities:
            ftype = f.facility_type
            badge = "市政設施"
            icon = "📍"
            layer_key = None
            zoom = 16

            if ftype == 'fire_halls':
                badge = "消防"
                icon = "🚒"
                layer_key = "fireHalls"
            elif ftype == 'police':
                badge = "警察局"
                icon = "👮"
                layer_key = "police"
                zoom = 16
            elif ftype == 'disaster_hubs':
                badge = "災害支援中心"
                icon = "🛟"
                layer_key = "disasterHubs"
                zoom = 16
            elif ftype == 'hospitals':
                badge = "醫療"
                icon = "🏥"
                layer_key = "hospitals"
                zoom = 15
            elif ftype == 'community_centres':
                badge = "社區中心"
                icon = "🏛️"
                layer_key = "communityCentres"
            elif ftype == 'ev_charging':
                badge = "充電站"
                icon = "⚡"
                layer_key = "evCharging"
            elif ftype == 'tesla':
                badge = "TESLA"
                icon = "⚡"
                layer_key = "tesla"
                zoom = 16
            elif ftype == 'fuel':
                badge = "加油站"
                icon = "⛽"
                layer_key = "fuel"
                zoom = 16
            elif ftype == 'car_sharing':
                badge = "共享汽車"
                icon = "🚗"
                layer_key = "carSharing"
                zoom = 16
            elif ftype == 'shared_bikes':
                badge = "共享單車"
                icon = "🚲"
                layer_key = "sharedBikes"
                zoom = 16
            elif ftype == 'escooter':
                badge = "共享滑板車"
                icon = "🛴"
                layer_key = "escooter"
                zoom = 17
            elif ftype == 'bike_racks':
                badge = "單車架"
                icon = "🚲"
                layer_key = "bikeRacks"
                zoom = 17
            elif ftype == 'parking_meters':
                badge = "收費錶"
                icon = "🅿️"
                layer_key = "parkingMeters"
                zoom = 17
            elif ftype == 'accessible_parking':
                badge = "無障礙車位"
                icon = "♿"
                layer_key = "accessibleParking"
                zoom = 17
            elif ftype == 'motorcycle_parking':
                badge = "摩托車位"
                icon = "🏍"
                layer_key = "motorcycleParking"
                zoom = 17
            elif ftype == 'traffic_cameras':
                badge = "交通攝影機"
                icon = "📷"
                layer_key = "trafficCameras"
                zoom = 16
            elif ftype == 'safety_cameras':
                badge = "路口安全相機"
                icon = "🚨"
                layer_key = "safetyCameras"
                zoom = 16
            elif ftype == 'traffic_crosswalks':
                badge = "斑馬線"
                icon = "🚶"
                layer_key = "trafficCrosswalks"
                zoom = 17
            elif ftype == 'traffic_speed_limits':
                badge = "限速路段"
                icon = "🚦"
                layer_key = "trafficSpeedLimits"
                zoom = 15
            elif ftype == 'marine_terminals':
                badge = "碼頭"
                icon = "⚓"
                layer_key = "marineTerminals"
                zoom = 15
            elif ftype == 'wireless_facilities':
                badge = "無線設施"
                icon = "📡"
                layer_key = "wirelessFacilities"
                zoom = 16
            elif ftype == 'litter_containers':
                badge = "垃圾箱"
                icon = "🗑️"
                layer_key = "litterContainers"
                zoom = 17
            elif ftype == 'aed':
                badge = "AED 去顫器"
                icon = "💓"
                layer_key = "aed"
                zoom = 17
            elif ftype == 'parks':
                badge = "公園"
                icon = "🌲"
                layer_key = "parks"
                zoom = 15
            elif ftype == 'parks_facilities':
                badge = "休憩設施"
                icon = "🛝"
                layer_key = "parksFacilities"
                zoom = 16
            elif ftype == 'community_gardens':
                badge = "社區花園"
                icon = "🌻"
                layer_key = "communityGardens"
                zoom = 16
            elif ftype == 'drinking_fountains':
                badge = "飲水器"
                icon = "💧"
                layer_key = "drinkingFountains"
                zoom = 17
            elif ftype == 'public_washrooms':
                badge = "公共廁所"
                icon = "🚻"
                layer_key = "publicWashrooms"
                zoom = 17
            elif ftype == 'schools':
                badge = "學校"
                icon = "🏫"
                layer_key = "schools"
                zoom = 16
            elif ftype == 'libraries':
                badge = "圖書館"
                icon = "📚"
                layer_key = "libraries"
                zoom = 16
            elif ftype == 'food_vendors':
                badge = "食品攤販"
                icon = "🍱"
                layer_key = "foodVendors"
                zoom = 17
            elif ftype == 'homeless_shelters':
                badge = "庇護所"
                icon = "🏠"
                layer_key = "homelessShelters"
                zoom = 16
            elif ftype == 'postal_code_fsa':
                badge = "郵遞編號"
                icon = "📮"
                layer_key = "postalCodeFSA"
                zoom = 13

            sub_parts = [badge]
            if ftype == 'police':
                sub_parts.append("溫哥華市警局 (VPD)")
            elif ftype == 'disaster_hubs':
                sub_parts.append("災後緊急集結點")
            elif ftype == 'fuel' and f.details and isinstance(f.details, dict):
                brand = f.details.get('brand') or f.details.get('operator')
                if brand:
                    sub_parts.append(str(brand))
            elif ftype == 'tesla' and f.details and isinstance(f.details, dict):
                ttype = f.details.get('charger_type') or "Supercharger"
                sub_parts.append(str(ttype))
            elif ftype == 'marine_terminals':
                sub_parts.append("溫哥華港碼頭")
            elif ftype == 'safety_cameras' and f.details and isinstance(f.details, dict) and f.details.get('camera_type'):
                sub_parts.append(str(f.details.get('camera_type')))
            elif ftype == 'hospitals' and f.details and isinstance(f.details, dict):
                if f.details.get('chinese_name'):
                    sub_parts.append(str(f.details.get('chinese_name')))
                elif f.local_area:
                    sub_parts.append(f.local_area)
            elif ftype == 'shared_bikes' and f.details and isinstance(f.details, dict):
                sub_parts.append("Mobi")
                if f.details.get('station_id'):
                    sub_parts.append(f"#{f.details.get('station_id')}")
                if f.details.get('capacity'):
                    sub_parts.append(f"{f.details.get('capacity')} 柱")
            elif ftype == 'parks' and f.details and isinstance(f.details, dict):
                if f.details.get('neighbourhood'):
                    sub_parts.append(str(f.details.get('neighbourhood')))
                if f.details.get('hectare'):
                    sub_parts.append(f"{f.details.get('hectare')} 公頃")
            elif ftype == 'parks_facilities' and f.details and isinstance(f.details, dict):
                if f.details.get('park_name'):
                    sub_parts.append(str(f.details.get('park_name')))
                if f.details.get('facility_type_name'):
                    sub_parts.append(str(f.details.get('facility_type_name')))
            elif ftype == 'community_gardens' and f.details and isinstance(f.details, dict):
                if f.details.get('plots'):
                    sub_parts.append(f"{f.details.get('plots')} 區劃")
                elif f.local_area:
                    sub_parts.append(f.local_area)
            elif ftype == 'drinking_fountains' and f.details and isinstance(f.details, dict):
                if f.details.get('in_operation'):
                    sub_parts.append(str(f.details.get('in_operation')))
                if f.details.get('location'):
                    sub_parts.append(str(f.details.get('location')))
            elif ftype == 'public_washrooms' and f.details and isinstance(f.details, dict):
                if f.details.get('washroom_type'):
                    sub_parts.append(str(f.details.get('washroom_type')))
                if f.details.get('wheelchair_access'):
                    sub_parts.append(str(f.details.get('wheelchair_access')))
            elif ftype == 'schools' and f.details and isinstance(f.details, dict):
                if f.details.get('school_category_zh'):
                    sub_parts.append(str(f.details.get('school_category_zh')))
                if f.details.get('address'):
                    sub_parts.append(str(f.details.get('address')))
            elif ftype == 'libraries' and f.details and isinstance(f.details, dict):
                if f.details.get('address'):
                    sub_parts.append(str(f.details.get('address')))
                elif f.local_area:
                    sub_parts.append(f.local_area)
            elif ftype == 'food_vendors' and f.details and isinstance(f.details, dict):
                if f.details.get('description'):
                    sub_parts.append(str(f.details.get('description')))
                if f.details.get('location_desc'):
                    sub_parts.append(str(f.details.get('location_desc')))
            elif ftype == 'homeless_shelters' and f.details and isinstance(f.details, dict):
                if f.details.get('category'):
                    sub_parts.append(str(f.details.get('category')))
                if f.details.get('meals'):
                    sub_parts.append(str(f.details.get('meals')))
            elif f.local_area:
                sub_parts.append(f.local_area)
            if f.details and isinstance(f.details, dict):
                addr = f.details.get('address') or f.details.get('location') or f.details.get('street')
                if addr and str(addr) != f.name:
                    sub_parts.append(str(addr))

            results.append({
                "id": f.id,
                "title": f.name,
                "subtitle": " · ".join(sub_parts),
                "category": ftype,
                "badge": badge,
                "icon": icon,
                "lon": f.lon,
                "lat": f.lat,
                "zoom": zoom,
                "layer_key": layer_key,
                "meta": {
                    "id": f.id,
                    "facility_type": f.facility_type,
                    "name": f.name,
                    "local_area": f.local_area,
                    "properties": f.details or {}
                }
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
                if len(results) >= 25:
                    break
    except Exception as e:
        print(f"Error searching maritime vessels: {e}")

    # 5. 搜尋郵遞編號分區 (Postal Code FSA)
    try:
        for item in get_search_fsa_items():
            fsa_code = item["meta"].get("fsa", "").lower()
            fsa_name = item["title"].lower()
            if q_clean in fsa_code or q_clean in fsa_name or (q_clean in ("郵遞", "郵區", "fsa", "postal") and len(results) < 20):
                results.append(item)
                if len(results) >= 25:
                    break
    except Exception as e:
        print(f"Error searching FSA: {e}")

    # 6. 搜尋區域邊界 (Local Area Boundaries)
    try:
        for item in get_search_local_area_items():
            area_name = item["meta"].get("name", "").lower()
            if q_clean in area_name or (q_clean in ("邊界", "分區", "boundary", "neighborhood", "neighbourhood") and len(results) < 20):
                results.append(item)
                if len(results) >= 25:
                    break
    except Exception as e:
        print(f"Error searching local area boundaries: {e}")

    # 7. 搜尋單車徑 (Bikeways)
    try:
        for item in get_search_bikeway_items():
            bw_name = item["title"].lower()
            if q_clean in bw_name or (q_clean in ("單車徑", "bike", "bikeway") and len(results) < 20):
                results.append(item)
                if len(results) >= 25:
                    break
    except Exception as e:
        print(f"Error searching bikeways: {e}")

    return {"results": results[:30]}

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

        webcam_images_cache[url] = (now, images)
        return {"images": images}
    except Exception as e:
        print(f"Error fetching webcam images for {url}: {e}")
        return {"images": []}

from fastapi import Response
from fastapi.responses import FileResponse

webcam_image_bytes_cache = {}

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
from sqlalchemy import func

_bikeways_geojson_cache = {"data": None, "mtime": 0}
_contours_caches = {
    "1m": {"data": None, "mtime": 0},
    "2m": {"data": None, "mtime": 0},
    "10m": {"data": None, "mtime": 0},
}

@app.get("/api/geojson/road/{facility_type}")
def get_road_facilities_geojson(facility_type: str, interval: str = "10m", db: Session = Depends(database.get_db)):
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
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "no-cache, must-revalidate"})
        return {"type": "FeatureCollection", "features": []}

    # 2. Prioritize verified curated static GeoJSON files (hospitals/UPCC, police, etc.)
    if facility_type in CURATED_STATIC_TYPES:
        filename = f"vancouver_{facility_type}.geojson"
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
        if os.path.exists(static_geojson_path):
            if facility_type in POINT_CURATED_TYPES and facility_type not in _db_synced_curated_types:
                sync_curated_point_types(db)
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "no-cache, must-revalidate"})

    facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
    
    # Auto-import on-the-fly if not yet populated in DB
    if not facilities:
        # 1. Check for precompiled verified GeoJSON in backend/data/
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", f"vancouver_{facility_type}.geojson")
        if os.path.exists(static_geojson_path):
            try:
                with open(static_geojson_path, "r", encoding="utf-8") as f:
                    static_geojson = json.load(f)
                
                # Auto-populate DB for future queries & search
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
                        db.merge(fac)
                db.commit()
                return static_geojson
            except Exception as e:
                db.rollback()
                print(f"Error populating {facility_type} from static geojson: {e}")
                if os.path.exists(static_geojson_path):
                    with open(static_geojson_path, "r", encoding="utf-8") as f:
                        return json.load(f)

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
                return json.load(f)
            
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
            
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [f.lon, f.lat]
            },
            "properties": props
        })
    return {"type": "FeatureCollection", "features": features}

@app.get("/api/geojson/stops/{group}")
def get_stops_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
    stops = db.query(models.TransitStop).filter(models.TransitStop.stop_group == group).all()
    
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
    return {"type": "FeatureCollection", "features": features}

@app.get("/api/geojson/tracks/{group}")
def get_tracks_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
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
    
    features = []
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
    return {"type": "FeatureCollection", "features": features}

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
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

class IssueReportRequest(BaseModel):
    title: str
    details: str
    contact_email: Optional[str] = None

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
                "contact_email": payload.contact_email or ""
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
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"[上帝之眼問題回報] {payload.title}"
            msg["From"] = smtp_user
            msg["To"] = target_email

            body_text = f"""溫哥華上帝之眼 - 使用者問題回報
=============================================
回報標題: {payload.title}
送出時間: {now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}
聯絡 Email: {payload.contact_email or '未提供'}

問題詳情:
---------------------------------------------
{payload.details}
=============================================
"""
            msg.attach(MIMEText(body_text, "plain", "utf-8"))

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
    取得溫哥華加油站資訊、即時油價與距離排序。
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
        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)
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
            "name": "馬蹄灣 ⇄ 納奈莫 (出發灣)",
            "name_en": "HORSESHOE BAY ⇄ DEPARTURE BAY",
            "terminals": ("HSB", "NAN")
        },
        {
            "route_id": "TSA_SWB",
            "name": "杜瓦森 ⇄ 斯沃茨灣 (維多利亞)",
            "name_en": "TSAWWASSEN ⇄ SWARTZ BAY",
            "terminals": ("TSA", "SWB")
        },
        {
            "route_id": "HSB_LNG",
            "name": "馬蹄灣 ⇄ 朗代爾 (陽光海岸)",
            "name_en": "HORSESHOE BAY ⇄ LANGDALE",
            "terminals": ("HSB", "LNG")
        },
        {
            "route_id": "TSA_DUK",
            "name": "杜瓦森 ⇄ 杜克角 (納奈莫)",
            "name_en": "TSAWWASSEN ⇄ DUKE POINT",
            "terminals": ("TSA", "DUK")
        },
        {
            "route_id": "HSB_BOW",
            "name": "馬蹄灣 ⇄ 寶雲島",
            "name_en": "HORSESHOE BAY ⇄ BOWEN ISLAND",
            "terminals": ("HSB", "BOW")
        },
    ]

    terminal_names_zh = {
        'TSA': '杜瓦森',
        'SWB': '斯沃茨灣',
        'HSB': '馬蹄灣',
        'DUK': '杜克角',
        'LNG': '朗代爾',
        'NAN': '出發灣',
        'FUL': '福爾福德',
        'BOW': '寶雲島'
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




