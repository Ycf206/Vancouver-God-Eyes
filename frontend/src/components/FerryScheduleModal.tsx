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
  const { isFerryScheduleOpen, setFerryScheduleOpen, timeFormat } = useUIStore();
  const [selectedTerminal, setSelectedTerminal] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [sailings, setSailings] = useState<SailingItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSchedules = async () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    const codesToFetch = selectedTerminal === 'ALL' 
      ? ['TSA', 'SWB', 'HSB', 'DUK', 'NAN', 'LNG'] 
      : [selectedTerminal];

    const results: SailingItem[] = [];

    try {
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
              <p className="text-[11px] text-gray-400">
                即時開航時間、車位載車率與在途航行狀況 · 每 1 分鐘更新
                {lastUpdated && ` · ${lastUpdated.toLocaleTimeString()}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchSchedules}
              disabled={loading}
              className="p-1.5 px-2.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 transition-colors flex items-center gap-1.5 text-xs cursor-pointer font-medium disabled:opacity-50"
              title="重新整理班次"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">重新整理</span>
            </button>
            <a
              href="https://www.bcferries.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-gray-400 hover:text-sky-300 hover:bg-white/10 transition-colors"
              title="前往 BC Ferries 官方網頁"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={() => setFerryScheduleOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
              {/* Active / Upcoming Sailings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeSailings.map((s, idx) => {
                  const destNameEn = FERRY_TERMINAL_NAMES_EN[s.destination] || s.destination;
                  const fromNameEn = FERRY_TERMINAL_NAMES_EN[s.terminal_code] || s.terminal_code;
                  return (
                    <div 
                      key={`${s.terminal_code}-${s.time}-${idx}`}
                      className="p-3.5 rounded-xl bg-[#171b26] border border-gray-800/80 hover:border-sky-500/50 transition-all flex flex-col gap-2 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-base text-sky-400 font-mono">
                          {formatTimePreference(s.time, timeFormat)}
                          {s.arrival_time ? ` ➝ ${formatTimePreference(s.arrival_time, timeFormat)}` : ''}
                        </span>
                        <span className={`text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full ${
                          s.status === 'current'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}>
                          {s.status === 'current' ? '航行中' : '即將開航'}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="font-semibold text-white text-sm">
                          {s.vessel_name || 'BC Ferries 渡輪'}
                        </span>
                        <span className="text-xs text-sky-300 font-medium mt-0.5">
                          To: {destNameEn}
                        </span>
                        <span className="text-[11px] text-gray-400">
                          From: {fromNameEn}
                        </span>
                      </div>

                      {s.fill > 0 && (
                        <div className="pt-2 border-t border-gray-800/80">
                          <div className="flex justify-between items-center text-[11px] text-gray-400 mb-1">
                            <span>車位載車率 (Deck Space)</span>
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
                  <div className="p-3 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-gray-800/60">
                    {pastSailings.map((s, idx) => (
                      <div key={`past-${idx}`} className="p-2.5 rounded-lg bg-[#11141c] border border-gray-800/50 flex justify-between items-center text-xs text-gray-400">
                        <div>
                          <div className="font-mono text-gray-300 font-medium">
                            {formatTimePreference(s.time, timeFormat)}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {s.vessel_name} ➝ {FERRY_TERMINAL_NAMES_EN[s.destination] || s.destination}
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

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#121620] border-t border-gray-800 flex items-center justify-between text-xs shrink-0">
          <span className="text-gray-400 text-[11px]">
            資料來源：BC Ferries 卑詩渡輪官方即時系統
          </span>
          <button
            onClick={() => setFerryScheduleOpen(false)}
            className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors cursor-pointer text-xs"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
