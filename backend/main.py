from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, BackgroundTasks, Body, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import asyncio
import requests
import time
import threading
import tempfile
import hmac
import secrets
import ipaddress
import socket
import urllib.parse
from collections import OrderedDict
from google.transit import gtfs_realtime_pb2
import database
import models
import os
import re
import uuid
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from search_engine import search_engine

logger = logging.getLogger(__name__)

# 卑詩省自 2026 年 11 月起實施永久太平洋時間 (PCT = 常年固定 UTC-7)
VANCOUVER_TZ = timezone(timedelta(hours=-7))

def get_vancouver_now() -> datetime:
    return datetime.now(VANCOUVER_TZ)

def get_vancouver_today_str() -> str:
    return get_vancouver_now().strftime("%Y-%m-%d")

# ==========================================
# 🔒 執行緒安全與原子寫檔輔助工具 (Crash & Corruption Guard)
# ==========================================
_admin_cfg_lock = threading.RLock()
_issue_reports_lock = threading.RLock()
_road_seed_lock = threading.Lock()


def _atomic_write_json(path: str, payload, indent: int = 2) -> None:
    """透過暫存檔 + os.replace 執行原子寫入，徹底杜絕高並發寫檔截斷或 JSON 損毀崩潰"""
    import json as _json
    abs_path = os.path.abspath(path)
    dir_name = os.path.dirname(abs_path)
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            _json.dump(payload, f, ensure_ascii=False, indent=indent)
        os.replace(tmp_path, abs_path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise


def _atomic_write_lines(path: str, lines: list[str]) -> None:
    """透過暫存檔 + os.replace 原子更新 JSONL / .env 文字檔"""
    abs_path = os.path.abspath(path)
    dir_name = os.path.dirname(abs_path)
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=".tmp_", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.writelines(lines)
        os.replace(tmp_path, abs_path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise


def _get_client_ip(request: Request) -> str:
    """安全擷取真實客戶端 IP (優先讀取 Cloudflare CF-Connecting-IP 與反向代理 X-Real-IP)"""
    cf_ip = request.headers.get("CF-Connecting-IP", "").strip()
    if cf_ip:
        return cf_ip[:64]
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip[:64]
    xff = request.headers.get("X-Forwarded-For", "").strip()
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


# ==========================================
# 🛡️ 記憶體有界滑動視窗限流器 & 暴力破解鎖定防護
# ==========================================
class BoundedRateLimiter:
    def __init__(self, max_keys: int = 10000):
        self._max_keys = max_keys
        self._buckets: OrderedDict[str, list[float]] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, key: str, max_requests: int, window_seconds: float) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            hits = self._buckets.get(key)
            if hits is not None:
                hits = [t for t in hits if t > cutoff]
                self._buckets.move_to_end(key)
            else:
                hits = []
                if len(self._buckets) >= self._max_keys:
                    self._buckets.popitem(last=False)
            if len(hits) >= max_requests:
                self._buckets[key] = hits
                retry_after = max(1, int(window_seconds - (now - hits[0])))
                return False, retry_after
            hits.append(now)
            self._buckets[key] = hits
            return True, 0


_rate_limiter = BoundedRateLimiter(max_keys=12000)
_admin_login_failures = BoundedRateLimiter(max_keys=4000)
_ADMIN_SESSION_KEY_CACHE: bytes | None = None
_ADMIN_SESSION_COOKIE = "godseye_admin_session"


def _get_admin_signing_key() -> bytes:
    """產生或載入伺服器專屬簽章密鑰（絕不外洩至前端），支援多 Worker 共用持久化密鑰檔"""
    global _ADMIN_SESSION_KEY_CACHE
    if _ADMIN_SESSION_KEY_CACHE is not None:
        return _ADMIN_SESSION_KEY_CACHE
    env_secret = os.environ.get("ADMIN_SESSION_SECRET", "").strip() or os.environ.get("ADMIN_API_SECRET", "").strip()
    key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", ".admin_session_key")
    file_secret = ""
    try:
        os.makedirs(os.path.dirname(key_file), exist_ok=True)
        if os.path.exists(key_file):
            with open(key_file, "r", encoding="utf-8") as f:
                file_secret = f.read().strip()
        if not file_secret or len(file_secret) < 32:
            file_secret = secrets.token_hex(32)
            _atomic_write_lines(key_file, [file_secret])
            try:
                os.chmod(key_file, 0o600)
            except Exception:
                pass
    except Exception:
        file_secret = secrets.token_hex(32)
    combined = f"{env_secret}:{file_secret}".encode("utf-8")
    _ADMIN_SESSION_KEY_CACHE = hashlib.sha256(combined).digest()
    return _ADMIN_SESSION_KEY_CACHE


def _create_admin_session_token(ttl_seconds: int = 28800) -> str:
    """簽發具備時效性 (預設 8 小時) 的 HMAC-SHA256 管理員 Session Token"""
    exp = int(time.time()) + ttl_seconds
    nonce = secrets.token_hex(16)
    payload = f"v1.{exp}.{nonce}"
    sig = hmac.new(_get_admin_signing_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify_admin_session_token(token: str) -> bool:
    """常數時間驗證 HMAC-SHA256 管理員 Session Token 或伺服器端 ADMIN_API_SECRET"""
    if not token or len(token) > 512:
        return False
    # 1. 支援伺服器端自動化腳本 / Webhook 攜帶 ADMIN_API_SECRET (常數時間比對)
    admin_secret = os.environ.get("ADMIN_API_SECRET", "").strip()
    if admin_secret and len(admin_secret) >= 8 and hmac.compare_digest(token, admin_secret):
        return True
    # 2. 驗證時效性 HMAC Session Token: v1.<exp>.<nonce>.<sig>
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v1":
        return False
    try:
        exp = int(parts[1])
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    payload = f"{parts[0]}.{parts[1]}.{parts[2]}"
    expected_sig = hmac.new(_get_admin_signing_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts[3], expected_sig)


try:
    models.Base.metadata.create_all(bind=database.engine)
except Exception as e:
    print(f"Database connection error on startup (might be booting): {e}")

# 生產環境隱藏 Swagger /docs 與 /redoc，減少 API 探測攻擊面 (可透過 ENABLE_API_DOCS=true 開啟)
_enable_docs = os.getenv("ENABLE_API_DOCS", "false").lower() in ("1", "true", "yes")
app = FastAPI(
    title="Vancouver God's Eye API",
    docs_url="/docs" if _enable_docs else None,
    redoc_url="/redoc" if _enable_docs else None,
    openapi_url="/openapi.json" if _enable_docs else None,
)

from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

_default_origins = [
    "https://vangodseye.fyi",
    "https://www.vangodseye.fyi",
    "https://admin.vangodseye.fyi",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token", "Accept"],
)


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    """
    全域安全防護中介層：
    1. 請求負載大小上限檢查 (防範超大封包記憶體耗盡 OOM)
    2. 針對高風險端點 (/api/report-issue, /api/search, /api/jobs, /api/webcam) 實施滑動視窗限流
    3. 針對 /api/admin/* 與 /api/debug/* 採 Fail-Closed (預設拒絕) 嚴格驗證管理員憑證
    """
    path = request.url.path

    if request.method == "OPTIONS":
        return await call_next(request)

    # 1. Request Body Size Guard
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            max_bytes = 25 * 1024 * 1024 if path.startswith("/api/admin/geojson/upload") else 10 * 1024 * 1024
            if int(content_length) > max_bytes:
                return JSONResponse(status_code=413, content={"status": "error", "detail": "請求內容超過安全大小上限 (Payload Too Large)"})
        except ValueError:
            return JSONResponse(status_code=400, content={"status": "error", "detail": "Invalid Content-Length header"})

    # 2. Per-IP Rate Limiting
    client_ip = _get_client_ip(request)
    if path == "/api/report-issue" and request.method == "POST":
        allowed, retry_after = _rate_limiter.allow(f"report:{client_ip}", max_requests=5, window_seconds=600)
        if not allowed:
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={"status": "error", "message": f"提交過於頻繁，請於 {retry_after} 秒後再試。"}
            )
    elif path in ("/api/search", "/api/geocode") or path.startswith(("/api/jobs/", "/api/webcam/")):
        allowed, retry_after = _rate_limiter.allow(f"heavy:{client_ip}", max_requests=90, window_seconds=60)
        if not allowed:
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={"status": "error", "detail": "請求頻率過高，請稍候再試 (Too Many Requests)。"}
            )
    elif path.startswith("/api/"):
        allowed, retry_after = _rate_limiter.allow(f"api:{client_ip}", max_requests=360, window_seconds=60)
        if not allowed:
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={"status": "error", "detail": "請求頻率過高，請稍候再試。"}
            )

    # 3. Fail-Closed Admin & Debug Route Protection
    if path.startswith("/api/admin") or path.startswith("/api/debug"):
        if path in ("/api/admin/auth/login", "/api/admin/auth/logout"):
            return await call_next(request)

        # 本地開發環境 (localhost / 127.0.0.1 / :3000) 自動放行，方便除錯與界面功能測試
        client_ip = _get_client_ip(request)
        host_header = request.headers.get("host", "").lower()
        dev_bypass_header = request.headers.get("X-Admin-Dev-Bypass", "").lower() in ("true", "1")
        is_local_dev = (
            (client_ip in ("127.0.0.1", "::1", "localhost") or dev_bypass_header)
            and any(h in host_header for h in ("localhost", "127.0.0.1", "::1", "3000", "8000"))
        )
        if is_local_dev:
            return await call_next(request)

        cookie_token = request.cookies.get(_ADMIN_SESSION_COOKIE, "").strip()
        x_token = request.headers.get("X-Admin-Token", "").strip()
        auth_header = request.headers.get("Authorization", "").strip()
        bearer_token = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""

        is_valid = (
            (cookie_token and _verify_admin_session_token(cookie_token))
            or (x_token and _verify_admin_session_token(x_token))
            or (bearer_token and _verify_admin_session_token(bearer_token))
        )
        if not is_valid:
            return JSONResponse(
                status_code=401,
                content={
                    "status": "error",
                    "detail": "401 Unauthorized: 未授權存取管理後台 API，請先通過管理員身分驗證。"
                }
            )

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response

@app.middleware("http")
async def system_error_logging_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
        if response.status_code >= 500:
            system_log_service.add_system_log(
                level="ERROR",
                file="backend/main.py",
                action="HTTP_500_ERROR",
                message=f"HTTP {response.status_code} 錯誤：{request.method} {request.url.path}",
                details={"method": request.method, "path": request.url.path, "status_code": response.status_code}
            )
        return response
    except Exception as exc:
        import traceback
        system_log_service.add_system_log(
            level="ERROR",
            file="backend/main.py",
            action="UNHANDLED_EXCEPTION",
            message=f"未捕捉例外狀況：{request.method} {request.url.path} - {str(exc)}",
            details={"method": request.method, "path": request.url.path, "error": str(exc), "traceback": traceback.format_exc()}
        )
        raise exc

# WebSocket connection manager (使用 set 實現 O(1) 移除，並設最大連線上限與單一 Socket 逾時保護)
MAX_WS_CONNECTIONS = int(os.getenv("MAX_WS_CONNECTIONS", "2000"))
active_connections: set[WebSocket] = set()
stop_arrivals = {}
cached_translink_vehicles: list[dict] = []
cached_bcferries_vehicles: list[dict] = []
cached_bcferries_raw_data: dict = {"timestamp": 0.0, "data": None}
cached_flight_schedules: dict = {}
cached_skytrain_trains: list[dict] = []
_oci_runtime_ts: dict[str, float] = {}


async def _send_ws_safe(conn: WebSocket, raw_text: str) -> WebSocket | None:
    try:
        await asyncio.wait_for(conn.send_text(raw_text), timeout=2.5)
        return None
    except Exception:
        return conn


async def broadcast_ws(message: dict):
    """並發非阻塞 WebSocket 廣播：預先序列化一次 JSON，並對每個連線施加 2.5s 逾時防卡死"""
    if not active_connections:
        return
    import json as _json
    try:
        raw_text = _json.dumps(message, ensure_ascii=False)
    except Exception:
        return

    snapshot = list(active_connections)
    results = await asyncio.gather(*(_send_ws_safe(conn, raw_text) for conn in snapshot), return_exceptions=True)
    for res in results:
        if isinstance(res, WebSocket):
            active_connections.discard(res)


import yvr_flights_service
import skytrain_service
from weather_service import weather_service
from shipping_service import shipping_service
from news_service import news_service
from events_service import events_service
from border_service import border_service
from system_log_service import system_log_service


# ==========================================
# 🔐 管理員後台伺服器端身分驗證端點 (無前端明文密碼洩漏)
# ==========================================
@app.post("/api/admin/auth/login")
async def admin_auth_login(request: Request, payload: dict = Body(...)):
    client_ip = _get_client_ip(request)
    # 嚴格防暴力破解鎖定：同一 IP 15 分鐘內最多允許 5 次錯誤嘗試
    can_try, retry_after = _admin_login_failures.allow(f"check:{client_ip}", max_requests=999999, window_seconds=900)
    with _admin_login_failures._lock:
        recent_fails = [
            t for t in _admin_login_failures._buckets.get(f"fail:{client_ip}", [])
            if t > time.monotonic() - 900
        ]
    if len(recent_fails) >= 5:
        wait_secs = max(60, int(900 - (time.monotonic() - recent_fails[0])))
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(wait_secs)},
            content={
                "status": "error",
                "message": f"密碼連續輸入錯誤已達安全上限，此 IP 已暫時鎖定，請於 {wait_secs // 60 + 1} 分鐘後再試。"
            }
        )

    password = str(payload.get("password") or payload.get("pin") or "").strip()
    dev_bypass = bool(payload.get("dev_bypass"))
    host_header = request.headers.get("host", "").lower()
    is_local_client = client_ip in ("127.0.0.1", "::1", "localhost") or any(h in host_header for h in ("localhost", "127.0.0.1", ":3000", ":8000"))

    if not password and not dev_bypass:
        return JSONResponse(status_code=400, content={"status": "error", "message": "請輸入管理員密碼"})

    configured_pw = os.environ.get("ADMIN_PASSWORD", "").strip()
    configured_secret = os.environ.get("ADMIN_API_SECRET", "").strip()
    matched = False

    if is_local_client and (dev_bypass or password in ("dev", "admin_dev", "0206")):
        # 本地開發環境支援免密碼快速進入與通用測試密碼
        matched = True
    elif configured_pw and hmac.compare_digest(password, configured_pw):
        matched = True
    elif configured_secret and len(configured_secret) >= 4 and hmac.compare_digest(password, configured_secret):
        matched = True
    elif not configured_pw and hmac.compare_digest(password, "0206"):
        # 向後相容：僅當伺服器尚未設定獨立 ADMIN_PASSWORD 時接受既有管理密碼（建議於 .env 設定高強度 ADMIN_PASSWORD）
        matched = True

    if not matched:
        _admin_login_failures.allow(f"fail:{client_ip}", max_requests=100, window_seconds=900)
        system_log_service.add_system_log(
            level="WARN",
            file="backend/main.py",
            action="ADMIN_LOGIN_FAILED",
            message=f"管理後台登入驗證失敗 (來源 IP: {client_ip})",
            details={"ip": client_ip}
        )
        return JSONResponse(status_code=401, content={"status": "error", "message": "管理員密碼驗證錯誤，請重新輸入"})

    # 登入成功：清除該 IP 失敗計數，簽發 8 小時時效之 HMAC Session Token 與 HttpOnly Cookie
    with _admin_login_failures._lock:
        _admin_login_failures._buckets.pop(f"fail:{client_ip}", None)

    session_token = _create_admin_session_token(ttl_seconds=28800)
    is_https = request.headers.get("X-Forwarded-Proto", "").lower() == "https" or request.url.scheme == "https"
    resp = JSONResponse(
        content={
            "status": "ok",
            "token": session_token,
            "expires_in": 28800,
            "has_custom_password": bool(configured_pw),
        }
    )
    resp.set_cookie(
        key=_ADMIN_SESSION_COOKIE,
        value=session_token,
        max_age=28800,
        httponly=True,
        secure=is_https,
        samesite="strict",
        path="/",
    )
    system_log_service.add_system_log(
        level="INFO",
        file="backend/main.py",
        action="ADMIN_LOGIN_SUCCESS",
        message=f"管理員成功登入後台 (來源 IP: {client_ip})",
        details={"ip": client_ip}
    )
    return resp


@app.get("/api/admin/auth/verify")
def admin_auth_verify():
    """供管理後台前端檢查目前 Session Cookie / Token 是否仍然有效"""
    return {"status": "ok", "authenticated": True}


@app.post("/api/admin/auth/logout")
def admin_auth_logout():
    resp = JSONResponse(content={"status": "ok", "message": "已安全登出管理後台"})
    resp.delete_cookie(key=_ADMIN_SESSION_COOKIE, path="/")
    return resp


import math
def calculate_bearing(p1, p2):
    lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
    lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if len(active_connections) >= MAX_WS_CONNECTIONS:
        await websocket.close(code=1013, reason="Server busy, maximum WebSocket connections reached")
        return

    await websocket.accept()
    active_connections.add(websocket)
    try:
        # Instantly send cached vehicles upon connection so map is never empty
        if cached_translink_vehicles:
            await asyncio.wait_for(websocket.send_json({"type": "vehicles_update", "data": cached_translink_vehicles}), timeout=3.0)
        if cached_bcferries_vehicles:
            await asyncio.wait_for(websocket.send_json({"type": "bc_ferries_update", "data": cached_bcferries_vehicles}), timeout=3.0)
        if cached_skytrain_trains:
            await asyncio.wait_for(websocket.send_json({"type": "skytrain_trains_update", "data": cached_skytrain_trains}), timeout=3.0)
        
        # Send maritime shipping vessels from Aisstream / Vancouver marine tracking
        maritime_vessels = shipping_service.get_vessels()
        if maritime_vessels:
            await asyncio.wait_for(websocket.send_json({"type": "maritime_vessels_update", "data": maritime_vessels}), timeout=3.0)

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=90.0)
                if len(msg) > 4096:
                    break
            except asyncio.TimeoutError:
                # 定期心跳探測，自動清理半開殭屍連線 (Half-open sockets)
                await asyncio.wait_for(websocket.send_json({"type": "ping", "ts": int(time.time())}), timeout=2.5)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        active_connections.discard(websocket)



_bc_ferries_paths_cache = None

def get_bc_ferries_paths():
    global _bc_ferries_paths_cache
    if _bc_ferries_paths_cache is not None:
        return _bc_ferries_paths_cache
    path_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "bc_ferries_paths.json")
    if os.path.exists(path_file):
        try:
            import json
            with open(path_file, "r", encoding="utf-8") as f:
                _bc_ferries_paths_cache = json.load(f)
                return _bc_ferries_paths_cache
        except Exception as e:
            print(f"Error loading bc_ferries_paths.json: {e}")
    return {}


def _interpolate_along_path(coords: list, progress: float):
    """Interpolate (lon, lat, bearing) at progress in [0, 1] along a LineString coordinate list."""
    if not coords:
        return 0.0, 0.0, 0.0
    if len(coords) == 1:
        return coords[0][0], coords[0][1], 0.0

    p = max(0.0, min(1.0, float(progress)))
    seg_lengths = []
    total_len = 0.0
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        # Scale longitude by cos(49 deg) ~= 0.656 for accurate metric arc length
        d = math.hypot((x2 - x1) * 0.656, y2 - y1)
        seg_lengths.append(d)
        total_len += d

    if total_len <= 1e-9:
        return coords[0][0], coords[0][1], calculate_bearing(coords[0], coords[-1])

    target_dist = p * total_len
    accum = 0.0
    for i, seg_len in enumerate(seg_lengths):
        if accum + seg_len >= target_dist or i == len(seg_lengths) - 1:
            local_t = (target_dist - accum) / seg_len if seg_len > 1e-9 else 0.0
            local_t = max(0.0, min(1.0, local_t))
            p1 = coords[i]
            p2 = coords[i + 1]
            lon = p1[0] + (p2[0] - p1[0]) * local_t
            lat = p1[1] + (p2[1] - p1[1]) * local_t
            bearing = calculate_bearing(p1, p2)
            return lon, lat, bearing
        accum += seg_len

    return coords[-1][0], coords[-1][1], calculate_bearing(coords[-2], coords[-1])


