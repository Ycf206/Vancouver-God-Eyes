import time
import re
import json
import html
import urllib.request
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class EventsService:
    def __init__(self):
        self.cached_events: List[Dict[str, Any]] = []
        self.last_fetch_time: float = 0.0
        self.cache_ttl: float = 600.0  # 10 minutes cache
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    def fetch_eventbrite_events(self) -> List[Dict[str, Any]]:
        events = []
        url = "https://www.eventbrite.ca/d/canada--vancouver/all-events/"
        try:
            req = urllib.request.Request(
                url, 
                headers={
                    "User-Agent": self.user_agent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9"
                }
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                content = resp.read().decode('utf-8', errors='ignore')
                ld_blocks = re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', content, re.DOTALL)
                for raw in ld_blocks:
                    try:
                        parsed = json.loads(raw.strip())
                        if isinstance(parsed, dict) and parsed.get('@type') == 'ItemList':
                            for it in parsed.get('itemListElement', []):
                                ev = it.get('item', {})
                                if ev.get('@type') == 'Event' or ev.get('name'):
                                    name = clean_html(ev.get('name', ''))
                                    ev_url = ev.get('url', '')
                                    if not name or not ev_url:
                                        continue
                                        
                                    start_date = ev.get('startDate', '')
                                    end_date = ev.get('endDate', '')
                                    
                                    loc = ev.get('location', {})
                                    loc_name = loc.get('name') if isinstance(loc, dict) else str(loc)
                                    addr = loc.get('address', {}) if isinstance(loc, dict) else {}
                                    addr_str = addr.get('streetAddress') if isinstance(addr, dict) else ''
                                    full_loc = f"{loc_name} · {addr_str}" if loc_name and addr_str else (loc_name or addr_str or "溫哥華 (Vancouver)")
                                    
                                    desc = clean_html(ev.get('description', '') or '')
                                    if len(desc) > 160:
                                        desc = desc[:157] + "..."
                                        
                                    img = ev.get('image', '') or None
                                    
                                    # Categorize
                                    lower_t = name.lower()
                                    if any(k in lower_t for k in ['concert', 'music', 'dj', 'band', 'live', 'orchestra', 'acoustic']):
                                        cat = '音樂演出'
                                    elif any(k in lower_t for k in ['conference', 'convention', 'summit', 'leadership', 'expo', 'forum']):
                                        cat = '商業峰會'
                                    elif any(k in lower_t for k in ['festival', 'gala', 'celebration', 'party', 'halloween', 'christmas', 'winter']):
                                        cat = '節慶慶典'
                                    elif any(k in lower_t for k in ['ski', 'board', 'run', 'marathon', 'sport', 'fitness', 'yoga']):
                                        cat = '戶外運動'
                                    elif any(k in lower_t for k in ['workshop', 'class', 'learn', 'training']):
                                        cat = '工作坊講座'
                                    elif any(k in lower_t for k in ['art', 'theatre', 'comedy', 'dance', 'film', 'screening']):
                                        cat = '藝文娛樂'
                                    else:
                                        cat = '社區活動'

                                    # Timestamp
                                    ts = 0
                                    if start_date:
                                        try:
                                            # Parse YYYY-MM-DD or ISO
                                            clean_d = start_date.replace('Z', '+00:00')
                                            dt = datetime.fromisoformat(clean_d)
                                            ts = int(dt.timestamp() * 1000)
                                        except Exception:
                                            pass

                                    events.append({
                                        "id": f"eb_{len(events)+1}",
                                        "title": name,
                                        "url": ev_url,
                                        "source": "Eventbrite",
                                        "source_id": "eventbrite",
                                        "start_date": start_date,
                                        "end_date": end_date,
                                        "location_name": full_loc,
                                        "category": cat,
                                        "description": desc,
                                        "image_url": img,
                                        "timestamp": ts or int(time.time() * 1000)
                                    })
                    except Exception:
                        continue
        except Exception as e:
            print(f"[EventsService] Eventbrite fetch error: {e}")
        return events

    def fetch_destination_vancouver_events(self) -> List[Dict[str, Any]]:
        events = []
        url = "https://www.destinationvancouver.com/events/events-calendar/"
        try:
            req = urllib.request.Request(
                url, 
                headers={
                    "User-Agent": self.user_agent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                html_text = resp.read().decode('utf-8', errors='ignore')
                url_matches = re.findall(r'https://www\.destinationvancouver\.com/events/([A-Za-z0-9\-_]+)-(\d{10})', html_text)
                
                seen_slugs = set()
                for slug, time_code in url_matches:
                    if slug in seen_slugs:
                        continue
                    seen_slugs.add(slug)
                    
                    title = slug.replace('-', ' ').strip()
                    title = re.sub(r'\s+', ' ', title)
                    
                    date_str = ""
                    ts = 0
                    try:
                        yy = int(time_code[0:2]) + 2000
                        mm = int(time_code[2:4])
                        dd = int(time_code[4:6])
                        hh = int(time_code[6:8])
                        mi = int(time_code[8:10])
                        dt = datetime(yy, mm, dd, hh, mi, tzinfo=timezone.utc)
                        date_str = f"{yy:04d}-{mm:02d}-{dd:02d} {hh:02d}:{mi:02d}"
                        ts = int(dt.timestamp() * 1000)
                    except Exception:
                        pass
                        
                    full_url = f"https://www.destinationvancouver.com/events/{slug}-{time_code}"
                    
                    lower_t = title.lower()
                    if any(w in lower_t for w in ['tour', 'concert', 'band', 'fighters', 'sing', 'music', 'symphony', 'orchestra', 'rush', 'acdc']):
                        cat = '音樂演唱會'
                        loc = 'BC Place / Rogers Arena / Orpheum'
                    elif any(w in lower_t for w in ['festival', 'childrens', 'pride', 'celebration']):
                        cat = '節慶盛會'
                        loc = '大溫哥華戶外園區'
                    elif any(w in lower_t for w in ['cup', 'match', 'vs', 'race', 'run', 'marathon', 'sport', '10k', 'warriors']):
                        cat = '體育賽事'
                        loc = '溫哥華體育場館'
                    elif any(w in lower_t for w in ['broadway', 'theatre', 'les miserables', 'cirque', 'clue', 'potter']):
                        cat = '藝文展演'
                        loc = 'Queen Elizabeth Theatre / 劇院'
                    elif any(w in lower_t for w in ['dine out', 'food', 'wine', 'beer']):
                        cat = '美食展覽'
                        loc = '溫哥華特色餐飲街區'
                    else:
                        cat = '特色活動'
                        loc = '溫哥華 (Vancouver, BC)'
                        
                    events.append({
                        "id": f"dv_{len(events)+1}",
                        "title": title,
                        "url": full_url,
                        "source": "Destination Vancouver",
                        "source_id": "destination_vancouver",
                        "start_date": date_str,
                        "end_date": "",
                        "location_name": loc,
                        "category": cat,
                        "description": f"溫哥華旅遊局 (Destination Vancouver) 推薦指標亮點盛事。點擊前往官方購票與詳情說明。",
                        "image_url": None,
                        "timestamp": ts or int(time.time() * 1000)
                    })
        except Exception as e:
            print(f"[EventsService] Destination Vancouver fetch error: {e}")
        return events

    def get_latest_events(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self.cached_events and (now - self.last_fetch_time < self.cache_ttl):
            return {
                "events": self.cached_events,
                "total": len(self.cached_events),
                "sources": ["Eventbrite", "Destination Vancouver"],
                "updated_at": datetime.fromtimestamp(self.last_fetch_time, tz=timezone.utc).isoformat()
            }

        all_events = []
        
        # 1. Fetch Eventbrite
        eb = self.fetch_eventbrite_events()
        all_events.extend(eb)
        
        # 2. Fetch Destination Vancouver
        dv = self.fetch_destination_vancouver_events()
        all_events.extend(dv)

        # Fallback if both blocked or empty
        if not all_events:
            all_events = self.get_fallback_events()

        # Sort: Upcoming events ordered by date/timestamp
        all_events.sort(key=lambda x: x.get("timestamp", 0))

        self.cached_events = all_events
        self.last_fetch_time = now

        return {
            "events": all_events,
            "total": len(all_events),
            "sources": ["Eventbrite", "Destination Vancouver"],
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

    def get_fallback_events(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "fb_1",
                "title": "2026 Winter Extreme Ski & Board Sale Vancouver",
                "url": "https://www.eventbrite.ca/d/canada--vancouver/all-events/",
                "source": "Eventbrite",
                "source_id": "eventbrite",
                "start_date": "2026-10-17",
                "end_date": "2026-10-18",
                "location_name": "Capilano Mall (935 Marine Drive)",
                "category": "戶外運動",
                "description": "每年冬季必訪滑雪裝備年度大展與特賣會，匯聚各大知名品牌。",
                "image_url": None,
                "timestamp": int(time.time() * 1000)
            },
            {
                "id": "fb_2",
                "title": "FIFA World Cup 2026 Round of 32 Match 85",
                "url": "https://www.destinationvancouver.com/events/events-calendar/",
                "source": "Destination Vancouver",
                "source_id": "destination_vancouver",
                "start_date": "2026-07-02 12:00",
                "end_date": "",
                "location_name": "BC Place Stadium",
                "category": "體育賽事",
                "description": "2026 美加墨世界盃足球賽溫哥華 32 強淘汰賽，BC Place 現場對決。",
                "image_url": None,
                "timestamp": int(time.time() * 1000) + 86400000
            },
            {
                "id": "fb_3",
                "title": "Broadway Across Canada: Les Misérables (悲慘世界)",
                "url": "https://www.destinationvancouver.com/events/events-calendar/",
                "source": "Destination Vancouver",
                "source_id": "destination_vancouver",
                "start_date": "2026-03-18 19:30",
                "end_date": "",
                "location_name": "Queen Elizabeth Theatre",
                "category": "藝文展演",
                "description": "百老匯傳奇音樂劇經典巨作《悲慘世界》巡演溫哥華站。",
                "image_url": None,
                "timestamp": int(time.time() * 1000) + 172800000
            },
            {
                "id": "fb_4",
                "title": "Dine Out Vancouver Festival 2026",
                "url": "https://www.dineoutvancouver.com/events/",
                "source": "Destination Vancouver",
                "source_id": "destination_vancouver",
                "start_date": "2026-01-21",
                "end_date": "2026-02-08",
                "location_name": "大溫哥華逾 300 間知名餐廳",
                "category": "美食展覽",
                "description": "加拿大最大型美食嘉年華，百間頂級名廚餐廳推出專屬套餐。",
                "image_url": None,
                "timestamp": int(time.time() * 1000) + 259200000
            }
        ]

def clean_html(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r'<[^>]+>', ' ', text)
    clean = html.unescape(clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

events_service = EventsService()

def get_latest_events(force_refresh: bool = False) -> Dict[str, Any]:
    return events_service.get_latest_events(force_refresh=force_refresh)
