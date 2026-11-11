import os
import json
import time
import tempfile
import threading
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

SYSTEM_LOGS_FILE = os.path.join(DATA_DIR, 'system_logs.json')
SYSTEM_LOGS_CONFIG_FILE = os.path.join(DATA_DIR, 'system_logs_config.json')
SCHEDULE_HISTORY_FILE = os.path.join(DATA_DIR, 'admin_schedule_history.json')
SCHEDULE_CONFIG_FILE = os.path.join(DATA_DIR, 'schedule_history_config.json')


def _atomic_write_json(path: str, payload: Any) -> None:
    """Thread/process-safe atomic JSON write via temp file + os.replace to prevent file truncation/corruption."""
    dir_name = os.path.dirname(os.path.abspath(path))
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise


def _is_ts_on_or_after(ts_str: Optional[str], cutoff: datetime) -> bool:
    """Safely compare ISO timestamp (naive or aware) against UTC-aware cutoff without raising TypeError/ValueError."""
    if not ts_str or not isinstance(ts_str, str):
        return True
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt >= cutoff
    except Exception:
        return True


class SystemLogService:
    def __init__(self):
        self._lock = threading.RLock()
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

        # 3. Ensure System Logs file exists (No fake mock sample logs, default to empty list)
        if not os.path.exists(SYSTEM_LOGS_FILE) or os.path.getsize(SYSTEM_LOGS_FILE) == 0:
            try:
                with open(SYSTEM_LOGS_FILE, 'w', encoding='utf-8') as f:
                    json.dump([], f, ensure_ascii=False, indent=2)
            except Exception:
                pass
        else:
            # Purge any legacy sample mock logs (e.g. syslog_..._1 to _5)
            try:
                with open(SYSTEM_LOGS_FILE, 'r', encoding='utf-8') as f:
                    existing_logs = json.load(f)
                if isinstance(existing_logs, list):
                    filtered_logs = [
                        lg for lg in existing_logs
                        if not (
                            isinstance(lg, dict) and
                            str(lg.get("id", "")).startswith("syslog_") and
                            str(lg.get("id", "")).endswith(("_1", "_2", "_3", "_4", "_5")) and
                            lg.get("action") in ("FETCH_VENDORS", "GTFS_RT_SYNC", "EVENTS_REFRESH", "TRAFFIC_INCIDENTS", "SYSTEM_STARTUP")
                        )
                    ]
                    if len(filtered_logs) != len(existing_logs):
                        _atomic_write_json(SYSTEM_LOGS_FILE, filtered_logs)
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
        days = max(0, min(3650, int(days)))
        with self._lock:
            try:
                _atomic_write_json(SYSTEM_LOGS_CONFIG_FILE, {"retention_days": days})
            except Exception:
                pass
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
        days = max(0, min(3650, int(days)))
        with self._lock:
            try:
                _atomic_write_json(SCHEDULE_CONFIG_FILE, {"retention_days": days})
            except Exception:
                pass
            self.prune_schedule_history(days)
        return days

    def prune_system_logs(self, retention_days: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            if retention_days is None:
                retention_days = self.get_system_retention_days()
            
            logs = self.read_system_logs_raw()
            if retention_days <= 0:
                return logs

            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            valid_logs = [l for l in logs if isinstance(l, dict) and _is_ts_on_or_after(l.get("timestamp"), cutoff)]

            if len(valid_logs) != len(logs):
                try:
                    _atomic_write_json(SYSTEM_LOGS_FILE, valid_logs[:2000])
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
        limit = max(1, min(2000, int(limit)))
        with self._lock:
            logs = self.prune_system_logs()
            sorted_logs = sorted(logs, key=lambda x: str(x.get("timestamp", "")), reverse=True)
            retention_days = self.get_system_retention_days()
            return {
                "logs": sorted_logs[:limit],
                "total": len(sorted_logs),
                "retention_days": retention_days
            }

    def add_system_log(self, level: str, file: str, action: str, message: str, details: Optional[Dict[str, Any]] = None):
        now_iso = datetime.now(timezone.utc).isoformat()
        entry = {
            "id": f"syslog_{int(time.time()*1000)}_{len(str(message))%1000}",
            "timestamp": now_iso,
            "level": str(level).upper(),
            "file": str(file)[:200],
            "action": str(action)[:100],
            "message": str(message)[:2000],
            "details": details if isinstance(details, dict) else {}
        }
        with self._lock:
            logs = self.read_system_logs_raw()
            logs.insert(0, entry)
            
            retention_days = self.get_system_retention_days()
            if retention_days > 0:
                cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
                logs = [l for l in logs if isinstance(l, dict) and _is_ts_on_or_after(l.get("timestamp"), cutoff)]

            try:
                _atomic_write_json(SYSTEM_LOGS_FILE, logs[:2000])
            except Exception:
                pass
        return entry

    def clear_system_logs(self):
        with self._lock:
            try:
                _atomic_write_json(SYSTEM_LOGS_FILE, [])
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
        with self._lock:
            if retention_days is None:
                retention_days = self.get_schedule_retention_days()

            history = self.read_schedule_history_raw()
            if retention_days <= 0:
                return history

            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            valid_items = [item for item in history if isinstance(item, dict) and _is_ts_on_or_after(item.get("timestamp"), cutoff)]

            if len(valid_items) != len(history):
                try:
                    _atomic_write_json(SCHEDULE_HISTORY_FILE, valid_items[:2000])
                except Exception:
                    pass
            return valid_items

    def get_schedule_history(self, limit: int = 500) -> Dict[str, Any]:
        limit = max(1, min(2000, int(limit)))
        with self._lock:
            history = self.prune_schedule_history()
            sorted_history = sorted(history, key=lambda x: str(x.get("timestamp", "")), reverse=True)
            return {
                "logs": sorted_history[:limit],
                "total": len(sorted_history),
                "retention_days": self.get_schedule_retention_days()
            }

    def append_schedule_log(self, log_entry: Dict[str, Any]):
        if not isinstance(log_entry, dict):
            return
        with self._lock:
            history = self.read_schedule_history_raw()
            history.insert(0, log_entry)
            
            retention_days = self.get_schedule_retention_days()
            if retention_days > 0:
                cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
                history = [h for h in history if isinstance(h, dict) and _is_ts_on_or_after(h.get("timestamp"), cutoff)]

            try:
                _atomic_write_json(SCHEDULE_HISTORY_FILE, history[:2000])
            except Exception:
                pass

    def clear_schedule_history(self):
        with self._lock:
            try:
                _atomic_write_json(SCHEDULE_HISTORY_FILE, [])
            except Exception:
                pass


class SystemLogCaptureHandler(logging.Handler):
    """
    自動系統日誌攔截處理器：
    自動攔截後端所有服務、定時任務與伺服器內部發生的 WARNING / ERROR / CRITICAL 事件，
    即使用戶尚未開啟管理後台頁面，也會自動持久化至 data/system_logs.json 中。
    """
    def __init__(self, service: SystemLogService, min_level: int = logging.WARNING):
        super().__init__(level=min_level)
        self.service = service
        self._in_emit = False

    def emit(self, record: logging.LogRecord):
        if self._in_emit:
            return
        # 避免循環日誌與過多內部雜訊
        if record.name.startswith("system_log_service") or record.name.startswith("py_gasbuddy"):
            return
        self._in_emit = True
        try:
            msg = self.format(record) if self.formatter else record.getMessage()
            details = {}
            if record.exc_info and record.exc_text:
                details["traceback"] = str(record.exc_text)[:1000]
            elif record.exc_info and record.exc_info[1]:
                details["exception"] = str(record.exc_info[1])[:500]
            if getattr(record, "args", None):
                try:
                    details["args"] = str(record.args)[:300]
                except Exception:
                    pass
            self.service.add_system_log(
                level=record.levelname,
                file=f"{record.filename}:{record.lineno}",
                action=record.funcName or record.name,
                message=msg,
                details=details if details else None
            )
        except Exception:
            pass
        finally:
            self._in_emit = False


def setup_automatic_system_logging(min_level: int = logging.WARNING):
    """將自動日誌保存處理器掛載至 root logger 與關鍵模組"""
    handler = SystemLogCaptureHandler(system_log_service, min_level=min_level)
    logging.getLogger().addHandler(handler)
    for name in ("uvicorn.error", "fastapi"):
        logging.getLogger(name).addHandler(handler)


system_log_service = SystemLogService()
setup_automatic_system_logging(logging.WARNING)