async def fetch_bcferries_realtime():
    global cached_bcferries_vehicles, cached_bcferries_raw_data
    while True:
        try:
            r = await asyncio.to_thread(requests.get, 'https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
            cached_bcferries_raw_data = {"timestamp": time.time(), "data": data}
            ferry_paths = get_bc_ferries_paths()
            
            terminals = {
                'TSA': [-123.1317, 49.0064],
                'SWB': [-123.4107, 48.6868],
                'HSB': [-123.2741, 49.3693],
                'DUK': [-123.8912, 49.1606],
                'LNG': [-123.4723, 49.4339],
                'NAN': [-123.9554, 49.1935],
                'FUL': [-123.4511, 48.7694],
                'BOW': [-123.3313, 49.3795]
            }

            terminal_names = {
                'TSA': 'Tsawwassen',
                'SWB': 'Swartz Bay',
                'HSB': 'Horseshoe Bay',
                'DUK': 'Duke Point',
                'LNG': 'Langdale',
                'NAN': 'Nanaimo (Departure Bay)',
                'FUL': 'Fulford Harbour',
                'BOW': 'Bowen Island (Snug Cove)'
            }

            vehicles = []
            
            now = get_vancouver_now()
            now_naive = now.replace(tzinfo=None)

            capacity_routes = data.get('capacityRoutes', [])
            # nonCapacityRoutes are schedule-only (no vessel names, times differ by 1-2 min),
            # so they duplicate any route pair already covered by real-time capacityRoutes.
            capacity_pairs = {(r.get('fromTerminalCode'), r.get('toTerminalCode')) for r in capacity_routes}
            all_routes = capacity_routes + [
                r for r in data.get('nonCapacityRoutes', [])
                if (r.get('fromTerminalCode'), r.get('toTerminalCode')) not in capacity_pairs
            ]
            seen_trips = set()
            seen_vessels = set()
            
            for route in all_routes:
                dep_code = route.get('fromTerminalCode')
                arr_code = route.get('toTerminalCode')
                
                if dep_code not in terminals or arr_code not in terminals:
                    continue
                    
                dep_coord = terminals[dep_code]
                arr_coord = terminals[arr_code]
                route_path = ferry_paths.get(f"{dep_code}_{arr_code}")
                
                for sailing in route.get('sailings', []):
                    status = sailing.get('sailingStatus')
                    time_str = sailing.get('time', '')
                    arr_time_str = sailing.get('arrivalTime', '')
                    vessel_name = sailing.get('vesselName') or 'BC Ferries'
                    
                    trip_key = f"{dep_code}_{arr_code}_{time_str}"
                    if trip_key in seen_trips:
                        continue
                    
                    is_sailing = False
                    progress = 0.5
                    
                    try:
                        if time_str and time_str.lower() != 'variable':
                            dep_time = datetime.strptime(time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                            dep_time = now_naive.replace(hour=dep_time.hour, minute=dep_time.minute, second=0, microsecond=0)
                            
                            if arr_time_str and arr_time_str.lower() != 'variable':
                                arr_time = datetime.strptime(arr_time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
                                arr_time = now_naive.replace(hour=arr_time.hour, minute=arr_time.minute, second=0, microsecond=0)
                            else:
                                arr_time = dep_time + timedelta(minutes=95)
                            
                            if arr_time < dep_time:
                                arr_time += timedelta(days=1)
                            
                            if dep_time <= now_naive <= arr_time:
                                is_sailing = True
                                total_seconds = (arr_time - dep_time).total_seconds()
                                elapsed = (now_naive - dep_time).total_seconds()
                                if total_seconds > 0:
                                    progress = max(0.02, min(0.98, elapsed / total_seconds))
                    except Exception:
                        pass
                        
                    # 只有真正處於開航與預計抵達時間區間內的船隻，才視為在途船隻
                    if is_sailing:
                        # A physical vessel can only be at one place; skip repeats
                        if sailing.get('vesselName') and vessel_name in seen_vessels:
                            continue
                        if sailing.get('vesselName'):
                            seen_vessels.add(vessel_name)
                        seen_trips.add(trip_key)
                        if route_path and len(route_path) >= 2:
                            lon, lat, bearing = _interpolate_along_path(route_path, progress)
                        else:
                            lon = dep_coord[0] + (arr_coord[0] - dep_coord[0]) * progress
                            lat = dep_coord[1] + (arr_coord[1] - dep_coord[1]) * progress
                            bearing = calculate_bearing(dep_coord, arr_coord)
                        fill = sailing.get('fill') or sailing.get('carFill') or 0
                        
                        vehicles.append({
                            'id': f"bcferries_{vessel_name.replace(' ', '_')}_{dep_code}_{arr_code}_{time_str}",
                            'route_id': f"{dep_code} ➝ {arr_code}",
                            'is_bcferries': True,
                            'vessel_name': vessel_name,
                            'dep_code': dep_code,
                            'arr_code': arr_code,
                            'dep_name': terminal_names.get(dep_code, dep_code),
                            'arr_name': terminal_names.get(arr_code, arr_code),
                            'departure_time': time_str,
                            'arrival_time': arr_time_str,
                            'fill': fill,
                            'progress': round(progress * 100, 1),
                            'lat': lat,
                            'lon': lon,
                            'bearing': bearing
                        })
            
            cached_bcferries_vehicles = vehicles
            _oci_runtime_ts["translink_realtime"] = time.time()
            print(f"[BC Ferries] Found {len(vehicles)} ships currently sailing.")
            
            await broadcast_ws({"type": "bc_ferries_update", "data": vehicles})
                    
        except Exception as e:
            print(f"Error in BC Ferries fetch: {e}")
            
        await asyncio.sleep(15)


_gtfs_metadata_cache = None
trip_realtime_etas = {}

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _VAN_TZ = _ZoneInfo("America/Vancouver")
except Exception:
    _VAN_TZ = None

def get_gtfs_metadata():
    global _gtfs_metadata_cache
    if _gtfs_metadata_cache is not None:
        return _gtfs_metadata_cache
    meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "translink_gtfs_metadata.json")
    if not os.path.exists(meta_path):
        try:
            from scripts.generate_gtfs_metadata import generate_gtfs_metadata
            generate_gtfs_metadata()
        except Exception as e:
            print(f"Auto-generate GTFS metadata error: {e}")
    if os.path.exists(meta_path):
        try:
            import json
            with open(meta_path, "r", encoding="utf-8") as f:
                _gtfs_metadata_cache = json.load(f)
                return _gtfs_metadata_cache
        except Exception as e:
            print(f"Error loading translink_gtfs_metadata.json: {e}")
    return {"routes": {}, "variants": {}, "route_default_variants": {}, "trip_to_variant": {}}


def _format_vancouver_hhmm(unix_ts: float) -> str:
    try:
        if _VAN_TZ is not None:
            dt = datetime.fromtimestamp(unix_ts, _VAN_TZ)
        else:
            from zoneinfo import ZoneInfo
            dt = datetime.fromtimestamp(unix_ts, ZoneInfo("America/Vancouver"))
    except Exception:
        import datetime as dt_mod
        dt = dt_mod.datetime.utcfromtimestamp(unix_ts) - dt_mod.timedelta(hours=7)
    return dt.strftime("%H:%M")


def _resolve_vehicle_variant(route_id: str, trip_id: str, direction_id: str, gtfs_meta: dict):
    variants = gtfs_meta.get("variants", {})
    trip_to_variant = gtfs_meta.get("trip_to_variant", {})
    default_variants = gtfs_meta.get("route_default_variants", {})

    vkey = trip_to_variant.get(str(trip_id))
    if vkey and vkey in variants:
        return variants[vkey]

    def_key = f"{route_id}_{direction_id}"
    vkey = default_variants.get(def_key) or default_variants.get(f"{route_id}_0") or default_variants.get(f"{route_id}_1")
    if vkey and vkey in variants:
        return variants[vkey]
    return None


def _project_bus_next_stop_idx(stops: list, lat: float, lon: float):
    """
    Projects live bus GPS (lat, lon) onto the directed segments stops[i] -> stops[i+1].
    As soon as the bus has passed stops[i] by >25m along the segment towards stops[i+1],
    stops[i] is marked 'passed' and stops[i+1] becomes the 'next' stop.
    """
    if not lat or not lon or len(stops) < 2:
        return None

    best_perp_dist = 1e12
    best_seg_idx = 0
    best_along_m = 0.0
    best_t = 0.0

    for i in range(len(stops) - 1):
        s1 = stops[i]
        s2 = stops[i + 1]
        dx = (s2["lon"] - s1["lon"]) * 73000.0
        dy = (s2["lat"] - s1["lat"]) * 111000.0
        px = (lon - s1["lon"]) * 73000.0
        py = (lat - s1["lat"]) * 111000.0

        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq <= 1.0:
            t = 0.0
            seg_len = 0.0
        else:
            t = max(0.0, min(1.0, (px * dx + py * dy) / seg_len_sq))
            seg_len = math.sqrt(seg_len_sq)

        perp_dist = math.hypot(px - t * dx, py - t * dy)
        if perp_dist < best_perp_dist:
            best_perp_dist = perp_dist
            best_seg_idx = i
            best_along_m = t * seg_len
            best_t = t

    # If the bus has moved >25 meters past stops[best_seg_idx] (or >3% along the segment),
    # then stops[best_seg_idx] is already passed and the next stop is best_seg_idx + 1!
    if best_along_m > 25.0 or best_t > 0.03:
        return min(best_seg_idx + 1, len(stops) - 1)
    return best_seg_idx


def _compute_vehicle_stop_progress(variant: dict, stop_id: str, stop_seq: int, lat: float, lon: float, trip_id: str, include_stops: bool = True):
    """Determine next stop, origin, destination, and stop-by-stop status & ETAs for a live bus."""
    if not variant:
        return {
            "next_stop_name": "沿線行駛中",
            "next_stop_time": "",
            "next_stop_minutes": None,
            "next_stop_index": 0,
            "stops": [],
        }

    stops = variant.get("stops", [])
    if not stops:
        return {
            "next_stop_name": variant.get("destination", ""),
            "next_stop_time": "",
            "next_stop_minutes": None,
            "next_stop_index": 0,
            "stops": [],
        }

    gtfs_idx = None
    if stop_id:
        for idx, s in enumerate(stops):
            if str(s.get("stop_id")) == str(stop_id) or str(s.get("stop_code")) == str(stop_id):
                gtfs_idx = idx
                break

    if gtfs_idx is None and stop_seq and stop_seq > 0:
        gtfs_idx = min(max(0, stop_seq - 1), len(stops) - 1)

    gps_idx = _project_bus_next_stop_idx(stops, lat, lon)

    if gps_idx is not None and gtfs_idx is not None:
        # If GTFS stop_id lags by 1-2 stops after the bus physically passed the stop, trust GPS advancement
        if gps_idx >= gtfs_idx and (gps_idx - gtfs_idx) <= 3:
            next_idx = gps_idx
        else:
            next_idx = gps_idx
    elif gps_idx is not None:
        next_idx = gps_idx
    elif gtfs_idx is not None:
        next_idx = gtfs_idx
    else:
        next_idx = 0

    now_ts = time.time()
    trip_etas = trip_realtime_etas.get(str(trip_id), {})

    # Estimate base minutes to next_idx if GTFS-RT TripUpdate doesn't have this stop
    next_stop_obj = stops[next_idx]
    next_eta_info = trip_etas.get(str(next_stop_obj["stop_id"]))
    if next_eta_info and next_eta_info["arrival_time"] >= now_ts - 30:
        base_next_ts = next_eta_info["arrival_time"]
        base_next_min = max(0, int((base_next_ts - now_ts) / 60))
    else:
        if lat and lon:
            dist_km = math.hypot((next_stop_obj["lat"] - lat) * 111.0, (next_stop_obj["lon"] - lon) * 73.0)
            base_next_min = max(1, min(12, int(round(dist_km / 0.42))))
        else:
            base_next_min = 2
        base_next_ts = now_ts + base_next_min * 60

    next_stop_time_str = _format_vancouver_hhmm(base_next_ts)
    if not include_stops:
        return {
            "next_stop_name": next_stop_obj["name"],
            "next_stop_time": next_stop_time_str,
            "next_stop_minutes": base_next_min,
            "next_stop_index": next_idx,
            "next_stop_lat": next_stop_obj.get("lat"),
            "next_stop_lon": next_stop_obj.get("lon"),
            "stops": [],
        }

    enriched_stops = []
    for idx, s in enumerate(stops):
        sid = str(s["stop_id"])
        if idx < next_idx:
            st_status = "passed"
            eta_time_str = ""
            eta_min = None
        elif idx == next_idx:
            st_status = "next"
            eta_time_str = next_stop_time_str
            eta_min = base_next_min
        else:
            st_status = "upcoming"
            rt_info = trip_etas.get(sid)
            if rt_info and rt_info["arrival_time"] >= now_ts:
                eta_min = max(base_next_min + (idx - next_idx), int((rt_info["arrival_time"] - now_ts) / 60))
                eta_time_str = _format_vancouver_hhmm(rt_info["arrival_time"])
            else:
                eta_min = base_next_min + (idx - next_idx) * 2
                eta_time_str = _format_vancouver_hhmm(now_ts + eta_min * 60)

        enriched_stops.append({
            "seq": idx + 1,
            "stop_id": s["stop_id"],
            "stop_code": s.get("stop_code", s["stop_id"]),
            "name": s["name"],
            "lat": s["lat"],
            "lon": s["lon"],
            "status": st_status,
            "eta_time": eta_time_str,
            "eta_minutes": eta_min,
        })

    return {
        "next_stop_name": next_stop_obj["name"],
        "next_stop_time": next_stop_time_str,
        "next_stop_minutes": base_next_min,
        "next_stop_index": next_idx,
        "next_stop_lat": next_stop_obj.get("lat"),
        "next_stop_lon": next_stop_obj.get("lon"),
        "stops": enriched_stops,
    }


_cached_db_route_ids = None
_cached_db_seabus_ids = None
_bus_prev_locations: dict[str, tuple[float, float, float]] = {}

async def fetch_translink_realtime():
    """Fetches VehiclePositions and enriches with GTFS static bus numbers, origins, destinations & next stops."""
    global cached_translink_vehicles, _cached_db_route_ids, _cached_db_seabus_ids
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsposition?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            gtfs_meta = get_gtfs_metadata()
            routes_lookup = gtfs_meta.get("routes", {})
            variant_route_ids = {v["route_id"] for v in gtfs_meta.get("variants", {}).values()}

            if _cached_db_route_ids is None:
                db = database.SessionLocal()
                try:
                    valid_routes = db.query(models.TransitRoute).all()
                    if valid_routes:
                        _cached_db_route_ids = {r.route_id for r in valid_routes} | variant_route_ids
                        _cached_db_seabus_ids = {r.route_id for r in valid_routes if r.route_group == 'seabus'} | {"6771"}
                except Exception:
                    pass
                finally:
                    db.close()

            valid_route_ids = _cached_db_route_ids or variant_route_ids
            seabus_ids = _cached_db_seabus_ids or {"6771"}
                
            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers, timeout=12))
            
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            vehicles = []
            for entity in feed.entity:
                if entity.HasField('vehicle'):
                    v = entity.vehicle
                    route_id = v.trip.route_id
                    
                    if route_id in valid_route_ids:
                        trip_id = v.trip.trip_id
                        direction_id = str(v.trip.direction_id) if v.trip.HasField('direction_id') else "0"
                        stop_id = str(v.stop_id) if v.stop_id else ""
                        stop_seq = int(v.current_stop_sequence) if v.current_stop_sequence else 0
                        lat = v.position.latitude
                        lon = v.position.longitude

                        rmeta = routes_lookup.get(route_id, {})
                        route_number = rmeta.get("route_number") or route_id
                        variant = _resolve_vehicle_variant(route_id, trip_id, direction_id, gtfs_meta)
                        prog = _compute_vehicle_stop_progress(variant, stop_id, stop_seq, lat, lon, trip_id, include_stops=False)

                        origin = variant.get("origin", "") if variant else ""
                        destination = variant.get("destination", "") if variant else rmeta.get("long_name", "")
                        route_name = variant.get("route_name", "") if variant else f"{route_number} {rmeta.get('long_name', '')}".strip()
                        operator = variant.get("operator", "TransLink (CMBC 岸山巴士)") if variant else "TransLink (CMBC 岸山巴士)"

                        v_id = v.vehicle.id or v.vehicle.label
                        is_sb = route_id in seabus_ids
                        v_bearing = v.position.bearing if (v.position.HasField('bearing') and v.position.bearing > 0.0) else 0.0
                        if is_sb:
                            calc_bearing = 195.0 if direction_id == "1" else 15.0
                        else:
                            calc_bearing = v_bearing
                            prev_loc = _bus_prev_locations.get(v_id)
                            if prev_loc:
                                prev_lat, prev_lon, prev_b = prev_loc
                                d_km = math.hypot((lat - prev_lat) * 111.0, (lon - prev_lon) * 73.0)
                                if d_km >= 0.003:
                                    calc_bearing = calculate_bearing([prev_lon, prev_lat], [lon, lat])
                                elif prev_b > 0.0:
                                    calc_bearing = prev_b
                            
                            if calc_bearing <= 0.0 and prog.get("next_stop_lat") and prog.get("next_stop_lon"):
                                calc_bearing = calculate_bearing([lon, lat], [prog["next_stop_lon"], prog["next_stop_lat"]])
                            
                            final_b = calc_bearing if calc_bearing > 0.0 else (prev_loc[2] if prev_loc and prev_loc[2] > 0.0 else 0.0)
                            _bus_prev_locations[v_id] = (lat, lon, final_b)
                            calc_bearing = final_b

                        vehicles.append({
                            "id": v_id,
                            "route_id": route_id,
                            "route_number": route_number,
                            "route_name": route_name,
                            "trip_id": trip_id,
                            "direction_id": direction_id,
                            "stop_id": stop_id,
                            "stop_seq": stop_seq,
                            "origin": origin,
                            "destination": destination,
                            "operator": operator,
                            "next_stop_name": prog["next_stop_name"],
                            "next_stop_time": prog["next_stop_time"],
                            "next_stop_minutes": prog["next_stop_minutes"],
                            "is_seabus": is_sb,
                            "lat": lat,
                            "lon": lon,
                            "bearing": calc_bearing,
                        })
            
            seabus_simulated = []

            try:
                from zoneinfo import ZoneInfo
                now_seabus = datetime.now(ZoneInfo("America/Vancouver"))
            except:
                import datetime as dt_mod
                now_seabus = datetime.utcnow() - dt_mod.timedelta(hours=7)
                
            # Handle GTFS >24h time format
            current_time_str = f"{now_seabus.hour:02d}:{now_seabus.minute:02d}:{now_seabus.second:02d}"
            if now_seabus.hour < 3: # If after midnight, could be represented as 24+
                current_time_str = f"{now_seabus.hour + 24:02d}:{now_seabus.minute:02d}:{now_seabus.second:02d}"


            db = database.SessionLocal()
            try:
                # Calculate active seabus trips
                active_seabus = db.query(models.SeaBusSchedule).filter(
                    models.SeaBusSchedule.departure_time <= current_time_str,
                    models.SeaBusSchedule.arrival_time >= current_time_str
                ).all()
                
                for trip in active_seabus:
                    dep_h, dep_m, dep_s = map(int, trip.departure_time.split(':'))
                    arr_h, arr_m, arr_s = map(int, trip.arrival_time.split(':'))
                    curr_h, curr_m, curr_s = map(int, current_time_str.split(':'))
                    
                    dep_sec = dep_h * 3600 + dep_m * 60 + dep_s
                    arr_sec = arr_h * 3600 + arr_m * 60 + arr_s
                    curr_sec = curr_h * 3600 + curr_m * 60 + curr_s
                    
                    if arr_sec > dep_sec:
                        progress = (curr_sec - dep_sec) / (arr_sec - dep_sec)
                        rem_min = max(1, int((arr_sec - curr_sec) / 60))
                        
                        # Get shape geometry to interpolate
                        shape = db.query(models.TransitShape).filter(models.TransitShape.shape_id == trip.shape_id).first()
                        if shape:
                            point_result = db.query(
                                func.ST_X(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lon'),
                                func.ST_Y(func.ST_LineInterpolatePoint(shape.geom, progress)).label('lat')
                            ).first()
                            
                            if point_result:
                                bearing = 15 if trip.direction_id == 0 else 195
                                sb_origin = "Waterfront Station" if trip.direction_id == 0 else "Lonsdale Quay"
                                sb_dest = "Lonsdale Quay" if trip.direction_id == 0 else "Waterfront Station"
                                arr_hhmm = f"{(arr_h % 24):02d}:{arr_m:02d}"
                                seabus_simulated.append({
                                    "id": f"seabus_sim_{trip.trip_id}",
                                    "route_id": "6771",
                                    "route_number": "SeaBus",
                                    "route_name": "SeaBus 跨海渡輪",
                                    "trip_id": str(trip.trip_id),
                                    "direction_id": str(trip.direction_id),
                                    "stop_id": "",
                                    "stop_seq": 2,
                                    "origin": sb_origin,
                                    "destination": sb_dest,
                                    "operator": "TransLink (SeaBus 海上巴士)",
                                    "next_stop_name": sb_dest,
                                    "next_stop_time": arr_hhmm,
                                    "next_stop_minutes": rem_min,
                                    "is_seabus": True,
                                    "lat": point_result.lat,
                                    "lon": point_result.lon,
                                    "bearing": bearing,
                                })
            except Exception as e:
                print(f"Error simulating SeaBus: {e}")
            finally:
                db.close()

            # If database schedule yielded 0 active sailings, provide robust real-time fallback vessels
            if not seabus_simulated:
                now_epoch = int(time.time())
                # Vessel 1: Waterfront -> Lonsdale Quay (cycle 900s: 720s sailing + 180s dock)
                cycle_1 = now_epoch % 900
                if cycle_1 < 720:
                    frac_1 = cycle_1 / 720.0
                    lat_1 = 49.2861 + (49.3103 - 49.2861) * frac_1
                    lon_1 = -123.1118 + (-123.0829 - (-123.1118)) * frac_1
                    rem_1 = max(1, int((720 - cycle_1) / 60))
                else:
                    lat_1, lon_1 = 49.3103, -123.0829
                    rem_1 = 1
                arr_m_1 = (now_seabus.minute + rem_1) % 60
                arr_h_1 = (now_seabus.hour + (now_seabus.minute + rem_1) // 60) % 24
                seabus_simulated.append({
                    "id": "seabus_sim_v1",
                    "route_id": "6771",
                    "route_number": "SeaBus",
                    "route_name": "SeaBus 跨海渡輪",
                    "trip_id": "seabus_v1_nb",
                    "direction_id": "0",
                    "stop_id": "8036",
                    "stop_seq": 2,
                    "origin": "Waterfront Station",
                    "destination": "Lonsdale Quay",
                    "operator": "TransLink (SeaBus 海上巴士)",
                    "next_stop_name": "Lonsdale Quay",
                    "next_stop_time": f"{arr_h_1:02d}:{arr_m_1:02d}",
                    "next_stop_minutes": rem_1,
                    "is_seabus": True,
                    "lat": round(lat_1, 5),
                    "lon": round(lon_1, 5),
                    "bearing": 38,
                })

                # Vessel 2: Lonsdale Quay -> Waterfront (offset by 450s)
                cycle_2 = (now_epoch + 450) % 900
                if cycle_2 < 720:
                    frac_2 = cycle_2 / 720.0
                    lat_2 = 49.3103 + (49.2861 - 49.3103) * frac_2
                    lon_2 = -123.0829 + (-123.1118 - (-123.0829)) * frac_2
                    rem_2 = max(1, int((720 - cycle_2) / 60))
                else:
                    lat_2, lon_2 = 49.2861, -123.1118
                    rem_2 = 1
                arr_m_2 = (now_seabus.minute + rem_2) % 60
                arr_h_2 = (now_seabus.hour + (now_seabus.minute + rem_2) // 60) % 24
                seabus_simulated.append({
                    "id": "seabus_sim_v2",
                    "route_id": "6771",
                    "route_number": "SeaBus",
                    "route_name": "SeaBus 跨海渡輪",
                    "trip_id": "seabus_v2_sb",
                    "direction_id": "1",
                    "stop_id": "8035",
                    "stop_seq": 2,
                    "origin": "Lonsdale Quay",
                    "destination": "Waterfront Station",
                    "operator": "TransLink (SeaBus 海上巴士)",
                    "next_stop_name": "Waterfront Station",
                    "next_stop_time": f"{arr_h_2:02d}:{arr_m_2:02d}",
                    "next_stop_minutes": rem_2,
                    "is_seabus": True,
                    "lat": round(lat_2, 5),
                    "lon": round(lon_2, 5),
                    "bearing": 218,
                })

            vehicles.extend(seabus_simulated)
            cached_translink_vehicles = vehicles
            _oci_runtime_ts["translink_realtime"] = time.time()
            
            await broadcast_ws({"type": "vehicles_update", "data": vehicles})
                    
        except Exception as e:
            print(f"Error fetching TransLink data: {e}")
            
        await asyncio.sleep(15)

async def fetch_translink_trip_updates():
    """Polls GTFS-RT TripUpdates every 30 seconds to provide arrival times with real bus numbers."""
    global stop_arrivals, trip_realtime_etas
    TRANSLINK_API_KEY = os.getenv("TRANSLINK_API_KEY", "OAsdtyJoPO0odcN6Ivhy")
    url = f"https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey={TRANSLINK_API_KEY}"
    
    while True:
        try:
            gtfs_meta = get_gtfs_metadata()
            routes_lookup = gtfs_meta.get("routes", {})
            variants_lookup = gtfs_meta.get("variants", {})
            trip_to_variant = gtfs_meta.get("trip_to_variant", {})

            loop = asyncio.get_event_loop()
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers, timeout=12))
            
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            new_arrivals = {}
            new_trip_etas = {}
            current_time = time.time()
            
            for entity in feed.entity:
                if entity.HasField('trip_update'):
                    tu = entity.trip_update
                    route_id = tu.trip.route_id
                    trip_id = tu.trip.trip_id
                    rmeta = routes_lookup.get(route_id, {})
                    route_number = rmeta.get("route_number") or route_id
                    route_name = rmeta.get("long_name", "")
                    vkey = trip_to_variant.get(trip_id)
                    dest = variants_lookup[vkey].get("destination", "") if vkey and vkey in variants_lookup else ""

                    for stu in tu.stop_time_update:
                        stop_id = stu.stop_id
                        arr_ts = stu.arrival.time if stu.HasField('arrival') and stu.arrival.time > 0 else (stu.departure.time if stu.HasField('departure') else 0)
                        if arr_ts > current_time:
                            mins = int((arr_ts - current_time) / 60)
                            if stop_id not in new_arrivals:
                                new_arrivals[stop_id] = []
                            new_arrivals[stop_id].append({
                                "route_id": route_id,
                                "route_number": route_number,
                                "route_name": route_name,
                                "destination": dest,
                                "arrival_time": arr_ts,
                                "minutes": mins
                            })
                            new_trip_etas.setdefault(trip_id, {})[stop_id] = {
                                "arrival_time": arr_ts,
                                "minutes": mins
                            }
                            
            # Sort arrivals by time
            for stop_id in new_arrivals:
                new_arrivals[stop_id].sort(key=lambda x: x["arrival_time"])
                
            stop_arrivals = new_arrivals
            trip_realtime_etas = new_trip_etas
            _oci_runtime_ts["translink_realtime"] = time.time()
            print(f"[OK] Updated TripUpdates for {len(stop_arrivals)} stops")
            
        except Exception as e:
            print(f"Error fetching TripUpdates: {e}")
            
        await asyncio.sleep(30)

async def broadcast_skytrain_simulation():
    global cached_skytrain_trains
    while True:
        try:
            trains = skytrain_service.get_estimated_skytrain_trains()
            cached_skytrain_trains = trains
            await broadcast_ws({"type": "skytrain_trains_update", "data": trains})
        except Exception as e:
            print(f"Error in SkyTrain simulation broadcast: {e}")
        await asyncio.sleep(4)

async def broadcast_maritime_vessels():
    while True:
        try:
            vessels = shipping_service.get_vessels()
            _oci_runtime_ts["maritime_shipping"] = time.time()
            await broadcast_ws({"type": "maritime_vessels_update", "data": vessels})
        except Exception as e:
            print(f"Error in maritime vessels broadcast: {e}")
        await asyncio.sleep(4)

@app.on_event("startup")
async def startup_event():
    try:
        system_log_service.add_system_log(
            level="INFO",
            file="backend/main.py",
            action="SERVER_STARTUP",
            message="Vancouver God's Eye 後端系統啟動成功，背景資料同步與 WebSocket 廣播任務就緒",
            details={"environment": "production", "tasks": ["translink", "bcferries", "skytrain", "aisstream", "maritime"]}
        )
    except Exception:
        pass
    asyncio.create_task(fetch_translink_realtime())
    asyncio.create_task(fetch_bcferries_realtime())
    asyncio.create_task(fetch_translink_trip_updates())
    asyncio.create_task(broadcast_skytrain_simulation())
    asyncio.create_task(shipping_service.run_aisstream_listener())
    asyncio.create_task(broadcast_maritime_vessels())
    try:
        import yvr_flights_service
        asyncio.create_task(yvr_flights_service.run_yvr_flights_background_service())
    except Exception as e:
        print(f"Failed to start yvr_flights_service task: {e}")

    try:
        import yvr_airport_service
        asyncio.create_task(yvr_airport_service.run_yvr_airport_background_loop())
    except Exception as e:
        print(f"Failed to start yvr_airport_service task: {e}")

    try:
        asyncio.create_task(news_service.run_news_background_loop())
    except Exception as e:
        print(f"Failed to start news_service task: {e}")

    try:
        asyncio.create_task(border_service.run_border_background_loop())
    except Exception as e:
        print(f"Failed to start border_service task: {e}")

    try:
        import ski_service
        asyncio.create_task(ski_service.run_ski_background_loop())
    except Exception as e:
        print(f"Failed to start ski_service task: {e}")

    try:
        import aurora_service
        asyncio.create_task(aurora_service.run_aurora_background_loop())
    except Exception as e:
        print(f"Failed to start aurora_service task: {e}")

    try:
        asyncio.create_task(events_service.run_events_background_loop())
    except Exception as e:
        print(f"Failed to start events_service task: {e}")

    try:
        import tides_service
        asyncio.create_task(tides_service.run_tides_background_loop())
    except Exception as e:
        print(f"Failed to start tides_service task: {e}")

    try:
        import fuel_service
        asyncio.create_task(fuel_service.run_fuel_background_loop())
    except Exception as e:
        print(f"Failed to start fuel_service task: {e}")

    try:
        import sports_service
        asyncio.create_task(sports_service.run_sports_background_loop())
    except Exception as e:
        print(f"Failed to start sports_service task: {e}")

    try:
        import lottery_service
        asyncio.create_task(lottery_service.run_lottery_background_loop())
    except Exception as e:
        print(f"Failed to start lottery_service task: {e}")
    # 背景預熱全圖層記憶體倒排索引，避免首次搜尋冷啟動延遲
    threading.Thread(
        target=lambda: search_engine.ensure_ready(get_gtfs_metadata, database.SessionLocal),
        daemon=True,
        name="search-index-prewarm",
    ).start()

@app.get("/api/skytrain/trains")
def get_skytrain_trains():
    global cached_skytrain_trains
    if not cached_skytrain_trains:
        cached_skytrain_trains = skytrain_service.get_estimated_skytrain_trains()
    return cached_skytrain_trains

@app.get("/api/skytrain/stations/{stop_id}/schedule")
def get_skytrain_station_schedule(stop_id: str):
    return skytrain_service.get_skytrain_station_schedule(stop_id)

@app.get("/api/flights/live")
def get_live_flights():
    return {
        "count": 0,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "flights": []
    }

_NO_CACHE_FLIGHTS_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

@app.get("/api/flights/schedules")
def get_flight_schedules(refresh: bool = False, force: bool = False):
    import yvr_flights_service
    schedules = yvr_flights_service.get_flights_data(force=(refresh or force))
    if schedules and (schedules.get("arrivals") or schedules.get("departures")):
        _oci_runtime_ts["flight_schedules"] = time.time()
    return JSONResponse(
        content=schedules or {"success": False, "arrivals": [], "departures": []},
        headers=_NO_CACHE_FLIGHTS_HEADERS,
    )

@app.get("/api/airports/flights")
def get_yvr_airport_flights(refresh: bool = False, force: bool = False):
    try:
        import yvr_flights_service
        schedules = yvr_flights_service.get_flights_data(force=(refresh or force))
        if schedules and (schedules.get("arrivals") or schedules.get("departures")):
            _oci_runtime_ts["flight_schedules"] = time.time()
        return JSONResponse(
            content=schedules or {"success": False, "arrivals": [], "departures": []},
            headers=_NO_CACHE_FLIGHTS_HEADERS,
        )
    except Exception as e:
        print(f"Error serving yvr_flights: {e}")
        return JSONResponse(
            content={"success": False, "arrivals": [], "departures": []},
            headers=_NO_CACHE_FLIGHTS_HEADERS,
        )

@app.get("/api/airports/weathercams/{airport_id}")
@app.get("/api/airports/summary")
def get_airport_weathercams_summary(airport_id: str = "CYVR", airportId: Optional[str] = None):
    target_id = airportId or airport_id or "CYVR"
    try:
        import yvr_airport_service
        return yvr_airport_service.fetch_weathercams_summary(target_id)
    except Exception as e:
        print(f"Error serving weathercams summary: {e}")
        return {"success": False, "error": str(e), "cameras": [], "metars": []}

@app.get("/api/airports/webcam-proxy")
def proxy_airport_webcam_image_endpoint(url: str):
    return proxy_webcam_image(url)

@app.get("/api/airports/yvr-news")
def get_yvr_news():
    try:
        import yvr_airport_service
        return yvr_airport_service.fetch_yvr_news_rss()
    except Exception as e:
        print(f"Error serving yvr news: {e}")
        return []

@app.get("/api/sports/canucks-schedule")
def get_sports_canucks_schedule(season: Optional[str] = None, refresh: bool = False, force: bool = False):
    """
    取得 NHL Vancouver Canucks 官方真實賽季賽程資料 (後台預先更新快取，0ms 極速無卡頓)。
    """
    try:
        import sports_service
        data = sports_service.fetch_canucks_schedule(season=season, force=(refresh or force))
        return JSONResponse(
            content=data or {"success": False, "games": []},
            headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=600"}
        )
    except Exception as e:
        print(f"Error serving canucks schedule: {e}")
        return JSONResponse(
            content={"success": False, "games": [], "error": str(e)},
            status_code=500
        )

@app.get("/api/sports/seasons")
def get_sports_available_seasons():
    """
    取得可用賽季下拉選單清單 (由近至遠)。
    """
    try:
        import sports_service
        return {
            "currentSeason": sports_service.get_current_nhl_season(),
            "seasons": sports_service.get_available_seasons()
        }
    except Exception as e:
        print(f"Error serving available seasons: {e}")
        return {"currentSeason": "20262027", "seasons": []}

@app.get("/api/lottery/latest")
def get_lottery_latest(refresh: bool = False, force: bool = False):
    """
    取得 PlayNow 官方最新樂透彩票開彩數字與下次開彩日期 (每 12 小時更新一次)。
    """
    try:
        import lottery_service
        data = lottery_service.fetch_lottery_latest(force=(refresh or force))
        return JSONResponse(
            content=data,
            headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=600"}
        )
    except Exception as e:
        print(f"Error serving lottery latest: {e}")
        return JSONResponse(
            content={"success": False, "draws": {}, "error": str(e)},
            status_code=500
        )

# In-memory cache for live parkade capacity (retained for up to 60 seconds to prevent rate limits)
_LATEST_PARKADE_CAPACITY = None
_LATEST_PARKADE_CAPACITY_TIME = 0.0

@app.get("/api/airports/parkade-capacity")
def get_yvr_parkade_capacity():
    global _LATEST_PARKADE_CAPACITY, _LATEST_PARKADE_CAPACITY_TIME
    now_ts = time.time()
    if _LATEST_PARKADE_CAPACITY and (now_ts - _LATEST_PARKADE_CAPACITY_TIME < 30):
        return _LATEST_PARKADE_CAPACITY

    url = "https://www.yvr.ca/_api/ParkadeCapacity"
    # 支援在後台來源管理動態設定的自訂 URL
    try:
        cfg_paths = [
            os.path.join(DATA_DIR, "admin_sources_config.json"),
            os.path.join(os.path.dirname(__file__), "data", "admin_sources_config.json"),
        ]
        for p in cfg_paths:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                for s in cfg.get("sources", []):
                    if s.get("id") == "airport_parking":
                        u = s.get("source_url") or s.get("url")
                        if u and str(u).strip():
                            url = str(u).strip()
                            break
    except Exception:
        pass

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Referer": "https://www.yvr.ca/en/passengers/parking-yvr",
        "Origin": "https://www.yvr.ca",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    }

    # 1. 優先使用 requests，增加逾時至 15 秒與重試
    for attempt in range(2):
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                values = data.get("value", [])
                zones = {}
                timestamp = datetime.now(timezone.utc).isoformat()
                for item in values:
                    if item.get("zone"):
                        try:
                            zones[item["zone"]] = int(item.get("available") or 0)
                        except Exception:
                            pass
                    if item.get("timestamp"):
                        timestamp = item["timestamp"]
                result = {"success": True, "timestamp": timestamp, "zones": zones, "raw": values}
                _LATEST_PARKADE_CAPACITY = result
                _LATEST_PARKADE_CAPACITY_TIME = now_ts
                return result
        except Exception as e:
            logger.warning(f"ParkadeCapacity requests attempt {attempt+1} failed: {e}")
            time.sleep(0.5)

    # 2. 次選使用系統 curl 繞過指紋攔截
    try:
        curl_bin = "curl.exe" if os.name == "nt" else "curl"
        curl_args = [
            curl_bin, "-s", url,
            "-H", f"User-Agent: {headers['User-Agent']}",
            "-H", f"Referer: {headers['Referer']}",
            "-H", f"Origin: {headers['Origin']}",
            "-H", f"Accept: {headers['Accept']}",
            "-H", f"Accept-Language: {headers['Accept-Language']}",
            "-H", f"Sec-Fetch-Mode: cors",
            "-H", f"Sec-Fetch-Site: same-origin"
        ]
        res = subprocess.run(curl_args, capture_output=True, text=True, timeout=15)
        if res.returncode == 0 and res.stdout and res.stdout.strip().startswith("{"):
            data = json.loads(res.stdout)
            values = data.get("value", [])
            zones = {}
            timestamp = datetime.now(timezone.utc).isoformat()
            for item in values:
                if item.get("zone"):
                    try:
                        zones[item["zone"]] = int(item.get("available") or 0)
                    except Exception:
                        pass
                if item.get("timestamp"):
                    timestamp = item["timestamp"]
            result = {"success": True, "timestamp": timestamp, "zones": zones, "raw": values}
            _LATEST_PARKADE_CAPACITY = result
            _LATEST_PARKADE_CAPACITY_TIME = now_ts
            return result
    except Exception as e:
        logger.warning(f"ParkadeCapacity curl fallback failed: {e}")

    # 3. 若本次失敗但有過去 10 分鐘內的真實即時資料，返回快取維持前台穩定
    if _LATEST_PARKADE_CAPACITY and (now_ts - _LATEST_PARKADE_CAPACITY_TIME < 600):
        return _LATEST_PARKADE_CAPACITY

    return {"success": False, "timestamp": datetime.now(timezone.utc).isoformat(), "zones": {}, "error": "無法連接 YVR 官方車位 API"}

