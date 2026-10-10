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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            # Just keep connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)

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
            now = datetime.now()
            # Handle GTFS >24h time format
            current_time_str = f"{now.hour:02d}:{now.minute:02d}:{now.second:02d}"
            if now.hour < 3: # If after midnight, could be represented as 24+
                current_time_str = f"{now.hour + 24:02d}:{now.minute:02d}:{now.second:02d}"

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
            
            if active_connections:
                message = {"type": "vehicles_update", "data": vehicles}
                for connection in active_connections:
                    await connection.send_json(message)
                    
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
    asyncio.create_task(fetch_translink_trip_updates())

@app.get("/")
async def root():
    return {"message": "Welcome to Vancouver God's Eye API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/stops/{stop_id}/arrivals")
async def get_stop_arrivals(stop_id: str):
    return {"stop_id": stop_id, "arrivals": stop_arrivals.get(stop_id, [])[:10]}

import json
from sqlalchemy import func

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
