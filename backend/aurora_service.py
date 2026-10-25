import urllib.request
import json
import datetime
import time
import os

NOAA_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "vancouver_aurora_cache.json")
CACHE_TTL = 43200  # 12 小時 (每天 2 次更新)

_aurora_cache = {
    "timestamp": 0,
    "data": None
}

VANCOUVER_AURORA_SPOTS = [
    {
        "id": "porteau_cove",
        "name": "Porteau Cove (波特灣省立公園)",
        "area": "海天公路 · 斯闊米什方向 (Sea-to-Sky)",
        "lat": 49.5583,
        "lon": -123.2367,
        "zoom": 13,
        "features": "大溫最熱門極光聖地，面向豪灣無光害，可見完整極光倒影",
        "drive_min": "從溫哥華市中心約 40 分鐘車程"
    },
    {
        "id": "cypress_lookout",
        "name": "Cypress Lookout (賽普里斯山高空觀景台)",
        "area": "西溫哥華 · 賽普里斯山 (West Vancouver)",
        "lat": 49.3562,
        "lon": -123.1978,
        "zoom": 14,
        "features": "高海拔俯瞰，可避開低層海面水氣與市區近地光害",
        "drive_min": "從西溫約 20 分鐘車程"
    },
    {
        "id": "iona_beach",
        "name": "Iona Beach Jetty (艾歐娜海灘防波堤)",
        "area": "列治文 · 菲沙河北支流口 (Richmond)",
        "lat": 49.2186,
        "lon": -123.2125,
        "zoom": 13,
        "features": "向西北延伸 4 公里長堤，擁有 360 度海平線開闊北面視野",
        "drive_min": "從列治文市中心約 20 分鐘車程"
    },
    {
        "id": "spanish_banks",
        "name": "Spanish Banks West (西班牙海灘最西端)",
        "area": "溫哥華西區 · UBC 鄰近海灣 (Point Grey)",
        "lat": 49.2764,
        "lon": -123.2268,
        "zoom": 14,
        "features": "溫哥華市區內最暗海岸，面向北岸群山，交通便利",
        "drive_min": "從溫哥華市中心約 15 分鐘車程"
    }
]

def calculate_g_scale(kp: float):
    kp_val = float(kp)
    if kp_val >= 9.0:
        return "G5", "極端磁暴", "purple", "#a855f7"
    elif kp_val >= 8.0:
        return "G4", "嚴重磁暴", "red", "#ef4444"
    elif kp_val >= 7.0:
        return "G3", "強烈磁暴", "orange", "#f97316"
    elif kp_val >= 6.0:
        return "G2", "中度磁暴", "amber", "#f59e0b"
    elif kp_val >= 5.0:
        return "G1", "弱磁暴", "yellow", "#eab308"
    elif kp_val >= 4.0:
        return "活躍", "活躍擾動", "emerald", "#10b981"
    elif kp_val >= 3.0:
        return "微擾", "輕微擾動", "cyan", "#06b6d4"
    else:
        return "平靜", "平靜平穩", "blue", "#3b82f6"

def get_vancouver_visibility(kp: float):
    kp_val = float(kp)
    if kp_val >= 8.0:
        return {
            "level": "極佳！全境滿天可見 (Historical)",
            "description": "歷史級磁暴大爆發！即使在溫哥華有光害的市區，抬頭肉眼即可見到劇烈跳動的極光帷幔與紫綠色彩。",
            "chance_pct": 98,
            "naked_eye": True,
            "badge_color": "bg-purple-600 text-white"
        }
    elif kp_val >= 7.0:
        return {
            "level": "極佳！市區郊區清晰可見 (Excellent)",
            "description": "極光帶南壓跨過美加邊境！溫哥華海邊、公園與市郊抬頭肉眼即可見明顯極光弧與舞動光柱。",
            "chance_pct": 88,
            "naked_eye": True,
            "badge_color": "bg-rose-600 text-white"
        }
    elif kp_val >= 6.0:
        return {
            "level": "良好！暗空地區肉眼可見 (Good)",
            "description": "中度地磁風暴。在西溫、北溫山區或波特灣（Porteau Cove）等少光害區域，肉眼清晰可見綠色光柱跳動。",
            "chance_pct": 70,
            "naked_eye": True,
            "badge_color": "bg-amber-500 text-white"
        }
    elif kp_val >= 5.0:
        return {
            "level": "有機會！相機與深山可見 (Moderate)",
            "description": "G1 級輕度磁暴。前往海天公路波特灣或高山無光害處，相機長曝光 3~5 秒可拍到鮮明綠光，肉眼隱約可辨識灰白極光弧。",
            "chance_pct": 45,
            "naked_eye": False,
            "badge_color": "bg-yellow-500 text-gray-900"
        }
    elif kp_val >= 4.0:
        return {
            "level": "微弱！需長曝光相機 (Low)",
            "description": "極光帶在卑詩省中北部活躍。溫哥華朝北開闊水面長曝光 8~15 秒有微弱機率捕捉地平線泛綠夜空，肉眼通常不可見。",
            "chance_pct": 20,
            "naked_eye": False,
            "badge_color": "bg-teal-600 text-white"
        }
    else:
        return {
            "level": "不可見",
            "description": "地磁場處於平靜狀態。極光主要侷限於阿拉斯加、黃刀鎮等高緯度極圈附近，溫哥華目前無法觀測到極光。",
            "chance_pct": 5,
            "naked_eye": False,
            "badge_color": "bg-slate-600 text-gray-200"
        }

