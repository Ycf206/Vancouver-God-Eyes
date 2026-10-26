#!/usr/bin/env python3
"""
Automated updater for Vancouver Traffic Turn Restrictions dataset.
Decodes restrictions and formats explanations into properties.
"""

import os
import sys
import json
import re

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(CURRENT_DIR)
from base import save_layer_geojson, load_existing_geojson, BACKEND_DATA_DIR, FRONTEND_DATA_DIR

DIRECTION_MAP = {
    "EB": "東行 (Eastbound)",
    "WB": "西行 (Westbound)",
    "NB": "北行 (Northbound)",
    "SB": "南行 (Southbound)"
}

def decode_restriction_segment(text):
    if not text or text.lower() in ["none", "null", "-"]:
        return None
    s = text.strip().rstrip(",")
    if not s or s.lower() == "none":
        return None
    
    # Explanations
    # NLT -> 禁止左轉, NRT -> 禁止右轉, NRTOR -> 紅燈禁止右轉
    # ExBike -> 單車除外, ExBus -> 公車除外
    # M/F -> 週一至週五, F/Su -> 週五至週日
    # 7/930 -> 07:00 - 09:30, 3/6 -> 15:00 - 18:00, 9P/2A -> 21:00 - 02:00
    
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

def update_traffic_turn_restrictions():
    print("🔄 正在處理溫哥華路口轉向限制 (Traffic Turn Restrictions)...")
    source_path = os.path.join(BACKEND_DATA_DIR, "vancouver_traffic_turn_restrictions.geojson")
    if not os.path.exists(source_path):
        source_path = os.path.join(FRONTEND_DATA_DIR, "vancouver_traffic_turn_restrictions.geojson")
    
    if not os.path.exists(source_path):
        print(f"❌ 找不到轉向限制原始檔案: {source_path}")
        return []

    with open(source_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    processed_features = []

    for idx, f in enumerate(features):
        props = f.get("properties") or {}
        sig_loc = props.get("SIGNAL_LOCATION") or props.get("signal_location") or "路口"
        
        # Collect non-none restrictions
        active_restrictions = []
        
        fields = [
            ("LT_RESTRICTION", "全向左轉限制"),
            ("NBLT_RESTRICTION", "北行左轉限制 (NB)"),
            ("SBLT_RESTRICTION", "南行左轉限制 (SB)"),
            ("EBLT_RESTRICTION", "東行左轉限制 (EB)"),
            ("WBLT_RESTRICTION", "西行左轉限制 (WB)"),
            ("RT_RESTRICTION", "全向右轉限制"),
            ("NBRT_RESTRICTION", "北行右轉限制 (NB)"),
            ("SBRT_RESTRICTION", "南行右轉限制 (SB)"),
            ("EBRT_RESTRICTION", "東行右轉限制 (EB)"),
            ("WBRT_RESTRICTION", "西行右轉限制 (WB)")
        ]
        
        for k, label in fields:
            v = props.get(k)
            if v and str(v).strip().lower() not in ["none", "null", "-", ""]:
                lines = str(v).split("\n")
                for line in lines:
                    dec = decode_restriction_segment(line)
                    if dec:
                        active_restrictions.append({
                            "field": k,
                            "label": label,
                            "raw": line.strip(),
                            "decoded": dec
                        })

        new_props = {
            "id": f"turn_restriction_{idx+1}",
            "facility_type": "turn_restrictions",
            "name": sig_loc,
            "signal_location": sig_loc,
            "type": props.get("TYPE") or "Traffic Signal",
            "left_turn_bay": props.get("LEFT_TURN_BAY"),
            "right_turn_bay": props.get("RIGHT_TURN_BAY"),
            "has_restrictions": len(active_restrictions) > 0,
            "restrictions_count": len(active_restrictions),
            "restrictions": active_restrictions,
            "summary_text": "; ".join([r["decoded"] for r in active_restrictions]) if active_restrictions else "無特定轉向限制"
        }

        # Keep original uppercase keys too
        for k, v in props.items():
            if k not in new_props:
                new_props[k] = v

        processed_features.append({
            "type": "Feature",
            "id": f"turn_restriction_{idx+1}",
            "geometry": f.get("geometry"),
            "properties": new_props
        })

    save_layer_geojson("vancouver_traffic_turn_restrictions.geojson", processed_features)
    print(f"✅ 轉向限制更新完成，共處理 {len(processed_features)} 處路口。")
    return processed_features

if __name__ == "__main__":
    update_traffic_turn_restrictions()
