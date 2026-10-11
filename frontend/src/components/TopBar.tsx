'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Settings, ChevronDown, Map as MapIcon, X, Loader2, Layers, AlertCircle } from 'lucide-react';
import { useUIStore, SearchTarget } from '@/store/useUIStore';
import ReportIssueModal from '@/components/ReportIssueModal';

export default function TopBar() {
  const { setSearchTarget, enableLayer, isLayerPanelOpen, toggleLayerPanel } = useUIStore();
  const [time, setTime] = useState<Date | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // 搜尋狀態
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchTarget[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

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

  // 搜尋防抖 (Debounce)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
    
    const handler = setTimeout(() => {
      fetch(`${apiUrl}/api/search?q=${encodeURIComponent(trimmed)}`)
        .then(res => res.json())
        .then(data => {
          setResults(data.results || []);
          setIsLoading(false);
          setIsOpen(true);
        })
        .catch(err => {
          console.error('Search error:', err);
          setIsLoading(false);
        });
    }, 250);

    return () => clearTimeout(handler);
  }, [query]);

  const handleSelect = (target: SearchTarget) => {
    if (target.layer_key) {
      enableLayer(target.layer_key);
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
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const tzParts = date.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ');
    const tzName = tzParts[tzParts.length - 1];
    
    return `${year}年${month}月${day}日 ${tzName}`;
  };

  return (
    <div className="absolute top-0 left-0 w-full h-[60px] bg-[#1a1b1e] border-b border-[#2d2e32] flex items-center px-4 z-50 text-white shadow-lg">
      
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
      <div className="flex flex-col justify-center mx-2 min-w-[150px]">
        {time ? (
          <>
            <span className="text-[22px] font-mono font-medium leading-none mb-1 tracking-wider text-gray-100">
              {formatTime(time)}
            </span>
            <span className="text-[10px] text-emerald-500 font-medium leading-none flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]"></span>
              即時 · {formatDate(time)}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-500">載入中...</span>
        )}
      </div>

      {/* 區域選擇 */}
      <button className="flex items-center gap-2 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] px-4 h-9 rounded-md ml-6 text-sm transition-colors text-gray-200 font-medium shadow-sm shrink-0">
        <MapIcon className="w-4 h-4 text-gray-400" />
        <span>大溫哥華</span>
        <ChevronDown className="w-3 h-3 text-gray-400 ml-2" />
      </button>

      {/* 搜尋列 - placeholder 改為 "搜尋" */}
      <div ref={searchContainerRef} className="relative flex-1 max-w-[650px] mx-6">
        <div className="flex items-center bg-[#25262b] border border-[#373a40] rounded-md px-3 h-9 focus-within:border-emerald-500/70 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all shadow-inner">
          <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
          <input 
            type="text" 
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
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
          <div className="absolute top-[44px] left-0 w-full bg-[#1e2025]/95 backdrop-blur-md border border-[#373a40] rounded-lg shadow-2xl overflow-hidden z-[100] max-h-[380px] flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#2d2e34] bg-[#191a1e]/80 text-[11px] text-gray-400">
              <span>圖層項目搜尋結果</span>
              <span>{results.length} 筆項目</span>
            </div>

            <div className="overflow-y-auto divide-y divide-[#2a2c33]/60 py-1">
              {results.length > 0 ? (
                results.map((item) => (
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
                      item.category === 'skytrain' ? 'bg-sky-950/80 text-sky-400 border-sky-800/60' :
                      item.category === 'ferry_terminal' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                      item.category === 'seabus' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                      item.category === 'fire_halls' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                      item.category === 'community_centres' ? 'bg-violet-950/80 text-violet-300 border-violet-800/60' :
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
                ))
              ) : (
                !isLoading && (
                  <div className="py-6 px-4 text-center text-xs text-gray-400">
                    查無相符圖層項目（可搜尋站名、碼頭名、地址、設施名）
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右側按鈕組：回報問題按鈕 (感嘆號) + 設定按鈕 */}
      <div className="flex items-center gap-2 shrink-0">
        <button 
          onClick={() => setIsReportModalOpen(true)}
          className="flex items-center justify-center w-10 h-9 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-amber-500/50 rounded-md transition-colors group shadow-sm text-gray-300 hover:text-amber-400" 
          title="回報問題"
        >
          <AlertCircle className="w-4 h-4 transition-colors group-hover:scale-110" />
        </button>

        <button className="flex items-center justify-center w-10 h-9 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] rounded-md transition-colors group shadow-sm" title="設定">
          <Settings className="w-4 h-4 text-gray-300 group-hover:text-emerald-400 transition-colors" />
        </button>
      </div>

      {/* 回報問題彈出視窗 */}
      <ReportIssueModal 
        isOpen={isReportModalOpen} 
        onClose={() => setIsReportModalOpen(false)} 
      />

    </div>
  );
}
