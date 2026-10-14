'use client';

import React, { useState, useEffect } from 'react';
import { Settings, X, Clock, Ruler, Check, MapPin, Navigation, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';

export default function SettingsModal() {
  const { 
    isSettingsModalOpen, 
    setSettingsModalOpen, 
    timeFormat, 
    setTimeFormat, 
    distanceUnit, 
    setDistanceUnit,
    userLocation,
    setUserLocation,
    setSearchTarget
  } = useUIStore();

  const [addressInput, setAddressInput] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  useEffect(() => {
    if (userLocation?.address) {
      setAddressInput(userLocation.address);
    }
  }, [userLocation]);

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

  // Geocode address via backend API
  const handleVerifyAddress = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = addressInput.trim();
    if (!query) {
      setGeocodeError('請輸入有效地址');
      return;
    }

    setIsGeocoding(true);
    setGeocodeError(null);

    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        const top = data.results[0];
        setUserLocation({
          address: query,
          displayName: top.display_name || top.name || query,
          lat: top.lat,
          lon: top.lon,
          confirmed: true
        });
        setIsEditingAddress(false);
      } else {
        setGeocodeError('找不到該地址，請確認路名與門牌後重試');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setGeocodeError('地址驗證失敗，請檢查網路連線');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Get device GPS location
  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setGeocodeError('您的瀏覽器不支援 GPS 定位');
      return;
    }

    setIsGpsLoading(true);
    setGeocodeError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000000) / 1000000;
        const lon = Math.round(pos.coords.longitude * 1000000) / 1000000;
        setUserLocation({
          address: `GPS 定位 (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
          displayName: `我的目前 GPS 位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
          lat,
          lon,
          confirmed: true
        });
        setAddressInput(`GPS 定位 (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
        setIsEditingAddress(false);
        setIsGpsLoading(false);
      },
      (err) => {
        console.error('Geolocation error:', err);
        setGeocodeError('無法獲取 GPS 定位權限，請手動輸入地址');
        setIsGpsLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Fly to user location on map
  const handleLocateOnMap = () => {
    if (!userLocation) return;
    setSearchTarget({
      id: 'user_home_location',
      title: '個人位置',
      subtitle: userLocation.displayName || userLocation.address,
      category: 'road',
      badge: '我的住址',
      icon: '🏠',
      lat: userLocation.lat,
      lon: userLocation.lon,
      zoom: 16
    });
  };

  return (
    <div 
      className="fixed top-[72px] right-4 z-40 w-[360px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-4 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between pb-3 mb-3 border-b border-[#262b38] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <Settings className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">系統設定 (SETTINGS)</h2>
            <p className="text-[10.5px] text-gray-400">所有變更均會自動即時儲存</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsModalOpen(false)}
          className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#252a38] transition-colors"
          title="關閉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 text-gray-200">
        
        {/* Setting 1: 個人位置 (My Location) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-rose-400" />
              <span>個人位置 (My Location)</span>
            </label>
            <span className="text-[10px] text-gray-400">計算油站與設施距離</span>
          </div>

          {userLocation?.confirmed && !isEditingAddress ? (
            /* Confirmed Location Box */
            <div className="bg-[#12151d] p-3 rounded-lg border border-emerald-500/30 flex flex-col gap-2 shadow-inner">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.9)]"></span>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-emerald-400 block">✓ 位置已確認</span>
                    <p className="text-xs font-medium text-gray-100 truncate leading-snug" title={userLocation.displayName || userLocation.address}>
                      {userLocation.displayName || userLocation.address}
                    </p>
                    <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                      座標: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-[#262b38]">
                <button
                  type="button"
                  onClick={handleLocateOnMap}
                  className="flex-1 py-1.5 px-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded text-[11px] font-medium border border-emerald-500/40 transition-colors flex items-center justify-center gap-1"
                >
                  <Navigation className="w-3 h-3" />
                  <span>在地圖定位</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingAddress(true)}
                  className="py-1.5 px-2.5 bg-[#252a38] hover:bg-[#2e3446] text-gray-300 hover:text-white rounded text-[11px] font-medium transition-colors"
                >
                  修改
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserLocation(null);
                    setAddressInput('');
                    setIsEditingAddress(false);
                  }}
                  className="py-1.5 px-2.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded text-[11px] font-medium border border-rose-500/30 transition-colors"
                >
                  清除
                </button>
              </div>
            </div>
          ) : (
            /* Input / Edit Location Form */
            <form onSubmit={handleVerifyAddress} className="flex flex-col gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="輸入溫哥華住址 (例如: 1200 Burrard St)"
                  className="w-full bg-[#12151d] text-xs text-white rounded-lg border border-[#343a4a] px-3 py-2 pr-8 focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-gray-500"
                />
                {addressInput && (
                  <button
                    type="button"
                    onClick={() => setAddressInput('')}
                    className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {geocodeError && (
                <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-500/30">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{geocodeError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="submit"
                  disabled={isGeocoding || !addressInput.trim()}
                  className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {isGeocoding ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>確認中...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-3 h-3" />
                      <span>確認住址</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleUseGps}
                  disabled={isGpsLoading}
                  className="py-1.5 px-3 bg-[#252a38] hover:bg-[#2e3446] text-sky-300 rounded-lg text-xs font-medium border border-sky-500/30 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {isGpsLoading ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>定位中...</span>
                    </>
                  ) : (
                    <>
                      <Navigation className="w-3 h-3 text-sky-400" />
                      <span>GPS 定位</span>
                    </>
                  )}
                </button>
              </div>

              {isEditingAddress && userLocation && (
                <button
                  type="button"
                  onClick={() => setIsEditingAddress(false)}
                  className="text-[11px] text-gray-400 hover:text-gray-200 text-center py-1"
                >
                  取消修改，保留原位置
                </button>
              )}
            </form>
          )}
        </div>

        <div className="w-full h-px bg-[#262b38]"></div>

        {/* Setting 2: 時間顯示方式 (Time Format) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>時間顯示方式 (Time Format)</span>
            </label>
            <span className="text-[10px] text-gray-400">頂部時鐘、航班、渡輪</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTimeFormat('24h')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                timeFormat === '24h'
                  ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.2)] ring-1 ring-emerald-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">24 小時制</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">14:30:00</div>
              </div>
              {timeFormat === '24h' && (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setTimeFormat('12h')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                timeFormat === '12h'
                  ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.2)] ring-1 ring-emerald-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">12 小時制</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">2:30 PM</div>
              </div>
              {timeFormat === '12h' && (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
            </button>
          </div>
        </div>

        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Setting 3: 地圖比例尺單位 (Map Scale Unit) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <Ruler className="w-3.5 h-3.5 text-sky-400" />
              <span>地圖比例尺單位 (Scale Unit)</span>
            </label>
            <span className="text-[10px] text-gray-400">地圖右下方比例尺</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDistanceUnit('metric')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                distanceUnit === 'metric'
                  ? 'bg-sky-950/50 border-sky-500 text-white shadow-[0_0_8px_rgba(56,189,248,0.2)] ring-1 ring-sky-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">公制 (km / m)</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">公里 / 公尺</div>
              </div>
              {distanceUnit === 'metric' && (
                <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setDistanceUnit('imperial')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                distanceUnit === 'imperial'
                  ? 'bg-sky-950/50 border-sky-500 text-white shadow-[0_0_8px_rgba(56,189,248,0.2)] ring-1 ring-sky-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">英制 (mi / ft)</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">英里 / 英呎</div>
              </div>
              {distanceUnit === 'imperial' && (
                <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              )}
            </button>
          </div>
        </div>

      </div>

      {/* Footer Status Indicator */}
      <div className="mt-4 pt-2.5 border-t border-[#262b38] flex items-center justify-between text-[10.5px] text-gray-400">
        <span className="flex items-center gap-1 text-emerald-400/90 font-medium">
          <Check className="w-3 h-3" />
          <span>設定即時自動生效</span>
        </span>
        <button
          onClick={() => setSettingsModalOpen(false)}
          className="text-gray-400 hover:text-white font-medium hover:underline"
        >
          關閉面板
        </button>
      </div>
    </div>
  );
}
