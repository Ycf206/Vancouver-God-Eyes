import zipfile
import csv
import io
import json

zip_path = 'google_transit.zip'
# 30053=Expo, 30052=Millennium, 13686=Canada, 6771=SeaBus
# 6641=99 B-Line, 6653=095 (R5), 22143=096 (R1)
skytrain_route_ids = {'30053', '30052', '13686', '6771', '6641', '6653', '22143'}

# Colors mapping
route_colors = {
    '30053': '#00a4e4',
    '30052': '#ffcd00',
    '13686': '#00b5e2',
    '6771': '#f58220',
    '6641': '#22c55e', # 99 B-Line (Green)
    '6653': '#22c55e', # R5
    '22143': '#22c55e' # R1
}

print("Parsing GTFS Zip...")

trips_to_route = {}
shape_to_route = {}
stops_set = set()
shape_points = {}

with zipfile.ZipFile(zip_path, 'r') as z:
    with z.open('trips.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['route_id'] in skytrain_route_ids:
                trips_to_route[row['trip_id']] = row['route_id']
                if row['shape_id'] not in shape_to_route:
                    shape_to_route[row['shape_id']] = row['route_id']
                
    with z.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['trip_id'] in trips_to_route:
                stops_set.add(row['stop_id'])
                
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
                
    stops_features = []
    with z.open('stops.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['stop_id'] in stops_set:
                stops_features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(row['stop_lon']), float(row['stop_lat'])]
                    },
                    "properties": {
                        "stop_id": row['stop_id'],
                        "name": row['stop_name']
                    }
                })

tracks_features = []
for sid, points in shape_points.items():
    points.sort(key=lambda x: x['pt_sequence'])
    coords = [[p['lon'], p['lat']] for p in points]
    tracks_features.append({
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coords
        },
        "properties": {
            "shape_id": sid,
            "route_id": shape_to_route[sid],
            "color": route_colors.get(shape_to_route[sid], '#ffffff')
        }
    })

tracks_geojson = {
    "type": "FeatureCollection",
    "features": tracks_features
}
stops_geojson = {
    "type": "FeatureCollection",
    "features": stops_features
}

with open('frontend/public/skytrain_tracks.json', 'w', encoding='utf-8') as f:
    json.dump(tracks_geojson, f)
    
with open('frontend/public/skytrain_stops.json', 'w', encoding='utf-8') as f:
    json.dump(stops_geojson, f)
    
print("Done!")