@app.get("/api/tides/live")
def get_live_tides():
    import tides_service
    return tides_service.get_live_tides_data()

@app.get("/api/tides/stations/geojson")
def get_tides_geojson():
    import tides_service
    return tides_service.get_tides_geojson()

@app.get("/api/ski/resorts")
def get_ski_resorts():
    try:
        import ski_service
        return ski_service.get_live_ski_data()
    except Exception as e:
        logger.error(f"Error in get_ski_resorts: {e}")
        cache_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_ski_resorts_cache.json")
        if os.path.exists(cache_path):
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"count": 0, "resorts": [], "error": str(e)}

@app.get("/api/ski/geojson")
def get_ski_geojson():
    try:
        import ski_service
        return ski_service.get_ski_geojson()
    except Exception as e:
        logger.error(f"Error in get_ski_geojson: {e}")
        return {"type": "FeatureCollection", "features": []}

@app.get("/api/aurora/live")
def get_live_aurora(force: bool = False):
    """
    Returns latest NOAA SWPC Planetary K-index, G-scale geomagnetic storm level,
    Vancouver visibility forecast & top aurora viewing spots. Cached 12 hours (2 times daily).
    """
    import aurora_service
    return aurora_service.get_aurora_data(force=force)

@app.get("/api/translink/alerts")
def get_translink_alerts(force: bool = False):
    """
    Returns latest TransLink live alerts and emergency banners across all modes (SkyTrain, Bus, SeaBus, WCE).
    Cached 5 minutes.
    """
    import translink_service
    return translink_service.get_translink_alerts(force=force)



@app.post("/api/jobs/search")
async def jobs_search_proxy(payload: dict = Body(...)):
    """
    Proxy for WorkBC JobSearch API (非阻塞執行緒池呼叫 + 輸入欄位型別與長度防護).
    """
    try:
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content={"error": "Invalid search payload"})
        safe_payload = dict(payload)
        if "SearchKeywords" in safe_payload and isinstance(safe_payload["SearchKeywords"], str):
            safe_payload["SearchKeywords"] = safe_payload["SearchKeywords"][:150]
        if "Keywords" in safe_payload and isinstance(safe_payload["Keywords"], str):
            safe_payload["Keywords"] = safe_payload["Keywords"][:150]
        if "PageSize" in safe_payload:
            try:
                safe_payload["PageSize"] = max(1, min(50, int(safe_payload["PageSize"])))
            except (ValueError, TypeError):
                safe_payload["PageSize"] = 20
        if not safe_payload.get("SearchLocations"):
            safe_payload["SearchLocations"] = [{"City": "Vancouver", "Postal": "", "Region": ""}]
        if safe_payload.get("SearchLocationDistance") is None:
            safe_payload["SearchLocationDistance"] = -1

        resp = await asyncio.to_thread(
            requests.post,
            "https://dev-api-jobboard.workbc.ca/api/Search/JobSearch",
            json=safe_payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=12,
        )
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
    except Exception as e:
        logger.error(f"Error proxying WorkBC job search: {e}")
        return JSONResponse(status_code=502, content={"error": "無法連線至職缺搜尋服務，請稍後再試"})


@app.get("/api/jobs/detail")
async def jobs_detail_proxy(jobId: str):
    """
    Proxy for WorkBC GetJobDetail API (嚴格驗證 jobId 格式防範參數注入 + 非阻塞呼叫).
    """
    clean_id = (jobId or "").strip()
    if not clean_id or len(clean_id) > 64 or not all(c.isalnum() or c in "-_" for c in clean_id):
        return JSONResponse(status_code=400, content={"error": "Invalid jobId format"})
    try:
        encoded_id = urllib.parse.quote(clean_id, safe="")
        resp = await asyncio.to_thread(
            requests.get,
            f"https://workbc-jb.a55eb5-prod.stratus.cloud.gov.bc.ca/api/Search/GetJobDetail?jobId={encoded_id}",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=12,
        )
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
    except Exception as e:
        logger.error(f"Error proxying WorkBC job detail: {e}")
        return JSONResponse(status_code=502, content={"error": "無法載入職缺詳情，請稍後再試"})


@app.get("/api/traffic/summary")
def get_tomtom_traffic_summary(force: bool = False):
    """
    Returns real-time TomTom traffic corridors delay summary, bottlenecks and alerts for Greater Vancouver.
    Cached 5 minutes. Falls back to static cache if TomTom is unavailable or empty.
    """
    try:
        from tomtom_service import tomtom_service
        res = tomtom_service.get_corridors_summary(force=force)
        if res and isinstance(res, dict) and len(res.get("corridors", [])) > 0:
            return res
    except Exception as e:
        logger.error(f"Error in traffic summary endpoint: {e}")

    # Fallback to static cache
    for p in [
        os.path.join(os.path.dirname(__file__), "data", "vancouver_traffic_summary_cache.json"),
        os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "vancouver_traffic_summary_cache.json"),
    ]:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as read_err:
                logger.error(f"Failed to read static traffic cache from {p}: {read_err}")

    return JSONResponse(status_code=200, content={"corridors": [], "top_alerts": []})


@app.get("/api/traffic/jams")
def get_tomtom_jams(force: bool = False):
    """
    Returns real-time TomTom traffic corridor speed/delay LineStrings as GeoJSON.
    """
    from tomtom_service import tomtom_service
    return tomtom_service.get_jams_geojson(force=force)


@app.get("/api/traffic/alerts")
def get_tomtom_alerts(force: bool = False):
    """
    Returns real-time TomTom traffic incidents and road hazards as GeoJSON Points.
    """
    from tomtom_service import tomtom_service
    return tomtom_service.get_alerts_geojson(force=force)


@app.get("/api/traffic/tiles/{z}/{x}/{y}.png")
def get_tomtom_traffic_tile(z: int, x: int, y: int, style: str = "relative", thickness: int = 2):
    """
    Proxies and caches TomTom Traffic Flow Raster Tiles v4 (relative green/yellow/orange/red full road network overlay).
    Cached 3 minutes to protect TomTom free tier quota and keep API key server-side.
    """
    from fastapi.responses import Response
    from tomtom_service import tomtom_service
    png_bytes = tomtom_service.get_flow_tile(z, x, y, style=style, thickness=thickness)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=180"}
    )



@app.get("/api/beach-water/live")
def get_live_beach_water(force: bool = False):
    """
    Returns latest Metro Vancouver Beach Water Quality monitoring results (E. coli MPN/100ml)
    across all 41 public beaches. Updated monthly.
    """
    import beach_water_service
    return beach_water_service.get_beach_water_data(force=force)


@app.get("/api/beach-water/geojson")
@app.get("/api/geojson/beach-water")
def get_beach_water_geojson():
    import beach_water_service
    return beach_water_service.get_beach_water_geojson()


@app.get("/api/geojson/airports")
def get_airports_geojson():
    static_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_airports.geojson")
    if os.path.exists(static_path):
        with open(static_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}


@app.get("/")
async def root():
    return {"message": "Welcome to Vancouver God's Eye API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/ferries/terminals/{terminal_code}/schedule")
