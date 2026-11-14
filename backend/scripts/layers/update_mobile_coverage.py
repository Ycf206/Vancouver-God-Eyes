"""
Metro Vancouver Mobile Network Coverage Layer Updater.

Fetches official live carrier coverage endpoints for the 5 major Canadian
mobile carriers operating in Metro Vancouver:
  - Telus        (#9333EA 紫): Carto TileJSON + MVT vector polygons
  - Rogers       (#B91C1C 深紅): SpatialBuzz live config + XYZ coverage PNG tiles
  - Virgin Plus  (#FB7185 淺紅): Korem getSiteConfig + TMS coverage PNG tiles
  - Bell         (#2563EB 藍): Korem getSiteConfig + TMS coverage PNG tiles
  - Freedom Mobile (#F97316 橙): CloudFront freelte1 coverage PNG tiles + 5G dataset

Raster coverage tiles over the Metro Vancouver bounding box at zoom 11 are
sampled onto an aligned Web Mercator cell grid and merged via lossless 2D
maximal rectangle coalescing into clean, valid GeoJSON Polygons, while Telus
vector tiles are decoded directly from Mapbox Vector Tile (MVT) protobuf.

Outputs:
  - backend/data/vancouver_mobile_coverage.geojson
  - frontend/public/vancouver_mobile_coverage.geojson

Scheduled every 6 months via GitHub Actions (.github/workflows/update-mobile-coverage.yml).
Not indexed into the search bar (map-only overlay + carrier filter panel).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import io
import json
import math
import os
import re
import sys
from typing import Any
import zlib

from PIL import Image
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import save_layer_geojson, update_admin_source_metadata

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
}

# Metro Vancouver regional bounding box (WGS84)
MV_BBOX = (-123.38, 49.00, -122.40, 49.45)  # (lon_min, lat_min, lon_max, lat_max)
ZOOM_RASTER = 11
CELLS_PER_TILE = 24  # ~300 m grid cells at zoom 11 (divides 256 cleanly enough via center sampling)

ROGERS_CUSTOMER = "593E2268"
ROGERS_SUB_CUSTOMER = "272F320D"
ROGERS_CUSTOMER_ENC = "eFh0LHEcWG0ycFJ-J3Rbc2oxEFt7JnVSdSo"
ROGERS_API_DATE = "2010-11-22"

CARRIER_META: dict[str, dict[str, str]] = {
    "telus": {
        "name": "Telus",
        "color": "#9333EA",
        "color_name": "紫",
        "source_url": "https://www.telus.com/en/mobility/network/coverage-map",
    },
    "rogers": {
        "name": "Rogers",
        "color": "#B91C1C",
        "color_name": "深紅",
        "source_url": "https://www.rogers.com/mobility/network-coverage-map",
    },
    "virgin": {
        "name": "Virgin Plus",
        "color": "#FB7185",
        "color_name": "淺紅",
        "source_url": "https://www.virginplus.ca/en/support/coverage-maps.html",
    },
    "bell": {
        "name": "Bell",
        "color": "#2563EB",
        "color_name": "藍",
        "source_url": "https://www.bell.ca/Mobility/Our_network_coverage",
    },
    "freedom": {
        "name": "Freedom Mobile",
        "color": "#F97316",
        "color_name": "橙",
        "source_url": "https://www.freedommobile.ca/en-CA/network-coverage",
    },
}


# ---------------------------------------------------------------------------
# Web Mercator & Rectangle Coalescing Helpers
# ---------------------------------------------------------------------------

def _lonlat_to_tile_float(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    fx = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(max(min(lat, 85.0511), -85.0511))
    fy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return fx, fy


def _tile_float_to_lonlat(fx: float, fy: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    lon = fx / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * fy / n)))
    lat = math.degrees(lat_rad)
    return round(lon, 5), round(lat, 5)


def _tile_range_for_bbox(bbox: tuple[float, float, float, float], z: int) -> tuple[int, int, int, int]:
    lon_min, lat_min, lon_max, lat_max = bbox
    fx0, fy1 = _lonlat_to_tile_float(lon_min, lat_min, z)
    fx1, fy0 = _lonlat_to_tile_float(lon_max, lat_max, z)
    return int(math.floor(fx0)), int(math.floor(fx1)), int(math.floor(fy0)), int(math.floor(fy1))


def _coalesce_grid_to_polygons(
    grid: list[list[str | None]],
    tx_min: int,
    ty_min: int,
    z: int,
    cells_per_tile: int,
    bbox: tuple[float, float, float, float],
) -> dict[str, list[list[list[float]]]]:
    """
    Merge boolean/categorical grid cells into maximal non-overlapping rectangles
    (horizontal run-length encoding followed by vertical slab merging).
    Returns {category_label: [exterior_ring_coords, ...]}.
    """
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    lon_min, lat_min, lon_max, lat_max = bbox

    categories: set[str] = set()
    for r in grid:
        for c in r:
            if c:
                categories.add(c)

    out: dict[str, list[list[list[float]]]] = {}
    for cat in sorted(categories):
        # Step 1: horizontal runs per row
        active_rects: dict[tuple[int, int], list[int]] = {}  # (c0, c1) -> [r0, r1]
        completed: list[tuple[int, int, int, int]] = []

        for r in range(rows):
            row_runs: set[tuple[int, int]] = set()
            c = 0
            while c < cols:
                if grid[r][c] == cat:
                    c0 = c
                    while c < cols and grid[r][c] == cat:
                        c += 1
                    row_runs.add((c0, c))
                else:
                    c += 1

            # Flush rectangles whose horizontal span ended
            ended = [span for span in active_rects if span not in row_runs]
            for span in ended:
                r0, r1 = active_rects.pop(span)
                completed.append((span[0], r0, span[1], r1))

            # Extend or start
            for span in row_runs:
                if span in active_rects:
                    active_rects[span][1] = r + 1
                else:
                    active_rects[span] = [r, r + 1]

        for span, (r0, r1) in active_rects.items():
            completed.append((span[0], r0, span[1], r1))

        rings: list[list[list[list[float]]]] = []
        for c0, r0, c1, r1 in completed:
            fx0 = tx_min + c0 / cells_per_tile
            fx1 = tx_min + c1 / cells_per_tile
            fy0 = ty_min + r0 / cells_per_tile
            fy1 = ty_min + r1 / cells_per_tile

            w_lon, n_lat = _tile_float_to_lonlat(fx0, fy0, z)
            e_lon, s_lat = _tile_float_to_lonlat(fx1, fy1, z)

            # Clip to Metro Vancouver bounding box
            w_lon = max(w_lon, lon_min)
            e_lon = min(e_lon, lon_max)
            s_lat = max(s_lat, lat_min)
            n_lat = min(n_lat, lat_max)
            if e_lon <= w_lon or n_lat <= s_lat:
                continue

            rings.append([[
                [w_lon, s_lat],
                [e_lon, s_lat],
                [e_lon, n_lat],
                [w_lon, n_lat],
                [w_lon, s_lat],
            ]])
        out[cat] = rings
    return out


def _build_carrier_features(
    carrier_id: str,
    polys_by_tier: dict[str, list[list[list[list[float]]]]],
) -> list[dict[str, Any]]:
    meta = CARRIER_META[carrier_id]
    features: list[dict[str, Any]] = []
    idx = 0
    for tier, polys in polys_by_tier.items():
        if not polys:
            continue
        # Bundle polygons (each = [exterior_ring, ...optional_holes]) per network tier
        chunk_size = 100
        for start in range(0, len(polys), chunk_size):
            chunk = polys[start : start + chunk_size]
            fid = f"mobile_coverage_{carrier_id}_{idx}"
            idx += 1
            features.append({
                "type": "Feature",
                "id": fid,
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": chunk,
                },
                "properties": {
                    "id": fid,
                    "facility_type": "mobile_coverage",
                    "carrier_id": carrier_id,
                    "carrier_name": meta["name"],
                    "name": f"{meta['name']} ({tier})",
                    "network_tier": tier,
                    "color": meta["color"],
                    "source_url": meta["source_url"],
                    "polygon_count": len(chunk),
                },
            })
    return features


# ---------------------------------------------------------------------------
# Pure-Python MVT Decoder (for Telus Carto Vector Tiles)
# ---------------------------------------------------------------------------

def _decode_varint(buf: bytes, pos: int) -> tuple[int, int]:
    res, shift = 0, 0
    while pos < len(buf):
        b = buf[pos]
        pos += 1
        res |= (b & 0x7F) << shift
        if not (b & 0x80):
            return res, pos
        shift += 7
    return res, pos


def _parse_pb_fields(buf: bytes) -> list[tuple[int, int, Any]]:
    pos, fields = 0, []
    while pos < len(buf):
        tag, pos = _decode_varint(buf, pos)
        fn, wt = tag >> 3, tag & 7
        if wt == 0:
            v, pos = _decode_varint(buf, pos)
        elif wt == 1:
            v = buf[pos : pos + 8]
            pos += 8
        elif wt == 2:
            ln, pos = _decode_varint(buf, pos)
            v = buf[pos : pos + ln]
            pos += ln
        elif wt == 5:
            v = buf[pos : pos + 4]
            pos += 4
        else:
            break
        fields.append((fn, wt, v))
    return fields


def _zigzag(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _decode_mvt_polygons(raw: bytes, tx: int, ty: int, z: int) -> list[list[list[list[float]]]]:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    polygons: list[list[list[list[float]]]] = []
    for fn, wt, val in _parse_pb_fields(raw):
        if fn != 3 or wt != 2:
            continue
        layer_fields = _parse_pb_fields(val)
        extent = 4096
        raw_feats: list[bytes] = []
        for lfn, lwt, lval in layer_fields:
            if lfn == 5 and lwt == 0:
                extent = int(lval) or 4096
            elif lfn == 2 and lwt == 2:
                raw_feats.append(lval)
        for rf in raw_feats:
            geom_type = 0
            geom_bytes = b""
            for ffn, fwt, fval in _parse_pb_fields(rf):
                if ffn == 3 and fwt == 0:
                    geom_type = int(fval)
                elif ffn == 4 and fwt == 2:
                    geom_bytes = fval
            if geom_type != 3 or not geom_bytes:
                continue
            # Decode packed uint32 command stream
            cmds: list[int] = []
            gp = 0
            while gp < len(geom_bytes):
                cval, gp = _decode_varint(geom_bytes, gp)
                cmds.append(cval)

            i = 0
            cx, cy = 0, 0
            current_ring: list[list[float]] = []
            current_poly: list[list[list[float]]] | None = None
            while i < len(cmds):
                cmd_int = cmds[i]
                i += 1
                cmd_id = cmd_int & 0x7
                count = cmd_int >> 3
                if cmd_id == 1:  # MoveTo
                    for _ in range(count):
                        if i + 1 >= len(cmds):
                            break
                        dx = _zigzag(cmds[i])
                        dy = _zigzag(cmds[i + 1])
                        i += 2
                        cx += dx
                        cy += dy
                        lon, lat = _tile_float_to_lonlat(tx + cx / extent, ty + cy / extent, z)
                        current_ring = [[lon, lat]]
                elif cmd_id == 2:  # LineTo
                    for _ in range(count):
                        if i + 1 >= len(cmds):
                            break
                        dx = _zigzag(cmds[i])
                        dy = _zigzag(cmds[i + 1])
                        i += 2
                        cx += dx
                        cy += dy
                        lon, lat = _tile_float_to_lonlat(tx + cx / extent, ty + cy / extent, z)
                        if not current_ring or current_ring[-1] != [lon, lat]:
                            current_ring.append([lon, lat])
                elif cmd_id == 7:  # ClosePath
                    if len(current_ring) >= 3:
                        if current_ring[-1] != current_ring[0]:
                            current_ring.append(current_ring[0])
                        # In MVT (tile Y-down): CW exterior ring has positive shoelace in lon/lat (Y-up)
                        area = 0.0
                        for k in range(len(current_ring) - 1):
                            x0, y0 = current_ring[k]
                            x1, y1 = current_ring[k + 1]
                            area += (x1 - x0) * (y1 + y0)
                        clipped = _clip_ring_bbox(current_ring, MV_BBOX)
                        if area > 0:
                            if current_poly:
                                polygons.append(current_poly)
                            if clipped:
                                clipped.reverse()  # RFC 7946 exterior rings are CCW
                                current_poly = [clipped]
                            else:
                                current_poly = None
                        elif area < 0 and current_poly is not None and clipped:
                            clipped.reverse()  # Interior hole -> CW in lon/lat
                            current_poly.append(clipped)
                    current_ring = []
            if current_poly:
                polygons.append(current_poly)
    return polygons


def _clip_ring_bbox(ring: list[list[float]], bbox: tuple[float, float, float, float]) -> list[list[float]]:
    """Fast axis clamping to Metro Vancouver bbox and vertex thinning (~300m tolerance)."""
    lon_min, lat_min, lon_max, lat_max = bbox
    clipped: list[list[float]] = []
    prev_kept: list[float] | None = None
    for pt in ring:
        x = round(max(min(pt[0], lon_max), lon_min), 5)
        y = round(max(min(pt[1], lat_max), lat_min), 5)
        if prev_kept is None or abs(x - prev_kept[0]) + abs(y - prev_kept[1]) >= 0.0012:
            clipped.append([x, y])
            prev_kept = [x, y]
    if len(clipped) >= 3:
        if clipped[-1] != clipped[0]:
            clipped.append(clipped[0])
        xs = {p[0] for p in clipped}
        ys = {p[1] for p in clipped}
        ring_area = sum(
            clipped[k][0] * clipped[k + 1][1] - clipped[k + 1][0] * clipped[k][1]
            for k in range(len(clipped) - 1)
        )
        if len(clipped) >= 4 and len(xs) >= 2 and len(ys) >= 2 and abs(ring_area) > 1e-11:
            return clipped
    return []


# ---------------------------------------------------------------------------
# Carrier Fetchers
# ---------------------------------------------------------------------------

def _fetch_tile_images(
    url_builder,
    tx_range: range,
    ty_range: range,
    referer: str | None = None,
) -> dict[tuple[int, int], Image.Image]:
    tasks: list[tuple[int, int, str]] = [
        (tx, ty, url_builder(tx, ty))
        for ty in ty_range
        for tx in tx_range
    ]
    results: dict[tuple[int, int], Image.Image] = {}
    req_headers = dict(HEADERS)
    if referer:
        req_headers["Referer"] = referer

    def _get(item: tuple[int, int, str]) -> tuple[int, int, Image.Image | None]:
        tx, ty, url = item
        try:
            r = requests.get(url, headers=req_headers, timeout=15)
            if r.status_code == 200 and r.content[:4] == b"\x89PNG":
                return tx, ty, Image.open(io.BytesIO(r.content)).convert("RGBA")
        except Exception:
            pass
        return tx, ty, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for f in as_completed([pool.submit(_get, t) for t in tasks]):
            tx, ty, im = f.result()
            if im is not None:
                results[(tx, ty)] = im
    return results


def _sample_raster_grid(
    tile_imgs: dict[tuple[int, int], Image.Image],
    tx_range: range,
    ty_range: range,
    classifier,
    grid: list[list[str | None]] | None = None,
) -> list[list[str | None]]:
    rows = len(ty_range) * CELLS_PER_TILE
    cols = len(tx_range) * CELLS_PER_TILE
    if grid is None:
        grid = [[None] * cols for _ in range(rows)]
    tx0, ty0 = tx_range.start, ty_range.start
    step = 256.0 / CELLS_PER_TILE

    for (tx, ty), im in tile_imgs.items():
        px_access = im.load()
        base_c = (tx - tx0) * CELLS_PER_TILE
        base_r = (ty - ty0) * CELLS_PER_TILE
        for jr in range(CELLS_PER_TILE):
            py = min(255, int((jr + 0.5) * step))
            gr = base_r + jr
            for ic in range(CELLS_PER_TILE):
                gc = base_c + ic
                if grid[gr][gc] is not None:
                    continue
                px = min(255, int((ic + 0.5) * step))
                r, g, b, a = px_access[px, py]
                label = classifier(r, g, b, a)
                if label:
                    grid[gr][gc] = label
    return grid


def fetch_telus_features() -> list[dict[str, Any]]:
    print("📡 [Telus] 抓取 Carto MVT 涵蓋範圍...")
    cfg = requests.get(
        "https://www.telus.com/network/tools/coverage-map/api/brand-config/Telus",
        headers=HEADERS,
        timeout=15,
    ).json()
    carto_ts = cfg.get("cartoTilesets") or {}
    # Order highest tier -> base tier at zoom 9/10 to minimize tile-boundary splits
    tier_defs = [
        ("5g-3500", "5G+ (3500MHz)"),
        ("5g", "5G"),
        ("lte-advanced", "4G LTE-Advanced"),
        ("lte", "4G LTE"),
    ]
    z_mvt = 10
    tx_min, tx_max, ty_min, ty_max = _tile_range_for_bbox(MV_BBOX, z_mvt)
    rings_by_tier: dict[str, list[list[list[float]]]] = {}

    for key, label in tier_defs:
        ts_name = carto_ts.get(key)
        if not ts_name:
            continue
        tj = requests.get(
            "https://www.telus.com/network/tools/coverage-map/api/carto/v3/maps/public-coverage-map/tileset",
            params={"name": ts_name, "format": "tilejson"},
            headers=HEADERS,
            timeout=15,
        ).json()
        tpl_list = tj.get("tiles") or []
        if not tpl_list:
            continue
        tpl = tpl_list[0]
        rings: list[list[list[float]]] = []
        for ty in range(ty_min, ty_max + 1):
            for tx in range(tx_min, tx_max + 1):
                tu = tpl.replace("{z}", str(z_mvt)).replace("{x}", str(tx)).replace("{y}", str(ty))
                tr = requests.get(tu, headers={**HEADERS, "Referer": "https://www.telus.com/"}, timeout=15)
                if tr.status_code == 200 and len(tr.content) > 20:
                    rings.extend(_decode_mvt_polygons(tr.content, tx, ty, z_mvt))
        if rings:
            rings_by_tier[label] = rings
            print(f"  - Telus [{label}]: {len(rings)} 個多邊形區塊")

    return _build_carrier_features("telus", rings_by_tier)


def _get_rogers_overlay_templates() -> dict[str, str]:
    s = requests.Session()
    s.headers.update({
        **HEADERS,
        "Referer": "https://rog-ca.spatialbuzz.net/cust/593E2268/rog-ca-integration-hdcoverage-consumer-iframe-src.html",
    })
    tok_url = (
        f"https://rog-ca.spatialbuzz.net/api/maps/{ROGERS_API_DATE}"
        f"/tokens/customer/{ROGERS_CUSTOMER_ENC}?id=1&NoCache=1"
    )
    tokens = s.get(tok_url, timeout=15).json().get("tokens") or []
    suffix = f"/maps/{ROGERS_API_DATE}/config/customer/{ROGERS_CUSTOMER_ENC}/auth/{tokens[0]}"
    crc_in = f":::{suffix}:::{ROGERS_CUSTOMER}:::{ROGERS_SUB_CUSTOMER}:::"
    crc = f"{zlib.crc32(crc_in.encode('latin1')) & 0xFFFFFFFF:08X}"
    cfg_url = f"https://rog-ca.spatialbuzz.net/api{suffix}:::{crc}?id=1&NoCache=2"
    cfg = s.get(cfg_url, timeout=20).json()
    out: dict[str, str] = {}
    for lyr in cfg.get("overlay_layers") or []:
        lid = lyr.get("layer_id")
        tpl = lyr.get("imageUriGoogle")
        if lid and tpl:
            out[lid] = tpl
    return out


def fetch_rogers_features() -> list[dict[str, Any]]:
    print("📡 [Rogers] 抓取 SpatialBuzz 涵蓋圖磚...")
    tx0, tx1, ty0, ty1 = _tile_range_for_bbox(MV_BBOX, ZOOM_RASTER)
    tx_range, ty_range = range(tx0, tx1 + 1), range(ty0, ty1 + 1)

    templates = _get_rogers_overlay_templates()
    tpl_5g = templates.get(
        "4g5g",
        "https://593e2268-tiles.spatialbuzz.net/tiles/rog_ca-v208/styles/rog_ca_v208_4g5g/{z}/{x}/{y}.png",
    )
    tpl_4g = templates.get(
        "4g",
        "https://593e2268-tiles.spatialbuzz.net/tiles/rog_ca-v208/styles/rog_ca_v208_4g/{z}/{x}/{y}.png",
    )

    imgs_5g = _fetch_tile_images(
        lambda x, y: tpl_5g.replace("{z}", str(ZOOM_RASTER)).replace("{x}", str(x)).replace("{y}", str(y)),
        tx_range,
        ty_range,
    )
    imgs_4g = _fetch_tile_images(
        lambda x, y: tpl_4g.replace("{z}", str(ZOOM_RASTER)).replace("{x}", str(x)).replace("{y}", str(y)),
        tx_range,
        ty_range,
    )

    def _classify_5g(r: int, g: int, b: int, a: int) -> str | None:
        if a <= 25:
            return None
        if r < 160 and g < 60:
            return "5G+"
        if g < 95:
            return "5G"
        return None

    def _classify_4g(r: int, g: int, b: int, a: int) -> str | None:
        return "4G LTE" if a > 25 else None

    grid = _sample_raster_grid(imgs_5g, tx_range, ty_range, _classify_5g)
    grid = _sample_raster_grid(imgs_4g, tx_range, ty_range, _classify_4g, grid=grid)

    rings_by_tier = _coalesce_grid_to_polygons(grid, tx0, ty0, ZOOM_RASTER, CELLS_PER_TILE, MV_BBOX)
    for tier, rlist in rings_by_tier.items():
        print(f"  - Rogers [{tier}]: {len(rlist)} 個多邊形區塊")
    return _build_carrier_features("rogers", rings_by_tier)


def _fetch_korem_carrier(
    carrier_id: str,
    site_id: str,
    workspace: str,
    referer: str,
    layers_5g: str,
    layers_lte: str,
) -> list[dict[str, Any]]:
    print(f"📡 [{CARRIER_META[carrier_id]['name']}] 抓取 Korem 涵蓋圖磚...")
    txt = requests.get(
        "https://bellmaps.korem.com/Coverage/getSiteConfig",
        params={"siteId": site_id, "language": "en", "callback": "cb"},
        headers={**HEADERS, "Referer": referer},
        timeout=15,
    ).text
    m = re.search(r'"timestamp"\s*:\s*"([^"]+)"', txt)
    if not m:
        raise RuntimeError(f"Korem timestamp missing for {site_id}")
    ts = m.group(1)

    tx0, tx1, ty0, ty1 = _tile_range_for_bbox(MV_BBOX, ZOOM_RASTER)
    tx_range, ty_range = range(tx0, tx1 + 1), range(ty0, ty1 + 1)

    # Korem uses 1-based z/x/y offset relative to Slippy XYZ
    def _build_url(layers_param: str):
        return lambda x, y: (
            f"https://bellmaps.korem.com/TMS/getTile?workspace={workspace}"
            f"&layers={layers_param}&z={ZOOM_RASTER + 1}&x={x + 1}&y={y + 1}&timestamp={ts}"
        )

    imgs_5g = _fetch_tile_images(_build_url(layers_5g), tx_range, ty_range, referer=referer)
    imgs_lte = _fetch_tile_images(_build_url(layers_lte), tx_range, ty_range, referer=referer)

    def _classify_5g(r: int, g: int, b: int, a: int) -> str | None:
        if a <= 25:
            return None
        if carrier_id == "bell" and g > 140 and b > 180:
            return "5G+"
        return "5G"

    def _classify_lte(r: int, g: int, b: int, a: int) -> str | None:
        return "4G LTE" if a > 25 else None

    grid = _sample_raster_grid(imgs_5g, tx_range, ty_range, _classify_5g)
    grid = _sample_raster_grid(imgs_lte, tx_range, ty_range, _classify_lte, grid=grid)

    rings_by_tier = _coalesce_grid_to_polygons(grid, tx0, ty0, ZOOM_RASTER, CELLS_PER_TILE, MV_BBOX)
    for tier, rlist in rings_by_tier.items():
        print(f"  - {CARRIER_META[carrier_id]['name']} [{tier}]: {len(rlist)} 個多邊形區塊")
    return _build_carrier_features(carrier_id, rings_by_tier)


def fetch_bell_features() -> list[dict[str, Any]]:
    return _fetch_korem_carrier(
        carrier_id="bell",
        site_id="Bell-brf.ca",
        workspace="Bell.ca",
        referer="https://www.bell.ca/",
        layers_5g="5G_PLUS_Advanced,5G_PLUS,5G",
        layers_lte="LTE_Advanced,LTE,HSPA",
    )


def fetch_virgin_features() -> list[dict[str, Any]]:
    return _fetch_korem_carrier(
        carrier_id="virgin",
        site_id="Virgin",
        workspace="Virgin",
        referer="https://www.virginplus.ca/",
        layers_5g="5G",
        layers_lte="LTE_Advanced,LTE,HSPA",
    )


def fetch_freedom_features() -> list[dict[str, Any]]:
    print("📡 [Freedom Mobile] 抓取 CloudFront 涵蓋圖磚...")
    tx0, tx1, ty0, ty1 = _tile_range_for_bbox(MV_BBOX, ZOOM_RASTER)
    tx_range, ty_range = range(tx0, tx1 + 1), range(ty0, ty1 + 1)

    imgs_lte = _fetch_tile_images(
        lambda x, y: f"https://dnyepvvjamjdg.cloudfront.net/freelte1/{ZOOM_RASTER}/{x}/{y}.png",
        tx_range,
        ty_range,
        referer="https://www.freedommobile.ca/",
    )

    def _classify_freedom(r: int, g: int, b: int, a: int) -> str | None:
        if a <= 25:
            return None
        # Native strong Freedom 5G/LTE is deep orange (~220, 82, 17)
        if r >= 180 and g < 138 and b < 85:
            return "5G / 4G LTE"
        # Variable Freedom LTE is medium orange (~234, 154, 97); exclude pale Nationwide tan (g >= 178)
        if r >= 180 and g < 178 and b < 135:
            return "4G LTE (訊號較弱區)"
        return None

    grid = _sample_raster_grid(imgs_lte, tx_range, ty_range, _classify_freedom)
    rings_by_tier = _coalesce_grid_to_polygons(grid, tx0, ty0, ZOOM_RASTER, CELLS_PER_TILE, MV_BBOX)
    for tier, rlist in rings_by_tier.items():
        print(f"  - Freedom Mobile [{tier}]: {len(rlist)} 個多邊形區塊")
    return _build_carrier_features("freedom", rings_by_tier)


def update_mobile_coverage() -> int:
    all_features: list[dict[str, Any]] = []
    fetchers = [
        ("Telus", fetch_telus_features),
        ("Rogers", fetch_rogers_features),
        ("Virgin Plus", fetch_virgin_features),
        ("Bell", fetch_bell_features),
        ("Freedom Mobile", fetch_freedom_features),
    ]
    for label, fn in fetchers:
        try:
            feats = fn()
            all_features.extend(feats)
        except Exception as e:
            print(f"  ⚠️ [{label}] 抓取失敗略過 ({e})")

    if not all_features:
        raise RuntimeError("所有電信商涵蓋圖層皆未取得任何資料，中止寫入！")

    save_layer_geojson("vancouver_mobile_coverage.geojson", all_features, compact=True)
    update_admin_source_metadata("mobile_coverage", record_count=len(all_features))
    return len(all_features)


if __name__ == "__main__":
    cnt = update_mobile_coverage()
    print(f"🎉 大溫哥華流動網絡涵蓋圖層更新完成，共產出 {cnt} 組涵蓋多邊形圖徵！")
