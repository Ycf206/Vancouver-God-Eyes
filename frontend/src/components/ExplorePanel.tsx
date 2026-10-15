'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Compass, X, Fuel, Zap, Ship, MapPin, 
  ChevronDown, RefreshCw, Package
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

interface EVStation {
  id: string;
  name: string;
  address: string;
  local_area: string;
  operator: string;
  connectors: string;
  ports: number;
  voltage: string;
  power_kw: number;
  cost: string;
  is_free: boolean;
  distance_km: number;
  lat: number;
  lon: number;
  score: number;
}

interface FerryVessel {
  id: string;
  vessel_name: string;
  dep_code: string;
  arr_code: string;
  dep_name: string;
  arr_name: string;
  departure_time: string;
  arrival_time: string;
  eta_text: string;
  progress: number;
  fill?: number;
  lat: number;
  lon: number;
  bearing?: number;
  status: string;
}

interface FerryRoute {
  route_id: string;
  name: string;
  name_en: string;
  vessels: FerryVessel[];
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

  // 4 Tabs: 渡輪, 燃油, 電動車, 貨運
  const [activeTab, setActiveTab] = useState<'ferry' | 'fuel' | 'ev' | 'cargo'>('fuel');

  // --- Fuel tab states ---
  const [fuelType, setFuelType] = useState<'regular' | 'midgrade' | 'premium' | 'diesel'>('regular');
  const [fuelSortBy, setFuelSortBy] = useState<'best' | 'price' | 'distance'>('best');
  const [onlyMajorChains, setOnlyMajorChains] = useState(false);
  const [fuelStations, setFuelStations] = useState<FuelStation[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);

  // --- EV tab states ---
  const [evSortBy, setEvSortBy] = useState<'best' | 'price' | 'distance'>('best');
  const [hideFreeCharging, setHideFreeCharging] = useState(false);
  const [evStations, setEvStations] = useState<EVStation[]>([]);
  const [loadingEV, setLoadingEV] = useState(false);

  // --- Ferry tab states ---
  const [ferryRoutes, setFerryRoutes] = useState<FerryRoute[]>([]);
  const [loadingFerries, setLoadingFerries] = useState(false);

