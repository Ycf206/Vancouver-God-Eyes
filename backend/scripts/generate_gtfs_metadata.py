"""
Generates backend/data/translink_gtfs_metadata.json from TransLink GTFS static feed (google_transit.zip).
Provides:
1. Complete route_id -> route_number (short_name without leading zeros) & route_long_name mapping for all 239+ TransLink routes.
2. Complete route variants (origin, destination, headsign, ordered stops, and LineString shape coordinates) for live bus & SeaBus popups.
"""
import os
import io
import csv
import json
import zipfile
import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUTPUT_PATH = os.path.join(DATA_DIR, "translink_gtfs_metadata.json")
LOCAL_ZIP_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "google_transit.zip")


def clean_route_number(short_name: str, long_name: str) -> str:
    sn = (short_name or "").strip()
    ln = (long_name or "").strip()
    ln_lower = ln.lower()
    if "canada line" in ln_lower:
        return "Canada Line"
    if "expo line" in ln_lower:
        return "Expo Line"
    if "millennium line" in ln_lower:
        return "Millennium Line"
    if "seabus" in ln_lower:
        return "SeaBus"
    if "west coast express" in ln_lower:
        return "WCE"
    if sn.isdigit():
        return str(int(sn))
    return sn or ln


def clean_stop_terminal_name(stop_name: str) -> str:
    """Clean '@ Bay X' or 'Unload Only' suffixes for concise Origin/Destination headers."""
    if not stop_name:
        return ""
    s = stop_name.strip()
    if " @ " in s:
        base, after = s.split(" @ ", 1)
        if any(k in after.lower() for k in ["bay", "layover", "unload"]):
            return base.strip()
    for prefix in ["Northbound ", "Southbound ", "Eastbound ", "Westbound ", "NB ", "SB ", "EB ", "WB "]:
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s


def extract_dest_from_headsign(headsign: str, fallback_dest: str) -> str:
    if not headsign:
        return clean_stop_terminal_name(fallback_dest)
    hs = headsign.strip()
    if "/To " in hs:
        return hs.split("/To ", 1)[1].strip()
    if " To " in hs:
        return hs.split(" To ", 1)[1].strip()
    parts = hs.split(" ", 1)
    if len(parts) == 2 and (parts[0].startswith("R") or parts[0].isdigit()):
        return parts[1].strip()
    return hs


