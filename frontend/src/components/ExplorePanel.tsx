'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Compass, X, Fuel, Zap, Ship, MapPin, 
  ArrowUpDown, Filter, ChevronDown, Check, ExternalLink, RefreshCw
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';

interface FuelStation {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lon: number;
  distance_km: number;
  price_current: number;
  prices: {
    regular: number;
    midgrade: number;
    premium: number;
    diesel: number;
  };
  source?: string;
  best_score?: number;
}

export default function ExplorePanel() {
  const { 
    isExploreOpen, 
    setExploreOpen, 
    userLocation, 
    setSettingsModalOpen,
    distanceUnit,
    setSearchTarget,
    enableLayer
  } = useUIStore();

  const [activeTab, setActiveTab] = useState<'now' | 'corridor' | 'delay' | 'ferry' | 'border' | 'ev' | 'fuel' | 'cargo'>('fuel');
  const [fuelType, setFuelType] = useState<'regular' | 'midgrade' | 'premium' | 'diesel'>('regular');
  const [sortBy, setSortBy] = useState<'best' | 'price' | 'distance'>('best');
  const [onlyMajorChains, setOnlyMajorChains] = useState(false);
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch fuel stations when activeTab is fuel, or user location/fuelType/sortBy changes
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'fuel') return;

    setLoading(true);
    const apiUrl = getApiUrl();
    const qs = new URLSearchParams({
      fuel_type: fuelType,
      sort_by: sortBy,
    });

    if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
      qs.set('lat', String(userLocation.lat));
      qs.set('lon', String(userLocation.lon));
    }

    fetch(`${apiUrl}/api/fuel/stations?${qs.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setStations(data.stations || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching fuel stations:', err);
        setLoading(false);
      });
  }, [isExploreOpen, activeTab, fuelType, sortBy, userLocation]);

  // Filter major chains if toggled
  const filteredStations = useMemo(() => {
    if (!onlyMajorChains) return stations;
    const majorBrands = ['CHEVRON', 'SHELL', 'PETRO-CANADA', 'ESSO', 'MOBIL', 'COSTCO'];
    return stations.filter((s) => {
      const b = (s.brand || s.name || '').toUpperCase();
      return majorBrands.some((mb) => b.includes(mb));
    });
  }, [stations, onlyMajorChains]);

  if (!isExploreOpen) return null;

  const handleSelectStation = (st: FuelStation) => {
    enableLayer('fuel');
    setSearchTarget({
      id: `fuel_${st.id}`,
      title: st.name || st.brand,
      subtitle: `${st.address} · 油價: ${st.price_current.toFixed(1)}¢`,
      category: 'road',
      badge: '加油站',
      icon: '⛽',
      lat: st.lat,
      lon: st.lon,
      zoom: 16.5
    });
  };

  const tabs = [
    { id: 'now', label: '而家' },
    { id: 'corridor', label: '走廊' },
    { id: 'delay', label: '遲到' },
    { id: 'ferry', label: '渡輪' },
    { id: 'border', label: '口岸' },
    { id: 'ev', label: '電動車' },
    { id: 'fuel', label: '燃油' },
    { id: 'cargo', label: '貨運' },
  ] as const;

  return (
    <div 
      className="fixed top-[72px] right-4 z-40 w-[380px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-4 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#262b38] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <Compass className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-white tracking-wide">探索</h2>
        </div>
        <button
          onClick={() => setExploreOpen(false)}
          className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#252a38] transition-colors"
          title="關閉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2x4 Categories Grid (Matches Screenshot) */}
      <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#10131a] rounded-xl border border-[#232836] shrink-0 mb-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 text-xs font-medium rounded-lg transition-all text-center ${
                isActive
                  ? 'bg-[#2b3345] text-white font-bold shadow-md ring-1 ring-[#3d4760]'
                  : 'text-gray-300 hover:text-white hover:bg-[#1a1f2b]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content depending on Active Tab */}
      {activeTab === 'fuel' ? (
        <div className="flex flex-col flex-1 min-h-0">
          
          {/* Subheader: Range & Location info */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium">
              {userLocation?.confirmed
                ? '離您的住址 10 km 範圍內嘅油站'
                : '溫哥華 10 km 範圍內嘅油站'}
            </span>
            {!userLocation?.confirmed && (
              <button
                onClick={() => setSettingsModalOpen(true)}
                className="text-[10.5px] text-emerald-400 hover:text-emerald-300 font-medium hover:underline flex items-center gap-0.5"
              >
                <MapPin className="w-2.5 h-2.5" />
                <span>設定我的住址</span>
              </button>
            )}
          </div>

          {/* Filter Bar: Fuel Type Dropdown + Checkbox (Matches Screenshot) */}
          <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0">
            <div className="relative flex-1">
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value as any)}
                className="w-full bg-[#12151d] text-xs text-white rounded-lg border border-[#343a4a] px-3 py-1.5 appearance-none focus:outline-none focus:border-emerald-500 font-medium pr-7 cursor-pointer"
              >
                <option value="regular">無鉛汽油 (Regular 87)</option>
                <option value="midgrade">中級汽油 (Midgrade 89)</option>
                <option value="premium">高級汽油 (Premium 91)</option>
                <option value="diesel">柴油 (Diesel)</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={onlyMajorChains}
                onChange={(e) => setOnlyMajorChains(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-[#12151d] border-[#343a4a] text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
              />
              <span>淨係連鎖</span>
            </label>
          </div>

          {/* 3 Sort Buttons: 最好 / 價錢 / 距離 (Matches Screenshot) */}
          <div className="grid grid-cols-3 gap-1 bg-[#10131a] p-1 rounded-lg border border-[#232836] mb-3 shrink-0">
            <button
              onClick={() => setSortBy('best')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                sortBy === 'best'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              最好
            </button>
            <button
              onClick={() => setSortBy('price')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                sortBy === 'price'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              價錢
            </button>
            <button
              onClick={() => setSortBy('distance')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                sortBy === 'distance'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              距離
            </button>
          </div>

          {/* Station List */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                <span>讀取溫哥華各油站最新油價中...</span>
              </div>
            ) : filteredStations.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                暫無符合篩選條件的加油站
              </div>
            ) : (
              filteredStations.map((st) => {
                const distDisplay = distanceUnit === 'imperial'
                  ? `${(st.distance_km * 0.621371).toFixed(1)} mi`
                  : `${st.distance_km.toFixed(1)} km`;

                return (
                  <div
                    key={st.id}
                    onClick={() => handleSelectStation(st)}
                    className="p-2.5 rounded-lg bg-[#141720] hover:bg-[#1c212e] border border-[#262c3c] hover:border-amber-500/40 transition-all cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-[13px] truncate group-hover:text-amber-300 transition-colors">
                          {st.brand || st.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 truncate mt-0.5">
                        {st.address} · {st.city}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono text-amber-400 tracking-tight">
                        {st.price_current.toFixed(1)}¢
                      </div>
                      <div className="text-[10.5px] font-mono text-gray-400 mt-0.5">
                        {distDisplay}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      ) : activeTab === 'ev' ? (
        /* EV Charging placeholder */
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">電動車充電網絡</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-[240px]">
              可在圖層中開啟「電動車充電站」，查看溫哥華全市公用 Level 2 與 DC 快充樁。
            </p>
          </div>
          <button
            onClick={() => {
              enableLayer('evCharging');
              setExploreOpen(false);
            }}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
          >
            開啟充電站圖層
          </button>
        </div>
      ) : activeTab === 'ferry' ? (
        /* Ferries placeholder */
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Ship className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">BC Ferries 渡輪動態</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-[240px]">
              即時追蹤喬治亞海峽各航線船隻位置、航速、碼頭班次與載客率。
            </p>
          </div>
          <button
            onClick={() => {
              enableLayer('bcferriesRoutes');
              enableLayer('bcferriesVehicles');
              setExploreOpen(false);
            }}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
          >
            開啟渡輪即時圖層
          </button>
        </div>
      ) : (
        /* Future expansion tabs */
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-2 text-center text-gray-400 text-xs">
          <Compass className="w-8 h-8 text-gray-600" />
          <span className="font-medium text-gray-300">功能即將登場</span>
          <span className="text-[11px] text-gray-500">此分頁將於後續版本推出即時路廊與交通資訊</span>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2.5 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
        <span className="font-mono text-[10px]">
          {activeTab === 'fuel' && `共收錄 ${filteredStations.length} 間油站`}
        </span>
        <button
          onClick={() => setExploreOpen(false)}
          className="text-gray-400 hover:text-white hover:underline text-[11px]"
        >
          關閉
        </button>
      </div>
    </div>
  );
}
