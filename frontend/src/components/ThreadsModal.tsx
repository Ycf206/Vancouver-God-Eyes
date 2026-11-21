'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  X,
  RefreshCw,
  Search,
  ArrowUpDown,
  ExternalLink,
  Image as ImageIcon,
  Film,
  MessageSquareText,
  Clock,
  AlertCircle,
  KeyRound,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';
import { formatDateOnly, formatDateTime } from '@/utils/time';
import { useUIStore } from '@/store/useUIStore';

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

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function formatRelativeAgo(isoStr?: string | null): string {
  if (!isoStr) return '';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return '剛剛';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分鐘前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小時前`;
  return `${Math.floor(diffSec / 86400)}天前`;
}

function formatSystemDateTimeWithAgo(
  isoStr?: string | null,
  timeFormat: '12h' | '24h' = '24h',
  timeZone?: string
): string {
  if (!isoStr) return '';
  const formatted = formatDateTime(isoStr, timeFormat, timeZone);
  const rel = formatRelativeAgo(isoStr);
  return rel ? `${formatted} (${rel})` : formatted;
}

export default function ThreadsModal({ isOpen, onClose }: ThreadsModalProps) {
  const { timeFormat, timeZone } = useUIStore();
  const [data, setData] = useState<ThreadsApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

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
          setNotice('已同步最新 Threads 內容！');
        }
      }
    } catch (err) {
      setData((prev) => ({
        configured: prev?.configured ?? false,
        status: 'error',
        error: `無法載入 Threads 資料：${err instanceof Error ? err.message : '連線失敗'}`,
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

      if (selectedDate) {
        const postDay = formatDateOnly(post.timestamp, timeZone);
        if (postDay !== selectedDate) return false;
      }

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
  }, [data?.posts, searchQuery, selectedDate, sortMode, mediaFilter, timeZone]);

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
    setPageInput('1');
  }, [searchQuery, selectedDate, sortMode, mediaFilter, pageSize]);

  useEffect(() => {
    setPageInput(String(safePage));
  }, [safePage]);

  const pagedPosts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredPosts.slice(start, start + pageSize);
  }, [filteredPosts, safePage, pageSize]);

  const goToPage = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(totalPages, target));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [totalPages]
  );

  const commitPageInput = useCallback(() => {
    const parsed = parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(safePage));
      return;
    }
    goToPage(parsed);
  }, [pageInput, safePage, goToPage]);

  if (!isOpen) return null;

  const profile = data?.profile;
  const username = profile?.username || data?.posts?.[0]?.username || '';
  const totalAll = data?.posts?.length ?? 0;
  const isFiltered = Boolean(searchQuery.trim() || selectedDate || mediaFilter !== 'all');

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-[680px] bg-[#1e2025] border border-[#373a40] rounded-xl shadow-2xl overflow-hidden text-gray-200 flex flex-col max-h-[88vh]"
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
            <div className="min-w-0 flex flex-col">
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide leading-tight">
                Threads
              </h2>
              {username && (
                <a
                  href={`https://www.threads.net/@${username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-gray-400 hover:text-white transition-colors mt-0.5 w-fit truncate"
                >
                  <span>@{username}</span>
                  <ExternalLink className="w-3 h-3 opacity-80 shrink-0" />
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => fetchPosts(true)}
              disabled={refreshing || loading}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#262830] hover:bg-[#31343e] border border-[#3b3e47] text-gray-200 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              title="重新整理"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
              title="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search + Date + Sort + Filter Controls */}
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
                className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-[#25272e] border border-[#373a42] text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-sky-500/70 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 cursor-pointer"
                  title="清除搜尋"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Date Filter */}
            <div className="relative flex items-center shrink-0">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full sm:w-auto bg-[#25272e] border border-[#373a42] text-gray-200 rounded-lg pl-2.5 pr-7 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-500/70 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:[filter:brightness(0)_invert(1)]"
                title="依日期篩選"
                aria-label="依日期篩選"
              />
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="absolute right-1.5 text-gray-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
                  title="清除日期篩選"
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

          {/* Media Filter Pills & Total Count */}
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
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
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
              {isFiltered
                ? `符合 ${filteredPosts.length.toLocaleString()} / 帖文總數：${totalAll.toLocaleString()}`
                : `帖文總數：${totalAll.toLocaleString()}`}
            </span>
          </div>

          {notice && (
            <div className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-md px-2.5 py-1.5">
              {notice}
            </div>
          )}
        </div>

        {/* Posts List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {loading && !data ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-[#25272e] border border-[#343740] rounded-xl p-4 animate-pulse space-y-2.5"
                >
                  <div className="h-3 w-36 bg-gray-700 rounded" />
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
                  請於 GitHub Repository Secrets 新增 <code className="px-1 py-0.5 rounded bg-black/40 text-amber-300">THREADS_ACCESS_TOKEN</code>，或於本機 <code className="px-1 py-0.5 rounded bg-black/40 text-sky-300">backend/.env</code> 填入後點擊右上角重新整理即可載入貼文。
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

              {pagedPosts.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400">
                  {totalAll === 0
                    ? '目前尚未擷取到任何帖文，請按右上角重新整理按鈕試試。'
                    : '找不到符合搜尋或篩選條件的帖文。'}
                </div>
              ) : (
                pagedPosts.map((post) => {
                  const mt = (post.media_type || 'TEXT_POST').toUpperCase();
                  return (
                    <article
                      key={post.id}
                      className="bg-[#25272e] hover:bg-[#292b33] border border-[#353842] rounded-xl p-3.5 sm:p-4 transition-colors space-y-2.5"
                    >
                      {/* Post Header: Date/Time + External Permalink Icon Button */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {formatSystemDateTimeWithAgo(post.timestamp, timeFormat, timeZone)}
                          </span>
                        </div>

                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 -m-1 rounded-lg text-gray-400 hover:text-sky-300 hover:bg-white/10 transition-colors shrink-0"
                            title="在 Threads 查看原文"
                            aria-label="在 Threads 查看原文"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>

                      {/* Post Text */}
                      {post.text && (
                        <p className="text-[13px] text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
                          {post.text}
                        </p>
                      )}

                      {/* Single Image -> opens direct image URL */}
                      {mt === 'IMAGE' && post.media_url && (
                        <a
                          href={post.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg overflow-hidden border border-[#3a3d47] bg-black/30 hover:border-sky-500/50 transition-colors"
                          title="開啟原始圖片"
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

                      {/* Carousel Album -> each image opens its own direct image URL */}
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
                                href={imgSrc}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded-lg overflow-hidden border border-[#3a3d47] bg-black/30 hover:border-sky-500/50 transition-colors"
                                title="開啟原始圖片"
                              >
                                <img
                                  src={imgSrc}
                                  alt="Threads 附圖"
                                  loading="lazy"
                                  className="h-52 w-auto max-w-[280px] object-cover"
                                />
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Footer: Last Updated + Page Size + Pagination Controls */}
        {(totalAll > 0 || data?.updated_at) && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-[#2d2e34] bg-[#191a1e] flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400 shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span>每頁</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="每頁顯示數量"
                  className="bg-[#25272e] border border-[#373a42] rounded-md px-1.5 py-0.5 text-[11px] text-gray-200 font-mono focus:outline-none focus:border-sky-500/70 cursor-pointer"
                >
                  {PAGE_SIZE_OPTIONS.map((sz) => (
                    <option key={sz} value={sz} className="bg-[#1e2025] text-gray-200">
                      {sz}
                    </option>
                  ))}
                </select>
                <span>篇</span>
              </div>
              {data?.updated_at && (
                <span className="text-[10.5px] text-gray-500 truncate">
                  最後更新：{formatSystemDateTimeWithAgo(data.updated_at, timeFormat, timeZone)}
                </span>
              )}
            </div>

            {filteredPosts.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={() => goToPage(safePage - 1)}
                  disabled={safePage <= 1}
                  className="flex items-center justify-center w-7 h-7 rounded-md bg-[#25272e] hover:bg-[#31343e] border border-[#373a42] text-gray-200 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="上一頁"
                  aria-label="上一頁"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-1 font-mono text-gray-300">
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onBlur={commitPageInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitPageInput();
                      }
                    }}
                    aria-label="頁碼"
                    className="w-12 text-center bg-[#25272e] border border-[#373a42] rounded-md py-0.5 text-[11px] text-white font-mono focus:outline-none focus:border-sky-500/70 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-gray-500">/</span>
                  <span>{totalPages}</span>
                </div>

                <button
                  type="button"
                  onClick={() => goToPage(safePage + 1)}
                  disabled={safePage >= totalPages}
                  className="flex items-center justify-center w-7 h-7 rounded-md bg-[#25272e] hover:bg-[#31343e] border border-[#373a42] text-gray-200 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="下一頁"
                  aria-label="下一頁"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
