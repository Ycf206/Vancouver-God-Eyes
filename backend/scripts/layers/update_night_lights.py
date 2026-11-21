import io
import math
import os
import re
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from PIL import Image

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import (
    BACKEND_DATA_DIR,
    FRONTEND_DATA_DIR,
    atomic_write_json,
    load_existing_geojson,
)

OUTPUT_FILENAME = "vancouver_night_lights.geojson"

# NASA Black Marble (VIIRS NOAA-20 Gap-Filled BRDF-Corrected Day/Night Band Radiance) via NASA GIBS
GIBS_LAYER_ID = "VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
GIBS_FALLBACK_LAYER_ID = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
GIBS_TMS = "GoogleMapsCompatible_Level8"
GIBS_ZOOM = 8
GIBS_CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
GIBS_TILE_URL_TEMPLATE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "{layer}/default/{date}/" + GIBS_TMS + "/{z}/{y}/{x}.png"
)

# Metro Vancouver & Fraser Valley crop window (falls cleanly within z=8, y=87, x in [40, 41])
BBOX_LAT_MIN = 48.98
BBOX_LAT_MAX = 49.48
BBOX_LON_MIN = -123.42
BBOX_LON_MAX = -122.25

# Sample ~24 nights spaced evenly over the past 365 days (~every 15 days) for a stable 1-year median
NIGHT_SAMPLE_COUNT = 24
SAMPLE_STEP_DAYS = 15

# Radiance brightness (0-255 median pixel value) -> 7 discrete color tiers (inspired by Bortle / VIIRS palettes)
# Pixels with median <= 24 (dark ocean & unlit wilderness) are omitted so the basemap remains crisp and readable.
NIGHT_LIGHT_TIERS: list[dict[str, Any]] = [
    {"level": 1, "min_val": 25, "max_val": 54, "color": "#1e3a8a", "label_zh": "極弱", "group": "低亮度"},
    {"level": 2, "min_val": 55, "max_val": 89, "color": "#4338ca", "label_zh": "微弱", "group": "低亮度"},
    {"level": 3, "min_val": 90, "max_val": 124, "color": "#7e22ce", "label_zh": "輕中", "group": "中亮度"},
    {"level": 4, "min_val": 125, "max_val": 159, "color": "#be185d", "label_zh": "中等", "group": "中亮度"},
    {"level": 5, "min_val": 160, "max_val": 194, "color": "#ea580c", "label_zh": "較強", "group": "高亮度"},
    {"level": 6, "min_val": 195, "max_val": 229, "color": "#f59e0b", "label_zh": "強光", "group": "高亮度"},
    {"level": 7, "min_val": 230, "max_val": 255, "color": "#fef08a", "label_zh": "極強", "group": "都會核心"},
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "image/png,application/xml,*/*",
}


def _lon_to_global_px(lon: float, z: int) -> float:
    n = 2**z
    return (lon + 180.0) / 360.0 * n * 256.0


