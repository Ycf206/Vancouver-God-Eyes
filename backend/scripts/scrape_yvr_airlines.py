import os
import json
import re
import urllib.request
from bs4 import BeautifulSoup

URL = "https://www.yvr.ca/en/passengers/flights/airlines-and-destinations"
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "data", "yvrAirlines.json")

def scrape_airlines():
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            html_text = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"Fetch failed: {e}")
        return False

    soup = BeautifulSoup(html_text, "html.parser")
    rows = []
    
    # Try finding tables
    tables = soup.find_all("table")
    print(f"Found {len(tables)} tables")
    
    for table in tables:
        for tr in table.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            vals = [td.get_text(strip=True) for td in tds]
            if len(vals) >= 4 and vals[0].lower() != "airline":
                rows.append({
                    "airline": vals[0],
                    "code": vals[1],
                    "passenger_line": vals[2] or "—",
                    "media_line": vals[3] or "—"
                })
            elif len(vals) == 3 and vals[0].lower() != "airline":
                rows.append({
                    "airline": vals[0],
                    "code": vals[1],
                    "passenger_line": vals[2] or "—",
                    "media_line": "—"
                })

    if not rows:
        # Search for airline cards or lists if not in standard table
        items = soup.select(".airline-item, .airline-row, [data-airline]")
        for it in items:
            name = it.select_one(".name, h3, h4")
            code = it.select_one(".code")
            phone = it.select_one(".phone, .passenger")
            media = it.select_one(".media")
            if name:
                rows.append({
                    "airline": name.get_text(strip=True),
                    "code": code.get_text(strip=True) if code else "",
                    "passenger_line": phone.get_text(strip=True) if phone else "—",
                    "media_line": media.get_text(strip=True) if media else "—"
                })

    print(f"Extracted {len(rows)} airline rows")
    if rows:
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        return True
    return False

if __name__ == "__main__":
    scrape_airlines()
