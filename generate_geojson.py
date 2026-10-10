import zipfile
import csv
import io
import json

zip_path = 'google_transit.zip'
skytrain_route_ids = {'30053', '30052', '13686'} # Expo, Millennium, Canada

# Colors mapping
route_colors = {
    '30053': '#0033a0', # Expo Line
    '30052': '#ffcd00', # Millennium Line
    '13686': '#00b5e2'  # Canada Line (淺藍色)
}

print("Parsing GTFS Zip...")

trips_to_route = {}
shape_to_route = {}
stops_set = set()
shape_points = {}

with zipfile.ZipFile(zip_path, 'r') as z:
    print("Reading trips.txt...")
    with z.open('trips.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['route_id'] in skytrain_route_ids:
                trips_to_route[row['trip_id']] = row['route_id']
                if row['shape_id'] not in shape_to_route:
                    shape_to_route[row['shape_id']] = row['route_id']
                
    print("Reading stop_times.txt...")
    with z.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for row in reader:
            if row['trip_id'] in trips_to_route:
                stops_set.add(row['stop_id'])
                
    print("Reading shapes.txt...")
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
                
    print("Reading stops.txt...")
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

# Build tracks GeoJSON
print("Building Tracks GeoJSON...")
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
            "color": route_colors[shape_to_route[sid]]
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

print("Saving to frontend/public...")
with open('frontend/public/skytrain_tracks.geojson', 'w', encoding='utf-8') as f:
    json.dump(tracks_geojson, f)
    
with open('frontend/public/skytrain_stops.geojson', 'w', encoding='utf-8') as f:
    json.dump(stops_geojson, f)
    
print("Done!")