  // 1. Fetch Fuel Stations
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'fuel') return;

    setLoadingFuel(true);
    const apiUrl = getApiUrl();
    const qs = new URLSearchParams({
      fuel_type: fuelType,
      sort_by: fuelSortBy,
    });

    if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
      qs.set('lat', String(userLocation.lat));
      qs.set('lon', String(userLocation.lon));
    }

    fetch(`${apiUrl}/api/fuel/stations?${qs.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setFuelStations(data.stations || []);
        setLoadingFuel(false);
      })
      .catch((err) => {
        console.error('Error fetching fuel stations:', err);
        setLoadingFuel(false);
      });
  }, [isExploreOpen, activeTab, fuelType, fuelSortBy, userLocation]);

  // 2. Fetch EV Charging Stations
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'ev') return;

    setLoadingEV(true);
    const apiUrl = getApiUrl();
    const qs = new URLSearchParams({
      sort_by: evSortBy,
      hide_free: hideFreeCharging ? 'true' : 'false',
    });

    if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
      qs.set('lat', String(userLocation.lat));
      qs.set('lon', String(userLocation.lon));
    }

    fetch(`${apiUrl}/api/ev/stations?${qs.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setEvStations(data.stations || []);
        setLoadingEV(false);
      })
      .catch((err) => {
        console.error('Error fetching EV stations:', err);
        setLoadingEV(false);
      });
  }, [isExploreOpen, activeTab, evSortBy, hideFreeCharging, userLocation]);

  // 3. Fetch BC Ferries Active Sailings
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'ferry') return;

    setLoadingFerries(true);
    const apiUrl = getApiUrl();

    fetch(`${apiUrl}/api/ferries/active`)
      .then((res) => res.json())
      .then((data) => {
        setFerryRoutes(data.routes || []);
        setLoadingFerries(false);
      })
      .catch((err) => {
        console.error('Error fetching active ferries:', err);
        setLoadingFerries(false);
      });
  }, [isExploreOpen, activeTab]);

  // Filter major fuel chains if toggled
  const filteredFuelStations = useMemo(() => {
    if (!onlyMajorChains) return fuelStations;
    const majorBrands = ['CHEVRON', 'SHELL', 'PETRO-CANADA', 'ESSO', 'MOBIL', 'COSTCO'];
    return fuelStations.filter((s) => {
      const b = (s.brand || s.name || '').toUpperCase();
      return majorBrands.some((mb) => b.includes(mb));
    });
  }, [fuelStations, onlyMajorChains]);

  if (!isExploreOpen) return null;

  // Handle Fuel click
  const handleSelectFuelStation = (st: FuelStation) => {
    enableLayer('fuel');
    setSearchTarget({
      id: `fuel_${st.id}`,
      title: st.name || st.brand,
      subtitle: `${st.address} · 油價: ${st.price_current.toFixed(1)}¢`,
      category: 'fuel',
      layer_key: 'fuel',
      badge: '加油站',
      icon: '⛽',
      lat: st.lat,
      lon: st.lon,
      meta: {
        local_area: st.address || st.city || '溫哥華市',
        properties: {
          id: st.id,
          name: st.name || st.brand,
          brand: st.brand,
          address: st.address,
          city: st.city,
          facility_type: 'fuel',
          opening_hours: '24/7'
        }
      },
      zoom: 16.5
    });
  };

  // Handle EV click
  const handleSelectEVStation = (st: EVStation) => {
    enableLayer('evCharging');
    setSearchTarget({
      id: `ev_${st.id}`,
      title: st.name,
      subtitle: `${st.address || st.local_area} · 功率: ${st.power_kw} kW · ${st.cost}`,
      category: 'ev_charging',
      layer_key: 'evCharging',
      badge: '充電站',
      icon: '⚡',
      lat: st.lat,
      lon: st.lon,
      meta: {
        local_area: st.address || st.local_area || '溫哥華市',
        properties: {
          id: st.id,
          name: st.name,
          power_kw: st.power_kw,
          connectors: st.connectors,
          ports: st.ports,
          voltage: st.voltage,
          cost: st.cost,
          operator: st.operator,
          facility_type: 'ev_charging'
        }
      },
      zoom: 16.5
    });
  };

  // Handle Ferry click
  const handleSelectFerry = (v: FerryVessel) => {
    enableLayer('bcferriesRoutes');
    enableLayer('bcferriesVehicles');
    setSearchTarget({
      id: v.id,
      title: v.vessel_name,
      subtitle: `${v.dep_name} 往 ${v.arr_name} · ${v.eta_text}`,
      category: 'ferry_vehicle',
      badge: 'BC Ferries',
      icon: '🚢',
      lat: v.lat,
      lon: v.lon,
      meta: {
        route_id: `${v.dep_code} ➝ ${v.arr_code}`,
        dep_name: v.dep_name,
        arr_name: v.arr_name,
        progress: v.progress,
        fill: v.fill,
        departure_time: v.departure_time,
        arrival_time: v.arrival_time
      },
      zoom: 13
    });
  };

  const tabs = [
    { id: 'ferry', label: '渡輪' },
    { id: 'fuel', label: '燃油' },
    { id: 'ev', label: '電動車' },
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
          onClick={() => {
            setExploreOpen(false);
            setSearchTarget(null);
          }}
          className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#252a38] transition-colors"
          title="關閉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 4 Tabs: 渡輪 / 燃油 / 電動車 / 貨運 */}
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

      {/* ==================== 1. 渡輪分頁 (BC Ferries) ==================== */}
      {activeTab === 'ferry' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
              <Ship className="w-3.5 h-3.5 text-sky-400" />
              <span>卑詩渡輪 (BC Ferries) 即時航行班次</span>
            </span>
            <span className="text-[10px] text-sky-400 bg-sky-950/70 border border-sky-800/60 px-1.5 py-0.5 rounded font-mono">
              即時追蹤
            </span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingFerries ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
                <span>讀取卑詩渡輪即時航行船班中...</span>
              </div>
            ) : ferryRoutes.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                暫無即時渡輪航行資料
              </div>
            ) : (
              ferryRoutes.map((route) => (
                <div key={route.route_id} className="flex flex-col gap-1.5">
                  {/* Route Header (Matches screenshot) */}
                  <div className="text-[11.5px] font-bold text-gray-300 tracking-wider flex items-center justify-between pt-1 pb-0.5 border-b border-[#232836]">
                    <span className="uppercase">{route.name}</span>
                    <span className="text-[10px] text-gray-500 font-mono font-normal">{route.name_en}</span>
                  </div>

                  {/* Vessels under this route */}
                  <div className="flex flex-col gap-1.5">
                    {route.vessels.map((v) => (
                      <div
                        key={v.id}
                        onClick={() => handleSelectFerry(v)}
                        className="p-2.5 rounded-lg bg-[#141720] hover:bg-[#1a1f2c] border border-[#232734] hover:border-sky-500/50 transition-all cursor-pointer flex flex-col gap-1.5 group"
                      >
                        {/* Upper row: Vessel name & ETA */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-[12.5px] sm:text-xs tracking-wide group-hover:text-sky-300 transition-colors uppercase">
                            {v.vessel_name}
                          </span>
                          <span className="text-[11px] font-medium text-gray-300">
                            {v.eta_text}
                          </span>
                        </div>

                        {/* Blue progress bar matching screenshot */}
                        <div className="w-full bg-[#1e2330] h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-[#38bdf8] h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(56,189,248,0.5)]" 
                            style={{ width: `${Math.max(4, Math.min(100, v.progress))}%` }} 
                          />
                        </div>

                        {v.fill !== undefined && v.fill > 0 && (
                          <div className="flex items-center justify-between text-[10px] text-gray-400 pt-0.5">
                            <span>車位載運率</span>
                            <span className="font-mono text-gray-300">{v.fill}%</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ==================== 2. 燃油分頁 (Fuel) ==================== */}
      {activeTab === 'fuel' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Subheader: Range & Location info */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium">
              {userLocation?.confirmed
                ? '距離個人位置 10 公里範圍內的加油站'
                : '溫哥華 10 公里範圍內的加油站'}
            </span>
            {!userLocation?.confirmed && (
              <button
                onClick={() => {
                  setExploreOpen(false);
                  setSettingsModalOpen(true);
                }}
                className="text-[10.5px] text-emerald-400 hover:text-emerald-300 font-medium hover:underline flex items-center gap-0.5"
              >
                <MapPin className="w-2.5 h-2.5" />
                <span>設定個人位置</span>
              </button>
            )}
          </div>

          {/* Filter Bar: Fuel Type Dropdown + Checkbox (書面語: 僅限連鎖品牌) */}
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
              <span>僅限連鎖品牌</span>
            </label>
          </div>

          {/* 3 Sort Buttons: 最好 / 價格 / 距離 */}
          <div className="grid grid-cols-3 gap-1 bg-[#10131a] p-1 rounded-lg border border-[#232836] mb-3 shrink-0">
            <button
              onClick={() => setFuelSortBy('best')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                fuelSortBy === 'best'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              最好
            </button>
            <button
              onClick={() => setFuelSortBy('price')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                fuelSortBy === 'price'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              價格
            </button>
            <button
              onClick={() => setFuelSortBy('distance')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                fuelSortBy === 'distance'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              距離
            </button>
          </div>

          {/* Station List */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingFuel ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                <span>讀取溫哥華各大加油站最新油價中...</span>
              </div>
            ) : filteredFuelStations.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                暫無符合條件的加油站
              </div>
            ) : (
              filteredFuelStations.map((st) => {
                const distDisplay = distanceUnit === 'imperial'
                  ? `${(st.distance_km * 0.621371).toFixed(1)} 英里`
                  : `${st.distance_km.toFixed(1)} 公里`;

                return (
                  <div
                    key={st.id}
                    onClick={() => handleSelectFuelStation(st)}
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
      )}

      {/* ==================== 3. 電動車分頁 (EV) ==================== */}
      {activeTab === 'ev' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Subheader: Range & Location info */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium">
              {userLocation?.confirmed
                ? '距離個人位置 15 公里範圍內的充電站'
                : '溫哥華 15 公里範圍內的充電站'}
            </span>
            {!userLocation?.confirmed && (
              <button
                onClick={() => {
                  setExploreOpen(false);
                  setSettingsModalOpen(true);
                }}
                className="text-[10.5px] text-emerald-400 hover:text-emerald-300 font-medium hover:underline flex items-center gap-0.5"
              >
                <MapPin className="w-2.5 h-2.5" />
                <span>設定個人位置</span>
              </button>
            )}
          </div>

          {/* 3 Sort Buttons: 最好 / 價格 / 距離 (Matches EV screenshot) */}
          <div className="grid grid-cols-3 gap-1 bg-[#10131a] p-1 rounded-lg border border-[#232836] mb-2.5 shrink-0">
            <button
              onClick={() => setEvSortBy('best')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                evSortBy === 'best'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              最好
            </button>
            <button
              onClick={() => setEvSortBy('price')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                evSortBy === 'price'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              價格
            </button>
            <button
              onClick={() => setEvSortBy('distance')}
              className={`py-1.5 text-xs rounded transition-all text-center ${
                evSortBy === 'distance'
                  ? 'bg-[#2b3345] text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              距離
            </button>
          </div>

          {/* Checkbox: 隱藏免費充電站 (Matches EV screenshot) */}
          <div className="flex items-center justify-between mb-2.5 shrink-0 px-0.5">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideFreeCharging}
                onChange={(e) => setHideFreeCharging(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-[#12151d] border-[#343a4a] text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
              />
              <span>隱藏免費充電站</span>
            </label>
          </div>

          {/* Station List */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingEV ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                <span>讀取溫哥華各充電站資訊中...</span>
              </div>
            ) : evStations.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                暫無符合條件的充電站
              </div>
            ) : (
              evStations.map((st) => {
                const distDisplay = distanceUnit === 'imperial'
                  ? `${(st.distance_km * 0.621371).toFixed(1)} 英里`
                  : `${st.distance_km.toFixed(1)} 公里`;

                return (
                  <div
                    key={st.id}
                    onClick={() => handleSelectEVStation(st)}
                    className="p-2.5 rounded-lg bg-[#141720] hover:bg-[#1c212e] border border-[#262c3c] hover:border-emerald-500/40 transition-all cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-[13px] truncate group-hover:text-emerald-300 transition-colors">
                          {st.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 truncate mt-0.5">
                        {st.operator} · {st.connectors} · {st.ports} 個充電樁
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold font-mono tracking-tight ${
                        st.power_kw >= 150 ? 'text-lime-400' : st.power_kw >= 50 ? 'text-emerald-400' : 'text-sky-400'
                      }`}>
                        {st.power_kw} kW
                      </div>
                      <div className="text-[10.5px] font-mono text-gray-400 mt-0.5">
                        {st.is_free ? '免費' : st.cost} · {distDisplay}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================== 4. 貨運分頁 (Cargo) ==================== */}
      {activeTab === 'cargo' && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-lg">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">貨運與港口物流</h3>
            <p className="text-xs text-gray-400 mt-1.5 max-w-[260px] leading-relaxed">
              即將推出溫哥華港（Port of Vancouver）各主要貨櫃與散貨碼頭船隻進出港動態、排隊泊位與鐵路物流狀態。
            </p>
          </div>
          <span className="text-[11px] font-mono text-amber-400/80 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded-full">
            功能即將推出 · Coming Soon
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2.5 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
        <span className="font-mono text-[10px]">
          {activeTab === 'fuel' && `共收錄 ${filteredFuelStations.length} 間加油站`}
          {activeTab === 'ev' && `共收錄 ${evStations.length} 座充電站`}
          {activeTab === 'ferry' && `共 ${ferryRoutes.reduce((acc, r) => acc + r.vessels.length, 0)} 艘渡輪即時航行中`}
          {activeTab === 'cargo' && `大溫港口物流`}
        </span>
        <button
          onClick={() => {
            setExploreOpen(false);
            setSearchTarget(null);
          }}
          className="text-gray-400 hover:text-white hover:underline text-[11px]"
        >
          關閉
        </button>
      </div>
    </div>
  );
}
