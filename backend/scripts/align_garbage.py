import json
import os

# Helper to build closed polygon
def make_poly(coords):
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return [coords]

# Street Coordinates:
# West:
#   Blanca St: -123.2150
#   Camosun St / SW Marine Dr: -123.1990 down to -123.1920
#   Alma St: -123.1860
#   MacDonald St: -123.1680
#   Valley Dr / West Blvd: -123.1535
#   Ontario / Manitoba St: -123.1070
#   Main St: -123.1010
#   Clark Dr / Knight St: -123.0780
#   Argyle / Victoria Dr: -123.0655
#   Nanaimo St: -123.0560
#   Boundary Rd: -123.0235

# North/South Avenues:
#   Burrard Inlet / English Bay shoreline: ~49.2730 - 49.2900
#   4th Ave: 49.2675
#   Broadway (9th Ave): 49.2635
#   12th Ave: 49.2600
#   16th Ave: 49.2565
#   25th Ave (King Edward): 49.2485
#   33rd Ave: 49.2415
#   37th Ave: 49.2380
#   41st Ave: 49.2335
#   49th Ave: 49.2245
#   57th Ave: 49.2155
#   70th Ave / SW Marine Dr / Fraser River: 49.2025 - 49.2040

# 1. NORTH-ORANGE: West Point Grey / North Dunbar
# Bounded by: Blanca St (W), English Bay / Spanish Banks / Jericho (N), Alma/MacDonald St (E), 16th Ave (S)
north_orange_coords = [
    [-123.2150, 49.2565], # Blanca & 16th
    [-123.2150, 49.2755], # Blanca & Spanish Banks
    [-123.2000, 49.2760], # Jericho Beach Park
    [-123.1860, 49.2730], # Point Grey Rd & Alma
    [-123.1860, 49.2675], # Alma & 4th Ave
    [-123.1680, 49.2675], # MacDonald & 4th Ave
    [-123.1680, 49.2565], # MacDonald & 16th Ave
    [-123.2150, 49.2565]  # Close
]

# 2. SOUTH-ORANGE: South Dunbar / Southlands / Kerrisdale West
# Bounded by: 16th Ave (N), MacDonald down to 33rd Ave, then Valley Dr / West Blvd / Angus Dr down to Fraser River (E), Fraser River / North Arm (S), Blanca/Camosun/SW Marine Dr (W)
south_orange_coords = [
    [-123.2150, 49.2565], # Blanca & 16th
    [-123.1680, 49.2565], # MacDonald & 16th
    [-123.1680, 49.2415], # MacDonald & 33rd
    [-123.1535, 49.2415], # Valley Dr / West Blvd & 33rd
    [-123.1535, 49.2155], # West Blvd & 57th
    [-123.1500, 49.2025], # West Blvd & SW Marine / Fraser River
    [-123.1750, 49.2020], # Southlands Fraser River bank
    [-123.1950, 49.2040], # Musqueam / SW Marine Dr
    [-123.1990, 49.2245], # Camosun & 49th
    [-123.1990, 49.2415], # Camosun & 33rd
    [-123.2150, 49.2415], # Blanca & 33rd
    [-123.2150, 49.2565]  # Close
]

# 3. NORTH-BLUE: Kitsilano / Fairview / West End Downtown
# Bounded by: MacDonald St (W), English Bay / False Creek / Downtown / Coal Harbour (N), Ontario/Manitoba St (E), 16th Ave (S)
north_blue_coords = [
    [-123.1680, 49.2565], # MacDonald & 16th
    [-123.1680, 49.2675], # MacDonald & 4th Ave
    [-123.1540, 49.2745], # Kits Beach / English Bay
    [-123.1420, 49.2880], # Stanley Park border / English Bay
    [-123.1150, 49.2930], # Coal Harbour / Burrard Inlet
    [-123.1070, 49.2770], # False Creek East / Science World
    [-123.1070, 49.2565], # Ontario & 16th Ave
    [-123.1680, 49.2565]  # Close
]

# 4. SOUTH-BLUE: Shaughnessy / South Cambie / Kerrisdale / Marpole
# Bounded by: 16th Ave (N), Ontario/Manitoba St (E), Fraser River / SW Marine Dr (S), MacDonald/Valley Dr/West Blvd (W)
# Notice: completely adjacent to South Orange on the west, NO OVERLAP!
south_blue_coords = [
    [-123.1680, 49.2565], # MacDonald & 16th
    [-123.1070, 49.2565], # Ontario & 16th
    [-123.1070, 49.2025], # Ontario / Manitoba & SW Marine Dr / Fraser River
    [-123.1300, 49.2025], # Oak & SW Marine Dr
    [-123.1500, 49.2025], # West Blvd & SW Marine / Fraser River
    [-123.1535, 49.2155], # West Blvd & 57th
    [-123.1535, 49.2415], # Valley Dr / West Blvd & 33rd
    [-123.1680, 49.2415], # MacDonald & 33rd
    [-123.1680, 49.2565]  # Close
]