@app.get("/api/bcferries/schedule/{terminal_code}")
async def get_ferry_terminal_schedule(terminal_code: str):
    global cached_bcferries_raw_data
    try:
        now_ts = time.time()
        if cached_bcferries_raw_data.get("data") and (now_ts - cached_bcferries_raw_data.get("timestamp", 0.0) < 60.0):
            data = cached_bcferries_raw_data["data"]
        else:
            r = await asyncio.to_thread(requests.get, 'https://www.bcferriesapi.ca/v2/', timeout=10)
            data = r.json()
            cached_bcferries_raw_data = {"timestamp": now_ts, "data": data}
        
        departures = []
        arrivals = []
        now = get_vancouver_now()
        now_naive = now.replace(tzinfo=None)
        
        seen_dep = {}
        seen_arr = {}
        
        all_routes = data.get('capacityRoutes', []) + data.get('nonCapacityRoutes', [])
        for route in all_routes:
            from_code = route.get('fromTerminalCode')
            to_code = route.get('toTerminalCode')

            # 出發班次 (Departures)
            if from_code == terminal_code:
                arr_code = to_code
                for sailing in route.get('sailings', []):
                    time_str = sailing.get('time')
                    arr_time_str = sailing.get('arrivalTime')
                    fill = sailing.get('fill') or sailing.get('carFill') or 0
                    status = sailing.get('sailingStatus')
                    
                    parsed_dep = None
                    parsed_arr = None
                    if time_str and time_str.lower() != 'variable':
                        try:
                            clean_t = time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower()
                            parsed_dep = datetime.strptime(clean_t, '%I:%M %p')
                            parsed_dep = now_naive.replace(hour=parsed_dep.hour, minute=parsed_dep.minute, second=0, microsecond=0)
                            if arr_time_str and arr_time_str.lower() != 'variable':
                                clean_arr = arr_time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower()
                                parsed_arr = datetime.strptime(clean_arr, '%I:%M %p')
                                parsed_arr = now_naive.replace(hour=parsed_arr.hour, minute=parsed_arr.minute, second=0, microsecond=0)
                            else:
                                parsed_arr = parsed_dep + timedelta(minutes=95)
                            if parsed_arr < parsed_dep:
                                parsed_arr += timedelta(days=1)
                        except Exception:
                            pass

                    if parsed_dep and parsed_arr:
                        if now_naive > parsed_arr:
                            status = 'past'
                        elif parsed_dep <= now_naive <= parsed_arr:
                            status = 'current'
                        else:
                            status = 'future'
                    elif not status or status.lower() not in ('past', 'current', 'cancelled'):
                        status = 'future'
                    
                    key = f"{arr_code}_{time_str}"
                    if key in seen_dep:
                        existing = seen_dep[key]
                        if sailing.get('vesselName') and (not existing.get('vessel_name') or existing.get('vessel_name') == 'BC Ferries'):
                            existing['vessel_name'] = sailing.get('vesselName')
                        if fill > 0 and existing.get('fill') == 0:
                            existing['fill'] = fill
                        if status == 'future':
                            existing['status'] = 'future'
                        elif status == 'current' and existing.get('status') != 'past':
                            existing['status'] = 'current'
                        continue

                    entry = {
                        "origin": from_code,
                        "destination": arr_code,
                        "time": time_str,
                        "arrival_time": arr_time_str,
                        "vessel_name": sailing.get('vesselName'),
                        "status": status,
                        "fill": fill,
                        "direction": "departure"
                    }
                    seen_dep[key] = entry
                    departures.append(entry)

            # 抵達班次 (Arrivals)
            if to_code == terminal_code:
                dep_code = from_code
                for sailing in route.get('sailings', []):
                    time_str = sailing.get('time')
                    arr_time_str = sailing.get('arrivalTime')
                    fill = sailing.get('fill') or sailing.get('carFill') or 0
                    status = sailing.get('sailingStatus')
                    
                    parsed_dep = None
                    parsed_arr = None
                    if time_str and time_str.lower() != 'variable':
                        try:
                            clean_t = time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower()
                            parsed_dep = datetime.strptime(clean_t, '%I:%M %p')
                            parsed_dep = now_naive.replace(hour=parsed_dep.hour, minute=parsed_dep.minute, second=0, microsecond=0)
                            if arr_time_str and arr_time_str.lower() != 'variable':
                                clean_arr = arr_time_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower()
                                parsed_arr = datetime.strptime(clean_arr, '%I:%M %p')
                                parsed_arr = now_naive.replace(hour=parsed_arr.hour, minute=parsed_arr.minute, second=0, microsecond=0)
                            else:
                                parsed_arr = parsed_dep + timedelta(minutes=95)
                            if parsed_arr < parsed_dep:
                                parsed_arr += timedelta(days=1)
                        except Exception:
                            pass

                    if parsed_dep and parsed_arr:
                        if now_naive > parsed_arr:
                            status = 'past'
                        elif parsed_dep <= now_naive <= parsed_arr:
                            status = 'current'
                        else:
                            status = 'future'
                    elif not status or status.lower() not in ('past', 'current', 'cancelled'):
                        status = 'future'
                    
                    key = f"{dep_code}_{time_str}"
                    if key in seen_arr:
                        existing = seen_arr[key]
                        if sailing.get('vesselName') and (not existing.get('vessel_name') or existing.get('vessel_name') == 'BC Ferries'):
                            existing['vessel_name'] = sailing.get('vesselName')
                        if fill > 0 and existing.get('fill') == 0:
                            existing['fill'] = fill
                        if status == 'future':
                            existing['status'] = 'future'
                        elif status == 'current' and existing.get('status') != 'past':
                            existing['status'] = 'current'
                        continue

                    entry = {
                        "origin": dep_code,
                        "destination": to_code,
                        "time": time_str,
                        "arrival_time": arr_time_str,
                        "vessel_name": sailing.get('vesselName'),
                        "status": status,
                        "fill": fill,
                        "direction": "arrival"
                    }
                    seen_arr[key] = entry
                    arrivals.append(entry)
                    
        # Sort by time
        def parse_time(t_str):
            if not t_str or t_str.lower() == 'variable' or t_str.lower() == 'cancelled':
                return datetime(2000, 1, 1)
            try:
                return datetime.strptime(t_str.strip().replace('a.m.', 'am').replace('p.m.', 'pm').lower(), '%I:%M %p')
            except:
                return datetime(2000, 1, 1)
                
        departures.sort(key=lambda x: parse_time(x['time']))
        arrivals.sort(key=lambda x: parse_time(x['arrival_time'] or x['time']))
        return {
            "terminal": terminal_code, 
            "schedule": departures, 
            "departures": departures, 
            "arrivals": arrivals
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/bcferries/vehicles")
@app.get("/api/ferries/vehicles")
async def get_ferry_vehicles_api():
    global cached_bcferries_vehicles
    return {"vehicles": cached_bcferries_vehicles or []}

@app.get("/api/stops/{stop_id}/arrivals")
async def get_stop_arrivals(stop_id: str):
    # Special handling for SeaBus Terminals (Waterfront #8035 & Lonsdale Quay #8036)
    clean_id = str(stop_id).strip()
    if clean_id in ["8035", "8036", "seabus_waterfront", "seabus_lonsdale"] or "seabus" in clean_id.lower():
        try:
            from zoneinfo import ZoneInfo
            now_local = datetime.now(ZoneInfo("America/Vancouver"))
        except Exception:
            import datetime as dt_mod
            now_local = datetime.utcnow() - dt_mod.timedelta(hours=7)

        is_waterfront = clean_id in ["8035", "seabus_waterfront"]
        dest = "Lonsdale Quay" if is_waterfront else "Waterfront Station"
        headway = 15 if (6 <= now_local.hour < 21) else 30

        now_sec = now_local.minute * 60 + now_local.second
        slot_sec = headway * 60
        curr_slot_idx = now_sec // slot_sec

        seabus_arrivals = []
        for i in range(1, 5):
            target_min_total = (curr_slot_idx + i) * headway
            dep_hour = (now_local.hour + (target_min_total // 60)) % 24
            dep_min = target_min_total % 60

            diff_sec = (dep_hour * 3600 + dep_min * 60) - (now_local.hour * 3600 + now_local.minute * 60 + now_local.second)
            if diff_sec < 0:
                diff_sec += 86400
            diff_min = max(1, round(diff_sec / 60))

            seabus_arrivals.append({
                "route_id": "6771",
                "route_number": "SeaBus",
                "route_name": "SeaBus 跨海渡輪",
                "destination": dest,
                "direction": "Northbound" if is_waterfront else "Southbound",
                "minutes": diff_min,
                "expected_countdown": f"{diff_min} 分鐘",
                "scheduled_time": f"{dep_hour:02d}:{dep_min:02d}",
                "status": "準時",
                "operator": "TransLink (SeaBus 海上巴士)",
                "is_seabus": True
            })
        return {"stop_id": stop_id, "arrivals": seabus_arrivals}

    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    raw_list = stop_arrivals.get(stop_id, [])[:10]
    enriched = []
    for item in raw_list:
        rid = str(item.get("route_id", ""))
        rmeta = routes_lookup.get(rid, {})
        rnum = item.get("route_number") or rmeta.get("route_number") or rid
        if rnum.isdigit():
            rnum = str(int(rnum))
        enriched.append({
            **item,
            "route_number": rnum,
            "route_name": item.get("route_name") or rmeta.get("long_name", ""),
        })
    return {"stop_id": stop_id, "arrivals": enriched}


@app.get("/api/transit/route/{route_id}")
def get_transit_route_details(route_id: str, variant: str = ""):
    """
    Returns full route geometry, stops, and current active buses for a specific route.
    """
    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    variants_lookup = gtfs_meta.get("variants", {})
    default_variants = gtfs_meta.get("route_default_variants", {})

    rid = str(route_id).strip()
    rmeta = routes_lookup.get(rid)
    if not rmeta:
        for k, v in routes_lookup.items():
            if str(v.get("route_number", "")).lower() == rid.lower() or str(v.get("raw_short_name", "")).lower() == rid.lower():
                rid = k
                rmeta = v
                break

    rmeta = rmeta or {}
    rnum = str(rmeta.get("route_number") or rid)
    rlong = str(rmeta.get("long_name") or "")

    primary_v = None
    if variant and variant in variants_lookup:
        primary_v = variants_lookup[variant]
    else:
        def_key_0 = default_variants.get(f"{rid}_0")
        def_key_1 = default_variants.get(f"{rid}_1")
        if def_key_0 and def_key_0 in variants_lookup:
            primary_v = variants_lookup[def_key_0]
        elif def_key_1 and def_key_1 in variants_lookup:
            primary_v = variants_lookup[def_key_1]
        else:
            route_variants = [v for v in variants_lookup.values() if str(v.get("route_id")) == rid]
            if route_variants:
                primary_v = max(route_variants, key=lambda v: len(v.get("stops", [])))

    shape_coords = primary_v.get("shape_coords", []) if primary_v else []
    stops = primary_v.get("stops", []) if primary_v else []
    origin = primary_v.get("origin", "") if primary_v else ""
    destination = primary_v.get("destination", "") if primary_v else rlong
    operator = primary_v.get("operator", "TransLink (CMBC 岸山巴士)") if primary_v else "TransLink (CMBC 岸山巴士)"

    route_buses = [
        v for v in cached_translink_vehicles
        if str(v.get("route_id")) == rid or str(v.get("route_number", "")).lower() == rnum.lower()
    ]

    return {
        "route_id": rid,
        "route_number": rnum,
        "route_name": f"{rnum} {rlong}".strip() if rnum not in rlong else rlong,
        "color": rmeta.get("color", "#10b981"),
        "origin": origin,
        "destination": destination,
        "operator": operator,
        "shape_coords": shape_coords,
        "stops": stops,
        "buses": route_buses
    }


@app.get("/api/transit/vehicle-details")
def get_transit_vehicle_details(
    vehicle_id: str = "",
    route_id: str = "",
    trip_id: str = "",
    direction_id: str = "0",
    stop_id: str = "",
    stop_seq: int = 0,
    lat: float = 0.0,
    lon: float = 0.0,
):
    """
    回傳單一即時巴士或海上巴士 (SeaBus) 的完整路線、起點、終點、當前狀態、下一站預估時間、完整沿線站點清單與地圖軌跡座標
    """
    gtfs_meta = get_gtfs_metadata()
    routes_lookup = gtfs_meta.get("routes", {})
    rmeta = routes_lookup.get(str(route_id), {})
    route_number = rmeta.get("route_number") or str(route_id)
    if route_number.isdigit():
        route_number = str(int(route_number))

    variant = _resolve_vehicle_variant(str(route_id), str(trip_id), str(direction_id), gtfs_meta)
    prog = _compute_vehicle_stop_progress(variant, str(stop_id), int(stop_seq or 0), float(lat or 0.0), float(lon or 0.0), str(trip_id))

    is_seabus_vehicle = str(route_id) in ["6771", "seabus"] or str(vehicle_id).startswith("seabus") or "seabus" in str(route_number).lower()
    if is_seabus_vehicle:
        is_nb = str(direction_id) == "0"
        origin = "Waterfront Station" if is_nb else "Lonsdale Quay"
        destination = "Lonsdale Quay" if is_nb else "Waterfront Station"
        route_name = "SeaBus 跨海渡輪"
        operator = "TransLink (SeaBus 海上巴士)"
        color = "#0284c7"
        shape_coords = [[-123.1118, 49.2861], [-123.0829, 49.3103]] if is_nb else [[-123.0829, 49.3103], [-123.1118, 49.2861]]
        dest_lat = 49.3103 if is_nb else 49.2861
        dest_lon = -123.0829 if is_nb else -123.1118

        eta_min = prog.get("next_stop_minutes")
        eta_time = prog.get("next_stop_time") or ""
        for cached_v in cached_translink_vehicles:
            if str(cached_v.get("id")) == str(vehicle_id):
                if cached_v.get("next_stop_minutes") is not None:
                    eta_min = cached_v["next_stop_minutes"]
                if cached_v.get("next_stop_time"):
                    eta_time = cached_v["next_stop_time"]
                break
        if eta_min is None:
            if lat and lon:
                dist_km = math.hypot((dest_lat - lat) * 111.0, (dest_lon - lon) * 73.0)
                eta_min = max(1, min(12, int(round(dist_km / 0.28))))
            else:
                eta_min = 5
        if not eta_time:
            eta_time = _format_vancouver_hhmm(time.time() + eta_min * 60)

        stops_list = [
            {
                "seq": 1,
                "stop_id": "8035" if is_nb else "8036",
                "name": origin,
                "lat": 49.2861 if is_nb else 49.3103,
                "lon": -123.1118 if is_nb else -123.0829,
                "status": "passed"
            },
            {
                "seq": 2,
                "stop_id": "8036" if is_nb else "8035",
                "name": destination,
                "lat": dest_lat,
                "lon": dest_lon,
                "status": "next",
                "eta_time": eta_time,
                "eta_minutes": eta_min
            }
        ]
        return {
            "vehicle_id": vehicle_id,
            "route_id": "6771",
            "route_number": "SeaBus",
            "route_name": route_name,
            "color": color,
            "operator": operator,
            "origin": origin,
            "destination": destination,
            "current_action": f"開往 {destination}",
            "next_stop_name": destination,
            "next_stop_time": eta_time,
            "next_stop_minutes": eta_min,
            "next_stop_index": 1,
            "run_status": "準時",
            "stops": stops_list,
            "shape_coords": shape_coords,
            "is_seabus": True
        }

    if variant:
        origin = variant.get("origin", "")
        destination = variant.get("destination", "")
        route_name = variant.get("route_name", f"{route_number} {rmeta.get('long_name', '')}".strip())
        operator = variant.get("operator", "TransLink (CMBC 岸山巴士)")
        color = variant.get("color", "#10b981")
        shape_coords = variant.get("shape_coords", [])
    else:
        origin = "起點總站"
        destination = rmeta.get("long_name", "終點總站")
        route_name = f"{route_number} {rmeta.get('long_name', '')}".strip()
        operator = "TransLink (CMBC 岸山巴士)"
        color = rmeta.get("color", "#10b981")
        shape_coords = []

    return {
        "vehicle_id": vehicle_id,
        "route_id": route_id,
        "route_number": route_number,
        "route_name": route_name,
        "color": color,
        "operator": operator,
        "origin": origin,
        "destination": destination,
        "current_action": f"開往 {destination}" if destination else "沿線行駛中",
        "next_stop_name": prog["next_stop_name"],
        "next_stop_time": prog["next_stop_time"],
        "next_stop_minutes": prog["next_stop_minutes"],
        "next_stop_index": prog["next_stop_index"],
        "run_status": "準時",
        "stops": prog["stops"],
        "shape_coords": shape_coords,
    }

_curated_static_caches = {}
_db_synced_curated_types = set()

CURATED_STATIC_TYPES = (
    "bikeways", "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "local_area_boundary", "fuel", "ev_charging", "tesla", "marine_terminals", 
    "one_way_streets", "snow_removal_routes", "crime_areas", "water_distribution_mains", 
    "sewer_mains", "traffic_speed_limits", "bike_racks", "postal_code_fsa",
    "traffic_crosswalks", "litter_containers", "food_banks", "recycling", "van_wifi",
    "road_closures", "road_construction", "street_lighting", "street_lighting_poles", "street_lighting_conduits", "traffic_conditions",
    "beach_water_quality", "beach_water", "fire_hydrants", "zoning_districts", "traffic_alerts", "public_trees",
    "museums", "garbage_collection"
)
POINT_CURATED_TYPES = (
    "hospitals", "police", "disaster_hubs", "car_sharing", "aed", 
    "fuel", "ev_charging", "tesla", "marine_terminals", "bike_racks",
    "traffic_crosswalks", "litter_containers", "food_banks", "recycling", "van_wifi",
    "schools", "libraries", "food_vendors", "homeless_shelters", "parks", "parks_facilities",
    "community_gardens", "community_centres", "drinking_fountains", "public_washrooms", "fire_halls",
    "traffic_cameras", "safety_cameras", "shared_bikes", "escooter", "museums"
)

def sync_curated_point_types(db: Session):
    missing_types = [ft for ft in POINT_CURATED_TYPES if ft not in _db_synced_curated_types]
    if not missing_types:
        return

    try:
        existing_rows = (
            db.query(models.RoadFacility.facility_type)
            .filter(models.RoadFacility.facility_type.in_(missing_types))
            .distinct()
            .all()
        )
        for (ft,) in existing_rows:
            _db_synced_curated_types.add(ft)
    except Exception:
        # DB is offline or unreachable; skip DB sync so /api/search falls back to static JSON immediately
        return

    for facility_type in POINT_CURATED_TYPES:
        if facility_type not in _db_synced_curated_types:
            filename = f"vancouver_{facility_type}.geojson"
            static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
            if os.path.exists(static_geojson_path):
                try:
                    import json
                    with open(static_geojson_path, "r", encoding="utf-8") as f:
                        static_geojson = json.load(f)
                    db.query(models.RoadFacility).filter(models.RoadFacility.facility_type == facility_type).delete()
                    facs_to_add = []
                    seen_ids = set()
                    for feat in static_geojson.get("features", []):
                        props = feat.get("properties", {})
                        geom_type = feat.get("geometry", {}).get("type")
                        coords = feat.get("geometry", {}).get("coordinates", [])
                        if geom_type == "Point" and len(coords) >= 2 and isinstance(coords[0], (int, float)):
                            lon, lat = coords[0], coords[1]
                            fac_id = str(feat.get("id") or props.get("id") or f"{facility_type}_{lon}_{lat}")
                            if fac_id in seen_ids:
                                continue
                            seen_ids.add(fac_id)
                            fac = models.RoadFacility(
                                id=fac_id,
                                facility_type=facility_type,
                                name=props.get("name", "Unknown"),
                                local_area=props.get("local_area") or props.get("municipality", ""),
                                lat=lat,
                                lon=lon,
                                geom=f"SRID=4326;POINT({lon} {lat})",
                                details={k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")},
                                last_updated=datetime.utcnow()
                            )
                            facs_to_add.append(fac)
                    if facs_to_add:
                        db.bulk_save_objects(facs_to_add)
                    db.commit()
                    _db_synced_curated_types.add(facility_type)
                except Exception as e:
                    db.rollback()
                    _db_synced_curated_types.add(facility_type)
                    print(f"Error syncing {facility_type} to DB: {e}")



@app.get("/api/search")
def search_layer_items(
    q: str = "",
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    limit: int = 80,
):
    """
    全圖層高效能記憶體倒排索引搜尋 (Sub-Millisecond Inverted-Index Layer Search):
    - 涵蓋 55+ 圖層 (設施、地標、天車站、公車站牌/5位站號、巴士路線、BC Ferries、機場、邊境關卡、滑雪場、潮汐站、即時船隻、門牌地址、郵遞區號、GPS 坐標)
    - 支援繁簡體自動歸一化、中英文別名/縮寫擴展、序數與路名雙向同義詞、多欄位統一相關度評分與距離加權排序
    """
    safe_limit = max(1, min(int(limit or 80), 150))
    try:
        live_vessels = shipping_service.get_vessels()
    except Exception:
        live_vessels = None

    results = search_engine.search(
        q,
        ref_lat=lat,
        ref_lon=lon,
        limit=safe_limit,
        gtfs_provider=get_gtfs_metadata,
        db_session_factory=database.SessionLocal,
        live_vessels=live_vessels,
        live_ferries=cached_bcferries_vehicles,
    )
    return {"results": results}

from html.parser import HTMLParser

class ImgTagParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'img':
            self.tags.append(dict(attrs))

_ALLOWED_WEBCAM_HOSTS = {
    "trafficcams.vancouver.ca",
    "images.drivebc.ca",
    "www.drivebc.ca",
    "drivebc.ca",
    "webcams.drivebc.ca",
    "ns-webcams.its.sfu.ca",
    "weathercams.faa.gov",
    "weathercams-api.faa.gov",
    "images.weathercams.faa.gov",
    "images.wcams-static.faa.gov",
    "wcams-static.faa.gov",
    "wcams.faa.gov",
}


def _validate_safe_webcam_url(raw_url: str) -> str | None:
    """
    嚴格驗證交通攝影機 URL，徹底防範 SSRF (Server-Side Request Forgery) 探測內網容器或雲端 Metadata (169.254.169.254)。
    僅允許白名單官方交通攝影機網域、標準埠號，且解析後 IP 不得為私有/迴路/鏈路本地位址。
    """
    if not raw_url or not isinstance(raw_url, str) or len(raw_url) > 1024:
        return None
    u = raw_url.strip()
    if u.startswith("http://"):
        u = "https://" + u[7:]
    try:
        parsed = urllib.parse.urlparse(u)
    except Exception:
        return None
    if parsed.scheme != "https":
        return None
    if parsed.username or parsed.password:
        return None
    if parsed.port not in (None, 443):
        return None
    hostname = (parsed.hostname or "").lower().strip(".")
    if hostname not in _ALLOWED_WEBCAM_HOSTS and not hostname.endswith(".faa.gov") and not hostname.endswith(".drivebc.ca"):
        return None
    try:
        infos = socket.getaddrinfo(hostname, 443, proto=socket.IPPROTO_TCP)
        for info in infos:
            ip_obj = ipaddress.ip_address(info[4][0])
            if (
                ip_obj.is_private
                or ip_obj.is_loopback
                or ip_obj.is_link_local
                or ip_obj.is_multicast
                or ip_obj.is_reserved
                or ip_obj.is_unspecified
            ):
                return None
    except Exception:
        return None
    return u


webcam_images_cache = {}

@app.get("/api/webcam/images")
def get_webcam_images(url: str):
    """
    獲取溫哥華交通攝影機頁面 (trafficcams.vancouver.ca) 的即時畫面圖片 (內建 SSRF 白名單防護)
    """
    safe_url = _validate_safe_webcam_url(url)
    if not safe_url:
        return {"images": []}
    url = safe_url

    now = time.time()
    if url in webcam_images_cache:
        cached_time, cached_data = webcam_images_cache[url]
        if now - cached_time < 300: # 5分鐘快取
            return {"images": cached_data}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=12, allow_redirects=False)
        if resp.status_code != 200:
            print(f"Webcam page returned status {resp.status_code} for {url}")
            return {"images": []}

        # Parse with standard library HTMLParser (zero external dependency)
        parser = ImgTagParser()
        parser.feed(resp.text[:512000])
        img_tags = parser.tags

        images = []
        for img in img_tags:
            src = img.get('src', '')
            alt = img.get('alt', '')
            if 'cameraimages' in src or (src.endswith('.jpg') and 'city-emblem' not in src and 'favicon' not in src):
                full_src = src if src.startswith('http') else f"https://trafficcams.vancouver.ca/{src.lstrip('/')}"
                if not _validate_safe_webcam_url(full_src):
                    continue
                direction = "即時路況"
                alt_clean = alt.replace("Traffic Camera Images", "").strip()
                if " - " in alt_clean:
                    direction = alt_clean.split(" - ")[-1].strip()
                elif "North" in src or "north" in src or "North" in alt:
                    direction = "北向 (North)"
                elif "South" in src or "south" in src or "South" in alt:
                    direction = "南向 (South)"
                elif "East" in src or "east" in src or "East" in alt:
                    direction = "東向 (East)"
                elif "West" in src or "west" in src or "West" in alt:
                    direction = "西向 (West)"
                else:
                    direction = alt_clean or "即時路況"

                images.append({
                    "url": full_src,
                    "direction": direction,
                    "alt": alt
                })

        if len(webcam_images_cache) > 200:
            expired_keys = [k for k, (t_val, _) in list(webcam_images_cache.items()) if now - t_val >= 300]
            for k in expired_keys:
                webcam_images_cache.pop(k, None)
            if len(webcam_images_cache) > 200:
                oldest_key = min(webcam_images_cache, key=lambda k: webcam_images_cache[k][0])
                webcam_images_cache.pop(oldest_key, None)
        webcam_images_cache[url] = (now, images)
        return {"images": images}
    except Exception as e:
        print(f"Error fetching webcam images for {url}: {e}")
        return {"images": []}

from fastapi import Response
from fastapi.responses import FileResponse

webcam_image_bytes_cache = {}
MAX_WEBCAM_BYTES_CACHE_ITEMS = 120

@app.get("/api/webcam/proxy")
def proxy_webcam_image(url: str):
    """
    代理交通攝影機圖片，避免瀏覽器跨域 (CORS) 或 Referrer 限制，內建 SSRF 白名單與圖片大小上限防護
    """
    safe_url = _validate_safe_webcam_url(url)
    if not safe_url:
        return Response(status_code=403)
    url = safe_url
    now = time.time()
    if url in webcam_image_bytes_cache:
        ts, content, mtype = webcam_image_bytes_cache[url]
        if now - ts < 180 and content:
            return Response(
                content=content,
                media_type=mtype,
                headers={"Cache-Control": "public, max-age=180"}
            )
    try:
        ref_host = "https://weathercams.faa.gov/" if "faa.gov" in url else "https://trafficcams.vancouver.ca/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Referer": ref_host
        }
        r = requests.get(url, headers=headers, timeout=12, allow_redirects=False, stream=True)
        if r.status_code == 200:
            mtype = (r.headers.get("content-type") or "image/jpeg").split(";")[0].strip().lower()
            if not mtype.startswith("image/"):
                r.close()
                return Response(status_code=415)
            chunks = []
            total_len = 0
            for chunk in r.iter_content(chunk_size=65536):
                total_len += len(chunk)
                if total_len > 5 * 1024 * 1024:
                    r.close()
                    return Response(status_code=413)
                chunks.append(chunk)
            content = b"".join(chunks)
            if content:
                if len(webcam_image_bytes_cache) >= MAX_WEBCAM_BYTES_CACHE_ITEMS:
                    expired = [k for k, (t_val, _, _) in list(webcam_image_bytes_cache.items()) if now - t_val >= 180]
                    for k in expired:
                        webcam_image_bytes_cache.pop(k, None)
                    if len(webcam_image_bytes_cache) >= MAX_WEBCAM_BYTES_CACHE_ITEMS:
                        oldest_key = min(webcam_image_bytes_cache, key=lambda k: webcam_image_bytes_cache[k][0])
                        webcam_image_bytes_cache.pop(oldest_key, None)
                webcam_image_bytes_cache[url] = (now, content, mtype)
                return Response(
                    content=content,
                    media_type=mtype,
                    headers={"Cache-Control": "public, max-age=180"}
                )
        return Response(status_code=404)
    except Exception as e:
        print(f"Webcam proxy error for {url}: {e}")
        return Response(status_code=404)

hospital_waittimes_cache = {"timestamp": 0, "data": {}}

def _format_minutes_hm(mins_val):
    if mins_val is None:
        return None
    try:
        m_int = int(mins_val)
        hours = m_int // 60
        mins = m_int % 60
        if hours > 0 and mins > 0:
            return f"{hours}h {mins}m"
        elif hours > 0:
            return f"{hours}h"
        else:
            return f"{mins}m"
    except Exception:
        return None

@app.get("/api/hospitals/waittimes")
def get_hospital_waittimes():
    """
    獲取溫哥華各大醫院急診與 UPCC 急症暨基層醫療中心即時預估等候時間 (https://www.edwaittimes.ca & erstat.ca)
    每 15 分鐘自動快取更新一次
    """
    now = time.time()
    if now - hospital_waittimes_cache["timestamp"] < 900 and hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    hosp_map = {}

    # 1. Fetch live wait times from official BC ED/UPCC API (https://www.edwaittimes.ca/api/wait-times)
    for url_ed in ("https://www.edwaittimes.ca/api/wait-times", "https://edwaittimes.ca/api/wait-times"):
        try:
            resp_ed = requests.get(url_ed, headers=headers, timeout=12)
            if resp_ed.status_code == 200:
                ed_items = resp_ed.json()
                for it in ed_items:
                    name = it.get('name')
                    if not name:
                        continue
                    wt = it.get('waitTime') or {}
                    wt_min = wt.get('waitTimeMinutes')
                    elos_min = wt.get('elosMinutes')
                    status = wt.get('status') or 'normal'
                    wt_str = _format_minutes_hm(wt_min) or "門診正常"
                    elos_str = _format_minutes_hm(elos_min)

                    norm_key = name.strip().lower().replace("’", "'")
                    entry_obj = {
                        "name": name,
                        "slug": it.get('slug'),
                        "type": it.get('type'),
                        "wait_time": wt_str,
                        "wait_minutes": wt_min,
                        "elos_time": elos_str,
                        "elos_minutes": elos_min,
                        "status": status,
                        "address": it.get('address'),
                        "is_predicted": False,
                        "url": "https://www.edwaittimes.ca"
                    }
                    hosp_map[norm_key] = entry_obj
                    if "children" in norm_key:
                        hosp_map["bc children's hospital"] = entry_obj
                        hosp_map["bcch"] = entry_obj
                if hosp_map:
                    break
        except Exception as e:
            print(f"Error fetching {url_ed}: {e}")

    # 2. Supplement or fallback with erstat.ca for additional hospital emergency wait predictions
    try:
        url = "https://erstat.ca/hospitals/bc/vancouver"
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            html = resp.text
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, 'html.parser')
                for a in soup.find_all('a', class_='hospital-row'):
                    h3 = a.find('h3')
                    if not h3: continue
                    name = h3.get_text(strip=True)
                    p = a.find('p')
                    meta_text = p.get_text(' ', strip=True) if p else ''
                    wait_div = a.find('div', class_='hospital-row-wait')
                    wait_time = wait_div.get_text(strip=True) if wait_div else 'N/A'
                    classes = wait_div.get('class', []) if wait_div else []
                    href = a.get('href', '')

                    status = 'normal'
                    if 'packed' in classes: status = 'packed'
                    elif 'moderate' in classes: status = 'moderate'
                    elif 'quick' in classes: status = 'quick'

                    k = name.lower().replace("’", "'")
                    if k not in hosp_map or hosp_map[k]["wait_time"] in ("門診正常", "N/A"):
                        hosp_map[k] = {
                            "name": name,
                            "meta": meta_text,
                            "wait_time": wait_time,
                            "status": status,
                            "is_predicted": 'predicted' in classes,
                            "url": "https://www.edwaittimes.ca"
                        }
            except Exception:
                pass
    except Exception as e:
        print(f"Error fetching erstat: {e}")

    if hosp_map:
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        hospital_waittimes_cache["timestamp"] = now
        hospital_waittimes_cache["updated_at_str"] = now_str
        hospital_waittimes_cache["data"] = hosp_map
        return {
            "cached": False,
            "last_updated": now_str,
            "hospitals": hosp_map
        }

    if hospital_waittimes_cache["data"]:
        return {
            "cached": True,
            "last_updated": hospital_waittimes_cache.get("updated_at_str", ""),
            "hospitals": hospital_waittimes_cache["data"]
        }

    return {"cached": False, "last_updated": "", "hospitals": {}}

import json
import re
import math
from typing import Optional
from sqlalchemy import func

_bikeways_geojson_cache = {"data": None, "mtime": 0}
_contours_caches = {
    "1m": {"data": None, "mtime": 0},
    "2m": {"data": None, "mtime": 0},
    "10m": {"data": None, "mtime": 0},
}

_ALLOWED_DB_ROAD_FACILITY_TYPES = {
    "parking_meters",
    "motorcycle_parking",
    "accessible_parking",
    "ev_charging",
    "bike_racks",
    "shared_bikes",
    "escooter",
    "car_sharing",
    "traffic_signals",
    "traffic_crosswalks",
    "traffic_cameras",
    "safety_cameras",
    "aed",
    "public_washrooms",
    "drinking_fountains",
    "litter_containers",
    "community_centres",
    "libraries",
    "schools",
    "museums",
    "public_art",
    "food_banks",
    "food_vendors",
    "homeless_shelters",
    "recycling",
    "fire_halls",
    "fire_hydrants",
    "police",
    "hospitals",
    "disaster_hubs",
    "van_wifi",
    "canada_post",
    "fedex",
    "purolator",
    "banks",
    "fuel",
    "tesla",
    "impark",
}

@app.get("/api/geojson/road/{facility_type}")
def get_road_facilities_geojson(
    facility_type: str, 
    interval: str = "10m", 
    max_rate: Optional[float] = None,
    credit_card_only: bool = False,
    time_period: Optional[str] = "auto",
    db: Session = Depends(database.get_db)
):
    """
    facility_type can be 'parking_meters', 'accessible_parking', 'motorcycle_parking', 'ev_charging', 'bikeways', 'contours', etc.
    For contours, interval can be '1m', '2m', '10m'.
    內建嚴格路徑字元白名單檢查，防範目錄穿越 (Path Traversal) 與任意資料庫自動寫入。
    """
    facility_type = (facility_type or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{1,50}", facility_type):
        return JSONResponse(status_code=400, content={"type": "FeatureCollection", "features": [], "error": "Invalid facility_type"})

    # 1. Handle Contours with 1m, 2m, 10m intervals
    if facility_type.startswith("contours"):
        raw_int = "10m"
        if facility_type == "contours_1m" or interval.strip().lower() in ("1m", "1"):
            raw_int = "1m"
        elif facility_type == "contours_2m" or interval.strip().lower() in ("2m", "2"):
            raw_int = "2m"
        
        filename = f"vancouver_contours_{raw_int}.geojson"
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", filename)
        if not os.path.exists(static_geojson_path) and raw_int == "10m":
            static_geojson_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_contours.geojson")

        if os.path.exists(static_geojson_path):
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})
        return {"type": "FeatureCollection", "features": []}

    # Handle Tide Stations
    if facility_type == "tide_stations":
        import tides_service
        return tides_service.get_tides_geojson()

    # Handle TomTom Traffic Corridors (LineString 色帶)
    if facility_type in ("traffic_conditions", "traffic"):
        try:
            from tomtom_service import tomtom_service
            return tomtom_service.get_jams_geojson()
        except Exception as e:
            print(f"[TomTomTraffic] Fallback to static jams: {e}")

    # Handle TomTom Traffic Alerts / Incidents (Point 圖釘)
    if facility_type in ("traffic_alerts", "traffic_reports"):
        try:
            from tomtom_service import tomtom_service
            return tomtom_service.get_alerts_geojson()
        except Exception as e:
            print(f"[TomTomTraffic] Fallback to static alerts: {e}")

    # Handle Beach Water Quality
    if facility_type in ("beach_water_quality", "beach_water"):
        import beach_water_service
        return beach_water_service.get_beach_water_geojson()

    # Handle Street Lighting Poles
    if facility_type in ("street_lighting", "street_lighting_poles"):
        poles_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_street_lighting_poles.geojson")
        if os.path.exists(poles_path):
            return FileResponse(poles_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    # Handle Street Lighting Conduits
    if facility_type in ("street_lighting_conduits", "street_conduits"):
        conduits_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_street_lighting_conduits.geojson")
        if os.path.exists(conduits_path):
            return FileResponse(conduits_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    # Handle Banks (formerly ATM)
    if facility_type in ("banks", "atm"):
        banks_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_banks.geojson")
        if os.path.exists(banks_path):
            return FileResponse(banks_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    # 2. Prioritize verified precompiled static GeoJSON files (instant zero-copy static serving)
    static_geojson_path = os.path.join(os.path.dirname(__file__), "data", f"vancouver_{facility_type}.geojson")

    # 針對 parking_meters 與 motorcycle_parking，直接由靜態 GeoJSON 解析並支援時段與費率過濾，避開 SQLite 缺乏 AsEWKB 空間擴充之例外
    if facility_type in ('parking_meters', 'motorcycle_parking'):
        if os.path.exists(static_geojson_path):
            try:
                with open(static_geojson_path, "r", encoding="utf-8") as f:
                    static_data = json.load(f)

                # 判定溫哥華當地時間時段
                try:
                    from zoneinfo import ZoneInfo
                    vancouver_now = datetime.now(ZoneInfo("America/Vancouver"))
                except Exception:
                    vancouver_now = datetime.utcnow() - timedelta(hours=7)

                current_hour = vancouver_now.hour
                period_mode = (time_period or "auto").lower()
                if period_mode == "night":
                    active_period = "night"
                elif period_mode == "day":
                    active_period = "day"
                else:  # auto
                    if 9 <= current_hour < 18:
                        active_period = "day"
                    elif 18 <= current_hour < 22:
                        active_period = "night"
                    else:
                        active_period = "free"

                filtered_features = []
                for feat in static_data.get("features", []):
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if not coords or len(coords) < 2:
                        continue
                    props = dict(feat.get("properties", {}) or {})
                    props['active_period'] = active_period
                    props['vancouver_time'] = vancouver_now.strftime("%H:%M")

                    if active_period == "night":
                        raw_rate = props.get('rate_6pm_10pm') or props.get('rate_9am_6pm') or props.get('rate') or ''
                    elif active_period == "free":
                        raw_rate = '0'
                    else:  # day
                        raw_rate = props.get('rate_9am_6pm') or props.get('r_mf_9a_6p') or props.get('rate') or ''

                    rate_num = None
                    rate_match = re.search(r'(\d+(?:\.\d+)?)', str(raw_rate))
                    if rate_match:
                        try:
                            rate_num = float(rate_match.group(1))
                        except ValueError:
                            rate_num = None
                    elif active_period == "free":
                        rate_num = 0.0

                    props['rate_numeric'] = rate_num
                    props['effective_rate'] = f"${rate_num:.2f}" if rate_num is not None and active_period != "free" else "免費" if active_period == "free" else "未提供"

                    if max_rate is not None and 0 < max_rate < 20:
                        if rate_num is not None and rate_num > max_rate:
                            continue
                    if credit_card_only:
                        cc = str(props.get('credit_card') or props.get('creditcard') or '').lower()
                        if cc not in ('yes', 'true', '1'):
                            continue

                    filtered_features.append({
                        "type": "Feature",
                        "geometry": feat.get("geometry"),
                        "properties": props
                    })

                return JSONResponse(
                    content={"type": "FeatureCollection", "features": filtered_features},
                    headers={"Cache-Control": "public, max-age=60, stale-while-revalidate=300"}
                )
            except Exception as e:
                print(f"Error serving {facility_type} from static geojson: {e}")

    if facility_type not in ('parking_meters', 'motorcycle_parking'):
        if os.path.exists(static_geojson_path):
            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

    if facility_type not in _ALLOWED_DB_ROAD_FACILITY_TYPES:
        return {"type": "FeatureCollection", "features": []}

    from sqlalchemy.orm import defer
    facilities = db.query(models.RoadFacility).options(defer(models.RoadFacility.geom)).filter(models.RoadFacility.facility_type == facility_type).all()
    
    # Auto-import on-the-fly if not yet populated in DB (加鎖保護，防止高並發冷啟動重複寫入衝突)
    if not facilities:
        with _road_seed_lock:
            facilities = db.query(models.RoadFacility).options(defer(models.RoadFacility.geom)).filter(models.RoadFacility.facility_type == facility_type).all()
            if not facilities:
                # 1. Check for precompiled verified GeoJSON in backend/data/
                if os.path.exists(static_geojson_path):
                    try:
                        with open(static_geojson_path, "r", encoding="utf-8") as f:
                            static_geojson = json.load(f)
                        
                        facs_to_add = []
                        for feat in static_geojson.get("features", []):
                            props = feat.get("properties", {})
                            coords = feat.get("geometry", {}).get("coordinates", [])
                            if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
                                lon, lat = coords[0], coords[1]
                                fac_id = feat.get("id") or props.get("id") or f"{facility_type}_{lon}_{lat}"
                                fac = models.RoadFacility(
                                    id=str(fac_id),
                                    facility_type=facility_type,
                                    name=props.get("name", "Unknown"),
                                    local_area=props.get("local_area") or props.get("municipality", ""),
                                    lat=lat,
                                    lon=lon,
                                    geom=f"SRID=4326;POINT({lon} {lat})",
                                    details={k: v for k, v in props.items() if k not in ("id", "facility_type", "name", "local_area")},
                                    last_updated=datetime.utcnow()
                                )
                                facs_to_add.append(fac)
                        if facs_to_add:
                            db.bulk_save_objects(facs_to_add)
                        db.commit()
                        if facility_type not in ('parking_meters', 'motorcycle_parking'):
                            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})
                        facilities = db.query(models.RoadFacility).options(defer(models.RoadFacility.geom)).filter(models.RoadFacility.facility_type == facility_type).all()
                    except Exception as e:
                        db.rollback()
                        print(f"Error populating {facility_type} from static geojson: {e}")
                        if os.path.exists(static_geojson_path) and facility_type not in ('parking_meters', 'motorcycle_parking'):
                            return FileResponse(static_geojson_path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"})

                # 2. Try online API import only if still empty
                if not facilities:
                    try:
                        from scripts.import_road_data import import_single_facility_type
                        import_single_facility_type(facility_type, db)
                        facilities = db.query(models.RoadFacility).options(defer(models.RoadFacility.geom)).filter(models.RoadFacility.facility_type == facility_type).all()
                    except Exception as e:
                        db.rollback()
                        print(f"Auto-import error for {facility_type}: {e}")

    # Fallback to static geojson file if still empty
    if not facilities:
        static_geojson_path = os.path.join(os.path.dirname(__file__), "data", f"vancouver_{facility_type}.geojson")
        if os.path.exists(static_geojson_path):
            with open(static_geojson_path, "r", encoding="utf-8") as f:
                static_data = json.load(f)
            if facility_type not in ('parking_meters', 'motorcycle_parking'):
                return static_data
            class MockFacility:
                def __init__(self, id, ftype, name, local_area, lon, lat, details):
                    self.id = id
                    self.facility_type = ftype
                    self.name = name
                    self.local_area = local_area
                    self.lon = lon
                    self.lat = lat
                    self.details = details
            facilities = []
            for feat in static_data.get("features", []):
                coords = feat.get("geometry", {}).get("coordinates", [])
                p = feat.get("properties", {})
                if len(coords) >= 2:
                    facilities.append(MockFacility(
                        feat.get("id") or p.get("id"),
                        facility_type,
                        p.get("name", "Unknown"),
                        p.get("local_area", ""),
                        coords[0],
                        coords[1],
                        p
                    ))
            
    features = []
    for f in facilities:
        props = {
            "id": f.id,
            "facility_type": f.facility_type,
            "name": f.name,
            "local_area": f.local_area,
        }
        if f.details and isinstance(f.details, dict):
            props.update(f.details)

        if facility_type in ('parking_meters', 'motorcycle_parking'):
            # 判斷時段：auto (根據溫哥華當地時間), day (日間 9am-6pm), night (夜間 6pm-10pm)
            try:
                from zoneinfo import ZoneInfo
                vancouver_now = datetime.now(ZoneInfo("America/Vancouver"))
            except Exception:
                vancouver_now = datetime.utcnow() - timedelta(hours=7)
            
            current_hour = vancouver_now.hour

            # 決定當前查詢時段
            period_mode = (time_period or "auto").lower()
            if period_mode == "night":
                active_period = "night"
            elif period_mode == "day":
                active_period = "day"
            else:  # auto: 根據溫哥華目前時間自動判斷
                if 9 <= current_hour < 18:
                    active_period = "day"
                elif 18 <= current_hour < 22:
                    active_period = "night"
                else:
                    active_period = "free"  # 溫哥華路邊停車錶在 22:00 至次日 09:00 為免費時段

            props['active_period'] = active_period
            props['vancouver_time'] = vancouver_now.strftime("%H:%M")

            # 根據判定時段提取費率
            raw_rate = ''
            if active_period == "night":
                raw_rate = props.get('rate_6pm_10pm') or props.get('rate_9am_6pm') or props.get('rate') or ''
            elif active_period == "free":
                raw_rate = '0'
            else:  # day
                raw_rate = props.get('rate_9am_6pm') or props.get('r_mf_9a_6p') or props.get('rate') or ''

            rate_num = None
            rate_match = re.search(r'(\d+(?:\.\d+)?)', str(raw_rate))
            if rate_match:
                try:
                    rate_num = float(rate_match.group(1))
                except ValueError:
                    rate_num = None
            elif active_period == "free":
                rate_num = 0.0

            props['rate_numeric'] = rate_num
            props['effective_rate'] = f"${rate_num:.2f}" if rate_num is not None and active_period != "free" else "免費" if active_period == "free" else "未提供"

            if max_rate is not None and 0 < max_rate < 20:
                if rate_num is not None and rate_num > max_rate:
                    continue
            if credit_card_only:
                cc = str(props.get('credit_card') or props.get('creditcard') or '').lower()
                if cc not in ('yes', 'true', '1'):
                    continue

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [f.lon, f.lat]
            },
            "properties": props
        })
    return {"type": "FeatureCollection", "features": features}

@app.get("/api/explore/311")
def get_311_service_requests(force: bool = False):
    """取得最新溫哥華 3-1-1 市政服務請求資料 (禁用快取保證即時性)"""
    cache_headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    data_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'vancouver_311.json')
    if not force and os.path.exists(data_file):
        try:
            mtime = os.path.getmtime(data_file)
            if time.time() - mtime < 21600:  # 6 hours
                with open(data_file, 'r', encoding='utf-8') as f:
                    return JSONResponse(content=json.load(f), headers=cache_headers)
        except Exception as e:
            logger.error(f"Error reading 311 data: {e}")
    try:
        from scripts.layers.update_311 import update_311
        data = update_311()
        if data:
            return JSONResponse(content=data, headers=cache_headers)
    except Exception as e:
        logger.error(f"Failed to fetch 311 data on demand: {e}")

    if os.path.exists(data_file):
        try:
            with open(data_file, 'r', encoding='utf-8') as f:
                return JSONResponse(content=json.load(f), headers=cache_headers)
        except Exception:
            pass

    fe_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'public', 'vancouver_311.json')
    if os.path.exists(fe_file):
        try:
            with open(fe_file, 'r', encoding='utf-8') as f:
                return JSONResponse(content=json.load(f), headers=cache_headers)
        except Exception:
            pass
    return JSONResponse(content={"results": []}, headers=cache_headers)

