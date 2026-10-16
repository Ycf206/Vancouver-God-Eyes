import zipfile
import xml.etree.ElementTree as ET
import json
import os

kmz_path = r"g:\我的雲端硬碟\GodEyes\Active Free Public WiFi Location.kmz"
if not os.path.exists(kmz_path):
    print("KMZ file not found:", kmz_path)
    exit(1)

z = zipfile.ZipFile(kmz_path, 'r')
kml_bytes = z.read('doc.kml')
root = ET.fromstring(kml_bytes)

ns = {'kml': 'http://www.opengis.net/kml/2.2'}
features = []

for pm in root.findall('.//kml:Placemark', ns):
    name_el = pm.find('kml:name', ns)
    name_str = name_el.text.strip() if name_el is not None and name_el.text else "VanWiFi 熱點"

    props = {}
    for d in pm.findall('.//kml:Data', ns):
        dname = d.get('name')
        val_el = d.find('kml:value', ns)
        val_str = val_el.text.strip() if val_el is not None and val_el.text else ""
        if dname:
            props[dname] = val_str

    lon, lat = None, None
    coords_el = pm.find('.//kml:coordinates', ns)
    if coords_el is not None and coords_el.text:
        parts = coords_el.text.strip().split(',')
        if len(parts) >= 2:
            try:
                lon = float(parts[0])
                lat = float(parts[1])
            except ValueError:
                pass

    if lon is None and 'Longitude' in props and 'Latitude' in props:
        try:
            lon = float(props['Longitude'])
            lat = float(props['Latitude'])
        except ValueError:
            pass

    if lon is not None and lat is not None:
        obj_id = str(props.get('OBJECTID', len(features) + 1)).replace('.0', '')
        site_name = name_str
        addr = props.get('Address', '')
        ssid = props.get('SSID', '#VanWiFi')
        provider = props.get('SERVICEPROVIDER') or props.get('Service Provider') or 'City of Vancouver'
        site_type = props.get('Site Type', '')
        ap_count = props.get('APCOUNT', '')

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "id": f"vanwifi_{obj_id}",
                "name": site_name,
                "facility_type": "van_wifi",
                "address": addr,
                "ssid": ssid,
                "service_provider": provider,
                "site_type": site_type,
                "ap_count": ap_count,
                "city": props.get('City', 'Vancouver'),
                "province": props.get('Province', 'BC'),
                "postal_code": props.get('Zipcode', ''),
                "activation_date": props.get('Activation Date', ''),
                "lat": lat,
                "lon": lon,
                "info_url": "https://vancouver.ca/your-government/vanwifi.aspx"
            }
        })

print(f"Total VanWiFi points parsed: {len(features)}")
if features:
    print("Sample feature:", json.dumps(features[0], ensure_ascii=False, indent=2))

out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'vancouver_van_wifi.geojson')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        "type": "FeatureCollection",
        "name": "VanWiFi_Locations",
        "features": features
    }, f, ensure_ascii=False, indent=2)

print("Saved VanWiFi GeoJSON to:", out_path)
