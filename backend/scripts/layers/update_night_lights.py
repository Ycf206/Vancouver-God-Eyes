#!/usr/bin/env python3
"""
Canada & Southern BC Night Lights Updater (NASA Black Marble VIIRS via NASA GIBS).

Generates two compact 8-color indexed palette PNGs (index 0 = transparent, 1..7 = radiance tiers)
representing a 1-year median composite of NASA GIBS
`VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance`:

1. `backend/data/canada_night_lights_z5.png`
   - Covers all of Canada (z=5, x=3..11, y=6..11 -> lon -146.25°..-45.0°, lat 40.98°..74.02°)
   - 2304 x 1536 px (~2.5 km/px at 49°N), 12 monthly nights median (~100-180 KB PNG)
2. `backend/data/bc_night_lights_z8.png`
   - Covers Southern BC, Metro Vancouver, Vancouver Island, Fraser Valley, Whistler & Okanagan
     (z=8, x=38..42, y=86..88 -> lon -126.56°..-119.53°, lat 47.99°..50.74°)
   - 1280 x 768 px (~310 m/px native VIIRS resolution), 24 biweekly nights median (~40-80 KB PNG)
3. `backend/data/vancouver_night_lights_meta.json` (+ copy in `frontend/public/`)
   - Metadata, sample date range, bounds, tile configs, and 7-tier legend definitions.

Tiles are served on the fly by FastAPI `GET /api/night-lights/tiles/{z}/{x}/{y}.png`.
"""

from __future__ import annotations

import io
import math
import os
import re
import statistics
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from PIL import Image, ImageChops

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    FRONTEND_DATA_DIR,
    atomic_write_json,
)

CANADA_PNG_FILENAME = "canada_night_lights_z5.png"
BC_PNG_FILENAME = "bc_night_lights_z8.png"
CANADA_MASK_FILENAME = "canada_mask_z5.png"
BC_MASK_FILENAME = "bc_mask_z8.png"
META_FILENAME = "vancouver_night_lights_meta.json"
LEGACY_GEOJSON_FILENAME = "vancouver_night_lights.geojson"

# NASA Black Marble (VIIRS NOAA-20 Gap-Filled BRDF-Corrected Day/Night Band Radiance) via NASA GIBS
GIBS_LAYER_ID = "VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
GIBS_FALLBACK_LAYER_ID = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
GIBS_TMS = "GoogleMapsCompatible_Level8"
GIBS_CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
GIBS_TILE_URL_TEMPLATE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "{layer}/default/{date}/" + GIBS_TMS + "/{z}/{y}/{x}.png"
)

# Full Canada z=5 grid (9 x 6 = 54 tiles -> 2304 x 1536 px)
# lon: -146.25° to -45.00° | lat: 40.98° to 74.02°
# Uses 30th percentile across 12 monthly nights to suppress Arctic winter snow/aurora false glow
# while preserving permanent year-round Canadian city & town lights, clipped strictly to Canada ADM0 mask.
CANADA_GRID = {
    "zoom": 5,
    "tx_min": 3,
    "tx_max": 11,
    "ty_min": 6,
    "ty_max": 11,
    "sample_count": 12,
    "step_days": 30,
    "min_valid_nights": 3,
    "percentile": 0.30,
    "mask_file": CANADA_MASK_FILENAME,
}

# Southern BC / Metro Vancouver / Vancouver Island / Okanagan high-res z=8 grid (5 x 3 = 15 tiles -> 1280 x 768 px)
# lon: -126.5625° to -119.53125° | lat: 47.99° to 50.74°
BC_GRID = {
    "zoom": 8,
    "tx_min": 38,
    "tx_max": 42,
    "ty_min": 86,
    "ty_max": 88,
    "sample_count": 24,
    "step_days": 15,
    "min_valid_nights": 3,
    "percentile": 0.45,
    "mask_file": BC_MASK_FILENAME,
}

