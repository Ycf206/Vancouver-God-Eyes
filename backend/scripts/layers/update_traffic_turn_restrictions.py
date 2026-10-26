#!/usr/bin/env python3
"""
Automated updater for Vancouver Traffic Turn Restrictions dataset.
Decodes restrictions and formats directional arrows and prohibition indicators.
Directional restrictions only (EB/WB/NB/SB) to prevent duplication from general LT/RT summaries.
"""

import os
import sys
import json
import re

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, BACKEND_DATA_DIR, FRONTEND_DATA_DIR

def decode_restriction_segment(text):
    if not text or str(text).strip().lower() in ["none", "null", "-", ""]:
        return None
    s = str(text).strip().rstrip(",")
    if not s or s.lower() == "none":
        return None

    formatted = s
    formatted = re.sub(r'\bNRTOR\b', '紅燈禁止右轉 (No right turn on red)', formatted)
    formatted = re.sub(r'\bNLT\b', '禁止左轉 (No Left Turn)', formatted)
    formatted = re.sub(r'\bNRT\b', '禁止右轉 (No Right Turn)', formatted)
    formatted = re.sub(r'\bExBike\b', '單車除外 (Except bike)', formatted)
    formatted = re.sub(r'\bExBus\b', '公車除外 (Except bus)', formatted)
    formatted = re.sub(r'\bM/F\b', '週一至週五 (Mon-Fri)', formatted)
    formatted = re.sub(r'\bF/Su\b', '週五至週日 (Fri-Sun)', formatted)
    formatted = re.sub(r'\b7/930\b', '07:00 - 09:30', formatted)
    formatted = re.sub(r'\b3/6\b', '15:00 - 18:00', formatted)
    formatted = re.sub(r'\b9P/2A\b', '21:00 - 02:00', formatted)
    formatted = re.sub(r'\bEB\b', '東行 (Eastbound)', formatted)
    formatted = re.sub(r'\bWB\b', '西行 (Westbound)', formatted)
    formatted = re.sub(r'\bNB\b', '北行 (Northbound)', formatted)
    formatted = re.sub(r'\bSB\b', '南行 (Southbound)', formatted)

    return formatted

def bezier_curve(p0, pctrl, p1, steps=6):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        inv = 1.0 - t
        x = inv * inv * p0[0] + 2.0 * inv * t * pctrl[0] + t * t * p1[0]
        y = inv * inv * p0[1] + 2.0 * inv * t * pctrl[1] + t * t * p1[1]
        pts.append([round(x, 7), round(y, 7)])
    return pts

