import sys
import os
import requests
import json
import re
from datetime import datetime

# Windows encoding safety
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database
import models

# Fallback pre-verified accurate coordinates for all 43 Vancouver safety cameras
# Verified against City of Vancouver official intersection traffic movement counts
VERIFIED_VANCOUVER_COORDINATES = {
    "Boundary Road at E 1 Avenue": [-123.023642649664, 49.2694567477204],
    "Boundary Road at E 49 Avenue": [-123.023606579336, 49.2219475667675],
    "Burrard Street at Davie Street": [-123.129181117067, 49.2790800585704],
    "Burrard Street at Pacific Street": [-123.132369080681, 49.276970665521],
    "Cambie Street at W 41 Avenue": [-123.116192190428, 49.2335434701942],
    "Clark Drive at E Hastings Street": [-123.077092917807, 49.2813216268518],
    "Clark Drive at Venables Street": [-123.077228130828, 49.2767557901435],
    "Dundas Street at Nanaimo Street": [-123.056530916608, 49.2847919782587],
    "E 1 Avenue at Commercial Drive": [-123.069621664266, 49.2695996340758],
    "E 49 Avenue at Fraser Street": [-123.09077387286, 49.225471822633],
    "E 49 Avenue at Main Street": [-123.101632002575, 49.225663160914],
    "E Broadway at Main Street": [-123.100959552457, 49.2629134523986],
    "E Broadway at Nanaimo Street": [-123.056601076643, 49.2621493236791],
    "E Broadway Avenue at Commercial Drive": [-123.069762688147, 49.2623194541699],
    "E Hastings Street at Main Street": [-123.099648798315, 49.2813356595642],
    "E Hastings Street at Nanaimo Street": [-123.05655071446, 49.2811460997902],
    "E Hastings Street at Renfrew Street": [-123.044076520854, 49.2811232429382],
    "Grandview Hwy at Rupert Street": [-123.033771994207, 49.2581502388647],
    "Granville Street at SW Marine Drive": [-123.140643842999, 49.2050742477074],
    "Granville Street at W 16 Avenue": [-123.138802310813, 49.2570539196924],
    "Granville Street at W 41 Avenue": [-123.139588020868, 49.2343303690082],
    "Granville Street at W 49 Avenue": [-123.139843254787, 49.2269658269465],
    "Granville Street at W King Edward Ave": [-123.139083718034, 49.2494135681774],
    "Kingsway at Fraser Street": [-123.089854052781, 49.2567175686813],
    "Kingsway at Joyce Street": [-123.035876616588, 49.2341534988201],
    "Kingsway at Nanaimo Street": [-123.058127991121, 49.2418856341958],
    "Kingsway at Victoria Drive": [-123.065153288388, 49.2451645233662],
    "Knight Street at E 33 Avenue": [-123.07640496412, 49.2402092009028],
    "Knight Street at E 49 Avenue": [-123.077291375599, 49.2252943974205],
    "Oak Street at W 33 Avenue": [-123.127818712954, 49.2414345896128],
    "Oak Street at W 41 Avenue": [-123.128074250468, 49.2339516500522],
    "Oak Street at W 49TH Avenue": [-123.128315682237, 49.2265526749615],
    "Oak Street at W 57 Avenue": [-123.128590605796, 49.2192040297827],
    "Oak Street at W 70 Avenue": [-123.13024568806, 49.2084713060909],
    "SE Marine Drive at Argyle Street": [-123.071301338005, 49.2110145197325],
    "SE Marine Drive at Fraser Street": [-123.09110216274, 49.2110128638778],
    "SE Marine Drive at Kerr Street": [-123.042256338686, 49.2081071383573],
    "SE Marine Drive at Main Street": [-123.102193665642, 49.211094282372],
    "SE Marine Drive at Victoria Drive": [-123.06611124721, 49.2096895759308],
    "Terminal Avenue at Main Street": [-123.100028035364, 49.2727762969897],
    "Victoria Drive at E 41 Avenue": [-123.065536694432, 49.2327506154927],
    "W Georgia Street at Cardero Street": [-123.130597257994, 49.2905612452676],
    "W Georgia Street at Denman Street": [-123.13374007094, 49.2925946723086],
}

def clean_street(name):
    name = name.upper()
    name = re.sub(r'\b(STREET|ST|AVENUE|AVE|AV|ROAD|RD|BOULEVARD|BLVD|HIGHWAY|HWY|DRIVE|DR)\b', '', name)
    name = re.sub(r'(\d+)(ST|ND|RD|TH)', r'\1', name)
    name = re.sub(r'[^A-Z0-9]', ' ', name)
    return set(name.split())

