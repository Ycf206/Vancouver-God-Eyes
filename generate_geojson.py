import zipfile
import csv
import io
import json

zip_path = 'google_transit.zip'
# 30053=Expo, 30052=Millennium, 13686=Canada, 6771=SeaBus
skytrain_ids = {'30053', '30052', '13686', '6771'}
# 99=6641, R1=37808, R2=38311, R3=37809, R4=37810, R5=37807, R6=46604
bus_ids = {'6641', '37808', '38311', '37809', '37810', '37807', '46604'}
all_route_ids = skytrain_ids.union(bus_ids)

# Colors mapping
route_colors = {
    '30053': '#1d2c59', # Expo Line (Dark Blue)
    '30052': '#ffcd00', # Millennium Line (Yellow)
    '13686': '#00a4e4', # Canada Line (Light Blue)
    '6771': '#8b786d',  # SeaBus (Brown/Taupe from image)
    '6641': '#f58220',  # 99 B-Line (Orange)
    '37808': '#22c55e', # R1
    '38311': '#22c55e', # R2
    '37809': '#22c55e', # R3
    '37810': '#22c55e', # R4
    '37807': '#22c55e', # R5
    '46604': '#22c55e', # R6
}

print("Parsing GTFS Zip...")

trips_to_route = {}
shape_to_route = {}
skytrain_stops_set = set()
bus_stops_set = set()
shape_points = {}

with zipfile.ZipFile(zip_path, 'r') as z:
    with z.open('trips.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['route_id'] in all_route_ids:
                trips_to_route[row['trip_id']] = row['route_id']
                if row['shape_id'] not in shape_to_route:
                    shape_to_route[row['shape_id']] = row['route_id']
                
    with z.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            trip_id = row['trip_id']
            if trip_id in trips_to_route:
                route_id = trips_to_route[trip_id]
                if route_id in skytrain_ids:
                    skytrain_stops_set.add(row['stop_id'])
                else:
                    bus_stops_set.add(row['stop_id'])
                
    with z.open('shapes.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            sid = row['shape_id']
            if sid in shape_to_route:
                if sid not in shape_points:
                    shape_points[sid] = []
                shape_points[sid].append({
                    'pt_sequence': int(row['shape_pt_sequence']),
                    'lat': float(row['shape_pt_lat']),
                    'lon': float(row['shape_pt_lon'])
                })
                
    skytrain_stops_features = []
    bus_stops_features = []
    with z.open('stops.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            stop_id = row['stop_id']
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row['stop_lon']), float(row['stop_lat'])]
                },
                "properties": {
                    "stop_id": stop_id,
                    "name": row['stop_name']
                }
            }
            if stop_id in skytrain_stops_set:
                skytrain_stops_features.append(feature)
            if stop_id in bus_stops_set:
                bus_stops_features.append(feature)

skytrain_tracks_features = []
bus_tracks_features = []
for sid, points in shape_points.items():
    points.sort(key=lambda x: x['pt_sequence'])
    coords = [[p['lon'], p['lat']] for p in points]
    route_id = shape_to_route[sid]
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coords
        },
        "properties": {
            "shape_id": sid,
            "route_id": route_id,
            "color": route_colors.get(route_id, '#ffffff')
        }
    }
    if route_id in skytrain_ids:
        skytrain_tracks_features.append(feature)
    else:
        bus_tracks_features.append(feature)

with open('frontend/public/skytrain_tracks.json', 'w', encoding='utf-8') as f:
    json.dump({"type": "FeatureCollection", "features": skytrain_tracks_features}, f)
with open('frontend/public/skytrain_stops.json', 'w', encoding='utf-8') as f:
    json.dump({"type": "FeatureCollection", "features": skytrain_stops_features}, f)
with open('frontend/public/bus_tracks.json', 'w', encoding='utf-8') as f:
    json.dump({"type": "FeatureCollection", "features": bus_tracks_features}, f)
with open('frontend/public/bus_stops.json', 'w', encoding='utf-8') as f:
    json.dump({"type": "FeatureCollection", "features": bus_stops_features}, f)
    
print("Done!")
