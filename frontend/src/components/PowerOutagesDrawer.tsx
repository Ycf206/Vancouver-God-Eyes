'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ZapOff, Zap, TriangleAlert, ExternalLink, RefreshCw, X, Search, 
  Navigation, ArrowUpDown, Filter, ChevronLeft, ChevronRight,
  Clock, Users, AlertCircle, Wrench, Calendar as CalendarIcon, Info
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { formatDateTime } from '@/utils/time';

// Lucide calendar-arrow-right SVG component
export const CalendarArrowRight = ({ className = "w-4 h-4", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className} 
    {...props}
  >
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18" />
    <path d="m14 14 3 3-3 3" />
    <path d="M10 17h7" />
  </svg>
);

export interface RegionMessage {
  regionCodeName: string;
  postedDate?: number | string | null;
  updatedDate?: number | string | null;
  message: string;
}

export interface OutageItem {
  id: number | string;
  municipality?: string | null;
  area?: string | null;
  area_formatted?: string | null;
  cause?: string | null;
  numCustomersOut?: number | null;
  crewStatus?: string | null;
  crewStatusDescr?: string | null;
  crewEta?: number | string | null;
  dateOff?: number | string | null;
  dateOn?: number | string | null;
  lastUpdated?: number | string | null;
  regionName?: string | null;
  regionCodeName?: string | null;
  region_display_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  polygon?: number[];
  hasPolygon?: boolean;
}

const LOWERCASE_WORDS = new Set(['of', 'and', 'the', 'in', 'on', 'at', 'to', 'for', 'by', 'with']);

export function formatAreaTitleCase(text?: string | null): string {
  if (!text) return '';
  // 先清理 HTML 標籤 (若有)
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const formatted = clean.replace(/\b([A-Za-z]+)\b/g, (match) => {
    const lower = match.toLowerCase();
    if (LOWERCASE_WORDS.has(lower)) {
      return lower;
    }
    return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
  });
  if (formatted && formatted[0]) {
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }
  return formatted;
}

const OFFICIAL_URLS: Record<'current' | 'restored' | 'planned', string> = {
  current: 'https://www.bchydro.com/power-outages/app/outage-list.html',
  restored: 'https://www.bchydro.com/power-outages/app/outage-list-restored.html',
  planned: 'https://www.bchydro.com/power-outages/app/outage-list-planned.html',
};

