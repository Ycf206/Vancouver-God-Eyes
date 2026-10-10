import sys
import os
# Add backend to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zipfile
import csv
import io
import requests
from sqlalchemy.orm import Session
from database import SessionLocal, engine
from models import Base, TransitRoute, TransitStop, TransitShape

def import_gtfs():
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    
    # Path to google_transit.zip in the root of the project
    zip_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'google_transit.zip')
    
    if not os.path.exists(zip_path):
        print("Downloading GTFS from TransLink...")
        url = "https://ns.translink.ca/gtfs/google_transit.zip"
        response = requests.get(url, verify=False)
        with open(zip_path, 'wb') as f:
            f.write(response.content)

    print("Parsing GTFS Zip...")
    
    # We must use stable route_short_name or route_long_name because route_ids change every season!
    target_short_names = {'99', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'}
    target_long_names = {'expo line', 'canada line', 'millennium line', 'seabus'}
    
    route_colors_mapping = {
        'expo line': '#1d2c59', 
        'millennium line': '#ffcd00', 
        'canada line': '#00a4e4',
        'seabus': '#8b786d', 
        '99': '#f58220', 
        'R1': '#22c55e',
        'R2': '#22c55e', 
        'R3': '#22c55e', 
        'R4': '#22c55e',
        'R5': '#22c55e', 
        'R6': '#22c55e'
    }

    try:
        # Clear old data
        print("Clearing old static data from database...")
        db.query(TransitShape).delete()
        db.query(TransitStop).delete()
        db.query(TransitRoute).delete()
        db.commit()

        trips_to_route = {}
        shape_to_route = {}
        stop_set = {}
        shape_points = {}
        
        # We will collect the actual ephemeral route_ids dynamically
        found_skytrain_ids = set()
        found_seabus_ids = set()
        found_bus_ids = set()

        with zipfile.ZipFile(zip_path, 'r') as z:
            
            print("Importing Routes...")
            with z.open('routes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    rid = row['route_id']
                    short_name = row.get('route_short_name', '').upper().strip()
                    long_name = row.get('route_long_name', '').lower().strip()
                    
                    is_skytrain = any(line in long_name for line in ['expo line', 'canada line', 'millennium line'])
                    is_seabus = 'seabus' in long_name
                    is_bus = short_name in target_short_names
                    
                    if is_skytrain or is_seabus or is_bus:
                        group = 'skytrain' if is_skytrain else ('seabus' if is_seabus else 'bus')
                        
                        if is_skytrain: found_skytrain_ids.add(rid)
                        elif is_seabus: found_seabus_ids.add(rid)
                        else: found_bus_ids.add(rid)
                        
                        color_key = next((k for k in ['expo line', 'millennium line', 'canada line', 'seabus'] if k in long_name), short_name)
                        color = route_colors_mapping.get(color_key, '#ffffff')
                        
                        route = TransitRoute(
                            route_id=rid,
                            short_name=short_name,
                            long_name=row['route_long_name'],
                            route_group=group,
                            color=color
                        )
                        db.add(route)
            db.commit()
            
            all_route_ids = found_skytrain_ids.union(found_bus_ids).union(found_seabus_ids)

            print("Parsing Trips and Shapes...")
            with z.open('trips.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    if row['route_id'] in all_route_ids:
                        trips_to_route[row['trip_id']] = row['route_id']
                        if row['shape_id'] not in shape_to_route:
                            shape_to_route[row['shape_id']] = row['route_id']
                        
            print("Finding Stops for filtered routes...")
            with z.open('stop_times.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    trip_id = row['trip_id']
                    if trip_id in trips_to_route:
                        route_id = trips_to_route[trip_id]
                        stop_id = row['stop_id']
                        group = 'skytrain' if route_id in found_skytrain_ids else ('seabus' if route_id in found_seabus_ids else 'bus')
                        # Note: A stop could serve both Bus and SkyTrain (e.g. Commercial-Broadway), 
                        # so we prioritize keeping it as SkyTrain if there's a conflict
                        if stop_id not in stop_set or group == 'skytrain':
                            stop_set[stop_id] = group

            print("Importing Stops...")
            with z.open('stops.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    stop_id = row['stop_id']
                    if stop_id in stop_set:
                        lat = float(row['stop_lat'])
                        lon = float(row['stop_lon'])
                        # WKT Format for PostGIS geometry
                        point_wkt = f"SRID=4326;POINT({lon} {lat})"
                        stop = TransitStop(
                            stop_id=stop_id,
                            name=row['stop_name'],
                            lat=lat,
                            lon=lon,
                            stop_group=stop_set[stop_id],
                            location=point_wkt
                        )
                        db.add(stop)
            db.commit()

            print("Importing Shapes (Trajectories)...")
            with z.open('shapes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    sid = row['shape_id']
                    if sid in shape_to_route:
                        if sid not in shape_points:
                            shape_points[sid] = []
                        shape_points[sid].append({
                            'seq': int(row['shape_pt_sequence']),
                            'lat': float(row['shape_pt_lat']),
                            'lon': float(row['shape_pt_lon'])
                        })
            
            for sid, points in shape_points.items():
                points.sort(key=lambda x: x['seq'])
                route_id = shape_to_route[sid]
                group = 'skytrain' if route_id in found_skytrain_ids else ('seabus' if route_id in found_seabus_ids else 'bus')
                
                # Construct PostGIS LineString WKT
                coord_str = ", ".join([f"{p['lon']} {p['lat']}" for p in points])
                linestring_wkt = f"SRID=4326;LINESTRING({coord_str})"
                
                shape = TransitShape(
                    shape_id=sid,
                    route_id=route_id,
                    route_group=group,
                    geom=linestring_wkt
                )
                db.add(shape)
            db.commit()

        print("✅ GTFS Static Import Completed Successfully!")
        
    except Exception as e:
        print(f"❌ Error during import: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    import_gtfs()
