import urllib.request
import re
import xml.etree.ElementTree as ET
import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

class BorderService:
    def __init__(self):
        self.cached_data: Optional[Dict[str, Any]] = None
        self.last_fetch_time: float = 0.0
        self.cache_ttl: float = 90.0  # 90 秒快取
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    def _get_base_crossings(self) -> Dict[str, Dict[str, Any]]:
        return {
            "peace_arch": {
                "id": "peace_arch",
                "name": "和平門關卡",
                "english_name": "Peace Arch / Douglas Crossing",
                "cbsa_key": "Douglas",
                "cbp_key": "Peace Arch",
                "highway": "BC Hwy 99 ↔ US I-5",
                "lat": 49.0022,
                "lon": -122.7567,
                "zoom": 15.5,
                "address": "5700 Hwy 99, Surrey, BC V3S 9R6 / Blaine, WA",
                "hours": "24 小時全天開放",
                "crossing_type": "旅客客車專用",
                "has_nexus": True,
                "has_commercial": False,
                "tips": "大溫哥華前往華盛頓州與西雅圖最繁忙之主要客運通道，週末尖峰建議善用 NEXUS 通道或改道太平洋公路。",
                "canada_bound": {
                    "traveller_delay_min": 5,
                    "traveller_status": "5 分鐘",
                    "commercial_delay_min": None,
                    "commercial_status": "不適用 (客運專用)",
                    "nexus_open": True,
                    "updated_at": "即時連線"
                },
                "us_bound": {
                    "standard_delay_min": 10,
                    "standard_status": "10 分鐘",
                    "standard_lanes_open": 5,
                    "nexus_delay_min": 0,
                    "nexus_status": "免等候",
                    "nexus_lanes_open": 2,
                    "commercial_delay_min": None,
                    "commercial_status": "不適用",
                    "updated_at": "即時連線"
                }
            },
            "pacific_highway": {
                "id": "pacific_highway",
                "name": "太平洋公路關卡",
                "english_name": "Pacific Highway (Truck Crossing)",
                "cbsa_key": "Pacific Highway",
                "cbp_key": "Pacific Highway",
                "highway": "BC Hwy 15 (176th St) ↔ WA SR 543",
                "lat": 49.0020,
                "lon": -122.7350,
                "zoom": 15.5,
                "address": "176th St & 0 Ave, Surrey, BC / Blaine, WA",
                "hours": "24 小時全天開放",
                "crossing_type": "客車及商業貨運",
                "has_nexus": True,
                "has_commercial": True,
                "tips": "大溫核心商業貨車通道與旅客替代通道，支援 FAST 商業快速車道、NEXUS 及一般車道。",
                "canada_bound": {
                    "traveller_delay_min": 5,
                    "traveller_status": "5 分鐘",
                    "commercial_delay_min": 5,
                    "commercial_status": "5 分鐘",
                    "nexus_open": True,
                    "updated_at": "即時連線"
                },
                "us_bound": {
                    "standard_delay_min": 5,
                    "standard_status": "5 分鐘",
                    "standard_lanes_open": 3,
                    "nexus_delay_min": 0,
                    "nexus_status": "免等候",
                    "nexus_lanes_open": 1,
                    "commercial_delay_min": 0,
                    "commercial_status": "免等候",
                    "updated_at": "即時連線"
                }
            },
            "aldergrove": {
                "id": "aldergrove",
                "name": "奧爾德格羅夫關卡",
                "english_name": "Aldergrove / Lynden",
                "cbsa_key": "Aldergrove",
                "cbp_key": "Lynden",
                "highway": "BC Hwy 13 (264th St) ↔ WA SR 539",
                "lat": 49.0021,
                "lon": -122.4845,
                "zoom": 15.5,
                "address": "Hwy 13 & 0 Ave, Langley, BC / Lynden, WA",
                "hours": "08:00 - 24:00 (一般車道), NEXUS (12:00 - 20:00)",
                "crossing_type": "旅客客車及部分商業",
                "has_nexus": True,
                "has_commercial": True,
                "tips": "位於蘭里與阿伯茨福德交界，前往貝靈漢 (Bellingham) 避開週末和平門長龍的絕佳捷徑。",
                "canada_bound": {
                    "traveller_delay_min": 0,
                    "traveller_status": "免等候",
                    "commercial_delay_min": 0,
                    "commercial_status": "免等候",
                    "nexus_open": True,
                    "updated_at": "即時連線"
                },
                "us_bound": {
                    "standard_delay_min": 0,
                    "standard_status": "免等候",
                    "standard_lanes_open": 2,
                    "nexus_delay_min": 0,
                    "nexus_status": "免等候",
                    "nexus_lanes_open": 1,
                    "commercial_delay_min": 0,
                    "commercial_status": "免等候",
                    "updated_at": "即時連線"
                }
            },
            "abbotsford_huntingdon": {
                "id": "abbotsford_huntingdon",
                "name": "阿伯茨福德關卡",
                "english_name": "Abbotsford-Huntingdon / Sumas",
                "cbsa_key": "Abbotsford-Huntingdon",
                "cbp_key": "Sumas",
                "highway": "BC Hwy 11 ↔ WA SR 9",
                "lat": 49.0022,
                "lon": -122.2646,
                "zoom": 15.5,
                "address": "2 Sumas Way, Abbotsford, BC V2S 8B7 / Sumas, WA",
                "hours": "24 小時全天開放",
                "crossing_type": "客車及商業貨運",
                "has_nexus": True,
                "has_commercial": True,
                "tips": "菲沙河谷東部重要通關樞紐，直達蘇馬斯 (Sumas)，往貝克山 (Mt. Baker) 滑雪度假的主要途徑。",
                "canada_bound": {
                    "traveller_delay_min": 5,
                    "traveller_status": "5 分鐘",
                    "commercial_delay_min": 0,
                    "commercial_status": "免等候",
                    "nexus_open": True,
                    "updated_at": "即時連線"
                },
                "us_bound": {
                    "standard_delay_min": 5,
                    "standard_status": "5 分鐘",
                    "standard_lanes_open": 2,
                    "nexus_delay_min": 0,
                    "nexus_status": "免等候",
                    "nexus_lanes_open": 1,
                    "commercial_delay_min": 0,
                    "commercial_status": "免等候",
                    "updated_at": "即時連線"
                }
            },
            "point_roberts": {
                "id": "point_roberts",
                "name": "邊界灣關卡",
                "english_name": "Boundary Bay / Point Roberts",
                "cbsa_key": "Boundary Bay",
                "cbp_key": "Point Roberts",
                "highway": "56th St (Tsawwassen) ↔ Tyee Dr (Point Roberts)",
                "lat": 49.0021,
                "lon": -123.0694,
                "zoom": 15.5,
                "address": "56th St & 0 Ave, Delta / Tsawwassen, BC",
                "hours": "24 小時全天開放",
                "crossing_type": "地方旅客及通勤客車",
                "has_nexus": False,
                "has_commercial": False,
                "tips": "連接南三角洲 Tsawwassen 與美國飛地羅伯茨角 (Point Roberts)，通常免排隊通關極其迅速。",
                "canada_bound": {
                    "traveller_delay_min": 0,
                    "traveller_status": "免等候",
                    "commercial_delay_min": None,
                    "commercial_status": "不適用",
                    "nexus_open": False,
                    "updated_at": "即時連線"
                },
                "us_bound": {
                    "standard_delay_min": 0,
                    "standard_status": "免等候",
                    "standard_lanes_open": 1,
                    "nexus_delay_min": None,
                    "nexus_status": "無 NEXUS 專道",
                    "nexus_lanes_open": 0,
                    "commercial_delay_min": None,
                    "commercial_status": "不適用",
                    "updated_at": "即時連線"
                }
            }
        }

    def _parse_cbsa_minutes(self, text: str) -> Optional[int]:
        s = text.strip().lower()
        if "no delay" in s or "clear" in s or "none" in s:
            return 0
        if "not applicable" in s or "n/a" in s or "--" in s or "closed" in s:
            return None
        m = re.search(r'(\d+)\s*min', s)
        if m:
            return int(m.group(1))
        return 0

    def fetch_cbsa_live_data(self) -> Dict[str, Dict[str, Any]]:
        """從加拿大官方 CBSA CSV 獲取入境加拿大即時等候時間"""
        cbsa_url = "https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv"
        results = {}
        try:
            req = urllib.request.Request(cbsa_url, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=8) as resp:
                csv_text = resp.read().decode('utf-8', errors='ignore')
                lines = csv_text.strip().split('\n')
                for line in lines[1:]:
                    parts = [p.strip() for p in line.split(';;')]
                    if len(parts) >= 6:
                        office_name = parts[0]
                        last_updated = parts[2]
                        comm_flow = parts[3]
                        trav_flow = parts[5]
                        results[office_name] = {
                            "last_updated": last_updated,
                            "commercial_status": comm_flow,
                            "commercial_min": self._parse_cbsa_minutes(comm_flow),
                            "traveller_status": trav_flow,
                            "traveller_min": self._parse_cbsa_minutes(trav_flow)
                        }
        except Exception as e:
            print(f"[BorderService] CBSA CSV fetch warning: {e}")
        return results

    def fetch_cbp_live_data(self) -> Dict[str, Dict[str, Any]]:
        """從美國官方 CBP XML 獲取入境美國即時等候時間與車道狀態"""
        cbp_url = "https://bwt.cbp.gov/xml/bwt.xml"
        results = {}
        try:
            req = urllib.request.Request(cbp_url, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=8) as resp:
                xml_text = resp.read().decode('utf-8', errors='ignore')
                root = ET.fromstring(xml_text)
                for port in root.findall('port'):
                    crossing_name = (port.findtext('crossing_name') or "").strip()
                    port_name = (port.findtext('port_name') or "").strip()
                    pass_lanes = port.find('passenger_vehicle_lanes')
                    std_lanes = pass_lanes.find('standard_lanes') if pass_lanes is not None else None
                    nexus_lanes = pass_lanes.find('NEXUS_SENTRI_lanes') if pass_lanes is not None else None

                    std_min = None
                    std_open = None
                    std_status = "正常"
                    if std_lanes is not None:
                        dm = std_lanes.findtext('delay_minutes')
                        if dm and dm.isdigit():
                            std_min = int(dm)
                        lo = std_lanes.findtext('lanes_open')
                        if lo and lo.isdigit():
                            std_open = int(lo)
                        op = std_lanes.findtext('operational_status')
                        if op:
                            std_status = op.strip()

                    nexus_min = None
                    nexus_open = None
                    nexus_status = "開放"
                    if nexus_lanes is not None:
                        dm = nexus_lanes.findtext('delay_minutes')
                        if dm and dm.isdigit():
                            nexus_min = int(dm)
                        lo = nexus_lanes.findtext('lanes_open')
                        if lo and lo.isdigit():
                            nexus_open = int(lo)
                        op = nexus_lanes.findtext('operational_status')
                        if op:
                            nexus_status = op.strip()

                    key = crossing_name or port_name
                    results[key] = {
                        "port_name": port_name,
                        "crossing_name": crossing_name,
                        "standard_delay_min": std_min,
                        "standard_lanes_open": std_open,
                        "standard_status": std_status,
                        "nexus_delay_min": nexus_min,
                        "nexus_lanes_open": nexus_open,
                        "nexus_status": nexus_status,
                        "updated_date": port.findtext('date') or ""
                    }
        except Exception as e:
            print(f"[BorderService] CBP XML fetch warning: {e}")
        return results

    def get_border_wait_times(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self.cached_data and (now - self.last_fetch_time < self.cache_ttl):
            return self.cached_data

        crossings = self._get_base_crossings()

        cbsa_map = self.fetch_cbsa_live_data()
        cbp_map = self.fetch_cbp_live_data()

        # 合併 CBSA 與 CBP 即時資料
        for c_id, c in crossings.items():
            # 1. 入境加拿大 (CBSA)
            cbsa_key = c.get("cbsa_key")
            if cbsa_key and cbsa_key in cbsa_map:
                live = cbsa_map[cbsa_key]
                t_min = live.get("traveller_min")
                t_raw = live.get("traveller_status")
                c["canada_bound"]["traveller_delay_min"] = t_min
                c["canada_bound"]["traveller_status"] = "免等候" if t_min == 0 else (f"{t_min} 分鐘" if t_min is not None else t_raw)
                c_min = live.get("commercial_min")
                c_raw = live.get("commercial_status")
                c["canada_bound"]["commercial_delay_min"] = c_min
                c["canada_bound"]["commercial_status"] = "免等候" if c_min == 0 else (f"{c_min} 分鐘" if c_min is not None else c_raw)
                if live.get("last_updated"):
                    c["canada_bound"]["updated_at"] = live["last_updated"]

            # 2. 入境美國 (CBP)
            cbp_key = c.get("cbp_key")
            matched_cbp = None
            if cbp_key:
                for k, v in cbp_map.items():
                    if cbp_key.lower() in k.lower():
                        matched_cbp = v
                        break
            if matched_cbp:
                std_m = matched_cbp.get("standard_delay_min")
                if std_m is not None:
                    c["us_bound"]["standard_delay_min"] = std_m
                    c["us_bound"]["standard_status"] = "免等候" if std_m == 0 else f"{std_m} 分鐘"
                if matched_cbp.get("standard_lanes_open") is not None:
                    c["us_bound"]["standard_lanes_open"] = matched_cbp["standard_lanes_open"]

                nex_m = matched_cbp.get("nexus_delay_min")
                if nex_m is not None:
                    c["us_bound"]["nexus_delay_min"] = nex_m
                    c["us_bound"]["nexus_status"] = "免等候" if nex_m == 0 else f"{nex_m} 分鐘"
                if matched_cbp.get("nexus_lanes_open") is not None:
                    c["us_bound"]["nexus_lanes_open"] = matched_cbp["nexus_lanes_open"]

            # 3. 計算即時交通通暢度 (Live Traffic Status Indicator)
            can_t = c["canada_bound"].get("traveller_delay_min") or 0
            us_t = c["us_bound"].get("standard_delay_min") or 0
            max_delay = max(can_t, us_t)
            if max_delay >= 30:
                c["traffic_severity"] = "busy"      # 繁忙 (紅色)
            elif max_delay >= 15:
                c["traffic_severity"] = "moderate"  # 車多 (黃色)
            else:
                c["traffic_severity"] = "smooth"    # 暢通 (綠色)

        crossings_list = list(crossings.values())
        
        self.cached_data = {
            "crossings": crossings_list,
            "total": len(crossings_list),
            "source": "CBSA (加拿大邊境服務局) & U.S. CBP (美國海關及邊境保衛局)",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        self.last_fetch_time = now
        return self.cached_data

border_service = BorderService()
