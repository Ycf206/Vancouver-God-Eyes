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

@app.get("/api/search")
def search_layer_items(q: str = "", db: Session = Depends(database.get_db)):
    """
    全圖層項目搜尋 (Search Layer Items):
    搜尋圖層中的項目：站名 (SkyTrain/SeaBus/Bus)、碼頭名 (BC Ferries)、道路設施、政府機構 (消防局/社區中心)
    """
    q_clean = q.strip().lower()
    if not q_clean:
        return {"results": []}

    results = []

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
                "layer_key": "bcferriesTerminals",
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
                "layer_key": "skytrainStops",
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
                "layer_key": "seabusStops",
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
                "layer_key": "busStops",
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
            layer_key = "parkingMeters"
            zoom = 16

            if ftype == 'fire_halls':
                badge = "消防局"
                icon = "🚒"
                layer_key = "fireHalls"
            elif ftype == 'community_centres':
                badge = "社區中心"
                icon = "🏛️"
                layer_key = "communityCentres"
            elif ftype == 'ev_charging':
                badge = "充電站"
                icon = "⚡"
                layer_key = "evCharging"
            elif ftype == 'escooter':
                badge = "共享滑板車"
                icon = "🛴"
                layer_key = "escooter"
                zoom = 17
            elif ftype == 'shared_bikes':
                badge = "共享單車"
                icon = "🚲"
                layer_key = "sharedBikes"
                zoom = 16
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
            elif ftype == 'hospitals':
                badge = "醫院"
                icon = "🏥"
                layer_key = "hospitals"
                zoom = 15
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

            sub_parts = [badge]
            if ftype == 'safety_cameras' and f.details and isinstance(f.details, dict) and f.details.get('camera_type'):
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

    return {"results": results[:25]}

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

@app.get("/api/webcam/proxy")
def proxy_webcam_image(url: str):
    """
    代理交通攝影機圖片，避免瀏覽器跨域 (CORS) 或 Referrer 限制
    """
    if not url:
        return Response(status_code=400)
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://trafficcams.vancouver.ca/"
        }
        r = requests.get(url, headers=headers, timeout=10)
        return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))
    except Exception as e:
        print(f"Webcam proxy error for {url}: {e}")
        return Response(status_code=404)

hospital_waittimes_cache = {"timestamp": 0, "data": {}}

@app.get("/api/hospitals/waittimes")
def get_hospital_waittimes():
    """
    獲取溫哥華各大醫院急診即時預估等候時間 (erstat.ca)
    每 1 小時自動快取更新一次
    """
    now = time.time()
    if now - hospital_waittimes_cache["timestamp"] < 3600 and hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        url = "https://erstat.ca/hospitals/bc/vancouver"
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code == 200:
            hosp_map = {}
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

                    full_url = f"https://erstat.ca{href}" if href.startswith('/') else href

                    hosp_map[name.lower()] = {
                        "name": name,
                        "meta": meta_text,
                        "wait_time": wait_time,
                        "status": status,
                        "is_predicted": 'predicted' in classes,
                        "url": full_url
                    }
            except Exception:
                import re
                row_pattern = re.compile(r'<a\s+[^>]*?href=[\"|\']([^\"\']+)[\"|\'][^>]*?class=[\"|\']hospital-row[\"|\'][^>]*?>(.*?)</a>', re.S | re.I)
                for m in row_pattern.finditer(html):
                    href, block = m.group(1), m.group(2)
                    name_m = re.search(r'<h3>([^<]+)</h3>', block, re.I)
                    wait_m = re.search(r'<div\s+[^>]*?class=[\"|\']hospital-row-wait([^\"\']*)[\"|\'][^>]*?>([^<]+)</div>', block, re.I)
                    if name_m and wait_m:
                        name = name_m.group(1).strip()
                        classes = wait_m.group(1)
                        wait_time = wait_m.group(2).strip()
                        status = 'packed' if 'packed' in classes else ('moderate' if 'moderate' in classes else ('quick' if 'quick' in classes else 'normal'))
                        hosp_map[name.lower()] = {
                            "name": name,
                            "wait_time": wait_time,
                            "status": status,
                            "is_predicted": 'predicted' in classes,
                            "url": f"https://erstat.ca{href}" if href.startswith('/') else href
                        }

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
    except Exception as e:
        print(f"Error fetching hospital wait times: {e}")

    if hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    return {"cached": False, "last_updated": "", "hospitals": {}}

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
