'use client';

import { useUIStore } from '@/store/useUIStore';
import { Car, Bus, Ship, CloudRain, SquareParking, Search, Bell } from 'lucide-react';

export default function Sidebar() {
  const { layers, toggleLayer } = useUIStore();

  const filterOptions = [
    { id: 'traffic', label: '交通路況', icon: Car },
    { id: 'transit', label: '大眾運輸 (Translink)', icon: Bus },
    { id: 'ferries', label: '渡輪 (BC Ferries)', icon: Ship },
    { id: 'parking', label: '停車資訊', icon: SquareParking },
    { id: 'weather', label: '天氣與環境', icon: CloudRain },
  ] as const;

  return (
    <div className="absolute top-0 right-0 w-80 h-full p-4 z-20 pointer-events-none flex flex-col gap-4">
      
      {/* 搜尋欄 (Search Bar) */}
      <div className="bg-black/70 backdrop-blur-md border border-white/10 rounded-xl p-3 pointer-events-auto flex items-center shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <Search className="w-5 h-5 text-emerald-400 mr-3" />
        <input 
          type="text" 
          placeholder="搜尋名稱、地方、航班..." 
          className="bg-transparent text-sm text-white focus:outline-none w-full placeholder:text-gray-500"
        />
      </div>

      {/* 控制面板 (Filter Panel) */}
      <div className="bg-black/70 backdrop-blur-md border border-white/10 rounded-xl p-5 pointer-events-auto shadow-[0_4px_30px_rgba(0,0,0,0.5)] flex-1 overflow-y-auto flex flex-col">
        
        {/* 圖層開關 */}
        <h2 className="text-gray-400 text-xs font-bold tracking-widest mb-4 flex items-center">
          <div className="w-1 h-3 bg-emerald-500 mr-2 rounded-full"></div>
          資料圖層 (DATA LAYERS)
        </h2>
        
        <div className="flex flex-col gap-2">
          {filterOptions.map((opt) => {
            const Icon = opt.icon;
            // 由於 ts const 斷言與 keyof 的一些型別限制，我們安全地斷言它
            const isActive = layers[opt.id as keyof typeof layers];
            return (
              <button
                key={opt.id}
                onClick={() => toggleLayer(opt.id as keyof typeof layers)}
                className={`flex items-center gap-3 p-3 rounded-lg text-sm transition-all duration-300 ${
                  isActive 
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/50 shadow-[inset_0_0_15px_rgba(52,211,153,0.1)]' 
                    : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-gray-500'}`} />
                <span className="font-medium tracking-wide">{opt.label}</span>
                
                {/* 狀態指示燈 */}
                <div className={`ml-auto w-2 h-2 rounded-full transition-all duration-300 ${
                  isActive ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,1)]' : 'bg-gray-600'
                }`} />
              </button>
            )
          })}
        </div>

        <div className="mt-auto pt-6"></div>

        {/* 即時快訊 (Latest Alerts) */}
        <h2 className="text-gray-400 text-xs font-bold tracking-widest mb-4 flex items-center">
          <Bell className="w-3 h-3 text-red-500 mr-2" />
          最新通知 (ALERTS)
        </h2>
        <div className="bg-gradient-to-r from-red-500/20 to-transparent border-l-2 border-red-500 p-3 rounded-r-lg flex flex-col gap-1">
          <span className="text-red-400 text-xs font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></span>
            [交通] 路線服務受阻
          </span>
          <span className="text-gray-300 text-xs mt-1 leading-relaxed">
            Seabus 目前因濃霧影響，預計延遲 15 分鐘。請隨時注意最新動態。
          </span>
        </div>
      </div>

    </div>
  );
}
