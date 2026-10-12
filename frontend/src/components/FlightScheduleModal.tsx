'use client';

import React, { useState, useEffect } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { 
  X, Plane, PlaneTakeoff, PlaneLanding, Search, RefreshCw, 
  MapPin, Clock
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
  city: string;
  time: string;
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

  const currentList = activeTab === 'arrivals' ? (data?.arrivals || []) : (data?.departures || []);

  const filteredList = currentList.filter(item => {
    // 過去的航班不再顯示
    if (item.remaining_code === 'past') return false;

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
    // 航線排程地圖：定位溫哥華國際機場並在大地圖上繪製航線與端點標籤
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

    const flightMeta = {
      ...flight,
      origin_code: safeOriginCode,
      dest_code: safeDestCode,
      origin_city: safeOriginCity,
      dest_city: safeDestCity,
      origin_name: flight.origin_name || safeOriginCity,
      dest_name: flight.dest_name || safeDestCity,
      status: flight.status || '依時刻表排程',
    };

    setSearchTarget({
      id: flight.id,
      title: `${flight.flight_no} · ${flight.airline}`,
      subtitle: `${flight.city} (${flight.status}) · ${flight.terminal} Gate ${flight.gate}`,
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
    <div className="fixed top-[68px] right-3 sm:right-5 bottom-4 w-[380px] sm:w-[480px] max-w-[calc(100vw-24px)] z-40 flex flex-col pointer-events-none animate-fade-in">
      <div 
        className="w-full h-full bg-[#14161a]/95 backdrop-blur-md border border-[#2b303c] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#262a34] bg-gradient-to-r from-[#171b22] to-[#121418] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.2)]">
              <Plane className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">YVR 溫哥華國際機場</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                  排程航線地圖
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Flight Information Display System (FIDS) · CYVR / YVR
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSchedules}
              disabled={loading}
              className="p-2 rounded-lg bg-[#1f232b] hover:bg-[#2b313d] text-gray-300 hover:text-white transition-colors border border-[#2c323f]"
              title="重新整理航班"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              onClick={() => setFlightScheduleOpen(false)}
              className="p-2 rounded-lg bg-[#1f232b] hover:bg-rose-500/20 hover:text-rose-400 text-gray-400 transition-colors border border-[#2c323f]"
              title="關閉看板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab & Filter Bar */}
        <div className="px-5 pt-3 pb-2 border-b border-[#21252e] bg-[#16181f] flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Arrivals vs Departures */}
            <div className="flex items-center bg-[#111216] p-1 rounded-xl border border-[#262932]">
              <button
                onClick={() => setActiveTab('arrivals')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'arrivals'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneLanding className="w-3.5 h-3.5 text-emerald-400" />
                <span>抵達航班 (Arrivals)</span>
                {data && <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300">{data.arrivals.length}</span>}
              </button>
              <button
                onClick={() => setActiveTab('departures')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'departures'
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <PlaneTakeoff className="w-3.5 h-3.5 text-amber-400" />
                <span>出發航班 (Departures)</span>
                {data && <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300">{data.departures.length}</span>}
              </button>
            </div>

            {/* Quick Filters */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  filterType === 'all'
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                    : 'bg-[#181a20] border-[#262932] text-gray-400 hover:text-gray-200'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setFilterType('domestic')}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  filterType === 'domestic'
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-medium'
                    : 'bg-[#181a20] border-[#262932] text-gray-400 hover:text-gray-200'
                }`}
              >
                🇨🇦 國內線
              </button>
              <button
                onClick={() => setFilterType('international')}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  filterType === 'international'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-medium'
                    : 'bg-[#181a20] border-[#262932] text-gray-400 hover:text-gray-200'
                }`}
              >
                🌐 國際線
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋航班號 (AC64, CX888)、航空公司、代碼 (YYZ, NRT)、城市 (Toronto, Tokyo)..."
              className="w-full pl-9 pr-4 py-1.5 bg-[#101216] border border-[#262a34] rounded-xl text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2 text-gray-400 hover:text-gray-200 text-xs"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {/* Flight Table / List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1e222a] p-2 sm:p-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c313d] [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <p className="text-xs">正在連線 FlightAware AeroAPI 獲取溫哥華機場航班時刻排程與航線...</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <Plane className="w-8 h-8 text-gray-600" />
              <p className="text-xs">沒有找到符合條件的航班班次</p>
            </div>
          ) : (
            filteredList.map((flight) => {
              const isSelected = searchTarget?.id === flight.id;
              const orig = flight.origin_code || (flight.flight_type === 'dep' ? 'YVR' : '--');
              const dest = flight.dest_code || (flight.flight_type === 'arr' ? 'YVR' : '--');
              return (
                <div
                  key={flight.id}
                  onClick={() => handleFlightClick(flight)}
                  className={`p-3 rounded-xl transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/20 border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-sky-400/40'
                      : 'hover:bg-[#1a212e] hover:border-[#384152] border border-transparent'
                  }`}
                >
                  {/* Left: Time & Flight Details */}
                  <div className="flex items-center gap-3">
                    <div className="text-center shrink-0 w-12 py-1 rounded-lg bg-[#101216] border border-[#222630]">
                      <div className="text-sm font-bold font-mono text-white tracking-tight">{flight.time}</div>
                      <div className="text-[9px] text-gray-400 font-mono">預估</div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-sky-300 font-mono">{flight.flight_no}</span>
                        <span className="text-xs text-gray-300 font-medium truncate max-w-[140px] sm:max-w-none">
                          {flight.airline}
                        </span>
                        {flight.is_domestic ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                            🇨🇦 國內
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 border border-amber-500/30 text-amber-400">
                            🌐 國際
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                        <span className="flex items-center gap-1 text-gray-300 font-medium">
                          <MapPin className="w-3 h-3 text-sky-400 shrink-0" />
                          <span className="font-mono text-sky-200">{orig} ➔ {dest}</span>
                          <span>({flight.city})</span>
                        </span>
                        <span>·</span>
                        <span>{flight.terminal}</span>
                        <span>·</span>
                        <span className="font-mono text-gray-300">Gate {flight.gate}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Remaining Time & Status */}
                  <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                    {flight.remaining_time && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px] font-mono font-medium">
                        <Clock className="w-3 h-3 text-sky-400" />
                        <span>{flight.remaining_time}</span>
                      </div>
                    )}

                    <div className="text-right hidden md:block">
                      <div className="text-[9px] text-gray-400 hover:text-sky-300 font-mono">
                        繪製航線 ➔
                      </div>
                    </div>

                    <div className="px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 bg-[#181a20] border-[#292e3a] text-gray-300">
                      <span>{flight.status}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-[#21252e] bg-[#121418] text-[11px] text-gray-400 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span>📡 資料來源：{data?.source || 'FlightAware AeroAPI (官方即時航班計畫)'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400 font-mono">
            <span>YVR 航空樞紐</span>
          </div>
        </div>
      </div>
    </div>
  );
}
