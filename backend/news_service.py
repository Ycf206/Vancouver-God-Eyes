import time
import re
import html
import urllib.request
import xml.etree.ElementTree as ET
import email.utils
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

FEEDS = [
    {
        "id": "604now",
        "name": "604 Now",
        "category_default": "溫哥華生活",
        "badge_color": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
        "url": "https://604now.com/feed/",
        "site_url": "https://604now.com/"
    },
    {
        "id": "citynews",
        "name": "CityNews Vancouver",
        "category_default": "溫哥華要聞",
        "badge_color": "bg-red-500/20 text-red-300 border-red-500/30",
        "url": "https://vancouver.citynews.ca/feed/",
        "site_url": "https://vancouver.citynews.ca/"
    },
    {
        "id": "globalnews",
        "name": "Global News BC",
        "category_default": "卑詩要聞",
        "badge_color": "bg-sky-500/20 text-sky-300 border-sky-500/30",
        "url": "https://globalnews.ca/bc/feed/",
        "site_url": "https://globalnews.ca/bc/"
    },
    {
        "id": "dailyhive",
        "name": "Daily Hive",
        "category_default": "溫哥華焦點",
        "badge_color": "bg-amber-500/20 text-amber-300 border-amber-500/30",
        "url": "https://dailyhive.com/feed",
        "site_url": "https://dailyhive.com/vancouver/news"
    }
]

def clean_html(text: str) -> str:
    if not text:
        return ""
    # Remove HTML tags
    clean = re.sub(r'<[^>]+>', ' ', text)
    # Unescape HTML entities
    clean = html.unescape(clean)
    # Collapse multiple spaces
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def extract_image(item: ET.Element) -> Optional[str]:
    # 1. media:content or media:thumbnail
    for tag in ['{http://search.yahoo.com/mrss/}content', '{http://search.yahoo.com/mrss/}thumbnail', 'media:content', 'media:thumbnail']:
        elem = item.find(tag)
        if elem is not None and elem.attrib.get('url'):
            return elem.attrib['url']
        
    # 2. enclosure
    enclosure = item.find('enclosure')
    if enclosure is not None and enclosure.attrib.get('url'):
        mime = enclosure.attrib.get('type', '')
        if not mime or 'image' in mime:
            return enclosure.attrib['url']

    # 3. Check <img> tag inside description or content:encoded
    desc = item.findtext('description') or ''
    encoded = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or ''
    for text in [desc, encoded]:
        match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', text)
        if match:
            return match.group(1)
            
    return None

class NewsService:
    def __init__(self):
        self.cached_news: List[Dict[str, Any]] = []
        self.last_fetch_time: float = 0.0
        self.cache_ttl: float = 120.0  # 2 minutes default cache
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    def fetch_feed(self, feed_info: Dict[str, str]) -> List[Dict[str, Any]]:
        articles: List[Dict[str, Any]] = []
        try:
            req = urllib.request.Request(
                feed_info["url"], 
                headers={"User-Agent": self.user_agent, "Accept": "application/rss+xml, application/xml, text/xml"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                xml_data = resp.read()
                root = ET.fromstring(xml_data)
                items = root.findall(".//item")

                for it in items:
                    title = clean_html(it.findtext("title") or "")
                    link = (it.findtext("link") or "").strip()
                    if not title or not link:
                        continue

                    # Filter Daily Hive items to Vancouver local news
                    if feed_info["id"] == "dailyhive":
                        if "/vancouver/" not in link and "vancouver" not in title.lower():
                            continue

                    pub_raw = it.findtext("pubDate") or ""
                    parsed_ts = 0
                    iso_time = ""
                    if pub_raw:
                        try:
                            dt = email.utils.parsedate_to_datetime(pub_raw)
                            parsed_ts = int(dt.timestamp() * 1000)
                            iso_time = dt.isoformat()
                        except Exception:
                            parsed_ts = int(time.time() * 1000)

                    # Category
                    category = it.findtext("category") or feed_info["category_default"]
                    category = clean_html(category)

                    # Description / Summary
                    desc_raw = it.findtext("description") or ""
                    summary = clean_html(desc_raw)
                    if len(summary) > 160:
                        summary = summary[:157] + "..."

                    # Image
                    image_url = extract_image(it)

                    articles.append({
                        "id": f"{feed_info['id']}_{abs(hash(link))}",
                        "title": title,
                        "url": link,
                        "source": feed_info["name"],
                        "source_id": feed_info["id"],
                        "category": category or feed_info["category_default"],
                        "summary": summary,
                        "image_url": image_url,
                        "published_at": iso_time,
                        "pub_date_raw": pub_raw,
                        "timestamp": parsed_ts
                    })
        except Exception as e:
            print(f"[NewsService] Error fetching {feed_info['name']}: {e}")

        return articles

    def get_latest_news(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self.cached_news and (now - self.last_fetch_time < self.cache_ttl):
            return {
                "news": self.cached_news,
                "total": len(self.cached_news),
                "updated_at": datetime.fromtimestamp(self.last_fetch_time, timezone.utc).isoformat(),
                "from_cache": True
            }

        all_articles: List[Dict[str, Any]] = []
        for feed in FEEDS:
            feed_articles = self.fetch_feed(feed)
            all_articles.extend(feed_articles)

        if all_articles:
            # 排序以最上面由最新開始 (Sort by timestamp descending)
            all_articles.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
            self.cached_news = all_articles
            self.last_fetch_time = now

        return {
            "news": self.cached_news,
            "total": len(self.cached_news),
            "updated_at": datetime.fromtimestamp(self.last_fetch_time, timezone.utc).isoformat(),
            "from_cache": False
        }

news_service = NewsService()
