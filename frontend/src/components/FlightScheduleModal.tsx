'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { formatTimePreference } from '@/utils/time';
import { 
  X, Plane, PlaneTakeoff, PlaneLanding, Search, RefreshCw, 
  ArrowRight, ChevronDown, ChevronUp, MapPin
} from 'lucide-react';

// Known airport coordinates dictionary for route drawing fallback
const AIRPORT_COORDS: Record<string, [number, number]> = {
  YVR: [-123.184444, 49.193889],
  CDG: [2.55, 49.0097],
  YXS: [-122.678, 53.883],
  SEA: [-122.3088, 47.4502],
  KEF: [-22.6056, 63.985],
  YYF: [-119.602, 49.463],
  YWL: [-122.054, 52.183],
  PVR: [-105.254, 20.68],
  YLW: [-119.378, 49.956],
  YEG: [-113.5797, 53.3097],
  YYC: [-114.02, 51.13],
  YYZ: [-79.63, 43.68],
  YUL: [-73.74, 45.47],
  SFO: [-122.375, 37.618],
  LAX: [-118.408, 33.942],
  HKG: [113.914, 22.308],
  NRT: [140.386, 35.764],
  HND: [139.78, 35.55],
  ICN: [126.45, 37.46],
  TPE: [121.23, 25.07],
  SYD: [151.177, -33.946],
  SIN: [103.99, 1.36],
  LHR: [-0.46, 51.47],
  OGG: [-156.43, 20.89],
  HNL: [-157.92, 21.31],
  CUN: [-86.87, 21.03],
  PHX: [-112.01, 33.43],
  ORD: [-87.90, 41.97],
  JFK: [-73.78, 40.64],
  SLC: [-111.97, 40.78],
  DEN: [-104.67, 39.86],
  DFW: [-97.04, 32.89],
  YYJ: [-123.42, 48.64],
  YQQ: [-124.88, 49.71]
};

// IANA Timezones for Origin/Destination Airports
const AIRPORT_TIMEZONES: Record<string, string> = {
  YVR: 'America/Vancouver',
  YYJ: 'America/Vancouver',
  YLW: 'America/Vancouver',
  YKA: 'America/Vancouver',
  YXS: 'America/Vancouver',
  YQQ: 'America/Vancouver',
  YYF: 'America/Vancouver',
  YWL: 'America/Vancouver',
  YPR: 'America/Vancouver',
  YXT: 'America/Vancouver',
  YYC: 'America/Edmonton',
  YEG: 'America/Edmonton',
  YQR: 'America/Regina',
  YXE: 'America/Regina',
  YWG: 'America/Winnipeg',
  YYZ: 'America/Toronto',
  YUL: 'America/Toronto',
  YOW: 'America/Toronto',
  YHZ: 'America/Halifax',
  YXY: 'America/Whitehorse',
  YZF: 'America/Yellowknife',
  SEA: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles',
  LAS: 'America/Los_Angeles',
  PHX: 'America/Phoenix',
  SLC: 'America/Denver',
  DEN: 'America/Denver',
  DFW: 'America/Chicago',
  IAH: 'America/Chicago',
  ORD: 'America/Chicago',
  MSP: 'America/Chicago',
  ATL: 'America/New_York',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  BOS: 'America/New_York',
  IAD: 'America/New_York',
  MCO: 'America/New_York',
  MIA: 'America/New_York',
  HNL: 'Pacific/Honolulu',
  OGG: 'Pacific/Honolulu',
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  CDG: 'Europe/Paris',
  FRA: 'Europe/Berlin',
  AMS: 'Europe/Amsterdam',
  DUB: 'Europe/Dublin',
  ZRH: 'Europe/Zurich',
  KEF: 'Atlantic/Reykjavik',
  NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo',
  ICN: 'Asia/Seoul',
  TPE: 'Asia/Taipei',
  HKG: 'Asia/Hong_Kong',
  PVG: 'Asia/Shanghai',
  PEK: 'Asia/Shanghai',
  CAN: 'Asia/Shanghai',
  SIN: 'Asia/Singapore',
  BKK: 'Asia/Bangkok',
  MNL: 'Asia/Manila',
  SYD: 'Australia/Sydney',
  AKL: 'Pacific/Auckland',
  MEX: 'America/Mexico_City',
  CUN: 'America/Cancun',
  PVR: 'America/Mexico_City',
  SJD: 'America/Hermosillo'
};

