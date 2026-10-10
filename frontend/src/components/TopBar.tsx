'use client';

import { useState, useEffect } from 'react';
import { Search, Settings, ChevronDown, Map as MapIcon } from 'lucide-react';

export default function TopBar() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
      <div className="flex flex-col justify-center mr-2">
        <span className="text-[10px] font-bold text-gray-400 leading-none mb-1">VANCOUVER</span>
        <span className="text-sm font-bold leading-none tracking-wider">即時交通</span>
      </div>

      <div className="h-8 w-px bg-gray-700 mx-3"></div>

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

      {/* 搜尋列 - 改為 flex-1 填滿中間 */}
      <div className="flex-1 flex items-center bg-[#25262b] border border-[#373a40] rounded-md mx-6 px-3 h-9 focus-within:border-emerald-500/50 transition-colors shadow-inner">
        <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
        <input 
          type="text" 
          placeholder="搜尋：城鎮、街道、站牌..." 
          className="bg-transparent text-sm text-white w-full focus:outline-none placeholder:text-gray-500"
        />
      </div>

      {/* 設定按鈕 - 放最右側 */}
      <div className="flex items-center gap-2 shrink-0">
        <button className="flex items-center justify-center w-10 h-9 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] rounded-md transition-colors group shadow-sm" title="設定">
          <Settings className="w-4 h-4 text-gray-300 group-hover:text-emerald-400 transition-colors" />
        </button>
      </div>

    </div>
  );
}
