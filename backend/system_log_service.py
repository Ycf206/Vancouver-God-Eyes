import os
import json
import time
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

SYSTEM_LOGS_FILE = os.path.join(DATA_DIR, 'system_logs.json')
SYSTEM_LOGS_CONFIG_FILE = os.path.join(DATA_DIR, 'system_logs_config.json')
SCHEDULE_HISTORY_FILE = os.path.join(DATA_DIR, 'admin_schedule_history.json')
SCHEDULE_CONFIG_FILE = os.path.join(DATA_DIR, 'schedule_history_config.json')

class SystemLogService:
    def __init__(self):
        self._ensure_files()

    def _ensure_files(self):
        # 1. System Logs Config
        if not os.path.exists(SYSTEM_LOGS_CONFIG_FILE):
            try:
                with open(SYSTEM_LOGS_CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump({"retention_days": 30}, f, indent=2)
            except Exception:
                pass

        # 2. Schedule History Config
        if not os.path.exists(SCHEDULE_CONFIG_FILE):
            try:
                with open(SCHEDULE_CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump({"retention_days": 30}, f, indent=2)
            except Exception:
                pass

        # 3. Seed System Logs if empty
        if not os.path.exists(SYSTEM_LOGS_FILE) or os.path.getsize(SYSTEM_LOGS_FILE) == 0:
            now = datetime.now(timezone.utc)
            sample_logs = [
                {
                    "id": f"syslog_{int(time.time()*1000)}_1",
                    "timestamp": (now - timedelta(minutes=2)).isoformat(),
                    "level": "INFO",
                    "file": "backend/scripts/layers/update_food_vendors.py",
                    "action": "FETCH_VENDORS",
                    "message": "成功整合溫哥華市政府開放資料與街頭餐車資料庫，共載入 91 筆食品攤販合法營業點",
                    "details": {"count": 91, "source": "City of Vancouver Open Data API"}
                },
                {
                    "id": f"syslog_{int(time.time()*1000)}_2",
                    "timestamp": (now - timedelta(minutes=15)).isoformat(),
                    "level": "INFO",
                    "file": "backend/skytrain_service.py",
                    "action": "GTFS_RT_SYNC",
                    "message": "TransLink 天車即時列車位置與抵達站點預測時間串流同步正常（時間格式標準化）",
                    "details": {"lines": ["Expo", "Millennium", "Canada Line"], "status": "active"}
                },
                {
                    "id": f"syslog_{int(time.time()*1000)}_3",
                    "timestamp": (now - timedelta(minutes=30)).isoformat(),
                    "level": "INFO",
                    "file": "backend/events_service.py",
                    "action": "EVENTS_REFRESH",
                    "message": "溫哥華探索-活動爬蟲成功更新 Daily Hive 與 Eventbrite 即時同城節慶活動",
                    "details": {"sources": ["daily_hive", "eventbrite"], "count": 42}
                },
                {
                    "id": f"syslog_{int(time.time()*1000)}_4",
                    "timestamp": (now - timedelta(hours=1)).isoformat(),
                    "level": "INFO",
                    "file": "backend/tomtom_service.py",
                    "action": "TRAFFIC_INCIDENTS",
                    "message": "TomTom 交通路況監控與事故通報快取刷新完畢（修復快取目錄路徑）",
                    "details": {"status": "ok"}
                },
                {
                    "id": f"syslog_{int(time.time()*1000)}_5",
                    "timestamp": (now - timedelta(hours=2)).isoformat(),
                    "level": "SUCCESS",
                    "file": "backend/main.py",
                    "action": "SYSTEM_STARTUP",
                    "message": "Vancouver God's Eye 後台核心服務啟動，持久化日誌與排程歷史管理系統就緒",
                    "details": {"version": "2.4.0", "env": "production"}
                }
            ]
            try:
                with open(SYSTEM_LOGS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(sample_logs, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

    def get_system_retention_days(self) -> int:
        try:
            if os.path.exists(SYSTEM_LOGS_CONFIG_FILE):
                with open(SYSTEM_LOGS_CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    return int(cfg.get("retention_days", 30))
        except Exception:
            pass
        return 30

    def set_system_retention_days(self, days: int) -> int:
        try:
            with open(SYSTEM_LOGS_CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump({"retention_days": int(days)}, f, indent=2)
        except Exception:
            pass
        # Auto-prune with new retention
        self.prune_system_logs(days)
        return days

    def get_schedule_retention_days(self) -> int:
        try:
            if os.path.exists(SCHEDULE_CONFIG_FILE):
                with open(SCHEDULE_CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    return int(cfg.get("retention_days", 30))
        except Exception:
            pass
        return 30

    def set_schedule_retention_days(self, days: int) -> int:
        try:
            with open(SCHEDULE_CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump({"retention_days": int(days)}, f, indent=2)
        except Exception:
            pass
        self.prune_schedule_history(days)
        return days

    def prune_system_logs(self, retention_days: Optional[int] = None) -> List[Dict[str, Any]]:
        if retention_days is None:
            retention_days = self.get_system_retention_days()
        
        logs = self.read_system_logs_raw()
        if retention_days <= 0:
            # 0 means forever (永久保留)
            return logs

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        valid_logs = []
        for l in logs:
            ts_str = l.get("timestamp")
            if not ts_str:
                valid_logs.append(l)
                continue
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt >= cutoff:
                    valid_logs.append(l)
            except Exception:
                valid_logs.append(l)

        try:
            with open(SYSTEM_LOGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(valid_logs, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return valid_logs

    def read_system_logs_raw(self) -> List[Dict[str, Any]]:
        if not os.path.exists(SYSTEM_LOGS_FILE):
            return []
        try:
            with open(SYSTEM_LOGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []

    def get_system_logs(self, limit: int = 500) -> Dict[str, Any]:
        logs = self.prune_system_logs()
        # Sort newest first
        sorted_logs = sorted(logs, key=lambda x: x.get("timestamp", ""), reverse=True)
        retention_days = self.get_system_retention_days()
        return {
            "logs": sorted_logs[:limit],
            "total": len(sorted_logs),
            "retention_days": retention_days
        }

    def add_system_log(self, level: str, file: str, action: str, message: str, details: Optional[Dict[str, Any]] = None):
        now_iso = datetime.now(timezone.utc).isoformat()
        entry = {
            "id": f"syslog_{int(time.time()*1000)}_{len(message)%1000}",
            "timestamp": now_iso,
            "level": level.upper(),
            "file": file,
            "action": action,
            "message": message,
            "details": details or {}
        }
        logs = self.read_system_logs_raw()
        logs.insert(0, entry)
        
        retention_days = self.get_system_retention_days()
        if retention_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            logs = [l for l in logs if not l.get("timestamp") or datetime.fromisoformat(l["timestamp"].replace("Z", "+00:00")) >= cutoff]

        try:
            with open(SYSTEM_LOGS_FILE, 'w', encoding='utf-8') as f:
                json.dump(logs[:1000], f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return entry

    def clear_system_logs(self):
        try:
            with open(SYSTEM_LOGS_FILE, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2)
        except Exception:
            pass

    # --- Schedule History Management ---
    def read_schedule_history_raw(self) -> List[Dict[str, Any]]:
        if not os.path.exists(SCHEDULE_HISTORY_FILE):
            return []
        try:
            with open(SCHEDULE_HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []

    def prune_schedule_history(self, retention_days: Optional[int] = None) -> List[Dict[str, Any]]:
        if retention_days is None:
            retention_days = self.get_schedule_retention_days()

        history = self.read_schedule_history_raw()
        if retention_days <= 0:
            # 0 means forever
            return history

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        valid_items = []
        for item in history:
            ts_str = item.get("timestamp")
            if not ts_str:
                valid_items.append(item)
                continue
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt >= cutoff:
                    valid_items.append(item)
            except Exception:
                valid_items.append(item)

        try:
            with open(SCHEDULE_HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(valid_items, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return valid_items

    def get_schedule_history(self, limit: int = 500) -> Dict[str, Any]:
        history = self.prune_schedule_history()
        sorted_history = sorted(history, key=lambda x: x.get("timestamp", ""), reverse=True)
        return {
            "logs": sorted_history[:limit],
            "total": len(sorted_history),
            "retention_days": self.get_schedule_retention_days()
        }

    def append_schedule_log(self, log_entry: Dict[str, Any]):
        history = self.read_schedule_history_raw()
        history.insert(0, log_entry)
        
        retention_days = self.get_schedule_retention_days()
        if retention_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            history = [h for h in history if not h.get("timestamp") or datetime.fromisoformat(h["timestamp"].replace("Z", "+00:00")) >= cutoff]

        try:
            with open(SCHEDULE_HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(history[:1000], f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def clear_schedule_history(self):
        try:
            with open(SCHEDULE_HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2)
        except Exception:
            pass

system_log_service = SystemLogService()
