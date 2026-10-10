from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float
from geoalchemy2 import Geometry
from datetime import datetime
from database import Base

class Vehicle(Base):
    """
    儲存即時交通工具 (公車、渡輪等) 的地理位置
    """
    __tablename__ = "vehicles"

    id = Column(String, primary_key=True, index=True) # 例如 Translink 的車輛 ID
    type = Column(String, index=True)                 # 'bus', 'ferry'
    route = Column(String, index=True)                # 路線名稱或號碼
    # 使用 PostGIS 的 Geometry 型別儲存經緯度點位 (SRID 4326 為 WGS84 標準經緯度)
    location = Column(Geometry(geometry_type='POINT', srid=4326))
    last_updated = Column(DateTime, default=datetime.utcnow)

class Alert(Base):
    """
    儲存突發狀況與快訊 (交通受阻、天氣警告等)
    """
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String)
    description = Column(String)
    category = Column(String, index=True) # 'traffic', 'weather'
    severity = Column(String)             # 'info', 'warning', 'critical'
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class TransitRoute(Base):
    """Static Data: Transit Routes"""
    __tablename__ = "transit_routes"
    
    route_id = Column(String, primary_key=True, index=True)
    short_name = Column(String)
    long_name = Column(String)
    route_group = Column(String, index=True) # 'skytrain', 'bus', 'seabus'
    color = Column(String)

class TransitStop(Base):
    """Static Data: Transit Stops"""
    __tablename__ = "transit_stops"
    
    stop_id = Column(String, primary_key=True, index=True)
    name = Column(String)
    lat = Column(Float)
    lon = Column(Float)
    stop_group = Column(String, index=True) # 'skytrain', 'bus', 'seabus'
    location = Column(Geometry(geometry_type='POINT', srid=4326))

class TransitShape(Base):
    """Static Data: Pre-compiled Route Shapes (Lines)"""
    __tablename__ = "transit_shapes"
    
    shape_id = Column(String, primary_key=True, index=True)
    route_id = Column(String)
    route_group = Column(String, index=True)
    geom = Column(Geometry(geometry_type='LINESTRING', srid=4326))
