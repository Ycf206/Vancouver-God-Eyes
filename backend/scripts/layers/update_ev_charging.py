import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    fetch_all_records,
    save_layer_geojson,
    load_existing_geojson,
    sync_facility_to_db,
    update_admin_source_metadata,
)
from update_flo_ev import crawl_flo_api1, refresh_flo_api2
from update_chargepoint_ev import crawl_chargepoint_api1, refresh_chargepoint_api2


def _match_existing_cov(existing_feats, obj_id, addr, lat, lon):
    """Find matching existing CoV EV record to preserve enriched technical fields."""
    cov_id = f"ev_cov_{obj_id}" if obj_id is not None else ""
    for ef in existing_feats:
        fid = str(ef.get("id") or "")
        if fid.startswith("ev_flo_") or fid.startswith("ev_cp_"):
            continue
        props = ef.get("properties") or {}
        if cov_id and (fid == cov_id or str(props.get("id") or "") == cov_id):
            return ef
        if addr and str(props.get("address") or "").strip().lower() == str(addr).strip().lower():
            return ef
        p_lat = props.get("lat")
        p_lon = props.get("lon")
        if (
            p_lat is not None
            and p_lon is not None
            and abs(float(p_lat) - float(lat)) < 0.00025
            and abs(float(p_lon) - float(lon)) < 0.00025
        ):
            return ef
    return None


def update_ev_charging(refresh_flo_live: bool = True):
    print("🔋 正在更新電動車充電站點 (City of Vancouver + FLO API1 + ChargePoint API1)...")
    existing = load_existing_geojson("vancouver_ev_charging.geojson") or {}
    existing_feats = [
        f for f in (existing.get("features") or [])
        if not (str(f.get("id") or "").startswith("ev_flo_") or str(f.get("id") or "").startswith("ev_cp_"))
    ]

    records = fetch_all_records("electric-vehicle-charging-stations")
    features = []
    seen_ids = set()

    for idx, r in enumerate(records):
        geo = r.get("geo_point_2d") or {}
        lat = geo.get("lat")
        lon = geo.get("lon")

        if lat is None or lon is None:
            geom = r.get("geom") or {}
            coords = geom.get("geometry", {}).get("coordinates", [])
            if len(coords) >= 2:
                lon, lat = coords[0], coords[1]

        if lat is None or lon is None:
            continue

        obj_id = r.get("map_id") or r.get("object_id") or r.get("lot_id") or idx
        addr_raw = r.get("address") or r.get("lot_description") or r.get("location") or ""
        matched = _match_existing_cov(existing_feats, obj_id, addr_raw, float(lat), float(lon))
        prev_props = dict((matched or {}).get("properties") or {})

        feat_id = str(prev_props.get("id") or (f"ev_cov_{obj_id}" if r.get("map_id") else f"ev_{obj_id}"))
        if feat_id in seen_ids:
            continue
        seen_ids.add(feat_id)

        name = prev_props.get("name") or r.get("address") or r.get("location") or f"充電站 #{obj_id}"
        cost_val = r.get("cost") or prev_props.get("cost") or ""
        is_free = prev_props.get("is_free")
        if is_free is None:
            cost_lower = str(cost_val).lower()
            is_free = ("free" in cost_lower or "$0" in cost_lower or "no charge" in cost_lower) and "paid" not in cost_lower

        props = {
            **prev_props,
            "id": feat_id,
            "facility_type": "ev_charging",
            "source": prev_props.get("source") or "cov",
            "name": name,
            "address": r.get("address") or prev_props.get("address") or name,
            "local_area": r.get("geo_local_area") or r.get("local_area") or prev_props.get("local_area") or "",
            "location": r.get("location") or r.get("lot_description") or prev_props.get("location") or "",
            "lot_type": r.get("lot_type") or prev_props.get("lot_type") or "",
            "level_1": prev_props.get("level_1") or r.get("level_1") or "Level 2",
            "operator": r.get("operator") or prev_props.get("operator") or "City of Vancouver",
            "connectors": r.get("connectors") or prev_props.get("connectors") or "J1772",
            "ports": r.get("ports") or prev_props.get("ports") or 2,
            "voltage": prev_props.get("voltage"),
            "power_kw": prev_props.get("power_kw"),
            "cost": cost_val,
            "is_free": bool(is_free),
            "access": prev_props.get("access") or "Public",
            "status": "Active",
            "lat": float(lat),
            "lon": float(lon),
        }

        feat = {
            "type": "Feature",
            "id": feat_id,
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)],
            },
            "properties": props,
        }
        features.append(feat)

    # Fallback: preserve existing CoV features if OpenData returns fewer/empty
    if not features and existing_feats:
        print("ℹ️ 溫哥華市府 OpenData 暫時無回傳，保留現有 CoV 快取備份...")
        features = existing_feats

    if features:
        save_layer_geojson("vancouver_ev_charging.geojson", features)
        sync_facility_to_db("ev_charging", features)
        print(f"✅ 溫哥華市府電動車充電站更新完成，共 {len(features)} 處站點。")

    # Crawl FLO API1 & ChargePoint API1 catalogs across Greater Vancouver (monthly update)
    flo_catalog = crawl_flo_api1(save_catalog=True)
    flo_parks_count = int((flo_catalog or {}).get("total_parks") or 0)
    cp_catalog = crawl_chargepoint_api1(save_catalog=True)
    cp_devices_count = int((cp_catalog or {}).get("total_devices") or 0)
    update_admin_source_metadata("ev_charging", len(features) + flo_parks_count + cp_devices_count)

    # Hydrate FLO API2 & ChargePoint API2 initial live cache when requested
    if refresh_flo_live:
        refresh_flo_api2(update_admin_meta=True)
        refresh_chargepoint_api2(update_admin_meta=True)

    return features


if __name__ == "__main__":
    update_ev_charging(refresh_flo_live=("--api1-only" not in sys.argv))
