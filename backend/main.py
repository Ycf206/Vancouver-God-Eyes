from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import asyncio
import requests
from google.transit import gtfs_realtime_pb2
import database
import models
import os

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
    """背景常駐排程：每 15 秒抓取一次 TransLink API 並透過 WebSocket 廣播"""
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsposition?apikey={TRANSLINK_API_KEY}"
    
    # SkyTrain 的 Route IDs (雖然即時資料目前不提供，但留著以防萬一)
    SKYTRAIN_ROUTES = {'30053', '30052', '13686'}
    # SeaBus 航線 (6771) 與大溫哥華「菁英公車」(99, 95/R5, 96/R1)
    ELITE_BUSES = {
        '6771', '6641', '6653', '22143',
        # 以下是即時資料中新出現的重要快線 (R1~R5) 或特快車
        '39304', '46099', '37809', '39307', '40855', '37810', 
        '36799', '48855', '37808', '37807', '38311', '46604'
    }
    
    while True:
        try:
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
                    
                    # 只顯示 SkyTrain, SeaBus 以及指定的 Elite Buses
                    if route_id in SKYTRAIN_ROUTES or route_id in ELITE_BUSES:
                        vehicles.append({
                            "id": v.vehicle.id,
                            "route_id": route_id,
                            "lat": v.position.latitude,
                            "lon": v.position.longitude,
                            "bearing": v.position.bearing,
                        })
            
            # 若有連線，則廣播給所有前端
            if active_connections:
                message = {"type": "vehicles_update", "data": vehicles}
                for connection in active_connections:
                    await connection.send_json(message)
                    
        except Exception as e:
            print(f"Error fetching TransLink data: {e}")
            
        await asyncio.sleep(15) # 每 15 秒更新一次

@app.on_event("startup")
async def startup_event():
    # 啟動背景抓取資料的 Task
    asyncio.create_task(fetch_translink_realtime())

@app.get("/")
async def root():
    return {"message": "Welcome to Vancouver God's Eye API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}
