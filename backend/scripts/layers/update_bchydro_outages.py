#!/usr/bin/env python3
"""
BC Hydro Power Outages Data Updater (卑詩水電局停電資料同步器)
支援 3 個核心資料來源：
  1. 現正停電 (Current Outages & Region Messages): outages-list-data-current.json
  2. 恢復供電 (Restored 14 Days): outages-list-data-restored_14_days.json
  3. 預期停電 (Planned Outages): outages-list-data-planned.json

同步產出：
  - bchydro_outages_current.json
  - bchydro_outages_restored.json
  - bchydro_outages_planned.json
  - bchydro_outages_map.geojson (地圖專用受影響範圍多邊形與標記圖徵)
"""

import os
import sys
import json
import re
import argparse
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, BACKEND_DATA_DIR, FRONTEND_DATA_DIR

CURRENT_URL = "https://www.bchydro.com/power-outages/app/outages-list-data-current.json"
RESTORED_URL = "https://www.bchydro.com/power-outages/app/outages-list-data-restored_14_days.json"
PLANNED_URL = "https://www.bchydro.com/power-outages/app/outages-list-data-planned.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.bchydro.com/power-outages/app/outage-map.html"
}

LOWERCASE_WORDS = {'of', 'and', 'the', 'in', 'on', 'at', 'to', 'for', 'by', 'with'}


def to_title_case(text: str) -> str:
    """
    將全大寫地名轉換為 Title Case (每個單詞首字母大寫，保留特定介系詞為小寫)
    例：'West of GRAVEL PIT ACCESS RD' -> 'West of Gravel Pit Access Rd'
    """
    if not text:
        return ""

    def capitalize_word(match):
        w = match.group(0)
        lower = w.lower()
        if lower in LOWERCASE_WORDS:
            return lower
        return w.capitalize()

    formatted = re.sub(r'\b[A-Za-z]+\b', capitalize_word, text)
    # 確保句首第一個字母大寫
    if formatted and formatted[0].isalpha():
        formatted = formatted[0].upper() + formatted[1:]
    return formatted


