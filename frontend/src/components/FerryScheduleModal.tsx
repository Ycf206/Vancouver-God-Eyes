'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { formatTimePreference } from '@/utils/time';
import { 
  X, Ship, Search, RefreshCw, Calendar, ArrowRight, ExternalLink, Clock, Anchor
} from 'lucide-react';

interface SailingItem {
  destination: string;
  time: string;
  arrival_time?: string;
  vessel_name: string;
  status: string;
  fill: number;
  terminal_code: string;
}

const TERMINAL_FILTERS: Array<{ code: string; name_en: string; name_zh: string }> = [
  { code: 'ALL', name_en: 'All Terminals', name_zh: '全部碼頭' },
  { code: 'TSA', name_en: 'Tsawwassen', name_zh: '溫哥華 (Tsawwassen)' },
  { code: 'SWB', name_en: 'Swartz Bay', name_zh: '維多利亞 (Swartz Bay)' },
  { code: 'HSB', name_en: 'Horseshoe Bay', name_zh: '馬蹄灣 (Horseshoe Bay)' },
  { code: 'DUK', name_en: 'Duke Point', name_zh: '納奈莫 (Duke Point)' },
  { code: 'NAN', name_en: 'Departure Bay', name_zh: '納奈莫 (Departure Bay)' },
  { code: 'LNG', name_en: 'Langdale', name_zh: '陽光海岸 (Langdale)' },
];

const FERRY_TERMINAL_NAMES_EN: Record<string, string> = {
  'SWB': 'Swartz Bay (Victoria)',
  'TSA': 'Tsawwassen (Vancouver)',
  'HSB': 'Horseshoe Bay',
  'DUK': 'Duke Point (Nanaimo)',
  'NAN': 'Departure Bay (Nanaimo)',
  'LNG': 'Langdale (Sunshine Coast)',
  'BOW': 'Bowen Island',
  'FUL': 'Fulford Harbour',
  'SGI': 'Southern Gulf Islands',
  'PLH': 'Sturdies Bay',
  'POB': 'Otter Bay',
  'PSB': 'Village Bay',
  'PVB': 'Lyall Harbour',
  'PST': 'Long Harbour',
  'CMX': 'Comox',
  'PRR': 'Powell River',
};