def fetch_noaa_aurora_data() -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    raw_list = []
    try:
        req = urllib.request.Request(NOAA_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data_bytes = resp.read()
            raw_list = json.loads(data_bytes.decode('utf-8'))
    except Exception as e:
        print(f"[AuroraService] Error fetching NOAA data: {e}")

    # Fallback to cache file if network failed
    if not raw_list and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[AuroraService] Error reading cache file: {e}")

    if not raw_list:
        # Default fallback structure if completely empty
        raw_list = [
            {"time_tag": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:00:00"), "Kp": 2.33, "a_running": 9, "station_count": 8}
        ]

    # Process entries
    history_entries = []
    # If the first entry is a header row (some SWPC endpoints return [ ["time_tag", "Kp", ...] ]), handle both
    for item in raw_list:
        if isinstance(item, list) and len(item) >= 2:
            if str(item[0]).lower() == "time_tag":
                continue
            try:
                t_tag = str(item[0])
                kp_val = float(item[1])
                a_run = int(item[2]) if len(item) > 2 and str(item[2]).isdigit() else 0
                g_code, g_desc, _, g_hex = calculate_g_scale(kp_val)
                history_entries.append({
                    "time_tag": t_tag,
                    "kp": round(kp_val, 2),
                    "a_running": a_run,
                    "g_scale": g_code,
                    "g_desc": g_desc,
                    "g_color": g_hex
                })
            except Exception:
                continue
        elif isinstance(item, dict) and "time_tag" in item and "Kp" in item:
            try:
                t_tag = str(item["time_tag"])
                kp_val = float(item["Kp"])
                a_run = int(item.get("a_running", 0))
                g_code, g_desc, _, g_hex = calculate_g_scale(kp_val)
                history_entries.append({
                    "time_tag": t_tag,
                    "kp": round(kp_val, 2),
                    "a_running": a_run,
                    "g_scale": g_code,
                    "g_desc": g_desc,
                    "g_color": g_hex
                })
            except Exception:
                continue

    if not history_entries:
        history_entries = [
            {
                "time_tag": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:00:00"),
                "kp": 2.33,
                "a_running": 9,
                "g_scale": "Quiet",
                "g_desc": "平靜平穩 (Quiet)",
                "g_color": "#3b82f6"
            }
        ]

    latest = history_entries[-1]
    g_code, g_desc, _, g_hex = calculate_g_scale(latest["kp"])
    vis_info = get_vancouver_visibility(latest["kp"])

    # Recent 16 intervals (48 hours)
    recent_history = history_entries[-16:]

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    result = {
        "source": "美國國家海洋暨大氣總署太空天氣預測中心 (NOAA SWPC)",
        "source_url": "https://www.swpc.noaa.gov/",
        "api_endpoint": NOAA_URL,
        "update_frequency": "每天 2 次 (12 小時快取)",
        "last_updated": now_iso,
        "latest": {
            "time_tag": latest["time_tag"],
            "kp": latest["kp"],
            "kp_int": int(round(latest["kp"])),
            "g_scale": g_code,
            "g_desc": g_desc,
            "g_color": g_hex,
            "visibility": vis_info
        },
        "history": recent_history,
        "spots": VANCOUVER_AURORA_SPOTS
    }

    # Save to cache file
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        front_pub = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "public")
        if os.path.exists(front_pub):
            with open(os.path.join(front_pub, "vancouver_aurora_cache.json"), "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[AuroraService] Error saving cache: {e}")

    return result

def get_aurora_data(force: bool = False) -> dict:
    global _aurora_cache
    now = time.time()
    if not force and _aurora_cache["data"] and (now - _aurora_cache["timestamp"] < CACHE_TTL):
        return _aurora_cache["data"]

    # Check disk cache timestamp if in-memory cache is empty
    if not force and not _aurora_cache["data"] and os.path.exists(CACHE_FILE):
        try:
            mtime = os.path.getmtime(CACHE_FILE)
            if now - mtime < CACHE_TTL:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    cached_json = json.load(f)
                    _aurora_cache["timestamp"] = mtime
                    _aurora_cache["data"] = cached_json
                    return cached_json
        except Exception:
            pass

    data = fetch_noaa_aurora_data()
    _aurora_cache["timestamp"] = now
    _aurora_cache["data"] = data
    return data