# 5. NORTH-GREEN: Mount Pleasant / South Main / Grandview North
# Bounded by: Ontario/Manitoba St (W), False Creek Flats / Prior / E Hastings (N), Clark Dr / Knight St (E), 16th Ave (S)
north_green_coords = [
    [-123.1070, 49.2565], # Ontario & 16th
    [-123.1070, 49.2770], # False Creek East / Main St
    [-123.0780, 49.2815], # Clark Dr & E Hastings
    [-123.0780, 49.2565], # Clark Dr & 16th
    [-123.1070, 49.2565]  # Close
]

# 6. SOUTH-GREEN: Riley Park / Sunset / Oakridge / Fraser South
# Bounded by: 16th Ave (N), Knight St (E), Fraser River / SE Marine Dr (S), Ontario/Manitoba St (W)
south_green_coords = [
    [-123.1070, 49.2565], # Ontario & 16th
    [-123.0780, 49.2565], # Knight & 16th
    [-123.0780, 49.2040], # Knight & SE Marine Dr / Knight St Bridge
    [-123.1070, 49.2025], # Manitoba & SE Marine Dr / Fraser River
    [-123.1070, 49.2565]  # Close
]

# 7. NORTH-PURPLE: Downtown Eastside / Grandview-Woodland / Hastings-Sunrise
# Bounded by: Clark Dr (W), Burrard Inlet waterfront (N), Boundary Rd (E), 16th Ave / Grandview Hwy (S)
north_purple_coords = [
    [-123.0780, 49.2565], # Clark & 16th
    [-123.0780, 49.2815], # Clark & E Hastings
    [-123.0780, 49.2890], # Clark & Burrard Inlet docks
    [-123.0235, 49.2900], # Boundary & Burrard Inlet
    [-123.0235, 49.2580], # Boundary & Grandview Hwy
    [-123.0560, 49.2580], # Nanaimo & Grandview Hwy
    [-123.0780, 49.2565]  # Close
]

# 8. SOUTH-YELLOW: Victoria-Fraserview / Killarney / Champlain Heights
# Bounded by: 16th Ave / Grandview Hwy / Kingsway (N), Boundary Rd (E), Fraser River / SE Marine Dr (S), Knight St (W)
south_yellow_coords = [
    [-123.0780, 49.2565], # Knight & 16th
    [-123.0560, 49.2580], # Nanaimo & Grandview Hwy
    [-123.0235, 49.2580], # Boundary & Grandview Hwy
    [-123.0235, 49.2020], # Boundary & SE Marine Dr / Fraser River
    [-123.0780, 49.2040], # Knight & SE Marine Dr
    [-123.0780, 49.2565]  # Close
]

# Read original GeoJSON to preserve all properties, schedules, dates, and metadata
original_path = "C:/Users/yeung/.gemini/antigravity/scratch/vancouver-gods-eye/frontend/public/vancouver_garbage_collection.geojson"
with open(original_path, "r", encoding="utf-8") as f:
    geojson = json.load(f)

zone_polys = {
    "NORTH-ORANGE": north_orange_coords,
    "SOUTH-ORANGE": south_orange_coords,
    "NORTH-BLUE": north_blue_coords,
    "SOUTH-BLUE": south_blue_coords,
    "NORTH-GREEN": north_green_coords,
    "SOUTH-GREEN": south_green_coords,
    "NORTH-PURPLE": north_purple_coords,
    "SOUTH-YELLOW": south_yellow_coords
}

for feat in geojson["features"]:
    code = feat["properties"]["zone_code"]
    if code in zone_polys:
        feat["geometry"] = {
            "type": "Polygon",
            "coordinates": make_poly(zone_polys[code])
        }

# Write to frontend and backend
frontend_path = "C:/Users/yeung/.gemini/antigravity/scratch/vancouver-gods-eye/frontend/public/vancouver_garbage_collection.geojson"
backend_path = "C:/Users/yeung/.gemini/antigravity/scratch/vancouver-gods-eye/backend/data/vancouver_garbage_collection.geojson"

with open(frontend_path, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False, indent=2)

with open(backend_path, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False, indent=2)

print("Updated garbage collection GeoJSON successfully with aligned street boundaries!")
