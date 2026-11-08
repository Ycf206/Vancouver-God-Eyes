import os
import sys

# Ensure backend root is in sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from yvr_airport_service import fetch_yvr_news_rss

def main():
    print("📰 [YVR News Sync] 正在同步溫哥華機場官方 RSS 最新資訊 (每日排程)...")
    items = fetch_yvr_news_rss(force_refresh=True)
    print(f"✅ [YVR News Sync] 成功同步 {len(items)} 則最新官方資訊！")

if __name__ == "__main__":
    main()
