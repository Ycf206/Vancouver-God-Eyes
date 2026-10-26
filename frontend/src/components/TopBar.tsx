'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Settings, ChevronDown, Map as MapIcon, X, Loader2, Layers, AlertCircle, Heart, Download, History, User, MoreHorizontal } from 'lucide-react';
import { useUIStore, SearchTarget, UIState } from '@/store/useUIStore';
import ReportIssueModal from '@/components/ReportIssueModal';
import DonateModal from '@/components/DonateModal';
import SettingsModal from '@/components/SettingsModal';
import ExplorePanel from '@/components/ExplorePanel';
import ExportModal from '@/components/ExportModal';
import ChangelogModal from '@/components/ChangelogModal';
import AuthModal from '@/components/AuthModal';
import { getApiUrl } from '@/utils/api';
import { formatClock, formatDateWithTimezone } from '@/utils/time';

export default function TopBar() {
  const { 
    setSearchTarget, 
    enableLayer, 
    disableLayer,
    layers,
    autoEnabledSearchLayer,
    setAutoEnabledSearchLayer,
    isLayerPanelOpen, 
    toggleLayerPanel,
    timeFormat,
    timeZone,
    setSettingsModalOpen,
    isExportModalOpen,
    setExportModalOpen
  } = useUIStore();
  const [time, setTime] = useState<Date | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isDonateModalOpen, setIsDonateModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // 搜尋狀態
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchTarget[]>([]);
  const [displayLimit, setDisplayLimit] = useState(40);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const searchCacheRef = useRef<Map<string, SearchTarget[]>>(new Map());

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 點擊外部關閉選單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 搜尋防抖 (Debounce) 與快顯快取
  useEffect(() => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    // 0ms 快取命中：已搜尋過的字詞立即呈現建議清單
    if (searchCacheRef.current.has(trimmed)) {
      setResults(searchCacheRef.current.get(trimmed)!);
      setDisplayLimit(40);
      setIsLoading(false);
      setIsOpen(true);
      return;
    }

    setIsLoading(true);
    const apiUrl = getApiUrl();
    
    const handler = setTimeout(() => {
      fetch(`${apiUrl}/api/search?q=${encodeURIComponent(trimmed)}`)
        .then(res => res.json())
        .then(data => {
          const list = Array.isArray(data) ? data : (data.results || []);
          searchCacheRef.current.set(trimmed, list);
          setResults(list);
          setDisplayLimit(40);
          setIsLoading(false);
          setIsOpen(true);
        })
        .catch(err => {
          console.error('Search error:', err);
          setIsLoading(false);
        });
    }, 150);

    return () => clearTimeout(handler);
  }, [query]);

  const handleSelect = (target: SearchTarget) => {
    isSelectingRef.current = true;
    // 巴士路線為獨立搜尋展示，不自動開啟全域靜態巴士路線圖層
    if (target.layer_key && target.category !== 'bus_route') {
      const lk = target.layer_key as keyof UIState['layers'];
      // 若原圖層未開啟，記錄之以便清除搜尋列時自動還原為關閉狀態
      if (lk && !layers[lk]) {
        setAutoEnabledSearchLayer(lk);
        enableLayer(lk);
      } else {
        setAutoEnabledSearchLayer(null);
      }
    } else {
      setAutoEnabledSearchLayer(null);
    }
    setSearchTarget(target);
    setQuery(target.title);
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setSearchTarget(null);
    if ((window as any).__godsEyeDismissPopup) {
      (window as any).__godsEyeDismissPopup();
    }
    if (autoEnabledSearchLayer) {
      disableLayer(autoEnabledSearchLayer);
      setAutoEnabledSearchLayer(null);
    }
  };

  const formatTime = (date: Date) => {
    return formatClock(date, timeFormat, timeZone);
  };

  const formatDate = (date: Date) => {
    return formatDateWithTimezone(date, timeZone);
  };

  return (
    <div className="fixed top-0 left-0 w-full h-[60px] bg-[#1a1b1e] border-b border-[#2d2e32] flex items-center px-4 z-50 text-white shadow-lg">
      
      {/* 標誌區域 */}
      <div className="flex flex-col justify-center mr-3 select-none shrink-0">
        <span className="text-[11px] font-bold text-emerald-400 tracking-wider leading-none mb-1">溫哥華</span>
        <span className="text-sm font-extrabold leading-none tracking-widest text-white">上帝之眼</span>
      </div>

      {/* 圖層控制切換按鈕 (便於一鍵展開/收合左側欄) */}
      <button 
        onClick={toggleLayerPanel}
        className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs font-medium transition-all mr-1 shrink-0 ${
          isLayerPanelOpen 
            ? 'bg-[#25262b] border-[#373a40] text-gray-300 hover:text-white hover:bg-[#2c2d33]' 
            : 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/25 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
        }`}
        title={isLayerPanelOpen ? '收合左側圖層面板' : '展開左側圖層面板'}
      >
        <Layers className="w-3.5 h-3.5 text-emerald-500" />
        <span className="hidden sm:inline">圖層</span>
      </button>

      <div className="h-8 w-px bg-gray-700/60 mx-2"></div>

      {/* 時間與狀態 */}
      <div className="hidden md:flex flex-col justify-center mx-1.5 shrink-0">
        {time ? (
          <>
            <span className="text-[21px] font-mono font-medium leading-none mb-1 tracking-wider text-gray-100">
              {formatTime(time)}
            </span>
            <span className="text-[10px] text-emerald-500 font-medium leading-none flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]"></span>
              {formatDate(time)}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-500">載入中...</span>
        )}
      </div>

      {/* 區域選擇 (緊貼左方日期時間) */}
      <button className="hidden sm:flex items-center gap-1.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] px-3 h-9 rounded-md ml-2.5 text-xs sm:text-sm transition-colors text-gray-200 font-medium shadow-sm shrink-0">
        <MapIcon className="w-3.5 h-3.5 text-gray-400" />
        <span>大溫哥華</span>
        <ChevronDown className="w-3 h-3 text-gray-400 ml-1" />
      </button>

      {/* 搜尋列 (緊隨大溫地區) */}
      <div ref={searchContainerRef} className="relative flex-1 max-w-[650px] ml-2.5 mr-3 sm:mr-4">
        <div className="flex items-center bg-[#25262b] border border-[#373a40] rounded-md px-3 h-9 focus-within:border-emerald-500/70 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all shadow-inner">
          <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
          <input 
            type="text" 
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (val.trim() === '') {
                handleClear();
              } else {
                setIsOpen(true);
              }
            }}
            onFocus={() => {
              if (results.length > 0 || query.trim()) setIsOpen(true);
            }}
            placeholder="搜尋" 
            className="bg-transparent text-sm text-white w-full focus:outline-none placeholder:text-gray-500"
          />
          {isLoading && (
            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin mr-1 shrink-0" />
          )}
          {query && (
            <button 
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-200 p-0.5 rounded transition-colors ml-1"
              title="清除搜尋"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 搜尋下拉選單 (Dropdown Results) */}
        {isOpen && query.trim().length > 0 && (
          <div className="absolute top-[44px] left-0 w-full bg-[#1e2025]/95 backdrop-blur-md border border-[#373a40] rounded-lg shadow-2xl overflow-hidden z-[100] max-h-[460px] max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#2d2e34] bg-[#191a1e]/80 text-[11px] text-gray-400 shrink-0">
              <span>圖層項目搜尋結果</span>
              <span>{results.length} 筆項目</span>
            </div>

            <div 
              onScroll={(e) => {
                const target = e.currentTarget;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
                  setDisplayLimit(prev => Math.min(prev + 40, results.length));
                }
              }}
              className="overflow-y-auto flex-1 min-h-0 divide-y divide-[#2a2c33]/60 py-1 [scrollbar-width:thin] [scrollbar-color:#4a4d57_transparent]"
            >
              {results.length > 0 ? (
                <>
                  {results.slice(0, displayLimit).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#2c2f38] transition-colors flex items-center gap-3 group"
                    >
                      <span className="text-base flex-shrink-0 w-7 h-7 flex items-center justify-center bg-[#282a30] rounded border border-gray-700/50 group-hover:scale-110 transition-transform">
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-100 group-hover:text-white truncate">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-gray-400 truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border flex-shrink-0 ${
                        item.category === 'bus_route' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60 font-bold' :
                        item.category === 'skytrain' ? 'bg-sky-950/80 text-sky-400 border-sky-800/60' :
                        item.category === 'ferry_terminal' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                        item.category === 'seabus' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'fire_halls' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                        item.category === 'police' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60 font-bold' :
                        item.category === 'hospitals' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' :
                        item.category === 'disaster_hubs' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'fuel' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'tesla' ? 'bg-red-950/80 text-red-300 border-red-800/60 font-bold' :
                        item.category === 'impark' ? 'bg-red-950/80 text-red-300 border-red-800/60 font-semibold' :
                        item.category === 'aed' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                        item.category === 'car_sharing' ? 'bg-sky-950/80 text-sky-300 border-sky-800/60' :
                        item.category === 'postal_code_fsa' ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60 font-bold' :
                        item.category === 'local_area_boundary' ? 'bg-teal-950/80 text-teal-300 border-teal-800/60' :
                        item.category === 'bikeways' ? 'bg-teal-950/80 text-teal-300 border-teal-800/60' :
                        item.category === 'traffic_crosswalks' ? 'bg-yellow-950/80 text-yellow-300 border-yellow-800/60' :
                        item.category === 'litter_containers' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'public_art' ? 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-800/60 font-semibold' :
                        item.category === 'motorcycle_parking' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60 font-semibold' :
                        item.category === 'community_centres' ? 'bg-violet-950/80 text-violet-300 border-violet-800/60' :
                        item.category === 'museums' ? 'bg-slate-800 text-slate-200 border-slate-600 font-semibold' :
                        item.category === 'canada_post' ? 'bg-red-950/80 text-red-300 border-red-800/60' :
                        item.category === 'atm' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        (item.category === 'turn_restrictions' || item.category === 'traffic_turn_restrictions') ? 'bg-rose-950/80 text-rose-300 border-rose-800/60 font-semibold' :
                        item.category === 'traffic_signals' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'truck_routes' ? 'bg-sky-950/80 text-sky-300 border-sky-800/60' :
                        item.category === 'garbage_collection' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60' :
                        item.category === 'escooter' ? 'bg-lime-950/80 text-lime-300 border-lime-800/60' :
                        item.category === 'ev_charging' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' :
                        item.category === 'schools' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                        item.category === 'libraries' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        item.category === 'food_vendors' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60' :
                        item.category === 'homeless_shelters' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                        'bg-gray-800 text-gray-300 border-gray-700'
                      }`}>
                        {item.badge}
                      </span>
                    </button>
                  ))}
                  {results.length > displayLimit && (
                    <div className="text-center py-2 text-[10.5px] text-gray-400 bg-[#16171a]/50">
                      向下滾動載入更多項目 ({displayLimit} / {results.length})
                    </div>
                  )}
                </>
              ) : (
                !isLoading && (
                  <div className="py-6 px-4 text-center text-xs text-gray-400">
                    查無相符圖層項目（可搜尋巴士路線、站名、碼頭名、地址、設施名）
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右側按鈕組：桌面版直接展開按鈕；手機版收合為 ⋯ 快捷功能表 */}
      <div className="relative flex items-center gap-1 sm:gap-2 shrink-0">
        {/* 手機版 ⋯ 更多選單按鈕 (參考圖片 5) */}
        <div className="sm:hidden relative">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex items-center justify-center w-9 h-9 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] rounded-md text-gray-300 hover:text-white transition-colors"
            title="更多功能選單"
          >
            <MoreHorizontal className="w-5 h-5 text-gray-300" />
          </button>

          {isMobileMenuOpen && (
            <div 
              className="absolute right-0 top-11 z-[60] w-48 bg-[#1a1c22]/98 backdrop-blur-md border border-[#373a40] rounded-xl shadow-2xl py-1 text-xs flex flex-col divide-y divide-[#2a2d36] animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="py-1">
                <button
                  onClick={() => { setExportModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Download className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>匯出純淨地圖/圖資</span>
                </button>
                <button
                  onClick={() => { setIsDonateModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Heart className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>贊助支持我們</span>
                </button>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { setIsChangelogModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <History className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>系統更新日誌</span>
                </button>
                <button
                  onClick={() => { setIsReportModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>回報問題與建議</span>
                </button>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { setSettingsModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>系統偏好設定</span>
                </button>
                <button
                  onClick={() => { setIsAuthModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <User className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>會員登入帳號</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 桌面版直接平排顯示 6 大功能按鈕 */}
        <div className="hidden sm:flex items-center gap-2">

        {/* 匯出按鈕 (位於探索按鈕右方) */}
        <button 
          onClick={() => setExportModalOpen(true)}
          className={`flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border rounded-md transition-all shadow-sm text-xs font-semibold select-none ${
            isExportModalOpen 
              ? 'border-cyan-500/80 text-cyan-400 bg-[#2c2d33]' 
              : 'border-[#373a40] text-gray-300 hover:border-cyan-500/50 hover:text-cyan-400'
          }`}
          title="匯出純淨地圖截圖、向量圖資或試算表表格"
        >
          <Download className="w-4 h-4 text-cyan-400/80 group-hover:text-cyan-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            匯出
          </span>
        </button>

        {/* 贊助支持按鈕 (愛心圖示，位於回報問題左側) */}
        <button 
          onClick={() => setIsDonateModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-rose-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-rose-400 text-xs font-semibold select-none" 
        >
          <Heart className="w-4 h-4 text-rose-400/80 group-hover:text-rose-400 group-hover:scale-110 transition-transform fill-rose-500/20 shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            贊助
          </span>
        </button>

        {/* 更新日誌按鈕 (位於回報問題左方) */}
        <button 
          onClick={() => setIsChangelogModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-sky-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-sky-400 text-xs font-semibold select-none" 
          title="系統更新日誌"
        >
          <History className="w-4 h-4 text-sky-400/80 group-hover:text-sky-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            更新日誌
          </span>
        </button>

        {/* 回報問題按鈕 */}
        <button 
          onClick={() => setIsReportModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-amber-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-amber-400 text-xs font-semibold select-none" 
        >
          <AlertCircle className="w-4 h-4 text-amber-400/80 group-hover:text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[100px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            回報問題
          </span>
        </button>



        {/* 設定按鈕 (點擊開啟設定版面) */}
        <button 
          onClick={() => setSettingsModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-emerald-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-emerald-400 text-xs font-semibold select-none" 
        >
          <Settings className="w-4 h-4 text-gray-400 group-hover:text-emerald-400 group-hover:rotate-45 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            設定
          </span>
        </button>
        {/* 帳號登入按鈕 (位於設定按鈕右方) */}
        <button 
          onClick={() => setIsAuthModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-blue-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-blue-400 text-xs font-semibold select-none" 
          title="會員帳號 / Google 登入"
        >
          <User className="w-4 h-4 text-gray-400 group-hover:text-blue-400 transition-colors shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            帳號
          </span>
        </button>
        </div>
      </div>

      {/* 贊助支持彈出視窗 */}
      <DonateModal 
        isOpen={isDonateModalOpen} 
        onClose={() => setIsDonateModalOpen(false)} 
      />

      {/* 系統更新日誌彈出視窗 */}
      <ChangelogModal isOpen={isChangelogModalOpen} onClose={() => setIsChangelogModalOpen(false)} />
      {/* 會員登入彈窗 (Google 帳號) */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

      {/* 回報問題彈出視窗 */}
      <ReportIssueModal 
        isOpen={isReportModalOpen} 
        onClose={() => setIsReportModalOpen(false)} 
      />

      {/* 偏好設定彈出視窗 */}
      <SettingsModal />

      {/* 探索資訊面板 (燃油比價等) */}
      <ExplorePanel />

      {/* 地圖與圖資匯出中心彈出視窗 */}
      <ExportModal />

    </div>
  );
}