# Radiance brightness (0-255 percentile pixel value) -> 7 discrete color tiers (inspired by Bortle / VIIRS palettes)
# Pixels with value <= 29 (dark ocean, unlit wilderness & faint atmospheric scatter) map to index 0 (transparent).
NIGHT_LIGHT_TIERS: list[dict[str, Any]] = [
    {"level": 1, "min_val": 30, "max_val": 59, "color": "#1e3a8a", "rgb": [30, 58, 138], "label_zh": "極弱", "group": "低亮度"},
    {"level": 2, "min_val": 60, "max_val": 94, "color": "#4338ca", "rgb": [67, 56, 202], "label_zh": "微弱", "group": "低亮度"},
    {"level": 3, "min_val": 95, "max_val": 129, "color": "#7e22ce", "rgb": [126, 34, 206], "label_zh": "輕中", "group": "中亮度"},
    {"level": 4, "min_val": 130, "max_val": 164, "color": "#be185d", "rgb": [190, 24, 93], "label_zh": "中等", "group": "中亮度"},
    {"level": 5, "min_val": 165, "max_val": 199, "color": "#ea580c", "rgb": [234, 88, 12], "label_zh": "較強", "group": "高亮度"},
    {"level": 6, "min_val": 200, "max_val": 231, "color": "#f59e0b", "rgb": [245, 158, 11], "label_zh": "強光", "group": "高亮度"},
    {"level": 7, "min_val": 232, "max_val": 255, "color": "#fef08a", "rgb": [254, 240, 138], "label_zh": "極強", "group": "都會核心"},
]

# Precomputed lookup table: grayscale 0..255 -> tier index 0..7
BRIGHTNESS_TO_TIER = [0] * 256
for _tier in NIGHT_LIGHT_TIERS:
    for _v in range(_tier["min_val"], _tier["max_val"] + 1):
        BRIGHTNESS_TO_TIER[_v] = _tier["level"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "image/png,application/xml,*/*",
}


def _tile_bounds_wgs84(z: int, tx_min: int, tx_max: int, ty_min: int, ty_max: int) -> list[float]:
    """Return [west, south, east, north] WGS84 bounds for inclusive XYZ tile range."""
    n = 2**z
    west = tx_min / n * 360.0 - 180.0
    east = (tx_max + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * ty_min / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (ty_max + 1) / n))))
    return [round(west, 6), round(south, 6), round(east, 6), round(north, 6)]


def _build_palette() -> list[int]:
    """Build 768-byte RGB palette for Pillow mode='P' (index 0 = black/transparent, 1..7 = tier colors)."""
    pal = [0, 0, 0]
    for tier in NIGHT_LIGHT_TIERS:
        pal.extend(tier["rgb"])
    pal.extend([0, 0, 0] * (256 - (1 + len(NIGHT_LIGHT_TIERS))))
    return pal