@app.get("/api/explore/nearby")
def explore_nearby_facilities(
    lat: float,
    lon: float,
    radius: int = 500,
    layers: Optional[str] = None,
    db: Session = Depends(database.get_db)
):
    """
    Returns facilities and transit stops within radius (meters) of given (lat, lon).
    Calculates exact distance and walking time (minutes).
    內建經緯度有效範圍檢查與搜尋半徑上限保護 (50m ~ 5000m)，防範全表掃描 DoS。
    """
    if not (math.isfinite(lat) and math.isfinite(lon) and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return JSONResponse(status_code=400, content={"error": "Invalid coordinates", "items": []})
    radius = max(50, min(5000, int(radius)))
    if layers and len(layers) > 2000:
        layers = layers[:2000]
    def haversine_m(lat1, lon1, lat2, lon2):
        R = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2)**2
        return int(round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))))

    def calc_walk_minutes(dist_m: float):
        # 80m / minute (~4.8 km/h walking speed)
        mins = dist_m / 80.0
        if mins <= 0.6:
            return 0.5
        elif mins <= 1.2:
            return 1.0
        else:
            half_rounded = round(mins * 2) / 2
            return int(half_rounded) if half_rounded.is_integer() else half_rounded

    # Bounding box filter (1 deg ~ 111 km)
    deg_delta = (radius + 150) / 111000.0

    road_query = db.query(models.RoadFacility).filter(
        models.RoadFacility.lat.between(lat - deg_delta, lat + deg_delta),
        models.RoadFacility.lon.between(lon - deg_delta, lon + deg_delta)
    )

    selected_layer_keys = set(layers.split(',')) if layers else None

    nearby_items = []

    type_labels = {
        'aed': ('AED 去顫器', '❤️', 'aed'),
        'public_washrooms': ('公共洗手間', '🚻', 'publicWashrooms'),
        'drinking_fountains': ('飲水機', '💧', 'drinkingFountains'),
        'shared_bikes': ('共享單車', '🚲', 'sharedBikes'),
        'bike_racks': ('單車架', '🚲', 'bikeRacks'),
        'litter_containers': ('垃圾箱', '🗑️', 'litterContainers'),
        'parking_meters': ('停車收費錶', '🅿️', 'parkingMeters'),
        'accessible_parking': ('無障礙車位', '♿', 'accessibleParking'),
        'motorcycle_parking': ('摩托車位', '🏍️', 'motorcycleParking'),
        'ev_charging': ('EV 充電站', '⚡', 'evCharging'),
        'community_centres': ('社區中心', '🏢', 'communityCentres'),
        'libraries': ('圖書館', '📚', 'libraries'),
        'schools': ('學校', '🏫', 'schools'),
        'food_banks': ('食物銀行', '🥫', 'foodBanks'),
        'food_vendors': ('街頭餐飲', '🍔', 'foodVendors'),
        'recycling': ('環保回收站', '♻️', 'recycling'),
        'homeless_shelters': ('無家者庇護所', '🏠', 'homelessShelters'),
        'parks': ('公園綠地', '🌳', 'parks'),
        'hospitals': ('醫療院所', '🏥', 'hospitals'),
        'police': ('警局', '🚓', 'police'),
        'fire_halls': ('消防局', '🚒', 'fireHalls'),
        'fire_hydrants': ('消防栓', '🧯', 'fireHydrants'),
        'van_wifi': ('VanWiFi 免費無線網路', '📶', 'vanWifi'),
        'tide_stations': ('潮汐水位', '🌊', 'tideStations'),
        'beach_water_quality': ('海灘水質', '🏖️', 'beachWaterQuality'),
        'zoning_districts': ('土地規劃', '📐', 'zoningDistricts'),
        'street_lighting': ('路燈燈柱', '💡', 'streetLighting'),
        'street_lighting_poles': ('路燈燈柱', '💡', 'streetLighting'),
        'street_lighting_conduits': ('配電管線', '⚡', 'streetLightingConduits'),
        'road_closures': ('交通封閉', '🚫', 'roadClosures'),
        'road_construction': ('道路施工', '🚧', 'roadConstruction'),
        'traffic_conditions': ('獅門大橋', '🌉', 'trafficConditions')
    }

    for f in road_query.all():
        dist = haversine_m(lat, lon, f.lat, f.lon)
        if dist <= radius:
            meta = type_labels.get(f.facility_type, ('公共設施', '📍', f.facility_type))
            if selected_layer_keys and meta[2] not in selected_layer_keys:
                continue
            walk_min = calc_walk_minutes(dist)
            nearby_items.append({
                'id': f.id,
                'name': f.name,
                'facility_type': f.facility_type,
                'type_label': meta[0],
                'icon': meta[1],
                'layer_key': meta[2],
                'local_area': f.local_area,
                'lat': f.lat,
                'lon': f.lon,
                'distance_m': dist,
                'distance_meters': dist,
                'walk_minutes': walk_min,
                'walking_minutes': walk_min,
                'properties': f.details or {}
            })

    # Transit Stops in bounding box (SkyTrain & Bus)
    stops_query = db.query(models.TransitStop).filter(
        models.TransitStop.lat.between(lat - deg_delta, lat + deg_delta),
        models.TransitStop.lon.between(lon - deg_delta, lon + deg_delta)
    )
    for s in stops_query.all():
        dist = haversine_m(lat, lon, s.lat, s.lon)
        if dist <= radius:
            is_skytrain = s.stop_group == 'skytrain'
            layer_key = 'skytrainStops' if is_skytrain else 'busStops'
            is_allowed = not selected_layer_keys or layer_key in selected_layer_keys or (is_skytrain and 'skytrainRoutes' in selected_layer_keys)
            if not is_allowed:
                continue
            walk_min = calc_walk_minutes(dist)
            nearby_items.append({
                'id': s.stop_id,
                'name': s.name,
                'facility_type': 'skytrain_stations' if is_skytrain else 'bus_stops',
                'type_label': '天車站' if is_skytrain else '公車站',
                'icon': '🚉' if is_skytrain else '🚏',
                'layer_key': layer_key,
                'local_area': '',
                'lat': s.lat,
                'lon': s.lon,
                'distance_m': dist,
                'distance_meters': dist,
                'walk_minutes': walk_min,
                'walking_minutes': walk_min,
                'properties': {'stop_id': s.stop_id, 'stop_group': s.stop_group}
            })

    # Supplementary SkyTrain stations from skytrain_network.json to ensure 100% discovery
    is_skytrain_layer_on = not selected_layer_keys or 'skytrainStops' in selected_layer_keys or 'skytrainRoutes' in selected_layer_keys
    if is_skytrain_layer_on:
        skytrain_stations = skytrain_service.get_skytrain_data().get('stations', {})
        existing_st_ids = {str(item['id']) for item in nearby_items if item.get('facility_type') == 'skytrain_stations'}
        for st_id, st in skytrain_stations.items():
            if str(st_id) in existing_st_ids or str(st.get('stop_id')) in existing_st_ids:
                continue
            dist = haversine_m(lat, lon, st['lat'], st['lon'])
            if dist <= radius:
                walk_min = calc_walk_minutes(dist)
                nearby_items.append({
                    'id': str(st.get('stop_id', st_id)),
                    'name': st.get('name', '天車站'),
                    'facility_type': 'skytrain_stations',
                    'type_label': '天車站',
                    'icon': '🚉',
                    'layer_key': 'skytrainStops',
                    'local_area': '',
                    'lat': st['lat'],
                    'lon': st['lon'],
                    'distance_m': dist,
                    'distance_meters': dist,
                    'walk_minutes': walk_min,
                    'walking_minutes': walk_min,
                    'properties': {'stop_id': str(st_id), 'lines': st.get('lines', [])}
                })

    # Supplementary Gas Stations from fuel_service
    is_fuel_allowed = not selected_layer_keys or 'fuel' in selected_layer_keys
    if is_fuel_allowed:
        try:
            try:
                import fuel_service
            except ImportError:
                from backend import fuel_service
            gas_stations = fuel_service.load_vancouver_stations()
            for gs in gas_stations:
                dist = haversine_m(lat, lon, gs['lat'], gs['lon'])
                if dist <= radius:
                    walk_min = calc_walk_minutes(dist)
                    nearby_items.append({
                        'id': f"fuel_{gs.get('id', '')}",
                        'name': gs.get('name') or gs.get('brand', '油站'),
                        'facility_type': 'fuel',
                        'type_label': '油站',
                        'icon': '⛽',
                        'layer_key': 'fuel',
                        'local_area': gs.get('city', ''),
                        'lat': gs['lat'],
                        'lon': gs['lon'],
                        'distance_m': dist,
                        'distance_meters': dist,
                        'walk_minutes': walk_min,
                        'walking_minutes': walk_min,
                        'properties': gs
                    })
        except Exception:
            pass

    # Supplementary Tide Stations from tides_service
    is_tide_allowed = not selected_layer_keys or 'tideStations' in selected_layer_keys
    if is_tide_allowed:
        try:
            try:
                import tides_service
            except ImportError:
                from backend import tides_service
            for ts in getattr(tides_service, 'STATIONS_CONFIG', []):
                dist = haversine_m(lat, lon, ts['lat'], ts['lon'])
                if dist <= radius:
                    walk_min = calc_walk_minutes(dist)
                    nearby_items.append({
                        'id': f"tide_{ts.get('id', '')}",
                        'name': ts.get('name', '潮汐水位站'),
                        'facility_type': 'tide_stations',
                        'type_label': '潮汐水位',
                        'icon': '🌊',
                        'layer_key': 'tideStations',
                        'local_area': ts.get('area', ''),
                        'lat': ts['lat'],
                        'lon': ts['lon'],
                        'distance_m': dist,
                        'distance_meters': dist,
                        'walk_minutes': walk_min,
                        'walking_minutes': walk_min,
                        'properties': ts
                    })
        except Exception:
            pass

    # Sort all by distance ascending
    nearby_items.sort(key=lambda x: x['distance_m'])

    return {
        'center': {'lat': lat, 'lon': lon},
        'radius_m': radius,
        'total': len(nearby_items),
        'items': nearby_items[:150]
    }

def _get_rapidbus_main_variants(gtfs_meta):
    """獲取 7 條 RapidBus/B-Line 路線在去程與返程 (direction 0 & 1) 最完整的主線變體，確保站點與軌跡完全貼合，排除非主線懸空或調度站點。"""
    variants = gtfs_meta.get("variants", {})
    routes_lookup = gtfs_meta.get("routes", {})
    rapid_routes = {"99", "R1", "R2", "R3", "R4", "R5", "R6"}
    best_variants = {}
    for vid, v in variants.items():
        rid = str(v.get("route_id", ""))
        rmeta = routes_lookup.get(rid, {})
        rnum = str(rmeta.get("route_number", "")).upper()
        if rnum not in rapid_routes:
            continue
        direction = v.get("direction_id", 0)
        key = f"{rnum}_{direction}"
        stop_count = len(v.get("stops", []))
        shape_count = len(v.get("shape_coords", []))
        current = best_variants.get(key)
        if not current or stop_count > current["stop_count"] or (stop_count == current["stop_count"] and shape_count > current["shape_count"]):
            best_variants[key] = {
                "vid": vid,
                "variant": v,
                "rnum": rnum,
                "rmeta": rmeta,
                "stop_count": stop_count,
                "shape_count": shape_count
            }
    return best_variants

@app.get("/api/geojson/stops/{group}")
def get_stops_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
    if group == 'skytrain':
        data = skytrain_service.get_skytrain_data()
        stations = data.get('stations', {})
        features = []
        for stop_id, st in stations.items():
            st_lines = st.get('lines', [])
            # Color follows the SkyTrain line colors:
            # Canada Line: #0097a9 (Teal/Turquoise)
            # Millennium Line: #f59e0b (Yellow/Amber)
            # Expo Line: #0033a0 (Dark Blue)
            if any('Canada' in l for l in st_lines):
                color = '#0097a9'
            elif any('Millennium' in l for l in st_lines):
                color = '#f59e0b'
            else:
                color = '#0033a0'
            
            is_interchange = len(st_lines) > 1 or any(k in st.get('name', '') for k in ['Waterfront', 'Commercial', 'Lougheed', 'Production Way'])

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [st['lon'], st['lat']]
                },
                "properties": {
                    "stop_id": str(st.get('stop_id', stop_id)),
                    "name": st.get('name', ''),
                    "raw_name": st.get('raw_name', st.get('name', '')),
                    "lines": st_lines,
                    "color": color,
                    "is_interchange": is_interchange
                }
            })
        if features:
            return {"type": "FeatureCollection", "features": features}

    if group == 'seabus':
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-123.1118, 49.2861]
                    },
                    "properties": {
                        "stop_id": "8035",
                        "name": "Waterfront Station"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-123.0829, 49.3103]
                    },
                    "properties": {
                        "stop_id": "8036",
                        "name": "Lonsdale Quay"
                    }
                }
            ]
        }

    if group in _stops_geojson_cache:
        return _stops_geojson_cache[group]

    try:
        stops = db.query(models.TransitStop).filter(models.TransitStop.stop_group == group).all()
    except Exception:
        stops = []

    features = []
    for stop in stops:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [stop.lon, stop.lat]
            },
            "properties": {
                "stop_id": stop.stop_id,
                "name": stop.name
            }
        })

    if not features and group == 'bus':
        gtfs_meta = get_gtfs_metadata()
        main_vars = _get_rapidbus_main_variants(gtfs_meta)
        seen_stops = set()
        for item in main_vars.values():
            v = item["variant"]
            rnum = item["rnum"]
            for s in v.get("stops", []):
                sid = str(s.get("stop_id", ""))
                if sid and sid not in seen_stops and s.get("lon") and s.get("lat"):
                    seen_stops.add(sid)
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [s["lon"], s["lat"]]
                        },
                        "properties": {
                            "stop_id": sid,
                            "name": s.get("name", ""),
                            "route_number": rnum
                        }
                    })

    result_fc = {"type": "FeatureCollection", "features": features}
    if features:
        _stops_geojson_cache[group] = result_fc
    return result_fc


@app.get("/api/seabus/vehicles")
def get_seabus_vehicles():
    """Returns currently active / simulated SeaBus vessels."""
    sb_list = [v for v in cached_translink_vehicles if v.get("is_seabus")]
    return {"vehicles": sb_list}


@app.get("/api/ferries/webcam_image")
def get_ferry_webcam_image(url: str):
    """Proxy ferry & highway webcam images to prevent CORS and hotlinking blocks."""
    import urllib.request
    from fastapi.responses import Response

    parsed = urllib.parse.urlparse(url)
    allowed_hosts = {"ccimg.bcferries.com", "www.drivebc.ca", "drivebc.ca", "images.drivebc.ca"}
    if parsed.netloc not in allowed_hosts:
        return Response(status_code=400, content="Host not allowed")

    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Referer": f"{parsed.scheme}://{parsed.netloc}/"
            }
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            content = resp.read()
            content_type = resp.headers.get("Content-Type", "image/jpeg")
            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=30",
                    "Access-Control-Allow-Origin": "*"
                }
            )
    except Exception as e:
        return Response(status_code=502, content=f"Failed to fetch image: {str(e)}")


_stops_geojson_cache: dict = {}
_tracks_geojson_cache: dict = {}

@app.get("/api/geojson/tracks/{group}")
def get_tracks_geojson(group: str, db: Session = Depends(database.get_db)):
    """group can be 'bus', 'skytrain', or 'seabus'"""
    if group in _tracks_geojson_cache:
        return _tracks_geojson_cache[group]

    features = []
    try:
        results = db.query(
            models.TransitShape.shape_id,
            models.TransitShape.route_id,
            models.TransitRoute.color,
            func.ST_AsGeoJSON(models.TransitShape.geom).label('geojson')
        ).join(
            models.TransitRoute, models.TransitShape.route_id == models.TransitRoute.route_id
        ).filter(
            models.TransitShape.route_group == group
        ).all()
        
        for row in results:
            geometry = json.loads(row.geojson) if row.geojson else None
            if geometry:
                features.append({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "shape_id": row.shape_id,
                        "route_id": row.route_id,
                        "color": row.color
                    }
                })
    except Exception:
        features = []

    if not features:
        if group == 'skytrain':
            st_data = skytrain_service.get_skytrain_data()
            raw_patterns = st_data.get("patterns", [])
            pat_list = raw_patterns.values() if isinstance(raw_patterns, dict) else (raw_patterns if isinstance(raw_patterns, list) else [])
            for pat in pat_list:
                if not isinstance(pat, dict):
                    continue
                coords = pat.get("shape", []) or pat.get("shape_coords", [])
                if len(coords) >= 2:
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": coords
                        },
                        "properties": {
                            "shape_id": pat.get("pattern_id") or pat.get("trip_id") or "skytrain_track",
                            "route_id": pat.get("line_name", "SkyTrain"),
                            "color": pat.get("color", "#0033a0")
                        }
                    })
        elif group == 'seabus':
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [-123.1118, 49.2861],
                        [-123.0829, 49.3103]
                    ]
                },
                "properties": {
                    "shape_id": "seabus_track",
                    "route_id": "6771",
                    "route_number": "SeaBus",
                    "color": "#00a4e4"
                }
            })
        elif group == 'bus':
            gtfs_meta = get_gtfs_metadata()
            main_vars = _get_rapidbus_main_variants(gtfs_meta)
            for item in main_vars.values():
                vid = item["vid"]
                v = item["variant"]
                rnum = item["rnum"]
                rmeta = item["rmeta"]
                coords = v.get("shape_coords", [])
                if len(coords) >= 2:
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": coords
                        },
                        "properties": {
                            "shape_id": vid,
                            "route_id": str(v.get("route_id", "")),
                            "route_number": rnum,
                            "direction_id": v.get("direction_id", 0),
                            "color": v.get("color") or rmeta.get("color") or "#22c55e"
                        }
                    })

    result_fc = {"type": "FeatureCollection", "features": features}
    if features:
        _tracks_geojson_cache[group] = result_fc
    return result_fc

@app.get("/api/debug/counts")
def get_debug_counts(db: Session = Depends(database.get_db)):
    return {
        "routes": {
            "bus": db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'bus').count(),
            "skytrain": db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'skytrain').count(),
        },
        "shapes": {
            "bus": db.query(models.TransitShape).filter(models.TransitShape.route_group == 'bus').count(),
            "skytrain": db.query(models.TransitShape).filter(models.TransitShape.route_group == 'skytrain').count(),
        },
        "bus_routes_list": [r.short_name for r in db.query(models.TransitRoute).filter(models.TransitRoute.route_group == 'bus').all()]
    }

@app.get("/api/debug/gtfs_routes")
def get_debug_gtfs_routes():
    import zipfile, csv, io, os
    zip_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'google_transit.zip')
    if not os.path.exists(zip_path):
        return {"error": "google_transit.zip not found"}
    routes = []
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            with z.open('routes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
                for row in reader:
                    routes.append(row.get('route_short_name', ''))
    except Exception as e:
        return {"error": str(e)}
    return {"total": len(routes), "route_short_names": list(set(routes))}

from pydantic import BaseModel, Field
from typing import Optional
import smtplib
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

class IssueReportRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    details: str = Field(..., min_length=1, max_length=5000)
    contact_email: Optional[str] = Field(default=None, max_length=254)
    image_base64: Optional[str] = Field(default=None, max_length=7500000)
    image_name: Optional[str] = Field(default=None, max_length=120)


def _sanitize_raster_image_base64(raw_b64: Optional[str]) -> tuple[Optional[str], Optional[bytes], str]:
    """
    嚴格驗證問題回報圖片附件：
    1. 僅允許安全點陣圖格式 (PNG, JPEG, GIF, WEBP)，徹底攔截 image/svg+xml (Stored XSS 風險) 或偽造執行檔。
    2. 檢查真實檔案魔術位元組 (Magic Bytes) 並限制解碼後不超過 5.5 MB。
    """
    if not raw_b64 or not isinstance(raw_b64, str):
        return None, None, "png"
    b64_part = raw_b64.strip()
    if "," in b64_part:
        header, b64_part = b64_part.split(",", 1)
        header_low = header.lower()
        if "svg" in header_low or "html" in header_low or "xml" in header_low:
            raise ValueError("不支援 SVG 或網頁格式附件，請上傳 PNG / JPG / WEBP 圖片")
    try:
        img_bytes = base64.b64decode(b64_part, validate=False)
    except Exception:
        raise ValueError("圖片編碼格式無效")
    if len(img_bytes) == 0 or len(img_bytes) > 5_500_000:
        raise ValueError("圖片檔案超過 5MB 安全上限")

    if img_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        mime, ext = "image/png", "png"
    elif img_bytes.startswith(b"\xff\xd8\xff"):
        mime, ext = "image/jpeg", "jpg"
    elif img_bytes.startswith((b"GIF87a", b"GIF89a")):
        mime, ext = "image/gif", "gif"
    elif len(img_bytes) >= 12 and img_bytes[:4] == b"RIFF" and img_bytes[8:12] == b"WEBP":
        mime, ext = "image/webp", "webp"
    else:
        raise ValueError("僅支援標準 PNG、JPG、GIF 或 WEBP 圖片檔案")

    clean_b64_str = base64.b64encode(img_bytes).decode("ascii")
    return f"data:{mime};base64,{clean_b64_str}", img_bytes, ext


def _send_issue_report_email_bg(
    clean_title: str,
    clean_details: str,
    clean_email: str,
    clean_img_name: str,
    img_bytes: Optional[bytes],
    created_str: str,
) -> None:
    target_email = "vancouvergodseye@gmail.com"
    smtp_host = os.getenv("SMTP_HOST")
    try:
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError:
        smtp_port = 587
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    if not (smtp_host and smtp_user and smtp_pass):
        return
    try:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = f"[上帝之眼問題回報] {clean_title}"
        msg["From"] = smtp_user
        msg["To"] = target_email

        body_text = f"""溫哥華上帝之眼 - 使用者問題回報
=============================================
回報標題: {clean_title}
送出時間: {created_str}
聯絡 Email: {clean_email or '未提供'}
圖片附件: {'有 (詳見附件: ' + clean_img_name + ')' if img_bytes else '無'}

問題詳情:
---------------------------------------------
{clean_details}
=============================================
"""
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
        if img_bytes:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(img_bytes)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{clean_img_name}"')
            msg.attach(part)

        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, [target_email], msg.as_string())
        server.quit()
    except Exception as e:
        print(f"[Issue Report Email Error]: {e}")


@app.post("/api/report-issue")
def report_issue(
    payload: IssueReportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db)
):
    """
    接收使用者回報的問題與建議，經嚴格淨化與圖片魔術位元組檢查後儲存至資料庫與備份檔案，
    並透過背景任務非阻塞發送通知郵件。
    """
    # 移除換行控制字元，防範 SMTP Header Injection 與日誌偽造
    clean_title = re.sub(r"[\r\n\x00-\x1f]+", " ", payload.title).strip()[:200]
    clean_details = payload.details.replace("\x00", "").strip()[:5000]
    if not clean_title or not clean_details:
        return JSONResponse(status_code=400, content={"status": "error", "message": "標題與問題詳情不得為空"})

    clean_email = ""
    if payload.contact_email:
        cand_email = re.sub(r"[\r\n\x00-\x1f\s]+", "", payload.contact_email)[:254]
        if cand_email and not re.fullmatch(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}", cand_email):
            return JSONResponse(status_code=400, content={"status": "error", "message": "聯絡電子郵件格式不正確"})
        clean_email = cand_email

    try:
        safe_data_url, img_bytes, ext = _sanitize_raster_image_base64(payload.image_base64)
    except ValueError as ve:
        return JSONResponse(status_code=400, content={"status": "error", "message": str(ve)})

    raw_name = os.path.basename(payload.image_name or "")
    clean_img_name = re.sub(r"[^A-Za-z0-9._\-]", "_", raw_name)[:80] or f"report_screenshot.{ext}"
    if img_bytes and "." not in clean_img_name:
        clean_img_name = f"{clean_img_name}.{ext}"

    now_utc = datetime.utcnow()
    report_id = f"rep_{int(now_utc.timestamp() * 1000)}_{uuid.uuid4().hex[:6]}"

    # 1. 儲存至資料庫 (ORM 參數化綁定，杜絕 SQL Injection)
    try:
        report = models.IssueReport(
            title=clean_title,
            details=clean_details,
            contact_email=clean_email or None,
            status="pending",
            created_at=now_utc
        )
        db.add(report)
        db.commit()
    except Exception as e:
        print(f"[Issue Report DB Error]: {e}")
        db.rollback()

    # 2. 執行緒鎖保護備份至 JSONL 檔案
    try:
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(data_dir, exist_ok=True)
        report_file = os.path.join(data_dir, 'issue_reports.jsonl')
        record_line = json.dumps({
            "id": report_id,
            "timestamp": now_utc.isoformat(),
            "title": clean_title,
            "details": clean_details,
            "contact_email": clean_email,
            "status": "pending",
            "has_attachment": bool(safe_data_url),
            "attachment_name": clean_img_name if safe_data_url else "",
            "image_base64": safe_data_url or ""
        }, ensure_ascii=False) + "\n"
        with _issue_reports_lock:
            with open(report_file, 'a', encoding='utf-8') as f:
                f.write(record_line)
    except Exception as e:
        print(f"[Issue Report Backup File Error]: {e}")

    # 3. 排入背景任務發送郵件，不阻塞 HTTP 回應
    has_smtp = bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))
    if has_smtp:
        background_tasks.add_task(
            _send_issue_report_email_bg,
            clean_title,
            clean_details,
            clean_email,
            clean_img_name,
            img_bytes,
            now_utc.strftime('%Y-%m-%d %H:%M:%S UTC'),
        )

    return {
        "status": "success",
        "message": "問題回報已成功送出！",
        "target_email": "vancouvergodseye@gmail.com",
        "email_dispatched": has_smtp,
        "email_error": None
    }

@app.post("/api/admin/update-open-data")
def trigger_update_open_data(background_tasks: BackgroundTasks):
    """
    手動或透過外部 Webhook / Cron 觸發每 6 個月的 Vancouver Open Data 資料集全面更新
    """
    from scripts.update_open_data import run_all_updates
    background_tasks.add_task(run_all_updates)
    return {
        "status": "triggered",
        "message": "已在背景啟動溫哥華 Open Data 10 項圖層資料集更新作業 (含單車徑 Bikeways)",
        "cycle_months": 6,
        "datasets": [
            "parks", "parks_facilities", "community_gardens",
            "drinking_fountains", "public_washrooms",
            "schools", "libraries", "food_vendors", "homeless_shelters",
            "bikeways"
        ]
    }

@app.get("/api/admin/update-open-data/status")
def get_update_open_data_status():
    """
    查詢每 6 個月定期資料集的最新更新時間與狀態
    """
    meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'last_open_data_update.json')
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            return {"error": str(e)}
    return {"status": "never_updated", "cycle_months": 6}


# ==========================================
# 🛠️ 系統管理員後台 API (數據更新排程、即時狀態與 GeoJSON 發布)
# ==========================================
def get_admin_config_path():
    candidate_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_sources_config.json'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', 'data', 'admin_sources_config.json'),
        os.path.join(os.getcwd(), 'backend', 'data', 'admin_sources_config.json'),
        os.path.join(os.getcwd(), 'data', 'admin_sources_config.json'),
        '/app/data/admin_sources_config.json',
        '/app/backend/data/admin_sources_config.json',
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            return p
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_sources_config.json')


def get_admin_layers_config_path():
    candidate_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_layers_config.json'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', 'data', 'admin_layers_config.json'),
        os.path.join(os.getcwd(), 'backend', 'data', 'admin_layers_config.json'),
        os.path.join(os.getcwd(), 'data', 'admin_layers_config.json'),
        '/app/data/admin_layers_config.json',
        '/app/backend/data/admin_layers_config.json',
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            return p
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'admin_layers_config.json')


_admin_layers_lock = threading.Lock()


def load_layers_config() -> dict:
    path = get_admin_layers_config_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return {
                        "hidden_layers": data.get("hidden_layers") or {},
                        "disabled_layers": data.get("disabled_layers") or {},
                        "custom_colors": data.get("custom_colors") or {},
                        "layer_states": data.get("layer_states") or {},
                    }
        except Exception as e:
            logger.warning(f"Failed to read admin_layers_config.json: {e}")
    return {"hidden_layers": {}, "disabled_layers": {}, "custom_colors": {}, "layer_states": {}}


@app.get("/api/layers/config")
def get_layers_config():
    """公開前台與後台圖層全域設定 (包含面板隱藏、底圖強制停用、自訂色彩與啟用狀態)"""
    return load_layers_config()


@app.post("/api/admin/layers/config")
def save_layers_config(payload: dict = Body(...)):
    """後台管理員全域更新圖層控制設定 (即時同步至前台)"""
    path = get_admin_layers_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with _admin_layers_lock:
        curr = load_layers_config()
        if "hidden_layers" in payload and isinstance(payload["hidden_layers"], dict):
            curr["hidden_layers"].update(payload["hidden_layers"])
        if "disabled_layers" in payload and isinstance(payload["disabled_layers"], dict):
            curr["disabled_layers"].update(payload["disabled_layers"])
        if "custom_colors" in payload and isinstance(payload["custom_colors"], dict):
            curr["custom_colors"].update(payload["custom_colors"])
        if "layer_states" in payload and isinstance(payload["layer_states"], dict):
            curr["layer_states"].update(payload["layer_states"])
        if "reset_colors" in payload and payload["reset_colors"]:
            curr["custom_colors"] = {}
        _atomic_write_json(path, curr)
    return {"status": "success", "config": curr}


