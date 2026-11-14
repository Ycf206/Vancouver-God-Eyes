'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { 
  X, Ship, Search, RefreshCw, Anchor, Navigation, ExternalLink, ArrowRight
} from 'lucide-react';

interface MaritimeVesselItem {
  mmsi: string;
  name: string;
  imo?: string;
  callsign?: string;
  ship_type: string;
  type_group: 'cargo' | 'tanker' | 'tug' | 'passenger' | 'pleasure' | 'sailing' | 'other';
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
  destination?: string;
  eta?: string;
  nav_status?: string;
}

const TYPE_FILTERS: Array<{ id: string; label: string; color: string }> = [
  { id: 'ALL', label: '全部船舶', color: 'bg-cyan-500' },
  { id: 'cargo', label: '貨櫃/散裝輪', color: 'bg-emerald-500' },
  { id: 'tanker', label: '油輪/化學輪', color: 'bg-rose-500' },
  { id: 'tug', label: '拖船/引水船', color: 'bg-cyan-500' },
  { id: 'passenger', label: '郵輪/客輪', color: 'bg-blue-500' },
  { id: 'other', label: '其他/作業船', color: 'bg-purple-500' },
];

export default function MaritimeScheduleModal() {
  const { isMaritimeScheduleOpen, setMaritimeScheduleOpen, setSearchTarget } = useUIStore();
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [vessels, setVessels] = useState<MaritimeVesselItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchVessels = async () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/shipping/vessels`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.vessels) ? data.vessels : (Array.isArray(data) ? data : []);
        setVessels(list);
        setLastUpdated(new Date());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isMaritimeScheduleOpen) {
      fetchVessels();
      const interval = setInterval(fetchVessels, 45000);
      return () => clearInterval(interval);
    }
  }, [isMaritimeScheduleOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMaritimeScheduleOpen) {
        setMaritimeScheduleOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaritimeScheduleOpen, setMaritimeScheduleOpen]);

  const filteredVessels = useMemo(() => {
    let list = vessels;
    if (selectedType !== 'ALL') {
      list = list.filter(v => v.type_group === selectedType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(v => 
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.mmsi && v.mmsi.toLowerCase().includes(q)) ||
        (v.callsign && v.callsign.toLowerCase().includes(q)) ||
        (v.destination && v.destination.toLowerCase().includes(q)) ||
        (v.ship_type && v.ship_type.toLowerCase().includes(q))
      );
    }
    // Sort moving vessels with destination first, then by speed
    return [...list].sort((a, b) => {
      const aSpeed = a.sog || 0;
      const bSpeed = b.sog || 0;
      return bSpeed - aSpeed;
    });
  }, [vessels, selectedType, searchQuery]);

  if (!isMaritimeScheduleOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl max-h-[88vh] bg-[#141822] border border-cyan-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#17202b] border-b border-gray-700/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-sm">
              <Anchor className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white text-base leading-snug">
                船運班次
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchVessels}
              disabled={loading}
              className="p-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-colors flex items-center justify-center cursor-pointer font-medium disabled:opacity-50"
              title="重新整理船舶資料"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setMaritimeScheduleOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 bg-[#111620] border-b border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {/* Type Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
            {TYPE_FILTERS.map((t) => {
              const isActive = selectedType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(t.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/40'
                      : 'bg-[#1b2230] text-gray-400 hover:text-gray-200 hover:bg-[#252f42]'
                  }`}
                >
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[200px] shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋船名、MMSI、目的地..."
              className="w-full bg-[#1b2230] border border-gray-700/80 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto space-y-3 bg-black/40">
          {loading && vessels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-sm gap-3">
              <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin" />
              <span>正在載入即時 AIS 商船情報...</span>
            </div>
          ) : filteredVessels.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm bg-[#161c26] rounded-xl border border-gray-800">
              目前無相符的船舶動態資料。
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredVessels.map((v) => {
                const isUnderway = (v.sog && v.sog > 0.5);
                const badgeColor = 
                  v.type_group === 'cargo' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                  v.type_group === 'tanker' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                  v.type_group === 'tug' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' :
                  v.type_group === 'passenger' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                  'bg-purple-500/20 text-purple-300 border-purple-500/40';

                return (
                  <div
                    key={v.mmsi}
                    onClick={() => {
                      if (v.lat && v.lon) {
                        setSearchTarget({
                          id: `maritime_${v.mmsi}`,
                          title: v.name || '商船',
                          subtitle: `${v.ship_type} · ${v.destination || '在途航行'}`,
                          category: 'maritime_vessel',
                          icon: 'Ship',
                          lat: v.lat,
                          lon: v.lon,
                          zoom: 13,
                          meta: v
                        });
                        if (typeof window !== 'undefined') {
                          const map = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                          if (map) {
                            map.flyTo({
                              center: [v.lon, v.lat],
                              zoom: 13,
                              duration: 1200,
                              essential: true
                            });
                          }
                          (window as any).__godsEyeSelectMaritimeVessel?.(v);
                        }
                        setMaritimeScheduleOpen(false);
                      }
                    }}
                    className="p-3.5 rounded-xl bg-[#171c26] border border-gray-800/80 hover:border-cyan-500/50 hover:bg-[#1c2330] transition-all flex flex-col gap-2 cursor-pointer shadow-sm group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-white text-sm truncate group-hover:text-cyan-300 transition-colors">
                          {v.name || '未命名商船'}
                        </span>
                        {v.callsign && (
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-800 px-1.5 py-0.2 rounded">
                            {v.callsign}
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                        {v.ship_type || v.type_group}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span className="truncate max-w-[200px]">
                        目的地：<span className="text-white font-medium">{v.destination || '未指定目的地'}</span>
                      </span>
                      {v.eta && (
                        <span className="text-[11px] text-gray-400 font-mono">
                          ETA: {v.eta}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-800/80 text-[11px] text-gray-400">
                      <div className="flex items-center gap-3">
                        <span className="font-mono flex items-center gap-1">
                          <span className="text-cyan-400 font-bold">{v.sog ? v.sog.toFixed(1) : '0.0'}</span> 節 (kts)
                        </span>
                        <span className="font-mono flex items-center gap-1">
                          航向：{v.heading || v.cog ? `${Math.round(v.heading || v.cog)}°` : 'N/A'}
                        </span>
                      </div>
                      <span className={`text-[10.5px] font-medium ${isUnderway ? 'text-emerald-400' : 'text-gray-400'}`}>
                        {v.nav_status || (isUnderway ? '航行中' : '靠泊/拋錨')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