def _atomic_save_indexed_png(path: str, index_img: Image.Image) -> int:
    """Save an 8-color indexed palette PNG with transparency index 0 atomically."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    p_img = index_img.convert("P")
    p_img.putpalette(_build_palette())

    fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(path),
        prefix=".tmp_night_lights_",
        suffix=".png",
    )
    os.close(fd)
    try:
        p_img.save(tmp_path, format="PNG", optimize=True, transparency=0)
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return os.path.getsize(path)


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


def _fetch_tile_grayscale(
    session: requests.Session,
    layer_id: str,
    dt_str: str,
    z: int,
    tx: int,
    ty: int,
) -> Image.Image | None:
    url = GIBS_TILE_URL_TEMPLATE.format(layer=layer_id, date=dt_str, z=z, y=ty, x=tx)
    for attempt in range(2):
        try:
            resp = session.get(url, headers=HEADERS, timeout=20)
            if resp.status_code != 200 or not resp.content:
                if attempt == 0 and resp.status_code >= 500:
                    continue
                return None
            im = Image.open(io.BytesIO(resp.content)).convert("RGBA").convert("L")
            if im.size != (256, 256):
                return None
            return im
        except Exception:
            if attempt == 0:
                continue
            return None
    return None


def _compute_median_index_mosaic(
    label: str,
    latest_dt: date,
    grid_cfg: dict[str, Any],
) -> tuple[Image.Image | None, dict[str, Any]]:
    z = grid_cfg["zoom"]
    tx_min, tx_max = grid_cfg["tx_min"], grid_cfg["tx_max"]
    ty_min, ty_max = grid_cfg["ty_min"], grid_cfg["ty_max"]
    sample_count = grid_cfg["sample_count"]
    step_days = grid_cfg["step_days"]
    min_valid_nights = grid_cfg["min_valid_nights"]

    cols = tx_max - tx_min + 1
    rows = ty_max - ty_min + 1
    width = cols * 256
    height = rows * 256
    tile_coords = [(tx, ty) for ty in range(ty_min, ty_max + 1) for tx in range(tx_min, tx_max + 1)]
    sample_dates = [
        (latest_dt - timedelta(days=i * step_days)).isoformat()
        for i in range(sample_count)
    ]

    print(
        f"  🛰️ [{label}] z={z} ({cols}×{rows}={len(tile_coords)} 瓦片, {width}×{height} px) "
        f"| 取樣 {len(sample_dates)} 晚 ({sample_dates[-1]} ~ {sample_dates[0]})"
    )

    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=24, pool_maxsize=24)
    session.mount("https://", adapter)

    fetched_by_date: dict[str, dict[tuple[int, int], Image.Image]] = {}
    with ThreadPoolExecutor(max_workers=20) as pool:
        futs = {
            pool.submit(_fetch_tile_grayscale, session, GIBS_LAYER_ID, dt_str, z, tx, ty): (dt_str, tx, ty)
            for dt_str in sample_dates
            for (tx, ty) in tile_coords
        }
        for fut in as_completed(futs):
            dt_str, tx, ty = futs[fut]
            im = fut.result()
            if im is not None:
                fetched_by_date.setdefault(dt_str, {})[(tx, ty)] = im

    session.close()

    valid_nights: list[tuple[str, Image.Image]] = []
    for dt_str in sorted(fetched_by_date.keys()):
        tmap = fetched_by_date[dt_str]
        # Require at least 95% of tiles to succeed for a night; missing dark Arctic tiles stay 0
        if len(tmap) < max(1, int(len(tile_coords) * 0.95)):
            continue
        mosaic = Image.new("L", (width, height), 0)
        max_val = 0
        for (tx, ty), im in tmap.items():
            ext = im.getextrema()
            if ext and ext[1] > max_val:
                max_val = ext[1]
            mosaic.paste(im, ((tx - tx_min) * 256, (ty - ty_min) * 256))
        if max_val <= 0:
            continue
        valid_nights.append((dt_str, mosaic))

    if len(valid_nights) < min_valid_nights:
        print(f"  ⚠️ [{label}] NASA GIBS 有效取樣夜數不足 ({len(valid_nights)} 晚)")
        return None, {}

    print(f"  📊 [{label}] 成功合成 {len(valid_nights)} 晚完整影像，正在套用加拿大國界遮罩與計算年代表亮度...")

    # Optional Canada national boundary mask (0 = outside Canada/US/ocean, 255 = inside Canada)
    mask_bytes: bytes | None = None
    mask_filename = grid_cfg.get("mask_file")
    if mask_filename:
        mask_path = os.path.join(BACKEND_DATA_DIR, mask_filename)
        if os.path.exists(mask_path):
            try:
                with Image.open(mask_path) as m_raw:
                    m_img = m_raw.convert("L")
                    if m_img.size != (width, height):
                        m_img = m_img.resize((width, height), Image.Resampling.NEAREST)
                    mask_bytes = m_img.tobytes()
            except Exception as exc:
                print(f"  ⚠️ [{label}] 無法讀取國界遮罩 {mask_filename}: {exc}")

    # Fast C-accelerated mask: only pixels whose max across all nights >= 30 can ever qualify
    max_mosaic = valid_nights[0][1]
    for _, im in valid_nights[1:]:
        max_mosaic = ImageChops.lighter(max_mosaic, im)
    lit_mask = max_mosaic.point(lambda v: 1 if v >= 30 else 0).tobytes()

    night_buffers = [im.tobytes() for _, im in valid_nights]
    n_nights = len(night_buffers)
    pct = float(grid_cfg.get("percentile", 0.50))
    pct_idx = max(0, min(n_nights - 1, int(round((n_nights - 1) * pct))))

    out_buf = bytearray(width * height)
    tier_counts: dict[int, int] = {t["level"]: 0 for t in NIGHT_LIGHT_TIERS}
    lit_pixels = 0
    lut = BRIGHTNESS_TO_TIER

    for r in range(height):
        row_start = r * width
        row_end = row_start + width
        row_mask = lit_mask[row_start:row_end]
        if b"\x01" not in row_mask:
            continue
        country_row = mask_bytes[row_start:row_end] if mask_bytes is not None else None
        for c, flag in enumerate(row_mask):
            if not flag:
                continue
            if country_row is not None and country_row[c] == 0:
                continue
            idx = row_start + c
            vals = sorted(buf[idx] for buf in night_buffers)
            agg_val = vals[pct_idx]
            tier_idx = lut[agg_val]
            if tier_idx:
                out_buf[idx] = tier_idx
                tier_counts[tier_idx] += 1
                lit_pixels += 1

    index_img = Image.frombytes("L", (width, height), bytes(out_buf))
    info = {
        "zoom": z,
        "tx_min": tx_min,
        "tx_max": tx_max,
        "ty_min": ty_min,
        "ty_max": ty_max,
        "width": width,
        "height": height,
        "bounds": _tile_bounds_wgs84(z, tx_min, tx_max, ty_min, ty_max),
        "nights_sampled": len(valid_nights),
        "sample_start": valid_nights[0][0],
        "sample_end": valid_nights[-1][0],
        "lit_pixels": lit_pixels,
        "tier_counts": {str(k): v for k, v in tier_counts.items()},
    }
    return index_img, info


def update_night_lights() -> dict[str, Any]:
    print("🌌 正在從 NASA GIBS 擷取 NASA Black Marble (VIIRS) 全加拿大 & 南卑詩省一年中位數夜間燈光圖資...")
    latest_dt = _discover_latest_gibs_date(GIBS_LAYER_ID)
    print(f"  📅 NASA GIBS 最新日期: {latest_dt.isoformat()} ({GIBS_LAYER_ID})")

    canada_img, canada_info = _compute_median_index_mosaic("全加拿大 z=5", latest_dt, CANADA_GRID)
    bc_img, bc_info = _compute_median_index_mosaic("南卑詩省/大溫 z=8", latest_dt, BC_GRID)

    canada_path = os.path.join(BACKEND_DATA_DIR, CANADA_PNG_FILENAME)
    bc_path = os.path.join(BACKEND_DATA_DIR, BC_PNG_FILENAME)

    if canada_img is not None:
        canada_bytes = _atomic_save_indexed_png(canada_path, canada_img)
        canada_info["file"] = CANADA_PNG_FILENAME
        canada_info["size_bytes"] = canada_bytes
        print(
            f"  ✅ 已儲存 {CANADA_PNG_FILENAME}: {canada_bytes / 1024:.1f} KB "
            f"(點亮像素 {canada_info['lit_pixels']:,})"
        )
    elif os.path.exists(canada_path):
        print(f"  ℹ️ 保留現有 {CANADA_PNG_FILENAME} 快取")

    if bc_img is not None:
        bc_bytes = _atomic_save_indexed_png(bc_path, bc_img)
        bc_info["file"] = BC_PNG_FILENAME
        bc_info["size_bytes"] = bc_bytes
        print(
            f"  ✅ 已儲存 {BC_PNG_FILENAME}: {bc_bytes / 1024:.1f} KB "
            f"(點亮像素 {bc_info['lit_pixels']:,})"
        )
    elif os.path.exists(bc_path):
        print(f"  ℹ️ 保留現有 {BC_PNG_FILENAME} 快取")

    # Clean up legacy bloated GeoJSON if still present locally
    for target_dir in (BACKEND_DATA_DIR, FRONTEND_DATA_DIR):
        legacy_path = os.path.join(target_dir, LEGACY_GEOJSON_FILENAME)
        if os.path.exists(legacy_path):
            try:
                os.remove(legacy_path)
            except OSError:
                pass

    if not canada_info and not bc_info:
        meta_path = os.path.join(BACKEND_DATA_DIR, META_FILENAME)
        if os.path.exists(meta_path):
            import json
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"total_count": 0}

    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    total_lit = int(canada_info.get("lit_pixels", 0)) + int(bc_info.get("lit_pixels", 0))
    meta_payload: dict[str, Any] = {
        "generator": "VancouverGodsEye",
        "source": "NASA Black Marble (VIIRS) via NASA GIBS",
        "gibs_layer": GIBS_LAYER_ID,
        "coverage": "Canada (z=5) + Southern BC / Metro Vancouver High-Res (z=8)",
        "aggregation": "1-year median",
        "sample_start": canada_info.get("sample_start") or bc_info.get("sample_start"),
        "sample_end": canada_info.get("sample_end") or bc_info.get("sample_end"),
        "updated_at": now_iso,
        "total_count": total_lit,
        "bounds": canada_info.get("bounds") or _tile_bounds_wgs84(
            CANADA_GRID["zoom"],
            CANADA_GRID["tx_min"],
            CANADA_GRID["tx_max"],
            CANADA_GRID["ty_min"],
            CANADA_GRID["ty_max"],
        ),
        "grids": {
            "canada_z5": canada_info,
            "bc_z8": bc_info,
        },
        "legend_tiers": [
            {k: v for k, v in tier.items() if k != "rgb"}
            for tier in NIGHT_LIGHT_TIERS
        ],
    }

    for target_dir in (BACKEND_DATA_DIR, FRONTEND_DATA_DIR):
        os.makedirs(target_dir, exist_ok=True)
        out_path = os.path.join(target_dir, META_FILENAME)
        atomic_write_json(
            out_path,
            meta_payload,
            indent=2,
            prefix=".tmp_night_lights_meta_",
            suffix=".json",
        )

    total_kb = (canada_info.get("size_bytes", 0) + bc_info.get("size_bytes", 0)) / 1024
    print(
        f"✅ 全加拿大 & 南卑詩省夜間燈光圖資更新完成！"
        f"總容量 {total_kb:.1f} KB，合計 {total_lit:,} 個點亮像素。"
    )
    return meta_payload


if __name__ == "__main__":
    update_night_lights()
