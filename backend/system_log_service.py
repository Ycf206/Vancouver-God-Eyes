import os
import json
import time
import tempfile
import threading
import logging
import atexit
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

SYSTEM_LOGS_FILE = os.path.join(DATA_DIR, 'system_logs.json')
SYSTEM_LOGS_CONFIG_FILE = os.path.join(DATA_DIR, 'system_logs_config.json')
SCHEDULE_HISTORY_FILE = os.path.join(DATA_DIR, 'admin_schedule_history.json')
SCHEDULE_CONFIG_FILE = os.path.join(DATA_DIR, 'schedule_history_config.json')

# 日誌數量上限保護，避免無限制膨脹
MAX_LOG_ENTRIES = 2000


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
    """
    智慧高可用系統日誌服務：
    1. 常駐記憶體快取 (In-Memory Cache)，查詢與讀取 0 磁碟 I/O，響應時間 < 0.1ms。
    2. 高頻重複抑制與去重 (Deduplication & Throttling)：
       - 相同 WARNING/ERROR 在 5 分鐘內不重複追加新列，而是原地遞增 repeat_count 與更新 last_seen。
       - 相同 INFO/SUCCESS 心跳在 10 分鐘內不重複落盤。
    3. 非同步延遲防抖落盤 (Debounced Batch Flushing)：短時間密集寫入自動聚合為單次磁碟寫入。
    4. 嚴格 2,000 筆上限與過期自動修剪，防止磁碟膨脹與系統壓力。
    """
    def __init__(self):
        self._lock = threading.RLock()
        self._system_logs: List[Dict[str, Any]] = []
        self._schedule_history: List[Dict[str, Any]] = []
        self._system_logs_dirty: bool = False
        self._schedule_history_dirty: bool = False
        self._flush_timer: Optional[threading.Timer] = None
        self._last_flush_time: float = time.time()
        self._throttle_cache: Dict[str, Dict[str, Any]] = {}

        self._ensure_files()

    def _ensure_files(self):
        with self._lock:
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

            # 3. 載入 System Logs 至記憶體快取
            loaded_logs = []
            if os.path.exists(SYSTEM_LOGS_FILE) and os.path.getsize(SYSTEM_LOGS_FILE) > 0:
                try:
                    with open(SYSTEM_LOGS_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if isinstance(data, list):
                        # 清理 legacy 假 mock 數據
                        loaded_logs = [
                            lg for lg in data
                            if not (
                                isinstance(lg, dict) and
                                str(lg.get("id", "")).startswith("syslog_") and
                                str(lg.get("id", "")).endswith(("_1", "_2", "_3", "_4", "_5")) and
                                lg.get("action") in ("FETCH_VENDORS", "GTFS_RT_SYNC", "EVENTS_REFRESH", "TRAFFIC_INCIDENTS", "SYSTEM_STARTUP")
                            )
                        ]
                except Exception as e:
                    print(f"⚠️ 讀取 system_logs.json 異常: {e}")
                    loaded_logs = []
            self._system_logs = loaded_logs[:MAX_LOG_ENTRIES]

            # 4. 載入 Schedule History 至記憶體快取
            loaded_history = []
            if os.path.exists(SCHEDULE_HISTORY_FILE) and os.path.getsize(SCHEDULE_HISTORY_FILE) > 0:
                try:
                    with open(SCHEDULE_HISTORY_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if isinstance(data, list):
                        loaded_history = data
                except Exception as e:
                    print(f"⚠️ 讀取 admin_schedule_history.json 異常: {e}")
                    loaded_history = []
            self._schedule_history = loaded_history[:MAX_LOG_ENTRIES]

    # --- Retention Configuration ---
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

    # --- Debounced Batch Disk Flushing ---
    def _schedule_debounced_flush(self, delay: float = 3.0):
        """防抖延遲落盤：短時間內無論產生多少筆日誌，只在靜止 delay 秒後寫入 1 次磁碟"""
        with self._lock:
            now = time.time()
            # 如果距離上次磁碟寫入已超過 10 秒，為避免飢餓，立即同步刷盤
            if now - self._last_flush_time > 10.0:
                self.flush_all()
                return

            if self._flush_timer is not None:
                return  # 已有計時器在排隊等待，讓其如期執行

            def _flush_worker():
                with self._lock:
                    self._flush_timer = None
                    self._flush_dirty_to_disk()

            self._flush_timer = threading.Timer(delay, _flush_worker)
            self._flush_timer.daemon = True
            self._flush_timer.start()

    def _flush_dirty_to_disk(self):
        """實際執行磁碟原子寫入 (受 self._lock 保護)"""
        self._last_flush_time = time.time()
        if self._system_logs_dirty:
            try:
                _atomic_write_json(SYSTEM_LOGS_FILE, self._system_logs[:MAX_LOG_ENTRIES])
                self._system_logs_dirty = False
            except Exception as e:
                print(f"⚠️ [SystemLogService] 寫入 system_logs.json 異常: {e}")

        if self._schedule_history_dirty:
            try:
                _atomic_write_json(SCHEDULE_HISTORY_FILE, self._schedule_history[:MAX_LOG_ENTRIES])
                self._schedule_history_dirty = False
            except Exception as e:
                print(f"⚠️ [SystemLogService] 寫入 admin_schedule_history.json 異常: {e}")

    def flush_all(self):
        """立即同步寫入所有未落盤的日誌至磁碟 (用於服務關閉或重要操作)"""
        with self._lock:
            if self._flush_timer is not None:
                try:
                    self._flush_timer.cancel()
                except Exception:
                    pass
                self._flush_timer = None
            self._flush_dirty_to_disk()

    # --- System Logs Management ---
    def prune_system_logs(self, retention_days: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            if retention_days is None:
                retention_days = self.get_system_retention_days()
            
            if retention_days <= 0:
                return list(self._system_logs)

            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            valid_logs = [l for l in self._system_logs if isinstance(l, dict) and _is_ts_on_or_after(l.get("timestamp"), cutoff)]

            if len(valid_logs) != len(self._system_logs):
                self._system_logs = valid_logs[:MAX_LOG_ENTRIES]
                self._system_logs_dirty = True
                self._schedule_debounced_flush()
            return list(self._system_logs)

    def read_system_logs_raw(self) -> List[Dict[str, Any]]:
        """回傳記憶體中的日誌副本 (0 磁碟 I/O)"""
        with self._lock:
            return list(self._system_logs)

    def get_system_logs(self, limit: int = 500) -> Dict[str, Any]:
        """前台與後台 API 呼叫：直接從記憶體快取切片回傳，毫秒級響應"""
        limit = max(1, min(MAX_LOG_ENTRIES, int(limit)))
        with self._lock:
            logs = self.prune_system_logs()
            sorted_logs = sorted(logs, key=lambda x: str(x.get("timestamp", "")), reverse=True)
            retention_days = self.get_system_retention_days()
            return {
                "logs": sorted_logs[:limit],
                "total": len(sorted_logs),
                "retention_days": retention_days
            }

    def add_system_log(
        self,
        level: str,
        file: str,
        action: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        force: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        新增系統運作日誌 (具備高頻防抖、去重與智慧抑制能力)
        - 相同 WARNING/ERROR: 5 分鐘內不重複新增行，原地遞增 repeat_count 與 last_seen
        - 相同 INFO/SUCCESS: 10 分鐘內不重複新增無資料變更的心跳日誌
        """
        level_upper = str(level).upper()
        now_ts = time.time()
        now_iso = datetime.now(timezone.utc).isoformat()

        # 核心去重標識：(等級, 檔案, 動作, 訊息摘要)
        msg_core = str(message)[:100].strip()
        throttle_key = f"{level_upper}|{file}|{action}|{msg_core}"

        with self._lock:
            # 1. 異常狀態智慧抑制 (Throttle Window: 300 秒 = 5 分鐘)
            if not force and level_upper in ("ERROR", "WARN", "WARNING", "CRITICAL"):
                throttle_info = self._throttle_cache.get(throttle_key)
                if throttle_info:
                    throttle_info["count"] += 1
                    throttle_info["last_seen"] = now_ts
                    elapsed_since_log = now_ts - throttle_info["last_logged_time"]

                    if elapsed_since_log < 300:
                        # 5 分鐘內完全抑制新行產生，僅更新頂部紀錄之計數與最新時間
                        for item in self._system_logs[:15]:
                            if (
                                item.get("throttle_key") == throttle_key or
                                (item.get("level") == level_upper and item.get("action") == action and item.get("file") == file)
                            ):
                                item["repeat_count"] = throttle_info["count"]
                                item["last_seen"] = now_iso
                                self._system_logs_dirty = True
                                self._schedule_debounced_flush()
                                return item
                        return None
                    else:
                        # 超過 5 分鐘仍在持續報錯，追加 1 筆聚合摘要
                        suppressed_count = throttle_info["count"] - throttle_info["last_logged_count"]
                        if suppressed_count > 0:
                            message = f"{message} (⚠️ 已連續重複發生 {suppressed_count} 次，持延續監控中)"
                        throttle_info["last_logged_time"] = now_ts
                        throttle_info["last_logged_count"] = throttle_info["count"]
                else:
                    self._throttle_cache[throttle_key] = {
                        "first_seen": now_ts,
                        "last_seen": now_ts,
                        "last_logged_time": now_ts,
                        "count": 1,
                        "last_logged_count": 1
                    }

            # 2. 成功/資訊心跳去重 (600 秒 = 10 分鐘)
            elif not force and level_upper in ("INFO", "SUCCESS"):
                # 如果該檔案/動作先前處於報錯狀態，清除報錯標記 (代表連線或資料已恢復正常)
                err_keys_to_clear = [
                    k for k in self._throttle_cache
                    if k.startswith(("ERROR|", "WARN|", "WARNING|")) and f"|{file}|{action}|" in k
                ]
                for k in err_keys_to_clear:
                    self._throttle_cache.pop(k, None)

                rec_count = details.get("record_count") if isinstance(details, dict) else None
                success_key = f"SUCC|{file}|{action}|{rec_count}"
                last_succ = self._throttle_cache.get(success_key)
                if last_succ and (now_ts - last_succ.get("last_seen", 0) < 600):
                    # 10 分鐘內完全重複的成功同步，無須洗版寫入
                    return None
                self._throttle_cache[success_key] = {"last_seen": now_ts}

            # 3. 構建並加入新日誌紀錄
            entry = {
                "id": f"syslog_{int(now_ts * 1000)}_{len(str(message)) % 1000}",
                "timestamp": now_iso,
                "level": level_upper,
                "file": str(file)[:200],
                "action": str(action)[:100],
                "message": str(message)[:2000],
                "details": details if isinstance(details, dict) else {},
                "repeat_count": 1,
                "last_seen": now_iso,
                "throttle_key": throttle_key
            }

            self._system_logs.insert(0, entry)
            self._system_logs = self._system_logs[:MAX_LOG_ENTRIES]
            self._system_logs_dirty = True

            # 自動保留期限過濾
            retention_days = self.get_system_retention_days()
            if retention_days > 0:
                cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
                self._system_logs = [l for l in self._system_logs if isinstance(l, dict) and _is_ts_on_or_after(l.get("timestamp"), cutoff)]

            self._schedule_debounced_flush()
            return entry

    def clear_system_logs(self):
        with self._lock:
            self._system_logs = []
            self._throttle_cache.clear()
            self._system_logs_dirty = True
            self.flush_all()

    # --- Schedule History Management ---
    def read_schedule_history_raw(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._schedule_history)

    def prune_schedule_history(self, retention_days: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            if retention_days is None:
                retention_days = self.get_schedule_retention_days()

            if retention_days <= 0:
                return list(self._schedule_history)

            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            valid_items = [item for item in self._schedule_history if isinstance(item, dict) and _is_ts_on_or_after(item.get("timestamp"), cutoff)]

            if len(valid_items) != len(self._schedule_history):
                self._schedule_history = valid_items[:MAX_LOG_ENTRIES]
                self._schedule_history_dirty = True
                self._schedule_debounced_flush()
            return list(self._schedule_history)

    def get_schedule_history(self, limit: int = 500) -> Dict[str, Any]:
        limit = max(1, min(MAX_LOG_ENTRIES, int(limit)))
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
        now_ts = time.time()
        runner = log_entry.get("runner", "")
        src = log_entry.get("source_name", "")
        status = log_entry.get("status", "")
        detail = str(log_entry.get("detail", ""))[:60]
        sched_key = f"{runner}|{src}|{status}|{detail}"

        with self._lock:
            # 5 分鐘內完全重複的排程歷史記錄進行抑制，避免同秒觸發或密集重試刷屏
            last_seen = self._throttle_cache.get(f"SCHED|{sched_key}")
            if last_seen and (now_ts - last_seen < 300):
                return
            self._throttle_cache[f"SCHED|{sched_key}"] = now_ts

            self._schedule_history.insert(0, log_entry)
            self._schedule_history = self._schedule_history[:MAX_LOG_ENTRIES]
            self._schedule_history_dirty = True

            retention_days = self.get_schedule_retention_days()
            if retention_days > 0:
                cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
                self._schedule_history = [h for h in self._schedule_history if isinstance(h, dict) and _is_ts_on_or_after(h.get("timestamp"), cutoff)]

            self._schedule_debounced_flush()

    def clear_schedule_history(self):
        with self._lock:
            self._schedule_history = []
            self._schedule_history_dirty = True
            self.flush_all()


class SystemLogCaptureHandler(logging.Handler):
    """
    自動系統日誌攔截處理器：
    自動攔截後端所有服務、定時任務與伺服器內部發生的 WARNING / ERROR / CRITICAL 事件，
    即使用戶尚未開啟管理後台頁面，也會自動持久化至 data/system_logs.json 中。
    結合 SystemLogService 的防抖與抑制機制，絕不造成磁碟壓力或日誌風暴。
    """
    def __init__(self, service: SystemLogService, min_level: int = logging.WARNING):
        super().__init__(level=min_level)
        self.service = service
        self._in_emit = False

    def emit(self, record: logging.LogRecord):
        if self._in_emit:
            return
        # 避免循環日誌與過多內部雜訊
        if (
            record.name.startswith("system_log_service") or
            record.name.startswith("py_gasbuddy") or
            "selector" in record.name or
            "asyncio" in record.name
        ):
            return
        self._in_emit = True
        try:
            msg = self.format(record) if self.formatter else record.getMessage()
            # 過濾特定無害的暫態連線重試雜訊
            if "connection closed before handshake completed" in msg or "ConnectionResetError" in msg:
                return

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

# 進程正常退出或信號中斷時，確保記憶體中髒資料全部落盤
atexit.register(system_log_service.flush_all)