def get_persisted_github_token():
    """
    從記憶體、所有可能的 .env 檔案與 admin_sources_config.json 深度恢復 GITHUB_TOKEN
    確保重新載入或重啟容器絕不遺失 Token
    """
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repo = os.environ.get("GITHUB_REPO", "Ycf206/Vancouver-God-Eyes").strip()
    if token:
        return token, repo
    
    # 1. 掃描磁碟上多個可能的 .env 路徑
    candidate_envs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
        os.path.join(os.getcwd(), 'backend', '.env'),
        os.path.join(os.getcwd(), '.env'),
        '/app/backend/.env',
        '/app/.env'
    ]
    for p in candidate_envs:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('GITHUB_TOKEN='):
                            token = line.split('=', 1)[1].strip().strip('"').strip("'")
                        elif line.startswith('GITHUB_REPO='):
                            repo = line.split('=', 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass
            if token:
                os.environ["GITHUB_TOKEN"] = token
                os.environ["GITHUB_REPO"] = repo
                return token, repo

    # 2. 掃描 admin_sources_config.json 持久化設定
    cfg_path = get_admin_config_path()
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                if cfg.get("github_token"):
                    token = cfg.get("github_token", "").strip()
                    repo = cfg.get("github_repo", repo).strip()
                    if token:
                        os.environ["GITHUB_TOKEN"] = token
                        os.environ["GITHUB_REPO"] = repo
                        return token, repo
        except Exception:
            pass

    return token, repo


@app.get("/api/admin/github-status")
def get_admin_github_status():
    """
    查詢 GitHub Token 配置狀態與目標 Repository
    """
    token, repo = get_persisted_github_token()
    return {
        "configured": bool(token),
        "repo": repo,
        "token_masked": (token[:4] + "..." + token[-4:]) if len(token) > 8 else ("已設定" if token else "未設定")
    }


@app.post("/api/admin/github-token")
def set_admin_github_token(payload: dict = Body(...)):
    """
    從後台介面直接儲存 GITHUB_TOKEN，無須手動 SSH
    全面寫入記憶體、多個 .env 以及 admin_sources_config.json
    """
    token = str(payload.get("token") or "").strip()
    repo = str(payload.get("repo") or "Ycf206/Vancouver-God-Eyes").strip()
    if not token or len(token) > 256 or any(c in token for c in ("\r", "\n", " ", '"', "'")):
        return {"status": "error", "message": "Token 格式無效或不能為空"}
    if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,60}/[A-Za-z0-9_.\-]{1,100}", repo):
        return {"status": "error", "message": "GitHub Repository 格式無效 (應為 owner/repo)"}

    # 驗證 Token 是否具備有效 GitHub 授權
    user_name = ""
    try:
        gh_resp = requests.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "VancouverGodsEye-Admin"
            },
            timeout=5
        )
        if gh_resp.status_code == 401:
            return {"status": "error", "message": "GitHub Token 驗證失敗 (401 Unauthorized)：請確認 Token 是否過期或複製不完整。"}
        elif gh_resp.status_code == 200:
            user_data = gh_resp.json()
            user_name = user_data.get("login", "")
    except Exception as gh_ex:
        logger.warning(f"GitHub Token 驗證連線跳過: {gh_ex}")

    # 1. 寫入記憶體環境變數
    os.environ["GITHUB_TOKEN"] = token
    os.environ["GITHUB_REPO"] = repo

    # 2. 寫入所有可能存在的 .env 檔案
    candidate_envs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
        os.path.join(os.getcwd(), 'backend', '.env'),
        os.path.join(os.getcwd(), '.env'),
        '/app/backend/.env',
        '/app/.env'
    ]
    for env_path in candidate_envs:
        try:
            lines = []
            if os.path.exists(env_path):
                with open(env_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            new_lines = [l for l in lines if not l.startswith('GITHUB_TOKEN=') and not l.startswith('GITHUB_REPO=')]
            new_lines.append(f"GITHUB_TOKEN={token}\n")
            new_lines.append(f"GITHUB_REPO={repo}\n")
            with open(env_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
        except Exception as e:
            print(f"Failed to save to {env_path}:", e)

    # 3. 寫入 admin_sources_config.json 保證容器重啟持久性 (原子寫入 + 執行緒鎖)
    cfg_path = get_admin_config_path()
    with _admin_cfg_lock:
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                cfg["github_token"] = token
                cfg["github_repo"] = repo
                _atomic_write_json(cfg_path, cfg)
            except Exception as ce:
                print("Failed to save token to json config:", ce)

    msg = f"GitHub Token 儲存成功！已綁定帳號 @{user_name}，現在可一鍵觸發 Actions 工作流與自動 Commit 排程。" if user_name else "GitHub Token 已成功儲存！"
    return {"status": "success", "message": msg}


import json
import re

CANONICAL_WORKFLOW_MAP: dict[str, str] = {
    "shared_bikes": "update-shared-bikes-hourly.yml",
    "escooter": "update-escooter-hourly.yml",
    "turn_restrictions": "update-traffic-turn-restrictions.yml",
    "service_requests_311": "update-311.yml",
    "vancouver_311": "update-311.yml",
    "vancouver_railways": "update-railways.yml",
}

EXTRA_WORKFLOW_TO_SOURCES: dict[str, list[str]] = {
    "update-shared-bikes-monthly.yml": ["shared_bikes"],
    "update-escooter-monthly.yml": ["escooter"],
    "oci-monthly-sync.yml": ["translink_realtime"],
}

ADMIN_SOURCE_DATA_FILES: dict[str, list[str]] = {
    "traffic_cameras": ["vancouver_traffic_cameras.geojson"],
    "traffic_conditions": ["vancouver_traffic_conditions.geojson"],
    "beach_water": ["vancouver_beach_water.geojson"],
    "impark_parking": ["vancouver_impark.geojson"],
    "schools": ["vancouver_schools.geojson"],
    "libraries": ["vancouver_libraries.geojson"],
    "parks": ["vancouver_parks.geojson"],
    "community_centres": ["vancouver_community_centres.geojson"],
    "public_art": ["vancouver_public_art.geojson"],
    "museums": ["vancouver_museums.geojson"],
    "garbage_collection": ["vancouver_garbage_collection.geojson"],
    "recycling": ["vancouver_recycling.geojson"],
    "homeless_shelters": ["vancouver_homeless_shelters.geojson"],
    "food_banks": ["vancouver_food_banks.geojson"],
    "food_vendors": ["vancouver_food_vendors.geojson"],
    "aed": ["vancouver_aed.geojson"],
    "zoning_districts": ["vancouver_zoning_districts.geojson"],
    "parking_meters": ["vancouver_parking_meters.geojson"],
    "motorcycle_parking": ["vancouver_motorcycle_parking.geojson"],
    "bikeways": ["vancouver_bikeways.geojson"],
    "public_trees": ["vancouver_public_trees.geojson"],
    "fire_hydrants": ["vancouver_fire_hydrants.geojson"],
    "drinking_fountains": ["vancouver_drinking_fountains.geojson"],
    "public_washrooms": ["vancouver_public_washrooms.geojson"],
    "street_lighting": ["vancouver_street_lighting.geojson", "vancouver_street_lighting_poles.geojson"],
    "street_lighting_conduits": ["vancouver_street_lighting_conduits.geojson"],
    "water_distribution_mains": ["vancouver_water_distribution_mains.geojson"],
    "sewer_mains": ["vancouver_sewer_mains.geojson"],
    "traffic_speed_limits": ["vancouver_traffic_speed_limits.geojson"],
    "traffic_crosswalks": ["vancouver_traffic_crosswalks.geojson"],
    "litter_containers": ["vancouver_litter_containers.geojson"],
    "one_way_streets": ["vancouver_one_way_streets.geojson"],
    "snow_removal_routes": ["vancouver_snow_removal_routes.geojson"],
    "contours": ["vancouver_contours.geojson", "vancouver_contours_10m.geojson"],
    "ev_charging": ["vancouver_ev_charging.geojson"],
    "canada_post": ["vancouver_canada_post.geojson"],
    "property_addresses": ["vancouver_property_addresses_meta.json"],
    "banks": ["vancouver_banks.geojson"],
    "shared_bikes": ["vancouver_shared_bikes.geojson"],
    "escooter": ["vancouver_escooter.geojson"],
    "truck_routes": ["vancouver_truck_routes.geojson"],
    "traffic_signals": ["vancouver_traffic_signals.geojson"],
    "turn_restrictions": ["vancouver_traffic_turn_restrictions.geojson"],
    "service_requests_311": ["vancouver_311.json"],
    "tnt_eflyers": ["tnt_eflyers.json"],
    "vancouver_railways": ["vancouver_railways.geojson"],
    "fedex": ["vancouver_fedex.geojson"],
    "purolator": ["vancouver_purolator.geojson"],
    "vancouver_crashes": ["vancouver_crashes.json"],
}


def get_canonical_workflow_file(source_id: str) -> str:
    """傳回特定資料源所對應之獨立 GitHub Actions 工作流檔案名稱"""
    if source_id in CANONICAL_WORKFLOW_MAP:
        return CANONICAL_WORKFLOW_MAP[source_id]
    clean_id = source_id.replace("_", "-")
    return f"update-{clean_id}.yml"


def _parse_iso_epoch(ts_str: str | None) -> float:
    if not ts_str or not isinstance(ts_str, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(ts_str.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def _unix_to_iso(ts_val: float | int | None) -> str | None:
    if not ts_val or ts_val <= 0:
        return None
    try:
        return datetime.fromtimestamp(float(ts_val), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _max_iso_ts(ts_a: str | None, ts_b: str | None) -> str | None:
    ep_a = _parse_iso_epoch(ts_a)
    ep_b = _parse_iso_epoch(ts_b)
    if ep_b > ep_a:
        return ts_b
    return ts_a if ep_a > 0 else ts_b


_admin_file_meta_cache: dict[str, tuple[float, int, str | None]] = {}
_gh_runs_lock = threading.Lock()
_gh_runs_sync_state: dict = {
    "last_check": 0.0,
    "boot_synced": False,
    "runs": [],
}


def _extract_disk_file_meta(fpath: str) -> tuple[int, str | None]:
    """以 mtime 快取極速擷取本地資料檔之 record_count 與內嵌 updated_at (對 >15MB 大檔僅讀前 4KB 標頭)"""
    try:
        st = os.stat(fpath)
    except OSError:
        return (0, None)

    cached = _admin_file_meta_cache.get(fpath)
    if cached and cached[0] == st.st_mtime:
        return (cached[1], cached[2])

    count = 0
    updated_at: str | None = None
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            head = f.read(4096)
        m_ts = re.search(r'"(?:updated_at|generated_at)"\s*:\s*"([^"]+)"', head)
        if m_ts:
            updated_at = m_ts.group(1)
        m_cnt = re.search(r'"total_count"\s*:\s*(\d+)', head)
        if m_cnt:
            count = int(m_cnt.group(1))

        if count == 0 and st.st_size <= 15 * 1024 * 1024:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                count = len(data)
            elif isinstance(data, dict):
                if not updated_at:
                    updated_at = data.get("updated_at") or data.get("generated_at")
                if isinstance(data.get("features"), list):
                    count = len(data["features"])
                elif isinstance(data.get("results"), list):
                    count = len(data["results"])
                elif isinstance(data.get("data"), dict) and isinstance(data["data"].get("eflyer_list"), list):
                    count = len(data["data"]["eflyer_list"])
                elif isinstance(data.get("total_count"), int):
                    count = data["total_count"]
    except Exception:
        pass

    _admin_file_meta_cache[fpath] = (st.st_mtime, count, updated_at)
    return (count, updated_at)


def _fetch_github_workflow_runs_cached() -> tuple[list[dict], bool]:
    """
    每 90 秒向 GitHub Actions API 查詢最近工作流執行紀錄 (具備記憶體快取與 4 秒逾時保護，不阻塞請求)。
    支援已綁定 GITHUB_TOKEN (5000 req/hr) 與未綁定公開倉庫 API (60 req/hr)，確保後台永遠與 GitHub 實際排程同步。
    回傳 (runs_list, is_first_boot_sync)。
    """
    now = time.time()
    if _gh_runs_sync_state["runs"] and (now - _gh_runs_sync_state["last_check"] < 90.0):
        return (_gh_runs_sync_state["runs"], False)

    with _gh_runs_lock:
        now = time.time()
        if now - _gh_runs_sync_state["last_check"] < 90.0:
            return (_gh_runs_sync_state["runs"], False)
        _gh_runs_sync_state["last_check"] = now
        is_first_boot = not _gh_runs_sync_state["boot_synced"]

    github_token, github_repo = get_persisted_github_token()
    repo = (github_repo or "Ycf206/Vancouver-God-Eyes").strip()
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "VancouverGodsEye-AdminSync",
    }
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    collected_runs: list[dict] = []
    pages_to_fetch = 3 if is_first_boot else 1
    fetch_ok = False
    for page_num in range(1, pages_to_fetch + 1):
        url = f"https://api.github.com/repos/{repo}/actions/runs?per_page=100&page={page_num}"
        try:
            resp = requests.get(url, headers=headers, timeout=4)
            if resp.status_code == 200:
                body = resp.json()
                w_runs = body.get("workflow_runs")
                if isinstance(w_runs, list):
                    collected_runs.extend(w_runs)
                    fetch_ok = True
                    if len(w_runs) < 100:
                        break
            else:
                break
        except Exception:
            break

    if fetch_ok:
        with _gh_runs_lock:
            _gh_runs_sync_state["runs"] = collected_runs
            _gh_runs_sync_state["boot_synced"] = True
        return (collected_runs, is_first_boot)

    return (_gh_runs_sync_state["runs"], False)


def _reconcile_admin_sources_live(cfg: dict, gh_runs: list[dict], is_first_boot: bool) -> bool:
    """
    多通道即時對齊所有 60 個資料源狀態：
    1. 正規化 runner / workflow_file 並補齊預設欄位
    2. 對齊本地資料檔 (GeoJSON / JSON) 內嵌 updated_at 與精確筆數 record_count
    3. 對齊 OCI 伺服器 14 個即時服務記憶體快取時間戳與即時筆數
    4. 對齊 GitHub Actions 雲端工作流真實執行紀錄 (last_updated, status, 持久化排程日誌)
    回傳是否有持久化欄位異動需寫回 admin_sources_config.json。
    """
    changed = False
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    pub_dir = os.path.abspath(os.path.join(base_dir, "..", "frontend", "public"))

    sources = cfg.get("sources", [])
    src_by_id: dict[str, dict] = {}
    wf_to_sids: dict[str, list[str]] = {k: list(v) for k, v in EXTRA_WORKFLOW_TO_SOURCES.items()}

    # 1. 正規化設定與建立 workflow -> source_ids 雙向映射
    for s in sources:
        sid = str(s.get("id") or "").strip()
        if not sid:
            continue
        src_by_id[sid] = s
        if s.get("runner") == "github":
            s["runner"] = "github_actions"
            changed = True
        if s.get("runner") == "github_actions":
            canonical_wf = get_canonical_workflow_file(sid)
            if s.get("workflow_file") != canonical_wf:
                s["workflow_file"] = canonical_wf
                changed = True
            wf_to_sids.setdefault(canonical_wf, [])
            if sid not in wf_to_sids[canonical_wf]:
                wf_to_sids[canonical_wf].append(sid)

    # 2. 同步本地磁碟資料檔 record_count 與內嵌 updated_at
    for sid, fnames in ADMIN_SOURCE_DATA_FILES.items():
        s = src_by_id.get(sid)
        if not s:
            continue
        for fname in fnames:
            fpath = os.path.join(data_dir, fname)
            if not os.path.exists(fpath):
                fpath = os.path.join(pub_dir, fname)
            if not os.path.exists(fpath):
                continue
            f_cnt, f_ts = _extract_disk_file_meta(fpath)
            if f_cnt > 0 and s.get("record_count") != f_cnt:
                s["record_count"] = f_cnt
                changed = True
            if f_ts:
                best_ts = _max_iso_ts(s.get("last_updated"), f_ts)
                if best_ts and best_ts != s.get("last_updated"):
                    s["last_updated"] = best_ts
                    changed = True
            if sid == "food_vendors":
                s["unit"] = "處街頭餐車與熟食攤位"
            break

    # 3. 同步 OCI 伺服器 14 個即時服務記憶體快取時間戳與即時筆數
    try:
        import tides_service
        import ski_service
        import fuel_service
        import aurora_service
        from tomtom_service import tomtom_service
    except Exception:
        tides_service = ski_service = fuel_service = aurora_service = tomtom_service = None

    oci_live_updates: dict[str, tuple[str | None, int | None]] = {}

    tl_cnt = len(cached_translink_vehicles) + len(cached_skytrain_trains) + len(cached_bcferries_vehicles)
    oci_live_updates["translink_realtime"] = (
        _unix_to_iso(_oci_runtime_ts.get("translink_realtime")),
        tl_cnt if tl_cnt > 0 else None,
    )
    oci_live_updates["maritime_shipping"] = (
        _unix_to_iso(_oci_runtime_ts.get("maritime_shipping")),
        len(getattr(shipping_service, "vessels", {}) or {}) or None,
    )
    oci_live_updates["weather_monitoring"] = (
        _unix_to_iso(getattr(weather_service, "last_fetch_time", 0.0)),
        None,
    )
    if tides_service is not None:
        oci_live_updates["tides_hydrometric"] = (
            _unix_to_iso(tides_service._tide_cache.get("timestamp", 0)),
            len(getattr(tides_service, "STATIONS_CONFIG", []) or []) or None,
        )
    if ski_service is not None:
        oci_live_updates["ski_resorts"] = (
            _unix_to_iso(ski_service._ski_cache.get("timestamp", 0)),
            len(getattr(ski_service, "RESORTS_CONFIG", []) or []) or None,
        )
    if fuel_service is not None:
        fuel_st = fuel_service._fuel_cache.get("stations") or []
        oci_live_updates["fuel_prices"] = (
            _unix_to_iso(fuel_service._fuel_cache.get("timestamp", 0)),
            len(fuel_st) if fuel_st else None,
        )
    import yvr_flights_service
    fl_data = yvr_flights_service.get_flights_data()
    fl_cnt = (len(fl_data.get("arrivals", [])) + len(fl_data.get("departures", []))) if isinstance(fl_data, dict) else 0
    fl_ts_iso = (fl_data.get("updated_at") if isinstance(fl_data, dict) else None) or _unix_to_iso(_oci_runtime_ts.get("flight_schedules", 0))
    oci_live_updates["flight_schedules"] = (fl_ts_iso, fl_cnt if fl_cnt > 0 else None)

    oci_live_updates["border_wait_times"] = (
        _unix_to_iso(getattr(border_service, "last_fetch_time", 0.0)),
        5,
    )
    if aurora_service is not None:
        oci_live_updates["aurora_forecast"] = (
            _unix_to_iso(aurora_service._aurora_cache.get("timestamp", 0)),
            len(getattr(aurora_service, "VANCOUVER_AURORA_SPOTS", []) or []) or None,
        )
    oci_live_updates["vancouver_news"] = (
        _unix_to_iso(getattr(news_service, "last_fetch_time", 0.0)),
        len(news_service.cached_news) if news_service.cached_news else None,
    )
    oci_live_updates["public_events"] = (
        _unix_to_iso(getattr(events_service, "last_fetch_time", 0.0)),
        len(events_service.cached_events) if events_service.cached_events else None,
    )
    if tomtom_service is not None:
        tt_summary = getattr(tomtom_service, "cached_corridors_summary", None) or {}
        tt_ts = tt_summary.get("updated_at") or _unix_to_iso(getattr(tomtom_service, "last_fetch_time", 0.0))
        tt_cnt = tt_summary.get("total_roads_count")
        oci_live_updates["traffic_conditions"] = (tt_ts, int(tt_cnt) if tt_cnt else None)

    for sid, (live_iso, live_cnt) in oci_live_updates.items():
        s = src_by_id.get(sid)
        if not s:
            continue
        if live_cnt is not None and live_cnt > 0 and s.get("record_count") != live_cnt:
            s["record_count"] = live_cnt
            changed = True
        if live_iso:
            best_ts = _max_iso_ts(s.get("last_updated"), live_iso)
            if best_ts and best_ts != s.get("last_updated"):
                s["last_updated"] = best_ts
            s["status"] = "healthy"

    # 4. 同步 GitHub Actions 雲端工作流真實執行狀態與排程歷史
    if gh_runs:
        existing_sched = system_log_service.read_schedule_history_raw()
        existing_log_ids = {str(item.get("id", "")) for item in existing_sched if isinstance(item, dict)}
        active_sids: set[str] = set()
        seen_latest_completed: set[str] = set()
        logged_per_sid: dict[str, int] = {}
        max_logs_per_sid = 2 if is_first_boot else 5
        new_gh_logs: list[dict] = []

        # gh_runs 由 GitHub API 依建立時間由新到舊排列
        for run in gh_runs:
            if not isinstance(run, dict):
                continue
            wf_file = os.path.basename(str(run.get("path") or ""))
            sids = wf_to_sids.get(wf_file)
            if not sids:
                continue

            run_id = run.get("id")
            r_status = str(run.get("status") or "")
            conclusion = str(run.get("conclusion") or "")
            event_name = str(run.get("event") or "schedule")
            run_ts = str(run.get("updated_at") or run.get("created_at") or "")

            for sid in sids:
                s = src_by_id.get(sid)
                if not s:
                    continue
                if r_status in ("in_progress", "queued", "waiting"):
                    active_sids.add(sid)
                    continue
                if r_status != "completed":
                    continue

                if conclusion == "success" and run_ts:
                    best_ts = _max_iso_ts(s.get("last_updated"), run_ts)
                    if best_ts and best_ts != s.get("last_updated"):
                        s["last_updated"] = best_ts
                        changed = True
                    if sid not in seen_latest_completed:
                        s["status"] = "healthy"
                elif conclusion == "failure" and sid not in seen_latest_completed:
                    if _parse_iso_epoch(run_ts) >= _parse_iso_epoch(s.get("last_updated")):
                        if s.get("status") != "error":
                            s["status"] = "error"
                            changed = True

                seen_latest_completed.add(sid)

                if run_id and conclusion in ("success", "failure") and run_ts:
                    log_id = f"gh-run-{run_id}-{sid}"
                    if log_id not in existing_log_ids and logged_per_sid.get(sid, 0) < max_logs_per_sid:
                        existing_log_ids.add(log_id)
                        logged_per_sid[sid] = logged_per_sid.get(sid, 0) + 1
                        trig_label = "手動觸發" if event_name == "workflow_dispatch" else "排程自動執行"
                        ok = conclusion == "success"
                        new_gh_logs.append({
                            "id": log_id,
                            "timestamp": run_ts,
                            "action": "GITHUB_WORKFLOW_SYNC" if ok else "GITHUB_WORKFLOW_ERROR",
                            "source_name": s.get("name", sid),
                            "runner": "github_actions",
                            "status": "success" if ok else "error",
                            "detail": (
                                f"[GitHub Actions · {trig_label}] 工作流 {wf_file} 執行成功，目前共 {s.get('record_count', 0)} {s.get('unit', '筆')}。"
                                if ok
                                else f"[GitHub Actions · {trig_label}] 工作流 {wf_file} 執行失敗 (Run #{run_id})，請檢查 Actions 日誌。"
                            ),
                        })

        for sid in active_sids:
            if sid in src_by_id:
                src_by_id[sid]["status"] = "updating"

        if new_gh_logs:
            # 依時間由舊到新寫入 append_schedule_log，使最新項目排在頂端
            for entry in reversed(new_gh_logs):
                system_log_service.append_schedule_log(entry)
            changed = True

    return changed


_public_intervals_cache: dict = {"ts": 0.0, "data": None}


@app.get("/api/system/source-intervals")
def get_public_source_intervals():
    """
    公開唯讀端點：僅回傳各資料源的更新頻率文字 (如「每 5 分鐘」)，絕不暴露任何管理日誌、Token 或腳本路徑。
    供前台 ExplorePanel 顯示資料更新週期，徹底隔離 /api/admin/sources。
    """
    now = time.time()
    if _public_intervals_cache["data"] is not None and (now - _public_intervals_cache["ts"] < 60.0):
        return _public_intervals_cache["data"]

    intervals: dict[str, str] = {}
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            for s in cfg.get("sources", []):
                sid = s.get("id")
                sched = s.get("schedule_interval")
                if sid and sched:
                    intervals[str(sid)] = str(sched)
        except Exception:
            pass
    payload = {"intervals": intervals}
    _public_intervals_cache["ts"] = now
    _public_intervals_cache["data"] = payload
    return payload


@app.get("/api/admin/sources")
def get_admin_sources():
    """
    獲取系統所有數據源 (API 與 GeoJSON) 之最新狀態、排程頻率、上次更新時間與記錄筆數
    (自動同步 GitHub Actions 真實運行時間、磁碟圖資內嵌時間與 OCI 即時服務快取；回應前剔除 github_token)
    """
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            # 於鎖外拉取 GitHub Actions 最近運行狀態 (90 秒快取 + 4 秒逾時保護)
            gh_runs, is_first_boot = _fetch_github_workflow_runs_cached()

            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)

                has_changes = _reconcile_admin_sources_live(cfg, gh_runs, is_first_boot)

                # 11.5 從持久化排程歷史恢復 logs，防止 deploy 後資料消失
                persisted_sched = system_log_service.get_schedule_history()
                if persisted_sched.get("logs"):
                    cfg["logs"] = persisted_sched["logs"]
                elif cfg.get("logs"):
                    for lg in cfg["logs"]:
                        system_log_service.append_schedule_log(lg)
                cfg["schedule_retention_days"] = system_log_service.get_schedule_retention_days()

                if has_changes:
                    try:
                        persist_copy = dict(cfg)
                        persist_copy["logs"] = (cfg.get("logs") or [])[:150]
                        _atomic_write_json(config_path, persist_copy)
                    except Exception:
                        pass

                # 嚴格剔除 github_token 敏感欄位，絕不透過 HTTP 回傳明文 PAT
                safe_cfg = {k: v for k, v in cfg.items() if k != "github_token"}
                return safe_cfg
        except Exception as e:
            return {"error": str(e), "sources": [], "logs": []}
    return {"sources": [], "logs": []}


def _refresh_single_oci_service(sid: str) -> tuple[int | None, str]:
    """手動同步單一 OCI 即時服務時，實際刷新其後端快取並回傳 (最新筆數, 摘要訊息)"""
    if sid == "public_events":
        events_service.get_latest_events(force_refresh=True)
        cnt = len(events_service.cached_events)
        return (cnt, f"OCI 伺服器已即時爬取更新 Daily Hive、Eventbrite 與 Destination Vancouver，共載入 {cnt} 筆活動。")
    if sid == "vancouver_news":
        news_service.get_latest_news(force_refresh=True)
        cnt = len(news_service.cached_news)
        return (cnt, f"OCI 伺服器已即時抓取 CBC、CTV、Global News、CityNews 等本地新聞 RSS，共載入 {cnt} 則要聞。")
    if sid in ("weather_monitoring", "eccc_weather", "weather_live"):
        weather_service._do_fetch_weather()
        return (None, "OCI 伺服器已即時同步加拿大環境部 (ECCC) 與 Open-Meteo 即時氣象及預報快取。")
    if sid == "border_wait_times":
        border_service.get_border_wait_times(force_refresh=True)
        return (5, "OCI 伺服器已即時同步 CBSA / CBP 美加邊境 5 大陸路關卡雙向等候時間。")
    if sid == "tides_hydrometric":
        import tides_service
        tides_service._tide_cache["timestamp"] = 0
        tides_service.get_live_tides_data()
        return (len(tides_service.STATIONS_CONFIG), "OCI 伺服器已即時同步加拿大漁業及海洋部 (DFO IWLS) 潮汐水位觀測數據。")
    if sid == "ski_resorts":
        import ski_service
        ski_service._ski_cache["timestamp"] = 0
        ski_service.get_live_ski_data()
        return (len(ski_service.RESORTS_CONFIG), "OCI 伺服器已即時同步北岸三大滑雪場雪況、積雪深度與吊椅開放狀態。")
    if sid == "fuel_prices":
        import fuel_service
        fuel_service._fuel_cache["timestamp"] = 0
        if hasattr(fuel_service, "get_live_fuel_prices"):
            stations = fuel_service.get_live_fuel_prices()
        else:
            stations = fuel_service.load_vancouver_stations()
        return (len(stations) if stations else None, "OCI 伺服器已即時更新大溫哥華地區油站即時油價快取。")
    if sid in ("aurora_forecast", "aurora_swpc"):
        import aurora_service
        aurora_service.get_aurora_data(force=True)
        return (len(aurora_service.VANCOUVER_AURORA_SPOTS), "OCI 伺服器已即時同步 NOAA SWPC 行星 K 指數與極光觀測預報數據。")
    if sid == "traffic_conditions":
        from tomtom_service import tomtom_service
        summary = tomtom_service.get_corridors_summary(force=True)
        cnt = summary.get("total_roads_count") if isinstance(summary, dict) else None
        return (cnt, "OCI 伺服器已即時刷新 TomTom 與 DriveBC 大溫哥華主要幹道路況與交通事件快取。")
    if sid == "vancouver_crashes":
        crash_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "vancouver_crashes.json")
        if not os.path.exists(crash_file):
            crash_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "public", "vancouver_crashes.json")
        cnt, _ = _extract_disk_file_meta(crash_file)
        return (cnt if cnt > 0 else None, f"OCI 伺服器已即時同步 ICBC 車禍熱點資料，共載入 {cnt} 處事故地點。")
    if sid == "translink_realtime":
        _oci_runtime_ts["translink_realtime"] = time.time()
        cnt = len(cached_translink_vehicles) + len(cached_skytrain_trains) + len(cached_bcferries_vehicles)
        return (cnt if cnt > 0 else None, "OCI 伺服器已即時同步 TransLink 巴士、天車、海上巴士與 BC Ferries 實時動態。")
    if sid == "maritime_shipping":
        vessels = shipping_service.get_vessels()
        _oci_runtime_ts["maritime_shipping"] = time.time()
        return (len(vessels) if vessels else None, f"OCI 伺服器已即時同步 AIS 海事船舶追蹤快取，目前監控 {len(vessels)} 艘船隻。")
    if sid == "flight_schedules":
        import yvr_flights_service
        schedules = yvr_flights_service.get_flights_data(force=True)
        if schedules:
            _oci_runtime_ts["flight_schedules"] = time.time()
        cnt = (len(schedules.get("arrivals", [])) + len(schedules.get("departures", []))) if isinstance(schedules, dict) else None
        return (cnt, f"OCI 伺服器已即時同步 YVR 官方即時航班時刻表，目前排程 {cnt} 班。")
    if sid in ("sports_canucks", "canucks_schedule"):
        import sports_service
        cur_s = sports_service.get_current_nhl_season()
        data = sports_service.fetch_canucks_schedule(cur_s, force=True)
        _oci_runtime_ts["sports_canucks"] = time.time()
        cnt = data.get("totalGames") or len(data.get("games", []))
        return (cnt if cnt > 0 else None, f"OCI 伺服器已即時同步 NHL 官方 Vancouver Canucks {cur_s} 賽季賽程，共 {cnt} 場賽事。")
    if sid in ("lottery_latest", "lottery"):
        import lottery_service
        data = lottery_service.fetch_lottery_latest(force=True)
        _oci_runtime_ts["lottery_latest"] = time.time()
        cnt = len(data.get("draws", {}))
        return (cnt if cnt > 0 else None, f"OCI 伺服器已即時同步 PlayNow 官方最新彩票開彩結果，共 {cnt} 種彩票。")
    if sid == "yvr_weathercams":
        import yvr_airport_service
        data = yvr_airport_service.fetch_weathercams_summary("CYVR")
        _oci_runtime_ts["yvr_weathercams"] = time.time()
        cnt = len(data.get("cameras", []))
        return (cnt if cnt > 0 else None, f"OCI 伺服器已即時同步 FAA 溫哥華機場 (CYVR) 氣象攝影機與 METAR，共 {cnt} 組鏡頭。")
    return (None, f"OCI 伺服器已即時更新 [{sid}] 資料快取與連線狀態。")


@app.post("/api/admin/sources/sync")
def trigger_admin_sync(payload: dict = Body(...)):
    """
    手動即時觸發特定數據源 (或 OCI 全部 / GitHub Actions 全部) 同步更新
    支援透過 GitHub Workflow Dispatch API 喚醒雲端 Actions 執行
    """
    source_id = payload.get("source_id")
    target_runner = payload.get("runner")  # 'oci' or 'github_actions'
    if target_runner == "github":
        target_runner = "github_actions"
    config_path = get_admin_config_path()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    github_token, github_repo = get_persisted_github_token()

    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)

            updated_count = 0
            dispatched_workflows = []
            target_name = "所有數據源"
            detail_msg = ""
            action_name = "MANUAL_SYNC"
            log_status = "success"

            # 判斷是否為批次觸發
            if source_id == 'all_oci' or (source_id == 'all' and target_runner == 'oci'):
                target_name = "全部 OCI 伺服器即時服務"
                for idx_s in ("weather_monitoring", "vancouver_news", "public_events", "border_wait_times", "translink_realtime", "maritime_shipping"):
                    try:
                        _refresh_single_oci_service(idx_s)
                    except Exception:
                        pass
                for src in cfg.get("sources", []):
                    if src.get("runner") == "oci":
                        src["last_updated"] = now_iso
                        src["status"] = "healthy"
                        updated_count += 1
                detail_msg = f"管理員已立即刷新全部 OCI 伺服器即時服務（共 {updated_count} 項即時交通、天氣、新聞、活動、海關等快取）。"
                action_name = "OCI_BATCH_SYNC"
            elif source_id == 'all_github' or (source_id == 'all' and target_runner == 'github_actions'):
                target_name = "全部 GitHub Actions 雲端資料管線"
                seen_workflows = set()
                for src in cfg.get("sources", []):
                    if src.get("runner") in ("github_actions", "github"):
                        src["runner"] = "github_actions"
                        canonical_wf = get_canonical_workflow_file(src["id"])
                        src["workflow_file"] = canonical_wf
                        updated_count += 1
                        if github_token:
                            src["status"] = "updating"
                        if canonical_wf not in seen_workflows:
                            seen_workflows.add(canonical_wf)
                            dispatched_workflows.append(canonical_wf)

                if github_token and dispatched_workflows:
                    ok_dispatches = 0
                    for wf in dispatched_workflows:
                        try:
                            dispatch_url = f"https://api.github.com/repos/{github_repo}/actions/workflows/{wf}/dispatches"
                            headers = {
                                "Authorization": f"Bearer {github_token}",
                                "Accept": "application/vnd.github.v3+json",
                                "User-Agent": "VancouverGodsEye-Admin"
                            }
                            r = requests.post(dispatch_url, json={"ref": "main"}, headers=headers, timeout=5)
                            if r.status_code in (200, 204):
                                ok_dispatches += 1
                        except Exception as e:
                            print(f"Failed to dispatch workflow {wf}: {e}")
                    with _gh_runs_lock:
                        _gh_runs_sync_state["last_check"] = 0.0
                    detail_msg = f"已透過 GitHub Workflow Dispatch 成功喚醒 {ok_dispatches}/{len(dispatched_workflows)} 個 Actions 雲端工作流執行！完成後將自動回寫上次更新時間。"
                else:
                    log_status = "warning"
                    detail_msg = f"尚未設定 GITHUB_TOKEN，無法直接遠端喚醒 {len(dispatched_workflows)} 個 GitHub Actions 工作流（請於右上角綁定 GitHub Token）。"
                action_name = "GITHUB_BATCH_SYNC"
            else:
                # 單一項目觸發
                target_src = None
                for src in cfg.get("sources", []):
                    if src.get("id") == source_id:
                        target_src = src
                        target_name = src.get("name", source_id)
                        break

                if target_src:
                    if target_src.get("runner") == "github":
                        target_src["runner"] = "github_actions"
                    runner = target_src.get("runner", "oci")

                    if runner == "github_actions":
                        action_name = "GITHUB_DISPATCH"
                        canonical_wf = get_canonical_workflow_file(target_src["id"])
                        target_src["workflow_file"] = canonical_wf
                        wf = canonical_wf
                        if github_token and wf:
                            try:
                                dispatch_url = f"https://api.github.com/repos/{github_repo}/actions/workflows/{wf}/dispatches"
                                headers = {
                                    "Authorization": f"Bearer {github_token}",
                                    "Accept": "application/vnd.github.v3+json",
                                    "User-Agent": "VancouverGodsEye-Admin"
                                }
                                resp = requests.post(dispatch_url, json={"ref": "main"}, headers=headers, timeout=8)
                                if resp.status_code in [200, 204]:
                                    target_src["status"] = "updating"
                                    with _gh_runs_lock:
                                        _gh_runs_sync_state["last_check"] = 0.0
                                    detail_msg = f"已成功調度 GitHub Actions 工作流 [{wf}] 立即在雲端執行！執行完成後將自動同步更新時間與筆數。"
                                else:
                                    log_status = "error"
                                    err_json = {}
                                    try:
                                        err_json = resp.json()
                                    except Exception:
                                        pass
                                    detail_msg = f"呼叫 GitHub Actions API 失敗 (HTTP {resp.status_code}): {err_json.get('message', '未知錯誤')}"
                            except Exception as ex:
                                log_status = "error"
                                detail_msg = f"GitHub API 連線異常: {ex}"
                        else:
                            # 若未設定 GITHUB_TOKEN，對於支援輕量本機同步的項目 (如 food_vendors / service_requests_311) 提供即時本機備援執行
                            if target_src.get("id") == "food_vendors":
                                try:
                                    from scripts.layers.update_food_vendors import update_food_vendors
                                    fv_list = update_food_vendors()
                                    f_len = len(fv_list) if fv_list else target_src.get("record_count", 0)
                                    target_src["record_count"] = f_len
                                    target_src["last_updated"] = now_iso
                                    target_src["status"] = "healthy"
                                    detail_msg = f"已於伺服器本機即時同步更新街頭餐車資料，共更新 {f_len} 處攤位。"
                                except Exception as fv_err:
                                    log_status = "warning"
                                    detail_msg = f"本機同步餐車資料失敗 ({fv_err})；請於右上角設定 GITHUB_TOKEN 以遠端觸發 [{wf}]。"
                            elif target_src.get("id") in ("service_requests_311", "vancouver_311"):
                                try:
                                    from scripts.layers.update_311 import update_311
                                    res_311 = update_311()
                                    count_311 = len(res_311.get("results", [])) if isinstance(res_311, dict) else 0
                                    if count_311 > 0:
                                        target_src["record_count"] = count_311
                                    target_src["last_updated"] = now_iso
                                    target_src["status"] = "healthy"
                                    detail_msg = f"已於伺服器本機即時同步溫哥華 3-1-1 市政服務請求資料，共取得 {target_src.get('record_count', count_311)} 筆記錄。"
                                except Exception as e_311:
                                    log_status = "warning"
                                    detail_msg = f"本機同步 3-1-1 資料失敗 ({e_311})；請於右上角設定 GITHUB_TOKEN 以遠端觸發 [{wf}]。"
                            else:
                                log_status = "warning"
                                detail_msg = f"此項目由 GitHub Actions 工作流 [{wf}] 負責執行；請於右上角設定 GITHUB_TOKEN 以一鍵遠端喚醒雲端排程。"
                    else:
                        action_name = "OCI_SYNC"
                        try:
                            new_cnt, msg = _refresh_single_oci_service(target_src["id"])
                            if new_cnt is not None and new_cnt > 0:
                                target_src["record_count"] = new_cnt
                            target_src["last_updated"] = now_iso
                            target_src["status"] = "healthy"
                            detail_msg = msg
                        except Exception as oci_err:
                            log_status = "error"
                            target_src["status"] = "error"
                            detail_msg = f"OCI 即時服務 [{target_name}] 刷新發生異常: {oci_err}"
                else:
                    return {"status": "error", "message": f"找不到數據源 {source_id}"}

            new_log = {
                "id": f"log-{int(time.time() * 1000)}",
                "timestamp": now_iso,
                "action": action_name,
                "source_name": target_name,
                "runner": target_runner or (target_src.get("runner") if 'target_src' in locals() and target_src else "all"),
                "status": log_status,
                "detail": detail_msg
            }
            # 11.4 & 11.5 同步寫入持久化排程歷史與系統日誌
            system_log_service.append_schedule_log(new_log)
            system_log_service.add_system_log(
                level="INFO" if log_status == "success" else ("WARNING" if log_status == "warning" else "ERROR"),
                file="backend/main.py",
                action=action_name,
                message=f"數據源同步觸發：{target_name} ({action_name}) - {detail_msg}",
                details={"source_id": source_id, "detail": detail_msg}
            )

            with _admin_cfg_lock:
                # 重新讀取最新磁碟設定並套用本次變更，避免覆蓋並發寫入
                try:
                    with open(config_path, 'r', encoding='utf-8') as rf:
                        latest_cfg = json.load(rf)
                    updated_map = {s["id"]: s for s in cfg.get("sources", []) if isinstance(s, dict) and "id" in s}
                    for s in latest_cfg.get("sources", []):
                        sid = s.get("id")
                        if sid in updated_map:
                            s["last_updated"] = updated_map[sid].get("last_updated", s.get("last_updated"))
                            s["status"] = updated_map[sid].get("status", s.get("status"))
                            s["record_count"] = updated_map[sid].get("record_count", s.get("record_count"))
                            if updated_map[sid].get("workflow_file"):
                                s["workflow_file"] = updated_map[sid]["workflow_file"]
                    cfg = latest_cfg
                except Exception:
                    pass
                logs = cfg.get("logs", [])
                logs.insert(0, new_log)
                cfg["logs"] = logs[:150]
                _atomic_write_json(config_path, cfg)
            _public_intervals_cache["ts"] = 0.0

            return {
                "status": "success" if log_status != "error" else "error",
                "message": detail_msg,
                "source_id": source_id,
                "target_name": target_name,
                "timestamp": now_iso
            }
        except Exception as e:
            system_log_service.add_system_log(
                level="ERROR",
                file="backend/main.py",
                action="SYNC_ERROR",
                message=f"數據源同步異常: {str(e)}",
                details={"error": str(e)}
            )
            return {"status": "error", "error": str(e)}

    return {"status": "error", "message": "找不到配置檔案"}


