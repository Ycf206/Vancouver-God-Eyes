import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from opendata_explore_service import fetch_latest_dataset


def update_building_permits(target_count: int = 1000):
    """每 24 小時從溫哥華 OpenData v2.1 同步最新建築許可 (issued-building-permits) 資料快取。"""
    return fetch_latest_dataset("issued-building-permits", target_count=target_count)


if __name__ == "__main__":
    update_building_permits()
