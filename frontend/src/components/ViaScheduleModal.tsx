'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { formatDateTime } from '@/utils/time';
import {
  X,
  TrainTrack,
  TramFront,
  Search,
  RefreshCw,
  ExternalLink,
  Map as MapIcon,
  MapPin,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  GitCommitHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface ViaStop {
  station: string;
  code?: string;
  seq?: number;
  estimated?: string | null;
  scheduled?: string | null;
  eta?: string | null;
  diff?: string | null;
  diff_min?: number | null;
  platform?: string | null;
  arrived?: boolean;
}

interface ViaTrain {
  id: string;
  train_number: string;
  instance?: string;
  from: string;
  to: string;
  departed: boolean;
  arrived: boolean;
  in_service: boolean;
  service_status: string;
  has_gps: boolean;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  direction: number | null;
  poll?: string | null;
  poll_min?: number | null;
  delay_min: number | null;
  delay_status?: string | null;
  stops_completed: number;
  stops_total: number;
  last_stop?: ViaStop | null;
  next_stop?: ViaStop | null;
  times?: ViaStop[];
}

interface ViaLivePayload {
  status?: string;
  updated_at?: string;
  total_count?: number;
  in_service_count?: number;
  not_in_service_count?: number;
  in_service: ViaTrain[];
  not_in_service: ViaTrain[];
}

const isValidIso = (v?: string | null) =>
  Boolean(v && v !== '&mdash;' && !Number.isNaN(new Date(v).getTime()));

const formatPlaceTitle = (raw?: string | null) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-/.(])([a-z\u00c0-\u024f])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
};

const formatEtaZh = (eta?: string | null) => {
  if (!eta) return '';
  const s = String(eta).trim();
  if (!s || s === '&mdash;' || s === '-') return '';
  if (s.toUpperCase() === 'ARR') return '已抵達';
  if (/^<\s*1\s*min/i.test(s) || /^0\s*min/i.test(s)) return '即將進站';
  const hm = s.match(/^(\d+)\s*h\s*(\d+)?/i);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = hm[2] ? parseInt(hm[2], 10) : 0;
    if (h > 0 && m > 0) return `${h} 小時 ${m} 分鐘`;
    if (h > 0) return `${h} 小時`;
    return `${m} 分鐘`;
  }
  const mm = s.match(/^(\d+)\s*mins?$/i);
  if (mm) return `${parseInt(mm[1], 10)} 分鐘`;
  return s.replace(/\bhours?\b/gi, '小時').replace(/\bmins?\b/gi, '分鐘');
};

