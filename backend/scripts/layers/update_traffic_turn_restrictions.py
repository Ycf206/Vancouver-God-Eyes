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
    formatted = re.sub(r'\bExBus\b', '巴士除外 (Except bus)', formatted)
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

    raw_features = [feat for feat in data.get("features", []) if feat.get("geometry", {}).get("type") == "Point" and not feat.get("properties", {}).get("is_arrow_symbol") and not feat.get("properties", {}).get("is_arrow_head") and not feat.get("properties", {}).get("is_arrow_wings")]
    processed_features = []
    arrow_features = []
    head_poly_features = []
    head_wing_features = []

    m_per_deg_lat = 111139.0
    import math
    m_per_deg_lon = 111139.0 * math.cos(49.26 * math.pi / 180.0)
    L_m = 9.5
    W_m = 5.8

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
                            "restrictions": active_restrictions
                        }
                    })

                    # 2. 向量幾何箭頭計算 (完全擺脫字型 PBF 限制，保證 WebGL 實體線段與填充 100% 渲染)
                    p_end = curve_pts[-1]
                    p_prev = curve_pts[-2]
                    dx_deg = p_end[0] - p_prev[0]
                    dy_deg = p_end[1] - p_prev[1]
                    dx_m = dx_deg * m_per_deg_lon
                    dy_m = dy_deg * m_per_deg_lat
                    len_m = math.hypot(dx_m, dy_m)

                    if len_m > 0.0001:
                        ux = dx_m / len_m
                        uy = dy_m / len_m
                        nx = -uy
                        ny = ux

                        tip_lon = round(p_end[0] + (1.2 * ux) / m_per_deg_lon, 7)
                        tip_lat = round(p_end[1] + (1.2 * uy) / m_per_deg_lat, 7)
                        base_lon = tip_lon - (L_m * ux) / m_per_deg_lon
                        base_lat = tip_lat - (L_m * uy) / m_per_deg_lat

                        w1_lon = round(base_lon + (W_m * nx) / m_per_deg_lon, 7)
                        w1_lat = round(base_lat + (W_m * ny) / m_per_deg_lat, 7)
                        w2_lon = round(base_lon - (W_m * nx) / m_per_deg_lon, 7)
                        w2_lat = round(base_lat - (W_m * ny) / m_per_deg_lat, 7)

                        tip = [tip_lon, tip_lat]
                        w1 = [w1_lon, w1_lat]
                        w2 = [w2_lon, w2_lat]

                        # 向量實體箭頭多邊形填充
                        head_poly_features.append({
                            "type": "Feature",
                            "id": f"{intersection_id}_head_{dir_code}",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[tip, w1, w2, tip]]
                            },
                            "properties": {
                                "id": f"{intersection_id}_head_{dir_code}",
                                "parent_id": intersection_id,
                                "name": sig_loc,
                                "signal_location": sig_loc,
                                "facility_type": "turn_restrictions",
                                "is_arrow_head": True,
                                "restrictions": active_restrictions
                            }
                        })

                        # 向量實體箭頭兩翼外框線
                        head_wing_features.append({
                            "type": "Feature",
                            "id": f"{intersection_id}_wings_{dir_code}",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [w1, tip, w2]
                            },
                            "properties": {
                                "id": f"{intersection_id}_wings_{dir_code}",
                                "parent_id": intersection_id,
                                "name": sig_loc,
                                "signal_location": sig_loc,
                                "facility_type": "turn_restrictions",
                                "is_arrow_wings": True,
                                "restrictions": active_restrictions
                            }
                        })

    all_features = processed_features + arrow_features + head_wing_features + head_poly_features
    save_layer_geojson("vancouver_traffic_turn_restrictions.geojson", all_features)
    print(f"✅ 轉向限制更新完成，共處理 {len(processed_features)} 處路口，生成 {len(arrow_features)} 條轉向軌跡線與 {len(head_poly_features)} 個向量箭頭。")
    return all_features

if __name__ == "__main__":
    update_traffic_turn_restrictions()
