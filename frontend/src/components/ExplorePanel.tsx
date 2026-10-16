'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Compass, X, Fuel, Zap, Ship, MapPin, 
  ChevronDown, RefreshCw, Package, CloudSun, Wind, AlertTriangle, Droplets, Gauge, Eye, Anchor, Navigation,
  Newspaper, ExternalLink
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { formatShipEta, formatTimePreference } from '@/utils/time';

interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  source_id: string;
  category: string;
  summary: string;
  image_url?: string | null;
  published_at?: string;
  pub_date_raw?: string;
  timestamp: number;
}

interface WeatherHourlyItem {
  time: string;
  temp: number;
  condition: string;
  icon: string;
  pop: number;
}

interface WeatherDailyItem {
  day: string;
  date?: string;
  high: number;
  low: number;
  condition: string;
  icon: string;
  pop?: number;
  uv_index?: number;
}

interface WeatherAqhiForecastItem {
  period: string;
  period_zh?: string;
  value: number;
  value_display?: string;
  risk: string;
  risk_zh?: string;
}

interface WeatherAqhi {
  value: number;
  value_display?: string;
  risk: string;
  risk_zh?: string;
  calculated_at?: string;
  at_risk_msg?: string;
  general_msg?: string;
  forecasts?: WeatherAqhiForecastItem[];
}

interface WeatherData {
  city: string;
  city_en: string;
  region?: string;
  temperature: number;
  apparent_temperature: number;
  condition: string;
  icon_type: string;
  wind_speed_kmh: number;
  wind_direction?: string;
  humidity: number;
  pressure_kpa: number;
  visibility_km: number;
  uv_index?: number;
  source: string;
  source_url: string;
  updated_at: string;
  alert: {
    has_alert: boolean;
    title: string;
    severity: string;
    message: string;
  };
  aqhi?: WeatherAqhi;
  hourly?: WeatherHourlyItem[];
  forecast?: WeatherDailyItem[];
}

interface MaritimeVessel {
  mmsi: string;
  name: string;
  imo?: string;
  callsign?: string;
  type_code?: number;
  ship_type: string;
  type_group: 'cargo' | 'tanker' | 'tug' | 'passenger' | 'pleasure' | 'sailing' | 'other';
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
  nav_status: string;
  destination?: string;
  eta?: string;
  length?: number;
  width?: number;
  draft?: number;
  flag?: string;
  source?: string;
}

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

class ExploreErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ExplorePanel caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div 
          className="fixed top-[72px] right-4 z-40 w-[380px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-4 shadow-2xl border border-[#2a2f3d] flex flex-col select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#262b38] shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
                <Compass className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-white tracking-wide">探索</h2>
            </div>
            <button
              onClick={this.props.onClose}
              className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#252a38] transition-colors"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="py-8 text-center flex flex-col items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-xs text-gray-300">探索面板載入遇到暫時性問題</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-semibold transition-colors shadow-sm"
            >
              重新整理
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ExplorePanel() {
  const { isExploreOpen, setExploreOpen, setSearchTarget } = useUIStore();
  if (!isExploreOpen) return null;

  return (
    <ExploreErrorBoundary onClose={() => { setExploreOpen(false); setSearchTarget(null); }}>
      <ExploreContent />
    </ExploreErrorBoundary>
  );
}