const formatHeading = (deg?: number | null) => {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${Math.round(deg)}° (${dirs[idx]})`;
};

const getDelayBadge = (delayMin?: number | null) => {
  if (delayMin == null) return { label: '狀態正常', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  if (delayMin > 30) return { label: `延誤 ${delayMin} 分鐘`, cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
  if (delayMin > 5) return { label: `延誤 ${delayMin} 分鐘`, cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40' };
  if (delayMin < -2) return { label: `提早 ${Math.abs(delayMin)} 分鐘`, cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' };
  return { label: '準時', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
};

export default function ViaScheduleModal() {
  const {
    isViaScheduleOpen,
    setViaScheduleOpen,
    selectedViaTrainId,
    setSelectedViaTrainId,
    timeFormat,
    timeZone,
  } = useUIStore();

  const [viaRailData, setViaRailData] = useState<ViaLivePayload | null>(null);
  const [loadingViaRail, setLoadingViaRail] = useState<boolean>(false);
  const [viaSearchQuery, setViaSearchQuery] = useState<string>('');
  const [viaSortBy, setViaSortBy] = useState<'train_asc' | 'speed_desc' | 'delay_desc' | 'from_asc'>('train_asc');
  const [viaPage, setViaPage] = useState<number>(1);
  const [viaPageInput, setViaPageInput] = useState<string>('1');
  const [viaPageSize, setViaPageSize] = useState<number>(10);
  const [viaNotInServiceOpen, setViaNotInServiceOpen] = useState<boolean>(false);
  const [viaExpandedTrainIds, setViaExpandedTrainIds] = useState<Record<string, boolean>>({});
  const [viaMapModalOpen, setViaMapModalOpen] = useState<boolean>(false);
  const [viaMapZoom, setViaMapZoom] = useState<number>(1);

  const fetchViaRailLive = useCallback(async (manual = false) => {
    if (manual) setLoadingViaRail(true);
    try {
      const apiUrl = getApiUrl();
      let res: Response | null = null;
      try {
        res = await fetch(`${apiUrl}/api/via-rail/live`, { cache: 'no-store' });
      } catch {
        res = null;
      }
      if (!res || !res.ok) {
        res = await fetch('/api/via-rail/live', { cache: 'no-store' });
      }
      if (res && res.ok) {
        const json = await res.json();
        if (json && (Array.isArray(json.in_service) || Array.isArray(json.not_in_service))) {
          setViaRailData({
            status: json.status,
            updated_at: json.updated_at,
            total_count: json.total_count,
            in_service_count: json.in_service_count,
            not_in_service_count: json.not_in_service_count,
            in_service: Array.isArray(json.in_service) ? json.in_service : [],
            not_in_service: Array.isArray(json.not_in_service) ? json.not_in_service : [],
          });
        }
      }
    } catch {
      // Keep cached data on transient network failure
    } finally {
      if (manual) setLoadingViaRail(false);
    }
  }, []);

  useEffect(() => {
    if (!isViaScheduleOpen) return;
    fetchViaRailLive(!viaRailData);
    const timer = window.setInterval(() => fetchViaRailLive(false), 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViaScheduleOpen, fetchViaRailLive]);

  // Escape key closes official route map modal first, then closes panel
  useEffect(() => {
    if (!isViaScheduleOpen && !viaMapModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viaMapModalOpen) {
          setViaMapModalOpen(false);
        } else if (isViaScheduleOpen) {
          setViaScheduleOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isViaScheduleOpen, viaMapModalOpen, setViaScheduleOpen]);

  const sortViaTrains = useCallback(
    (list: ViaTrain[]) => {
      const arr = [...list];
      const trainNumVal = (t: ViaTrain) => {
        const m = String(t.train_number || t.id).match(/\d+/);
        return m ? parseInt(m[0], 10) : 999999;
      };
      arr.sort((a, b) => {
        if (viaSortBy === 'speed_desc') {
          const sa = a.speed ?? -1;
          const sb = b.speed ?? -1;
          if (sb !== sa) return sb - sa;
        } else if (viaSortBy === 'delay_desc') {
          const da = a.delay_min ?? -9999;
          const db = b.delay_min ?? -9999;
          if (db !== da) return db - da;
        } else if (viaSortBy === 'from_asc') {
          const cmp = (a.from || '').localeCompare(b.from || '');
          if (cmp !== 0) return cmp;
        }
        const na = trainNumVal(a);
        const nb = trainNumVal(b);
        if (na !== nb) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      });
      return arr;
    },
    [viaSortBy]
  );

  const matchesViaQuery = useCallback((t: ViaTrain, q: string) => {
    if (!q) return true;
    const low = q.toLowerCase();
    if (String(t.id || '').toLowerCase().includes(low)) return true;
    if (String(t.train_number || '').toLowerCase().includes(low)) return true;
    if (String(t.from || '').toLowerCase().includes(low)) return true;
    if (String(t.to || '').toLowerCase().includes(low)) return true;
    if (Array.isArray(t.times)) {
      return t.times.some(
        (st) =>
          String(st.station || '').toLowerCase().includes(low) ||
          String(st.code || '').toLowerCase().includes(low)
      );
    }
    return false;
  }, []);

  const isViaTrainActive = useCallback((t: ViaTrain) => {
    const allStopsArrived = t.stops_total > 0 && t.stops_completed >= t.stops_total;
    return t.departed === true && t.arrived === false && t.in_service !== false && !allStopsArrived;
  }, []);

  const filteredViaInService = useMemo(() => {
    const raw = (viaRailData?.in_service || []).filter(isViaTrainActive);
    const q = viaSearchQuery.trim();
    return sortViaTrains(q ? raw.filter((t) => matchesViaQuery(t, q)) : raw);
  }, [viaRailData, viaSearchQuery, sortViaTrains, matchesViaQuery, isViaTrainActive]);

  const filteredViaNotInService = useMemo(() => {
    const fromNotIn = viaRailData?.not_in_service || [];
    const misplaced = (viaRailData?.in_service || []).filter((t) => !isViaTrainActive(t));
    const combined = [...fromNotIn, ...misplaced];
    const q = viaSearchQuery.trim();
    return sortViaTrains(q ? combined.filter((t) => matchesViaQuery(t, q)) : combined);
  }, [viaRailData, viaSearchQuery, sortViaTrains, matchesViaQuery, isViaTrainActive]);

  const viaTotalPages = Math.max(1, Math.ceil(filteredViaInService.length / viaPageSize));

  useEffect(() => {
    setViaPage(1);
    setViaPageInput('1');
  }, [viaSearchQuery, viaSortBy, viaPageSize]);

  useEffect(() => {
    if (viaPage > viaTotalPages) {
      setViaPage(viaTotalPages);
      setViaPageInput(String(viaTotalPages));
    }
  }, [viaPage, viaTotalPages]);

  const paginatedViaInService = useMemo(() => {
    const start = (viaPage - 1) * viaPageSize;
    return filteredViaInService.slice(start, start + viaPageSize);
  }, [filteredViaInService, viaPage, viaPageSize]);

  useEffect(() => {
    if (!selectedViaTrainId || !isViaScheduleOpen) return;
    const idx = filteredViaInService.findIndex((t) => t.id === selectedViaTrainId);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / viaPageSize) + 1;
      setViaPage(targetPage);
      setViaPageInput(String(targetPage));
      setViaExpandedTrainIds((prev) => ({ ...prev, [selectedViaTrainId]: true }));
    }
  }, [selectedViaTrainId, isViaScheduleOpen, filteredViaInService, viaPageSize]);

  if (!isViaScheduleOpen) return null;

  const commitViaPage = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setViaPageInput(String(viaPage));
      return;
    }
    const clamped = Math.min(Math.max(1, parsed), viaTotalPages);
    setViaPage(clamped);
    setViaPageInput(String(clamped));
  };

  const isTrainEffectivelyArrived = (t: ViaTrain) =>
    Boolean(t.arrived || (t.stops_total > 0 && t.stops_completed >= t.stops_total));
  const notDepartedCount = filteredViaNotInService.filter(
    (t) => !t.departed && !isTrainEffectivelyArrived(t)
  ).length;
  const arrivedCount = filteredViaNotInService.filter(isTrainEffectivelyArrived).length;

  const renderStopsTable = (train: ViaTrain) => {
    const stops = Array.isArray(train.times) ? train.times : [];
    if (stops.length === 0) {
      return <div className="text-[10.5px] text-gray-500 py-1.5 text-center">暫無詳細停靠站時刻表</div>;
    }
    return (
      <div className="mt-2 pt-2 border-t border-[#232938] space-y-1 max-h-56 overflow-y-auto custom-scrollbar pr-1">
        {stops.map((st, idx) => {
          const isNext = train.next_stop && train.next_stop.seq === st.seq;
          const estValid = isValidIso(st.estimated);
          const schValid = isValidIso(st.scheduled);
          const timeDisplay = estValid
            ? formatDateTime(st.estimated!, timeFormat, timeZone)
            : schValid
              ? formatDateTime(st.scheduled!, timeFormat, timeZone)
              : '—';
          const diffMin = st.diff_min;
          return (
            <div
              key={`${train.id}_st_${st.seq ?? idx}`}
              className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[10.5px] ${
                isNext
                  ? 'bg-amber-500/15 border border-amber-500/35 text-amber-100'
                  : st.arrived
                    ? 'bg-[#0e121a] text-gray-400'
                    : 'bg-[#121621] text-gray-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isNext ? 'bg-amber-400 animate-pulse' : st.arrived ? 'bg-emerald-400' : 'bg-gray-600'
                  }`}
                />
                <span className="truncate font-medium">{st.station}</span>
                {st.code && (
                  <span className="text-[9.5px] font-mono text-gray-400 shrink-0">({st.code})</span>
                )}
                {st.platform && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 shrink-0">
                    月台 {st.platform}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                <span className={st.arrived ? 'text-gray-400' : 'text-gray-200'}>{timeDisplay}</span>
                {diffMin != null && diffMin > 5 && (
                  <span className="text-[9.5px] text-rose-400">+{diffMin}分</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* 獨立右側浮動面板（參照 YVR 溫哥華國際機場右側面板版面） */}
      <div
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="fixed top-[72px] right-3 sm:right-4 z-40 w-[calc(100vw-24px)] sm:w-[490px] md:w-[530px] max-w-[calc(100vw-24px)] lg:max-w-[calc(100vw-272px)] bg-[#131620] text-gray-100 rounded-xl p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.85)] border border-[#2c3244] flex flex-col max-h-[calc(100dvh-90px)] animate-in fade-in slide-in-from-right-4 duration-150 select-none"
      >
        {/* Header (參照 YVR 面板頂部設計) */}
        <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0 gap-2">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 shadow-sm">
              <TrainTrack className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate">
                VIA Rail Canada 列車班次
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="text-[11px] text-gray-400 font-medium">
                  全加拿大即時列車追蹤
                </span>
                <span className="text-[10px] text-amber-300 bg-amber-950/70 border border-amber-700/60 px-1.5 py-0.2 rounded font-mono font-medium">
                  每 15 秒更新
                </span>
              </div>
            </div>
          </div>

          {/* 右側操作按鈕組 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setViaMapZoom(1);
                setViaMapModalOpen(true);
              }}
              className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/40 transition-colors cursor-pointer"
              title="查看 VIA 官方路線地圖"
            >
              <MapIcon className="w-4 h-4" />
            </button>
            <a
              href="https://tsimobile.viarail.ca/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-gray-400 hover:text-amber-300 hover:bg-[#252a38] transition-colors cursor-pointer"
              title="前往 VIA Rail 官方即時列車追蹤"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={() => fetchViaRailLive(true)}
              disabled={loadingViaRail}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#252a38] transition-colors disabled:opacity-50 cursor-pointer"
              title="立即重新整理"
            >
              <RefreshCw className={`w-4 h-4 ${loadingViaRail ? 'animate-spin text-amber-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setViaScheduleOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#252a38] transition-colors cursor-pointer"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar + Per-page + Sort Selector on one row */}
        <div className="flex items-center gap-1.5 mb-2.5 shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={viaSearchQuery}
              onChange={(e) => setViaSearchQuery(e.target.value)}
              placeholder="搜尋車次、起訖站或車站代碼..."
              className="w-full bg-[#10131c] border border-[#262c3d] focus:border-amber-500/60 rounded-lg pl-8 pr-6 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none transition-colors"
            />
            {viaSearchQuery && (
              <button
                type="button"
                onClick={() => setViaSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                title="清除搜尋"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#10131c] border border-[#262c3d] rounded-lg px-1.5 py-1.5 text-[11px] text-gray-300 shrink-0">
            <span className="text-gray-400">每頁</span>
            <select
              value={viaPageSize}
              onChange={(e) => setViaPageSize(Number(e.target.value))}
              className="bg-transparent text-[11px] font-mono text-gray-100 outline-none cursor-pointer"
              title="每頁顯示班次數量"
            >
              <option value={10} className="bg-[#10131c]">10</option>
              <option value={20} className="bg-[#10131c]">20</option>
              <option value={50} className="bg-[#10131c]">50</option>
            </select>
            <span className="text-gray-400">班</span>
          </div>

          <div className="relative flex items-center shrink-0">
            <ArrowUpDown className="w-3 h-3 text-amber-400 absolute left-2 pointer-events-none" />
            <select
              value={viaSortBy}
              onChange={(e) => setViaSortBy(e.target.value as 'train_asc' | 'speed_desc' | 'delay_desc' | 'from_asc')}
              className="bg-[#10131c] border border-[#262c3d] focus:border-amber-500/60 rounded-lg pl-6 pr-1.5 py-1.5 text-[11px] text-gray-200 outline-none cursor-pointer"
              title="排序方式"
            >
              <option value="train_asc">車次編號</option>
              <option value="speed_desc">時速最高</option>
              <option value="delay_desc">延誤最長</option>
              <option value="from_asc">起站名稱</option>
            </select>
          </div>
        </div>

        {/* Scrollable List Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-1 min-h-0">
          {/* TOP: Collapsible 非服務中 Accordion (Collapsed by default) */}
          <div className="rounded-xl border border-[#272e3f] bg-[#121622] overflow-hidden">
            <button
              type="button"
              onClick={() => setViaNotInServiceOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#191f2f] transition-colors cursor-pointer"
              title={viaNotInServiceOpen ? '收合非服務中列車清單' : '展開非服務中列車清單'}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-200 border border-slate-600/60 shrink-0">
                  非服務中
                </span>
                <span className="text-xs font-semibold text-gray-100 truncate">
                  尚未發車 ({notDepartedCount}) / 已抵達 ({arrivedCount})
                </span>
              </div>
              <div className="flex items-center text-gray-400 shrink-0">
                {viaNotInServiceOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {viaNotInServiceOpen && (
              <div className="px-2.5 pb-2.5 pt-1 border-t border-[#212737] space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar bg-[#0e111a]">
                {filteredViaNotInService.length === 0 ? (
                  <div className="text-[11px] text-gray-500 py-3 text-center">沒有符合條件的非服務中列車</div>
                ) : (
                  filteredViaNotInService.map((train) => {
                    const isExpanded = Boolean(viaExpandedTrainIds[`nis_${train.id}`]);
                    const arrivedFlag = isTrainEffectivelyArrived(train);
                    const statusLabel = arrivedFlag ? '已抵達' : !train.departed ? '尚未發車' : '非服務中';
                    const statusCls = arrivedFlag
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-600/30 text-slate-300 border-slate-500/40';
                    const firstStop = train.times?.[0];
                    const depRaw = firstStop?.scheduled || firstStop?.estimated;
                    return (
                      <div
                        key={`nis_${train.id}`}
                        className="rounded-lg bg-[#151a26] border border-[#242b3c] p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-700 text-gray-100 shrink-0">
                              #{train.id}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${statusCls}`}>
                              {statusLabel}
                            </span>
                            <span className="text-gray-200 font-semibold truncate">
                              {formatPlaceTitle(train.from)} → {formatPlaceTitle(train.to)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setViaExpandedTrainIds((prev) => ({
                                ...prev,
                                [`nis_${train.id}`]: !prev[`nis_${train.id}`],
                              }))
                            }
                            className={`p-1 rounded-md border transition-colors shrink-0 cursor-pointer ${
                              isExpanded
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                : 'bg-[#1b2130] border-[#2a3245] text-gray-400 hover:text-amber-300 hover:border-amber-500/40'
                            }`}
                            title={isExpanded ? '收起時刻表' : '查看時刻表'}
                          >
                            <CalendarClock className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1 text-[10.5px] text-gray-400">
                          <span>班次日期：{train.instance || '—'}</span>
                          {isValidIso(depRaw) && (
                            <span className="font-mono">
                              預計出發：{formatDateTime(depRaw!, timeFormat, timeZone)}
                            </span>
                          )}
                        </div>
                        {isExpanded && renderStopsTable(train)}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* In Service Section Header */}
          <div className="flex items-center justify-between px-0.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-amber-300">行駛中列車 ({filteredViaInService.length})</span>
            </div>
          </div>

          {/* In Service Train Cards */}
          {!viaRailData && loadingViaRail ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
              <span className="text-xs">正在載入全加拿大 VIA Rail 即時列車動態...</span>
            </div>
          ) : paginatedViaInService.length === 0 ? (
            <div className="rounded-xl border border-[#23293a] bg-[#121622] py-10 px-4 text-center text-gray-400 space-y-1.5">
              <TramFront className="w-6 h-6 text-gray-600 mx-auto" />
              <div className="text-xs font-medium text-gray-300">
                {viaSearchQuery.trim() ? '找不到符合搜尋條件的行駛中列車' : '目前沒有正在行駛中的 VIA 列車'}
              </div>
              {filteredViaNotInService.length > 0 && (
                <div className="text-[11px] text-gray-500">
                  可展開上方「非服務中」清單查看 {filteredViaNotInService.length} 班尚未發車或已抵達班次
                </div>
              )}
            </div>
          ) : (
            paginatedViaInService.map((train) => {
              const isSelected = selectedViaTrainId === train.id;
              const isExpanded = Boolean(viaExpandedTrainIds[train.id]);
              const delayBadge = getDelayBadge(train.delay_min);
              const nextStop = train.next_stop;
              const nextTimeIso = isValidIso(nextStop?.estimated)
                ? nextStop!.estimated!
                : isValidIso(nextStop?.scheduled)
                  ? nextStop!.scheduled!
                  : null;
              const nextEtaZh = formatEtaZh(nextStop?.eta);
              return (
                <div
                  key={train.id}
                  className={`rounded-xl p-3 border transition-all space-y-2 ${
                    isSelected
                      ? 'bg-[#1c1d28] border-amber-400/80 ring-1 ring-amber-400/40 shadow-[0_0_16px_rgba(245,158,11,0.18)]'
                      : 'bg-[#171b26] border-[#252b3b] hover:border-amber-500/40'
                  }`}
                >
                  {/* Top Header Row: #ID + Status + Origin→Dest on same line */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold font-mono px-1.5 py-0.5 rounded bg-amber-600 text-white shadow-xs shrink-0">
                        <TramFront className="w-3 h-3" />
                        #{train.id}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${delayBadge.cls}`}>
                        {delayBadge.label}
                      </span>
                      <h4
                        className="text-xs font-bold text-white leading-snug truncate min-w-0"
                        title={`${formatPlaceTitle(train.from)} → ${formatPlaceTitle(train.to)}`}
                      >
                        {formatPlaceTitle(train.from)} → {formatPlaceTitle(train.to)}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setViaExpandedTrainIds((prev) => ({ ...prev, [train.id]: !prev[train.id] }))
                        }
                        className={`px-1.5 py-1 rounded-lg border text-[10.5px] font-mono font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                          isExpanded
                            ? 'bg-amber-500/25 border-amber-400/70 text-amber-200'
                            : 'bg-[#191f2e] hover:bg-[#222a3d] border-[#2a3347] text-amber-300'
                        }`}
                        title={isExpanded ? '收合停靠站時刻表' : '展開停靠站時刻表'}
                      >
                        <GitCommitHorizontal className="w-3.5 h-3.5" />
                        <span>{train.times?.length || 0}</span>
                      </button>

                      {train.has_gps && train.lat != null && train.lng != null && (
                        <button
                          type="button"
                          onClick={() => setSelectedViaTrainId(train.id)}
                          className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors cursor-pointer"
                          title="在地圖上定位此列車"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Live Telemetry Row */}
                  <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                    <div className="bg-[#0e121b] border border-[#1f2535] rounded-lg px-2 py-1 flex items-center justify-between gap-1 whitespace-nowrap">
                      <span className="text-[10px] text-gray-500">時速</span>
                      <span className="font-bold font-mono text-amber-200">
                        {train.speed != null ? `${Math.round(train.speed)} km/h` : '—'}
                      </span>
                    </div>
                    <div className="bg-[#0e121b] border border-[#1f2535] rounded-lg px-2 py-1 flex items-center justify-between gap-1 whitespace-nowrap min-w-0">
                      <span className="text-[10px] text-gray-500 shrink-0">航向</span>
                      <span className="font-bold font-mono text-gray-200 truncate">
                        {formatHeading(train.direction)}
                      </span>
                    </div>
                    <div className="bg-[#0e121b] border border-[#1f2535] rounded-lg px-2 py-1 flex items-center justify-between gap-1 whitespace-nowrap">
                      <span className="text-[10px] text-gray-500">進度</span>
                      <span className="font-bold font-mono text-emerald-300">
                        {train.stops_completed}/{train.stops_total} 站
                      </span>
                    </div>
                  </div>

                  {/* Next Stop Banner */}
                  {nextStop && (
                    <div className="bg-emerald-950/35 border border-emerald-500/25 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-emerald-400 font-semibold shrink-0">下一站</span>
                          <span className="font-bold text-gray-100 truncate">{nextStop.station}</span>
                          {nextStop.code && (
                            <span className="text-[9.5px] font-mono text-emerald-300/80 shrink-0">({nextStop.code})</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>
                            預計：{nextTimeIso ? formatDateTime(nextTimeIso, timeFormat, timeZone) : (nextEtaZh || '—')}
                          </span>
                          {nextEtaZh && nextTimeIso && (
                            <span className="text-amber-300 font-medium">({nextEtaZh})</span>
                          )}
                          {nextStop.platform && (
                            <span className="text-amber-300 font-semibold">月台 {nextStop.platform}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {isExpanded && renderStopsTable(train)}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination & Footer Summary */}
        <div className="pt-2.5 mt-2 border-t border-[#23293a] shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[11px]">
            <button
              type="button"
              disabled={viaPage <= 1}
              onClick={() => {
                const next = Math.max(1, viaPage - 1);
                setViaPage(next);
                setViaPageInput(String(next));
              }}
              className="px-2.5 py-1 rounded-md bg-[#181d2b] hover:bg-[#232a3e] disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 border border-[#2a3247] flex items-center gap-0.5 transition-colors cursor-pointer"
              title="上一頁"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一頁</span>
            </button>

            <div className="flex items-center gap-1 font-mono text-gray-300 px-1">
              <input
                type="text"
                inputMode="numeric"
                value={viaPageInput}
                onChange={(e) => setViaPageInput(e.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => commitViaPage(viaPageInput)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitViaPage(viaPageInput);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-10 text-center bg-[#10131c] border border-[#2a3247] focus:border-amber-500/70 rounded px-1 py-0.5 text-xs text-white outline-none"
                aria-label="輸入頁碼"
              />
              <span className="text-gray-500">/ {viaTotalPages}</span>
            </div>

            <button
              type="button"
              disabled={viaPage >= viaTotalPages}
              onClick={() => {
                const next = Math.min(viaTotalPages, viaPage + 1);
                setViaPage(next);
                setViaPageInput(String(next));
              }}
              className="px-2.5 py-1 rounded-md bg-[#181d2b] hover:bg-[#232a3e] disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 border border-[#2a3247] flex items-center gap-0.5 transition-colors cursor-pointer"
              title="下一頁"
            >
              <span>下一頁</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-[11px] text-gray-400 flex items-center justify-between px-0.5">
            <span>行駛中 {filteredViaInService.length} 班 · 非服務中 {filteredViaNotInService.length} 班</span>
            <span className="text-[10px] font-mono text-amber-400/80">VIA Rail Canada</span>
          </div>
        </div>
      </div>

      {/* VIA Rail Canada 官方路線地圖全螢幕燈箱視窗 */}
      {viaMapModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 pt-16 sm:pt-20 pb-4 animate-in fade-in duration-200 select-none"
          onClick={() => setViaMapModalOpen(false)}
        >
          <div
            className="relative max-w-6xl w-full bg-[#161922] border border-amber-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0 gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                  <TrainTrack className="w-4 h-4 text-amber-300" />
                </div>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    VIA Rail Canada 官方全國鐵路路線圖
                  </h4>
                  <span className="text-[11px] text-amber-300/90 truncate">
                    橫跨加拿大西岸溫哥華至東岸哈利法克斯 (2464×1090 高解析官方路線圖)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setViaMapZoom((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="縮小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViaMapZoom(1)}
                  className="px-2 py-1 rounded-lg text-[11px] font-mono text-amber-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="重設為 100%"
                >
                  {Math.round(viaMapZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setViaMapZoom((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <a
                  href="/via-rail-map.png"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-300 hover:bg-white/10 transition-colors cursor-pointer"
                  title="在新分頁開啟原始大圖"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setViaMapModalOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
                  title="關閉 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className={`relative flex-1 bg-white/95 overflow-auto p-3 flex min-h-[320px] ${viaMapZoom > 1 ? 'items-start justify-start' : 'items-center justify-center'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/via-rail-map.png"
                alt="VIA Rail Canada 官方路線地圖"
                style={{
                  width: `${Math.round(viaMapZoom * 100)}%`,
                  maxWidth: viaMapZoom <= 1 ? '100%' : 'none',
                }}
                className="h-auto object-contain rounded-lg shadow-xl transition-all duration-200 select-none"
              />
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 bg-[#1a1e29] border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400 shrink-0">
              <span>點擊上方放大／縮小按鈕可檢視各省支線與停靠車站細節</span>
              <span className="text-amber-400 font-mono text-[10.5px]">VIA Rail Canada</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