function formatInAirportTimezone(
  timeStr: string | undefined, 
  timeZone: string, 
  timeFormat: '12h' | '24h'
): string {
  if (!timeStr) return '--';
  try {
    let d: Date;
    if (timeStr.includes('T')) {
      if (timeStr.endsWith('Z') || timeStr.match(/[+-]\d\d:\d\d$/)) {
        d = new Date(timeStr);
      } else {
        d = new Date(`${timeStr}-07:00`);
      }
    } else {
      return formatTimePreference(timeStr, timeFormat);
    }
    if (isNaN(d.getTime())) {
      const parts = timeStr.split('T')[1]?.substring(0, 5) || timeStr;
      return formatTimePreference(parts, timeFormat);
    }
    return d.toLocaleTimeString('en-US', {
      timeZone: timeZone || 'America/Vancouver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h'
    });
  } catch {
    const parts = timeStr.includes('T') ? (timeStr.split('T')[1]?.substring(0, 5) || timeStr) : timeStr;
    return formatTimePreference(parts, timeFormat);
  }
}

interface MergedFlight {
  id: string;
  flight_number: string;
  airline: string;
  carrier?: string;
  type: 'A' | 'D';
  range: string; // 'T' | 'D' | 'I'
  city: string;
  airport_code: string;
  scheduled_time: string;
  estimated_time?: string;
  origin_departure_time?: string;
  dest_arrival_time?: string;
  desk_from?: string;
  desk_to?: string;
  gate?: string;
  carousel?: string;
  status: string;
  aircraft_type?: string;
  yvr_coords: [number, number];
  remote_coords?: [number, number] | null;
}

