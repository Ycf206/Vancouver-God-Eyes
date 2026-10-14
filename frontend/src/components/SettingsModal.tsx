'use client';

import React, { useEffect } from 'react';
import { Settings, X, Clock, Ruler, Check } from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';

export default function SettingsModal() {
  const { 
    isSettingsModalOpen, 
    setSettingsModalOpen, 
    timeFormat, 
    setTimeFormat, 
    distanceUnit, 
    setDistanceUnit 
  } = useUIStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsModalOpen) {
        setSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsModalOpen, setSettingsModalOpen]);

  if (!isSettingsModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 select-none">
      <div 
        className="w-full max-w-[440px] bg-[#1a1b1e] border border-[#2d2e32] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2e32] bg-[#161719]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">系統偏好設定</h2>
              <p className="text-[11px] text-gray-400">自訂全站時間格式與地圖比例尺單位</p>
            </div>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#25262b] transition-colors"
            title="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-5 text-gray-200">
          
          {/* Setting 1: 時間顯示方式 (Time Format) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>時間顯示方式 (Time Format)</span>
              </label>
              <span className="text-[10px] text-gray-500">頂部時鐘、航班、渡輪與巴士</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTimeFormat('24h')}
                className={`flex items-center justify-between px-3.5 py-3 rounded-lg border text-left transition-all ${
                  timeFormat === '24h'
                    ? 'bg-[#1a2e23] border-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/50'
                    : 'bg-[#25262b] border-[#373a40] text-gray-300 hover:bg-[#2c2d33] hover:text-white'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">24 小時制</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">例如: 14:30:00</div>
                </div>
                {timeFormat === '24h' && (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setTimeFormat('12h')}
                className={`flex items-center justify-between px-3.5 py-3 rounded-lg border text-left transition-all ${
                  timeFormat === '12h'
                    ? 'bg-[#1a2e23] border-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/50'
                    : 'bg-[#25262b] border-[#373a40] text-gray-300 hover:bg-[#2c2d33] hover:text-white'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">12 小時制</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">例如: 2:30 PM</div>
                </div>
                {timeFormat === '12h' && (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </button>
            </div>
          </div>

          <div className="w-full h-px bg-[#26282d]"></div>

          {/* Setting 2: 地圖比例尺單位 (Map Scale Unit) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-sky-400" />
                <span>地圖比例尺單位 (Scale Unit)</span>
              </label>
              <span className="text-[10px] text-gray-500">地圖右下方比例尺</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDistanceUnit('metric')}
                className={`flex items-center justify-between px-3.5 py-3 rounded-lg border text-left transition-all ${
                  distanceUnit === 'metric'
                    ? 'bg-[#142338] border-sky-500 text-white shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-sky-500/50'
                    : 'bg-[#25262b] border-[#373a40] text-gray-300 hover:bg-[#2c2d33] hover:text-white'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">公制 (公里 / 公尺)</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">Metric: km / m</div>
                </div>
                {distanceUnit === 'metric' && (
                  <Check className="w-4 h-4 text-sky-400 shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setDistanceUnit('imperial')}
                className={`flex items-center justify-between px-3.5 py-3 rounded-lg border text-left transition-all ${
                  distanceUnit === 'imperial'
                    ? 'bg-[#142338] border-sky-500 text-white shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-sky-500/50'
                    : 'bg-[#25262b] border-[#373a40] text-gray-300 hover:bg-[#2c2d33] hover:text-white'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">英制 (英里 / 英呎)</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">Imperial: mi / ft</div>
                </div>
                {distanceUnit === 'imperial' && (
                  <Check className="w-4 h-4 text-sky-400 shrink-0" />
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3.5 border-t border-[#2d2e32] bg-[#161719] gap-2">
          <button
            type="button"
            onClick={() => setSettingsModalOpen(false)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md shadow-emerald-950"
          >
            確定完成
          </button>
        </div>
      </div>
    </div>
  );
}