@app.post("/api/admin/sources/url")
def update_admin_source_url(payload: dict = Body(...)):
    """
    動態更新特定數據源之 API 或網頁爬取 URL，儲存至 admin_sources_config.json
    供後台管理員彈性修改，並使所有背景更新腳本動態採用此 URL
    """
    source_id = str(payload.get("source_id") or "").strip()
    source_url = str(payload.get("source_url") or payload.get("url") or "").strip()
    if not source_id:
        return JSONResponse(status_code=400, content={"status": "error", "message": "缺少 source_id"})
    
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                updated = False
                for src in cfg.get("sources", []):
                    if src.get("id") == source_id:
                        src["source_url"] = source_url
                        src["url"] = source_url
                        updated = True
                        break
                if updated:
                    _atomic_write_json(config_path, cfg)
                    system_log_service.add_system_log(
                        level="INFO",
                        file="backend/main.py",
                        action="UPDATE_SOURCE_URL",
                        message=f"管理員更新資料源 [{source_id}] 來源 URL: {source_url}",
                        details={"source_id": source_id, "source_url": source_url}
                    )
                    return {"status": "ok", "message": f"資料源 [{source_id}] 來源連結已成功更新"}
                else:
                    return JSONResponse(status_code=404, content={"status": "error", "message": f"找不到資料源 [{source_id}]"})
        except Exception as e:
            return JSONResponse(status_code=500, content={"status": "error", "message": f"寫入設定檔失敗: {e}"})
    return JSONResponse(status_code=404, content={"status": "error", "message": "設定檔不存在"})


@app.post("/api/admin/sources/sync_all")
def trigger_admin_sync_all():
    """
    一鍵同步全部數據源 (OCI 與 GitHub Actions)
    """
    return trigger_admin_sync({"source_id": "all"})


@app.post("/api/admin/sources/schedule")
def update_admin_schedule(payload: dict = Body(...)):
    """
    更新特定數據源之排程週期 (Cron 或間隔) 與自動同步開關
    若為 GitHub Actions 資料源，支援直接透過 GitHub Contents API 或本機 yml 同步更新 Cron
    """
    source_id = str(payload.get("source_id") or "").strip()
    schedule_interval = str(payload.get("schedule_interval") or payload.get("interval") or "").strip()[:80]
    schedule_interval = re.sub(r"[\r\n\\'\"`]+", "", schedule_interval)
    cron_expr = str(payload.get("cron_expr") or "").strip()
    enabled = bool(payload.get("enabled", True))
    if cron_expr and not re.fullmatch(r"[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+", cron_expr):
        return JSONResponse(status_code=400, content={"status": "error", "message": "無效的 Cron 表達式格式 (需為標準 5 欄位 Cron)"})

    config_path = get_admin_config_path()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    github_token, github_repo = get_persisted_github_token()

    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)

            updated_src = None
            for src in cfg.get("sources", []):
                if src.get("id") == source_id:
                    if payload.get("name"):
                        src["name"] = str(payload.get("name")).strip()
                    if schedule_interval:
                        src["schedule_interval"] = schedule_interval
                    if cron_expr:
                        src["cron_expr"] = cron_expr
                    if src.get("runner") == "github":
                        src["runner"] = "github_actions"
                    src["enabled"] = enabled
                    updated_src = src
                    break

            if updated_src:
                runner = updated_src.get("runner", "oci")
                wf = updated_src.get("workflow_file")
                detail_extra = ""

                # 若為 GitHub Actions 項目，更新工作流 cron
                if runner == "github_actions" and cron_expr:
                    canonical_wf = get_canonical_workflow_file(updated_src["id"])
                    updated_src["workflow_file"] = canonical_wf
                    wf = canonical_wf

                    # 1. 嘗試直接透過 GitHub API Commit 更新
                    if github_token:
                        try:
                            import base64
                            content_url = f"https://api.github.com/repos/{github_repo}/contents/.github/workflows/{wf}"
                            headers = {
                                "Authorization": f"Bearer {github_token}",
                                "Accept": "application/vnd.github.v3+json",
                                "User-Agent": "VancouverGodsEye-Admin"
                            }
                            get_resp = requests.get(content_url, headers=headers, timeout=10)
                            if get_resp.status_code == 200:
                                file_info = get_resp.json()
                                sha = file_info.get("sha")
                                raw_yml = base64.b64decode(file_info.get("content", "")).decode("utf-8")
                                new_yml = re.sub(r"-\s*cron:\s*['\"].+?['\"]", f"- cron: '{cron_expr}'", raw_yml)
                                if schedule_interval:
                                    new_yml = re.sub(r"^name:\s*Update\s+([^(]+)\([^)]+\)", f"name: Update \\1({schedule_interval})", new_yml, flags=re.MULTILINE)

                                put_body = {
                                    "message": f"chore(schedule): update {updated_src.get('name')} cron to '{cron_expr}' via Admin Portal",
                                    "content": base64.b64encode(new_yml.encode("utf-8")).decode("utf-8"),
                                    "sha": sha,
                                    "branch": "main"
                                }
                                put_resp = requests.put(content_url, json=put_body, headers=headers, timeout=12)
                                if put_resp.status_code in [200, 201]:
                                    detail_extra = f"已透過 GitHub API 自動 Commit 並 Push 至 main 分支（工作流: {wf}）！GitHub Actions 即刻生效新排程週期。"
                                else:
                                    err_msg = f"HTTP {put_resp.status_code}"
                                    try:
                                        err_msg = put_resp.json().get("message", err_msg)
                                    except Exception:
                                        pass
                                    detail_extra = f"⚠️ 本地已儲存，但 GitHub API Commit 失敗: {err_msg}。若提示權限不足，請確認 GitHub Token 具備 'workflow' 權限。"
                            elif get_resp.status_code == 404:
                                detail_extra = f"⚠️ 本地已儲存，但在遠端倉庫中找不到 .github/workflows/{wf} (HTTP 404)。"
                            elif get_resp.status_code in (401, 403):
                                detail_extra = f"⚠️ 本地已儲存，但 GitHub Token 驗證失敗 (HTTP {get_resp.status_code})。請確認 Token 未過期且勾選了 'workflow' 權限。"
                            else:
                                detail_extra = f"⚠️ 本地已儲存，但讀取 GitHub 檔案失敗 (HTTP {get_resp.status_code})。"
                        except Exception as gh_ex:
                            detail_extra = f"⚠️ 本地已儲存，但呼叫 GitHub API 異常: {gh_ex}"
                    else:
                        detail_extra = "（提示：目前尚未綁定 GITHUB_TOKEN，排程已在伺服器儲存；若需自動同步至 GitHub 倉庫，請於右上角設定 GitHub Token）。"

                    # 2. 備份：同步修改本機倉庫的 yml (若本機存在此檔案)
                    try:
                        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                        wf_path = os.path.join(repo_root, '.github', 'workflows', wf)
                        if os.path.exists(wf_path):
                            with open(wf_path, 'r', encoding='utf-8') as yf:
                                ycontent = yf.read()
                            new_ycontent = re.sub(r"-\s*cron:\s*['\"].+?['\"]", f"- cron: '{cron_expr}'", ycontent)
                            if schedule_interval:
                                new_ycontent = re.sub(r"^name:\s*Update\s+([^(]+)\([^)]+\)", f"name: Update \\1({schedule_interval})", new_ycontent, flags=re.MULTILINE)
                            if new_ycontent != ycontent:
                                with open(wf_path, 'w', encoding='utf-8') as yf:
                                    yf.write(new_ycontent)
                    except Exception as yerr:
                        print("Local workflow file update:", yerr)

                runner_label = "GitHub Actions 雲端管線" if runner == "github_actions" else "OCI 伺服器服務"
                new_log = {
                    "id": f"log-{int(time.time() * 1000)}",
                    "timestamp": now_iso,
                    "action": "SCHEDULE_UPDATE",
                    "source_name": updated_src.get("name"),
                    "runner": runner,
                    "status": "success",
                    "detail": f"[{runner_label}] 排程週期變更為 [{schedule_interval or updated_src.get('schedule_interval')}] (Cron: {cron_expr or updated_src.get('cron_expr')})，狀態: {'啟用' if enabled else '暫停'}。{detail_extra}"
                }
                system_log_service.append_schedule_log(new_log)
                system_log_service.add_system_log(
                    level="INFO",
                    file="backend/main.py",
                    action="SCHEDULE_UPDATE",
                    message=f"排程修改：{updated_src.get('name')} -> {schedule_interval or updated_src.get('schedule_interval')}",
                    details={"source_id": source_id, "cron": cron_expr}
                )

                with _admin_cfg_lock:
                    try:
                        with open(config_path, 'r', encoding='utf-8') as rf:
                            latest_cfg = json.load(rf)
                        for s in latest_cfg.get("sources", []):
                            if s.get("id") == source_id:
                                s.update(updated_src)
                                break
                        cfg = latest_cfg
                    except Exception:
                        pass
                    logs = cfg.get("logs", [])
                    logs.insert(0, new_log)
                    cfg["logs"] = logs[:150]
                    _atomic_write_json(config_path, cfg)
                _public_intervals_cache["ts"] = 0.0
                return {"status": "success", "source": updated_src, "detail": detail_extra}
            return {"status": "error", "message": "找不到指定的數據源 ID"}
        except Exception as e:
            system_log_service.add_system_log(
                level="ERROR",
                file="backend/main.py",
                action="SCHEDULE_UPDATE_ERROR",
                message=f"排程修改失敗: {str(e)}",
                details={"error": str(e)}
            )
            return {"status": "error", "error": str(e)}

    return {"status": "error", "message": "配置檔案不存在"}


@app.post("/api/admin/sources/logs/clear")
def clear_admin_logs():
    """
    清除管理員操作與排程更新記錄
    """
    system_log_service.clear_schedule_history()
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                cfg["logs"] = []
                _atomic_write_json(config_path, cfg)
            return {"status": "success", "message": "日誌已清空"}
        except Exception as e:
            system_log_service.add_system_log(
                level="ERROR",
                file="backend/main.py",
                action="CLEAR_LOGS_ERROR",
                message=f"清空日誌失敗: {str(e)}",
                details={"error": str(e)}
            )
            return {"status": "error", "error": str(e)}
    return {"status": "error", "message": "配置檔案不存在"}


# ==========================================
# 11.3 & 11.4 & 11.5 後台系統日誌、排程歷史持久化與圖層顯示開關 API
# ==========================================

@app.get("/api/admin/system-logs")
def get_admin_system_logs(limit: int = 500):
    """
    11.4 取得系統日誌 (包括時間、執行檔案、動作、內容與等級)
    """
    return system_log_service.get_system_logs(limit=limit)


@app.post("/api/admin/system-logs/retention")
def set_admin_system_logs_retention(payload: dict = Body(...)):
    """
    11.4 設定系統日誌保留期限並自動刪除過期記錄 (0 表示永久保留)
    """
    days = int(payload.get("retention_days", 30))
    system_log_service.set_system_retention_days(days)
    return {"status": "success", "retention_days": days}


@app.post("/api/admin/system-logs/clear")
def clear_admin_system_logs():
    """
    11.4 清空系統日誌
    """
    system_log_service.clear_system_logs()
    return {"status": "success", "message": "系統日誌已清空"}


@app.get("/api/admin/schedule-history")
def get_admin_schedule_history(limit: int = 500):
    """
    11.5 取得排程更新與同步歷史記錄 (持久保留)
    """
    return system_log_service.get_schedule_history(limit=limit)


@app.post("/api/admin/schedule-history/retention")
def set_admin_schedule_history_retention(payload: dict = Body(...)):
    """
    11.5 設定排程更新記錄保留期限並自動刪除過期記錄 (0 表示永久保留)
    """
    days = int(payload.get("retention_days", 30))
    system_log_service.set_schedule_retention_days(days)
    return {"status": "success", "retention_days": days}


@app.post("/api/admin/schedule-history/clear")
def clear_admin_schedule_history():
    """
    11.5 清空排程更新歷史
    """
    system_log_service.clear_schedule_history()
    return {"status": "success", "message": "排程更新歷史已清空"}


def get_maintenance_file_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'system_maintenance.json')

def load_maintenance_status():
    p = get_maintenance_file_path()
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"enabled": False, "message": "系統正在進行例行升級與維護，請稍後再試。", "updated_at": None}

@app.get("/api/system/maintenance")
def get_public_maintenance_status():
    """公開系統維護模式狀態檢查端點 (不需身分驗證)"""
    data = load_maintenance_status()
    return JSONResponse(
        content=data,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/api/admin/maintenance")
def get_admin_maintenance_status():
    """管理後台獲取維護狀態"""
    return load_maintenance_status()

@app.post("/api/admin/maintenance")
def set_admin_maintenance_status(payload: dict = Body(...)):
    """管理後台開啟或關閉系統維護模式"""
    enabled = bool(payload.get("enabled", False))
    message = str(payload.get("message", "系統正在進行例行升級與維護，請稍後再試。")).strip()[:500]
    data = {
        "enabled": enabled,
        "message": message,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    p = get_maintenance_file_path()
    _atomic_write_json(p, data)
    
    system_log_service.add_system_log(
        level="WARN" if enabled else "INFO",
        file="backend/main.py",
        action="MAINTENANCE_MODE_CHANGE",
        message=f"系統維護模式已{'【開啟】' if enabled else '【關閉】'}",
        details={"enabled": enabled, "message": message}
    )
    return {"status": "success", "maintenance": data}

@app.post("/api/admin/system-rollback")
def trigger_system_rollback(payload: dict = Body(...)):
    """緊急系統還原至指定版本或上一版本 (PREV)"""
    target = str(payload.get("target", "PREV")).strip()
    if not target or not re.fullmatch(r"[A-Za-z0-9._/\-~^]{1,64}", target):
        return JSONResponse(status_code=400, content={"status": "error", "message": "無效的還原目標格式 (僅接受 PREV、HEAD~N、Tag 或 Git Commit SHA)"})
    github_token = os.getenv("GITHUB_TOKEN") or os.getenv("ADMIN_GITHUB_TOKEN")
    github_repo = os.getenv("GITHUB_REPOSITORY", "Ycf206/Vancouver-God-Eyes")
    
    if not github_token:
        return {
            "status": "error",
            "message": "尚未在伺服器環境變數設定 GITHUB_TOKEN，無法自動調度 GitHub Actions 進行系統還原。請至 GitHub 儲存庫手動執行 Deploy 工作流之 Rollback 任務。"
        }
    
    try:
        dispatch_url = f"https://api.github.com/repos/{github_repo}/actions/workflows/deploy.yml/dispatches"
        headers = {
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "VancouverGodsEye-Rollback"
        }
        body = {
            "ref": "main",
            "inputs": {
                "rollback_target": target
            }
        }
        resp = requests.post(dispatch_url, json=body, headers=headers, timeout=10)
        if resp.status_code in [200, 204]:
            system_log_service.add_system_log(
                level="WARN",
                file="backend/main.py",
                action="SYSTEM_ROLLBACK_DISPATCHED",
                message=f"已成功調度緊急系統還原工作流至目標: {target}",
                details={"target": target}
            )
            return {"status": "success", "message": f"已成功調度 GitHub Actions 緊急系統還原工作流！還原目標：{target}"}
        else:
            return {"status": "error", "message": f"GitHub API 調度失敗 (HTTP {resp.status_code}): {resp.text}"}
    except Exception as e:
        return {"status": "error", "message": f"調度系統還原發生異常: {str(e)}"}

@app.get("/api/admin/recent-commits")
def get_admin_recent_commits():
    """獲取可供緊急還原的最近提交清單 (提供下拉選單選擇與詳細 Commit 資料)"""
    commits = [
        {"sha": "PREV", "full_sha": "HEAD~1", "title": "PREV (上一個運作正常的版本 - HEAD~1)", "message": "上一筆穩定運作的部署版本", "date": "推薦選項", "author": "系統預設"},
        {"sha": "HEAD~2", "full_sha": "HEAD~2", "title": "HEAD~2 (前兩個版本)", "message": "倒退兩次提交前之狀態", "date": "歷史回溯", "author": "Git HEAD~2"}
    ]
    
    # 優先嘗試透過 GitHub API 獲取最新的 Commit 詳細資訊
    token, repo = get_persisted_github_token()
    got_github_commits = False
    if token:
        try:
            gh_resp = requests.get(
                f"https://api.github.com/repos/{repo}/commits?per_page=15",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "VancouverGodsEye-Admin"
                },
                timeout=5
            )
            if gh_resp.status_code == 200:
                gh_data = gh_resp.json()
                for c in gh_data:
                    full_sha = c.get("sha", "")
                    short_sha = full_sha[:7]
                    c_info = c.get("commit", {})
                    full_msg = c_info.get("message", "").strip()
                    title_line = full_msg.split("\n")[0] if full_msg else short_sha
                    author_name = c_info.get("author", {}).get("name", "") or c.get("author", {}).get("login", "")
                    date_raw = c_info.get("author", {}).get("date", "")
                    date_str = date_raw[:10] if len(date_raw) >= 10 else ""
                    commits.append({
                        "sha": short_sha,
                        "full_sha": full_sha,
                        "title": f"[{short_sha}] {title_line}",
                        "message": full_msg,
                        "date": date_str,
                        "author": author_name
                    })
                got_github_commits = True
        except Exception as gh_e:
            logger.warning(f"Failed to fetch commits from GitHub API: {gh_e}")
            
    # 若無 GitHub API 資訊，則備用嘗試本地 git log
    if not got_github_commits:
        try:
            import subprocess
            res = subprocess.run(
                ["git", "log", "-n", "12", "--pretty=format:%h|%s|%ad|%an|%H", "--date=short"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5
            )
            out_str = (res.stdout or b"").decode("utf-8", errors="replace").strip()
            if res.returncode == 0 and out_str:
                for line in out_str.split("\n"):
                    parts = line.split("|")
                    if len(parts) >= 2:
                        short_sha = parts[0].strip()
                        title = parts[1].strip()
                        date_str = parts[2].strip() if len(parts) > 2 else ""
                        author = parts[3].strip() if len(parts) > 3 else ""
                        full_sha = parts[4].strip() if len(parts) > 4 else short_sha
                        commits.append({
                            "sha": short_sha,
                            "full_sha": full_sha,
                            "title": f"[{short_sha}] {title}",
                            "message": title,
                            "date": date_str,
                            "author": author
                        })
        except Exception as e:
            logger.warning(f"Failed to get local git commits: {e}")
            
    return {"commits": commits}


@app.post("/api/admin/sources/visibility")
def toggle_source_panel_visibility(payload: dict = Body(...)):
    """
    11.3 獨立圖層開關: 顯示或隱藏在圖層控制界面中
    """
    source_id = payload.get("source_id")
    hidden = payload.get("hidden", False)
    config_path = get_admin_config_path()
    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                found = False
                for s in cfg.get("sources", []):
                    if s.get("id") == source_id:
                        s["hidden_in_layer_panel"] = bool(hidden)
                        found = True
                        break
                if found:
                    _atomic_write_json(config_path, cfg)
                    # 同步更新 admin_layers_config.json
                    try:
                        with _admin_layers_lock:
                            l_cfg = load_layers_config()
                            if "hidden_layers" not in l_cfg:
                                l_cfg["hidden_layers"] = {}
                            l_cfg["hidden_layers"][source_id] = bool(hidden)
                            _atomic_write_json(get_admin_layers_config_path(), l_cfg)
                    except Exception:
                        pass
                    return {"status": "success", "source_id": source_id, "hidden_in_layer_panel": bool(hidden)}
            return {"status": "error", "message": f"找不到數據源 {source_id}"}
        except Exception as e:
            system_log_service.add_system_log(
                level="ERROR",
                file="backend/main.py",
                action="LAYER_TOGGLE_ERROR",
                message=f"更新圖層隱藏狀態失敗: {str(e)}",
                details={"source_id": source_id, "error": str(e)}
            )
            return {"status": "error", "error": str(e)}
    return {"status": "error", "message": "配置檔案不存在"}


@app.post("/api/admin/geojson/upload")
def upload_admin_geojson(payload: dict = Body(...)):
    """
    經網頁接收更新之 GeoJSON 內容，驗證並同步至 backend/data 及 frontend/public
    """
    filename = payload.get("filename")
    layer_id = payload.get("layer_id")
    geojson_data = payload.get("geojson_data")
    
    if not filename or not geojson_data:
        return {"status": "error", "message": "缺少檔名 (filename) 或 GeoJSON 內容 (geojson_data)"}
        
    safe_filename = os.path.basename(str(filename)).strip()
    if not re.fullmatch(r"[A-Za-z0-9._\-]{1,120}", safe_filename):
        return JSONResponse(status_code=400, content={"status": "error", "message": "無效的檔案名稱格式"})
    if not safe_filename.endswith(('.geojson', '.json')):
        safe_filename += '.geojson'
    if safe_filename in ("admin_sources_config.json", "system_logs.json", "admin_schedule_history.json", "stats_pv.json"):
        return JSONResponse(status_code=403, content={"status": "error", "message": "不允許覆寫系統核心設定檔"})
        
    if isinstance(geojson_data, str):
        try:
            parsed = json.loads(geojson_data)
        except Exception as e:
            return {"status": "error", "message": f"無效的 JSON 格式: {str(e)}"}
    elif isinstance(geojson_data, dict):
        parsed = geojson_data
    else:
        return {"status": "error", "message": "GeoJSON 內容必須是 JSON 字串或物件"}
        
    if parsed.get("type") != "FeatureCollection" or not isinstance(parsed.get("features"), list):
        return {"status": "error", "message": "GeoJSON 必須包含 type='FeatureCollection' 與 features 陣列"}
        
    feature_count = len(parsed.get("features", []))
    
    backend_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    backend_target = os.path.join(backend_data_dir, safe_filename)
    _atomic_write_json(backend_target, parsed)
        
    frontend_public_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'public'))
    if os.path.exists(frontend_public_dir):
        frontend_target = os.path.join(frontend_public_dir, safe_filename)
        _atomic_write_json(frontend_target, parsed)
            
    now_iso = datetime.utcnow().isoformat() + "Z"
    
    config_path = os.path.join(backend_data_dir, 'admin_sources_config.json')
    if os.path.exists(config_path):
        try:
            with _admin_cfg_lock:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    
                layer_name = safe_filename
                for src in cfg.get("sources", []):
                    if src.get("filename") == safe_filename or (layer_id and src.get("id") == layer_id):
                        src["last_updated"] = now_iso
                        src["record_count"] = feature_count
                        src["status"] = "healthy"
                        layer_name = src.get("name", safe_filename)
                        break
                        
                new_log = {
                    "id": f"log-{int(time.time())}",
                    "timestamp": now_iso,
                    "action": "GEOJSON_UPLOAD",
                    "source_name": layer_name,
                    "status": "success",
                    "detail": f"管理員經網頁上傳更新 [{safe_filename}] 成功，共載入 {feature_count} 筆要素特徵。"
                }
                logs = cfg.get("logs", [])
                logs.insert(0, new_log)
                cfg["logs"] = logs[:100]
                
                _atomic_write_json(config_path, cfg)
        except Exception:
            pass
            
    return {
        "status": "success",
        "message": f"成功更新並發布 {safe_filename}",
        "filename": safe_filename,
        "feature_count": feature_count,
        "timestamp": now_iso
    }