export default function FlightScheduleModal() {
  const { isFlightScheduleOpen, setFlightScheduleOpen, searchTarget, setSearchTarget, timeFormat } = useUIStore();
  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('arrivals');
  const [filterRange, setFilterRange] = useState<'all' | 'D' | 'T' | 'I'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [arrivals, setArrivals] = useState<MergedFlight[]>([]);
  const [departures, setDepartures] = useState<MergedFlight[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCompletedAccordion, setShowCompletedAccordion] = useState(false);

  const fetchFlights = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/airports/flights');
      if (res.ok) {
        const json = await res.json();
        if (json.arrivals) setArrivals(json.arrivals);
        if (json.departures) setDepartures(json.departures);
      } else {
        // Fallback to static cache
        const cacheRes = await fetch('/vancouver_yvr_flights.json');
        if (cacheRes.ok) {
          const json = await cacheRes.json();
          if (json.arrivals) setArrivals(json.arrivals);
          if (json.departures) setDepartures(json.departures);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch flights:', err);
      try {
        const cacheRes = await fetch('/vancouver_yvr_flights.json');
        if (cacheRes.ok) {
          const json = await cacheRes.json();
          if (json.arrivals) setArrivals(json.arrivals);
          if (json.departures) setDepartures(json.departures);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFlightScheduleOpen) {
      fetchFlights();
      const timer = setInterval(fetchFlights, 60000); // 1 min auto-refresh
      return () => clearInterval(timer);
    }
  }, [isFlightScheduleOpen]);

  // Format flight status text and colors
  const formatStatus = (statusStr?: string) => {
    if (!statusStr) return { text: '準點', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    const s = statusStr.trim();
    if (/arrived|已降落|已抵達/i.test(s)) return { text: '已抵達', color: 'text-gray-400 bg-gray-500/10 border-gray-500/30' };
    if (/departed|已起飛/i.test(s)) return { text: '已起飛', color: 'text-gray-400 bg-gray-500/10 border-gray-500/30' };
    if (/delayed|延誤/i.test(s)) return { text: '延誤', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    if (/cancelled|取消/i.test(s)) return { text: '已取消', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
    if (/early|提早/i.test(s)) return { text: '提早', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' };
    if (/boarding|登機中/i.test(s)) return { text: '登機中', color: 'text-cyan-300 bg-cyan-500/20 border-cyan-500/40 animate-pulse' };
    return { text: s, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  };

  // Determine if a flight is completed (arrived or departed)
  const isFlightCompleted = (f: MergedFlight) => {
    const s = (f.status || '').toLowerCase();
    if (f.type === 'A') {
      return s.includes('arrived') || s.includes('已抵達') || s.includes('已降落');
    }
    return s.includes('departed') || s.includes('已起飛');
  };

  // Progress Bar & Duration calculation
  const getFlightProgress = (f: MergedFlight) => {
    const depTimeStr = f.origin_departure_time || (f.type === 'D' ? f.estimated_time || f.scheduled_time : '');
    const arrTimeStr = f.dest_arrival_time || (f.type === 'A' ? f.estimated_time || f.scheduled_time : '');

    if (!depTimeStr || !arrTimeStr) {
      return { hasProgress: false, percent: 50, durationText: '--' };
    }

    const tDep = new Date(depTimeStr).getTime();
    const tArr = new Date(arrTimeStr).getTime();
    const now = Date.now();

    if (isNaN(tDep) || isNaN(tArr) || tArr <= tDep) {
      return { hasProgress: false, percent: 50, durationText: '--' };
    }

    const totalDurationMin = Math.round((tArr - tDep) / 60000);
    const durH = Math.floor(totalDurationMin / 60);
    const durM = totalDurationMin % 60;
    const durationText = durH > 0 ? `${durH}小時${durM}分` : `${durM}分`;

    if (now >= tArr) {
      return { hasProgress: true, percent: 100, durationText, isDone: true };
    }
    if (now <= tDep) {
      return { hasProgress: true, percent: 0, durationText, notStarted: true };
    }

    const elapsed = now - tDep;
    const pct = Math.min(100, Math.max(0, Math.round((elapsed / (tArr - tDep)) * 100)));
    return { hasProgress: true, percent: pct, durationText };
  };

  const currentRawList = activeTab === 'arrivals' ? arrivals : departures;

  // Filter list
  const filteredList = useMemo(() => {
    return currentRawList.filter(f => {
      if (filterRange !== 'all' && f.range !== filterRange) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mNo = (f.flight_number || '').toLowerCase().includes(q);
        const mAir = (f.airline || '').toLowerCase().includes(q);
        const mCity = (f.city || '').toLowerCase().includes(q);
        const mCode = (f.airport_code || '').toLowerCase().includes(q);
        const mGate = (f.gate || '').toLowerCase().includes(q);
        return mNo || mAir || mCity || mCode || mGate;
      }
      return true;
    });
  }, [currentRawList, filterRange, searchTerm]);

  // Separate upcoming and completed flights
  const upcomingFlights = useMemo(() => filteredList.filter(f => !isFlightCompleted(f)), [filteredList]);
  const completedFlights = useMemo(() => filteredList.filter(f => isFlightCompleted(f)), [filteredList]);

  // Draw Flight Route on Map
  const handleDrawRoute = (f: MergedFlight, e: React.MouseEvent) => {
    e.stopPropagation();
    const isArr = f.type === 'A';
    const isDom = f.range === 'D';

    const yvrCoords: [number, number] = [-123.184444, 49.193889];
    const remoteCode = (f.airport_code || '').toUpperCase();
    const remoteCoords: [number, number] = AIRPORT_COORDS[remoteCode] || (isDom ? [-114.02, 51.13] : [-122.3088, 47.4502]);

    const originCode = isArr ? remoteCode : 'YVR';
    const destCode = isArr ? 'YVR' : remoteCode;
    const originCoords = isArr ? remoteCoords : yvrCoords;
    const destCoords = isArr ? yvrCoords : remoteCoords;
    const originCity = isArr ? f.city : 'Vancouver';
    const destCity = isArr ? 'Vancouver' : f.city;

    setSearchTarget({
      id: f.id,
      title: `${f.flight_number} · ${f.airline}`,
      subtitle: `${f.city} (${f.status}) · Gate ${f.gate || '--'}`,
      category: 'flight_schedule',
      badge: f.range === 'D' ? '🇨🇦 國內線' : f.range === 'T' ? '🇺🇸 美加線' : '🌐 國際線',
      icon: '✈️',
      lon: (originCoords[0] + destCoords[0]) / 2,
      lat: (originCoords[1] + destCoords[1]) / 2,
      zoom: 6,
      meta: {
        id: f.id,
        flight_no: f.flight_number,
        airline: f.airline,
        is_domestic: isDom,
        flight_type: isArr ? 'arr' : 'dep',
        origin_code: originCode,
        dest_code: destCode,
        origin_city: originCity,
        dest_city: destCity,
        origin_coord: originCoords,
        dest_coord: destCoords,
        departure_time: isArr ? f.origin_departure_time : f.estimated_time || f.scheduled_time,
        arrival_time: isArr ? f.estimated_time || f.scheduled_time : f.dest_arrival_time,
        dep_dt_iso: isArr ? (f.origin_departure_time || f.scheduled_time) : (f.estimated_time || f.scheduled_time),
        arr_dt_iso: isArr ? (f.estimated_time || f.scheduled_time) : (f.dest_arrival_time || f.scheduled_time),
        target_dt_iso: f.estimated_time || f.scheduled_time,
        range: f.range,
        gate: f.gate,
        status: f.status
      }
    });

    // Close modal to view map route
    setFlightScheduleOpen(false);
  };

  const renderFlightRow = (flight: MergedFlight) => {
    const isArr = flight.type === 'A';
    const stStatus = formatStatus(flight.status);
    const prog = getFlightProgress(flight);
    const timeDisplay = flight.scheduled_time 
      ? formatTimePreference(flight.scheduled_time.split('T')[1]?.substring(0, 5) || flight.scheduled_time, timeFormat)
      : '--';

    const originCode = (isArr ? flight.airport_code : 'YVR').toUpperCase();
    const destCode = (isArr ? 'YVR' : flight.airport_code).toUpperCase();
    const originTz = AIRPORT_TIMEZONES[originCode] || 'America/Vancouver';
    const destTz = AIRPORT_TIMEZONES[destCode] || 'America/Vancouver';

    // 起飛時間:
    // 如果是抵達航班, 從Flightaware出得資料, 沒有資料可以只顯示抵達時間 (以出發地時區顯示)
    // 如果是出發航班, 用FlightEstimatedTime (以溫哥華時區顯示)
    const depDisplay = isArr 
      ? (flight.origin_departure_time 
          ? formatInAirportTimezone(flight.origin_departure_time, originTz, timeFormat) 
          : '--')
      : (flight.estimated_time 
          ? formatTimePreference(flight.estimated_time.split('T')[1]?.substring(0, 5) || flight.estimated_time, timeFormat) 
          : timeDisplay);

    // 抵達時間:
    // 如果是抵達航班, 用FlightEstimatedTime (以溫哥華時區顯示)
    // 如果是出發航班, 從Flightaware出得資料, 沒有資料可以只顯示出發時間 (以目的地時區顯示)
    const arrDisplay = isArr
      ? (flight.estimated_time 
          ? formatTimePreference(flight.estimated_time.split('T')[1]?.substring(0, 5) || flight.estimated_time, timeFormat) 
          : timeDisplay)
      : (flight.dest_arrival_time 
          ? formatInAirportTimezone(flight.dest_arrival_time, destTz, timeFormat) 
          : '--');

    const rangeLabel = flight.range === 'D' ? '國內' : flight.range === 'T' ? '美加' : '國際';
    const rangeColor = flight.range === 'D' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : flight.range === 'T' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

    return (
      <div 
        key={flight.id} 
        className="px-3 py-2.5 hover:bg-[#181c26] transition-colors border-b border-[#202532] text-xs flex flex-col gap-1.5"
      >
        <div className="grid grid-cols-12 gap-2 items-center">
          {/* 1. 時間 FlightScheduledTime */}
          <div className="col-span-1 text-center font-mono font-bold text-white text-xs">
            {timeDisplay}
          </div>

          {/* 2. 航班 + Range + 航空公司 */}
          <div className="col-span-2 min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sky-300 font-mono text-xs">{flight.flight_number}</span>
              <span className={`text-[9.5px] px-1 py-0.2 rounded border font-medium ${rangeColor}`}>
                {rangeLabel}
              </span>
            </div>
            <div className="text-[11px] text-gray-400 truncate mt-0.5" title={flight.airline}>
              {flight.airline}
            </div>
          </div>

          {/* 3. 航線 (Code -> Code & City -> City) */}
          <div className="col-span-2 min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-gray-200">
              <span>{isArr ? flight.airport_code : 'YVR'}</span>
              <ArrowRight className="w-3 h-3 text-sky-400 shrink-0" />
              <span>{isArr ? 'YVR' : flight.airport_code}</span>
            </div>
            <div className="text-[10px] text-gray-400 truncate mt-0.5">
              {isArr ? `${flight.city} → Vancouver` : `Vancouver → ${flight.city}`}
            </div>
          </div>

          {/* 4. 起飛時間 */}
          <div className="col-span-1 text-center font-mono text-[11px] text-gray-300">
            {depDisplay}
          </div>

          {/* 5. 抵達時間 */}
          <div className="col-span-1 text-center font-mono text-[11px] text-gray-300">
            {arrDisplay}
          </div>

          {/* 6. 進度條 + 總航程 */}
          <div className="col-span-2 px-1">
            <div className="flex items-center justify-between text-[9.5px] font-mono text-gray-400 mb-0.5">
              <span>航程</span>
              <span className="text-gray-300">{prog.durationText}</span>
            </div>
            <div className="w-full bg-[#1b202c] h-1.5 rounded-full overflow-hidden border border-[#2b3244]">
              <div 
                className="bg-gradient-to-r from-sky-400 to-emerald-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${prog.percent}%` }}
              />
            </div>
          </div>

          {/* 7. 櫃檯 (出發) / 閘口 / 行李 (抵達) */}
          <div className="col-span-1 text-center font-mono text-[10.5px] text-gray-300">
            {isArr ? (
              <span title="行李提取轉盤">{flight.carousel || '--'}</span>
            ) : (
              <span title="離境櫃檯">{flight.desk_from && flight.desk_to ? `${flight.desk_from}-${flight.desk_to}` : (flight.desk_from || '--')}</span>
            )}
          </div>

          <div className="col-span-1 text-center font-mono text-[11px] text-gray-200">
            {flight.gate || '--'}
          </div>

          {/* 8. 狀態 + 繪製航線按鈕 */}
          <div className="col-span-1 flex items-center justify-end gap-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-medium ${stStatus.color}`}>
              {stStatus.text}
            </span>
            <button
              onClick={(e) => handleDrawRoute(flight, e)}
              className="p-1 rounded bg-[#202737] hover:bg-sky-500/20 hover:text-sky-300 text-gray-400 border border-[#30394f] transition-colors"
              title="在地圖上繪製航線"
            >
              <MapPin className="w-3.5 h-3.5 text-sky-400" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!isFlightScheduleOpen) return null;

  return (
    <div className="fixed top-[64px] right-2 sm:right-4 md:right-6 bottom-4 w-[96vw] sm:w-[94vw] md:w-[960px] lg:w-[1080px] xl:w-[1180px] max-w-[calc(100vw-24px)] z-40 flex flex-col pointer-events-none animate-fade-in select-none">
      <div 
        className="w-full h-full bg-[#13151a]/95 backdrop-blur-md border border-[#2b303c] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[#242832] bg-gradient-to-r from-[#171b24] via-[#14161d] to-[#121419] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)]">
              <Plane className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">YVR 溫哥華國際機場航班資訊板</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchFlights}
              disabled={loading}
              className="p-2 rounded-xl bg-[#1b1f28] hover:bg-[#252a36] text-gray-300 hover:text-white transition-colors border border-[#2b313f] flex items-center justify-center text-xs"
              title="重新整理航班"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
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

        {/* Filters and Tabs */}
        <div className="px-5 py-2.5 border-b border-[#21252e] bg-[#15171e] flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2.5">
            {/* Arrivals vs Departures */}
            <div className="flex items-center bg-[#101217] p-1 rounded-xl border border-[#252833]">
              <button
                onClick={() => setActiveTab('arrivals')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'arrivals'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneLanding className="w-4 h-4 text-emerald-400" />
                <span>抵達航班</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                  {arrivals.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('departures')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'departures'
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneTakeoff className="w-4 h-4 text-amber-400" />
                <span>出發航班</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                  {departures.length}
                </span>
              </button>
            </div>

            {/* Range Filters: T / D / I */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => setFilterRange('all')}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  filterRange === 'all'
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setFilterRange('D')}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  filterRange === 'D'
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                🇨🇦 國內線 (D)
              </button>
              <button
                onClick={() => setFilterRange('T')}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  filterRange === 'T'
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                🇺🇸 美加線 (T)
              </button>
              <button
                onClick={() => setFilterRange('I')}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  filterRange === 'I'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-[#181a22] border-[#262933] text-gray-400 hover:text-gray-200'
                }`}
              >
                🌐 國際線 (I)
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋航班號、航空公司、目的地城市或登機門..."
              className="w-full pl-9 pr-12 py-1.5 bg-[#0f1116] border border-[#262a35] rounded-xl text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500 transition-colors"
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

        {/* Table Column Headers (Image 1 Layout) */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[#101217] border-b border-[#21252e] text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
          <div className="col-span-1 text-center">時間</div>
          <div className="col-span-2">航班 / 航空公司</div>
          <div className="col-span-2">航線</div>
          <div className="col-span-1 text-center">起飛時間</div>
          <div className="col-span-1 text-center">抵達時間</div>
          <div className="col-span-2 text-center">進度條 · 總航程</div>
          <div className="col-span-1 text-center">{activeTab === 'arrivals' ? '行李提取' : '離境櫃檯'}</div>
          <div className="col-span-1 text-center">閘口</div>
          <div className="col-span-1 text-right">狀態 · 航線</div>
        </div>

        {/* Flight Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1b1f2a] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c313d] [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading && arrivals.length === 0 && departures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
              <RefreshCw className="w-7 h-7 animate-spin text-sky-400" />
              <p className="text-sm font-medium">正在載入溫哥華國際機場官方排程時刻表...</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
              <Plane className="w-10 h-10 text-gray-600 mb-1" />
              <p className="text-sm font-medium">目前無符合條件的航班</p>
            </div>
          ) : (
            <>
              {/* 1. Upcoming Flights (Closest / Upcoming at Top) */}
              {upcomingFlights.map(flight => renderFlightRow(flight))}

              {/* 2. Collapsible Completed Flights (參考卑詩渡輪 BC Ferries) */}
              {completedFlights.length > 0 && (
                <div className="bg-[#0e1015]/90 border-t-2 border-[#222838]">
                  <button
                    onClick={() => setShowCompletedAccordion(v => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-gray-400 hover:text-gray-200 hover:bg-[#151924] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-300">
                        {activeTab === 'arrivals' ? '已抵達 / 已降落航班' : '已起飛 / 航行完畢航班'}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-gray-700/40 text-gray-400 font-mono">
                        {completedFlights.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-sky-400">
                      <span>{showCompletedAccordion ? '收合' : '展開檢視'}</span>
                      {showCompletedAccordion ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {showCompletedAccordion && (
                    <div className="opacity-75 divide-y divide-[#1b1f2a]">
                      {completedFlights.map(flight => renderFlightRow(flight))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
