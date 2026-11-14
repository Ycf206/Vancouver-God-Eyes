#!/usr/bin/env python3
"""
Update script for Vancouver International Airport (YVR) official live flight schedules.
Delegates to yvr_flights_service.update_yvr_flights().
"""

import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import yvr_flights_service

def main():
    print("🛫 [YVR Flights] 開始同步溫哥華國際機場官方即時航班資料...")
    res = yvr_flights_service.update_yvr_flights()
    arr_cnt = len(res.get("arrivals", []))
    dep_cnt = len(res.get("departures", []))
    print(f"✅ [YVR Flights] 同步完成: 抵達 {arr_cnt} 班, 出發 {dep_cnt} 班。")


def update_yvr_flights():
    return main()


if __name__ == "__main__":
    main()
