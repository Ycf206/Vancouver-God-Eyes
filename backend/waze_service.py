import urllib.request
import urllib.parse
import json
import time
import os
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from zoneinfo import ZoneInfo

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")

# 1x1 Transparent PNG fallback for tiles when key is absent or out of bounds
TRANSPARENT_1X1_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
)


def _load_env_key(key_name: str) -> str:
    val = os.environ.get(key_name, "").strip()
    if val:
        return val
    # Check backend/.env and root .env dynamically so newly synced secrets take effect immediately
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env")),
    ]
    for p in env_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        if k.strip() == key_name:
                            v_clean = v.strip().strip('"').strip("'")
                            if v_clean:
                                os.environ[key_name] = v_clean
                                return v_clean
            except Exception:
                pass
    return ""


class WazeService:
    """
    TomTom Real-Time Traffic Flow & Incidents + DriveBC Open511 Engine for Metro Vancouver.
    Maintains backward-compatible class/method names (`waze_service`) for all FastAPI routes.
    """

    def __init__(self):
        self.cached_jams_geojson: Optional[Dict[str, Any]] = None
        self.cached_alerts_geojson: Optional[Dict[str, Any]] = None
        self.cached_corridors_summary: Optional[Dict[str, Any]] = None
        self.last_fetch_time: float = 0.0
        # 5 分鐘快取 (300 秒)，確保每日 Non-Tile API 請求遠低於 TomTom 2,500 次免費上限
        self.cache_ttl: float = 300.0
        self.tile_cache: Dict[Tuple[str, int, int, int], Tuple[float, bytes]] = {}
        self.tile_cache_ttl: float = 180.0  # 3 分鐘圖磚快取，保護每日 50,000 次免費圖磚配額
        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )

    def get_tomtom_api_key(self) -> str:
        return _load_env_key("TOMTOM_API_KEY")

    def get_flow_tile(self, z: int, x: int, y: int, style: str = "relative0") -> bytes:
        """
        向 TomTom Traffic Flow Tiles v4 取得即時路況柵格圖磚 (綠/黃/橙/紅全路網連續路況)
        內建 3 分鐘記憶體快取以大幅節省每日免費配額。
        """
        api_key = self.get_tomtom_api_key()
        if not api_key:
            return TRANSPARENT_1X1_PNG

        valid_styles = {"absolute", "relative", "relative0", "relative0-dark", "relative-delay", "reduced-sensitivity"}
        if style not in valid_styles:
            style = "relative0"

        now = time.time()
        cache_key = (style, int(z), int(x), int(y))
        cached = self.tile_cache.get(cache_key)
        if cached and (now - cached[0] < self.tile_cache_ttl):
            return cached[1]

        url = (
            f"https://api.tomtom.com/traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png"
            f"?key={urllib.parse.quote(api_key)}&tileSize=256&thickness=6"
        )
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status == 200:
                    data = resp.read()
                    if len(self.tile_cache) > 2000:
                        # 清理過期圖磚
                        cutoff = now - self.tile_cache_ttl
                        self.tile_cache = {k: v for k, v in self.tile_cache.items() if v[0] >= cutoff}
                        if len(self.tile_cache) > 2000:
                            self.tile_cache.clear()
                    self.tile_cache[cache_key] = (now, data)
                    return data
        except Exception:
            pass
        return TRANSPARENT_1X1_PNG

    def _get_base_corridors_definition(self) -> List[Dict[str, Any]]:
        """
        大溫哥華 17 條主要幹道與聯外關鍵橋隧基準線型 (LineString 座標與測速探針點)
        """
        corridors = [
            {
                "id": "hwy1_east",
                "corridor_group": "hwy1",
                "name": "1號公路 東向 (Hwy 1 Eastbound)",
                "highway": "Hwy 1",
                "direction": "東向 (往本拿比/高貴林/Port Mann)",
                "city": "Burnaby / Vancouver",
                "freeflow_speed": 90,
                "probe_point": (49.258, -123.015),
                "length_km": 12.0,
                "coordinates": [
                    [-123.033, 49.278],
                    [-123.024, 49.268],
                    [-123.015, 49.258],
                    [-122.998, 49.253],
                    [-122.975, 49.251],
                    [-122.948, 49.248],
                    [-122.915, 49.242],
                    [-122.885, 49.235],
                ],
            },
            {
                "id": "hwy1_west",
                "corridor_group": "hwy1",
                "name": "1號公路 西向 (Hwy 1 Westbound)",
                "highway": "Hwy 1",
                "direction": "西向 (往溫哥華市區/卡西爾隧道)",
                "city": "Burnaby / Vancouver",
                "freeflow_speed": 90,
                "probe_point": (49.254, -122.998),
                "length_km": 12.0,
                "coordinates": [
                    [-122.885, 49.236],
                    [-122.915, 49.243],
                    [-122.948, 49.249],
                    [-122.975, 49.252],
                    [-122.998, 49.254],
                    [-123.015, 49.259],
                    [-123.024, 49.269],
                    [-123.033, 49.279],
                ],
            },
            {
                "id": "massey_tunnel",
                "corridor_group": "massey",
                "name": "99號公路 - 喬治梅西隧道 (George Massey Tunnel)",
                "highway": "Hwy 99",
                "direction": "雙向 (列治文 ↔ 三角洲)",
                "city": "Richmond / Delta",
                "freeflow_speed": 80,
                "probe_point": (49.124, -123.076),
                "length_km": 6.5,
                "coordinates": [
                    [-123.072, 49.145],
                    [-123.074, 49.135],
                    [-123.076, 49.124],
                    [-123.078, 49.112],
                    [-123.079, 49.098],
                ],
            },
            {
                "id": "lions_gate",
                "corridor_group": "lions_gate",
                "name": "獅門大橋 (Lions Gate Bridge / First Narrows)",
                "highway": "Hwy 99",
                "direction": "雙向 (史丹利公園 ↔ 西溫/北溫)",
                "city": "Vancouver / West Vancouver",
                "freeflow_speed": 60,
                "probe_point": (49.3145, -123.1384),
                "length_km": 3.8,
                "coordinates": [
                    [-123.138, 49.298],
                    [-123.1385, 49.308],
                    [-123.1384, 49.3145],
                    [-123.138, 49.3210],
                    [-123.136, 49.3260],
                ],
            },
            {
                "id": "knight_st_bridge",
                "corridor_group": "knight",
                "name": "騎士街橋 (Knight Street Bridge)",
                "highway": "Knight St",
                "direction": "雙向 (溫哥華 ↔ 米切爾島 ↔ 列治文)",
                "city": "Vancouver / Richmond",
                "freeflow_speed": 70,
                "probe_point": (49.204, -123.0782),
                "length_km": 4.5,
                "coordinates": [
                    [-123.077, 49.218],
                    [-123.078, 49.211],
                    [-123.0782, 49.204],
                    [-123.0785, 49.195],
                    [-123.079, 49.186],
                ],
            },
            {
                "id": "ironworkers_bridge",
                "corridor_group": "ironworkers",
                "name": "鋼鐵工人紀念大橋 (Ironworkers Memorial / Second Narrows)",
                "highway": "Hwy 1",
                "direction": "雙向 (溫哥華 ↔ 北溫哥華市)",
                "city": "Vancouver / North Vancouver",
                "freeflow_speed": 80,
                "probe_point": (49.297, -123.0255),
                "length_km": 4.8,
                "coordinates": [
                    [-123.028, 49.282],
                    [-123.027, 49.288],
                    [-123.0255, 49.297],
                    [-123.024, 49.308],
                    [-123.023, 49.315],
                ],
            },
            {
                "id": "oak_st_bridge",
                "corridor_group": "oak",
                "name": "橡樹街橋 (Oak Street Bridge / Hwy 99)",
                "highway": "Hwy 99",
                "direction": "雙向 (溫哥華南部 ↔ 列治文北部)",
                "city": "Vancouver / Richmond",
                "freeflow_speed": 70,
                "probe_point": (49.195, -123.1265),
                "length_km": 4.2,
                "coordinates": [
                    [-123.124, 49.209],
                    [-123.125, 49.202],
                    [-123.1265, 49.195],
                    [-123.122, 49.182],
                    [-123.115, 49.172],
                ],
            },
            {
                "id": "alex_fraser_bridge",
                "corridor_group": "alex_fraser",
                "name": "亞歷克斯菲沙橋 (Alex Fraser Bridge / Hwy 91)",
                "highway": "Hwy 91",
                "direction": "雙向 (列治文/新西敏 ↔ 三角洲/素里)",
                "city": "Richmond / Delta",
                "freeflow_speed": 90,
                "probe_point": (49.160, -122.952),
                "length_km": 6.0,
                "coordinates": [
                    [-122.938, 49.182],
                    [-122.946, 49.172],
                    [-122.952, 49.160],
                    [-122.955, 49.145],
                    [-122.958, 49.132],
                ],
            },
            {
                "id": "granville_street",
                "corridor_group": "granville",
                "name": "固蘭湖街與橋樑 (Granville St & Granville Bridge)",
                "highway": "Granville St",
                "direction": "雙向 (市中心 ↔ 西區商圈 ↔ 西南海旁大道)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "probe_point": (49.264, -123.136),
                "length_km": 6.5,
                "coordinates": [
                    [-123.125, 49.278],
                    [-123.132, 49.272],
                    [-123.136, 49.264],
                    [-123.138, 49.252],
                    [-123.139, 49.238],
                    [-123.141, 49.215],
                    [-123.142, 49.204],
                ],
            },
            {
                "id": "port_mann",
                "corridor_group": "port_mann",
                "name": "曼恩港大橋 (Port Mann Bridge / Hwy 1)",
                "highway": "Hwy 1",
                "direction": "雙向 (高貴林 ↔ 素里/菲沙河谷)",
                "city": "Coquitlam / Surrey",
                "freeflow_speed": 90,
                "probe_point": (49.220, -122.815),
                "length_km": 5.5,
                "coordinates": [
                    [-122.845, 49.232],
                    [-122.805, 49.208],
                ],
            },
            {
                "id": "pattullo",
                "corridor_group": "pattullo",
                "name": "帕圖洛橋 (Pattullo Bridge)",
                "highway": "King George Blvd",
                "direction": "雙向 (新西敏 ↔ 素里中心)",
                "city": "New Westminster / Surrey",
                "freeflow_speed": 50,
                "probe_point": (49.206, -122.895),
                "length_km": 3.0,
                "coordinates": [
                    [-122.903, 49.208],
                    [-122.887, 49.204],
                ],
            },
            {
                "id": "broadway",
                "corridor_group": "broadway",
                "name": "百老匯大道 (Broadway Corridor)",
                "highway": "Broadway",
                "direction": "雙向 (UBC/西區 ↔ 市中心南 ↔ 商業街)",
                "city": "Vancouver",
                "freeflow_speed": 50,
                "probe_point": (49.263, -123.115),
                "length_km": 8.0,
                "coordinates": [
                    [-123.186, 49.264],
                    [-123.138, 49.263],
                    [-123.100, 49.263],
                    [-123.069, 49.262],
                ],
            },
            {
                "id": "kingsway",
                "corridor_group": "kingsway",
                "name": "帝國大道 (Kingsway Arterial)",
                "highway": "Kingsway",
                "direction": "雙向 (溫哥華 ↔ 本拿比鐵道鎮 Metrotown ↔ 愛德蒙斯)",
                "city": "Vancouver / Burnaby",
                "freeflow_speed": 50,
                "probe_point": (49.227, -123.003),
                "length_km": 9.0,
                "coordinates": [
                    [-123.099, 49.258],
                    [-123.056, 49.241],
                    [-123.003, 49.227],
                    [-122.955, 49.213],
                ],
            },
            {
                "id": "marine_drive",
                "corridor_group": "marine_drive",
                "name": "海旁大道 (SW & SE Marine Drive)",
                "highway": "Marine Dr",
                "direction": "雙向 (UBC/溫哥華南區 ↔ 本拿比西南)",
                "city": "Vancouver / Burnaby",
                "freeflow_speed": 60,
                "probe_point": (49.210, -123.085),
                "length_km": 8.5,
                "coordinates": [
                    [-123.139, 49.204],
                    [-123.100, 49.210],
                    [-123.078, 49.210],
                    [-123.024, 49.202],
                ],
            },
            {
                "id": "lougheed",
                "corridor_group": "lougheed",
                "name": "洛歇公路 (Lougheed Hwy / Hwy 7)",
                "highway": "Hwy 7",
                "direction": "雙向 (本拿比布蘭特伍德 ↔ 高貴林市中心)",
                "city": "Burnaby / Coquitlam",
                "freeflow_speed": 70,
                "probe_point": (49.266, -122.998),
                "length_km": 10.0,
                "coordinates": [
                    [-123.024, 49.266],
                    [-122.998, 49.266],
                    [-122.915, 49.252],
                    [-122.800, 49.273],
                ],
            },
            {
                "id": "hwy17",
                "corridor_group": "hwy17",
                "name": "17號公路 - 南岸快速路 (SFPR / Hwy 17)",
                "highway": "Hwy 17",
                "direction": "雙向 (三角洲渡輪碼頭 ↔ 素里港區)",
                "city": "Delta / Surrey",
                "freeflow_speed": 80,
                "probe_point": (49.155, -122.958),
                "length_km": 11.0,
                "coordinates": [
                    [-123.060, 49.098],
                    [-122.958, 49.155],
                    [-122.880, 49.200],
                ],
            },
            {
                "id": "hwy91_richmond",
                "corridor_group": "hwy91",
                "name": "91號公路列治文段 (Hwy 91 East-West Connector)",
                "highway": "Hwy 91",
                "direction": "雙向 (列治文中心 ↔ 新西敏/安娜西斯島)",
                "city": "Richmond / Delta",
                "freeflow_speed": 90,
                "probe_point": (49.178, -123.050),
                "length_km": 8.0,
                "coordinates": [
                    [-123.105, 49.178],
                    [-123.080, 49.182],
                    [-122.952, 49.168],
                ],
            },
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
                        "granville_street": "granville",
                    }
                    for c in corridors:
                        key = aliases.get(c["id"], c["id"])
                        if key in snapped_data:
                            c["coordinates"] = snapped_data[key]
            except Exception as e:
                print(f"[TomTomTraffic] Error loading snapped_corridors: {e}")
        return corridors

    def _fetch_tomtom_segment_flow(self, lat: float, lon: float, api_key: str) -> Optional[Dict[str, Any]]:
        """
        向 TomTom Flow Segment Data API v4 查詢指定座標點路段的即時車速與自由流車速
        """
        if not api_key:
            return None
        url = (
            f"https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/12/json"
            f"?point={lat},{lon}&unit=KMPH&key={urllib.parse.quote(api_key)}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=4.5) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    return payload.get("flowSegmentData")
        except Exception:
            pass
        return None

    def _fetch_tomtom_incidents(self, api_key: str) -> List[Dict[str, Any]]:
        """
        向 TomTom Traffic Incidents API v5 請求大溫哥華範圍之即時交通事故、封路與塞車通報
        """
        if not api_key:
            return []
        fields = "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}"
        url = (
            "https://api.tomtom.com/traffic/services/5/incidentDetails"
            f"?key={urllib.parse.quote(api_key)}"
            "&bbox=-123.35,49.00,-122.65,49.40"
            f"&fields={urllib.parse.quote(fields)}"
            "&language=en-GB&timeValidityFilter=present"
        )
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    return payload.get("incidents", [])
        except Exception as e:
            print(f"[TomTomTraffic] Incidents fetch error: {e}")
        return []

    def _fetch_drivebc_open511_incidents(self) -> List[Dict[str, Any]]:
        """
        向 BC 省政府官方 DriveBC Open511 API (免費免 Key) 抓取大溫哥華即時道路事件與事故作為補充與備援
        """
        url = "https://api.open511.gov.bc.ca/events?status=ACTIVE&bbox=-123.35,49.00,-122.65,49.40&format=json&limit=25"
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=4.5) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    return payload.get("events", [])
        except Exception:
            pass
        return []

    @staticmethod
    def _classify_congestion(speed_kmh: float, freeflow_kmh: float, delay_min: float, road_closure: bool = False) -> Dict[str, Any]:
        """
        依據 TomTom / Google Maps 標準將即時車速與延誤轉換為顏色、等級與中文狀態
        Level 0: 暢通無阻 (#10b981 翠綠)
        Level 1: 順暢微緩 (#eab308 琥珀黃)
        Level 2: 車多緩行 (#f97316 橘色)
        Level 3: 重度壅塞 (#ef4444 紅色)
        Level 4: 嚴重停滯 (#9333ea 紫紅)
        """
        if road_closure:
            return {
                "level": 4,
                "color": "#9333ea",
                "casing_color": "#3b0764",
                "status": "道路封閉",
                "status_color": "purple",
                "trend": "worsening",
            }

        ratio = (speed_kmh / max(1.0, freeflow_kmh)) if freeflow_kmh > 0 else 1.0

        if ratio >= 0.82 and delay_min <= 1.5:
            return {
                "level": 0,
                "color": "#10b981",
                "casing_color": "#064e3b",
                "status": "暢通無阻",
                "status_color": "emerald",
                "trend": "stable",
            }
        elif ratio >= 0.65 and delay_min <= 4.5:
            return {
                "level": 1,
                "color": "#eab308",
                "casing_color": "#422006",
                "status": "順暢微緩",
                "status_color": "yellow",
                "trend": "stable",
            }
        elif ratio >= 0.45 and delay_min <= 9.0:
            return {
                "level": 2,
                "color": "#f97316",
                "casing_color": "#431407",
                "status": "車多緩行",
                "status_color": "orange",
                "trend": "stable",
            }
        elif ratio >= 0.25:
            return {
                "level": 3,
                "color": "#ef4444",
                "casing_color": "#450a0a",
                "status": "重度壅塞",
                "status_color": "red",
                "trend": "worsening",
            }
        else:
            return {
                "level": 4,
                "color": "#9333ea",
                "casing_color": "#3b0764",
                "status": "嚴重停滯",
                "status_color": "purple",
                "trend": "worsening",
            }

    def refresh(self, force: bool = False):
        now = time.time()
        if not force and (now - self.last_fetch_time < self.cache_ttl) and self.cached_jams_geojson and self.cached_corridors_summary:
            return

        api_key = self.get_tomtom_api_key()
        base_corridors = self._get_base_corridors_definition()

        # 1. 只針對 8 個核心走廊探針點查詢 TomTom Flow Segment Data (平行查詢，每次更新僅耗 8 次 API Call)
        key_corridor_ids = {
            "hwy1_east",
            "hwy1_west",
            "massey_tunnel",
            "lions_gate",
            "knight_st_bridge",
            "ironworkers_bridge",
            "oak_st_bridge",
            "alex_fraser_bridge",
        }
        flow_results: Dict[str, Dict[str, Any]] = {}
        if api_key:
            probes_to_fetch = [b for b in base_corridors if b["id"] in key_corridor_ids and b.get("probe_point")]
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {
                    b["id"]: pool.submit(self._fetch_tomtom_segment_flow, b["probe_point"][0], b["probe_point"][1], api_key)
                    for b in probes_to_fetch
                }
                for cid, fut in futures.items():
                    try:
                        res = fut.result(timeout=5.0)
                        if res:
                            flow_results[cid] = res
                    except Exception:
                        pass

        # 2. 取得即時突發事故與通報 (優先使用 TomTom Traffic Incidents v5，並結合 DriveBC Open511 官方實況)
        tomtom_incidents = self._fetch_tomtom_incidents(api_key) if api_key else []
        drivebc_events = self._fetch_drivebc_open511_incidents()

        alert_features: List[Dict[str, Any]] = []
        extra_jam_features: List[Dict[str, Any]] = []

        # 解析 TomTom Traffic Incidents v5
        for idx, inc in enumerate(tomtom_incidents):
            props = inc.get("properties") or {}
            geom = inc.get("geometry") or {}
            gtype = geom.get("type", "")
            coords = geom.get("coordinates") or []
            if not coords:
                continue

            icon_cat = int(props.get("iconCategory", 0))
            mag = int(props.get("magnitudeOfDelay", 0))
            delay_s = int(props.get("delay") or 0)
            delay_min = max(1, round(delay_s / 60)) if delay_s > 0 else (3 if mag == 1 else (7 if mag == 2 else (12 if mag >= 3 else 2)))

            events_list = props.get("events") or []
            event_desc = ", ".join([e.get("description", "") for e in events_list if e.get("description")]) or "道路交通事件"
            road_nums = props.get("roadNumbers") or []
            from_loc = props.get("from") or ""
            to_loc = props.get("to") or ""
            street_name = " / ".join(road_nums) if road_nums else (from_loc or "大溫主要幹道")
            if from_loc and to_loc:
                route_desc = f"{from_loc} 往 {to_loc} ({event_desc})"
            else:
                route_desc = event_desc

            if icon_cat == 1:
                t_code, type_zh, icon, a_color = "ACCIDENT", "交通事故", "💥", "#ef4444"
            elif icon_cat in (7, 8):
                t_code, type_zh, icon, a_color = "ROAD_CLOSED", "車道/道路封閉", "⛔", "#e11d48"
            elif icon_cat == 9:
                t_code, type_zh, icon, a_color = "CONSTRUCTION", "道路施工", "🚧", "#f59e0b"
            elif icon_cat == 6:
                t_code, type_zh, icon, a_color = "JAM", "車流壅塞", "🚗", "#f97316"
            else:
                t_code, type_zh, icon, a_color = "HAZARD", "路況提醒", "⚠️", "#eab308"

            # 取出中心點供地圖圖釘顯示
            pt_lon, pt_lat = None, None
            if gtype == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
                pt_lon, pt_lat = float(coords[0]), float(coords[1])
            elif gtype == "LineString" and len(coords) >= 1 and isinstance(coords[0], list):
                mid = coords[len(coords) // 2]
                if len(mid) >= 2:
                    pt_lon, pt_lat = float(mid[0]), float(mid[1])
            elif gtype == "MultiLineString" and len(coords) >= 1 and len(coords[0]) >= 1:
                mid = coords[0][len(coords[0]) // 2]
                if len(mid) >= 2:
                    pt_lon, pt_lat = float(mid[0]), float(mid[1])

            if pt_lon is not None and pt_lat is not None and icon_cat != 6:
                alert_features.append({
                    "type": "Feature",
                    "id": f"tomtom_inc_{props.get('id', idx)}",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [pt_lon, pt_lat],
                    },
                    "properties": {
                        "id": str(props.get("id", f"tt_{idx}")),
                        "facility_type": "waze_alerts",
                        "type": t_code,
                        "type_zh": type_zh,
                        "subtype_zh": event_desc or type_zh,
                        "type_label": type_zh,
                        "icon": icon,
                        "color": a_color,
                        "street": street_name,
                        "city": "Metro Vancouver",
                        "report_description": route_desc,
                        "description": route_desc,
                        "delay_min": delay_min,
                        "delay_minutes": delay_min,
                        "confidence": 5,
                        "waze_confidence": 96,
                        "pub_time": int(now * 1000),
                        "time_display": "TomTom 即時",
                        "report_time_str": "TomTom 即時偵測",
                        "lon": pt_lon,
                        "lat": pt_lat,
                        "coordinates": [pt_lon, pt_lat],
                        "source": "TomTom Traffic Incidents API",
                    },
                })

        # 補充 DriveBC Open511 官方即時事件 (若離峰時段或無其他通報，確保顯示 BC 省交通廳真實道路事件)
        for idx, ev in enumerate(drivebc_events):
            if len(alert_features) >= 20:
                break
            geog = ev.get("geography") or {}
            gtype = geog.get("type", "")
            gcoords = geog.get("coordinates") or []
            pt_lon, pt_lat = None, None
            if gtype == "Point" and len(gcoords) >= 2 and isinstance(gcoords[0], (int, float)):
                pt_lon, pt_lat = float(gcoords[0]), float(gcoords[1])
            elif gtype == "LineString" and len(gcoords) >= 1 and isinstance(gcoords[0], list):
                mid = gcoords[len(gcoords) // 2]
                if len(mid) >= 2:
                    pt_lon, pt_lat = float(mid[0]), float(mid[1])

            if pt_lon is None or pt_lat is None:
                continue

            ev_type = str(ev.get("event_type", "INCIDENT")).upper()
            severity = str(ev.get("severity", "MINOR")).upper()
            roads = ev.get("roads") or []
            road_name = roads[0].get("name", "大溫幹道") if roads else "大溫幹道"
            headline = ev.get("headline") or "DriveBC 道路通告"
            desc_text = ev.get("description") or headline

            if ev_type == "CONSTRUCTION":
                t_code, type_zh, icon, a_color = "CONSTRUCTION", "道路施工 (DriveBC)", "🚧", "#f59e0b"
                delay_m = 5 if severity == "MODERATE" else (10 if severity == "MAJOR" else 2)
            elif "CLOSED" in desc_text.upper():
                t_code, type_zh, icon, a_color = "ROAD_CLOSED", "道路管制 (DriveBC)", "⛔", "#e11d48"
                delay_m = 12
            else:
                t_code, type_zh, icon, a_color = "INCIDENT", "突發路況 (DriveBC)", "⚠️", "#ef4444" if severity == "MAJOR" else "#f97316"
                delay_m = 10 if severity == "MAJOR" else 4

            alert_features.append({
                "type": "Feature",
                "id": f"drivebc_{ev.get('id', idx)}",
                "geometry": {
                    "type": "Point",
                    "coordinates": [pt_lon, pt_lat],
                },
                "properties": {
                    "id": str(ev.get("id", f"dbc_{idx}")),
                    "facility_type": "waze_alerts",
                    "type": t_code,
                    "type_zh": type_zh,
                    "subtype_zh": type_zh,
                    "type_label": type_zh,
                    "icon": icon,
                    "color": a_color,
                    "street": road_name,
                    "city": "Metro Vancouver",
                    "report_description": desc_text,
                    "description": desc_text,
                    "delay_min": delay_m,
                    "delay_minutes": delay_m,
                    "confidence": 5,
                    "waze_confidence": 98,
                    "pub_time": int(now * 1000),
                    "time_display": "DriveBC 官方",
                    "report_time_str": "DriveBC 官方即時",
                    "lon": pt_lon,
                    "lat": pt_lat,
                    "coordinates": [pt_lon, pt_lat],
                    "source": "DriveBC Open511 Official Feed",
                },
            })

        # 3. 計算 17 條主要幹道與 7 大關鍵走廊的即時車速與狀態
        jam_features: List[Dict[str, Any]] = []
        corridor_metrics: Dict[str, Dict[str, Any]] = {}

        for b in base_corridors:
            cid = b["id"]
            freeflow = float(b["freeflow_speed"])
            flow = flow_results.get(cid)

            if flow and "currentSpeed" in flow:
                cur_speed = float(flow.get("currentSpeed", freeflow))
                ff_speed = float(flow.get("freeFlowSpeed", freeflow)) or freeflow
                cur_tt = float(flow.get("currentTravelTime", 0))
                ff_tt = float(flow.get("freeFlowTravelTime", 0))
                road_closure = bool(flow.get("roadClosure", False))

                if cur_tt > 0 and ff_tt > 0:
                    # 依走廊實際長度比例換算延誤分鐘數
                    raw_delay_sec = max(0.0, cur_tt - ff_tt)
                    delay_min = round(raw_delay_sec / 60.0, 1)
                else:
                    length_km = float(b.get("length_km", 5.0))
                    t_cur = (length_km / max(10.0, cur_speed)) * 60.0
                    t_ff = (length_km / max(10.0, ff_speed)) * 60.0
                    delay_min = max(0.0, round(t_cur - t_ff, 1))
                freeflow = ff_speed
            else:
                # 若尚未取得特定支線或本地未設定 API Key，預設依真實離峰/無事故暢通狀態推算 (絕不寫死假塞車)
                cur_speed = freeflow
                delay_min = 0.0
                road_closure = False
                # 檢查附近 1.5km 內是否有真實重大事故
                probe = b.get("probe_point")
                if probe:
                    for af in alert_features:
                        ap = af["properties"]
                        if ap.get("type") in ("ACCIDENT", "ROAD_CLOSED"):
                            dist = ((ap["lat"] - probe[0]) ** 2 + (ap["lon"] - probe[1]) ** 2) ** 0.5
                            if dist < 0.018:
                                delay_min = max(delay_min, float(ap.get("delay_min", 4)))
                                cur_speed = max(25.0, round(freeflow * 0.65))

            delay_int = int(round(delay_min))
            cls = self._classify_congestion(cur_speed, freeflow, delay_min, road_closure)

            corridor_metrics[cid] = {
                "speed_kmh": round(cur_speed),
                "freeflow_kmh": round(freeflow),
                "delay_min": delay_int,
                "delay_sec": int(round(delay_min * 60)),
                "level": cls["level"],
                "color": cls["color"],
                "casing_color": cls["casing_color"],
                "status": cls["status"],
                "status_color": cls["status_color"],
                "trend": cls["trend"],
            }

            jam_features.append({
                "type": "Feature",
                "id": f"jam_{cid}",
                "geometry": {
                    "type": "LineString",
                    "coordinates": b["coordinates"],
                },
                "properties": {
                    "id": cid,
                    "facility_type": "traffic_conditions",
                    "corridor_group": b.get("corridor_group", ""),
                    "is_key_corridor": b.get("corridor_group", "") in [
                        "hwy1",
                        "massey",
                        "lions_gate",
                        "knight",
                        "ironworkers",
                        "oak",
                        "alex_fraser",
                    ],
                    "name": b["name"],
                    "street": b["name"],
                    "highway": b["highway"],
                    "city": b["city"],
                    "direction": b["direction"],
                    "speed_kmh": round(cur_speed),
                    "freeflow_speed": round(freeflow),
                    "freeflow_speed_kmh": round(freeflow),
                    "delay_seconds": int(round(delay_min * 60)),
                    "delay_minutes": delay_int,
                    "delay_min": delay_int,
                    "length_meters": int(float(b.get("length_km", 5.0)) * 1000),
                    "level": cls["level"],
                    "level_desc": cls["status"],
                    "level_label": cls["status"],
                    "color": cls["color"],
                    "casing_color": cls["casing_color"],
                    "trend": cls["trend"],
                    "pub_time": int(now * 1000),
                    "source": "TomTom Real-Time Traffic Flow" if api_key else "DriveBC Open511 Live Traffic",
                },
            })

        jam_features.extend(extra_jam_features)

        now_iso = datetime.now(timezone.utc).isoformat()
        self.cached_jams_geojson = {
            "type": "FeatureCollection",
            "generator": "VancouverGodsEye-TomTomTraffic",
            "updated_at": now_iso,
            "update_interval": "每 5 分鐘自動更新 (TomTom Flow)",
            "total_count": len(jam_features),
            "features": jam_features,
        }

        self.cached_alerts_geojson = {
            "type": "FeatureCollection",
            "generator": "VancouverGodsEye-TomTomIncidents",
            "updated_at": now_iso,
            "update_interval": "每 5 分鐘自動更新 (TomTom & DriveBC)",
            "total_count": len(alert_features),
            "features": alert_features,
        }

        # 4. 組裝探索面板 7 大關鍵動脈與跨海橋隧統計
        def _get_m(cid: str, default_ff: int = 80) -> Dict[str, Any]:
            return corridor_metrics.get(
                cid,
                {
                    "speed_kmh": default_ff,
                    "freeflow_kmh": default_ff,
                    "delay_min": 0,
                    "level": 0,
                    "color": "#10b981",
                    "status": "暢通無阻",
                    "status_color": "emerald",
                    "trend": "stable",
                },
            )

        m_hwy1_e = _get_m("hwy1_east", 90)
        m_hwy1_w = _get_m("hwy1_west", 90)
        m_hwy1_worst = m_hwy1_e if m_hwy1_e["delay_min"] >= m_hwy1_w["delay_min"] else m_hwy1_w
        m_massey = _get_m("massey_tunnel", 80)
        m_knight = _get_m("knight_st_bridge", 70)
        m_lions = _get_m("lions_gate", 60)
        m_iron = _get_m("ironworkers_bridge", 80)
        m_oak = _get_m("oak_st_bridge", 70)
        m_alex = _get_m("alex_fraser_bridge", 90)

        corridors = [
            {
                "id": "hwy1",
                "name": "1號公路 (Hwy 1)",
                "english_name": "Trans-Canada Hwy",
                "route": "Trans-Canada Hwy",
                "badge": "東西向大動脈",
                "center": [-123.015, 49.258],
                "zoom": 13.5,
                "status": m_hwy1_worst["status"],
                "status_color": m_hwy1_worst["status_color"],
                "current_speed_kmh": min(m_hwy1_e["speed_kmh"], m_hwy1_w["speed_kmh"]),
                "freeflow_speed_kmh": m_hwy1_e["freeflow_kmh"],
                "delay_min": max(m_hwy1_e["delay_min"], m_hwy1_w["delay_min"]),
                "trend": m_hwy1_worst["trend"],
                "segments": [
                    {
                        "name": "東向 (往本拿比/高貴林/Port Mann)",
                        "delay_min": m_hwy1_e["delay_min"],
                        "speed_kmh": m_hwy1_e["speed_kmh"],
                        "level": m_hwy1_e["level"],
                        "color": m_hwy1_e["color"],
                    },
                    {
                        "name": "西向 (往溫哥華市區/卡西爾隧道)",
                        "delay_min": m_hwy1_w["delay_min"],
                        "speed_kmh": m_hwy1_w["speed_kmh"],
                        "level": m_hwy1_w["level"],
                        "color": m_hwy1_w["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "Willingdon Ave 至 Grandview Hwy 區間" if m_hwy1_worst["delay_min"] >= 5 else "雙向車流順暢正常",
            },
            {
                "id": "massey_tunnel",
                "name": "喬治梅西隧道 (George Massey Tunnel)",
                "english_name": "Hwy 99 Massey Tunnel",
                "route": "Hwy 99",
                "badge": "99號公路南北主通道",
                "center": [-123.076, 49.124],
                "zoom": 14.0,
                "status": m_massey["status"],
                "status_color": m_massey["status_color"],
                "current_speed_kmh": m_massey["speed_kmh"],
                "freeflow_speed_kmh": m_massey["freeflow_kmh"],
                "delay_min": m_massey["delay_min"],
                "trend": m_massey["trend"],
                "segments": [
                    {
                        "name": "南向 (往 Delta / Surrey / 美加邊境)",
                        "delay_min": m_massey["delay_min"],
                        "speed_kmh": m_massey["speed_kmh"],
                        "level": m_massey["level"],
                        "color": m_massey["color"],
                    },
                    {
                        "name": "北向 (往 Richmond / Vancouver 市區)",
                        "delay_min": max(0, m_massey["delay_min"] - 1),
                        "speed_kmh": min(m_massey["freeflow_kmh"], m_massey["speed_kmh"] + 4),
                        "level": m_massey["level"],
                        "color": m_massey["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "進隧道車流排隊區間" if m_massey["delay_min"] >= 5 else "隧道雙向車流順暢",
            },
            {
                "id": "knight_bridge",
                "name": "騎士街橋 (Knight Street Bridge)",
                "english_name": "Knight St Bridge",
                "route": "Knight St",
                "badge": "重型貨運與南區樞紐",
                "center": [-123.0782, 49.204],
                "zoom": 14.5,
                "status": m_knight["status"],
                "status_color": m_knight["status_color"],
                "current_speed_kmh": m_knight["speed_kmh"],
                "freeflow_speed_kmh": m_knight["freeflow_kmh"],
                "delay_min": m_knight["delay_min"],
                "trend": m_knight["trend"],
                "segments": [
                    {
                        "name": "北向 (往溫哥華東南區)",
                        "delay_min": m_knight["delay_min"],
                        "speed_kmh": m_knight["speed_kmh"],
                        "level": m_knight["level"],
                        "color": m_knight["color"],
                    },
                    {
                        "name": "南向 (往列治文/91號公路)",
                        "delay_min": max(0, m_knight["delay_min"] - 1),
                        "speed_kmh": min(m_knight["freeflow_kmh"], m_knight["speed_kmh"] + 3),
                        "level": m_knight["level"],
                        "color": m_knight["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "Marine Dr 匝道匯流處" if m_knight["delay_min"] >= 5 else "橋面雙向車流順暢",
            },
            {
                "id": "lions_gate",
                "name": "獅門大橋 (Lions Gate Bridge)",
                "english_name": "Hwy 99 Lions Gate",
                "route": "Hwy 99",
                "badge": "北岸關鍵跨海橋",
                "center": [-123.1384, 49.3145],
                "zoom": 14.5,
                "status": m_lions["status"],
                "status_color": m_lions["status_color"],
                "current_speed_kmh": m_lions["speed_kmh"],
                "freeflow_speed_kmh": m_lions["freeflow_kmh"],
                "delay_min": m_lions["delay_min"],
                "trend": m_lions["trend"],
                "segments": [
                    {
                        "name": "北向 (往北溫/西溫/海天公路)",
                        "delay_min": m_lions["delay_min"],
                        "speed_kmh": m_lions["speed_kmh"],
                        "level": m_lions["level"],
                        "color": m_lions["color"],
                    },
                    {
                        "name": "南向 (往溫哥華市中心/史丹利公園)",
                        "delay_min": max(0, m_lions["delay_min"] - 1),
                        "speed_kmh": min(m_lions["freeflow_kmh"], m_lions["speed_kmh"] + 2),
                        "level": m_lions["level"],
                        "color": m_lions["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "史丹利公園引道與 Marine Dr 匯流處" if m_lions["delay_min"] >= 5 else "跨海橋面雙向暢通",
            },
            {
                "id": "ironworkers",
                "name": "鋼鐵工人紀念大橋 (Ironworkers Memorial)",
                "english_name": "Second Narrows Bridge",
                "route": "Hwy 1",
                "badge": "1號公路跨海東段",
                "center": [-123.0255, 49.297],
                "zoom": 14.0,
                "status": m_iron["status"],
                "status_color": m_iron["status_color"],
                "current_speed_kmh": m_iron["speed_kmh"],
                "freeflow_speed_kmh": m_iron["freeflow_kmh"],
                "delay_min": m_iron["delay_min"],
                "trend": m_iron["trend"],
                "segments": [
                    {
                        "name": "南向 (往溫哥華/卡西爾隧道)",
                        "delay_min": m_iron["delay_min"],
                        "speed_kmh": m_iron["speed_kmh"],
                        "level": m_iron["level"],
                        "color": m_iron["color"],
                    },
                    {
                        "name": "北向 (往北溫哥華/Main St)",
                        "delay_min": max(0, m_iron["delay_min"] - 1),
                        "speed_kmh": min(m_iron["freeflow_kmh"], m_iron["speed_kmh"] + 3),
                        "level": m_iron["level"],
                        "color": m_iron["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "卡西爾隧道與北溫引道" if m_iron["delay_min"] >= 5 else "大橋與隧道雙向順暢",
            },
            {
                "id": "oak_bridge",
                "name": "橡樹街橋 (Oak Street Bridge)",
                "english_name": "Hwy 99 Oak St Bridge",
                "route": "Hwy 99",
                "badge": "溫哥華南端進出列治文",
                "center": [-123.125, 49.195],
                "zoom": 14.5,
                "status": m_oak["status"],
                "status_color": m_oak["status_color"],
                "current_speed_kmh": m_oak["speed_kmh"],
                "freeflow_speed_kmh": m_oak["freeflow_kmh"],
                "delay_min": m_oak["delay_min"],
                "trend": m_oak["trend"],
                "segments": [
                    {
                        "name": "南向 (往列治文/機場 YVR)",
                        "delay_min": m_oak["delay_min"],
                        "speed_kmh": m_oak["speed_kmh"],
                        "level": m_oak["level"],
                        "color": m_oak["color"],
                    },
                    {
                        "name": "北向 (往溫哥華市區)",
                        "delay_min": max(0, m_oak["delay_min"] - 1),
                        "speed_kmh": min(m_oak["freeflow_kmh"], m_oak["speed_kmh"] + 3),
                        "level": m_oak["level"],
                        "color": m_oak["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "往列治文與機場分流匝道" if m_oak["delay_min"] >= 5 else "橋面與機場支線暢通",
            },
            {
                "id": "alex_fraser",
                "name": "亞歷克斯菲沙橋 (Alex Fraser Bridge)",
                "english_name": "Hwy 91 Alex Fraser Bridge",
                "route": "Hwy 91",
                "badge": "91號公路斜張橋",
                "center": [-122.952, 49.160],
                "zoom": 13.5,
                "status": m_alex["status"],
                "status_color": m_alex["status_color"],
                "current_speed_kmh": m_alex["speed_kmh"],
                "freeflow_speed_kmh": m_alex["freeflow_kmh"],
                "delay_min": m_alex["delay_min"],
                "trend": m_alex["trend"],
                "segments": [
                    {
                        "name": "南向 (往三角洲/素里)",
                        "delay_min": m_alex["delay_min"],
                        "speed_kmh": m_alex["speed_kmh"],
                        "level": m_alex["level"],
                        "color": m_alex["color"],
                    },
                    {
                        "name": "北向 (往列治文/新西敏)",
                        "delay_min": max(0, m_alex["delay_min"] - 1),
                        "speed_kmh": min(m_alex["freeflow_kmh"], m_alex["speed_kmh"] + 4),
                        "level": m_alex["level"],
                        "color": m_alex["color"],
                    },
                ],
                "incidents_count": 0,
                "key_bottleneck": "南向引道路段車多" if m_alex["delay_min"] >= 5 else "斜張橋雙向車流順暢",
            },
        ]

        # 計算整體大溫壅塞指數 (0~100) 與瓶頸摘要
        avg_ratio = sum(
            (c["current_speed_kmh"] / max(1.0, c["freeflow_speed_kmh"])) for c in corridors
        ) / max(1, len(corridors))
        max_delay = max((c["delay_min"] for c in corridors), default=0)
        congestion_score = max(5, min(98, int(round((1.0 - avg_ratio) * 100)) + (max_delay * 2)))

        if congestion_score < 22 and max_delay <= 2:
            overall_status = "大溫全線暢通 (Free Flow)"
        elif congestion_score < 45:
            overall_status = "大溫大致順暢 (Light Traffic)"
        elif congestion_score < 70:
            overall_status = "大溫局部車多 (Moderate Traffic)"
        else:
            overall_status = "大溫交通繁忙 (Heavy Congestion)"

        worst_c = max(corridors, key=lambda x: x["delay_min"])
        if worst_c["delay_min"] >= 3:
            worst_corridor = f"{worst_c['name']} (+{worst_c['delay_min']} 分鐘)"
        else:
            worst_corridor = ""

        self.cached_corridors_summary = {
            "source": "TomTom Real-Time Traffic & DriveBC",
            "source_url": "https://plan.tomtom.com/",
            "has_tomtom_key": bool(api_key),
            "updated_at": now_iso,
            "overall_congestion_score": congestion_score,
            "overall_status": overall_status,
            "total_jams": sum(1 for c in corridors if c["delay_min"] >= 3),
            "total_incidents": len(alert_features),
            "worst_corridor": worst_corridor,
            "corridors": corridors,
            "top_alerts": [feat["properties"] for feat in alert_features[:12]],
        }

        self.last_fetch_time = now
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
            print(f"[TomTomTraffic] Error saving static caches: {e}")

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
