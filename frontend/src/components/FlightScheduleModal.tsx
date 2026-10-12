'use client';

import React, { useState, useEffect } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { 
  X, Plane, PlaneTakeoff, PlaneLanding, Search, RefreshCw, 
  Clock, Calendar, ArrowRight
} from 'lucide-react';

interface FlightScheduleItem {
  id: string;
  flight_id?: string;
  flight_no: string;
  airline: string;
  category: string;
  is_domestic: boolean;
  flight_type?: 'arr' | 'dep';
  origin_code?: string;
  origin_name?: string;
  origin_city?: string;
  origin_coord?: [number, number];
  dest_code?: string;
  dest_name?: string;
  dest_city?: string;
  dest_coord?: [number, number];
  departure_time?: string;
  arrival_time?: string;
  date?: string;
  time: string;
  target_dt_iso?: string;
  city: string;
  terminal: string;
  gate: string;
  status: string;
  status_code: string;
  remaining_time?: string;
  remaining_code?: string;
  route_coords?: [number, number][];
}

interface ScheduleData {
  airport: string;
  airport_name: string;
  updated_at: string;
  total_arrivals: number;
  total_departures: number;
  source?: string;
  arrivals: FlightScheduleItem[];
  departures: FlightScheduleItem[];
}

export default function FlightScheduleModal() {
  const { isFlightScheduleOpen, setFlightScheduleOpen, searchTarget, setSearchTarget } = useUIStore();
  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('arrivals');
  const [filterType, setFilterType] = useState<'all' | 'domestic' | 'international'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Real-time tick every 10 seconds for dynamic countdown & auto-filtering past flights
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const fetchSchedules = () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/flights/schedules`)
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch flight schedules:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isFlightScheduleOpen) {
      fetchSchedules();
    }
  }, [isFlightScheduleOpen]);

  if (!isFlightScheduleOpen) return null;

  // Calculate live countdown and status dynamically against currentTime
  const getLiveFlightTiming = (flight: FlightScheduleItem) => {
    let targetMs: number | null = null;
    if (flight.target_dt_iso) {
      const parsed = new Date(flight.target_dt_iso).getTime();
      if (!isNaN(parsed)) {
        targetMs = parsed;
      }
    }

    const isArr = flight.flight_type === 'arr';

    if (!targetMs) {
      return {
        remainingText: flight.remaining_time || '--',
        liveStatusCode: flight.remaining_code || 'normal',
        isPast: flight.remaining_code === 'past',
        displayStatus: flight.status || '依時刻表排程',
        badgeType: 'sky'
      };
    }

    const diffMs = targetMs - currentTime;
    const diffMin = Math.round(diffMs / 60000);

    // Filter out past flights (> 15 minutes past)
    if (diffMin < -15) {
      return {
        remainingText: isArr ? '已降落' : '已起飛',
        liveStatusCode: 'past',
        isPast: true,
        displayStatus: isArr ? '已降落' : '已起飛',
        badgeType: 'gray'
      };
    }

    // Just arrived / departed (within 0 to -15 mins)
    if (diffMin < 0) {
      return {
        remainingText: isArr ? `剛降落 (${Math.abs(diffMin)}分前)` : `剛起飛 (${Math.abs(diffMin)}分前)`,
        liveStatusCode: 'active',
        isPast: false,
        displayStatus: isArr ? '已降落 (滑行中)' : '已離地 (航行中)',
        badgeType: 'emerald'
      };
    }

    // Imminent (0 to 10 mins)
    if (diffMin <= 10) {
      return {
        remainingText: isArr ? `即將降落 (${diffMin}分)` : `即將起飛 (${diffMin}分)`,
        liveStatusCode: 'urgent',
        isPast: false,
        displayStatus: isArr ? '進場降落中' : '最後登機 / 關艙',
        badgeType: 'amber'
      };
    }

    // Within 1 hour
    if (diffMin < 60) {
      return {
        remainingText: `剩餘 ${diffMin} 分鐘`,
        liveStatusCode: 'soon',
        isPast: false,
        displayStatus: flight.status || (isArr ? '航行中 (準點)' : '準備登機'),
        badgeType: 'sky'
      };
    }

    // More than 1 hour
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    const remStr = mins > 0 ? `剩餘 ${hours}時 ${mins}分` : `剩餘 ${hours} 小時`;

    return {
      remainingText: remStr,
      liveStatusCode: 'normal',
      isPast: false,
      displayStatus: flight.status || '準點',
      badgeType: 'sky'
    };
  };

  const currentList = activeTab === 'arrivals' ? (data?.arrivals || []) : (data?.departures || []);

  const filteredList = currentList.filter(item => {
    const timing = getLiveFlightTiming(item);
    // 過去超過 15 分鐘的航班不再顯示
    if (timing.isPast) return false;

    // Filter by domestic / international
    if (filterType === 'domestic' && !item.is_domestic) return false;
    if (filterType === 'international' && item.is_domestic) return false;

    // Filter by search (航班號、航空公司、城市、出發/目的代碼、登機門)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchNo = item.flight_no.toLowerCase().includes(q);
      const matchAirline = item.airline.toLowerCase().includes(q);
      const matchCity = item.city.toLowerCase().includes(q);
      const matchOrig = (item.origin_code || '').toLowerCase().includes(q);
      const matchDest = (item.dest_code || '').toLowerCase().includes(q);
      const matchGate = (item.gate || '').toLowerCase().includes(q);
      return matchNo || matchAirline || matchCity || matchOrig || matchDest || matchGate;
    }
    return true;
  });

  const handleFlightClick = (flight: FlightScheduleItem) => {
    const isDom = flight.is_domestic;
    const isDep = flight.flight_type === 'dep';

    let safeOriginCode = flight.origin_code;
    let safeDestCode = flight.dest_code;
    let safeOriginCity = flight.origin_city || flight.origin_name;
    let safeDestCity = flight.dest_city || flight.dest_name;

    if (!safeOriginCode && !safeDestCode) {
      safeOriginCode = isDep ? 'YVR' : (isDom ? 'YYC' : 'SEA');
      safeOriginCity = isDep ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
      safeDestCode = isDep ? (isDom ? 'YYC' : 'SEA') : 'YVR';
      safeDestCity = isDep ? (isDom ? '卡加利' : '西雅圖') : '溫哥華';
    } else if (safeOriginCode === safeDestCode || (safeOriginCode === 'YVR' && safeDestCode === 'YVR')) {
      if (isDep) {
        safeOriginCode = 'YVR';
        safeOriginCity = '溫哥華';
        safeDestCode = isDom ? 'YYC' : 'SEA';
        safeDestCity = isDom ? '卡加利' : '西雅圖';
      } else {
        safeOriginCode = isDom ? 'YYC' : 'SEA';
        safeOriginCity = isDom ? '卡加利' : '西雅圖';
        safeDestCode = 'YVR';
        safeDestCity = '溫哥華';
      }
    } else {
      if (!safeOriginCode) {
        safeOriginCode = safeDestCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
        safeOriginCity = safeOriginCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
      }
      if (!safeDestCode) {
        safeDestCode = safeOriginCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
        safeDestCity = safeDestCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
      }
    }

    const timing = getLiveFlightTiming(flight);

    const flightMeta = {
      ...flight,
      origin_code: safeOriginCode,
      dest_code: safeDestCode,
      origin_city: safeOriginCity,
      dest_city: safeDestCity,
      origin_name: flight.origin_name || safeOriginCity,
      dest_name: flight.dest_name || safeDestCity,
      departure_time: flight.departure_time,
      arrival_time: flight.arrival_time,
      remaining_time: timing.remainingText,
      status: timing.displayStatus || flight.status || '依時刻表排程',
    };

    setSearchTarget({
      id: flight.id,
      title: `${flight.flight_no} · ${flight.airline}`,
      subtitle: `${flight.city} (${flightMeta.status}) · ${flight.terminal} Gate ${flight.gate}`,
      category: 'flight_schedule',
      badge: flight.is_domestic ? '🇨🇦 國內航班' : '🌐 國際航班',
      icon: '✈️',
      lon: -123.1815,
      lat: 49.1967,
      zoom: 8,
      meta: flightMeta
    });
  };

  return (
    <div className="fixed top-[64px] right-2 sm:right-4 md:right-6 bottom-4 w-[96vw] sm:w-[94vw] md:w-[860px] lg:w-[980px] xl:w-[1060px] max-w-[calc(100vw-16px)] z-40 flex flex-col pointer-events-none animate-fade-in">
      <div 
        className="w-full h-full bg-[#13151a]/95 backdrop-blur-md border border-[#2b303c] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#242832] bg-gradient-to-r from-[#171b24] via-[#14161d] to-[#121419] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)]">
              <Plane className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">YVR 溫哥華國際機場航班資訊板</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                  即時表訂航線地圖 (FIDS)
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Flight Information Display System · Vancouver International Airport (CYVR)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSchedules}
              disabled={loading}
              className="p-2 rounded-xl bg-[#1b1f28] hover:bg-[#252a36] text-gray-300 hover:text-white transition-colors border border-[#2b313f] flex items-center gap-1.5 text-xs"
              title="重新整理航班"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
              <span className="hidden sm:inline">重新整理</span>
            </button>
            <button
              onClick={() => setFlightScheduleOpen(false)}
              className="p-2 rounded-xl bg-[#1b1f28] hover:bg-rose-500/20 hover:text-rose-400 text-gray-400 transition-colors border border-[#2b313f]"
              title="關閉看板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab & Filter Bar */}
        <div className="px-5 py-3 border-b border-[#21252e] bg-[#15171e] flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2.5">
            {/* Arrivals vs Departures */}
            <div className="flex items-center bg-[#101217] p-1 rounded-xl border border-[#252833]">
              <button
                onClick={() => setActiveTab('arrivals')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'arrivals'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneLanding className="w-4 h-4 text-emerald-400" />
                <span>抵達航班 (Arrivals)</span>
                {data && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                    {data.arrivals.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('departures')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'departures'
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneTakeoff className="w-4 h-4 text-amber-400" />
                <span>出發航班 (Departures)</span>
                {data && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                    {data.departures.length}
                  </span>
                )}
              </button>
            </div>

            {/* Quick Filters */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  filterType === 'all'
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setFilterType('domestic')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  filterType === 'domestic'
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                🇨🇦 國內線
              </button>
              <button
                onClick={() => setFilterType('international')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  filterType === 'international'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                🌐 國際線
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋航班號 (AC116, CX888, DLH476)、航空公司、機場代碼 (YYZ, NRT, MUC)、城市 (Toronto, Munich)、閘口..."
              className="w-full pl-10 pr-12 py-1.5 bg-[#0f1116] border border-[#262a35] rounded-xl text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2 text-gray-400 hover:text-gray-200 text-xs px-1"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {/* Wide Table Header (visible on md screens and up) */}
        <div className="hidden md:grid grid-cols-12 gap-3 px-6 py-2 bg-[#101217] border-b border-[#21252e] text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
          <div className="col-span-2 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-sky-400" />
            <span>日期 / 時間</span>
          </div>
          <div className="col-span-2">
            <span>航班 / 航空公司</span>
          </div>
          <div className="col-span-3">
            <span>起迄航線 (機場 · 城市)</span>
          </div>
          <div className="col-span-2">
            <span>航廈 / 登機閘口</span>
          </div>
          <div className="col-span-2">
            <span>實時動態倒數</span>
          </div>
          <div className="col-span-1 text-right">
            <span>狀態</span>
          </div>
        </div>

        {/* Flight Table / List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1e222a] p-2 sm:p-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c313d] [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
              <RefreshCw className="w-7 h-7 animate-spin text-sky-400" />
              <p className="text-sm font-medium">正在載入溫哥華國際機場官方排程時刻表 (FlightAware AeroAPI)...</p>
              <p className="text-xs text-gray-500">自動同步起迄城市、航廈閘口與動態預估時間</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
              <Plane className="w-10 h-10 text-gray-600 mb-1" />
              <p className="text-sm font-medium">目前無符合條件的即將或後續航班</p>
              <p className="text-xs text-gray-500">已自動過濾過往航班，您可點擊上方重新整理按鈕獲取最新資料</p>
            </div>
          ) : (
            filteredList.map((flight) => {
              const isSelected = searchTarget?.id === flight.id;
              const timing = getLiveFlightTiming(flight);
              const orig = flight.origin_code || (flight.flight_type === 'dep' ? 'YVR' : '--');
              const dest = flight.dest_code || (flight.flight_type === 'arr' ? 'YVR' : '--');
              const isArr = flight.flight_type === 'arr';

              // Badge styling for countdown
              let countdownBadgeClass = 'bg-sky-500/15 border-sky-500/30 text-sky-300';
              if (timing.badgeType === 'amber') {
                countdownBadgeClass = 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold animate-pulse';
              } else if (timing.badgeType === 'emerald') {
                countdownBadgeClass = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-bold';
              } else if (timing.badgeType === 'gray') {
                countdownBadgeClass = 'bg-gray-700/30 border-gray-600/40 text-gray-400';
              }

              return (
                <div
                  key={flight.id}
                  onClick={() => handleFlightClick(flight)}
                  className={`px-4 py-3 rounded-xl transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-sky-500/20 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)] ring-1 ring-sky-400/40'
                      : 'hover:bg-[#1a212e] hover:border-[#384152] border-transparent'
                  }`}
                >
                  {/* Grid Layout for Medium+ Screens */}
                  <div className="hidden md:grid grid-cols-12 gap-3 items-center">
                    {/* Col 1: Date & Time */}
                    <div className="col-span-2 flex items-center gap-2.5">
                      <div className="text-center w-14 py-1 px-1.5 rounded-lg bg-[#0e1015] border border-[#232732] shrink-0">
                        {flight.date && (
                          <div className="text-[10px] font-mono font-medium text-sky-400 leading-tight">
                            {flight.date}
                          </div>
                        )}
                        <div className="text-sm font-bold font-mono text-white tracking-tight leading-tight">
                          {flight.time}
                        </div>
                        <div className="text-[9px] text-gray-400 font-mono scale-90">
                          {isArr ? '預計抵達' : '預計出發'}
                        </div>
                      </div>
                    </div>

                    {/* Col 2: Flight No & Airline */}
                    <div className="col-span-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-sky-300 font-mono tracking-wide">{flight.flight_no}</span>
                        {flight.is_domestic ? (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0 font-medium">
                            🇨🇦 國內
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0 font-medium">
                            🌐 國際
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-300 truncate font-medium mt-0.5" title={flight.airline}>
                        {flight.airline}
                      </div>
                    </div>

                    {/* Col 3: Route & Cities */}
                    <div className="col-span-3 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-gray-200 font-medium">
                        <span className="font-mono font-bold text-white bg-[#101217] px-1.5 py-0.5 rounded border border-[#262a35]">{orig}</span>
                        <ArrowRight className="w-3 h-3 text-sky-400 shrink-0" />
                        <span className="font-mono font-bold text-white bg-[#101217] px-1.5 py-0.5 rounded border border-[#262a35]">{dest}</span>
                        <span className="text-gray-400 truncate text-[11px] ml-1">
                          ({flight.city.replace('➔', '至')})
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono mt-1 flex items-center gap-2">
                        {flight.departure_time && <span>起: <strong className="text-gray-300">{flight.departure_time}</strong></span>}
                        {flight.arrival_time && <span>· 抵: <strong className="text-gray-300">{flight.arrival_time}</strong></span>}
                      </div>
                    </div>

                    {/* Col 4: Terminal & Gate */}
                    <div className="col-span-2 min-w-0">
                      <div className="text-xs text-gray-300 font-medium truncate">
                        {flight.terminal}
                      </div>
                      <div className="text-xs font-mono text-amber-300 font-bold mt-0.5">
                        {flight.gate && flight.gate !== '--' ? `Gate ${flight.gate}` : '閘口未定'}
                      </div>
                    </div>

                    {/* Col 5: Live Countdown */}
                    <div className="col-span-2">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono ${countdownBadgeClass}`}>
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>{timing.remainingText}</span>
                      </div>
                    </div>

                    {/* Col 6: Status & Action */}
                    <div className="col-span-1 text-right">
                      <div className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-[#1a1c24] border border-[#292d3b] text-gray-200">
                        {timing.displayStatus}
                      </div>
                      <div className="text-[9px] text-sky-400 hover:text-sky-300 font-mono mt-1 flex items-center justify-end gap-0.5">
                        <span>繪製航線</span>
                        <span>➔</span>
                      </div>
                    </div>
                  </div>

                  {/* Mobile Compact Layout (< md screens) */}
                  <div className="flex md:hidden flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-center w-12 py-1 px-1 rounded-lg bg-[#0e1015] border border-[#232732] shrink-0">
                          {flight.date && <div className="text-[9px] font-mono text-sky-400">{flight.date}</div>}
                          <div className="text-xs font-bold font-mono text-white">{flight.time}</div>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-sky-300 font-mono">{flight.flight_no}</span>
                            <span className="text-xs text-gray-300 truncate max-w-[120px]">{flight.airline}</span>
                          </div>
                          <div className="text-[11px] text-gray-400 font-mono">
                            {orig} ➔ {dest} · {flight.terminal}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-mono ${countdownBadgeClass}`}>
                          <Clock className="w-3 h-3" />
                          <span>{timing.remainingText}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {timing.displayStatus}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-[#1e222a] text-gray-400 font-mono">
                      <span>起: {flight.departure_time} · 抵: {flight.arrival_time}</span>
                      <span className="text-amber-300 font-bold">Gate {flight.gate}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-[#21252e] bg-[#111318] text-[11px] text-gray-400 flex items-center justify-between shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span>📡 資料來源：{data?.source || 'FlightAware AeroAPI (官方即時航班計畫)'}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-400">系統即時倒數更新</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400 font-mono text-[10px]">
            <span>點擊任一班次可於大地圖上繪製精準大圓航線與起迄樞紐標籤</span>
          </div>
        </div>
      </div>
    </div>
  );
}