export default function PowerOutagesDrawer() {
  const { 
    isPowerOutagesOpen, 
    setPowerOutagesOpen, 
    setLayers,
    timeFormat, 
    timeZone,
    selectedOutageId,
    setSelectedOutageId 
  } = useUIStore();

  const handleClose = () => {
    setPowerOutagesOpen(false);
    setLayers({ powerOutages: false });
  };

  const [activeTab, setActiveTab] = useState<'messages' | 'current' | 'restored' | 'planned'>('current');
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // 原始數據
  const [messages, setMessages] = useState<RegionMessage[]>([]);
  const [currentOutages, setCurrentOutages] = useState<OutageItem[]>([]);
  const [restoredOutages, setRestoredOutages] = useState<OutageItem[]>([]);
  const [plannedOutages, setPlannedOutages] = useState<OutageItem[]>([]);
  const [lastDataFetchTime, setLastDataFetchTime] = useState<Date | null>(null);

  // 搜尋與篩選狀態
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [selectedCause, setSelectedCause] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'customers_desc' | 'customers_asc' | 'date_desc' | 'date_asc' | 'updated_desc'>('customers_desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 15;

  // 取得數據端點
  const loadData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // 1. 抓取現正停電與地區警報 (current)
      const resCurrent = await fetch('/bchydro_outages_current.json?t=' + Date.now()).catch(() => null);
      if (resCurrent && resCurrent.ok) {
        const dataC = await resCurrent.json();
        if (dataC.messagesMap && typeof dataC.messagesMap === 'object') {
          const msgList: RegionMessage[] = Object.values(dataC.messagesMap);
          setMessages(msgList);
        }
        if (Array.isArray(dataC.all_outages)) {
          setCurrentOutages(dataC.all_outages);
        }
      }

      // 2. 抓取恢復供電 (restored)
      const resRestored = await fetch('/bchydro_outages_restored.json?t=' + Date.now()).catch(() => null);
      if (resRestored && resRestored.ok) {
        const dataR = await resRestored.json();
        if (Array.isArray(dataR.all_outages)) {
          setRestoredOutages(dataR.all_outages);
        }
      }

      // 3. 抓取預期停電 (planned)
      const resPlanned = await fetch('/bchydro_outages_planned.json?t=' + Date.now()).catch(() => null);
      if (resPlanned && resPlanned.ok) {
        const dataP = await resPlanned.json();
        if (Array.isArray(dataP.all_outages)) {
          setPlannedOutages(dataP.all_outages);
        }
      }

      setLastDataFetchTime(new Date());
    } catch (e) {
      console.error('[PowerOutagesDrawer] loadData failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isPowerOutagesOpen && currentOutages.length === 0) {
      loadData();
    }
  }, [isPowerOutagesOpen, currentOutages.length, loadData]);

  // 切換分頁時重設頁數
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, selectedRegion, selectedCause, sortBy]);

  // 當前停電數據列表
  const rawListForActiveTab = useMemo(() => {
    if (activeTab === 'current') return currentOutages;
    if (activeTab === 'restored') return restoredOutages;
    if (activeTab === 'planned') return plannedOutages;
    return [];
  }, [activeTab, currentOutages, restoredOutages, plannedOutages]);

  // 所有地區清單 (供篩選)
  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    rawListForActiveTab.forEach(item => {
      const reg = item.regionName || item.region_display_name;
      if (reg) set.add(reg);
    });
    return Array.from(set).sort();
  }, [rawListForActiveTab]);

  // 所有停電原因清單 (供篩選)
  const availableCauses = useMemo(() => {
    const set = new Set<string>();
    rawListForActiveTab.forEach(item => {
      if (item.cause) set.add(item.cause);
    });
    return Array.from(set).sort();
  }, [rawListForActiveTab]);

  // 篩選與排序邏輯 (嚴格排除經緯度等位置坐標進入搜尋匹配)
  const filteredAndSortedList = useMemo(() => {
    let result = rawListForActiveTab;

    // 1. 地區篩選
    if (selectedRegion !== 'ALL') {
      result = result.filter(item => (item.regionName || item.region_display_name) === selectedRegion);
    }

    // 2. 原因篩選
    if (selectedCause !== 'ALL') {
      result = result.filter(item => item.cause === selectedCause);
    }

    // 3. 搜尋過濾 (只搜尋行政區 municipality, 地區 area, 原因 cause, 區域名稱 regionName)
    // 嚴格規範：所有位置坐標 (latitude, longitude, polygon) 絕不納入搜尋！
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(item => {
        const muni = (item.municipality || '').toLowerCase();
        const area = (item.area || '').toLowerCase();
        const cause = (item.cause || '').toLowerCase();
        const reg = (item.regionName || item.region_display_name || '').toLowerCase();
        return muni.includes(q) || area.includes(q) || cause.includes(q) || reg.includes(q);
      });
    }

    // 4. 排序
    return [...result].sort((a, b) => {
      if (sortBy === 'customers_desc') {
        return (b.numCustomersOut || 0) - (a.numCustomersOut || 0);
      }
      if (sortBy === 'customers_asc') {
        return (a.numCustomersOut || 0) - (b.numCustomersOut || 0);
      }
      if (sortBy === 'date_desc') {
        const da = a.dateOff ? new Date(a.dateOff).getTime() : 0;
        const db = b.dateOff ? new Date(b.dateOff).getTime() : 0;
        return db - da;
      }
      if (sortBy === 'date_asc') {
        const da = a.dateOff ? new Date(a.dateOff).getTime() : 0;
        const db = b.dateOff ? new Date(b.dateOff).getTime() : 0;
        return da - db;
      }
      if (sortBy === 'updated_desc') {
        const ua = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
        const ub = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
        return ub - ua;
      }
      return 0;
    });
  }, [rawListForActiveTab, selectedRegion, selectedCause, searchQuery, sortBy]);

  // 分頁計算
  const totalItems = filteredAndSortedList.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const pagedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedList.slice(start, start + pageSize);
  }, [filteredAndSortedList, currentPage]);

  // 格式化日期與時間輔助函式
  const formatTime = (val?: number | string | null) => {
    if (!val) return null;
    try {
      const d = typeof val === 'number' ? new Date(val) : new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return formatDateTime(d, timeFormat, timeZone);
    } catch {
      return String(val);
    }
  };

  // Google 導航網址
  const getGoogleNavUrl = (lat?: number | null, lon?: number | null) => {
    if (!lat || !lon) return '#';
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  };

  // BC Hydro 地圖單一停電詳細網址
  const getBCHydroOutageMapUrl = (id?: number | string) => {
    if (!id) return 'https://www.bchydro.com/power-outages/app/outage-map.html';
    return `https://www.bchydro.com/power-outages/app/outage-map.html#outage=${id}`;
  };

  // 地圖跳轉定位
  const handleLocateOnMap = (item: OutageItem) => {
    if (item.latitude && item.longitude && !(item.latitude === 0 && item.longitude === 0)) {
      setSelectedOutageId(item.id);
      if (typeof window !== 'undefined' && (window as any).__godsEyeFlyTo) {
        (window as any).__godsEyeFlyTo(item.longitude, item.latitude, 14);
      }
    }
  };

  if (!isPowerOutagesOpen) return null;

  const officialUrl = activeTab !== 'messages' ? OFFICIAL_URLS[activeTab] : null;

  return (
    <div className="fixed top-[72px] right-4 z-40 w-[390px] sm:w-[460px] max-w-[calc(100vw-32px)] bg-[#141822]/95 backdrop-blur-md text-gray-100 rounded-2xl p-3.5 shadow-2xl border border-amber-500/30 flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
      
      {/* 頂部 Header */}
      <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0 gap-2">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 shadow-sm">
            <ZapOff className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate flex items-center gap-1.5">
              <span>卑詩省停電即時情況</span>
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-mono">
                {lastDataFetchTime 
                  ? `更新: ${formatDateTime(lastDataFetchTime, timeFormat, timeZone)}`
                  : '正在連接官方數據...'}
              </span>
            </div>
          </div>
        </div>

        {/* 右上方控制按鈕組 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 分頁官方網站圖示按鈕 */}
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-amber-400 p-1.5 rounded-lg hover:bg-amber-500/20 transition-colors"
              title="前往 BC Hydro 官方停電清單網頁"
            >
              <ExternalLink className="w-4 h-4 text-amber-400" />
            </a>
          )}

          {/* 重新整理按鈕 */}
          <button
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            className={`text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#252b3b] transition-colors cursor-pointer ${
              refreshing ? 'text-amber-400 animate-spin' : ''
            }`}
            title="重新整理停電資料"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* 關閉按鈕 */}
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-rose-500/20 hover:text-rose-400 transition-colors cursor-pointer"
            title="關閉界面"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4 個分頁導覽列 (Tabs) */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-[#10141d] border border-[#202736] rounded-xl shrink-0 mb-2.5 text-xs font-semibold">
        {/* 分頁 1: 地區警報 */}
        <button
          onClick={() => setActiveTab('messages')}
          className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
            activeTab === 'messages'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#181d2a]'
          }`}
        >
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span className="truncate">地區警報</span>
          {messages.length > 0 && (
            <span className="text-[9px] px-1 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-mono">
              {messages.length}
            </span>
          )}
        </button>

        {/* 分頁 2: 現正停電 */}
        <button
          onClick={() => setActiveTab('current')}
          className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
            activeTab === 'current'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#181d2a]'
          }`}
        >
          <ZapOff className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span className="truncate">現正停電</span>
          {currentOutages.length > 0 && (
            <span className="text-[9px] px-1 py-0.2 rounded-full bg-rose-500/30 text-rose-300 font-mono">
              {currentOutages.length}
            </span>
          )}
        </button>

        {/* 分頁 3: 恢復供電 */}
        <button
          onClick={() => setActiveTab('restored')}
          className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
            activeTab === 'restored'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#181d2a]'
          }`}
        >
          <Zap className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">恢復供電</span>
        </button>

        {/* 分頁 4: 預期停電 */}
        <button
          onClick={() => setActiveTab('planned')}
          className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
            activeTab === 'planned'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#181d2a]'
          }`}
        >
          <CalendarArrowRight className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span className="truncate">預期停電</span>
        </button>
      </div>

      {/* 分頁 1: 地區警報內容展示 */}
      {activeTab === 'messages' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
                <TriangleAlert className="w-8 h-8 text-amber-500/40 mb-2" />
                <p className="text-xs">目前全卑詩省各地區暫無緊急廣播警報。</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const posted = formatTime(msg.postedDate);
                const updated = formatTime(msg.updatedDate);
                // 去除可能夾帶的 HTML 標籤
                const cleanMessage = msg.message ? msg.message.replace(/<[^>]*>/g, '').trim() : '';

                return (
                  <div 
                    key={idx} 
                    className="bg-[#181d28] border border-amber-500/30 rounded-xl p-3 shadow-md flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between border-b border-[#252c3c] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                        <span className="font-bold text-sm text-white">{msg.regionCodeName}</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-400 space-y-0.5 font-mono">
                      {posted && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">發出日期:</span>
                          <span className="text-gray-300">{posted}</span>
                        </div>
                      )}
                      {updated && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500">更新日期:</span>
                          <span className="text-gray-300">{updated}</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-[#121620] border border-[#222a3a] rounded-lg p-2.5 text-xs text-amber-100/90 leading-relaxed break-words whitespace-pre-wrap">
                      {cleanMessage}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部總數 */}
          <div className="mt-2 pt-2 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
            <span>共有 {messages.length} 則地區警報</span>
          </div>
        </div>
      )}

      {/* 分頁 2, 3, 4: 停電清單展示 (附帶搜尋、篩選與排序) */}
      {activeTab !== 'messages' && (
        <div className="flex-1 flex flex-col min-h-0">
          
          {/* 搜尋列與工具列 (嚴格排除位置經緯度搜尋) */}
          <div className="shrink-0 space-y-2 mb-2">
            {/* 搜尋輸入框 */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋行政區、地區路段、停電原因..."
                className="w-full bg-[#10141d] border border-[#232c3d] focus:border-amber-500/60 rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 outline-none"
              />
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 篩選與排序工具列 */}
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {/* 地區篩選 */}
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="bg-[#10141d] border border-[#232c3d] rounded-lg px-2 py-1 text-gray-300 outline-none truncate"
                title="按地區篩選"
              >
                <option value="ALL">所有地區 ({availableRegions.length})</option>
                {availableRegions.map(reg => (
                  <option key={reg} value={reg}>{reg}</option>
                ))}
              </select>

              {/* 原因篩選 */}
              <select
                value={selectedCause}
                onChange={(e) => setSelectedCause(e.target.value)}
                className="bg-[#10141d] border border-[#232c3d] rounded-lg px-2 py-1 text-gray-300 outline-none truncate"
                title="按停電原因篩選"
              >
                <option value="ALL">所有原因</option>
                {availableCauses.map(cause => (
                  <option key={cause} value={cause}>{cause}</option>
                ))}
              </select>

              {/* 排序依據 */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-[#10141d] border border-[#232c3d] rounded-lg px-2 py-1 text-amber-300 font-medium outline-none truncate"
                title="排序方式"
              >
                <option value="customers_desc">受影響戶數 ↓</option>
                <option value="customers_asc">受影響戶數 ↑</option>
                <option value="date_desc">停電日期 (最新)</option>
                <option value="date_asc">停電日期 (最舊)</option>
                <option value="updated_desc">最後更新時間</option>
              </select>
            </div>
          </div>

          {/* 列表清單 (垂直滾動，寬度 100% 自適應，零橫向滾動條) */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full">
            {pagedList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
                <Info className="w-7 h-7 text-gray-500 mb-2" />
                <p className="text-xs">查無符合條件的停電記錄。</p>
              </div>
            ) : (
              pagedList.map((item) => {
                const areaTitle = item.area_formatted || formatAreaTitleCase(item.area);
                const hasCoordinates = !!(item.latitude && item.longitude && !(item.latitude === 0 && item.longitude === 0));
                const crewEtaFormatted = formatTime(item.crewEta);
                const dateOffFormatted = formatTime(item.dateOff);
                const dateOnFormatted = formatTime(item.dateOn);
                const lastUpdatedFormatted = formatTime(item.lastUpdated);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (activeTab === 'current') {
                        handleLocateOnMap(item);
                      }
                    }}
                    className={`bg-[#181d28] border rounded-xl p-3 shadow-md flex flex-col gap-2 transition-all duration-150 ${
                      activeTab === 'current' ? 'cursor-pointer hover:border-amber-400/60' : ''
                    } ${
                      selectedOutageId === item.id 
                        ? 'border-amber-400 bg-[#1d2331] ring-1 ring-amber-400/40' 
                        : 'border-[#262d3d] hover:border-[#38435a]'
                    }`}
                  >
                    {/* 卡片頂部：行政區、以及 (只有現正停電) 外部連結與導航按鈕組 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-white text-[13.5px] leading-tight">
                            {item.municipality || '卑詩省區域'}
                          </span>
                          {item.regionName && (
                            <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-gray-800 text-gray-300 font-mono">
                              {item.regionName}
                            </span>
                          )}
                        </div>

                        {/* 地區 area (格式化為每個英文單詞首字母大寫 Title Case) */}
                        {areaTitle && (
                          <p className="text-[11.5px] text-amber-200/90 font-medium leading-snug mt-1 break-words">
                            {areaTitle}
                          </p>
                        )}
                      </div>

                      {/* 只有 (2) 現正停電才顯示官方地圖連結與 Google 導航按鈕 */}
                      {activeTab === 'current' && (
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {/* BC Hydro 官方單一停電地圖連結 */}
                          <a
                            href={getBCHydroOutageMapUrl(item.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-amber-400 p-1.5 rounded-md hover:bg-amber-500/20 transition-colors"
                            title="前往 BC Hydro 官方停電地圖"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                          </a>

                          {/* 最右方 Google 導航按鈕 */}
                          {hasCoordinates && (
                            <a
                              href={getGoogleNavUrl(item.latitude, item.longitude)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-sky-400 p-1.5 rounded-md hover:bg-sky-500/20 transition-colors"
                              title="Google Maps 導航至此"
                            >
                              <Navigation className="w-3.5 h-3.5 text-sky-400" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 灰色區塊 (顯示原因、維修人員、停電時間、恢復時間、最後更新) */}
                    <div className="bg-[#121620] border border-[#222a3a] rounded-lg p-2.5 text-[11px] text-gray-300 space-y-1">
                      {/* 原因 cause */}
                      {item.cause && (
                        <div className="flex items-start gap-1.5">
                          <span className="text-gray-500 shrink-0">停電原因:</span>
                          <span className="text-gray-200 font-medium break-words">{item.cause}</span>
                        </div>
                      )}

                      {/* 受影響客戶 numCustomersOut */}
                      {item.numCustomersOut !== null && item.numCustomersOut !== undefined && (
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="text-gray-500 shrink-0">受影響戶數:</span>
                          <span className="text-amber-300 font-semibold">{item.numCustomersOut} 戶</span>
                        </div>
                      )}

                      {/* 維修人員 crewStatus 及 預計抵達 crewEta // 只有 (2) 現正停電才顯示 */}
                      {activeTab === 'current' && (item.crewStatus || item.crewStatusDescr || crewEtaFormatted) && (
                        <div className="flex items-start gap-1.5 font-mono">
                          <span className="text-gray-500 shrink-0">維修進度:</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(item.crewStatusDescr || item.crewStatus) && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                                {item.crewStatusDescr || item.crewStatus}
                              </span>
                            )}
                            {crewEtaFormatted && (
                              <span className="text-gray-400 text-[10.5px]">
                                預計抵達: {crewEtaFormatted}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 停電日期 dateOff */}
                      {dateOffFormatted && (
                        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                          <span className="text-gray-500 shrink-0">停電時間:</span>
                          <span className="text-gray-300">{dateOffFormatted}</span>
                        </div>
                      )}

                      {/* 恢復日期 dateOn // 只有 (3) 恢復供電 和 (4) 預期停電 才顯示 */}
                      {(activeTab === 'restored' || activeTab === 'planned') && dateOnFormatted && (
                        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                          <span className="text-gray-500 shrink-0">
                            {activeTab === 'restored' ? '恢復供電時間:' : '預計恢復時間:'}
                          </span>
                          <span className="text-emerald-400 font-medium">{dateOnFormatted}</span>
                        </div>
                      )}

                      {/* 最後更新 lastUpdated */}
                      {lastUpdatedFormatted && (
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-gray-500 pt-0.5 border-t border-[#1e2535]">
                          <span>最後更新:</span>
                          <span>{lastUpdatedFormatted}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 頁數選擇與分頁控制 (底部分頁列，參考探索-工作) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-[#232838] shrink-0 text-xs">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-2.5 py-1.5 rounded-lg bg-[#10131a] border border-[#232838] hover:bg-[#181d28] disabled:opacity-40 disabled:pointer-events-none text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>上一頁</span>
              </button>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 text-[11px]">前往</span>
                <select
                  value={currentPage}
                  onChange={(e) => setCurrentPage(Number(e.target.value))}
                  className="bg-[#10131a] text-xs font-semibold text-amber-300 border border-amber-500/40 rounded px-2 py-1 focus:outline-none cursor-pointer"
                >
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      第 {p} 頁
                    </option>
                  ))}
                </select>
                <span className="text-gray-500 text-[11px]">/ {totalPages} 頁</span>
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-[#10131a] border border-[#232838] hover:bg-[#181d28] disabled:opacity-40 disabled:pointer-events-none text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>下一頁</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 底部總數 (放到底部，參考探索-工作) */}
          <div className="mt-2 pt-2 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
            <span>共有 {totalItems} 宗{activeTab === 'current' ? '現正停電' : activeTab === 'restored' ? '已恢復供電' : '預期停電'}記錄</span>
          </div>
        </div>
      )}
    </div>
  );
}