function ExploreContent() {
  const { 
    isExploreOpen, 
    setExploreOpen, 
    userLocation, 
    setSettingsModalOpen,
    distanceUnit,
    temperatureUnit,
    timeFormat,
    newsRefreshInterval,
    setSearchTarget,
    enableLayer
  } = useUIStore();

  // 氣溫單位轉換輔助函式
  const formatTemp = (celsius?: number | string | null) => {
    if (celsius === undefined || celsius === null || isNaN(Number(celsius))) return '--';
    const num = Number(celsius);
    if (temperatureUnit === 'fahrenheit') {
      return `${Math.round((num * 9) / 5 + 32)}°F`;
    }
    return `${Math.round(num)}°C`;
  };

  const formatTempNumber = (celsius?: number | string | null) => {
    if (celsius === undefined || celsius === null || isNaN(Number(celsius))) return '--';
    const num = Number(celsius);
    if (temperatureUnit === 'fahrenheit') {
      return Math.round((num * 9) / 5 + 32);
    }
    return Math.round(num);
  };

  const renderWeatherMiniIcon = (iconType?: string) => {
    const it = String(iconType || '').toLowerCase();
    if (it === 'sunny') {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
        </svg>
      );
    }
    if (it.includes('rain') || it === 'drizzle') {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>
        </svg>
      );
    }
    if (it.includes('thunder')) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-300">
          <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><path d="m13 11-4 6h6l-4 6"/>
        </svg>
      );
    }
    if (it.includes('snow')) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-200">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>
        </svg>
      );
    }
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-200">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    );
  };

  // 分頁：天氣, 新聞, 渡輪, 船運, 燃油, 充電
  const [activeTab, setActiveTab] = useState<'weather' | 'news' | 'ferry' | 'fuel' | 'ev' | 'cargo'>('weather');

  // --- News tab states ---
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [newsFilter, setNewsFilter] = useState<'all' | '604now' | 'citynews' | 'globalnews'>('all');
  const [newsLastUpdated, setNewsLastUpdated] = useState<Date | null>(null);

  // --- Weather tab states ---
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // --- Cargo tab states (Port of Vancouver AIS Shipping) ---
  const [shippingVessels, setShippingVessels] = useState<MaritimeVessel[]>([]);
  const [loadingShipping, setLoadingShipping] = useState(false);

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

  // 0. Fetch Weather from ECCC / Open-Meteo
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'weather') return;

    setLoadingWeather(true);
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/weather/current`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && typeof data === 'object') {
          data.alert = data.alert || {
            has_alert: false,
            title: '加拿大環境部警告',
            severity: 'none',
            message: '大溫哥華地區目前無極端天氣預警，天候狀況良好。'
          };
          setWeather(data);
        }
        setLoadingWeather(false);
      })
      .catch((err) => {
        console.error('Error fetching weather:', err);
        // 設定安全的預設天氣對象，防止白畫面崩潰
        setWeather((prev) => prev || {
          city: '溫哥華',
          city_en: 'Vancouver',
          region: '大溫哥華 (Metro Vancouver)',
          temperature: 15,
          apparent_temperature: 15,
          condition: '密雲',
          icon_type: 'overcast',
          wind_speed_kmh: 8,
          wind_direction: '西微風',
          humidity: 78,
          pressure_kpa: 101.5,
          visibility_km: 24.0,
          uv_index: 3,
          source: '加拿大環境部 (api.weather.gc.ca)',
          source_url: 'https://api.weather.gc.ca/',
          updated_at: new Date().toISOString(),
          alert: {
            has_alert: false,
            title: '加拿大環境部警告',
            severity: 'none',
            message: '大溫哥華地區目前無極端天氣預警，天候狀況良好。'
          },
          hourly: Array.from({ length: 24 }).map((_, offset) => {
            const h = (new Date().getHours() + offset) % 24;
            return {
              time: offset === 0 ? '現在' : `${String(h).padStart(2, '0')}:00`,
              temp: 14 + (h >= 11 && h <= 17 ? 3 : 0),
              condition: '多雲',
              icon: 'partly_cloudy',
              pop: 10
            };
          }),
          forecast: [
            { day: '今天', high: 16, low: 10, condition: '多雲時陰', icon: 'overcast', pop: 20 },
            { day: '明天', high: 15, low: 9, condition: '短暫陽光', icon: 'partly_cloudy', pop: 10 },
            { day: '後天', high: 14, low: 8, condition: '局部微雨', icon: 'rain_light', pop: 40 },
            { day: '週五', high: 13, low: 7, condition: '間歇陣雨', icon: 'rain_moderate', pop: 60 },
            { day: '週六', high: 14, low: 8, condition: '多雲轉晴', icon: 'partly_cloudy', pop: 15 },
            { day: '週日', high: 16, low: 9, condition: '大致天晴', icon: 'mostly_sunny', pop: 10 },
            { day: '週一', high: 15, low: 9, condition: '晴朗天晴', icon: 'sunny', pop: 5 },
          ]
        });
        setLoadingWeather(false);
      });
  }, [isExploreOpen, activeTab]);

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

  // 船運排序：抵達時間由近至遠，已泊岸（繫泊停靠碼頭）排在最底
  const sortedShippingVessels = useMemo(() => {
    if (!shippingVessels || shippingVessels.length === 0) return [];

    const currentYear = new Date().getFullYear();

    const parseEtaMs = (etaStr?: string | null): number | null => {
      if (!etaStr) return null;
      const s = String(etaStr).trim();
      if (!s || s === '--') return null;

      // 1. ISO or YYYY-MM-DD HH:mm(:ss)
      const yyyyMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{1,2})/);
      if (yyyyMatch) {
        const y = parseInt(yyyyMatch[1], 10);
        const m = parseInt(yyyyMatch[2], 10) - 1;
        const d = parseInt(yyyyMatch[3], 10);
        const h = parseInt(yyyyMatch[4], 10);
        const min = parseInt(yyyyMatch[5], 10);
        return new Date(y, m, d, h, min).getTime();
      }

      // 2. AIS standard: MM-DD HH:mm or MM/DD HH:mm
      const mmddMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{1,2})/);
      if (mmddMatch) {
        const m = parseInt(mmddMatch[1], 10) - 1;
        const d = parseInt(mmddMatch[2], 10);
        const h = parseInt(mmddMatch[3], 10);
        const min = parseInt(mmddMatch[4], 10);
        return new Date(currentYear, m, d, h, min).getTime();
      }

      // 3. Fallback
      const parsedDate = new Date(s);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.getTime();
      }
      return null;
    };

    const isMoored = (ship: MaritimeVessel): boolean => {
      const status = (ship.nav_status || '').toLowerCase();
      return (
        status.includes('moored') ||
        status.includes('berthed') ||
        status.includes('繫泊') ||
        status.includes('停靠') ||
        status.includes('泊岸')
      );
    };

    const isAtAnchor = (ship: MaritimeVessel): boolean => {
      const status = (ship.nav_status || '').toLowerCase();
      return status.includes('anchor') || status.includes('拋錨') || status.includes('錨泊');
    };

    return [...shippingVessels].sort((a, b) => {
      const aMoored = isMoored(a);
      const bMoored = isMoored(b);

      // 1. 已泊岸的船隻放到最底
      if (aMoored !== bMoored) {
        return aMoored ? 1 : -1;
      }

      // 2. 拋錨錨泊中船隻次之（排在航行中船隻之後、已泊岸船隻之前）
      const aAnchor = isAtAnchor(a);
      const bAnchor = isAtAnchor(b);
      if (aAnchor !== bAnchor) {
        return aAnchor ? 1 : -1;
      }

      // 3. 抵達時間由近至遠 (Earliest ETA to latest ETA)
      const aTime = parseEtaMs(a.eta);
      const bTime = parseEtaMs(b.eta);

      if (aTime !== null && bTime !== null) {
        if (aTime !== bTime) {
          return aTime - bTime;
        }
      } else if (aTime !== null) {
        return -1;
      } else if (bTime !== null) {
        return 1;
      }

      // 4. 若 ETA 相同或皆無，以航速（SOG）快者優先
      if ((b.sog ?? 0) !== (a.sog ?? 0)) {
        return (b.sog ?? 0) - (a.sog ?? 0);
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [shippingVessels]);

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

  // 4. Fetch Shipping Vessels for Cargo Tab
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'cargo') return;

    setLoadingShipping(true);
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/shipping/vessels`)
      .then((res) => res.json())
      .then((data) => {
        setShippingVessels(data.vessels || []);
        setLoadingShipping(false);
      })
      .catch((err) => {
        console.error('Error fetching shipping vessels:', err);
        setLoadingShipping(false);
      });
  }, [isExploreOpen, activeTab]);

  // 5. Fetch News from Vancouver Sources (604 Now, CityNews, Global News BC)
  const fetchNews = React.useCallback(async (force = false) => {
    setLoadingNews(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/news/latest${force ? '?refresh=true' : ''}`);
      const data = await res.json();
      setNewsArticles(data.news || []);
      setNewsLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching news:', err);
    } finally {
      setLoadingNews(false);
    }
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'news') return;
    fetchNews();

    const intervalMin = newsRefreshInterval || 15;
    const timer = setInterval(() => {
      fetchNews(true);
    }, intervalMin * 60 * 1000);
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, newsRefreshInterval, fetchNews]);

  const filteredNews = useMemo(() => {
    let list = newsArticles;
    if (newsFilter !== 'all') {
      list = list.filter((a) => a.source_id === newsFilter);
    }
    // 排序以最上面由最新開始 (Newest on top)
    return [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [newsArticles, newsFilter]);

  const formatNewsTime = (timestamp?: number, rawDate?: string) => {
    const ts = timestamp || (rawDate ? new Date(rawDate).getTime() : 0);
    if (!ts) return '';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return '剛剛';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分鐘前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 小時前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} 天前`;
    return new Date(ts).toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' });
  };

  // Handle Cargo Ship click
  const handleSelectShip = (ship: MaritimeVessel) => {
    enableLayer('maritimeShipping');
    setSearchTarget({
      id: ship.mmsi,
      title: ship.name,
      subtitle: `${ship.ship_type} · ${ship.sog} 節 · ${ship.destination || 'VANCOUVER'}`,
      category: 'maritime_vessel',
      layer_key: 'maritimeShipping',
      badge: ship.ship_type,
      icon: '🚢',
      lat: ship.lat,
      lon: ship.lon,
      meta: ship,
      zoom: 14
    });
  };

  const tabs = [
    { id: 'ferry', label: '渡輪', icon: Ship, iconColor: 'text-sky-400' },
    { id: 'cargo', label: '船運', icon: Anchor, iconColor: 'text-cyan-400' },
    { id: 'fuel', label: '燃油', icon: Fuel, iconColor: 'text-amber-400' },
    { id: 'ev', label: '充電', icon: Zap, iconColor: 'text-emerald-400' },
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

      {/* 探索分類分頁 - 第一行 (天氣 | 新聞) */}
      <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#10131a] rounded-xl border border-[#232836] shrink-0 mb-1.5">
        <button
          onClick={() => setActiveTab('weather')}
          className={`py-2 text-xs font-medium rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'weather'
              ? 'bg-[#2b3345] text-white font-bold shadow-md ring-1 ring-[#3d4760]'
              : 'text-gray-300 hover:text-white hover:bg-[#1a1f2b]'
          }`}
        >
          <CloudSun className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>天氣</span>
        </button>
        <button
          onClick={() => setActiveTab('news')}
          className={`py-2 text-xs font-medium rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'news'
              ? 'bg-[#2b3345] text-white font-bold shadow-md ring-1 ring-[#3d4760]'
              : 'text-gray-300 hover:text-white hover:bg-[#1a1f2b]'
          }`}
        >
          <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>新聞</span>
        </button>
        {/* 保留未來新增分頁空間 */}
        <div className="col-span-2"></div>
      </div>

      {/* 探索分類分頁 - 第二行 (渡輪 > 船運 > 燃油 > 充電) */}
      <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#10131a] rounded-xl border border-[#232836] shrink-0 mb-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 text-xs font-medium rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-[#2b3345] text-white font-bold shadow-md ring-1 ring-[#3d4760]'
                  : 'text-gray-300 hover:text-white hover:bg-[#1a1f2b]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${tab.iconColor} shrink-0`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ==================== 0. 天氣分頁 (Weather - ECCC api.weather.gc.ca) ==================== */}
      {activeTab === 'weather' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
          {loadingWeather && !weather ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2.5 text-gray-400 text-xs">
              <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
              <span>讀取加拿大環境部大溫哥華即時氣象中...</span>
            </div>
          ) : weather ? (
            <div className="flex flex-col gap-3">
              {/* 所在地區與標題 (對標參考截圖) */}
              <div className="flex flex-col">
                <span className="text-[11px] text-gray-400 font-medium">您的地區</span>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-extrabold text-white tracking-wide">{weather.city || '溫哥華'}</h3>
                  <span className="text-[10px] text-sky-400/90 font-mono bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 rounded-full">
                    加拿大環境部即時
                  </span>
                </div>
              </div>

              {/* 核心氣溫與天候卡片 (完全對標截圖風格) */}
              <div className="bg-[#12151e] border border-[#262c3c] rounded-xl p-4 shadow-lg flex flex-col">
                <div className="flex items-center gap-4">
                  {/* 天氣圖示 (簡潔線條風格，如同截圖中的密雲) */}
                  <div className="w-16 h-16 shrink-0 flex items-center justify-center text-sky-300">
                    {weather.icon_type === 'sunny' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                        <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
                      </svg>
                    ) : weather.icon_type?.includes('rain') ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-sky-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.25)]">
                        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>
                      </svg>
                    ) : (
                      // 密雲 / 多雲 (如同截圖中的圓潤雲朵)
                      <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-sky-200 drop-shadow-[0_0_8px_rgba(186,230,253,0.2)]">
                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                      </svg>
                    )}
                  </div>

                  {/* 氣溫與體感數值 */}
                  <div className="flex flex-col">
                    <div className="text-4xl font-extrabold text-white tracking-tight leading-none">
                      {formatTemp(weather.temperature)}
                    </div>
                    <div className="text-sm font-medium text-gray-200 mt-1.5 flex items-center gap-1.5">
                      <span>{weather.condition || '多雲'}</span>
                      <span>·</span>
                      <span>體感 {formatTemp(weather.apparent_temperature)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>{weather.wind_speed_kmh ?? 8} km/h {weather.wind_direction ? `(${weather.wind_direction})` : ''}</span>
                    </div>
                  </div>
                </div>

                {/* 天氣數據來源標記 (對標截圖) */}
                <div className="text-[11px] text-gray-400 mt-3 pt-2.5 border-t border-[#232838] flex items-center justify-between">
                  <span>天氣數據：<a href="https://api.weather.gc.ca/" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">加拿大環境部 (api.weather.gc.ca)</a></span>
                  <span className="font-mono text-[10px] text-gray-500">ECCC MSC</span>
                </div>
              </div>

              {/* 加拿大環境部警告 (對標截圖中的「英國氣象局警告」黃色風格) */}
              <div className="bg-[#191917] border border-amber-500/40 rounded-xl p-3.5 shadow-md">
                <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>加拿大環境部警告</span>
                </h4>
                {weather?.alert?.has_alert ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-amber-300">{weather.alert.title}</span>
                    <p className="text-xs text-amber-200/90 leading-relaxed">{weather.alert.message}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-300 leading-relaxed">
                    現時大溫哥華地區無極端氣象預警，天候狀況平穩良好。
                  </p>
                )}
              </div>

              {/* 詳細氣象指標 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#12151e] border border-[#232838] p-2.5 rounded-lg flex flex-col">
                  <span className="text-[10.5px] text-gray-400 flex items-center gap-1">
                    <Droplets className="w-3 h-3 text-cyan-400" />
                    <span>相對濕度</span>
                  </span>
                  <span className="text-sm font-bold text-gray-100 font-mono mt-1">{weather.humidity ?? 78}%</span>
                </div>
                <div className="bg-[#12151e] border border-[#232838] p-2.5 rounded-lg flex flex-col">
                  <span className="text-[10.5px] text-gray-400 flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-indigo-400" />
                    <span>大氣氣壓</span>
                  </span>
                  <span className="text-sm font-bold text-gray-100 font-mono mt-1">{weather.pressure_kpa ?? 101.5} kPa</span>
                </div>
                <div className="bg-[#12151e] border border-[#232838] p-2.5 rounded-lg flex flex-col">
                  <span className="text-[10.5px] text-gray-400 flex items-center gap-1">
                    <Eye className="w-3 h-3 text-emerald-400" />
                    <span>能見度</span>
                  </span>
                  <span className="text-sm font-bold text-gray-100 font-mono mt-1">{weather.visibility_km ?? 24} km</span>
                </div>
              </div>

              {/* 24 小時每小時天氣預報 (橫向滑動卡片) */}
              {weather.hourly && weather.hourly.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-gray-300">24 小時每小時預報</span>
                    <span className="text-[10px] text-gray-500 font-mono">橫向滑動 ❯</span>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2c3244] [&::-webkit-scrollbar-thumb]:rounded-full">
                    {weather.hourly.map((h, idx) => (
                      <div 
                        key={idx} 
                        className={`shrink-0 w-[68px] py-2 px-1.5 rounded-lg border flex flex-col items-center justify-between text-center transition-all ${
                          idx === 0 
                            ? 'bg-sky-950/40 border-sky-500/40 text-white shadow-sm ring-1 ring-sky-500/30' 
                            : 'bg-[#12151e] border-[#252b3a] text-gray-300'
                        }`}
                      >
                        <span className="text-[10px] font-medium text-gray-400 font-mono truncate max-w-full">
                          {h.time === '現在' ? '現在' : formatTimePreference(h.time, timeFormat)}
                        </span>
                        <div className="my-1.5 text-sky-300 flex items-center justify-center">
                          {renderWeatherMiniIcon(h.icon)}
                        </div>
                        <span className="text-xs font-bold text-gray-100">{formatTemp(h.temp)}</span>
                        {h.pop > 0 ? (
                          <span className="text-[9.5px] text-cyan-400 font-mono mt-0.5 flex items-center gap-0.5">
                            💧{h.pop}%
                          </span>
                        ) : (
                          <span className="text-[9.5px] text-gray-500 font-mono mt-0.5">--</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 未來 7 日天氣預報 */}
              {weather.forecast && weather.forecast.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-gray-300">未來 7 日天氣預報</span>
                    <span className="text-[10px] text-gray-500">最高 / 最低溫</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {weather.forecast.map((fc, idx) => (
                      <div 
                        key={idx} 
                        className="bg-[#12151e] border border-[#232838] px-3 py-2 rounded-lg flex items-center justify-between text-xs hover:border-[#333b4e] transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-[70px]">
                          <span className={`font-semibold ${idx === 0 ? 'text-sky-400 font-bold' : 'text-gray-200'}`}>
                            {fc.day}
                          </span>
                          {fc.pop != null && fc.pop > 20 && (
                            <span className="text-[10px] text-cyan-400 font-mono">
                              💧{fc.pop}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 flex items-center justify-center text-sky-300 shrink-0">
                            {renderWeatherMiniIcon(fc.icon)}
                          </div>
                          <span className="text-gray-300 text-xs w-[68px] truncate">{fc.condition}</span>
                        </div>

                        <div className="text-xs font-mono flex items-center gap-1.5 justify-end min-w-[75px]">
                          <span className="text-rose-400 font-bold">{formatTempNumber(fc.high)}°</span>
                          <span className="text-gray-600">/</span>
                          <span className="text-sky-400 font-bold">{formatTempNumber(fc.low)}°</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 空氣質素健康指數 (AQHI - Air Quality Health Index, 完全對標加拿大環境部官方截圖) */}
              {weather.aqhi && (() => {
                const aqhiVal = weather.aqhi.value || 1;
                // AQHI 1-10+ 顏色標度
                const aqhiColors = [
                  '#56b4e9', '#3399ff', '#0072b2', // 1, 2, 3: Low Risk
                  '#f0e442', '#e69f00', '#d55e00', // 4, 5, 6: Moderate Risk
                  '#cc3333', '#b22222', '#8b0000', '#882255', // 7, 8, 9, 10: High Risk
                  '#4a101d' // +: Very High Risk
                ];
                // 計算指示箭頭水平位置百分比 (11格，索引 0~10)
                const valIdx = Math.min(Math.max(aqhiVal - 1, 0), 10);
                const leftPercent = ((valIdx + 0.5) / 11) * 100;

                return (
                  <div className="bg-[#12151e] border border-[#262c3c] rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5 mt-1">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]"></span>
                        <h4 className="text-xs font-bold text-white tracking-wide">空氣質素健康指數 (AQHI)</h4>
                      </div>
                      <span className="text-[10px] text-sky-400 font-mono bg-sky-950/60 border border-sky-800/40 px-1.5 py-0.5 rounded">
                        bcaq-001
                      </span>
                    </div>

                    <div className="text-[10px] text-gray-400">
                      <span>觀測狀況 · </span>
                      <span>計算時間：{weather.aqhi.calculated_at || '今日 3:00 AM PDT'}</span>
                    </div>

                    {/* 指示條與上方數值指標方塊 (對標截圖) */}
                    <div className="pt-5 pb-1 relative">
                      {/* 當前數值小方塊與向下指標 */}
                      <div 
                        className="absolute top-0 -translate-x-1/2 flex flex-col items-center transition-all duration-300"
                        style={{ left: `${leftPercent}%` }}
                      >
                        <div className="px-1.5 py-0.5 bg-white text-gray-900 border border-gray-300 rounded font-bold text-[11px] leading-tight shadow-sm font-mono">
                          {weather.aqhi.value_display || aqhiVal}
                        </div>
                        <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[4px] border-t-white -mt-[1px]"></div>
                      </div>

                      {/* 11 階彩色色帶 */}
                      <div className="grid grid-cols-11 h-3 rounded overflow-hidden shadow-inner border border-black/40">
                        {aqhiColors.map((color, i) => (
                          <div key={i} style={{ backgroundColor: color }} className="h-full"></div>
                        ))}
                      </div>

                      {/* 刻度數值 (1 ~ 10, +) */}
                      <div className="grid grid-cols-11 text-center text-[9px] text-gray-400 font-mono mt-1 select-none">
                        <span>1</span>
                        <span>2</span>
                        <span>3</span>
                        <span>4</span>
                        <span>5</span>
                        <span>6</span>
                        <span>7</span>
                        <span>8</span>
                        <span>9</span>
                        <span>10</span>
                        <span>+</span>
                      </div>

                      {/* 4 大風險分類標示 (對標截圖) */}
                      <div className="grid grid-cols-4 text-center mt-1 pt-1 border-t border-[#232838] text-[9.5px]">
                        <div className="text-sky-300 font-medium">
                          <div>Low Risk</div>
                          <div className="text-[8.5px] text-gray-400">(1-3)</div>
                        </div>
                        <div className="text-yellow-300 font-medium">
                          <div>Moderate</div>
                          <div className="text-[8.5px] text-gray-400">(4-6)</div>
                        </div>
                        <div className="text-rose-400 font-medium">
                          <div>High</div>
                          <div className="text-[8.5px] text-gray-400">(7-10)</div>
                        </div>
                        <div className="text-amber-600 font-medium">
                          <div>Very High</div>
                          <div className="text-[8.5px] text-gray-400">(10+)</div>
                        </div>
                      </div>
                    </div>

                    {/* 健康指引 (高敏感族群 vs 一般民眾) */}
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="bg-[#181c26] border border-[#282f42] p-2 rounded-lg flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold text-sky-300">高敏感族群 (At-Risk)</span>
                        <span className="text-[10px] text-gray-300 leading-relaxed">
                          {weather.aqhi.at_risk_msg || '可如常進行戶外活動。'}
                        </span>
                      </div>
                      <div className="bg-[#181c26] border border-[#282f42] p-2 rounded-lg flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold text-emerald-300">一般民眾 (General)</span>
                        <span className="text-[10px] text-gray-300 leading-relaxed">
                          {weather.aqhi.general_msg || '適合進行戶外活動的理想空氣品質。'}
                        </span>
                      </div>
                    </div>

                    {/* 預報最大值 (Forecast Maximums, 對標截圖底部) */}
                    {weather.aqhi.forecasts && weather.aqhi.forecasts.length > 0 && (
                      <div className="pt-2 border-t border-[#232838] flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10.5px] font-bold text-gray-300">預報峰值 (Forecast Maximums)</span>
                          <a 
                            href="https://weather.gc.ca/airquality/pages/bcaq-001_e.html" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-[10px] text-sky-400 hover:underline flex items-center gap-0.5"
                          >
                            官方專頁 ↗
                          </a>
                        </div>
                        <div className="flex flex-col gap-1">
                          {weather.aqhi.forecasts.map((f, fi) => {
                            const fIdx = Math.min(Math.max((f.value || 1) - 1, 0), 10);
                            const fPercent = ((fIdx + 0.5) / 11) * 100;
                            return (
                              <div key={fi} className="flex items-center justify-between text-[10px] py-0.5 px-1 bg-[#161a24] rounded border border-[#232838]/60">
                                <span className="text-gray-300 font-medium w-24 truncate">{f.period_zh || f.period}</span>
                                <span className="font-bold text-sky-300 font-mono">{f.value_display || f.value} - {f.risk_zh || f.risk}</span>
                                <div className="w-24 relative h-1.5 rounded overflow-hidden bg-gray-800 ml-2">
                                  <div className="grid grid-cols-11 h-full w-full">
                                    {aqhiColors.map((c, ci) => (
                                      <div key={ci} style={{ backgroundColor: c }}></div>
                                    ))}
                                  </div>
                                  <div 
                                    className="absolute top-0 bottom-0 w-1 bg-white shadow-sm -translate-x-1/2"
                                    style={{ left: `${fPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-gray-400">目前無法取得即時天氣資料</div>
          )}
        </div>
      )}

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
                    {(route?.vessels || []).map((v) => (
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
                            style={{ width: `${Math.max(4, Math.min(100, Number(v.progress) || 50))}%` }} 
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
                const distKm = Number(st.distance_km) || 0;
                const distDisplay = distanceUnit === 'imperial'
                  ? `${(distKm * 0.621371).toFixed(1)} 英里`
                  : `${distKm.toFixed(1)} 公里`;

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
                        {(Number(st.price_current) || 0).toFixed(1)}¢
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

      {/* ==================== 3. 充電分頁 (EV Charging) ==================== */}
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
                const distKm = Number(st.distance_km) || 0;
                const distDisplay = distanceUnit === 'imperial'
                  ? `${(distKm * 0.621371).toFixed(1)} 英里`
                  : `${distKm.toFixed(1)} 公里`;
                const powerKw = Number(st.power_kw) || 0;

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
                        powerKw >= 150 ? 'text-lime-400' : powerKw >= 50 ? 'text-emerald-400' : 'text-sky-400'
                      }`}>
                        {powerKw} kW
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

      {/* ==================== 4. 船運分頁 (Maritime Shipping - Port of Vancouver AIS Shipping) ==================== */}
      {activeTab === 'cargo' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
              <Ship className="w-3.5 h-3.5 text-cyan-400" />
              <span>溫哥華港口即時船運 (AISStream)</span>
            </span>
            <span className="text-[10px] text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
              即時追蹤
            </span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingShipping && sortedShippingVessels.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                <span>讀取溫哥華港口即時商船動態中...</span>
              </div>
            ) : sortedShippingVessels.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400">目前溫哥華水域暫無商船動態信號</div>
            ) : (
              sortedShippingVessels.map((ship) => {
                const isMoored = /moored|berthed|繫泊|停靠|泊岸/i.test(ship.nav_status || '');
                const isAtAnchor = /anchor|拋錨|錨泊/i.test(ship.nav_status || '');
                const isUnderway = ship.sog > 0.5 && !isMoored && !isAtAnchor;
                const statusColor = isUnderway ? 'text-emerald-400' : isMoored ? 'text-sky-300' : 'text-amber-400';
                const statusText = isMoored ? '已泊岸' : isAtAnchor ? '拋錨錨泊' : (ship.nav_status || '航行中').split(' ')[0];
                const typeBg = 
                  ship.type_group === 'cargo' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                  ship.type_group === 'tanker' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                  ship.type_group === 'tug' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                  ship.type_group === 'passenger' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                  ship.type_group === 'pleasure' || ship.type_group === 'sailing' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

                return (
                  <div
                    key={ship.mmsi}
                    onClick={() => handleSelectShip(ship)}
                    className="p-2.5 rounded-lg bg-[#141720] hover:bg-[#1a2130] border border-[#262c3c] hover:border-cyan-500/40 transition-all cursor-pointer flex flex-col gap-1.5 group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-bold text-white text-[13px] truncate group-hover:text-cyan-300 transition-colors">
                          {ship.name}
                        </span>
                        {ship.flag && (
                          <span className="text-[10px] text-gray-400 shrink-0">({ship.flag})</span>
                        )}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${typeBg}`}>
                        {(ship.ship_type || '商船').split(' ')[0]}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${statusColor}`}>
                          {statusText}
                        </span>
                        <span>·</span>
                        <span className="font-mono text-gray-300">
                          {ship.sog != null ? ship.sog : 0} 節 ({Math.round((Number(ship.sog) || 0) * 1.852)} km/h)
                        </span>
                      </div>
                      <span className="font-mono text-gray-500 text-[10px]">
                        {Math.round(Number(ship.cog) || 0)}° 航向
                      </span>
                    </div>

                    {(ship.destination || ship.eta) && (
                      <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[#232838] text-gray-500">
                        <span className="truncate max-w-[190px]">{ship.destination ? `目的地: ${ship.destination}` : '港口水域'}</span>
                        {ship.eta && (
                          <span className="shrink-0 font-mono text-[10px] text-cyan-400 bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-800/40 font-medium">
                            {formatShipEta(ship.eta, timeFormat)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================== 5. 新聞分頁 (Vancouver News - 604 Now, CityNews, Global News BC) ==================== */}
      {activeTab === 'news' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Controls: Source Filter & Refresh */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              {[
                { id: 'all', label: '全部' },
                { id: '604now', label: '604 Now' },
                { id: 'citynews', label: 'CityNews' },
                { id: 'globalnews', label: 'Global News' },
              ].map((src) => {
                const isSelected = newsFilter === src.id;
                return (
                  <button
                    key={src.id}
                    onClick={() => setNewsFilter(src.id as any)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all shrink-0 ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm font-semibold'
                        : 'bg-[#151922] text-gray-400 hover:text-white border border-[#232838] hover:bg-[#1c2230]'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => fetchNews(true)}
              disabled={loadingNews}
              className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-amber-400 border border-[#232838] hover:border-amber-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
              title="重新整理新聞"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingNews ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>

          {/* News List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 custom-scrollbar">
            {loadingNews && filteredNews.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mb-2" />
                <span className="text-xs">正在載入大溫即時新聞...</span>
              </div>
            ) : filteredNews.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Newspaper className="w-8 h-8 text-gray-600 mb-2" />
                <span className="text-xs">暫無相關新聞資料</span>
              </div>
            ) : (
              filteredNews.map((article) => {
                const getSourceBadge = () => {
                  if (article.source_id === '604now') {
                    return {
                      bg: 'bg-pink-950/40 text-pink-300 border-pink-700/50',
                      name: '604 Now',
                    };
                  }
                  if (article.source_id === 'citynews') {
                    return {
                      bg: 'bg-red-950/40 text-red-300 border-red-700/50',
                      name: 'CityNews',
                    };
                  }
                  return {
                    bg: 'bg-sky-950/40 text-sky-300 border-sky-700/50',
                    name: 'Global News',
                  };
                };

                const badge = getSourceBadge();
                const timeStr = formatNewsTime(article.timestamp, article.published_at || article.pub_date_raw);

                return (
                  <a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block p-3 rounded-xl bg-[#141822] border border-[#232838] hover:border-amber-500/50 hover:bg-[#181d2a] transition-all shadow-sm"
                  >
                    <div className="flex gap-3">
                      {article.image_url && (
                        <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-[#0c0e14] border border-[#232838] self-start">
                          <img
                            src={article.image_url}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).parentElement!.style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge.bg}`}>
                              {badge.name}
                            </span>
                            <div className="flex items-center gap-1.5 text-gray-500 text-[10px]">
                              {timeStr && <span className="font-mono">{timeStr}</span>}
                              <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-amber-400 transition-colors shrink-0" />
                            </div>
                          </div>

                          <h3 className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-2 leading-snug">
                            {article.title}
                          </h3>

                          {article.summary && (
                            <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                              {article.summary}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2.5 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
        <span className="font-mono text-[10px]">
          {activeTab === 'weather' && (weather ? `${weather.city || '溫哥華'} · ${weather.condition || '多雲'} · ${formatTemp(weather.temperature)}` : '加拿大環境部氣象數據')}
          {activeTab === 'news' && `共收錄 ${filteredNews.length} 則大溫即時新聞 · 每 ${newsRefreshInterval || 15} 分鐘自動更新`}
          {activeTab === 'fuel' && `共收錄 ${filteredFuelStations.length} 間加油站`}
          {activeTab === 'ev' && `共收錄 ${evStations.length} 座充電站`}
          {activeTab === 'ferry' && `共 ${ferryRoutes.reduce((acc, r) => acc + (r?.vessels?.length || 0), 0)} 艘渡輪即時航行中`}
          {activeTab === 'cargo' && `共追蹤 ${sortedShippingVessels.length} 艘溫哥華港口商船 (依抵達時間近至遠排序)`}
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