export default function FerryScheduleModal() {
  const { isFerryScheduleOpen, setFerryScheduleOpen, setSearchTarget, timeFormat } = useUIStore();
  const [selectedTerminal, setSelectedTerminal] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [sailings, setSailings] = useState<SailingItem[]>([]);
  const [liveVessels, setLiveVessels] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSchedules = async () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    const codesToFetch = selectedTerminal === 'ALL' 
      ? ['TSA', 'SWB', 'HSB', 'DUK', 'NAN', 'LNG'] 
      : [selectedTerminal];

    const results: SailingItem[] = [];

    try {
      // Fetch live ferry vehicles concurrently
      fetch(`${apiUrl}/api/bcferries/vehicles`)
        .then(r => r.json())
        .then(vData => {
          if (Array.isArray(vData.vehicles)) setLiveVessels(vData.vehicles);
        })
        .catch(() => {});

      await Promise.all(
        codesToFetch.map(async (code) => {
          try {
            const res = await fetch(`${apiUrl}/api/ferries/terminals/${code}/schedule`);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.schedule)) {
                data.schedule.forEach((item: any) => {
                  results.push({
                    ...item,
                    terminal_code: code
                  });
                });
              }
            }
          } catch {
            // ignore individual terminal failure
          }
        })
      );

      // Sort by departure time
      results.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      setSailings(results);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFerryScheduleOpen) {
      fetchSchedules();
      const interval = setInterval(fetchSchedules, 60000);
      return () => clearInterval(interval);
    }
  }, [isFerryScheduleOpen, selectedTerminal]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFerryScheduleOpen) {
        setFerryScheduleOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFerryScheduleOpen, setFerryScheduleOpen]);

  const getMatchVessel = (sailing: SailingItem) => {
    const list = (typeof window !== 'undefined' && (window as any).__godsEyeFerryVehicles) || liveVessels;
    if (!list || !Array.isArray(list)) return null;
    return list.find(v => 
      (sailing.vessel_name && v.vessel_name && (
        v.vessel_name.toLowerCase().includes(sailing.vessel_name.toLowerCase()) ||
        sailing.vessel_name.toLowerCase().includes(v.vessel_name.toLowerCase())
      ))
    );
  };

  const calculateProgressAndEta = (s: SailingItem, matchVessel: any) => {
    if (matchVessel && matchVessel.progress !== undefined) {
      const prog = Math.min(100, Math.max(0, matchVessel.progress));
      let etaMins: number | null = null;
      if (matchVessel.arrival_time) {
        const parts = matchVessel.arrival_time.split(':');
        if (parts.length >= 2) {
          const arrH = parseInt(parts[0], 10);
          const arrM = parseInt(parts[1], 10);
          if (!isNaN(arrH) && !isNaN(arrM)) {
            const now = new Date();
            let diff = (arrH * 60 + arrM) - (now.getHours() * 60 + now.getMinutes());
            if (diff < 0) diff += 1440;
            if (diff >= 0 && diff <= 360) etaMins = diff;
          }
        }
      }
      return { progress: prog, etaMinutes: etaMins };
    }
    if (s.time && s.arrival_time && s.time.toLowerCase() !== 'variable' && s.arrival_time.toLowerCase() !== 'variable') {
      try {
        const parseTimeToMinutes = (tStr: string) => {
          const clean = tStr.trim().toLowerCase().replace('a.m.', 'am').replace('p.m.', 'pm');
          const isPm = clean.includes('pm');
          const isAm = clean.includes('am');
          const timePart = clean.replace(/[^0-9:]/g, '');
          const [hStr, mStr] = timePart.split(':');
          let h = parseInt(hStr, 10);
          const m = parseInt(mStr || '0', 10);
          if (isPm && h < 12) h += 12;
          if (isAm && h === 12) h = 0;
          return h * 60 + m;
        };
        const depM = parseTimeToMinutes(s.time);
        let arrM = parseTimeToMinutes(s.arrival_time);
        if (arrM < depM) arrM += 1440;
        const now = new Date();
        let nowM = now.getHours() * 60 + now.getMinutes();
        if (nowM < depM && (depM - nowM) > 720) nowM += 1440;
        if (nowM >= depM && nowM <= arrM) {
          const total = arrM - depM;
          const elapsed = nowM - depM;
          const prog = total > 0 ? Math.round((elapsed / total) * 100) : 50;
          const eta = arrM - nowM;
          return { progress: Math.min(100, Math.max(0, prog)), etaMinutes: eta };
        }
      } catch {}
    }
    return null;
  };

  const filteredSailings = useMemo(() => {
    let list = sailings;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(s => 
        (s.vessel_name && s.vessel_name.toLowerCase().includes(q)) ||
        (s.destination && s.destination.toLowerCase().includes(q)) ||
        (s.terminal_code && s.terminal_code.toLowerCase().includes(q)) ||
        ((FERRY_TERMINAL_NAMES_EN[s.destination] || '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [sailings, searchQuery]);

  const activeSailings = useMemo(() => filteredSailings.filter(s => s.status !== 'past'), [filteredSailings]);
  const pastSailings = useMemo(() => filteredSailings.filter(s => s.status === 'past'), [filteredSailings]);

  if (!isFerryScheduleOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl max-h-[88vh] bg-[#141822] border border-sky-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#1a202e] border-b border-gray-700/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0 shadow-sm">
              <Ship className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white text-base leading-snug flex items-center gap-2">
                <span>卑詩渡輪班次</span>
                <span className="text-xs font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20">
                  BC Ferries Schedule
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* 重新整理按鈕 (只保留圖示) */}
            <button
              onClick={fetchSchedules}
              disabled={loading}
              className="p-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 transition-colors flex items-center justify-center text-xs cursor-pointer disabled:opacity-50"
              title="重新整理班次"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <a
              href="https://www.bcferries.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-gray-400 hover:text-sky-300 hover:bg-white/10 transition-colors"
              title="前往 BC Ferries 官方網頁"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={() => setFerryScheduleOpen(false)}
              className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 bg-[#121620] border-b border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {/* Terminal Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
            {TERMINAL_FILTERS.map((t) => {
              const isActive = selectedTerminal === t.code;
              return (
                <button
                  key={t.code}
                  onClick={() => setSelectedTerminal(t.code)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-900/40'
                      : 'bg-[#1b202e] text-gray-400 hover:text-gray-200 hover:bg-[#252c3f]'
                  }`}
                >
                  <span>{t.name_en}</span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[200px] shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋船名或目的地..."
              className="w-full bg-[#1b202e] border border-gray-700/80 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto space-y-4 bg-black/40">
          {loading && sailings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-sm gap-3">
              <RefreshCw className="w-7 h-7 text-sky-400 animate-spin" />
              <span>正在向 BC Ferries 載入實時班次資料...</span>
            </div>
          ) : activeSailings.length === 0 && pastSailings.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm bg-[#161a24] rounded-xl border border-gray-800">
              目前無相符的渡輪班次資料。
            </div>
          ) : (
            <>
              {/* Active / Upcoming Sailings List (一行一行的清單) */}
              <div className="flex flex-col gap-2.5">
                {activeSailings.map((s, idx) => {
                  const destNameEn = FERRY_TERMINAL_NAMES_EN[s.destination] || s.destination;
                  const fromNameEn = FERRY_TERMINAL_NAMES_EN[s.terminal_code] || s.terminal_code;
                  const matchVessel = getMatchVessel(s);
                  const isCurrent = s.status === 'current' || Boolean(matchVessel);
                  const progInfo = calculateProgressAndEta(s, matchVessel);

                  const handleJump = () => {
                    if (matchVessel) {
                      setSearchTarget({
                        id: matchVessel.id,
                        title: matchVessel.vessel_name || s.vessel_name,
                        category: 'ferry_vehicle',
                        lon: matchVessel.lon,
                        lat: matchVessel.lat,
                        zoom: 13,
                        icon: 'ship'
                      });
                      if (typeof window !== 'undefined') {
                        const map = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                        if (map) {
                          map.flyTo({
                            center: [matchVessel.lon, matchVessel.lat],
                            zoom: 13,
                            duration: 1200,
                            essential: true
                          });
                        }
                        (window as any).__godsEyeSelectFerry?.(matchVessel);
                      }
                    }
                  };

                  return (
                    <div 
                      key={`${s.terminal_code}-${s.time}-${idx}`}
                      onClick={handleJump}
                      className={`p-3.5 rounded-xl bg-[#171b26] border border-gray-800/80 transition-all flex flex-col gap-2.5 shadow-sm ${
                        matchVessel ? 'hover:border-sky-400 hover:bg-[#1e2538] cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      {/* 上排：時間、渡輪名稱、狀態徽章 */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-bold text-base text-sky-400 font-mono tracking-tight">
                            {formatTimePreference(s.time, timeFormat)}
                            {s.arrival_time ? ` ➝ ${formatTimePreference(s.arrival_time, timeFormat)}` : ''}
                          </span>
                          <span className="font-bold text-white text-sm">
                            {s.vessel_name || 'BC Ferries 渡輪'}
                          </span>
                          {matchVessel && (
                            <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              在地圖在途中 (點擊跳轉)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${
                            isCurrent
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {isCurrent ? '航行中' : '即將開航'}
                          </span>
                        </div>
                      </div>

                      {/* 中排：美化出發點和目的地顯示風格 */}
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <div className="px-2.5 py-1 rounded-lg bg-[#11141c] border border-gray-700/60 text-gray-300 font-medium flex items-center gap-1.5 shadow-2xs">
                          <span className="text-[10px] text-gray-500 font-normal">出發</span>
                          <span className="font-semibold text-gray-200">{fromNameEn}</span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <div className="px-2.5 py-1 rounded-lg bg-sky-950/60 border border-sky-500/40 text-sky-300 font-semibold flex items-center gap-1.5 shadow-2xs">
                          <span className="text-[10px] text-sky-400/80 font-normal">抵達</span>
                          <span>{destNameEn}</span>
                        </div>
                      </div>

                      {/* 下排：航程進度、預計剩餘抵達時間與車位載車率 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-800/80 text-xs">
                        {/* 航程進度與剩餘抵達時間 */}
                        {progInfo ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center text-[11px] text-gray-400">
                              <span className="flex items-center gap-1">
                                <span>航程進度</span>
                                <span className="font-bold text-emerald-400">{progInfo.progress}%</span>
                              </span>
                              {progInfo.etaMinutes !== null && (
                                <span className="text-emerald-400 font-semibold">
                                  {progInfo.etaMinutes <= 0 ? '即將抵達' : `約 ${progInfo.etaMinutes} 分鐘抵達`}
                                </span>
                              )}
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                style={{ width: `${progInfo.progress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center text-[11px] text-gray-500">
                            <span>即將於開航後推估航程進度</span>
                          </div>
                        )}

                        {/* 車位載車率 (刪除英文 Deck Space) */}
                        {s.fill > 0 && (
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center text-[11px] text-gray-400">
                              <span>車位載車率</span>
                              <span className="font-mono font-bold text-gray-200">{s.fill}%</span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${s.fill >= 80 ? 'bg-amber-400' : 'bg-sky-500'}`}
                                style={{ width: `${Math.min(100, Math.max(0, s.fill))}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Collapsible Past Sailings */}
              {pastSailings.length > 0 && (
                <details className="group border border-gray-800/80 bg-[#151922] rounded-xl overflow-hidden mt-3">
                  <summary className="px-4 py-2.5 flex items-center justify-between text-xs text-gray-400 hover:text-white cursor-pointer select-none">
                    <span className="font-medium flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span>今日已抵達班次</span>
                      <span className="px-1.5 py-0.2 rounded bg-gray-800 text-[10px] font-mono text-gray-300">
                        {pastSailings.length}
                      </span>
                    </span>
                    <span className="text-[10px] text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-3 pt-0 flex flex-col gap-2 border-t border-gray-800/60">
                    {pastSailings.map((s, idx) => (
                      <div key={`past-${idx}`} className="p-2.5 rounded-lg bg-[#11141c] border border-gray-800/50 flex justify-between items-center text-xs text-gray-400">
                        <div>
                          <div className="font-mono text-gray-300 font-medium">
                            {formatTimePreference(s.time, timeFormat)}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {s.vessel_name} · {FERRY_TERMINAL_NAMES_EN[s.terminal_code] || s.terminal_code} ➝ {FERRY_TERMINAL_NAMES_EN[s.destination] || s.destination}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                          已抵達
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {/* Footer (刪除右下關閉文字) */}
        <div className="px-5 py-2.5 bg-[#121620] border-t border-gray-800 flex items-center justify-between text-xs shrink-0">
          <span className="text-gray-400 text-[11px]">
            資料來源：BC Ferries 卑詩渡輪官方即時系統 · 每 1 分鐘自動更新
          </span>
        </div>
      </div>
    </div>
  );
}
