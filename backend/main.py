from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect
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

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)


async def fetch_bcferries_realtime():
    global cached_bcferries_vehicles
    while True:
        try:
            r = requests.get('https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
            
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

            all_routes = data.get('capacityRoutes', []) + data.get('nonCapacityRoutes', [])
            seen_trips = set()
            
            for route in all_routes:
                dep_code = route.get('fromTerminalCode')
                arr_code = route.get('toTerminalCode')
                
                if dep_code not in terminals or arr_code not in terminals:
                    continue
                    
                dep_coord = terminals[dep_code]
                arr_coord = terminals[arr_code]
                bearing = calculate_bearing(dep_coord, arr_coord)
                
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
                    except Exception as e:
                        pass
                        
                    if status == 'current' or is_sailing:
                        seen_trips.add(trip_key)
                        lon = dep_coord[0] + (arr_coord[0] - dep_coord[0]) * progress
                        lat = dep_coord[1] + (arr_coord[1] - dep_coord[1]) * progress
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


async def fetch_translink_realtime():
    """Fetches VehiclePositions"""
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsposition?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            # Query the DB for the current active IDs!
            db = database.SessionLocal()
            try:
                # We need all the route_ids that are currently stored in our DB
                valid_routes = db.query(models.TransitRoute).all()
                valid_route_ids = {r.route_id for r in valid_routes}
                seabus_ids = {r.route_id for r in valid_routes if r.route_group == 'seabus'}
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
                        vehicles.append({
                            "id": v.vehicle.id,
                            "route_id": route_id,
                            "is_seabus": route_id in seabus_ids,
                            "lat": v.position.latitude,
                            "lon": v.position.longitude,
                            "bearing": v.position.bearing,
                        })
            
            seabus_simulated = []

            try:
                from zoneinfo import ZoneInfo
                now_seabus = datetime.now(ZoneInfo("America/Vancouver"))
            except:
                now_seabus = datetime.utcnow() - datetime.timedelta(hours=7)
                
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
                        
                        # Get shape geometry to interpolate
                        shape = db.query(models.TransitShape).filter(models.TransitShape.shape_id == trip.shape_id).first()
                        if shape:
                            # We can just fetch the LineString coordinates using PostGIS ST_PointN or ST_LineInterpolatePoint
                            point_result = db.query(
                                func.ST_X(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lon'),
                                func.ST_Y(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lat')
                            ).first()
                            
                            if point_result:
                                # Bearing logic: Waterfront to Lonsdale is roughly 15 degrees, Lonsdale to Waterfront is roughly 195 degrees
                                bearing = 15 if trip.direction_id == 0 else 195
                                seabus_simulated.append({
                                    "id": f"seabus_sim_{trip.trip_id}",
                                    "route_id": "6771", # Or dynamically get the first seabus_id
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
    """Polls GTFS-RT TripUpdates every 30 seconds to provide arrival times."""
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
            
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            new_arrivals = {}
            current_time = time.time()
            
            for entity in feed.entity:
                if entity.HasField('trip_update'):
                    tu = entity.trip_update
                    route_id = tu.trip.route_id
                    for stu in tu.stop_time_update:
                        stop_id = stu.stop_id
                        if stu.HasField('arrival') and stu.arrival.time > current_time:
                            if stop_id not in new_arrivals:
                                new_arrivals[stop_id] = []
                            new_arrivals[stop_id].append({
                                "route_id": route_id,
                                "arrival_time": stu.arrival.time,
                                "minutes": int((stu.arrival.time - current_time) / 60)
                            })
                            
            # Sort arrivals by time
            for stop_id in new_arrivals:
                new_arrivals[stop_id].sort(key=lambda x: x["arrival_time"])
                
            global stop_arrivals
            stop_arrivals = new_arrivals
            print(f"✅ Updated TripUpdates for {len(stop_arrivals)} stops")
            
        except Exception as e:
            print(f"Error fetching TripUpdates: {e}")
            
        await asyncio.sleep(30)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(fetch_translink_realtime())
    asyncio.create_task(fetch_bcferries_realtime())
    asyncio.create_task(fetch_translink_trip_updates())

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
    return {"stop_id": stop_id, "arrivals": stop_arrivals.get(stop_id, [])[:10]}

import json
from sqlalchemy import func

@app.get("/api/geojson/road/{facility_type}")
def get_road_facilities_geojson(facility_type: str, db: Session = Depends(database.get_db)):
    """
    facility_type can be 'parking_meters', 'accessible_parking', 'motorcycle_parking', or 'ev_charging'
    """
    facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
    
    # Auto-import on-the-fly if not yet populated in DB
    if not facilities:
        try:
            from scripts.import_road_data import import_single_facility_type
            import_single_facility_type(facility_type, db)
            facilities = db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).all()
        except Exception as e:
            print(f"Auto-import error for {facility_type}: {e}")
            
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
