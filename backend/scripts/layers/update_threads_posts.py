#!/usr/bin/env python3
"""
Threads Account Posts Updater (Meta Threads Graph API).

Official docs:
  https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts

Fetches the configured Threads account's profile and recent posts using:
  - THREADS_ACCESS_TOKEN (required, long-lived user access token with `threads_basic` permission)
  - THREADS_USER_ID (optional, defaults to "me")

Writes cache atomically to `backend/data/vancouver_threads_posts.json` and updates
admin source metadata for `threads_posts`. Designed to run hourly on OCI backend
and on-demand via `GET /api/threads/posts?refresh=true`.
"""

from __future__ import annotations

import json
import os
import re
import sys
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
THREADS_API_BASE = "https://graph.threads.net/v1.0"
POST_FIELDS = (
    "id,media_product_type,media_type,media_url,permalink,owner,username,"
    "text,timestamp,shortcode,thumbnail_url,"
    "children{id,media_type,media_url,thumbnail_url},is_quote_post"
)
PROFILE_FIELDS = "id,username,name,threads_profile_picture_url,threads_biography"
MAX_PAGES = 4
PAGE_LIMIT = 50


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


def get_threads_credentials() -> tuple[str, str]:
    """Resolve THREADS_ACCESS_TOKEN and THREADS_USER_ID from env or .env files."""
    backend_dir = os.path.dirname(os.path.dirname(CURRENT_DIR))
    project_root = os.path.dirname(backend_dir)
    env_candidates = [
        os.path.join(backend_dir, ".env"),
        os.path.join(project_root, ".env"),
    ]

    token = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    if not token:
        for p in env_candidates:
            token = _read_env_file_value(p, "THREADS_ACCESS_TOKEN")
            if token:
                break

    user_id = os.environ.get("THREADS_USER_ID", "").strip()
    if not user_id:
        for p in env_candidates:
            user_id = _read_env_file_value(p, "THREADS_USER_ID")
            if user_id:
                break

    return token, (user_id or "me")


def _redact_token(msg: str) -> str:
    return re.sub(r"(access_token=)[^&\s\"']+", r"\1***", str(msg or ""))


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


def update_threads_posts() -> dict[str, Any]:
    """Fetch latest posts from Meta Threads Graph API and persist local JSON cache."""
    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    out_path = os.path.join(BACKEND_DATA_DIR, OUTPUT_FILENAME)
    existing = _load_existing_cache()
    token, user_id = get_threads_credentials()

    if not token:
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
    session = requests.Session()
    headers = {"Accept": "application/json", "User-Agent": "VancouverGodsEye/1.0"}

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
    next_url: str | None = f"{THREADS_API_BASE}/{user_id}/threads"
    next_params: dict[str, Any] | None = {
        "fields": POST_FIELDS,
        "limit": PAGE_LIMIT,
        "access_token": token,
    }
    fetch_error: str | None = None

    try:
        for page_idx in range(MAX_PAGES):
            if not next_url:
                break
            resp = session.get(next_url, params=next_params, headers=headers, timeout=25)
            next_params = None  # `paging.next` already includes query params
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

    if fetch_error and not posts:
        # Preserve previous cached posts if live call failed transiently
        fallback_posts = existing.get("posts") or []
        payload = {
            "configured": True,
            "status": "error",
            "error": fetch_error,
            "updated_at": existing.get("updated_at") or now_iso,
            "last_attempt_at": now_iso,
            "profile": profile or existing.get("profile"),
            "total_count": len(fallback_posts),
            "posts": fallback_posts,
        }
        os.makedirs(BACKEND_DATA_DIR, exist_ok=True)
        atomic_write_json(out_path, payload, indent=2, prefix=".tmp_threads_", suffix=".json")
        return payload

    # Sort newest-first by ISO timestamp
    posts.sort(key=lambda p: p.get("timestamp") or "", reverse=True)

    payload = {
        "configured": True,
        "status": "ok",
        "error": None,
        "updated_at": now_iso,
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