def _lat_to_global_px(lat: float, z: int) -> float:
    n = 2**z
    rad = math.radians(lat)
    return (1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * n * 256.0


def _global_px_to_lon(gx: float, z: int) -> float:
    n = 2**z
    return gx / (n * 256.0) * 360.0 - 180.0


def _global_px_to_lat(gy: float, z: int) -> float:
    n = 2**z
    merc = math.pi * (1.0 - 2.0 * gy / (n * 256.0))
    return math.degrees(math.atan(math.sinh(merc)))


def _discover_latest_gibs_date(layer_id: str) -> date:
    fallback = datetime.now(timezone.utc).date() - timedelta(days=3)
    try:
        resp = requests.get(GIBS_CAPABILITIES_URL, headers=HEADERS, timeout=25)
        if resp.status_code != 200:
            return fallback
        marker = f"<ows:Identifier>{layer_id}</ows:Identifier>"
        idx = resp.text.find(marker)
        if idx == -1:
            return fallback
        chunk = resp.text[idx : idx + 2500]
        m = re.search(r"<Default>(\d{4}-\d{2}-\d{2})</Default>", chunk)
        if m:
            return date.fromisoformat(m.group(1))
    except Exception:
        pass
    return fallback


def _fetch_tile_grayscale(layer_id: str, dt_str: str, tx: int, ty: int) -> Image.Image | None:
    url = GIBS_TILE_URL_TEMPLATE.format(layer=layer_id, date=dt_str, z=GIBS_ZOOM, y=ty, x=tx)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code != 200 or not resp.content:
            return None
        im = Image.open(io.BytesIO(resp.content)).convert("RGBA").convert("L")
        if im.size != (256, 256):
            return None
        # Reject completely empty / corrupted black tiles
        extrema = im.getextrema()
        if not extrema or extrema[1] <= 0:
            return None
        return im
    except Exception:
        return None


def _classify_brightness(val: float) -> dict[str, Any] | None:
    for tier in NIGHT_LIGHT_TIERS:
        if tier["min_val"] <= val <= tier["max_val"]:
            return tier
    return None


def update_night_lights() -> list[dict[str, Any]]:
    print("🌌 正在從 NASA GIBS 擷取 NASA Black Marble (VIIRS) 近一年夜間燈光中位數圖資...")

    latest_dt = _discover_latest_gibs_date(GIBS_LAYER_ID)
    sample_dates = [
        (latest_dt - timedelta(days=i * SAMPLE_STEP_DAYS)).isoformat()
        for i in range(NIGHT_SAMPLE_COUNT)
    ]

    # Compute exact global pixel bounds for the Metro Vancouver / Fraser Valley crop window
    gx_min = int(math.floor(_lon_to_global_px(BBOX_LON_MIN, GIBS_ZOOM)))
    gx_max = int(math.ceil(_lon_to_global_px(BBOX_LON_MAX, GIBS_ZOOM)))
    gy_min = int(math.floor(_lat_to_global_px(BBOX_LAT_MAX, GIBS_ZOOM)))
    gy_max = int(math.ceil(_lat_to_global_px(BBOX_LAT_MIN, GIBS_ZOOM)))

    tx_min, tx_max = gx_min // 256, (gx_max - 1) // 256
    ty_min, ty_max = gy_min // 256, (gy_max - 1) // 256
    tile_coords = [(tx, ty) for ty in range(ty_min, ty_max + 1) for tx in range(tx_min, tx_max + 1)]

    width = gx_max - gx_min
    height = gy_max - gy_min
    print(
        f"  🛰️ 圖層: {GIBS_LAYER_ID} | 日期區間: {sample_dates[-1]} ~ {sample_dates[0]} "
        f"| 取樣 {len(sample_dates)} 晚 × {len(tile_coords)} 瓦片 ({width}×{height} 網格)"
    )

    # Fetch all (date, tx, ty) tiles concurrently
    fetched_by_date: dict[str, dict[tuple[int, int], Image.Image]] = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {
            pool.submit(_fetch_tile_grayscale, GIBS_LAYER_ID, dt_str, tx, ty): (dt_str, tx, ty)
            for dt_str in sample_dates
            for (tx, ty) in tile_coords
        }
        for fut in as_completed(futs):
            dt_str, tx, ty = futs[fut]
            im = fut.result()
            if im is not None:
                fetched_by_date.setdefault(dt_str, {})[(tx, ty)] = im

    valid_nights: list[tuple[str, bytes]] = []
    for dt_str in sorted(fetched_by_date.keys()):
        tmap = fetched_by_date[dt_str]
        if len(tmap) != len(tile_coords):
            continue
        mosaic = Image.new("L", (width, height), 0)
        for (tx, ty), im in tmap.items():
            ox = tx * 256 - gx_min
            oy = ty * 256 - gy_min
            mosaic.paste(im, (ox, oy))
        valid_nights.append((dt_str, mosaic.tobytes()))

    if len(valid_nights) < 3:
        print(f"⚠️ NASA GIBS 有效取樣夜數不足 ({len(valid_nights)} 晚)，嘗試保留現有快取...")
        existing = load_existing_geojson(OUTPUT_FILENAME)
        if isinstance(existing, dict) and existing.get("features"):
            return existing["features"]
        return []

    print(f"  📊 成功取得 {len(valid_nights)} 晚完整影像，正在計算像素級一年中位數與合併色塊...")

    # Precompute lat/lon edge coordinates for each grid row & column
    lon_edges = [round(_global_px_to_lon(gx_min + c, GIBS_ZOOM), 5) for c in range(width + 1)]
    lat_edges = [round(_global_px_to_lat(gy_min + r, GIBS_ZOOM), 5) for r in range(height + 1)]

    # Compute pixel-wise median across all valid nights, then run-length merge adjacent horizontal cells per tier
    night_buffers = [buf for _, buf in valid_nights]
    features: list[dict[str, Any]] = []
    tier_counts: dict[int, int] = {t["level"]: 0 for t in NIGHT_LIGHT_TIERS}

    for r in range(height):
        row_off = r * width
        lat_n = lat_edges[r]
        lat_s = lat_edges[r + 1]

        run_tier: dict[str, Any] | None = None
        run_start_c = 0

        def _flush_run(end_c: int) -> None:
            if run_tier is None:
                return
            lon_w = lon_edges[run_start_c]
            lon_e = lon_edges[end_c]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [lon_w, lat_n],
                                [lon_e, lat_n],
                                [lon_e, lat_s],
                                [lon_w, lat_s],
                                [lon_w, lat_n],
                            ]
                        ],
                    },
                    "properties": {
                        "level": run_tier["level"],
                        "color": run_tier["color"],
                    },
                }
            )

        for c in range(width):
            idx = row_off + c
            vals = [buf[idx] for buf in night_buffers]
            med = statistics.median(vals)
            tier = _classify_brightness(med)
            if tier is not None:
                tier_counts[tier["level"]] += 1

            if tier is not run_tier:
                _flush_run(c)
                run_tier = tier
                run_start_c = c
        _flush_run(width)

    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    payload = {
        "type": "FeatureCollection",
        "generator": "VancouverGodsEye",
        "source": "NASA Black Marble (VIIRS) via NASA GIBS",
        "gibs_layer": GIBS_LAYER_ID,
        "aggregation": "1-year median",
        "sample_start": valid_nights[0][0],
        "sample_end": valid_nights[-1][0],
        "nights_sampled": len(valid_nights),
        "total_count": len(features),
        "updated_at": now_iso,
        "legend_tiers": NIGHT_LIGHT_TIERS,
        "features": features,
    }

    for target_dir in (BACKEND_DATA_DIR, FRONTEND_DATA_DIR):
        os.makedirs(target_dir, exist_ok=True)
        out_path = os.path.join(target_dir, OUTPUT_FILENAME)
        atomic_write_json(
            out_path,
            payload,
            indent=None,
            separators=(",", ":"),
            prefix=".tmp_night_lights_",
            suffix=".geojson",
        )

    print(
        f"✅ 夜間燈光圖資更新完成：{len(features):,} 個色塊多邊形 "
        f"({valid_nights[0][0]} ~ {valid_nights[-1][0]}，取樣 {len(valid_nights)} 晚) | 等級分佈: {tier_counts}"
    )
    return features


if __name__ == "__main__":
    update_night_lights()
