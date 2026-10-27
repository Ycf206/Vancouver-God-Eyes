'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Settings, X, Clock, Ruler, Thermometer, Check, MapPin, Navigation, Search, AlertCircle, RefreshCw, Globe, Newspaper, ChevronDown } from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';

export default function SettingsModal() {
  const { 
    isSettingsModalOpen, 
    setSettingsModalOpen, 
    timeFormat, 
    setTimeFormat, 
    timeZone,
    setTimeZone,
    distanceUnit, 
    setDistanceUnit,
    temperatureUnit,
    setTemperatureUnit,
    userLocation,
    setUserLocation,
    navigationAddress,
    setNavigationAddress,
    setSearchTarget
  } = useUIStore();

  const [addressInput, setAddressInput] = useState('');
  const [navAddressInput, setNavAddressInput] = useState('');
  const [isNavGpsLoading, setIsNavGpsLoading] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  // 地址搜尋建議狀態
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);
  const isSelectingSuggestionRef = useRef(false);

  // 搜尋建議防抖 (Debounce)
  useEffect(() => {
    if (isSelectingSuggestionRef.current) {
      isSelectingSuggestionRef.current = false;
      return;
    }
    const trimmed = addressInput.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSuggesting(true);
        const resultsList: any[] = [];
        
        // 1. 溫哥華市政官方物業門牌地址資料庫 (Vancouver Property Addresses Open Data)
        try {
          const vanRes = await fetch(
            `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-addresses/records?where=search(*%2C%22${encodeURIComponent(trimmed)}%22)&limit=8`
          );
          if (vanRes.ok) {
            const vanData = await vanRes.json();
            const recs = vanData.results || [];
            for (const r of recs) {
              const civic = (r.civic_number || '').toString().trim();
              const street = (r.std_street || '').toString().trim();
              const fullAddr = `${civic} ${street}`.trim();
              if (fullAddr && r.geo_point_2d?.lat && r.geo_point_2d?.lon) {
                resultsList.push({
                  id: `van_prop_${r.property_use_id || fullAddr}`,
                  title: fullAddr,
                  subtitle: `Vancouver, BC${r.postal_code ? ' ' + r.postal_code : ''}`,
                  lat: r.geo_point_2d.lat,
                  lon: r.geo_point_2d.lon
                });
              }
            }
          }
        } catch (_) {
          // Fallback if network blocked
        }

        // 2. 若筆數較少，補充 BC 官方門牌地理編碼服務 (BC Geocoder)
        if (resultsList.length < 5) {
          try {
            const bcRes = await fetch(
              `https://geocoder.api.gov.bc.ca/addresses.json?addressString=${encodeURIComponent(trimmed)}&maxResults=8`
            );
            if (bcRes.ok) {
              const bcData = await bcRes.json();
              for (const feat of (bcData.features || [])) {
                const full = feat.properties?.fullAddress;
                const coords = feat.geometry?.coordinates;
                if (full && coords && coords.length >= 2) {
                  // 避免重複
                  if (!resultsList.some(item => item.title.toLowerCase() === full.toLowerCase())) {
                    resultsList.push({
                      id: `bc_geo_${feat.properties?.siteID || full}`,
                      title: full,
                      subtitle: feat.properties?.localityName ? `${feat.properties.localityName}, BC` : 'BC, Canada',
                      lat: coords[1],
                      lon: coords[0]
                    });
                  }
                }
              }
            }
          } catch (_) {}
        }

        // 3. 後端 Geocode 備援
        if (resultsList.length === 0) {
          const apiUrl = getApiUrl();
          const res = await fetch(`${apiUrl}/api/geocode?q=${encodeURIComponent(trimmed)}`);
          const data = await res.json();
          const list = data.results || [];
          for (const item of list) {
            if (item.lat && item.lon) {
              resultsList.push({
                id: `geo_${item.lat}_${item.lon}`,
                title: item.display_name || item.name,
                subtitle: '地理位置',
                lat: item.lat,
                lon: item.lon
              });
            }
          }
        }

        const validList = resultsList.slice(0, 8);
        setSuggestions(validList);
        setShowSuggestions(validList.length > 0);
      } catch (err) {
        console.error('Settings suggestion error:', err);
      } finally {
        setIsSuggesting(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [addressInput]);

  // 點擊外部關閉建議清單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsContainerRef.current && !suggestionsContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (userLocation?.address) {
      setAddressInput(userLocation.address);
    }
  }, [userLocation]);

  // Sync navAddressInput with store
  useEffect(() => {
    if (navigationAddress) {
      setNavAddressInput(navigationAddress);
    }
  }, [navigationAddress]);

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
        setSearchTarget({
          id: 'user_gps_location',
          title: '目前 GPS 即時位置',
          subtitle: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          category: 'gps',
          badge: 'GPS 即時定位',
          icon: '📍',
          lat,
          lon,
          zoom: 16
        });
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

  // GPS for Navigation Starting Address
  const handleUseGpsForNav = () => {
    if (!navigator.geolocation) {
      return;
    }
    setIsNavGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000000) / 1000000;
        const lon = Math.round(pos.coords.longitude * 1000000) / 1000000;
        const gpsStr = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        setNavAddressInput(gpsStr);
        setNavigationAddress(gpsStr);
        setIsNavGpsLoading(false);
      },
      (err) => {
        console.error('Nav GPS error:', err);
        setIsNavGpsLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  return (
    <div 
      className="fixed top-[72px] right-4 z-50 w-[360px] max-w-[calc(100vw-32px)] bg-[#161922]/98 backdrop-blur-md text-gray-100 rounded-xl shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 固定頂部標題列 (Fixed Header - 捲動內容時永不消失，X 按鈕隨時可點選) */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#161922] border-b border-[#262b38] shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <Settings className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">系統偏好設定</h2>
            <p className="text-[10px] text-gray-400">所有變更均會自動即時儲存</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsModalOpen(false)}
          className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#252a38] transition-colors cursor-pointer"
          title="關閉 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 獨立捲動內容區 (Scrollable Content Area) */}
      <div className="flex-1 overflow-y-auto p-4 pt-3 flex flex-col gap-4 text-gray-200 custom-scrollbar [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
        
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
              <div ref={suggestionsContainerRef} className="relative">
                <div className="relative">
                  <input
                    type="text"
                    value={addressInput}
                    onChange={(e) => {
                      setAddressInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true);
                    }}
                    placeholder="輸入溫哥華住址 (例如: 1200 Burrard St)"
                    className="w-full bg-[#12151d] text-xs text-white rounded-lg border border-[#343a4a] px-3 py-2 pr-8 focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-gray-500"
                  />
                  {addressInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddressInput('');
                        setSuggestions([]);
                        setShowSuggestions(false);
                      }}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 搜尋建議選單 */}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#191c26] border border-[#373e52] rounded-lg shadow-2xl overflow-hidden z-50 max-h-52 overflow-y-auto divide-y divide-[#282f42] [scrollbar-width:thin]">
                    <div className="px-2.5 py-1 text-[10px] text-gray-400 bg-[#141720] flex items-center justify-between">
                      <span>搜尋建議（點選立即確認）</span>
                      {isSuggesting && <RefreshCw className="w-2.5 h-2.5 animate-spin text-emerald-400" />}
                    </div>
                    {suggestions.map((item, idx) => (
                      <button
                        key={item.id || idx}
                        type="button"
                        onClick={() => {
                          isSelectingSuggestionRef.current = true;
                          setUserLocation({
                            address: item.title,
                            displayName: item.subtitle ? `${item.title} (${item.subtitle})` : item.title,
                            lat: item.lat,
                            lon: item.lon,
                            confirmed: true
                          });
                          setAddressInput(item.title);
                          setShowSuggestions(false);
                          setIsEditingAddress(false);
                          setGeocodeError(null);
                        }}
                        className="w-full text-left px-2.5 py-2 hover:bg-[#252b3d] transition-colors flex items-center gap-2 group cursor-pointer"
                      >
                        <span className="text-sm shrink-0 w-5 h-5 flex items-center justify-center bg-[#252a3a] rounded text-emerald-400">
                          {item.icon || '📍'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white group-hover:text-emerald-300 truncate">{item.title}</p>
                          {item.subtitle && <p className="text-[10px] text-gray-400 truncate">{item.subtitle}</p>}
                        </div>
                        {item.badge && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#202535] text-gray-300 shrink-0 font-medium">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
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

        {/* Setting: 導航地址 (Navigation Starting Address) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              <span>導航地址 (Navigation Address)</span>
            </label>
            <span className="text-[10px] text-gray-400">Google 導航出發點</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="relative">
              <input
                type="text"
                value={navAddressInput}
                onChange={(e) => {
                  setNavAddressInput(e.target.value);
                  setNavigationAddress(e.target.value.trim());
                }}
                placeholder="輸入導航起點地址 (例如: 1200 Burrard St)"
                className="w-full bg-[#12151d] text-xs text-white rounded-lg border border-[#343a4a] px-3 py-2 pr-8 focus:outline-none focus:border-cyan-500 transition-colors placeholder:text-gray-500"
              />
              {navAddressInput && (
                <button
                  type="button"
                  onClick={() => {
                    setNavAddressInput('');
                    setNavigationAddress('');
                  }}
                  className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                  title="清除導航地址"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUseGpsForNav}
                disabled={isNavGpsLoading}
                className="flex-1 py-1.5 px-3 bg-[#252a38] hover:bg-[#2e3446] text-cyan-300 rounded-lg text-xs font-medium border border-cyan-500/30 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isNavGpsLoading ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>定位中...</span>
                  </>
                ) : (
                  <>
                    <Navigation className="w-3 h-3 text-cyan-400" />
                    <span>GPS 定位出發點</span>
                  </>
                )}
              </button>
              {userLocation?.confirmed && (
                <button
                  type="button"
                  onClick={() => {
                    const addr = userLocation.displayName || userLocation.address;
                    setNavAddressInput(addr);
                    setNavigationAddress(addr);
                  }}
                  className="py-1.5 px-2.5 bg-[#1e2330] hover:bg-[#272e3f] text-gray-300 hover:text-white rounded-lg text-xs font-medium border border-[#343d52] transition-colors whitespace-nowrap"
                  title="同個人住址"
                >
                  同個人住址
                </button>
              )}
            </div>

            {navigationAddress && (
              <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>已設定出發點：{navigationAddress}</span>
              </p>
            )}
          </div>
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

        {/* Setting 3: 時區設定 (Timezone) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="timezone-select" className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>時區設定 (Timezone)</span>
            </label>
            <span className="text-[10px] text-gray-400">頂部時鐘與系統時間</span>
          </div>

          <div className="relative">
            <select
              id="timezone-select"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              className="w-full bg-[#1a1e28] border border-[#2c3242] focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 rounded-lg px-3 py-2 text-xs font-medium text-gray-200 outline-none transition-all appearance-none cursor-pointer pr-9 hover:border-gray-500"
            >
              <option value="America/Vancouver" className="bg-[#1a1b1e] text-white">溫哥華 Vancouver (本地預設 · PDT/PST GMT-7)</option>
              <option value="auto" className="bg-[#1a1b1e] text-white">自動 Auto (跟隨裝置系統本地時區)</option>
              <option value="Asia/Hong_Kong" className="bg-[#1a1b1e] text-white">香港 / 台北 Hong Kong / Taipei (HKT/CST GMT+8)</option>
              <option value="Asia/Tokyo" className="bg-[#1a1b1e] text-white">東京 / 首爾 Tokyo / Seoul (JST/KST GMT+9)</option>
              <option value="America/Toronto" className="bg-[#1a1b1e] text-white">多倫多 / 紐約 Toronto / New York (EDT/EST GMT-4)</option>
              <option value="Europe/London" className="bg-[#1a1b1e] text-white">倫敦 London (BST/GMT GMT+1)</option>
              <option value="Australia/Sydney" className="bg-[#1a1b1e] text-white">雪梨 Sydney (AEST/AEDT GMT+10)</option>
              <option value="UTC" className="bg-[#1a1b1e] text-white">世界協調時間 UTC (GMT+0)</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-400">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>

          {/* 當前時區說明標籤 */}
          <div className="text-[10.5px] text-gray-400 flex items-center gap-1.5 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></span>
            <span>
              {timeZone === 'America/Vancouver' && '目前設定：溫哥華太平洋時間 (永久單一時間制 GMT-7 / PDT)'}
              {timeZone === 'auto' && '目前設定：跟隨您目前設備系統的本地時間與時區'}
              {timeZone === 'Asia/Hong_Kong' && '目前設定：亞洲中原標準時間 (香港 / 台北 GMT+8)'}
              {timeZone === 'Asia/Tokyo' && '目前設定：日本 / 韓國標準時間 (東京 / 首爾 GMT+9)'}
              {timeZone === 'America/Toronto' && '目前設定：北美東部時間 (多倫多 / 紐約 EDT/EST)'}
              {timeZone === 'Europe/London' && '目前設定：英國標準時間 (倫敦 BST/GMT)'}
              {timeZone === 'Australia/Sydney' && '目前設定：澳洲東部時間 (雪梨 AEST/AEDT)'}
              {timeZone === 'UTC' && '目前設定：世界協調時間 (UTC GMT+0)'}
            </span>
          </div>
        </div>

        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Setting 4: 地圖比例尺單位 (Map Scale Unit) */}
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

        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Setting 5: 氣溫單位 (Temperature Unit) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <Thermometer className="w-3.5 h-3.5 text-amber-400" />
              <span>氣溫單位 (Temperature Unit)</span>
            </label>
            <span className="text-[10px] text-gray-400">探索面板天氣顯示</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTemperatureUnit('celsius')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                temperatureUnit === 'celsius'
                  ? 'bg-amber-950/50 border-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.2)] ring-1 ring-amber-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">攝氏度 (°C)</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">加拿大標準單位</div>
              </div>
              {temperatureUnit === 'celsius' && (
                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setTemperatureUnit('fahrenheit')}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                temperatureUnit === 'fahrenheit'
                  ? 'bg-amber-950/50 border-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.2)] ring-1 ring-amber-500/50'
                  : 'bg-[#1a1e28] border-[#2c3242] text-gray-300 hover:bg-[#232938] hover:text-white'
              }`}
            >
              <div>
                <div className="text-xs font-bold">華氏度 (°F)</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">美制常用單位</div>
              </div>
              {temperatureUnit === 'fahrenheit' && (
                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