def update_traffic_turn_restrictions():
    print("🔄 正在處理溫哥華路口轉向限制 (Traffic Turn Restrictions)...")
    source_path = os.path.join(BACKEND_DATA_DIR, "raw_traffic_turn_restrictions.geojson")
    if not os.path.exists(source_path):
        source_path = os.path.join(BACKEND_DATA_DIR, "vancouver_traffic_turn_restrictions.geojson")
    if not os.path.exists(source_path):
        source_path = os.path.join(FRONTEND_DATA_DIR, "vancouver_traffic_turn_restrictions.geojson")

    if not os.path.exists(source_path):
        print(f"❌ 找不到轉向限制原始檔案: {source_path}")
        return []

    with open(source_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 僅使用方向性欄位 (排除已包含在內的 LT/RT restriction，避免重複顯示)
    fields = [
        ("NBLT_RESTRICTION", "北行左轉限制 (NB)", "NBLT"),
        ("SBLT_RESTRICTION", "南行左轉限制 (SB)", "SBLT"),
        ("EBLT_RESTRICTION", "東行左轉限制 (EB)", "EBLT"),
        ("WBLT_RESTRICTION", "西行左轉限制 (WB)", "WBLT"),
        ("NBRT_RESTRICTION", "北行右轉限制 (NB)", "NBRT"),
        ("SBRT_RESTRICTION", "南行右轉限制 (SB)", "SBRT"),
        ("EBRT_RESTRICTION", "東行右轉限制 (EB)", "EBRT"),
        ("WBRT_RESTRICTION", "西行右轉限制 (WB)", "WBRT")
    ]

    dx = 0.00030
    dy = 0.00020

    raw_features = [feat for feat in data.get("features", []) if feat.get("geometry", {}).get("type") == "Point" and not feat.get("properties", {}).get("is_arrow_symbol")]
    processed_features = []
    arrow_features = []
    symbol_features = []

    for idx, f in enumerate(raw_features):
        props = f.get("properties") or {}
        sig_loc = props.get("SIGNAL_LOCATION") or props.get("signal_location") or "路口"
        coords = f.get("geometry", {}).get("coordinates")
        if not coords:
            coords = [props.get("LONG"), props.get("LAT")]
        if not coords or coords[0] is None or coords[1] is None:
            continue

        lon = float(coords[0])
        lat = float(coords[1])

        active_restrictions = []
        for k, label, dircode in fields:
            v = props.get(k)
            if v and str(v).strip().lower() not in ["none", "null", "-", ""]:
                lines = str(v).split("\n")
                for line in lines:
                    dec = decode_restriction_segment(line)
                    if dec:
                        active_restrictions.append({
                            "field": k,
                            "label": label,
                            "dir": dircode,
                            "raw": line.strip(),
                            "decoded": dec
                        })

        intersection_id = f"turn_restriction_{idx+1}"
        has_restrictions = len(active_restrictions) > 0

        new_props = {
            "id": intersection_id,
            "facility_type": "turn_restrictions",
            "name": sig_loc,
            "signal_location": sig_loc,
            "type": props.get("TYPE") or props.get("type") or "Traffic Signal",
            "left_turn_bay": props.get("LEFT_TURN_BAY") or props.get("left_turn_bay"),
            "right_turn_bay": props.get("RIGHT_TURN_BAY") or props.get("right_turn_bay"),
            "has_restrictions": has_restrictions,
            "restrictions_count": len(active_restrictions),
            "restrictions": active_restrictions,
            "summary_text": "; ".join([r["decoded"] for r in active_restrictions]) if active_restrictions else "無特定轉向限制"
        }

        for k, v in props.items():
            if k not in new_props:
                new_props[k] = v

        processed_features.append({
            "type": "Feature",
            "id": intersection_id,
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": new_props
        })

        # 若具有轉向限制，於路口繪製對應禁止轉彎之幼線軌跡與禁止符號
        if has_restrictions:
            seen_dirs = set()
            for r in active_restrictions:
                dir_code = r.get("dir")
                if not dir_code or dir_code in seen_dirs:
                    continue
                seen_dirs.add(dir_code)

                pctrl = [lon, lat]
                p0, p1, sym_pos, arrow_char = None, None, None, "▲"

                if dir_code == "EBLT":
                    p0 = [lon - dx, lat]
                    p1 = [lon, lat + dy]
                    sym_pos = [lon - dx * 0.1, lat + dy * 0.45]
                    arrow_char = "▲"
                elif dir_code == "EBRT":
                    p0 = [lon - dx, lat]
                    p1 = [lon, lat - dy]
                    sym_pos = [lon - dx * 0.1, lat - dy * 0.45]
                    arrow_char = "▼"
                elif dir_code == "WBLT":
                    p0 = [lon + dx, lat]
                    p1 = [lon, lat - dy]
                    sym_pos = [lon + dx * 0.1, lat - dy * 0.45]
                    arrow_char = "▼"
                elif dir_code == "WBRT":
                    p0 = [lon + dx, lat]
                    p1 = [lon, lat + dy]
                    sym_pos = [lon + dx * 0.1, lat + dy * 0.45]
                    arrow_char = "▲"
                elif dir_code == "NBLT":
                    p0 = [lon, lat - dy]
                    p1 = [lon - dx, lat]
                    sym_pos = [lon - dx * 0.45, lat - dy * 0.1]
                    arrow_char = "◀"
                elif dir_code == "NBRT":
                    p0 = [lon, lat - dy]
                    p1 = [lon + dx, lat]
                    sym_pos = [lon + dx * 0.45, lat - dy * 0.1]
                    arrow_char = "▶"
                elif dir_code == "SBLT":
                    p0 = [lon, lat + dy]
                    p1 = [lon + dx, lat]
                    sym_pos = [lon + dx * 0.45, lat + dy * 0.1]
                    arrow_char = "▶"
                elif dir_code == "SBRT":
                    p0 = [lon, lat + dy]
                    p1 = [lon - dx, lat]
                    sym_pos = [lon - dx * 0.45, lat + dy * 0.1]
                    arrow_char = "◀"

                if p0 and p1:
                    curve_pts = bezier_curve(p0, pctrl, p1, 6)

                    # 1. 幼線箭頭軌跡
                    arrow_features.append({
                        "type": "Feature",
                        "id": f"{intersection_id}_arrow_{dir_code}",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": curve_pts
                        },
                        "properties": {
                            "id": f"{intersection_id}_arrow_{dir_code}",
                            "parent_id": intersection_id,
                            "name": sig_loc,
                            "signal_location": sig_loc,
                            "facility_type": "turn_restrictions",
                            "is_restriction_arrow": True,
                            "dir": dir_code,
                            "decoded": r.get("decoded"),
                            "restrictions": restrictions
                        }
                    })

                    # 2. 禁止符號 🚫
                    symbol_features.append({
                        "type": "Feature",
                        "id": f"{intersection_id}_sym_{dir_code}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [round(sym_pos[0], 7), round(sym_pos[1], 7)]
                        },
                        "properties": {
                            "id": f"{intersection_id}_sym_{dir_code}",
                            "parent_id": intersection_id,
                            "name": sig_loc,
                            "signal_location": sig_loc,
                            "facility_type": "turn_restrictions",
                            "is_arrow_symbol": True,
                            "symbol": "🚫",
                            "restrictions": restrictions
                        }
                    })

                    # 3. 箭頭方向符號
                    symbol_features.append({
                        "type": "Feature",
                        "id": f"{intersection_id}_head_{dir_code}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [round(p1[0], 7), round(p1[1], 7)]
                        },
                        "properties": {
                            "id": f"{intersection_id}_head_{dir_code}",
                            "parent_id": intersection_id,
                            "name": sig_loc,
                            "signal_location": sig_loc,
                            "facility_type": "turn_restrictions",
                            "is_arrow_symbol": True,
                            "symbol": arrow_char,
                            "restrictions": restrictions
                        }
                    })

    all_features = processed_features + arrow_features + symbol_features
    save_layer_geojson("vancouver_traffic_turn_restrictions.geojson", all_features)
    print(f"✅ 轉向限制更新完成，共處理 {len(processed_features)} 處路口，生成 {len(arrow_features)} 條箭頭軌跡線與 {len(symbol_features)} 個禁止標記。")
    return all_features

if __name__ == "__main__":
    update_traffic_turn_restrictions()