def fetch_vancouver_intersections_from_opendata():
    """Fetch all official intersections from Vancouver Open Data"""
    try:
        url = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/intersection-traffic-movement-counts/records?limit=100&offset=0"
        all_intersections = []
        offset = 0
        while True:
            res = requests.get(f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/intersection-traffic-movement-counts/records?limit=100&offset={offset}", timeout=10).json()
            results = res.get('results', [])
            if not results:
                break
            all_intersections.extend(results)
            offset += len(results)
            if offset >= res.get('total_count', 0):
                break
        return all_intersections
    except Exception as e:
        print(f"  ⚠️ Warning: Could not fetch OpenData intersections: {e}")
        return []

def scrape_bc_gov_safety_cameras():
    """Scrape the BC Gov RoadSafetyBC website for Vancouver intersection safety cameras"""
    url = "https://www2.gov.bc.ca/gov/content/transportation/driving-and-cycling/roadsafetybc/intersection-safety-cameras/where-the-cameras-are"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    print(f"📡 Fetching BC Gov safety cameras from {url}...")
    try:
        from bs4 import BeautifulSoup
        resp = requests.get(url, headers=headers, timeout=12)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "html.parser")
    except Exception as e:
        print(f"  ⚠️ Error scraping BC Gov website ({e}). Falling back to verified records.")
        soup = None

    vancouver_cameras = []

    if soup:
        table = soup.find("table")
        if table:
            rows = table.find_all("tr")
            for r in rows:
                cols = [td.get_text(strip=True) for td in r.find_all(["td", "th"])]
                if len(cols) >= 4:
                    municipality = cols[0]
                    location = cols[1]
                    red_light = cols[2]
                    speed = cols[3]

                    if municipality.lower() == "vancouver":
                        has_red = (red_light.lower() == "yes")
                        has_spd = (speed.lower() == "yes")

                        if has_red and has_spd:
                            cam_type = "雙向取締 (闖紅燈 + 超速)"
                        elif has_red:
                            cam_type = "闖紅燈攝影"
                        else:
                            cam_type = "超速攝影"

                        vancouver_cameras.append({
                            "municipality": municipality,
                            "location": location,
                            "has_red_light": has_red,
                            "has_speed": has_spd,
                            "camera_type": cam_type
                        })

    # If scraping failed or returned fewer than expected, ensure verified baseline
    if not vancouver_cameras:
        print("  ℹ️ Using pre-verified camera dataset...")
        for loc in VERIFIED_VANCOUVER_COORDINATES.keys():
            # Check default speed status for known dual-enforcement cameras
            has_spd = loc in [
                "Boundary Road at E 49 Avenue", 
                "E Hastings Street at Renfrew Street", 
                "Grandview Hwy at Rupert Street", 
                "Granville Street at W 16 Avenue", 
                "Kingsway at Joyce Street", 
                "Kingsway at Victoria Drive", 
                "Knight Street at E 33 Avenue", 
                "Knight Street at E 49 Avenue", 
                "Oak Street at W 57 Avenue", 
                "Oak Street at W 70 Avenue", 
                "SE Marine Drive at Kerr Street", 
                "SE Marine Drive at Victoria Drive"
            ]
            vancouver_cameras.append({
                "municipality": "Vancouver",
                "location": loc,
                "has_red_light": True,
                "has_speed": has_spd,
                "camera_type": "雙向取締 (闖紅燈 + 超速)" if has_spd else "闖紅燈攝影"
            })

    print(f"  Found {len(vancouver_cameras)} Vancouver safety cameras.")
    return vancouver_cameras

def import_safety_cameras(db=None):
    """Imports or updates Vancouver intersection safety cameras into RoadFacility DB"""
    should_close = False
    if db is None:
        models.Base.metadata.create_all(bind=database.engine)
        db = database.SessionLocal()
        should_close = True

    try:
        print("=" * 60)
        print("🚨 Starting Vancouver Intersection Safety Cameras Import")
        print(f"📅 Timestamp: {datetime.utcnow().isoformat()}Z")
        print("=" * 60)

        cameras = scrape_bc_gov_safety_cameras()
        opendata_intersections = fetch_vancouver_intersections_from_opendata()

        objects_to_add = []
        for idx, cam in enumerate(cameras):
            loc = cam["location"]
            coords = VERIFIED_VANCOUVER_COORDINATES.get(loc)
            official_name = loc

            # If coords not in verified dictionary, attempt OpenData match
            if not coords and opendata_intersections:
                parts = re.split(r'\s+(?:AT|AND|&)\s+', loc, flags=re.I)
                if len(parts) >= 2:
                    w1, w2 = clean_street(parts[0]), clean_street(parts[1])
                    for item in opendata_intersections:
                        iname = item.get('intersection', '')
                        iparts = re.split(r'\s+(?:AND|&)\s+', iname, flags=re.I)
                        if len(iparts) >= 2:
                            iw1, iw2 = clean_street(iparts[0]), clean_street(iparts[1])
                            if (w1.issubset(iw1) and w2.issubset(iw2)) or (w1.issubset(iw2) and w2.issubset(iw1)):
                                coords = item['geom']['geometry']['coordinates']
                                official_name = iname
                                break

            if not coords:
                print(f"  ⚠️ Warning: No coordinates found for {loc}, skipping.")
                continue

            lon, lat = coords[0], coords[1]
            obj_id = f"safety_cam_{idx + 1}"

            details = {
                "location": loc,
                "official_intersection": official_name,
                "municipality": "Vancouver",
                "has_red_light": cam["has_red_light"],
                "has_speed": cam["has_speed"],
                "camera_type": cam["camera_type"],
                "fine_info": "闖紅燈罰款 $167 (扣3點)；超速依速限累進罰款 $138~$483 及記點",
                "enforcement_agency": "RoadSafetyBC / ICBC / VPD",
                "source": "BC Government Intersection Safety Camera Program"
            }

            facility = models.RoadFacility(
                id=obj_id,
                facility_type="safety_cameras",
                name=loc,
                local_area="Vancouver",
                lat=lat,
                lon=lon,
                geom=f"SRID=4326;POINT({lon} {lat})",
                details=details,
                last_updated=datetime.utcnow()
            )
            objects_to_add.append(facility)

        # Clear existing safety cameras and save fresh records
        db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == "safety_cameras").delete()
        for fac in objects_to_add:
            db.add(fac)
        db.commit()

        print(f"✅ Successfully imported {len(objects_to_add)} Vancouver safety cameras into database!")
        return objects_to_add

    except Exception as e:
        db.rollback()
        print(f"❌ Error importing safety cameras: {e}")
        return []
    finally:
        if should_close:
            db.close()

if __name__ == "__main__":
    import_safety_cameras()