def fetch_json(url: str, timeout: int = 15):
    """安全拉取遠端 JSON 資料"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
        print(f"⚠️ 請求失敗 {url} (HTTP {resp.status_code})")
    except Exception as e:
        print(f"❌ 請求例外 {url}: {e}")
    return None


def atomic_save_json(filename: str, data: any):
    """同步寫入 backend/data/ 及 frontend/public/ 目錄"""
    for folder in [BACKEND_DATA_DIR, FRONTEND_DATA_DIR]:
        os.makedirs(folder, exist_ok=True)
        target_path = os.path.join(folder, filename)
        tmp_path = target_path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, target_path)
        except Exception as e:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            print(f"⚠️ 寫入 {target_path} 失敗: {e}")


def update_current_outages():
    """抓取並處理現正停電與地區警報"""
    print("⚡ 正在從 BC Hydro 取得現正停電與地區警報資料...")
    data = fetch_json(CURRENT_URL)
    if not data or not isinstance(data, dict):
        print("❌ 無法取得現正停電資料")
        return {"count": 0, "messages_count": 0}

    messages_map = data.get("messagesMap", {})
    regions = data.get("regions", [])
    updated_date = data.get("updatedDate")

    all_outages = []
    map_features = []

    for reg in regions:
        reg_name = reg.get("name") or reg.get("regionCodeName") or ""
        reg_code = reg.get("regionCodeName") or ""
        outages = reg.get("outages", []) or []

        for out in outages:
            out_id = out.get("id")
            municipality = out.get("municipality") or ""
            area_raw = out.get("area") or ""
            area_formatted = to_title_case(area_raw)
            cause = out.get("cause") or ""
            num_cust = out.get("numCustomersOut", 0)
            crew_status = out.get("crewStatusDescr") or out.get("crewStatus") or ""
            crew_eta = out.get("crewEta")
            date_off = out.get("dateOff")
            date_on = out.get("dateOn")
            last_updated = out.get("lastUpdated")
            lat = out.get("latitude")
            lon = out.get("longitude")
            polygon_flat = out.get("polygon", []) or []

            # 建立結構化項目
            item = {
                **out,
                "area_formatted": area_formatted,
                "region_display_name": reg_name,
                "region_code": reg_code
            }
            all_outages.append(item)

            # 處理地圖坐標與多邊形幾何
            coords_poly = []
            if len(polygon_flat) >= 6:
                # 坐標格式為 [lon0, lat0, lon1, lat1, ...]
                for i in range(0, len(polygon_flat) - 1, 2):
                    coords_poly.append([polygon_flat[i], polygon_flat[i + 1]])
                if coords_poly and coords_poly[0] != coords_poly[-1]:
                    coords_poly.append(coords_poly[0])

            # 若未提供中心點或為 0，從多邊形計算中心點
            if (not lat or not lon or (lat == 0 and lon == 0)) and coords_poly:
                lon = sum(p[0] for p in coords_poly) / len(coords_poly)
                lat = sum(p[1] for p in coords_poly) / len(coords_poly)

            # 1. 如果有多邊形，建立 Polygon Feature
            if coords_poly:
                map_features.append({
                    "type": "Feature",
                    "id": f"outage-poly-{out_id}",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords_poly]
                    },
                    "properties": {
                        "id": out_id,
                        "feature_type": "polygon",
                        "municipality": municipality,
                        "area": area_formatted,
                        "cause": cause,
                        "numCustomersOut": num_cust,
                        "crewStatus": crew_status,
                        "crewEta": crew_eta,
                        "dateOff": date_off,
                        "dateOn": date_on,
                        "lastUpdated": last_updated,
                        "regionName": reg_name,
                        "latitude": lat,
                        "longitude": lon
                    }
                })

            # 2. 建立 Point Feature (標記位置)
            if lat and lon and not (lat == 0 and lon == 0):
                map_features.append({
                    "type": "Feature",
                    "id": f"outage-point-{out_id}",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "id": out_id,
                        "feature_type": "point",
                        "municipality": municipality,
                        "area": area_formatted,
                        "cause": cause,
                        "numCustomersOut": num_cust,
                        "crewStatus": crew_status,
                        "crewEta": crew_eta,
                        "dateOff": date_off,
                        "dateOn": date_on,
                        "lastUpdated": last_updated,
                        "regionName": reg_name,
                        "latitude": lat,
                        "longitude": lon,
                        "hasPolygon": bool(coords_poly)
                    }
                })

    payload = {
        "updatedDate": updated_date,
        "messagesMap": messages_map,
        "regions": regions,
        "all_outages": all_outages,
        "total_outages": len(all_outages),
        "total_customers_out": sum(o.get("numCustomersOut", 0) for o in all_outages)
    }
    atomic_save_json("bchydro_outages_current.json", payload)
    save_layer_geojson("bchydro_outages_map.geojson", map_features)
    print(f"✅ BC Hydro 現正停電更新完成！共 {len(all_outages)} 筆停電事件，{len(messages_map)} 則地區警報，{len(map_features)} 處地圖圖徵。")
    return {"count": len(all_outages), "messages_count": len(messages_map), "features": len(map_features)}


def update_restored_outages():
    """抓取並處理過去 14 天恢復供電資料"""
    print("⚡ 正在從 BC Hydro 取得過去 14 天恢復供電資料...")
    data = fetch_json(RESTORED_URL)
    if not data or not isinstance(data, dict):
        print("❌ 無法取得恢復供電資料")
        return {"count": 0}

    regions = data.get("regions", [])
    updated_date = data.get("updatedDate")

    all_outages = []
    for reg in regions:
        reg_name = reg.get("name") or reg.get("regionCodeName") or ""
        reg_code = reg.get("regionCodeName") or ""
        outages = reg.get("outages", []) or []
        for out in outages:
            area_formatted = to_title_case(out.get("area") or "")
            all_outages.append({
                **out,
                "area_formatted": area_formatted,
                "region_display_name": reg_name,
                "region_code": reg_code
            })

    payload = {
        "updatedDate": updated_date,
        "regions": regions,
        "all_outages": all_outages,
        "total_outages": len(all_outages)
    }
    atomic_save_json("bchydro_outages_restored.json", payload)
    print(f"✅ BC Hydro 恢復供電更新完成！共 {len(all_outages)} 筆歷史記錄。")
    return {"count": len(all_outages)}


def update_planned_outages():
    """抓取並處理預期停電資料"""
    print("⚡ 正在從 BC Hydro 取得預期停電資料...")
    data = fetch_json(PLANNED_URL)
    if not data or not isinstance(data, dict):
        print("❌ 無法取得預期停電資料")
        return {"count": 0}

    regions = data.get("regions", [])
    updated_date = data.get("updatedDate")

    all_outages = []
    for reg in regions:
        reg_name = reg.get("name") or reg.get("regionCodeName") or ""
        reg_code = reg.get("regionCodeName") or ""
        outages = reg.get("outages", []) or []
        for out in outages:
            area_formatted = to_title_case(out.get("area") or "")
            all_outages.append({
                **out,
                "area_formatted": area_formatted,
                "region_display_name": reg_name,
                "region_code": reg_code
            })

    payload = {
        "updatedDate": updated_date,
        "regions": regions,
        "all_outages": all_outages,
        "total_outages": len(all_outages)
    }
    atomic_save_json("bchydro_outages_planned.json", payload)
    print(f"✅ BC Hydro 預期停電更新完成！共 {len(all_outages)} 筆預期停電。")
    return {"count": len(all_outages)}


def update_bchydro_outages():
    update_current_outages()
    update_restored_outages()
    update_planned_outages()


def main():
    parser = argparse.ArgumentParser(description="BC Hydro Power Outages Updater")
    parser.add_argument(
        "--type",
        choices=["all", "current", "restored", "planned"],
        default="all",
        help="Update target type"
    )
    args = parser.parse_args()

    if args.type in ("all", "current"):
        update_current_outages()
    if args.type in ("all", "restored"):
        update_restored_outages()
    if args.type in ("all", "planned"):
        update_planned_outages()


if __name__ == "__main__":
    main()
