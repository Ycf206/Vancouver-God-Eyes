'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AtSign,
  X,
  RefreshCw,
  Search,
  ArrowUpDown,
  ExternalLink,
  Image as ImageIcon,
  Film,
  Layers,
  MessageSquareText,
  Clock,
  AlertCircle,
  KeyRound,
  Quote,
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';

interface ThreadsChildMedia {
  id: string;
  media_type: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
}

interface ThreadsPost {
  id: string;
  text: string;
  timestamp: string;
  media_product_type?: string;
  media_type: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
  permalink?: string | null;
  shortcode?: string | null;
  username?: string;
  is_quote_post?: boolean;
  has_media?: boolean;
  children?: ThreadsChildMedia[];
}

interface ThreadsProfile {
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string | null;
  biography?: string;
}

interface ThreadsApiResponse {
  configured: boolean;
  status: string;
  error?: string | null;
  updated_at?: string | null;
  profile?: ThreadsProfile | null;
  total_all?: number;
  total_count?: number;
  refreshed?: boolean;
  cooldown_remaining?: number;
  posts: ThreadsPost[];
}

interface ThreadsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SortMode = 'newest' | 'oldest' | 'media_first';
type MediaFilter = 'all' | 'image' | 'video' | 'text';

function formatPostTime(isoStr?: string | null): string {
  if (!isoStr) return '';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  const diffSec = Math.floor((Date.now() - dt.getTime()) / 1000);
  let rel = '';
  if (diffSec >= 0 && diffSec < 60) rel = '剛剛';
  else if (diffSec >= 60 && diffSec < 3600) rel = `${Math.floor(diffSec / 60)} 分鐘前`;
  else if (diffSec >= 3600 && diffSec < 86400) rel = `${Math.floor(diffSec / 3600)} 小時前`;
  else if (diffSec >= 86400 && diffSec < 86400 * 7) rel = `${Math.floor(diffSec / 86400)} 天前`;

  const formatted = dt.toLocaleString('zh-TW', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return rel ? `${rel} · ${formatted}` : formatted;
}

function getMediaBadge(post: ThreadsPost): { label: string; icon: React.ReactNode; cls: string } | null {
  const mt = (post.media_type || '').toUpperCase();
  if (mt === 'CAROUSEL_ALBUM') {
    return {
      label: `輪播 (${post.children?.length || 0})`,
      icon: <Layers className="w-3 h-3" />,
      cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    };
  }
  if (mt === 'VIDEO') {
    return {
      label: '影片',
      icon: <Film className="w-3 h-3" />,
      cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    };
  }
  if (mt === 'IMAGE') {
    return {
      label: '圖片',
      icon: <ImageIcon className="w-3 h-3" />,
      cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    };
  }
  if (post.is_quote_post) {
    return {
      label: '引用',
      icon: <Quote className="w-3 h-3" />,
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    };
  }
  return null;
}

export default function ThreadsModal({ isOpen, onClose }: ThreadsModalProps) {
  const [data, setData] = useState<ThreadsApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const fetchPosts = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setNotice(null);

    try {
      const apiBase = getApiUrl();
      const url = `${apiBase}/api/threads/posts${forceRefresh ? '?refresh=true' : ''}`;
      let res: Response | null = null;
      try {
        res = await fetch(url, { cache: 'no-store' });
      } catch {
        res = null;
      }
      if (!res || !res.ok) {
        res = await fetch(`/api/threads/posts${forceRefresh ? '?refresh=true' : ''}`, {
          cache: 'no-store',
        });
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: ThreadsApiResponse = await res.json();
      setData(json);
      if (forceRefresh) {
        if (json.cooldown_remaining && json.cooldown_remaining > 0) {
          setNotice(`剛剛已重新整理，請稍候 ${json.cooldown_remaining} 秒再試。`);
        } else if (json.configured && json.status === 'ok') {
          setNotice('已同步最新 Threads 帖文！');
        }
      }
    } catch (err) {
      setData((prev) => ({
        configured: prev?.configured ?? false,
        status: 'error',
        error: `無法載入 Threads 帖文：${err instanceof Error ? err.message : '連線失敗'}`,
        updated_at: prev?.updated_at ?? null,
        profile: prev?.profile ?? null,
        posts: prev?.posts ?? [],
      }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchPosts(false);
  }, [isOpen, fetchPosts]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const filteredPosts = useMemo(() => {
    const raw = data?.posts || [];
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const list = raw.filter((post) => {
      const mt = (post.media_type || 'TEXT_POST').toUpperCase();
      if (mediaFilter === 'image' && mt !== 'IMAGE' && mt !== 'CAROUSEL_ALBUM') return false;
      if (mediaFilter === 'video' && mt !== 'VIDEO') return false;
      if (mediaFilter === 'text' && post.has_media) return false;

      if (tokens.length > 0) {
        const hay = `${post.text || ''} ${post.username || ''} ${post.shortcode || ''}`.toLowerCase();
        if (!tokens.every((tok) => hay.includes(tok))) return false;
      }
      return true;
    });

    const sorted = [...list];
    if (sortMode === 'oldest') {
      sorted.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    } else if (sortMode === 'media_first') {
      sorted.sort((a, b) => {
        const ma = a.has_media ? 1 : 0;
        const mb = b.has_media ? 1 : 0;
        if (mb !== ma) return mb - ma;
        return (b.timestamp || '').localeCompare(a.timestamp || '');
      });
    } else {
      sorted.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    }
    return sorted;
  }, [data?.posts, searchQuery, sortMode, mediaFilter]);

  if (!isOpen) return null;

  const profile = data?.profile;
  const username = profile?.username || data?.posts?.[0]?.username || '';
  const totalAll = data?.posts?.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[660px] bg-[#1e2025] border border-[#373a40] rounded-xl shadow-2xl overflow-hidden text-gray-200 flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[#2d2e34] bg-[#191a1e] shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {profile?.profile_picture_url ? (
              <img
                src={profile.profile_picture_url}
                alt={username || 'Threads'}
                className="w-9 h-9 rounded-full object-cover border border-[#3f424a] shrink-0"
              />
            ) : (
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-600/60 text-white shrink-0">
                <AtSign className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  Threads 帖文
                </h2>
                {username && (
                  <a
                    href={`https://www.threads.net/@${username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/15 text-zinc-200 border border-white/15 transition-colors"
                  >
                    <span>@{username}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-80" />
                  </a>
                )}
              </div>
              <p className="text-[11px] text-gray-400 truncate mt-0.5">
                {data?.updated_at
                  ? `最後更新：${formatPostTime(data.updated_at)}（每小時自動同步）`
                  : '官方 Meta Threads API · 每小時自動快取同步'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => fetchPosts(true)}
              disabled={refreshing || loading}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#262830] hover:bg-[#31343e] border border-[#3b3e47] text-gray-200 hover:text-white transition-colors disabled:opacity-50"
              title="重新整理最新帖文"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              title="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search + Sort + Filter Controls */}
        <div className="px-4 sm:px-5 py-3 border-b border-[#2d2e34] bg-[#1b1c21] flex flex-col gap-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋帖文內容、關鍵字或代碼..."
                className="w-full pl-8.5 pr-8 py-1.5 rounded-lg bg-[#25272e] border border-[#373a42] text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-sky-500/70 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5"
                  title="清除搜尋"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 bg-[#25272e] border border-[#373a42] rounded-lg px-2.5 py-1.5 shrink-0">
              <ArrowUpDown className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                aria-label="排序方式"
                className="bg-transparent text-xs text-gray-200 font-medium focus:outline-none cursor-pointer pr-1"
              >
                <option value="newest" className="bg-[#1e2025] text-gray-200">最新優先</option>
                <option value="oldest" className="bg-[#1e2025] text-gray-200">最舊優先</option>
                <option value="media_first" className="bg-[#1e2025] text-gray-200">圖片影片優先</option>
              </select>
            </div>
          </div>

          {/* Media Filter Pills & Count */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'all', label: '全部', icon: null },
                  { id: 'image', label: '圖片', icon: <ImageIcon className="w-3 h-3" /> },
                  { id: 'video', label: '影片', icon: <Film className="w-3 h-3" /> },
                  { id: 'text', label: '純文字', icon: <MessageSquareText className="w-3 h-3" /> },
                ] as Array<{ id: MediaFilter; label: string; icon: React.ReactNode }>
              ).map((chip) => {
                const active = mediaFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setMediaFilter(chip.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                      active
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                        : 'bg-[#25272e] text-gray-400 border-[#343740] hover:text-gray-200 hover:border-gray-500'
                    }`}
                  >
                    {chip.icon}
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-gray-400 font-mono">
              顯示 {filteredPosts.length} / {totalAll} 篇
            </span>
          </div>

          {notice && (
            <div className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-md px-2.5 py-1.5">
              {notice}
            </div>
          )}
        </div>

        {/* Posts List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {loading && !data ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-[#25272e] border border-[#343740] rounded-xl p-4 animate-pulse space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gray-700" />
                    <div className="h-3 w-28 bg-gray-700 rounded" />
                  </div>
                  <div className="h-3 w-full bg-gray-700/80 rounded" />
                  <div className="h-3 w-3/4 bg-gray-700/80 rounded" />
                </div>
              ))}
            </div>
          ) : data && !data.configured && totalAll === 0 ? (
            <div className="bg-[#24262d] border border-amber-500/30 rounded-xl p-5 flex flex-col items-center text-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">尚未連結 Threads API 存取權杖</h3>
                <p className="text-xs text-gray-400 max-w-md leading-relaxed">
                  請於 GitHub Repository Secrets 新增 <code className="px-1 py-0.5 rounded bg-black/40 text-amber-300">THREADS_ACCESS_TOKEN</code>（及選填 <code className="px-1 py-0.5 rounded bg-black/40 text-amber-300">THREADS_USER_ID</code>），或於本機 <code className="px-1 py-0.5 rounded bg-black/40 text-sky-300">backend/.env</code> 填入後重新整理，系統即會每小時自動抓取您的 Threads 帖文。
                </p>
              </div>
              <a
                href="https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-gray-200 border border-white/15 transition-colors"
              >
                <span>查看 Meta Threads API 官方文件</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <>
              {data?.error && (
                <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/35 rounded-lg px-3 py-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span className="break-words">{data.error}</span>
                </div>
              )}

              {filteredPosts.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400">
                  {totalAll === 0
                    ? '目前尚未擷取到任何 Threads 帖文，請按右上角重新整理按鈕試試。'
                    : '找不到符合搜尋或篩選條件的帖文。'}
                </div>
              ) : (
                filteredPosts.map((post) => {
                  const badge = getMediaBadge(post);
                  const mt = (post.media_type || 'TEXT_POST').toUpperCase();
                  return (
                    <article
                      key={post.id}
                      className="bg-[#25272e] hover:bg-[#292b33] border border-[#353842] rounded-xl p-3.5 sm:p-4 transition-colors space-y-2.5"
                    >
                      {/* Post Meta Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {profile?.profile_picture_url ? (
                            <img
                              src={profile.profile_picture_url}
                              alt={post.username || username || 'Threads'}
                              className="w-7 h-7 rounded-full object-cover border border-[#444752] shrink-0"
                            />
                          ) : (
                            <span className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-600/60 flex items-center justify-center text-zinc-200 shrink-0">
                              <AtSign className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              @{post.username || username || 'threads'}
                            </div>
                            <div className="flex items-center gap-1 text-[10.5px] text-gray-400">
                              <Clock className="w-2.5 h-2.5 shrink-0" />
                              <span>{formatPostTime(post.timestamp)}</span>
                            </div>
                          </div>
                        </div>

                        {badge && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${badge.cls}`}
                          >
                            {badge.icon}
                            <span>{badge.label}</span>
                          </span>
                        )}
                      </div>

                      {/* Post Text */}
                      {post.text && (
                        <p className="text-[13px] text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
                          {post.text}
                        </p>
                      )}

                      {/* Single Image */}
                      {mt === 'IMAGE' && post.media_url && (
                        <a
                          href={post.permalink || post.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg overflow-hidden border border-[#3a3d47] bg-black/30"
                        >
                          <img
                            src={post.media_url}
                            alt="Threads 附圖"
                            loading="lazy"
                            className="w-full max-h-[360px] object-contain mx-auto"
                          />
                        </a>
                      )}

                      {/* Video */}
                      {mt === 'VIDEO' && post.media_url && (
                        <div className="rounded-lg overflow-hidden border border-[#3a3d47] bg-black">
                          <video
                            src={post.media_url}
                            poster={post.thumbnail_url || undefined}
                            controls
                            playsInline
                            preload="metadata"
                            className="w-full max-h-[380px] mx-auto"
                          />
                        </div>
                      )}

                      {/* Carousel Album */}
                      {mt === 'CAROUSEL_ALBUM' && post.children && post.children.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-1.5">
                          {post.children.map((ch) => {
                            const cmt = (ch.media_type || 'IMAGE').toUpperCase();
                            if (cmt === 'VIDEO' && ch.media_url) {
                              return (
                                <video
                                  key={ch.id}
                                  src={ch.media_url}
                                  poster={ch.thumbnail_url || undefined}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="h-52 w-auto rounded-lg border border-[#3a3d47] bg-black shrink-0"
                                />
                              );
                            }
                            const imgSrc = ch.media_url || ch.thumbnail_url;
                            if (!imgSrc) return null;
                            return (
                              <a
                                key={ch.id}
                                href={post.permalink || imgSrc}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded-lg overflow-hidden border border-[#3a3d47] bg-black/30"
                              >
                                <img
                                  src={imgSrc}
                                  alt="Threads 輪播圖片"
                                  loading="lazy"
                                  className="h-52 w-auto max-w-[280px] object-cover"
                                />
                              </a>
                            );
                          })}
                        </div>
                      )}

                      {/* Footer Permalink */}
                      {post.permalink && (
                        <div className="pt-1 flex justify-end border-t border-[#32353f]/70">
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            <span>在 Threads 查看原文</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
