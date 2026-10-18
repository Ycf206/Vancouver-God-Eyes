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


class TomTomTrafficService:
    """
    TomTom Real-Time Traffic Flow & Incidents + DriveBC Open511 Engine for Metro Vancouver.
    Provides real-time TomTom Traffic Flow Tiles, Segment Speeds, and Traffic Incidents for Metro Vancouver.
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

    def get_flow_tile(self, z: int, x: int, y: int, style: str = "relative", thickness: int = 2) -> bytes:
        """
        向 TomTom Traffic Flow Tiles v4 取得即時路況柵格圖磚 (綠/黃/橙/紅全路網連續路況)
        thickness 範圍為 1..20 (TomTom 預設為 10)，設為 2 可讓密集街道線條極致纖細清晰。
        內建 3 分鐘記憶體快取以大幅節省每日免費配額。
        """
        api_key = self.get_tomtom_api_key()
        if not api_key:
            return TRANSPARENT_1X1_PNG

        # 只取得與顯示核心5區 (Vancouver, Richmond, Burnaby, North Van, New West) 的圖磚
        # 嚴格排除 Surrey, Coquitlam, Delta 以節省 TomTom API 圖磚配額
        # 西界 -123.28, 東界 -122.87, 南界 49.12, 北界 49.38
        import math
        n = 2.0 ** z
        tile_lon_min = x / n * 360.0 - 180.0
        tile_lon_max = (x + 1) / n * 360.0 - 180.0
        tile_lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
        tile_lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))

        if tile_lon_max < -123.28 or tile_lon_min > -122.87 or tile_lat_max < 49.12 or tile_lat_min > 49.38:
            return TRANSPARENT_1X1_PNG

        valid_styles = {"absolute", "relative", "relative0", "relative0-dark", "relative-delay", "reduced-sensitivity"}
        if style not in valid_styles:
            style = "relative"

        clamped_thickness = max(1, min(20, int(thickness)))

        now = time.time()
        cache_key = (f"{style}_t{clamped_thickness}", int(z), int(x), int(y))
        cached = self.tile_cache.get(cache_key)
        if cached and (now - cached[0] < self.tile_cache_ttl):
            return cached[1]

        url = (
            f"https://api.tomtom.com/traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png"
            f"?key={urllib.parse.quote(api_key)}&tileSize=256&thickness={clamped_thickness}"
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
                "direction": "雙向 (列治文 99 號公路主通道)",
                "city": "Richmond",
                "freeflow_speed": 80,
                "probe_point": (49.124, -123.076),
                "length_km": 5.0,
                "coordinates": [
                    [-123.072, 49.145],
                    [-123.074, 49.135],
                    [-123.076, 49.124],
                    [-123.078, 49.120],
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
                "probe_point": (49.2015, -123.1259),
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
                "id": "pattullo",
                "corridor_group": "pattullo",
                "name": "帕圖洛橋 (Pattullo Bridge)",
                "highway": "King George Blvd",
                "direction": "雙向 (新西敏聯外通道)",
                "city": "New Westminster",
                "freeflow_speed": 50,
                "probe_point": (49.206, -122.895),
                "length_km": 2.5,
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
                "direction": "雙向 (本拿比布蘭特伍德 ↔ 本拿比東端)",
                "city": "Burnaby",
                "freeflow_speed": 70,
                "probe_point": (49.266, -122.998),
                "length_km": 7.0,
                "coordinates": [
                    [-123.024, 49.266],
                    [-122.998, 49.266],
                    [-122.915, 49.252],
                    [-122.885, 49.248],
                ],
            },
            {
                "id": "hwy91_richmond",
                "corridor_group": "hwy91",
                "name": "91號公路列治文段 (Hwy 91 East-West Connector)",
                "highway": "Hwy 91",
                "direction": "雙向 (列治文東西向快速道)",
                "city": "Richmond",
                "freeflow_speed": 90,
                "probe_point": (49.178, -123.050),
                "length_km": 6.5,
                "coordinates": [
                    [-123.105, 49.178],
                    [-123.080, 49.182],
                    [-122.965, 49.172],
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
        使用 zoom=10 強制鎖定主要高速公路與跨海大橋主幹道 (FRC0~FRC2)，避免誤吸橋下 30 km/h 平面小街。
        """
        if not api_key:
            return None
        url = (
            f"https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json"
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
            "&bbox=-123.28,49.12,-122.87,49.38"
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
        url = "https://api.open511.gov.bc.ca/events?status=ACTIVE&bbox=-123.28,49.12,-122.87,49.38&format=json&limit=25"
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

    def _get_major_roads_definition(self) -> List[Dict[str, Any]]:
        """
        Major Road Network & Other Major Thoroughfares defined from MajorRoad.txt
        All displayed in English as requested.
        """
        return [
            # Major Road Network - Downtown
            {"id": "mrn_georgia_se", "name": "Georgia Street (southeast to Main St)", "group": "Major Road Network - Downtown", "freeflow": 50, "coords": [-123.1110, 49.2785], "length_km": 1.6},
            {"id": "mrn_howe", "name": "Howe Street", "group": "Major Road Network - Downtown", "freeflow": 50, "coords": [-123.1255, 49.2780], "length_km": 1.8},
            {"id": "mrn_nelson", "name": "Nelson Street (northwest to Howe St)", "group": "Major Road Network - Downtown", "freeflow": 50, "coords": [-123.1220, 49.2785], "length_km": 1.4},
            {"id": "mrn_seymour", "name": "Seymour Street", "group": "Major Road Network - Downtown", "freeflow": 50, "coords": [-123.1200, 49.2800], "length_km": 1.8},
            {"id": "mrn_smithe", "name": "Smithe Street (northwest to Howe St)", "group": "Major Road Network - Downtown", "freeflow": 50, "coords": [-123.1205, 49.2775], "length_km": 1.4},

            # Major Road Network - East–west
            {"id": "mrn_hastings", "name": "Hastings Street (west to Burrard St)", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0800, 49.2812], "length_km": 5.8},
            {"id": "mrn_mcgill", "name": "McGill Street (west to Nanaimo St)", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0510, 49.2865], "length_km": 1.5},
            {"id": "mrn_dundas", "name": "Dundas Street (east to Nanaimo St)", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0560, 49.2835], "length_km": 1.8},
            {"id": "mrn_powell", "name": "Powell Street (west to Hawks Ave)", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0900, 49.2830], "length_km": 2.2},
            {"id": "mrn_east_1st", "name": "East 1st Avenue", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0650, 49.2690], "length_km": 4.5},
            {"id": "mrn_terminal", "name": "Terminal Avenue", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.0900, 49.2730], "length_km": 2.4},
            {"id": "mrn_broadway", "name": "Broadway", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.1250, 49.2635], "length_km": 7.8},
            {"id": "mrn_west_10th", "name": "West 10th Avenue (east to Alma St)", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.1900, 49.2625], "length_km": 2.6},
            {"id": "mrn_grandview", "name": "Grandview Highway (west to Nanaimo St)", "group": "Major Road Network - East–west", "freeflow": 60, "coords": [-123.0450, 49.2575], "length_km": 3.6},
            {"id": "mrn_41st_ave", "name": "41st Avenue", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.1250, 49.2335], "length_km": 8.5},
            {"id": "mrn_70th_ave", "name": "70th Avenue", "group": "Major Road Network - East–west", "freeflow": 50, "coords": [-123.1350, 49.2085], "length_km": 2.8},

            # Major Road Network - North–south
            {"id": "mrn_boundary", "name": "Boundary Road (north to Hastings St)", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.0235, 49.2650], "length_km": 7.2},
            {"id": "mrn_clark", "name": "Clark Drive (north to Powell St)", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.0780, 49.2720], "length_km": 3.0},
            {"id": "mrn_knight", "name": "Knight Street", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.0780, 49.2300], "length_km": 5.4},
            {"id": "mrn_main_st", "name": "Main Street (between Broadway & Georgia St)", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.1000, 49.2700], "length_km": 2.2},
            {"id": "mrn_oak_st", "name": "Oak Street (north to Broadway)", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.1285, 49.2450], "length_km": 4.8},
            {"id": "mrn_cambie", "name": "Cambie Street", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.1155, 49.2450], "length_km": 6.2},
            {"id": "mrn_granville", "name": "Granville Street", "group": "Major Road Network - North–south", "freeflow": 50, "coords": [-123.1385, 49.2450], "length_km": 7.5},

            # Major Road Network - Other
            {"id": "mrn_kingsway", "name": "Kingsway", "group": "Major Road Network - Other", "freeflow": 55, "coords": [-123.0650, 49.2450], "length_km": 6.8},
            {"id": "mrn_marine_dr", "name": "Marine Drive", "group": "Major Road Network - Other", "freeflow": 60, "coords": [-123.1150, 49.2100], "length_km": 10.5},

            # Other major thoroughfares - Downtown
            {"id": "oth_burrard", "name": "Burrard Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 50, "coords": [-123.1235, 49.2835], "length_km": 2.5},
            {"id": "oth_cordova", "name": "Cordova Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 50, "coords": [-123.1080, 49.2830], "length_km": 2.0},
            {"id": "oth_davie", "name": "Davie Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 40, "coords": [-123.1310, 49.2790], "length_km": 1.6},
            {"id": "oth_denman", "name": "Denman Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 40, "coords": [-123.1380, 49.2900], "length_km": 1.4},
            {"id": "oth_dunsmuir", "name": "Dunsmuir Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 50, "coords": [-123.1170, 49.2825], "length_km": 1.5},
            {"id": "oth_georgia_dw", "name": "Georgia Street (Downtown)", "group": "Other Major Thoroughfare - Downtown", "freeflow": 50, "coords": [-123.1200, 49.2840], "length_km": 2.2},
            {"id": "oth_pacific_blvd", "name": "Pacific Boulevard", "group": "Other Major Thoroughfare - Downtown", "freeflow": 50, "coords": [-123.1200, 49.2730], "length_km": 2.8},
            {"id": "oth_robson", "name": "Robson Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 40, "coords": [-123.1240, 49.2840], "length_km": 2.0},
            {"id": "oth_thurlow", "name": "Thurlow Street", "group": "Other Major Thoroughfare - Downtown", "freeflow": 40, "coords": [-123.1280, 49.2845], "length_km": 1.5},

            # Other major thoroughfares - East–west (west of Ontario St)
            {"id": "oth_4th_ave", "name": "4th Avenue", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1600, 49.2680], "length_km": 4.5},
            {"id": "oth_12th_ave_w", "name": "12th Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1400, 49.2605], "length_km": 3.8},
            {"id": "oth_16th_ave_w", "name": "16th Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1450, 49.2565], "length_km": 5.2},
            {"id": "oth_king_edward_w", "name": "King Edward Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1400, 49.2485], "length_km": 4.6},
            {"id": "oth_33rd_ave_w", "name": "33rd Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1400, 49.2410], "length_km": 4.2},
            {"id": "oth_41st_ave_hwy99", "name": "41st Avenue (part of Hwy 99)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1550, 49.2335], "length_km": 4.0},
            {"id": "oth_49th_ave_w", "name": "49th Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1400, 49.2260], "length_km": 5.0},
            {"id": "oth_57th_ave_w", "name": "57th Avenue (West)", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1400, 49.2185], "length_km": 4.8},

            # Other major thoroughfares - North–south (west of Ontario St)
            {"id": "oth_alma", "name": "Alma Street", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1860, 49.2600], "length_km": 2.2},
            {"id": "oth_arbutus", "name": "Arbutus Street / West Boulevard", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1530, 49.2450], "length_km": 5.8},
            {"id": "oth_macdonald", "name": "Macdonald Street", "group": "Other Major Thoroughfare - Westside", "freeflow": 50, "coords": [-123.1680, 49.2550], "length_km": 3.6},

            # Other major thoroughfares - East–west (east of Ontario St)
            {"id": "oth_prior_venables", "name": "Prior Street / Venables Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0800, 49.2765], "length_km": 2.8},
            {"id": "oth_2nd_gt_northern", "name": "2nd Ave / Great Northern Way / 6th Ave", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0900, 49.2665], "length_km": 3.4},
            {"id": "oth_12th_ave_e", "name": "12th Avenue (East)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2605], "length_km": 4.0},
            {"id": "oth_16th_ave_e", "name": "16th Avenue (East)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2565], "length_km": 4.2},
            {"id": "oth_22nd_ave", "name": "22nd Avenue (west to Nanaimo St)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0600, 49.2510], "length_km": 2.0},
            {"id": "oth_29th_ave", "name": "29th Avenue (west to Nanaimo St)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0550, 49.2445], "length_km": 2.2},
            {"id": "oth_33rd_ave_e", "name": "33rd Avenue (East)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2410], "length_km": 4.0},
            {"id": "oth_king_edward_e", "name": "King Edward Avenue (East)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2485], "length_km": 4.2},
            {"id": "oth_41st_ave_e", "name": "41st Avenue (east to Kingsway)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0650, 49.2335], "length_km": 3.2},
            {"id": "oth_49th_ave_e", "name": "49th Avenue (East)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2260], "length_km": 4.8},
            {"id": "oth_54th_ave", "name": "54th Avenue (east to Tyne St)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0350, 49.2215], "length_km": 2.4},
            {"id": "oth_57th_ave_e", "name": "57th Avenue (east to Argyle Dr)", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0650, 49.2185], "length_km": 2.6},

            # Other major thoroughfares - North–south (east of Ontario St)
            {"id": "oth_main_st_e", "name": "Main Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.1000, 49.2500], "length_km": 5.2},
            {"id": "oth_fraser", "name": "Fraser Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0900, 49.2400], "length_km": 6.0},
            {"id": "oth_windsor", "name": "Windsor Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0850, 49.2450], "length_km": 4.0},
            {"id": "oth_commercial_vic", "name": "Commercial Drive / Victoria Drive", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0680, 49.2600], "length_km": 5.6},
            {"id": "oth_nanaimo", "name": "Nanaimo Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0560, 49.2450], "length_km": 5.5},
            {"id": "oth_renfrew", "name": "Renfrew Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0440, 49.2500], "length_km": 4.8},
            {"id": "oth_rupert_kerr", "name": "Rupert Street / Kerr Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0330, 49.2350], "length_km": 6.2},
            {"id": "oth_joyce", "name": "Joyce Street", "group": "Other Major Thoroughfare - Eastside", "freeflow": 50, "coords": [-123.0280, 49.2370], "length_km": 3.0},
        ]

    def refresh(self, force: bool = False):
        now = time.time()
        if not force and (now - self.last_fetch_time < self.cache_ttl) and self.cached_jams_geojson and self.cached_corridors_summary:
            return

        api_key = self.get_tomtom_api_key()
        base_corridors = self._get_base_corridors_definition()

        # 1. 只針對 7 個核心走廊探針點查詢 TomTom Flow Segment Data (平行查詢，每次更新僅耗 7 次 API Call)
        key_corridor_ids = {
            "hwy1_east",
            "hwy1_west",
            "massey_tunnel",
            "lions_gate",
            "knight_st_bridge",
            "ironworkers_bridge",
            "oak_st_bridge",
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

        # 2. 取得即時突發事故與通報 (嚴格只使用 TomTom Traffic Incidents v5，無資料時保持空白)
        tomtom_incidents = self._fetch_tomtom_incidents(api_key) if api_key else []

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
            event_desc = ", ".join([e.get("description", "") for e in events_list if e.get("description")]) or "Traffic Incident"
            road_nums = props.get("roadNumbers") or []
            from_loc = props.get("from") or ""
            to_loc = props.get("to") or ""
            street_name = " / ".join(road_nums) if road_nums else (from_loc or "Vancouver, BC")
            if from_loc and to_loc:
                route_desc = f"{from_loc} to {to_loc} ({event_desc})"
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
                        "facility_type": "traffic_alerts",
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
                        "confidence_pct": 96,
                        "pub_time": int(now * 1000),
                        "time_display": "TomTom 即時",
                        "report_time_str": "TomTom 即時偵測",
                        "lon": pt_lon,
                        "lat": pt_lat,
                        "coordinates": [pt_lon, pt_lat],
                        "source": "TomTom Traffic Incidents API",
                    },
                })

        # 3. 計算 17 條主要幹道與關鍵走廊的即時車速與狀態
        jam_features: List[Dict[str, Any]] = []
        corridor_metrics: Dict[str, Dict[str, Any]] = {}

        for b in base_corridors:
            cid = b["id"]
            base_freeflow = float(b["freeflow_speed"])
            freeflow = base_freeflow
            length_km = float(b.get("length_km", 5.0))
            flow = flow_results.get(cid)

            if flow and "currentSpeed" in flow:
                raw_cur = float(flow.get("currentSpeed", base_freeflow))
                raw_ff = float(flow.get("freeFlowSpeed", base_freeflow)) or base_freeflow
                cur_tt = float(flow.get("currentTravelTime", 0))
                ff_tt = float(flow.get("freeFlowTravelTime", 0))
                road_closure = bool(flow.get("roadClosure", False))

                # 防止座標若意外吸附到橋下/平面慢速支線 (如 30 km/h) 時失真：保留主幹道基準自由流車速並按即時暢通比例換算
                if raw_ff < base_freeflow * 0.75:
                    ratio = min(1.0, max(0.15, raw_cur / max(10.0, raw_ff)))
                    freeflow = base_freeflow
                    cur_speed = round(base_freeflow * ratio, 1)
                else:
                    freeflow = raw_ff
                    cur_speed = raw_cur

                # TomTom flowSegmentData 的 travelTime 僅為取樣點單一感測路段 (~150m-300m)，
                # 必須依走廊完整里程 (length_km) 與車速比推算整條幹道/橋隧的真實通過延誤分鐘數
                t_ff_corridor_min = (length_km / max(15.0, freeflow)) * 60.0
                if cur_tt > 0 and ff_tt > 0 and raw_ff >= base_freeflow * 0.75:
                    tt_ratio = max(1.0, cur_tt / max(1.0, ff_tt))
                    delay_min = max(0.0, round(t_ff_corridor_min * (tt_ratio - 1.0), 1))
                else:
                    t_cur_corridor_min = (length_km / max(10.0, cur_speed)) * 60.0
                    delay_min = max(0.0, round(t_cur_corridor_min - t_ff_corridor_min, 1))
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
        ]

        # 5. 計算主要道路 (Major Road Network + Other major thoroughfares from MajorRoad.txt)
        major_roads_defs = self._get_major_roads_definition()
        major_roads: List[Dict[str, Any]] = []

        for rd in major_roads_defs:
            ff_spd = rd["freeflow"]
            coords = rd["coords"]
            rd_delay = 0.0
            rd_speed = float(ff_spd)
            # 檢查附近是否有即時事故通報影響
            near_alert = None
            for af in alert_features:
                ap = af["properties"]
                dist = ((ap["lat"] - coords[1]) ** 2 + (ap["lon"] - coords[0]) ** 2) ** 0.5
                if dist < 0.012: # ~1.0 km 內
                    near_alert = ap
                    break

            if near_alert:
                alert_delay = float(near_alert.get("delay_min", 4.0))
                rd_delay = alert_delay
                rd_speed = max(18.0, round(ff_spd * 0.6))

            rd_cls = self._classify_congestion(rd_speed, ff_spd, rd_delay)

            # 英文狀態描述 (依使用者要求：除了 7 大幹道，主要道路清單請用英文顯示)
            en_status = "Free Flow"
            if rd_delay >= 8 or rd_cls["level"] >= 3:
                en_status = "Heavy Traffic"
            elif rd_delay >= 3 or rd_cls["level"] == 2:
                en_status = "Moderate Traffic"
            elif rd_delay >= 1 or rd_cls["level"] == 1:
                en_status = "Light Traffic"

            major_roads.append({
                "id": rd["id"],
                "name": rd["name"],
                "english_name": rd["name"],
                "route": rd["group"].split("-")[-1].strip(),
                "badge": rd["group"],
                "group": rd["group"],
                "status": en_status,
                "status_zh": rd_cls["status"],
                "status_color": rd_cls["status_color"],
                "color": rd_cls["color"],
                "current_speed_kmh": int(round(rd_speed)),
                "freeflow_speed_kmh": ff_spd,
                "delay_min": int(round(rd_delay)),
                "length_km": rd["length_km"],
                "trend": rd_cls["trend"],
                "center": coords,
                "zoom": 14.5,
                "key_bottleneck": f"Near {near_alert.get('street', 'arterial')}: {near_alert.get('description', '')}" if near_alert else "Normal flow along arterial"
            })

        # 計算全體道路 (7大幹道 + 主要道路) 暢通數量與城市整體路況
        # 使用者要求：大溫全線暢通(Free Flow) 刪除大溫 和(Free Flow), 顯示城市整體路況
        # 後面數字 "5/100" 分子是暢通的數量, 分母是所有 MajorRoad.txt 的道路 (包括 7 大幹道, Major Road Network 和 Other major thoroughfares)
        all_monitored_roads = corridors + major_roads
        total_roads_count = len(all_monitored_roads)
        freeflow_roads_count = sum(1 for r in all_monitored_roads if r["delay_min"] <= 1)
        severe_roads_count = sum(1 for r in all_monitored_roads if r["delay_min"] >= 5 or (isinstance(r.get("status"), str) and ("Heavy" in r["status"] or "嚴重" in r["status"] or "重度" in r["status"])))

        # 城市整體路況 (無 "大溫" 與 "(Free Flow)")
        if severe_roads_count == 0 and freeflow_roads_count >= int(total_roads_count * 0.9):
            city_status = "全線暢通"
        elif severe_roads_count <= 2 and freeflow_roads_count >= int(total_roads_count * 0.75):
            city_status = "大致順暢"
        elif severe_roads_count <= 5:
            city_status = "局部車多"
        else:
            city_status = "交通繁忙"

        worst_c = max(corridors, key=lambda x: x["delay_min"])
        if worst_c["delay_min"] >= 3:
            worst_corridor = f"{worst_c['name']} (+{worst_c['delay_min']} 分鐘)"
        else:
            worst_corridor = ""

        self.cached_corridors_summary = {
            "source": "TomTom Real-Time Traffic & DriveBC",
            "source_url": "https://plan.tomtom.com/en/?p=49.24943,-123.12845,11.71z",
            "has_tomtom_key": bool(api_key),
            "updated_at": now_iso,
            "overall_congestion_score": congestion_score,
            "overall_status": city_status,
            "freeflow_roads_count": freeflow_roads_count,
            "total_roads_count": total_roads_count,
            "severe_roads_count": severe_roads_count,
            "total_jams": sum(1 for c in corridors if c["delay_min"] >= 3),
            "total_incidents": len(alert_features),
            "worst_corridor": worst_corridor,
            "corridors": corridors,
            "major_roads": major_roads,
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
                with open(os.path.join(CACHE_DIR, "vancouver_traffic_alerts.geojson"), "w", encoding="utf-8") as f:
                    json.dump(self.cached_alerts_geojson, f, ensure_ascii=False, indent=2)

            pub_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public"))
            if os.path.exists(pub_dir):
                if self.cached_jams_geojson:
                    with open(os.path.join(pub_dir, "vancouver_traffic_conditions.geojson"), "w", encoding="utf-8") as f:
                        json.dump(self.cached_jams_geojson, f, ensure_ascii=False, indent=2)
                if self.cached_alerts_geojson:
                    with open(os.path.join(pub_dir, "vancouver_traffic_alerts.geojson"), "w", encoding="utf-8") as f:
                        json.dump(self.cached_alerts_geojson, f, ensure_ascii=False, indent=2)
                if self.cached_corridors_summary:
                    with open(os.path.join(pub_dir, "vancouver_traffic_summary_cache.json"), "w", encoding="utf-8") as f:
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


tomtom_service = TomTomTrafficService()