def generate_gtfs_metadata():
    os.makedirs(DATA_DIR, exist_ok=True)

    if os.path.exists(LOCAL_ZIP_PATH):
        print(f"Using local {LOCAL_ZIP_PATH}...")
        z = zipfile.ZipFile(LOCAL_ZIP_PATH, "r")
    else:
        print("Downloading https://gtfs-static.translink.ca/gtfs/google_transit.zip ...")
        resp = requests.get("https://gtfs-static.translink.ca/gtfs/google_transit.zip", timeout=45)
        resp.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(resp.content), "r")

    routes_map = {}
    target_short_names = {"099", "99", "R1", "R2", "R3", "R4", "R5", "R6"}
    target_route_ids = set()

    with z.open("routes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in reader:
            rid = row["route_id"].strip()
            raw_sn = row.get("route_short_name", "").strip()
            ln = row.get("route_long_name", "").strip()
            clean_sn = clean_route_number(raw_sn, ln)

            color = "#10b981"
            if clean_sn == "99":
                color = "#f58220"
            elif clean_sn.startswith("R") and len(clean_sn) == 2:
                color = "#22c55e"
            elif clean_sn == "Canada Line":
                color = "#00a4e4"
            elif clean_sn == "Expo Line":
                color = "#1d2c59"
            elif clean_sn == "Millennium Line":
                color = "#ffcd00"
            elif clean_sn == "SeaBus":
                color = "#8b786d"

            routes_map[rid] = {
                "route_id": rid,
                "route_number": clean_sn,
                "raw_short_name": raw_sn,
                "long_name": ln,
                "color": color,
            }

            if raw_sn in target_short_names or clean_sn in target_short_names or clean_sn == "SeaBus":
                target_route_ids.add(rid)

    print(f"Loaded {len(routes_map)} total routes. Target routes for detailed stop/shape variants: {target_route_ids}")

    # Load stops
    stops_dict = {}
    with z.open("stops.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in reader:
            sid = row["stop_id"].strip()
            stops_dict[sid] = {
                "stop_id": sid,
                "stop_code": row.get("stop_code", "").strip() or sid,
                "name": row.get("stop_name", "").strip(),
                "lat": round(float(row["stop_lat"]), 5),
                "lon": round(float(row["stop_lon"]), 5),
            }

    # Load trips for target routes
    trips_info = {}
    with z.open("trips.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in reader:
            rid = row["route_id"].strip()
            if rid in target_route_ids:
                tid = row["trip_id"].strip()
                trips_info[tid] = {
                    "route_id": rid,
                    "direction_id": str(row.get("direction_id", "0")).strip(),
                    "headsign": row.get("trip_headsign", "").strip(),
                    "shape_id": row.get("shape_id", "").strip(),
                }

    # Load stop_times for target trips
    trip_stop_lists = {}
    with z.open("stop_times.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in reader:
            tid = row["trip_id"].strip()
            if tid in trips_info:
                seq = int(row["stop_sequence"])
                sid = row["stop_id"].strip()
                trip_stop_lists.setdefault(tid, []).append((seq, sid))

    # Pick representative trip for each (route_id, direction_id, headsign)
    variant_best_trip = {}
    for tid, st_list in trip_stop_lists.items():
        st_list.sort(key=lambda x: x[0])
        tinfo = trips_info[tid]
        vkey = f"{tinfo['route_id']}_{tinfo['direction_id']}_{tinfo['headsign']}"
        if vkey not in variant_best_trip or len(st_list) > len(variant_best_trip[vkey][1]):
            variant_best_trip[vkey] = (tinfo, st_list)

    # Needed shape_ids
    needed_shape_ids = {tinfo["shape_id"] for tinfo, _ in variant_best_trip.values() if tinfo.get("shape_id")}
    shape_points = {}
    with z.open("shapes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in reader:
            shid = row["shape_id"].strip()
            if shid in needed_shape_ids:
                shape_points.setdefault(shid, []).append(
                    (int(row["shape_pt_sequence"]), round(float(row["shape_pt_lon"]), 5), round(float(row["shape_pt_lat"]), 5))
                )

    for shid in shape_points:
        shape_points[shid].sort(key=lambda x: x[0])

    variants = {}
    route_default_variants = {}

    for vkey, (tinfo, st_list) in variant_best_trip.items():
        rid = tinfo["route_id"]
        dir_id = tinfo["direction_id"]
        headsign = tinfo["headsign"]
        shid = tinfo["shape_id"]
        rmeta = routes_map.get(rid, {})
        rnum = rmeta.get("route_number", rid)
        rlong = rmeta.get("long_name", "")

        ordered_stops = []
        for idx, (_, sid) in enumerate(st_list):
            sdata = stops_dict.get(sid)
            if sdata:
                ordered_stops.append({
                    "seq": idx + 1,
                    "stop_id": sid,
                    "stop_code": sdata["stop_code"],
                    "name": sdata["name"],
                    "lat": sdata["lat"],
                    "lon": sdata["lon"],
                })

        first_stop_name = ordered_stops[0]["name"] if ordered_stops else ""
        last_stop_name = ordered_stops[-1]["name"] if ordered_stops else ""
        origin_short = clean_stop_terminal_name(first_stop_name)
        dest_short = extract_dest_from_headsign(headsign, last_stop_name)

        pts = shape_points.get(shid, [])
        coords = [[lon, lat] for _, lon, lat in pts]

        is_seabus = rnum == "SeaBus"
        operator = "TransLink (SeaBus 海上巴士)" if is_seabus else "TransLink (CMBC 岸山巴士)"

        variant_obj = {
            "variant_id": vkey,
            "route_id": rid,
            "route_number": rnum,
            "route_name": f"{rnum} {rlong}".strip() if rnum not in rlong else rlong,
            "color": rmeta.get("color", "#10b981"),
            "direction_id": dir_id,
            "headsign": headsign,
            "operator": operator,
            "origin": origin_short,
            "destination": dest_short,
            "origin_stop": first_stop_name,
            "dest_stop": last_stop_name,
            "stops": ordered_stops,
            "shape_coords": coords,
        }
        variants[vkey] = variant_obj

        # Set default variant for (route_id, direction_id) as the one with the most stops
        def_key = f"{rid}_{dir_id}"
        if def_key not in route_default_variants or len(ordered_stops) > len(variants[route_default_variants[def_key]]["stops"]):
            route_default_variants[def_key] = vkey

    # Map trip_id -> variant_id
    trip_to_variant = {}
    for tid, tinfo in trips_info.items():
        vkey = f"{tinfo['route_id']}_{tinfo['direction_id']}_{tinfo['headsign']}"
        if vkey in variants:
            trip_to_variant[tid] = vkey

    output_data = {
        "routes": routes_map,
        "variants": variants,
        "route_default_variants": route_default_variants,
        "trip_to_variant": trip_to_variant,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"[OK] Saved {OUTPUT_PATH} ({size_kb:.1f} KB) with {len(routes_map)} routes, {len(variants)} variants, {len(trip_to_variant)} trips.")


if __name__ == "__main__":
    generate_gtfs_metadata()
