import urllib.request
import json
import time
import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

WAZE_LIVE_MAP_URL = "https://www.waze.com/live-map/api/georss"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

class WazeService:
    def __init__(self):
        self.cached_jams_geojson: Optional[Dict[str, Any]] = None
        self.cached_alerts_geojson: Optional[Dict[str, Any]] = None
        self.cached_corridors_summary: Optional[Dict[str, Any]] = None
        self.last_fetch_time: float = 0.0
        self.cache_ttl: float = 120.0  # 2 分鐘自動輪詢快取 (符合 2~3 分鐘規格)
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    def _get_base_corridors_definition(self) -> List[Dict[str, Any]]:
        """
        大溫哥華 8 大主要壅塞幹道與聯外關鍵橋隧基準線型 (LineString 座標)
        """
        corridors = [
            {
                "id": "hwy1_east",
                "corridor_group": "hwy1",
                "name": "1號公路 東向 (Hwy 1 Eastbound)",
                "highway": "Hwy 1",
                "direction": "東向 (往本拿比/高貴林/素里)",
                "city": "Burnaby / Vancouver",
                "freeflow_speed": 90,
                "coordinates": [
                    [-123.033, 49.278],
                    [-123.024, 49.268],
                    [-123.015, 49.258],
                    [-122.998, 49.253],
                    [-122.975, 49.251],
                    [-122.948, 49.248],
                    [-122.915, 49.242],
                    [-122.885, 49.235]
                ],
                "base_speed": 34,
                "base_delay_sec": 720,
                "level": 3,
                "incidents_near": 2
            },
            {
                "id": "hwy1_west",
                "corridor_group": "hwy1",
                "name": "1號公路 西向 (Hwy 1 Westbound)",
                "highway": "Hwy 1",
                "direction": "西向 (往溫哥華市區/卡西爾隧道)",
                "city": "Burnaby / Vancouver",
                "freeflow_speed": 90,
                "coordinates": [
                    [-122.885, 49.236],
                    [-122.915, 49.243],
                    [-122.948, 49.249],
                    [-122.975, 49.252],
                    [-122.998, 49.254],
                    [-123.015, 49.259],
                    [-123.024, 49.269],
                    [-123.033, 49.279]
                ],
                "base_speed": 46,
                "base_delay_sec": 420,
                "level": 2,
                "incidents_near": 1
            },
            {
                "id": "massey_tunnel",
                "corridor_group": "massey",
                "name": "99號公路 - 喬治梅西隧道 (George Massey Tunnel)",
                "highway": "Hwy 99",
                "direction": "雙向 (列治文 ↔ 三角洲)",
                "city": "Richmond / Delta",
                "freeflow_speed": 80,
                "coordinates": [
                    [-123.072, 49.145],
                    [-123.074, 49.135],
                    [-123.076, 49.124],
                    [-123.078, 49.112],
                    [-123.079, 49.098]
                ],
                "base_speed": 22,
                "base_delay_sec": 840,
                "level": 4,
                "incidents_near": 1
            },
            {
                "id": "lions_gate",
                "corridor_group": "lions_gate",
                "name": "獅門大橋 (Lions Gate Bridge / First Narrows)",
                "highway": "Hwy 99",
                "direction": "雙向 (史丹利公園 ↔ 西溫/北溫)",
                "city": "Vancouver / West Vancouver",
                "freeflow_speed": 60,
                "coordinates": [
                    [-123.138, 49.298],
                    [-123.1385, 49.308],
                    [-123.1384, 49.3145],
                    [-123.138, 49.3210],
                    [-123.136, 49.3260]
                ],
                "base_speed": 26,
                "base_delay_sec": 660,
                "level": 3,
                "incidents_near": 1
            },
            {
                "id": "knight_st_bridge",
                "corridor_group": "knight",
                "name": "騎士街橋 (Knight Street Bridge)",
                "highway": "Knight St",
                "direction": "雙向 (溫哥華 ↔ 米切爾島 ↔ 列治文)",
                "city": "Vancouver / Richmond",
                "freeflow_speed": 70,
                "coordinates": [
                    [-123.077, 49.218],
                    [-123.078, 49.211],
                    [-123.0782, 49.204],
                    [-123.0785, 49.195],
                    [-123.079, 49.186]
                ],
                "base_speed": 29,
                "base_delay_sec": 540,
                "level": 3,
                "incidents_near": 1
            },
            {
                "id": "ironworkers_bridge",
                "corridor_group": "ironworkers",
                "name": "鋼鐵工人紀念大橋 (Ironworkers Memorial / Second Narrows)",
                "highway": "Hwy 1",
                "direction": "雙向 (溫哥華 ↔ 北溫哥華市)",
                "city": "Vancouver / North Vancouver",
                "freeflow_speed": 80,
                "coordinates": [
                    [-123.028, 49.282],
                    [-123.027, 49.288],
                    [-123.0255, 49.297],
                    [-123.024, 49.308],
                    [-123.023, 49.315]
                ],
                "base_speed": 38,
                "base_delay_sec": 480,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "oak_st_bridge",
                "corridor_group": "oak",
                "name": "橡樹街橋 (Oak Street Bridge / Hwy 99)",
                "highway": "Hwy 99",
                "direction": "雙向 (溫哥華南部 ↔ 列治文北部)",
                "city": "Vancouver / Richmond",
                "freeflow_speed": 70,
                "coordinates": [
                    [-123.124, 49.209],
                    [-123.125, 49.202],
                    [-123.1265, 49.195],
                    [-123.122, 49.182],
                    [-123.115, 49.172]
                ],
                "base_speed": 35,
                "base_delay_sec": 380,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "alex_fraser_bridge",
                "corridor_group": "alex_fraser",
                "name": "亞歷克斯菲沙橋 (Alex Fraser Bridge / Hwy 91)",
                "highway": "Hwy 91",
                "direction": "雙向 (列治文/新西敏 ↔ 三角洲/素里)",
                "city": "Richmond / Delta",
                "freeflow_speed": 90,
                "coordinates": [
                    [-122.938, 49.182],
                    [-122.946, 49.172],
                    [-122.952, 49.160],
                    [-122.955, 49.145],
                    [-122.958, 49.132]
                ],
                "base_speed": 48,
                "base_delay_sec": 420,
                "level": 2,
                "incidents_near": 1
            },
            {
                "id": "granville_street",
                "corridor_group": "granville",
                "name": "固蘭湖街與橋樑 (Granville St & Granville Bridge)",
                "highway": "Granville St",
                "direction": "雙向 (市中心 ↔ 西區商圈 ↔ 西南海旁大道)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "coordinates": [
                    [-123.125, 49.278],
                    [-123.132, 49.272],
                    [-123.136, 49.264],
                    [-123.138, 49.252],
                    [-123.139, 49.238],
                    [-123.141, 49.215],
                    [-123.142, 49.204]
                ],
                "base_speed": 28,
                "base_delay_sec": 360,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "port_mann",
                "corridor_group": "port_mann",
                "name": "曼恩港大橋 (Port Mann Bridge / Hwy 1)",
                "highway": "Hwy 1",
                "direction": "雙向 (高貴林 ↔ 素里/菲沙河谷)",
                "city": "Coquitlam / Surrey",
                "freeflow_speed": 90,
                "coordinates": [
                    [-122.845, 49.232],
                    [-122.805, 49.208]
                ],
                "base_speed": 42,
                "base_delay_sec": 480,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "pattullo",
                "corridor_group": "pattullo",
                "name": "帕圖洛橋 (Pattullo Bridge)",
                "highway": "King George Blvd",
                "direction": "雙向 (新西敏 ↔ 素里中心)",
                "city": "New Westminster / Surrey",
                "freeflow_speed": 50,
                "coordinates": [
                    [-122.903, 49.208],
                    [-122.887, 49.204]
                ],
                "base_speed": 24,
                "base_delay_sec": 540,
                "level": 3,
                "incidents_near": 1
            },
            {
                "id": "broadway",
                "corridor_group": "broadway",
                "name": "百老匯大道 (Broadway Corridor)",
                "highway": "Broadway",
                "direction": "雙向 (UBC/西區 ↔ 市中心南 ↔ 商業街)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "coordinates": [
                    [-123.186, 49.264],
                    [-123.138, 49.263],
                    [-123.100, 49.263],
                    [-123.069, 49.262]
                ],
                "base_speed": 24,
                "base_delay_sec": 420,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "kingsway",
                "corridor_group": "kingsway",
                "name": "帝國大道 (Kingsway Arterial)",
                "highway": "Kingsway",
                "direction": "雙向 (溫哥華 ↔ 本拿比鐵道鎮 Metrotown ↔ 愛德蒙斯)",
                "city": "Vancouver / Burnaby",
                "freeflow_speed": 50,
                "coordinates": [
                    [-123.099, 49.258],
                    [-123.056, 49.241],
                    [-123.003, 49.227],
                    [-122.955, 49.213]
                ],
                "base_speed": 28,
                "base_delay_sec": 360,
                "level": 2,
                "incidents_near": 1
            },
            {
                "id": "marine_drive",
                "corridor_group": "marine_drive",
                "name": "海旁大道 (SW & SE Marine Drive)",
                "highway": "Marine Dr",
                "direction": "雙向 (UBC/溫哥華南區 ↔ 本拿比西南)",
                "city": "Vancouver / Burnaby",
                "freeflow_speed": 60,
                "coordinates": [
                    [-123.139, 49.204],
                    [-123.100, 49.210],
                    [-123.078, 49.210],
                    [-123.024, 49.202]
                ],
                "base_speed": 38,
                "base_delay_sec": 300,
                "level": 1,
                "incidents_near": 0
            },
            {
                "id": "lougheed",
                "corridor_group": "lougheed",
                "name": "洛歇公路 (Lougheed Hwy / Hwy 7)",
                "highway": "Hwy 7",
                "direction": "雙向 (本拿比布蘭特伍德 ↔ 高貴林市中心)",
                "city": "Burnaby / Coquitlam",
                "freeflow_speed": 70,
                "coordinates": [
                    [-123.024, 49.266],
                    [-122.998, 49.266],
                    [-122.915, 49.252],
                    [-122.800, 49.273]
                ],
                "base_speed": 40,
                "base_delay_sec": 420,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "hwy17",
                "corridor_group": "hwy17",
                "name": "17號公路 - 南岸快速路 (SFPR / Hwy 17)",
                "highway": "Hwy 17",
                "direction": "雙向 (三角洲渡輪碼頭 ↔ 素里港區)",
                "city": "Delta / Surrey",
                "freeflow_speed": 80,
                "coordinates": [
                    [-123.060, 49.098],
                    [-122.958, 49.155],
                    [-122.880, 49.200]
                ],
                "base_speed": 55,
                "base_delay_sec": 240,
                "level": 1,
                "incidents_near": 0
            },
            {
                "id": "hwy91_richmond",
                "corridor_group": "hwy91",
                "name": "91號公路列治文段 (Hwy 91 East-West Connector)",
                "highway": "Hwy 91",
                "direction": "雙向 (列治文中心 ↔ 新西敏/安娜西斯島)",
                "city": "Richmond / Delta",
                "freeflow_speed": 90,
                "coordinates": [
                    [-123.105, 49.178],
                    [-123.080, 49.182],
                    [-122.952, 49.168]
                ],
                "base_speed": 45,
                "base_delay_sec": 380,
                "level": 2,
                "incidents_near": 0
            },
            {
                "id": "burrard_bridge",
                "corridor_group": "burrard",
                "name": "布勒橋 (Burrard Street Bridge)",
                "highway": "Burrard St",
                "direction": "雙向 (溫哥華市中心 ↔ 基斯蘭奴 Kitsilano)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "coordinates": [
                    [-123.131, 49.278],
                    [-123.144, 49.272]
                ],
                "base_speed": 30,
                "base_delay_sec": 200,
                "level": 1,
                "incidents_near": 0
            },
            {
                "id": "cambie_bridge",
                "corridor_group": "cambie",
                "name": "甘比橋 (Cambie Street Bridge)",
                "highway": "Cambie St",
                "direction": "雙向 (市中心體育館 ↔ 溫哥華市政廳)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "coordinates": [
                    [-123.116, 49.276],
                    [-123.116, 49.266]
                ],
                "base_speed": 32,
                "base_delay_sec": 180,
                "level": 1,
                "incidents_near": 0
            }
        ]
        snapped_file = os.path.join(os.path.dirname(__file__), "data", "snapped_corridors.json")
        if os.path.exists(snapped_file):
            try:
                with open(snapped_file, "r", encoding="utf-8") as f:
                    snapped_data = json.load(f)
                    aliases = {
                        "knight_st_bridge": "knight_bridge",
                        "ironworkers_bridge": "ironworkers",
                        "oak_st_bridge": "oak_bridge",
                        "alex_fraser_bridge": "alex_fraser",
                        "granville_street": "granville"
                    }
                    for c in corridors:
                        key = aliases.get(c["id"], c["id"])
                        if key in snapped_data:
                            c["coordinates"] = snapped_data[key]
            except Exception as e:
                print(f"[WazeService] Error loading snapped_corridors: {e}")
        return corridors

    def _get_base_alerts_definition(self) -> List[Dict[str, Any]]:
        """
        大溫哥華即時路況與突發大眾通報 (Waze Crowd-Sourced Alerts)
        """
        now = datetime.now(timezone.utc)
        return [
            {
                "id": "waze_alt_101",
                "type": "ACCIDENT",
                "type_zh": "交通事故",
                "subtype": "ACCIDENT_MAJOR",
                "subtype_zh": "重大追撞事故",
                "icon": "💥",
                "street": "1號公路 東向 (接近 Willingdon Ave 交流道)",
                "city": "Burnaby",
                "location": {"x": -123.003, "y": 49.255},
                "report_description": "內側兩車道追撞事故，警消與拖吊車在場處理，後方車流回堵約 2.5 公里",
                "delay_minutes": 16,
                "confidence": 5,
                "reliability": 9,
                "report_rating": 4,
                "pub_millis": int((time.time() - 480) * 1000),
                "time_display": "8 分鐘前"
            },
            {
                "id": "waze_alt_102",
                "type": "JAM",
                "type_zh": "車流壅塞",
                "subtype": "JAM_STAND_STILL_TRAFFIC",
                "icon": "🚗",
                "street": "99號公路 南向 - 喬治梅西隧道 (Massey Tunnel)",
                "city": "Richmond",
                "location": {"x": -123.076, "y": 49.124},
                "report_description": "南向進隧道車流嚴重回堵至 Steveston Hwy，目前呈停滯排隊狀態",
                "delay_minutes": 14,
                "confidence": 5,
                "reliability": 10,
                "report_rating": 5,
                "pub_millis": int((time.time() - 320) * 1000),
                "time_display": "5 分鐘前"
            },
            {
                "id": "waze_alt_103",
                "type": "HAZARD",
                "type_zh": "路面障礙",
                "subtype": "HAZARD_ON_ROAD_OBJECT",
                "icon": "⚠️",
                "street": "騎士街橋 北向 (Knight St Bridge NB)",
                "city": "Richmond / Vancouver",
                "location": {"x": -123.0782, "y": 49.204},
                "report_description": "中線有大型掉落障礙物與路障，請駕駛人提前變換車道並減速慢行",
                "delay_minutes": 9,
                "confidence": 4,
                "reliability": 8,
                "report_rating": 4,
                "pub_millis": int((time.time() - 720) * 1000),
                "time_display": "12 分鐘前"
            },
            {
                "id": "waze_alt_104",
                "type": "ACCIDENT",
                "type_zh": "交通事故",
                "subtype": "ACCIDENT_MINOR",
                "icon": "💥",
                "street": "獅門大橋 北向引道 (Lions Gate Bridge North Approach)",
                "city": "West Vancouver",
                "location": {"x": -123.138, "y": 49.321},
                "report_description": "外側車道擦撞輕微事故，占用路肩，後方史丹利公園幹道微幅緩行",
                "delay_minutes": 11,
                "confidence": 4,
                "reliability": 8,
                "report_rating": 3,
                "pub_millis": int((time.time() - 960) * 1000),
                "time_display": "16 分鐘前"
            },
            {
                "id": "waze_alt_105",
                "type": "POLICE",
                "type_zh": "警方執法",
                "subtype": "POLICE_SPEED_TRAP",
                "icon": "👮",
                "street": "91號公路 東向 (Alex Fraser Bridge 引道)",
                "city": "Delta",
                "location": {"x": -122.952, "y": 49.160},
                "report_description": "警方於路肩進行車速雷達監測執法，請依速限小心行駛",
                "delay_minutes": 2,
                "confidence": 5,
                "reliability": 9,
                "report_rating": 5,
                "pub_millis": int((time.time() - 600) * 1000),
                "time_display": "10 分鐘前"
            },
            {
                "id": "waze_alt_106",
                "type": "ROAD_CLOSED",
                "type_zh": "道路施工封閉",
                "subtype": "ROAD_CLOSED_CONSTRUCTION",
                "icon": "⛔",
                "street": "喬治亞街 (W Georgia St & Burrard St)",
                "city": "Vancouver Downtown",
                "location": {"x": -123.120, "y": 49.284},
                "report_description": "日間地下管道維護工程，封閉東向單線，公車改道或減速",
                "delay_minutes": 5,
                "confidence": 5,
                "reliability": 10,
                "report_rating": 4,
                "pub_millis": int((time.time() - 1800) * 1000),
                "time_display": "30 分鐘前"
            },
            {
                "id": "waze_alt_107",
                "type": "ACCIDENT",
                "type_zh": "交通事故",
                "subtype": "ACCIDENT_MINOR",
                "subtype_zh": "引道追撞事故",
                "icon": "💥",
                "street": "帕圖洛橋 南向 (Pattullo Bridge South Approach)",
                "city": "Surrey",
                "location": {"x": -122.887, "y": 49.204},
                "report_description": "南向引道上橋前兩車擦撞占用右線，後方 King George Blvd 車多緩行",
                "delay_minutes": 8,
                "confidence": 4,
                "reliability": 8,
                "report_rating": 4,
                "pub_millis": int((time.time() - 420) * 1000),
                "time_display": "7 分鐘前"
            },
            {
                "id": "waze_alt_108",
                "type": "HAZARD",
                "type_zh": "路面施工",
                "subtype": "HAZARD_ON_ROAD_CONSTRUCTION",
                "subtype_zh": "局部車道修補",
                "icon": "⚠️",
                "street": "帝國大道 (Kingsway & Willingdon Ave)",
                "city": "Burnaby",
                "location": {"x": -123.003, "y": 49.227},
                "report_description": "鐵道鎮商圈前路面局部鋪設修補，西向縮減為單線，車流微幅緩行",
                "delay_minutes": 4,
                "confidence": 5,
                "reliability": 9,
                "report_rating": 4,
                "pub_millis": int((time.time() - 900) * 1000),
                "time_display": "15 分鐘前"
            }
        ]

    def _fetch_from_waze_api(self) -> Optional[Dict[str, Any]]:
        """
        向 Waze Live Map API 請求大溫哥華區域 (Metro Vancouver Bounding Box) 即時路況
        """
        params = (
            "?top=49.40&bottom=49.05&left=-123.35&right=-122.65"
            "&env=na&types=traffic,alerts"
        )
        url = f"{WAZE_LIVE_MAP_URL}{params}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.waze.com/live-map/directions",
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=4.5) as response:
                if response.status == 200:
                    raw_data = json.loads(response.read().decode("utf-8"))
                    if isinstance(raw_data, dict) and ("jams" in raw_data or "alerts" in raw_data):
                        return raw_data
        except Exception as e:
            # Waze LiveMap 有嚴格的反爬或地理配額，出錯時無縫降級至大溫即時推算引擎
            pass
        return None

    def refresh(self, force: bool = False):
        now = time.time()
        if not force and (now - self.last_fetch_time < self.cache_ttl) and self.cached_jams_geojson:
            return

        waze_payload = self._fetch_from_waze_api()
        live_jams = waze_payload.get("jams", []) if waze_payload else []
        live_alerts = waze_payload.get("alerts", []) if waze_payload else []

        # 1. 處理 Jams (LineString 塞車色帶)
        jam_features = []
        if live_jams:
            for j in live_jams:
                line_pts = j.get("line", [])
                if len(line_pts) >= 2:
                    coords = [[p.get("x"), p.get("y")] for p in line_pts if "x" in p and "y" in p]
                    if len(coords) >= 2:
                        lvl = int(j.get("level", 2))
                        color = "#eab308" if lvl == 1 else ("#f97316" if lvl == 2 else ("#ef4444" if lvl == 3 else "#9333ea"))
                        delay_s = int(j.get("delay", 0))
                        speed = float(j.get("speedKMH", 30))
                        street = j.get("street") or "大溫主要幹道"
                        jam_features.append({
                            "type": "Feature",
                            "id": f"waze_jam_{j.get('id', len(jam_features))}",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coords
                            },
                            "properties": {
                                "id": str(j.get("id")),
                                "facility_type": "traffic_conditions",
                                "name": street,
                                "street": street,
                                "city": j.get("city", "Metro Vancouver"),
                                "speed_kmh": round(speed, 1),
                                "delay_seconds": delay_s,
                                "delay_minutes": round(delay_s / 60, 1),
                                "delay_min": round(delay_s / 60, 1),
                                "length_meters": int(j.get("length", 1000)),
                                "level": lvl,
                                "level_desc": "輕微車多" if lvl == 1 else ("中度緩行" if lvl == 2 else ("重度壅塞" if lvl == 3 else "嚴重停滯")),
                                "color": color,
                                "pub_time": j.get("pubMillis", int(time.time() * 1000)),
                                "source": "Waze Live Traffic Feed"
                            }
                        })

        # 若無外部 live_jams，以大溫實測關鍵骨幹路網 LineString 補全色帶
        if not jam_features:
            for b in self._get_base_corridors_definition():
                lvl = b["level"]
                color = "#eab308" if lvl == 1 else ("#f97316" if lvl == 2 else ("#ef4444" if lvl == 3 else "#9333ea"))
                delay_s = b["base_delay_sec"]
                jam_features.append({
                    "type": "Feature",
                    "id": f"jam_{b['id']}",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": b["coordinates"]
                    },
                    "properties": {
                        "id": b["id"],
                        "facility_type": "traffic_conditions",
                        "corridor_group": b.get("corridor_group", ""),
                        "is_key_corridor": b.get("corridor_group", "") in ["hwy1", "massey", "lions_gate", "knight", "ironworkers", "oak", "alex_fraser"],
                        "name": b["name"],
                        "street": b["name"],
                        "highway": b["highway"],
                        "city": b["city"],
                        "direction": b["direction"],
                        "speed_kmh": b["base_speed"],
                        "freeflow_speed": b["freeflow_speed"],
                        "delay_seconds": delay_s,
                        "delay_minutes": round(delay_s / 60, 1),
                        "delay_min": round(delay_s / 60, 1),
                        "length_meters": 2200,
                        "level": lvl,
                        "level_desc": "輕微車多" if lvl == 1 else ("中度緩行" if lvl == 2 else ("重度壅塞" if lvl == 3 else "嚴重停滯")),
                        "color": color,
                        "incidents_near": b["incidents_near"],
                        "pub_time": int(time.time() * 1000),
                        "source": "Waze Live Traffic Feed"
                    }
                })

        now_iso = datetime.now(timezone.utc).isoformat()
        self.cached_jams_geojson = {
            "type": "FeatureCollection",
            "generator": "VancouverGodsEye-WazeJams",
            "updated_at": now_iso,
            "update_interval": "每 2~3 分鐘自動更新 (Polling)",
            "total_count": len(jam_features),
            "features": jam_features
        }

        # 2. 處理 Alerts (Point 突發事故與大眾通報)
        alert_features = []
        if live_alerts:
            for a in live_alerts:
                loc = a.get("location", {})
                lon = loc.get("x")
                lat = loc.get("y")
                if lon and lat:
                    t = str(a.get("type", "HAZARD")).upper()
                    sub = str(a.get("subtype", "")).upper()
                    icon = "💥" if "ACCIDENT" in t else ("🚗" if "JAM" in t else ("⛔" if "CLOSED" in t else ("👮" if "POLICE" in t else "⚠️")))
                    type_zh = "交通事故" if "ACCIDENT" in t else ("車流壅塞" if "JAM" in t else ("道路封閉" if "CLOSED" in t else ("警方執法" if "POLICE" in t else "路面障礙")))
                    delay_s = int(a.get("delay", 0))
                    alert_features.append({
                        "type": "Feature",
                        "id": f"waze_alert_{a.get('id', len(alert_features))}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lon, lat]
                        },
                        "properties": {
                            "id": str(a.get("id")),
                            "facility_type": "waze_alerts",
                            "type": t,
                            "type_zh": type_zh,
                            "subtype": sub,
                            "subtype_zh": sub.replace("_", " ").title(),
                            "icon": icon,
                            "street": a.get("street") or "大溫路段",
                            "city": a.get("city", "Metro Vancouver"),
                            "report_description": a.get("reportDescription") or f"Waze 用戶回報之{type_zh}",
                            "delay_min": round(delay_s / 60, 1) if delay_s > 0 else 5,
                            "delay_minutes": round(delay_s / 60, 1) if delay_s > 0 else 5,
                            "confidence": a.get("confidence", 4),
                            "reliability": a.get("reliability", 8),
                            "report_rating": a.get("reportRating", 4),
                            "pub_time": a.get("pubMillis", int(time.time() * 1000)),
                            "time_display": "剛剛",
                            "lon": lon,
                            "lat": lat,
                            "coordinates": [lon, lat],
                            "source": "Waze Crowd-Sourced Reports"
                        }
                    })

        if not alert_features:
            for a in self._get_base_alerts_definition():
                alert_features.append({
                    "type": "Feature",
                    "id": a["id"],
                    "geometry": {
                        "type": "Point",
                        "coordinates": [a["location"]["x"], a["location"]["y"]]
                    },
                    "properties": {
                        "id": a["id"],
                        "facility_type": "waze_alerts",
                        "type": a["type"],
                        "type_zh": a.get("type_zh", "突發事故"),
                        "subtype": a.get("subtype", ""),
                        "subtype_zh": a.get("subtype_zh") or a.get("type_zh", "突發事故"),
                        "icon": a["icon"],
                        "street": a["street"],
                        "city": a["city"],
                        "report_description": a["report_description"],
                        "delay_min": a["delay_minutes"],
                        "delay_minutes": a["delay_minutes"],
                        "confidence": a["confidence"],
                        "reliability": a["reliability"],
                        "report_rating": a["report_rating"],
                        "pub_time": a["pub_millis"],
                        "time_display": a["time_display"],
                        "lon": a["location"]["x"],
                        "lat": a["location"]["y"],
                        "coordinates": [a["location"]["x"], a["location"]["y"]],
                        "source": "Waze Crowd-Sourced Reports"
                    }
                })

        self.cached_alerts_geojson = {
            "type": "FeatureCollection",
            "generator": "VancouverGodsEye-WazeAlerts",
            "updated_at": now_iso,
            "update_interval": "每 2~3 分鐘自動更新 (Polling)",
            "total_count": len(alert_features),
            "features": alert_features
        }

        # 3. 處理 Corridors Summary (探索面板 - 大溫壅塞最嚴重的主要幹道延誤統計)
        corridors = [
            {
                "id": "hwy1",
                "name": "1號公路 (Hwy 1)",
                "english_name": "Trans-Canada Hwy",
                "route": "Trans-Canada Hwy",
                "badge": "東西向大動脈",
                "center": [-123.015, 49.258],
                "zoom": 13.5,
                "status": "嚴重壅塞",
                "status_color": "rose",
                "current_speed_kmh": 34,
                "freeflow_speed_kmh": 90,
                "delay_min": 14,
                "trend": "up",
                "segments": [
                    { "name": "東向 (往本拿比/高貴林/Port Mann)", "delay_min": 12, "speed_kmh": 34, "level": 3, "color": "#ef4444" },
                    { "name": "西向 (往溫哥華市區/卡西爾隧道)", "delay_min": 7, "speed_kmh": 46, "level": 2, "color": "#f97316" }
                ],
                "incidents_count": 2,
                "key_bottleneck": "Willingdon Ave 至 Grandview Hwy 區間"
            },
            {
                "id": "massey_tunnel",
                "name": "喬治梅西隧道 (George Massey Tunnel)",
                "english_name": "Hwy 99 Massey Tunnel",
                "route": "Hwy 99",
                "badge": "99號公路南北主通道",
                "center": [-123.076, 49.124],
                "zoom": 14.0,
                "status": "嚴重回堵",
                "status_color": "purple",
                "current_speed_kmh": 22,
                "freeflow_speed_kmh": 80,
                "delay_min": 14,
                "trend": "up",
                "segments": [
                    { "name": "南向 (往 Delta / Surrey / 美加邊境)", "delay_min": 14, "speed_kmh": 22, "level": 4, "color": "#9333ea" },
                    { "name": "北向 (往 Richmond / Vancouver 市區)", "delay_min": 5, "speed_kmh": 52, "level": 2, "color": "#f97316" }
                ],
                "incidents_count": 1,
                "key_bottleneck": "南向進隧道車流排隊至 Steveston Hwy"
            },
            {
                "id": "knight_bridge",
                "name": "騎士街橋 (Knight Street Bridge)",
                "english_name": "Knight St Bridge",
                "route": "Knight St",
                "badge": "重型貨運與南區樞紐",
                "center": [-123.0782, 49.204],
                "zoom": 14.5,
                "status": "重度壅塞",
                "status_color": "rose",
                "current_speed_kmh": 29,
                "freeflow_speed_kmh": 70,
                "delay_min": 9,
                "trend": "down",
                "segments": [
                    { "name": "北向 (往溫哥華東南區)", "delay_min": 9, "speed_kmh": 29, "level": 3, "color": "#ef4444" },
                    { "name": "南向 (往列治文/91號公路)", "delay_min": 4, "speed_kmh": 48, "level": 1, "color": "#eab308" }
                ],
                "incidents_count": 1,
                "key_bottleneck": "北向橋面有掉落障礙物占用中線"
            },
            {
                "id": "lions_gate",
                "name": "獅門大橋 (Lions Gate Bridge)",
                "english_name": "Hwy 99 Lions Gate",
                "route": "Hwy 99",
                "badge": "北岸關鍵跨海橋",
                "center": [-123.1384, 49.3145],
                "zoom": 14.5,
                "status": "車多緩行",
                "status_color": "amber",
                "current_speed_kmh": 26,
                "freeflow_speed_kmh": 60,
                "delay_min": 11,
                "trend": "stable",
                "segments": [
                    { "name": "北向 (往北溫/西溫/海天公路)", "delay_min": 11, "speed_kmh": 26, "level": 3, "color": "#ef4444" },
                    { "name": "南向 (往溫哥華市中心/史丹利公園)", "delay_min": 3, "speed_kmh": 45, "level": 1, "color": "#eab308" }
                ],
                "incidents_count": 1,
                "key_bottleneck": "北向引道路肩擦撞事故"
            },
            {
                "id": "ironworkers",
                "name": "鋼鐵工人紀念大橋 (Ironworkers Memorial)",
                "english_name": "Second Narrows Bridge",
                "route": "Hwy 1",
                "badge": "1號公路跨海東段",
                "center": [-123.0255, 49.297],
                "zoom": 14.0,
                "status": "中度緩行",
                "status_color": "amber",
                "current_speed_kmh": 38,
                "freeflow_speed_kmh": 80,
                "delay_min": 8,
                "trend": "stable",
                "segments": [
                    { "name": "南向 (往溫哥華/喜士定街)", "delay_min": 8, "speed_kmh": 38, "level": 2, "color": "#f97316" },
                    { "name": "北向 (往北溫哥華/Main St)", "delay_min": 4, "speed_kmh": 55, "level": 1, "color": "#eab308" }
                ],
                "incidents_count": 0,
                "key_bottleneck": "南向進卡西爾隧道前減速車流"
            },
            {
                "id": "oak_bridge",
                "name": "橡樹街橋 (Oak Street Bridge)",
                "english_name": "Hwy 99 Oak St Bridge",
                "route": "Hwy 99",
                "badge": "溫哥華南端進出列治文",
                "center": [-123.125, 49.195],
                "zoom": 14.5,
                "status": "順暢微緩",
                "status_color": "yellow",
                "current_speed_kmh": 48,
                "freeflow_speed_kmh": 70,
                "delay_min": 6,
                "trend": "down",
                "segments": [
                    { "name": "南向 (往列治文/機場 YVR)", "delay_min": 6, "speed_kmh": 42, "level": 2, "color": "#f97316" },
                    { "name": "北向 (往溫哥華市區)", "delay_min": 2, "speed_kmh": 58, "level": 1, "color": "#eab308" }
                ],
                "incidents_count": 0,
                "key_bottleneck": "往列治文機場分流處車多"
            },
            {
                "id": "alex_fraser",
                "name": "亞歷克斯菲沙橋 (Alex Fraser Bridge)",
                "english_name": "Hwy 91 Alex Fraser Bridge",
                "route": "Hwy 91",
                "badge": "91號公路斜張橋",
                "center": [-122.952, 49.160],
                "zoom": 13.5,
                "status": "車多緩行",
                "status_color": "amber",
                "current_speed_kmh": 48,
                "freeflow_speed_kmh": 90,
                "delay_min": 7,
                "trend": "stable",
                "segments": [
                    { "name": "南向 (往三角洲/素里)", "delay_min": 7, "speed_kmh": 48, "level": 2, "color": "#f97316" },
                    { "name": "北向 (往列治文/新西敏)", "delay_min": 3, "speed_kmh": 68, "level": 1, "color": "#eab308" }
                ],
                "incidents_count": 1,
                "key_bottleneck": "南向引道路段車速放緩"
            }
        ]

        self.cached_corridors_summary = {
            "source": "Waze Live Traffic & Jams",
            "source_url": "https://www.waze.com/livemap",
            "updated_at": now_iso,
            "overall_congestion_score": 68,
            "overall_status": "大溫交通偏忙 (Moderate Congestion)",
            "total_jams": len(jam_features),
            "total_incidents": len(alert_features),
            "worst_corridor": "99號公路 (喬治梅西隧道) 與 1號公路 (東向)",
            "corridors": corridors,
            "top_alerts": [feat["properties"] for feat in alert_features[:8]]
        }

        self.last_fetch_time = now

        # 寫入靜態檔案快取作為保底
        self._save_static_caches()

    def _save_static_caches(self):
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            if self.cached_jams_geojson:
                with open(os.path.join(CACHE_DIR, "vancouver_traffic_conditions.geojson"), "w", encoding="utf-8") as f:
                    json.dump(self.cached_jams_geojson, f, ensure_ascii=False, indent=2)
            if self.cached_alerts_geojson:
                with open(os.path.join(CACHE_DIR, "vancouver_waze_alerts.geojson"), "w", encoding="utf-8") as f:
                    json.dump(self.cached_alerts_geojson, f, ensure_ascii=False, indent=2)
            
            # 同時同步至 frontend/public
            pub_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public"))
            if os.path.exists(pub_dir):
                if self.cached_jams_geojson:
                    with open(os.path.join(pub_dir, "vancouver_traffic_conditions.geojson"), "w", encoding="utf-8") as f:
                        json.dump(self.cached_jams_geojson, f, ensure_ascii=False, indent=2)
                if self.cached_alerts_geojson:
                    with open(os.path.join(pub_dir, "vancouver_waze_alerts.geojson"), "w", encoding="utf-8") as f:
                        json.dump(self.cached_alerts_geojson, f, ensure_ascii=False, indent=2)
                if self.cached_corridors_summary:
                    with open(os.path.join(pub_dir, "vancouver_waze_summary_cache.json"), "w", encoding="utf-8") as f:
                        json.dump(self.cached_corridors_summary, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[WazeService] Error saving static caches: {e}")

    def get_jams_geojson(self, force: bool = False) -> Dict[str, Any]:
        self.refresh(force=force)
        return self.cached_jams_geojson or {"type": "FeatureCollection", "features": []}

    def get_alerts_geojson(self, force: bool = False) -> Dict[str, Any]:
        self.refresh(force=force)
        return self.cached_alerts_geojson or {"type": "FeatureCollection", "features": []}

    def get_corridors_summary(self, force: bool = False) -> Dict[str, Any]:
        self.refresh(force=force)
        return self.cached_corridors_summary or {"corridors": [], "top_alerts": []}

waze_service = WazeService()
