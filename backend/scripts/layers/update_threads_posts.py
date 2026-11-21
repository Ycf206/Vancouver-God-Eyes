#!/usr/bin/env python3
"""
Threads Account Posts Updater (Meta Threads Graph API) with Automatic 60-Day Token Renewal.

Official docs:
  - Retrieve Posts:
    https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts
  - Long-Lived Token Exchange & Refresh:
    GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=...&access_token=...
    GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=...

Environment variables (read from os.environ, backend/.env, or .env):
  - THREADS_ACCESS_TOKEN (required): Initial Threads access token (60-day long-lived token from
    Meta User Token Generator, or 1-hour short-lived token if THREADS_APP_SECRET is also set).
  - THREADS_USER_ID (optional, defaults to "me"): Numeric Threads user ID.
  - THREADS_APP_SECRET (optional): Threads App Secret, used only once if initial token is short-lived.

Auto-Renewal Lifecycle:
  - Persists active renewed token & expiry metadata in `backend/data/.threads_token_state.json` (0600, gitignored).
  - Tracks `seed_hash` of `THREADS_ACCESS_TOKEN` so manual token rotation in GitHub Secrets / `.env`
    immediately takes effect while normal redeploys preserve the fresher auto-refreshed token.
  - Automatically calls `th_refresh_token` when the token is >= 25 days old (or <= 25 days before expiry),
    resetting its 60-day lifespan seamlessly on OCI with zero manual intervention.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any

import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)

from base import (
    BACKEND_DATA_DIR,
    atomic_write_json,
    update_admin_source_metadata,
)

OUTPUT_FILENAME = "vancouver_threads_posts.json"
TOKEN_STATE_FILENAME = ".threads_token_state.json"
THREADS_API_BASE = "https://graph.threads.net/v1.0"
THREADS_OAUTH_BASE = "https://graph.threads.net"
POST_FIELDS = (
    "id,media_product_type,media_type,media_url,permalink,owner,username,"
    "text,timestamp,shortcode,thumbnail_url,"
    "children{id,media_type,media_url,thumbnail_url},is_quote_post"
)
PROFILE_FIELDS = "id,username,name,threads_profile_picture_url,threads_biography"
MAX_PAGES = 200
PAGE_LIMIT = 100

# Refresh long-lived token every ~25 days (Meta allows refresh once >= 24h old and < 60 days old)
TOKEN_REFRESH_INTERVAL_SEC = 25 * 86400
TOKEN_MIN_AGE_FOR_REFRESH_SEC = 25 * 3600
TOKEN_EXPIRY_SAFETY_BUFFER_SEC = 25 * 86400
TOKEN_RETRY_COOLDOWN_SEC = 6 * 3600
DEFAULT_LONG_LIVED_TTL_SEC = 60 * 86400


def _read_env_file_value(env_path: str, key: str) -> str:
    if not os.path.exists(env_path):
        return ""
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def _resolve_env_value(key: str) -> str:
    val = os.environ.get(key, "").strip()
    if val:
        return val
    backend_dir = os.path.dirname(os.path.dirname(CURRENT_DIR))
    project_root = os.path.dirname(backend_dir)
    for p in (os.path.join(backend_dir, ".env"), os.path.join(project_root, ".env")):
        val = _read_env_file_value(p, key)
        if val:
            return val
    return ""


def get_threads_credentials() -> tuple[str, str]:
    """Resolve active THREADS_ACCESS_TOKEN (preferring auto-renewed state if matching seed) & THREADS_USER_ID."""
    seed_token = _resolve_env_value("THREADS_ACCESS_TOKEN")
    user_id = _resolve_env_value("THREADS_USER_ID") or "me"
    state = _load_token_state()

    if seed_token:
        seed_hash = _hash_token(seed_token)
        if state.get("seed_hash") == seed_hash and state.get("access_token"):
            return str(state["access_token"]), user_id
        return seed_token, user_id

    # Fallback: if .env isn't populated yet but valid state exists
    if state.get("access_token"):
        return str(state["access_token"]), user_id

    return "", user_id


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]


def _redact_token(msg: str) -> str:
    s = re.sub(r"(access_token=)[^&\s\"']+", r"\1***", str(msg or ""))
    s = re.sub(r"(client_secret=)[^&\s\"']+", r"\1***", s)
    return s


def _token_state_path() -> str:
    return os.path.join(BACKEND_DATA_DIR, TOKEN_STATE_FILENAME)


def _load_token_state() -> dict[str, Any]:
    path = _token_state_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_token_state(state: dict[str, Any]) -> None:
    path = _token_state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp_th_tok_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        try:
            os.chmod(tmp_path, 0o600)
        except OSError:
            pass
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _ensure_fresh_access_token(session: requests.Session, headers: dict[str, str]) -> tuple[str, dict[str, Any]]:
    """
    Resolve active Threads access token and automatically handle:
    1. Initial short-lived -> 60-day long-lived exchange (when THREADS_APP_SECRET is set)
    2. Automatic 60-day long-lived renewal via `th_refresh_token` every ~25 days (no secret needed)
    """
    seed_token = _resolve_env_value("THREADS_ACCESS_TOKEN")
    app_secret = _resolve_env_value("THREADS_APP_SECRET")
    state = _load_token_state()
    now_ts = time.time()

    if not seed_token and not state.get("access_token"):
        return "", {}

    seed_hash = _hash_token(seed_token) if seed_token else str(state.get("seed_hash") or "")
    is_new_seed = bool(seed_token) and (state.get("seed_hash") != seed_hash or not state.get("access_token"))

    if is_new_seed:
        active_token = seed_token
        expires_in = DEFAULT_LONG_LIVED_TTL_SEC
        exchanged = False

        # If THREADS_APP_SECRET is provided, attempt 1-hour -> 60-day exchange once on new seed
        if app_secret:
            try:
                ex_resp = session.get(
                    f"{THREADS_OAUTH_BASE}/access_token",
                    params={
                        "grant_type": "th_exchange_token",
                        "client_secret": app_secret,
                        "access_token": seed_token,
                    },
                    headers=headers,
                    timeout=20,
                )
                if ex_resp.status_code == 200:
                    ex_data = ex_resp.json()
                    if isinstance(ex_data, dict) and ex_data.get("access_token"):
                        active_token = str(ex_data["access_token"]).strip()
                        expires_in = int(ex_data.get("expires_in") or DEFAULT_LONG_LIVED_TTL_SEC)
                        exchanged = True
                        print(f"🔑 [Threads] 已自動將短期權杖換發為 60 天長期權杖 (有效約 {expires_in // 86400} 天)。")
            except Exception as exc:
                print(f"ℹ️ [Threads] 短期換長期權杖檢查略過（若原權杖已是長期權杖則屬正常）: {_redact_token(str(exc))}")

        state = {
            "seed_hash": seed_hash,
            "access_token": active_token,
            "created_at": now_ts,
            "last_refreshed_at": now_ts,
            "expires_at": now_ts + expires_in,
            "last_refresh_attempt_at": 0.0,
            "exchanged_from_short_lived": exchanged,
            "refresh_count": 0,
        }
        try:
            _save_token_state(state)
        except Exception as exc:
            print(f"⚠️ [Threads] 無法寫入權杖狀態檔: {exc}")
        return active_token, state

    active_token = str(state.get("access_token") or seed_token)
    last_refreshed = float(state.get("last_refreshed_at") or state.get("created_at") or 0.0)
    expires_at = float(state.get("expires_at") or (last_refreshed + DEFAULT_LONG_LIVED_TTL_SEC))
    last_attempt = float(state.get("last_refresh_attempt_at") or 0.0)
    token_age = now_ts - last_refreshed
    time_left = expires_at - now_ts

    # Refresh automatically when token is >= 25 days old OR <= 25 days before expiry (and >= 25h old per Meta rule)
    needs_refresh = (
        token_age >= TOKEN_MIN_AGE_FOR_REFRESH_SEC
        and (token_age >= TOKEN_REFRESH_INTERVAL_SEC or time_left <= TOKEN_EXPIRY_SAFETY_BUFFER_SEC)
        and (now_ts - last_attempt >= TOKEN_RETRY_COOLDOWN_SEC)
    )

    if needs_refresh:
        print("🔄 [Threads] 偵測到長期權杖達自動續期門檻，正在向 Meta Threads API 自動更新 60 天權杖...")
        state["last_refresh_attempt_at"] = now_ts
        try:
            ref_resp = session.get(
                f"{THREADS_OAUTH_BASE}/refresh_access_token",
                params={
                    "grant_type": "th_refresh_token",
                    "access_token": active_token,
                },
                headers=headers,
                timeout=20,
            )
            if ref_resp.status_code == 200:
                ref_data = ref_resp.json()
                new_tok = str(ref_data.get("access_token") or "").strip() if isinstance(ref_data, dict) else ""
                if new_tok:
                    new_ttl = int(ref_data.get("expires_in") or DEFAULT_LONG_LIVED_TTL_SEC)
                    active_token = new_tok
                    state["access_token"] = new_tok
                    state["last_refreshed_at"] = now_ts
                    state["expires_at"] = now_ts + new_ttl
                    state["refresh_count"] = int(state.get("refresh_count") or 0) + 1
                    print(
                        f"✅ [Threads] 長期權杖自動續期成功（第 {state['refresh_count']} 次），"
                        f"新有效期約 {new_ttl // 86400} 天！"
                    )
            else:
                print(
                    f"⚠️ [Threads] 自動續期回應 HTTP {ref_resp.status_code}: "
                    f"{_redact_token(ref_resp.text[:250])}"
                )
        except Exception as exc:
            print(f"⚠️ [Threads] 自動續期連線失敗（稍後會自動重試）: {_redact_token(str(exc))}")
        finally:
            try:
                _save_token_state(state)
            except Exception:
                pass

    return active_token, state


def _load_existing_cache() -> dict[str, Any]:
    path = os.path.join(BACKEND_DATA_DIR, OUTPUT_FILENAME)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _normalize_post(raw: dict[str, Any], default_username: str = "") -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pid = str(raw.get("id") or "").strip()
    if not pid:
        return None

    media_type = str(raw.get("media_type") or "TEXT_POST").upper()
    media_url = str(raw.get("media_url") or "").strip() or None
    thumbnail_url = str(raw.get("thumbnail_url") or "").strip() or None

    raw_children = raw.get("children")
    children_list: list[dict[str, Any]] = []
    if isinstance(raw_children, dict) and isinstance(raw_children.get("data"), list):
        for ch in raw_children["data"]:
            if not isinstance(ch, dict):
                continue
            children_list.append(
                {
                    "id": str(ch.get("id") or ""),
                    "media_type": str(ch.get("media_type") or "IMAGE").upper(),
                    "media_url": str(ch.get("media_url") or "").strip() or None,
                    "thumbnail_url": str(ch.get("thumbnail_url") or "").strip() or None,
                }
            )

    has_media = bool(
        media_url
        or thumbnail_url
        or children_list
        or media_type in ("IMAGE", "VIDEO", "CAROUSEL_ALBUM")
    )

    return {
        "id": pid,
        "text": str(raw.get("text") or "").strip(),
        "timestamp": str(raw.get("timestamp") or "").strip(),
        "media_product_type": str(raw.get("media_product_type") or "THREADS"),
        "media_type": media_type,
        "media_url": media_url,
        "thumbnail_url": thumbnail_url,
        "permalink": str(raw.get("permalink") or "").strip() or None,
        "shortcode": str(raw.get("shortcode") or "").strip() or None,
        "username": str(raw.get("username") or default_username or "").strip(),
        "is_quote_post": bool(raw.get("is_quote_post")),
        "has_media": has_media,
        "children": children_list,
    }


def _unix_to_iso(ts: float | None) -> str | None:
    if not ts or ts <= 0:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def update_threads_posts() -> dict[str, Any]:
    """Fetch latest posts from Meta Threads Graph API (with auto token renewal) and persist JSON cache."""
    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    out_path = os.path.join(BACKEND_DATA_DIR, OUTPUT_FILENAME)
    existing = _load_existing_cache()
    _, user_id = get_threads_credentials()

    session = requests.Session()
    headers = {"Accept": "application/json", "User-Agent": "VancouverGodsEye/1.0"}

    token, tok_state = _ensure_fresh_access_token(session, headers)
    if not token:
        session.close()
        print("ℹ️ [Threads] 尚未設定 THREADS_ACCESS_TOKEN，略過線上更新（請於 backend/.env 或 GitHub Secrets 設定）。")
        payload = {
            "configured": False,
            "status": "unconfigured",
            "error": "尚未設定 THREADS_ACCESS_TOKEN 環境變數，請依指引完成 Meta Threads API 憑證設定。",
            "updated_at": existing.get("updated_at") or now_iso,
            "profile": existing.get("profile"),
            "total_count": len(existing.get("posts") or []),
            "posts": existing.get("posts") or [],
        }
        if not os.path.exists(out_path):
            os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
            atomic_write_json(out_path, payload, indent=2, prefix=".tmp_threads_", suffix=".json")
        return payload

    print(f"🧵 [Threads] 正在透過 Meta Threads Graph API 同步帳號 ({user_id}) 最新帖文...")

    # 1. Fetch profile info (best-effort)
    profile: dict[str, Any] = dict(existing.get("profile") or {})
    try:
        prof_resp = session.get(
            f"{THREADS_API_BASE}/{user_id}",
            params={"fields": PROFILE_FIELDS, "access_token": token},
            headers=headers,
            timeout=20,
        )
        if prof_resp.status_code == 200:
            pj = prof_resp.json()
            if isinstance(pj, dict) and pj.get("id"):
                profile = {
                    "id": str(pj.get("id") or ""),
                    "username": str(pj.get("username") or "").strip(),
                    "name": str(pj.get("name") or "").strip(),
                    "profile_picture_url": str(pj.get("threads_profile_picture_url") or "").strip() or None,
                    "biography": str(pj.get("threads_biography") or "").strip(),
                }
        else:
            err_txt = _redact_token(prof_resp.text[:300])
            print(f"⚠️ [Threads] 取得個人檔案 HTTP {prof_resp.status_code}: {err_txt}")
    except Exception as exc:
        print(f"⚠️ [Threads] 取得個人檔案失敗: {_redact_token(str(exc))}")

    # 2. Fetch posts with cursor pagination
    default_username = str(profile.get("username") or "")
    posts: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    next_url: str | None = f"{THREADS_API_BASE}/{user_id}/threads"
    next_params: dict[str, Any] | None = {
        "fields": POST_FIELDS,
        "limit": PAGE_LIMIT,
        "access_token": token,
    }
    fetch_error: str | None = None

    try:
        for page_idx in range(MAX_PAGES):
            if not next_url or next_url in seen_urls:
                break
            seen_urls.add(next_url)
            resp = session.get(next_url, params=next_params, headers=headers, timeout=25)
            next_params = None
            if resp.status_code != 200:
                try:
                    err_obj = resp.json().get("error") or {}
                    err_msg = err_obj.get("message") or resp.text[:250]
                except Exception:
                    err_msg = resp.text[:250]
                fetch_error = f"Threads API HTTP {resp.status_code}: {_redact_token(err_msg)}"
                print(f"⚠️ [Threads] 第 {page_idx + 1} 頁擷取失敗: {fetch_error}")
                break

            body = resp.json()
            items = body.get("data") if isinstance(body, dict) else None
            if not isinstance(items, list):
                break

            for raw_item in items:
                norm = _normalize_post(raw_item, default_username=default_username)
                if not norm or norm["id"] in seen_ids:
                    continue
                seen_ids.add(norm["id"])
                posts.append(norm)
                if not default_username and norm.get("username"):
                    default_username = norm["username"]
                    profile["username"] = default_username

            paging = body.get("paging") if isinstance(body, dict) else None
            next_url = paging.get("next") if isinstance(paging, dict) else None
            if not next_url:
                break
    except Exception as exc:
        fetch_error = f"Threads API 連線異常: {_redact_token(str(exc))}"
        print(f"⚠️ [Threads] {fetch_error}")
    finally:
        session.close()

    token_meta = {
        "auto_refresh": True,
        "expires_at": _unix_to_iso(tok_state.get("expires_at")),
        "last_refreshed_at": _unix_to_iso(tok_state.get("last_refreshed_at")),
        "refresh_count": int(tok_state.get("refresh_count") or 0),
    }

    if fetch_error and not posts:
        fallback_posts = existing.get("posts") or []
        payload = {
            "configured": True,
            "status": "error",
            "error": fetch_error,
            "updated_at": existing.get("updated_at") or now_iso,
            "last_attempt_at": now_iso,
            "token_meta": token_meta,
            "profile": profile or existing.get("profile"),
            "total_count": len(fallback_posts),
            "posts": fallback_posts,
        }
        os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
        atomic_write_json(out_path, payload, indent=2, prefix=".tmp_threads_", suffix=".json")
        return payload

    posts.sort(key=lambda p: p.get("timestamp") or "", reverse=True)

    payload = {
        "configured": True,
        "status": "ok",
        "error": None,
        "updated_at": now_iso,
        "token_meta": token_meta,
        "profile": profile if profile else None,
        "total_count": len(posts),
        "posts": posts,
    }
    os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
    atomic_write_json(out_path, payload, indent=2, prefix=".tmp_threads_", suffix=".json")
    update_admin_source_metadata("threads_posts", record_count=len(posts))
    print(f"✅ [Threads] 已更新 @{default_username or user_id} 共 {len(posts)} 篇帖文。")
    return payload


if __name__ == "__main__":
    update_threads_posts()
