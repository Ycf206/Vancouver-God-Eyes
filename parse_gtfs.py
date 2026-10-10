import zipfile
import csv
import io

zip_path = r'c:\Users\yeung\Downloads\google_transit.zip'

try:
    with zipfile.ZipFile(zip_path, 'r') as z:
        with z.open('routes.txt') as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
            print("=== SkyTrain Routes ===")
            for row in reader:
                # Translink typically uses route_type 2 for commuter rail (West Coast Express) 
                # but let's just search by name or type
                name = row.get('route_long_name', '').lower()
                if 'expo' in name or 'canada' in name or 'millennium' in name or row.get('route_type') == '1':
                    print(f"ID: {row['route_id']}, Name: {row['route_long_name']}, Type: {row['route_type']}")
except Exception as e:
    print("Error:", e)
