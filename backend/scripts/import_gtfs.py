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
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    zip_path = os.path.join(project_root, 'google_transit.zip')
    
    if not os.path.exists(zip_path):
        print("Downloading GTFS from TransLink...")
        # Note: Depending on TransLink's portal, the URL might need an API key. 
        # For this script, we'll assume the zip is downloaded via curl/wget in a cron script, 
        # or we can use a direct link if one is available.
        # This is a placeholder direct URL; if it fails, please place google_transit.zip in root manually.
        url = "https://gtfs.translink.ca/v2/gtfsdata"
        response = requests.get(url)
        with open(zip_path, 'wb') as f:
            f.write(response.content)

    print("Parsing GTFS Zip...")
    
    skytrain_ids = {'30053', '30052', '13686'}
    seabus_ids = {'6771'}
    bus_ids = {'6641', '37808', '38311', '37809', '37810', '37807', '46604'}
    all_route_ids = skytrain_ids.union(bus_ids).union(seabus_ids)
    
    route_colors = {
        '30053': '#1d2c59', '30052': '#ffcd00', '13686': '#00a4e4',
        '6771': '#8b786d', '6641': '#f58220', '37808': '#22c55e',
        '38311': '#22c55e', '37809': '#22c55e', '37810': '#22c55e',
        '37807': '#22c55e', '46604': '#22c55e'
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

        with zipfile.ZipFile(zip_path, 'r') as z:
            
            print("Importing Routes...")
            with z.open('routes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    rid = row['route_id']
                    if rid in all_route_ids:
                        group = 'skytrain' if rid in skytrain_ids else ('seabus' if rid in seabus_ids else 'bus')
                        route = TransitRoute(
                            route_id=rid,
                            short_name=row['route_short_name'],
                            long_name=row['route_long_name'],
                            route_group=group,
                            color=route_colors.get(rid, '#ffffff')
                        )
                        db.add(route)
            db.commit()

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
                        group = 'skytrain' if route_id in skytrain_ids else ('seabus' if route_id in seabus_ids else 'bus')
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
                group = 'skytrain' if route_id in skytrain_ids else ('seabus' if route_id in seabus_ids else 'bus')
                
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
