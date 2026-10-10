import urllib.request
import ssl
import zipfile
import csv
import io
import json
import os

zip_path = 'google_transit.zip'
url = 'https://ns.translink.ca/gtfs/google_transit.zip'

print("Downloading GTFS...")
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    with urllib.request.urlopen(url, context=ctx) as response, open(zip_path, 'wb') as out_file:
        out_file.write(response.read())
    print("Download complete. Extracting SkyTrain routes...")
    
    skytrain_routes = []
    with zipfile.ZipFile(zip_path, 'r') as z:
        with z.open('routes.txt') as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
            for row in reader:
                name = row.get('route_long_name', '').lower()
                # 99999 = Millennium, 99998 = Expo, 99997 = Canada Line ?
                if 'expo line' in name or 'canada line' in name or 'millennium line' in name:
                    skytrain_routes.append(row)
                    
    print(json.dumps(skytrain_routes, indent=2))
except Exception as e:
    print("Error:", e)