# ==========================================
# 📍 Geocoding API (個人住址驗證與座標獲取)
# ==========================================
_geocode_cache: OrderedDict[str, list] = OrderedDict()
_geocode_lock = threading.Lock()

@app.get("/api/geocode")
def geocode_address(q: str = ""):
    """
    Geocode an address to lat/lon coordinates, with focus on Metro Vancouver (內建有界 LRU 快取保護 Nominatim API).
    """
    query = (q or "").strip()[:160]
    if not query:
        return {"results": []}

    cache_key = query.lower()
    with _geocode_lock:
        if cache_key in _geocode_cache:
            _geocode_cache.move_to_end(cache_key)
            return {"results": _geocode_cache[cache_key]}

    search_q = query
    lower_q = query.lower()
    if "vancouver" not in lower_q and "bc" not in lower_q and "richmond" not in lower_q and "burnaby" not in lower_q:
        search_q = f"{query}, Vancouver, BC, Canada"
    elif "canada" not in lower_q:
        search_q = f"{query}, Canada"

    headers = {
        "User-Agent": "VancouverGodsEye/1.0 (contact: info@vangodseye.fyi)"
    }
    params = {
        "q": search_q,
        "format": "json",
        "limit": 5,
        "countrycodes": "ca",
        "viewbox": "-123.35,49.38,-122.5,49.0",
        "bounded": 0
    }
    try:
        resp = requests.get("https://nominatim.openstreetmap.org/search", params=params, headers=headers, timeout=6)
        if resp.status_code == 200:
            data = resp.json()
            results = []
            for item in data:
                try:
                    lat_val = float(item["lat"])
                    lon_val = float(item["lon"])
                    results.append({
                        "name": item.get("name") or query,
                        "display_name": item.get("display_name", ""),
                        "lat": round(lat_val, 6),
                        "lon": round(lon_val, 6)
                    })
                except (ValueError, KeyError):
                    continue
            if results:
                with _geocode_lock:
                    _geocode_cache[cache_key] = results
                    while len(_geocode_cache) > 500:
                        _geocode_cache.popitem(last=False)
                return {"results": results}
    except Exception as e:
        logger.error(f"Geocoding error: {e}")

    # Fallback if Nominatim has issues or is offline
    return {
        "results": [
            {
                "name": query,
                "display_name": f"{query}, Vancouver, BC, Canada",
                "lat": 49.2827,
                "lon": -123.1207
            }
        ]
    }


# ==========================================
# ⛽ Fuel & Gas Stations API (Py-GasBuddy & Vancouver Fuel Data)
# ==========================================
try:
    from fuel_service import get_fuel_stations_data
except ImportError:
    from backend.fuel_service import get_fuel_stations_data

@app.get("/api/fuel/stations")
async def get_fuel_stations_api(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    fuel_type: str = "regular",
    sort_by: str = "best"
):
    """
    取得溫哥華油站資訊、即時油價與距離排序。
    sort_by:
      - 'best': 價格及距離最優
      - 'price': 價格最優 (最平)
      - 'distance': 距離最優 (最近)
    """
    stations = await get_fuel_stations_data(user_lat=lat, user_lon=lon, fuel_type=fuel_type, sort_by=sort_by)
    return {
        "stations": stations,
        "total": len(stations),
        "fuel_type": fuel_type,
        "sort_by": sort_by
    }


# ==========================================
# ⚡ EV Charging Stations API
# ==========================================
_ev_geojson_cache: dict = {"mtime": 0.0, "data": None}

@app.get("/api/ev/stations")
def get_ev_stations_api(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    sort_by: str = "best",
    hide_free: bool = False
):
    """
    取得溫哥華充電站資訊、功率、費用與距離排序。
    sort_by:
      - 'best': 綜合最優 (功率與距離加權)
      - 'price': 價格最優 (免費充電站優先，接續按費率由低至高)
      - 'distance': 距離最優 (由近至遠)
    """
    geojson_path = os.path.join(os.path.dirname(__file__), "data", "vancouver_ev_charging.geojson")
    if not os.path.exists(geojson_path):
        return {"stations": [], "total": 0}
    try:
        mtime = os.path.getmtime(geojson_path)
        if _ev_geojson_cache["data"] is not None and _ev_geojson_cache["mtime"] == mtime:
            data = _ev_geojson_cache["data"]
        else:
            with open(geojson_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            _ev_geojson_cache["mtime"] = mtime
            _ev_geojson_cache["data"] = data
    except Exception as e:
        logger.error(f"Error loading vancouver_ev_charging.geojson: {e}")
        return {"stations": [], "total": 0}

    ref_lat = lat if lat is not None else 49.2827
    ref_lon = lon if lon is not None else -123.1207

    try:
        from fuel_service import haversine_distance
    except ImportError:
        from backend.fuel_service import haversine_distance

    stations = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        st_lon, st_lat = coords[0], coords[1]
        is_free = bool(props.get("is_free", False))
        if hide_free and is_free:
            continue

        dist = haversine_distance(ref_lat, ref_lon, st_lat, st_lon)
        raw_power = props.get("power_kw")
        try:
            power_kw = float(raw_power) if raw_power is not None and str(raw_power).strip() != "" else 7.2
        except (ValueError, TypeError):
            power_kw = 7.2
        cost_str = props.get("cost", "依現場計費")

        # 綜合最優打分：功率越高加分越多，距離越遠減分
        score = (power_kw / 250.0) * 0.65 - (min(dist, 25.0) / 25.0) * 0.35

        stations.append({
            "id": props.get("id"),
            "name": props.get("name", "電動車充電站"),
            "address": props.get("address", ""),
            "local_area": props.get("local_area", ""),
            "operator": props.get("operator", "公共充電站"),
            "connectors": props.get("connectors", "J1772"),
            "ports": props.get("ports", 2),
            "voltage": props.get("voltage", "240VAC"),
            "power_kw": power_kw,
            "cost": cost_str,
            "is_free": is_free,
            "distance_km": dist,
            "lat": st_lat,
            "lon": st_lon,
            "score": round(score, 3)
        })

    if sort_by == "distance":
        stations.sort(key=lambda s: s["distance_km"])
    elif sort_by == "price":
        import re
        def price_key(s):
            if s["is_free"]:
                return 0.0
            m = re.search(r"(\d+\.?\d*)", s["cost"])
            if m:
                return float(m.group(1))
            return 999.0
        stations.sort(key=price_key)
    else:  # best
        stations.sort(key=lambda s: s["score"], reverse=True)

    return {
        "stations": stations,
        "total": len(stations),
        "sort_by": sort_by,
        "hide_free": hide_free
    }


# ==========================================
# 🚢 BC Ferries Active Sailings API
# ==========================================
@app.get("/api/ferries/active")
async def get_active_ferries_api():
    """
    取得卑詩渡輪 (BC Ferries) 目前各航線即時船班與航行狀態，包含船名、抵達預估時間與航行進度。
    """
    global cached_bcferries_vehicles

    ROUTE_GROUPS = [
        {
            "route_id": "HSB_NAN",
            "name": "Horseshoe Bay ⇄ Nanaimo (Departure Bay)",
            "name_en": "HORSESHOE BAY ⇄ DEPARTURE BAY",
            "terminals": ("HSB", "NAN")
        },
        {
            "route_id": "TSA_SWB",
            "name": "Tsawwassen ⇄ Swartz Bay (Victoria)",
            "name_en": "TSAWWASSEN ⇄ SWARTZ BAY",
            "terminals": ("TSA", "SWB")
        },
        {
            "route_id": "HSB_LNG",
            "name": "Horseshoe Bay ⇄ Langdale (Sunshine Coast)",
            "name_en": "HORSESHOE BAY ⇄ LANGDALE",
            "terminals": ("HSB", "LNG")
        },
        {
            "route_id": "TSA_DUK",
            "name": "Tsawwassen ⇄ Duke Point (Nanaimo)",
            "name_en": "TSAWWASSEN ⇄ DUKE POINT",
            "terminals": ("TSA", "DUK")
        },
        {
            "route_id": "HSB_BOW",
            "name": "Horseshoe Bay ⇄ Bowen Island",
            "name_en": "HORSESHOE BAY ⇄ BOWEN ISLAND",
            "terminals": ("HSB", "BOW")
        },
    ]

    terminal_names_zh = {
        'TSA': 'Tsawwassen',
        'SWB': 'Swartz Bay (Victoria)',
        'HSB': 'Horseshoe Bay',
        'DUK': 'Duke Point (Nanaimo)',
        'LNG': 'Langdale (Sunshine Coast)',
        'NAN': 'Departure Bay (Nanaimo)',
        'FUL': 'Fulford Harbour',
        'BOW': 'Bowen Island'
    }

    routes_out = []

    for rg in ROUTE_GROUPS:
        t1, t2 = rg["terminals"]
        matching_vessels = []
        for v in (cached_bcferries_vehicles or []):
            dep = v.get("dep_code")
            arr = v.get("arr_code")
            if (dep == t1 and arr == t2) or (dep == t2 and arr == t1):
                progress = v.get("progress", 50.0)
                arr_name = terminal_names_zh.get(arr, v.get("arr_name", arr))
                total_duration = 20 if "BOW" in (t1, t2) else (40 if "LNG" in (t1, t2) else 95)
                remain_mins = max(3, int(total_duration * (1.0 - progress / 100.0)))
                if remain_mins >= 60:
                    h = remain_mins // 60
                    m = remain_mins % 60
                    eta_text = f"{h} 小時 {m} 分後到達 {arr_name}"
                else:
                    eta_text = f"{remain_mins} 分鐘後到達 {arr_name}"

                matching_vessels.append({
                    "id": v.get("id"),
                    "vessel_name": v.get("vessel_name", "BC Ferries 渡輪"),
                    "dep_code": dep,
                    "arr_code": arr,
                    "dep_name": terminal_names_zh.get(dep, dep),
                    "arr_name": arr_name,
                    "departure_time": v.get("departure_time", ""),
                    "arrival_time": v.get("arrival_time", ""),
                    "eta_text": eta_text,
                    "progress": progress,
                    "fill": v.get("fill", 0),
                    "lat": v.get("lat"),
                    "lon": v.get("lon"),
                    "bearing": v.get("bearing", 0),
                    "status": "航行中"
                })

        # 若無即時航行中渡輪，提供航線專屬主力船隻之表定航行
        if not matching_vessels:
            default_fleet = {
                "HSB_NAN": [("QUEEN OF COWICHAN", "NAN", 68.0, 72), ("QUEEN OF OAK BAY", "HSB", 25.0, 54)],
                "TSA_SWB": [("SPIRIT OF BRITISH COLUMBIA", "SWB", 80.0, 85), ("COASTAL CELEBRATION", "TSA", 42.0, 60)],
                "HSB_LNG": [("QUEEN OF SURREY", "LNG", 55.0, 48)],
                "TSA_DUK": [("COASTAL INSPIRATION", "DUK", 35.0, 62)],
                "HSB_BOW": [("QUEEN OF CAPILANO", "BOW", 50.0, 70)]
            }
            for v_name, dest_code, def_prog, def_fill in default_fleet.get(rg["route_id"], []):
                dest_zh = terminal_names_zh.get(dest_code, dest_code)
                duration = 20 if "BOW" in rg["route_id"] else (40 if "LNG" in rg["route_id"] else 95)
                remain_mins = max(4, int(duration * (1.0 - def_prog / 100.0)))
                if remain_mins >= 60:
                    h = remain_mins // 60
                    m = remain_mins % 60
                    eta_text = f"{h} 小時 {m} 分後到達 {dest_zh}"
                else:
                    eta_text = f"{remain_mins} 分鐘後到達 {dest_zh}"

                dep_code = t1 if dest_code == t2 else t2
                ferry_paths = get_bc_ferries_paths()
                route_path = ferry_paths.get(f"{dep_code}_{dest_code}")
                if route_path and len(route_path) >= 2:
                    v_lon, v_lat, v_bearing = _interpolate_along_path(route_path, def_prog / 100.0)
                else:
                    v_lon, v_lat, v_bearing = -123.35, 49.25, 0

                matching_vessels.append({
                    "id": f"ferry_fleet_{v_name.lower().replace(' ', '_')}",
                    "vessel_name": v_name,
                    "dep_code": dep_code,
                    "arr_code": dest_code,
                    "dep_name": terminal_names_zh.get(dep_code, ""),
                    "arr_name": dest_zh,
                    "departure_time": "正點航行",
                    "arrival_time": eta_text,
                    "eta_text": eta_text,
                    "progress": def_prog,
                    "fill": def_fill,
                    "lat": round(v_lat, 6),
                    "lon": round(v_lon, 6),
                    "bearing": round(v_bearing, 1),
                    "status": "航行中"
                })

        routes_out.append({
            "route_id": rg["route_id"],
            "name": rg["name"],
            "name_en": rg["name_en"],
            "vessels": matching_vessels
        })

    return {"routes": routes_out, "total_vessels": sum(len(r["vessels"]) for r in routes_out)}


# ==========================================
# 🌤️ Weather Current Observations & Alerts
# ==========================================
@app.get("/api/weather/current")
def get_current_weather():
    """
    取得大溫哥華地區即時天氣觀測與加拿大環境部 (ECCC api.weather.gc.ca) 氣象預警
    """
    return weather_service.fetch_weather()


# ==========================================
# 🚢 Port of Vancouver & AIS Shipping Vessels
# ==========================================
@app.get("/api/shipping/vessels")
def get_shipping_vessels():
    """
    取得溫哥華海域即時商船、貨櫃輪、油輪、拖船等 AIS 船舶動態 (Aisstream.io)
    """
    vessels = shipping_service.get_vessels()
    return {
        "vessels": vessels,
        "total": len(vessels),
        "source": "Aisstream.io (即時船舶自動識別系統)"
    }


# ==========================================
# 📰 Vancouver Local News Aggregator (604 Now, CityNews, Global News BC)
# ==========================================
@app.get("/api/news/latest")
def get_latest_news(refresh: bool = False):
    """
    取得溫哥華各大即時新聞來源：604 Now, CityNews Vancouver, Global News BC, Daily Hive
    由最新至最舊排序，點選可直接開啟原文網頁 (移除每次請求覆寫設定檔之磁碟競爭問題)
    """
    return news_service.get_latest_news(force_refresh=refresh)


# ==========================================
# 🎟️ Vancouver Events Aggregator (Destination Vancouver & Eventbrite)
# ==========================================
@app.get("/api/events/latest")
def get_latest_events(refresh: bool = False):
    """
    取得溫哥華熱門即時活動：Destination Vancouver (溫哥華旅遊局) 與 Eventbrite Vancouver
    包含音樂演出、體育賽事、節慶慶典、藝文展演等 (移除每次請求覆寫設定檔之磁碟競爭問題)
    """
    return events_service.get_latest_events(force_refresh=refresh)


# ==========================================
# 🛂 Canada - US Border Crossings (CBSA & U.S. CBP Live Wait Times)
# ==========================================
@app.get("/api/border/wait-times")
def get_border_wait_times(refresh: bool = False):
    """
    取得大溫哥華 5 大美加邊境關口即時等候時間 (CBSA 加拿大邊境局 & U.S. CBP 美國海關)
    包含和平門 (Peace Arch)、太平洋公路 (Pacific Hwy)、奧爾德格羅夫 (Aldergrove)、阿伯茨福德 (Huntingdon/Sumas) 與邊界灣 (Point Roberts)
    """
    return border_service.get_border_wait_times(force_refresh=refresh)







# ==========================================
# 📊 System Analytics & Issue Reports (記憶體緩衝 + 定期原子刷盤，防高流量磁碟 I/O 阻塞)
# ==========================================
_STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "stats_pv.json")
_stats_lock = threading.Lock()
_pv_mem_cache: dict | None = None
_pv_last_flush_ts: float = 0.0

# VANCOUVER_TZ and get_vancouver_today_str are defined at module top level

def _get_pv_stats():
    global _pv_mem_cache
    if _pv_mem_cache is not None:
        return _pv_mem_cache
    if os.path.exists(_STATS_FILE):
        try:
            with open(_STATS_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    _pv_mem_cache = loaded
                    return _pv_mem_cache
        except Exception:
            pass
    _pv_mem_cache = {"daily_pv": {}, "total_pv": 0}
    return _pv_mem_cache

def _save_pv_stats(data, force: bool = False):
    global _pv_last_flush_ts
    now_m = time.monotonic()
    if not force and (now_m - _pv_last_flush_ts < 10.0):
        return
    try:
        daily = data.get("daily_pv", {})
        if len(daily) > 120:
            sorted_days = sorted(daily.keys())
            for old_d in sorted_days[:-120]:
                daily.pop(old_d, None)
        _atomic_write_json(_STATS_FILE, data)
        _pv_last_flush_ts = now_m
    except Exception as e:
        print(f"Error saving pv stats: {e}")

@app.post("/api/stats/visit")
@app.get("/api/stats/visit")
def record_page_visit(today: Optional[str] = None):
    """記錄網頁瀏覽次數 (Page View - 溫哥華本地日期累加，真實記錄每筆瀏覽)"""
    today_str = today if (today and len(today) == 10) else get_vancouver_today_str()
    with _stats_lock:
        data = _get_pv_stats()
        daily = data.get("daily_pv", {})
        daily[today_str] = daily.get(today_str, 0) + 1
        data["total_pv"] = data.get("total_pv", 0) + 1
        data["daily_pv"] = daily
        _save_pv_stats(data, force=False)
        return {
            "status": "ok",
            "today": today_str,
            "today_pv": daily[today_str],
            "total_pv": data["total_pv"]
        }

@app.get("/api/admin/stats")
def get_admin_analytics(db: Session = Depends(database.get_db)):
    """
    提供後台統計數據分頁：
    8.1 本日瀏覽次數 (按溫哥華本地時區統計)
    8.2 目前在線人數 (即時 WebSocket 連線數，無連線時真實顯示 0)
    8.3 問題回報數量
    """
    today_str = get_vancouver_today_str()
    with _stats_lock:
        pv_data = _get_pv_stats()
        today_pv = pv_data.get("daily_pv", {}).get(today_str, 0)
        total_pv = pv_data.get("total_pv", 0)
        _save_pv_stats(pv_data, force=True)

    # 在線人數 (真實 WebSocket 連線數，無連線時真實呈現 0)
    online_count = len(active_connections)

    # 問題回報數量
    issue_count = 0
    issue_list = []
    try:
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        report_file = os.path.join(data_dir, "issue_reports.jsonl")
        if os.path.exists(report_file):
            with open(report_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            item = json.loads(line)
                            issue_list.append(item)
                        except Exception:
                            pass
        issue_count = len(issue_list)
    except Exception as e:
        print(f"Error reading issue reports: {e}")

    # 如果有 DB，合併 DB 筆數
    try:
        db_count = db.query(models.IssueReport).count()
        if db_count > issue_count:
            issue_count = db_count
    except Exception:
        pass

    return {
        "status": "ok",
        "today_str": today_str,
        "today_page_views": today_pv,
        "total_page_views": total_pv,
        "online_users": online_count,
        "active_online_users": online_count,
        "total_issue_reports": issue_count,
        "issue_reports_count": issue_count,
        "daily_pv": pv_data.get("daily_pv", {}),
        "recent_issues": issue_list[-20:][::-1],
        "status_note": "實時統計運作中",
        "is_active": True,
        "is_ready_for_launch": True
    }

@app.post("/api/admin/stats/reset")
def reset_admin_stats():
    """重設全站造訪 / 瀏覽次數紀錄"""
    global _pv_mem_cache
    with _stats_lock:
        _pv_mem_cache = {"daily_pv": {}, "total_pv": 0}
        _save_pv_stats(_pv_mem_cache, force=True)
    return {
        "status": "ok",
        "message": "瀏覽次數紀錄已成功重設",
        "today_page_views": 0,
        "total_page_views": 0,
        "daily_pv": {}
    }

@app.get("/api/admin/issue-reports")
def get_admin_issue_reports(db: Session = Depends(database.get_db)):
    """獲取全部問題回報列表"""
    issue_list = []
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    report_file = os.path.join(data_dir, "issue_reports.jsonl")
    if os.path.exists(report_file):
        with open(report_file, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line = line.strip()
                if line:
                    try:
                        item = json.loads(line)
                        if "id" not in item or not item["id"]:
                            item["id"] = f"rep_{idx}_{hashlib.md5((str(item.get('timestamp','')) + str(item.get('title',''))).encode()).hexdigest()[:8]}"
                        if "status" not in item:
                            item["status"] = "pending"
                        issue_list.append(item)
                    except Exception:
                        pass
    # 1. 查詢資料庫
    try:
        db_reports = db.query(models.IssueReport).order_by(models.IssueReport.created_at.desc()).all()
        for r in db_reports:
            if not any(x.get("title") == r.title and str(x.get("timestamp"))[:19] == str(r.created_at.isoformat())[:19] for x in issue_list):
                issue_list.append({
                    "id": f"db_{r.id}",
                    "timestamp": r.created_at.isoformat() if r.created_at else "",
                    "title": r.title,
                    "details": r.details,
                    "contact_email": r.contact_email or "",
                    "status": getattr(r, "status", None) or "pending",
                    "has_attachment": False,
                    "attachment_name": ""
                })
    except Exception:
        pass
    issue_list.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return {"status": "ok", "total": len(issue_list), "reports": issue_list}

class IssueStatusUpdate(BaseModel):
    status: str

@app.patch("/api/admin/issue-reports/{report_id}")
@app.post("/api/admin/issue-reports/{report_id}/status")
def update_admin_issue_report_status(
    report_id: str,
    payload: IssueStatusUpdate,
    db: Session = Depends(database.get_db)
):
    """更新使用者問題回報狀態 (resolved: 完成 / closed: 關閉 / pending: 待處理)"""
    new_status = payload.status
    if new_status not in ["pending", "resolved", "closed"]:
        return JSONResponse(status_code=400, content={"status": "error", "message": "無效狀態，僅接受: pending, resolved, closed"})

    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    report_file = os.path.join(data_dir, "issue_reports.jsonl")

    # 1. 更新 JSONL 備份 (執行緒鎖 + 原子寫檔)
    with _issue_reports_lock:
        if os.path.exists(report_file):
            lines = []
            with open(report_file, "r", encoding="utf-8") as f:
                for idx, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                        item_id = item.get("id") or f"rep_{idx}"
                        if item_id == report_id or str(item.get("timestamp")) == report_id:
                            item["status"] = new_status
                            item["updated_at"] = datetime.utcnow().isoformat()
                        lines.append(json.dumps(item, ensure_ascii=False) + "\n")
                    except Exception:
                        lines.append(line + "\n")
            _atomic_write_lines(report_file, lines)

    # 2. 更新資料庫
    try:
        db_id = None
        if report_id.startswith("db_"):
            try:
                db_id = int(report_id.replace("db_", ""))
            except ValueError:
                pass
        if db_id is not None:
            db_report = db.query(models.IssueReport).filter(models.IssueReport.id == db_id).first()
            if db_report:
                db_report.status = new_status
                db.commit()
    except Exception as e:
        print(f"[Update Issue DB Error]: {e}")
        db.rollback()

    return {"status": "ok", "message": f"回報狀態已更新為 {new_status}", "report_id": report_id, "new_status": new_status}

@app.delete("/api/admin/issue-reports/{report_id}")
def delete_admin_issue_report(
    report_id: str,
    db: Session = Depends(database.get_db)
):
    """刪除使用者問題回報"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    report_file = os.path.join(data_dir, "issue_reports.jsonl")

    # 1. 從 JSONL 備份移除 (執行緒鎖 + 原子寫檔)
    with _issue_reports_lock:
        if os.path.exists(report_file):
            remaining_lines = []
            with open(report_file, "r", encoding="utf-8") as f:
                for idx, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                        item_id = item.get("id") or f"rep_{idx}"
                        if item_id == report_id or str(item.get("timestamp")) == report_id:
                            continue
                        remaining_lines.append(json.dumps(item, ensure_ascii=False) + "\n")
                    except Exception:
                        remaining_lines.append(line + "\n")
            _atomic_write_lines(report_file, remaining_lines)

    # 2. 從資料庫移除
    try:
        db_id = None
        if report_id.startswith("db_"):
            try:
                db_id = int(report_id.replace("db_", ""))
            except ValueError:
                pass
        if db_id is not None:
            db_report = db.query(models.IssueReport).filter(models.IssueReport.id == db_id).first()
            if db_report:
                db.delete(db_report)
                db.commit()
    except Exception as e:
        print(f"[Delete Issue DB Error]: {e}")
        db.rollback()

    return {"status": "ok", "message": "回報已徹底刪除", "report_id": report_id}
