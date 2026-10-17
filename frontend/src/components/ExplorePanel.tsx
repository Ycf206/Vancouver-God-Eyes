'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Compass, X, Fuel, Zap, Ship, MapPin, 
  ChevronDown, RefreshCw, Package, CloudSun, Wind, AlertTriangle, Droplets, Gauge, Eye, Anchor, Navigation,
  Newspaper, ExternalLink, Search, CalendarDays, Calendar, Tag, Waves, CloudRain, Play, Pause, SkipBack, SkipForward,
  MountainSnow, Sparkles, Clock, ShieldAlert, BellRing, Train, Bus, ShieldCheck, LayoutGrid, TrainTrack
} from 'lucide-react';
import { useUIStore, ExploreTabType } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { formatShipEta, formatTimePreference } from '@/utils/time';
import skytrainStationsData from '@/data/skytrainStations.json';

export interface TranslinkAlertItem {
  id: string;
  alertId: string;
  is_banner: boolean;
  mode: string;
  mode_name: string;
  routeId: string;
  routeLongName: string;
  effect: string;
  effect_zh: string;
  critical: boolean;
  advisory: boolean;
  alertText: string;
  header: string;
  description: string;
  url: string;
  startTime: string | null;
  endTime: string | null;
  lastModified: string | null;
  impacted_stations: string[];
  closed: boolean;
}

export interface TranslinkAlertsData {
  source: string;
  source_url: string;
  api_endpoint: string;
  banner_endpoint: string;
  updated_at: string;
  total: number;
  banners_count: number;
  alerts: TranslinkAlertItem[];
  station_alerts_map: Record<string, { critical: boolean; count: number; alert_ids: string[] }>;
}

interface AuroraVisibility {
  level: string;
  description: string;
  chance_pct: number;
  naked_eye: boolean;
  badge_color: string;
}

interface AuroraSpot {
  id: string;
  name: string;
  area: string;
  lat: number;
  lon: number;
  zoom: number;
  features: string;
  drive_min: string;
}

interface AuroraHistoryItem {
  time_tag: string;
  kp: number;
  a_running: number;
  g_scale: string;
  g_desc: string;
  g_color: string;
}

interface AuroraData {
  source: string;
  source_url: string;
  api_endpoint: string;
  update_frequency: string;
  last_updated: string;
  latest: {
    time_tag: string;
    kp: number;
    kp_int: number;
    g_scale: string;
    g_desc: string;
    g_color: string;
    visibility: AuroraVisibility;
  };
  history: AuroraHistoryItem[];
  spots: AuroraSpot[];
}

interface SkiResort {
  id: string;
  uid: number;
  name: string;
  english_name: string;
  area: string;
  lat: number;
  lon: number;
  zoom: number;
  vertical_drop: string;
  official_url: string;
  skiresort_url: string;
  status_raw: string;
  status_zh: string;
  is_open: boolean;
  season_range: string;
  slopes_open: number;
  slopes_total: number | string;
  slopes_label: string;
  lifts_open: number;
  lifts_total: number | string;
  lifts_label: string;
  snow_base: string;
  snow_top: string;
  altitude_base: string;
  altitude_top: string;
  last_snow: string;
  night_skiing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  weather?: any[];
  data_source: string;
}

interface EventItem {
  id: string;
  title: string;
  url: string;
  source: string;
  source_id: string;
  start_date: string;
  end_date?: string;
  location_name?: string;
  category: string;
  description: string;
  image_url?: string | null;
  timestamp: number;
  is_ongoing?: boolean;
}

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

interface BeachItem {
  id: string;
  object_id: number;
  facility_type: string;
  name: string;
  area: string;
  municipality: string;
  health_authority: string;
  last_value: number | null;
  last_timestamp: number | null;
  last_date: string;
  status: 'safe' | 'advisory' | 'warning' | 'unknown';
  status_label: string;
  status_color: string;
  internet_link: string;
  photo_link: string;
  data_tag: string;
  center_lon: number;
  center_lat: number;
  update_frequency: string;
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

interface RadarFrame {
  time: number;
  path: string;
}

interface TideStation {
  station_id: string;
  code: string;
  name: string;
  english_name: string;
  area: string;
  lat: number;
  lon: number;
  current_water_level_m: number;
  state: string;
  state_trend: 'rising' | 'falling' | 'flat';
  next_high?: { time: string; value: number } | null;
  next_low?: { time: string; value: number } | null;
  predictions?: Array<{ time: string; value: number }>;
  data_source: string;
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

interface BorderCrossingBound {
  traveller_delay_min?: number | null;
  traveller_status?: string;
  standard_delay_min?: number | null;
  standard_status?: string;
  standard_lanes_open?: number;
  nexus_delay_min?: number | null;
  nexus_status?: string;
  nexus_lanes_open?: number;
  commercial_delay_min?: number | null;
  commercial_status?: string;
  nexus_open?: boolean;
  updated_at?: string;
}

interface BorderCrossing {
  id: string;
  name: string;
  english_name: string;
  cbsa_key?: string;
  cbp_key?: string;
  highway: string;
  lat: number;
  lon: number;
  zoom?: number;
  address?: string;
  hours?: string;
  crossing_type?: string;
  has_nexus?: boolean;
  has_commercial?: boolean;
  tips?: string;
  canada_bound?: BorderCrossingBound;
  us_bound?: BorderCrossingBound;
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  try {
                    useUIStore.getState().setExploreTab('weather');
                  } catch (_) {}
                  this.setState({ hasError: false });
                }}
                className="px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-semibold transition-colors shadow-sm"
              >
                返回天氣分頁
              </button>
              <button
                onClick={() => this.setState({ hasError: false })}
                className="px-3 py-1.5 text-xs bg-[#252a38] hover:bg-[#32384a] text-gray-300 rounded-md font-medium transition-colors"
              >
                重新整理
              </button>
            </div>
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
    exploreTab,
    setExploreTab,
    userLocation, 
    setSettingsModalOpen,
    distanceUnit,
    temperatureUnit,
    timeFormat,
    newsRefreshInterval,
    setNewsRefreshInterval,
    transitAlertsRefreshInterval,
    setTransitAlertsRefreshInterval,
    setStationAlertsMap,
    setSearchTarget,
    enableLayer,
    layers,
    toggleLayer,
    isRadarActive,
    setIsRadarActive,
    radarFrameTime,
    setRadarFrameTime,
    radarHost,
    setRadarHost,
    radarTilePath,
    setRadarTilePath
  } = useUIStore();

  // --- TransLink Alerts states ---
  const [transitAlertsData, setTransitAlertsData] = useState<TranslinkAlertsData | null>(null);
  const [loadingTransitAlerts, setLoadingTransitAlerts] = useState<boolean>(false);
  const [alertsSubTab, setAlertsSubTab] = useState<'all' | 'skytrain' | 'bus' | 'seabus' | 'wce'>('all');
  const [alertsSearchQuery, setAlertsSearchQuery] = useState<string>('');
  const [alertsEffectFilter, setAlertsEffectFilter] = useState<string>('all');
  const [alertsSortBy, setAlertsSortBy] = useState<'severity' | 'newest' | 'oldest'>('severity');

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

  // 分頁：天氣, 新聞, 活動, 滑雪, 燃油, 充電, 渡輪, 船運
  const activeTab = exploreTab || 'weather';
  const setActiveTab = setExploreTab;

  // --- Ski tab states ---
  const [skiResorts, setSkiResorts] = useState<SkiResort[]>([]);
  const [loadingSki, setLoadingSki] = useState(false);

  // --- Aurora tab states ---
  const [auroraData, setAuroraData] = useState<AuroraData | null>(null);
  const [loadingAurora, setLoadingAurora] = useState(false);

  // --- News tab states ---
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [newsFilter, setNewsFilter] = useState<'all' | '604now' | 'citynews' | 'globalnews' | 'dailyhive'>('all');
  const [newsSearchQuery, setNewsSearchQuery] = useState('');
  const [newsLastUpdated, setNewsLastUpdated] = useState<Date | null>(null);

  // --- Events tab states ---
  const [eventsList, setEventsList] = useState<EventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsFilter, setEventsFilter] = useState<'all' | 'daily_hive' | 'eventbrite' | 'destination_vancouver'>('all');
  const [eventsSearchQuery, setEventsSearchQuery] = useState('');

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

  // --- Border Crossings tab states ---
  const [borderCrossings, setBorderCrossings] = useState<BorderCrossing[]>([]);
  const [loadingBorder, setLoadingBorder] = useState(false);
  const [borderDirectionFilter, setBorderDirectionFilter] = useState<'all' | 'us' | 'canada'>('all');

  // --- Radar states ---
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isRadarPlaying, setIsRadarPlaying] = useState<boolean>(false);
  const [loadingRadar, setLoadingRadar] = useState<boolean>(false);

  // --- Coastal Tides states ---
  const [tideStations, setTideStations] = useState<TideStation[]>([]);
  const [loadingTides, setLoadingTides] = useState<boolean>(false);
  const [selectedTideCode, setSelectedTideCode] = useState<string | null>(null);

  // --- Beach Water Quality tab states ---
  const [beachList, setBeachList] = useState<BeachItem[]>([]);
  const [loadingBeach, setLoadingBeach] = useState<boolean>(false);
  const [beachSearchQuery, setBeachSearchQuery] = useState('');
  const [beachStatusFilter, setBeachStatusFilter] = useState<'all' | 'safe' | 'advisory' | 'warning'>('all');
  const [beachAuthorityFilter, setBeachAuthorityFilter] = useState<'all' | 'vch' | 'fraser'>('all');
  const [beachSortBy, setBeachSortBy] = useState<'best' | 'worst' | 'name'>('best');
  const [beachLastUpdated, setBeachLastUpdated] = useState<string>('');

  const fetchBeachWater = React.useCallback(async (force: boolean = false) => {
    setLoadingBeach(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/beach-water/live${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.beaches) && data.beaches.length > 0) {
          setBeachList(data.beaches);
          if (data.last_updated) {
            setBeachLastUpdated(data.last_updated);
          }
          setLoadingBeach(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend beach water API error, checking static cache:', err);
    }

    try {
      const staticRes = await fetch('/vancouver_beach_water_cache.json');
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        if (staticData && Array.isArray(staticData.beaches) && staticData.beaches.length > 0) {
          setBeachList(staticData.beaches);
          if (staticData.last_updated) {
            setBeachLastUpdated(staticData.last_updated);
          }
        }
      }
    } catch (staticErr) {
      console.error('Failed to load static beach water cache:', staticErr);
    } finally {
      setLoadingBeach(false);
    }
  }, []);

  // Pre-load beach water data on mount so filters and list work immediately without refresh
  useEffect(() => {
    if (beachList.length === 0) {
      fetchBeachWater(false);
    }
  }, [fetchBeachWater, beachList.length]);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'beach') return;
    fetchBeachWater(false);
  }, [isExploreOpen, activeTab, fetchBeachWater]);

  const handleToggleBeachLayer = () => {
    const isCurrentlyOn = layers?.beachWaterQuality;
    toggleLayer('beachWaterQuality');
    if (!isCurrentlyOn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
      if (mapInstance) {
        mapInstance.flyTo({
          center: [-123.16, 49.28],
          zoom: 12.5,
          essential: true
        });
      }
    }
  };

  const handleLocateBeach = (beach: BeachItem) => {
    enableLayer('beachWaterQuality');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (mapInstance) {
      mapInstance.flyTo({
        center: [beach.center_lon, beach.center_lat],
        zoom: 15,
        essential: true
      });
    }
  };

  const filteredAndSortedBeaches = useMemo(() => {
    return beachList
      .filter((b) => {
        if (beachStatusFilter !== 'all' && b.status !== beachStatusFilter) return false;
        if (beachAuthorityFilter === 'vch' && !b.health_authority.includes('Vancouver Coastal')) return false;
        if (beachAuthorityFilter === 'fraser' && !b.health_authority.includes('Fraser')) return false;
        if (beachSearchQuery.trim()) {
          const q = beachSearchQuery.trim().toLowerCase();
          const matchName = b.name.toLowerCase().includes(q);
          const matchArea = b.area.toLowerCase().includes(q);
          const matchMuni = b.municipality.toLowerCase().includes(q);
          if (!matchName && !matchArea && !matchMuni) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (beachSortBy === 'best') {
          const valA = a.last_value ?? 99999;
          const valB = b.last_value ?? 99999;
          return valA - valB;
        }
        if (beachSortBy === 'worst') {
          const valA = a.last_value ?? -1;
          const valB = b.last_value ?? -1;
          return valB - valA;
        }
        return a.name.localeCompare(b.name, 'zh-Hant');
      });
  }, [beachList, beachStatusFilter, beachAuthorityFilter, beachSearchQuery, beachSortBy]);

  const beachStats = useMemo(() => {
    let safe = 0;
    let advisory = 0;
    let warning = 0;
    for (const b of beachList) {
      if (b.status === 'safe') safe++;
      else if (b.status === 'advisory') advisory++;
      else if (b.status === 'warning') warning++;
    }
    return { safe, advisory, warning, total: beachList.length };
  }, [beachList]);

  // 0a. Fetch RainViewer radar dynamic frames
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'weather') return;
    setLoadingRadar(true);
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.host && data.radar) {
          const past = data.radar.past || [];
          const nowcast = data.radar.nowcast || [];
          const allFrames = [...past, ...nowcast];
          setRadarHost(data.host);
          setRadarFrames(allFrames);
          if (allFrames.length > 0) {
            const initialIdx = Math.max(0, past.length - 1);
            setCurrentFrameIndex(initialIdx);
            setRadarFrameTime(allFrames[initialIdx].time);
            setRadarTilePath(allFrames[initialIdx].path);
          }
        }
        setLoadingRadar(false);
      })
      .catch((err) => {
        console.warn('Error fetching radar data:', err);
        setLoadingRadar(false);
      });
  }, [isExploreOpen, activeTab, setRadarHost, setRadarFrameTime, setRadarTilePath]);

  // 0b. Radar Loop Player
  useEffect(() => {
    if (!isRadarPlaying || radarFrames.length === 0) return;
    const interval = setInterval(() => {
      setCurrentFrameIndex((prev) => {
        const next = (prev + 1) % radarFrames.length;
        setRadarFrameTime(radarFrames[next].time);
        setRadarTilePath(radarFrames[next].path);
        return next;
      });
    }, 750);
    return () => clearInterval(interval);
  }, [isRadarPlaying, radarFrames, setRadarFrameTime, setRadarTilePath]);

  // 0c. Fetch Coastal Tide Stations
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'weather') return;
    setLoadingTides(true);
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/tides/live`)
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.stations)) {
          setTideStations(data.stations);
        }
        setLoadingTides(false);
      })
      .catch((err) => {
        console.warn('Error fetching live tides:', err);
        setLoadingTides(false);
      });
  }, [isExploreOpen, activeTab]);

  const handleFrameChange = (idx: number) => {
    if (idx >= 0 && idx < radarFrames.length) {
      setCurrentFrameIndex(idx);
      setRadarFrameTime(radarFrames[idx].time);
      setRadarTilePath(radarFrames[idx].path);
    }
  };

  const handleToggleRadar = () => {
    setIsRadarActive(!isRadarActive);
  };

  const handleLocateTideStation = (st: TideStation) => {
    enableLayer('tideStations');
    setSelectedTideCode(st.code);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (mapInstance) {
      mapInstance.flyTo({
        center: [st.lon, st.lat],
        zoom: 14.5,
        essential: true
      });
    }
  };

  const formatRadarTime = (ts: number) => {
    if (!ts) return '--:--';
    const d = new Date(ts * 1000);
    const timeStr = d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Vancouver' });
    const nowTs = Math.floor(Date.now() / 1000);
    const diffMins = Math.round((ts - nowTs) / 60);
    if (Math.abs(diffMins) <= 5) {
      return `${timeStr} (最新即時)`;
    } else if (diffMins < 0) {
      return `${timeStr} (${Math.abs(diffMins)} 分鐘前)`;
    } else {
      return `${timeStr} (預測 +${diffMins} 分鐘)`;
    }
  };

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
  const fetchShippingVessels = React.useCallback(async () => {
    setLoadingShipping(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/shipping/vessels`);
      if (res.ok) {
        const data = await res.json();
        setShippingVessels(data.vessels || []);
      }
    } catch (err) {
      console.error('Error fetching shipping vessels:', err);
    } finally {
      setLoadingShipping(false);
    }
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'cargo') return;
    fetchShippingVessels();
    const interval = setInterval(fetchShippingVessels, 4000);
    return () => clearInterval(interval);
  }, [isExploreOpen, activeTab, fetchShippingVessels]);

  // 4b. Fetch Border Crossings Live Data (CBSA & CBP)
  const fetchBorderCrossings = React.useCallback(async (force = false) => {
    setLoadingBorder(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/border/wait-times${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.crossings) && data.crossings.length > 0) {
          setBorderCrossings(data.crossings);
          setLoadingBorder(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Border API network error, using fallback:', err);
    }

    const defaultCrossings: BorderCrossing[] = [
      {
        id: "peace_arch",
        name: "和平門關卡 (Peace Arch / Douglas)",
        english_name: "Peace Arch / Douglas Crossing",
        highway: "BC Hwy 99 ↔ US I-5",
        lat: 49.0022,
        lon: -122.7567,
        zoom: 15.5,
        hours: "24 小時全天開放",
        crossing_type: "旅客客車專用",
        has_nexus: true,
        has_commercial: false,
        tips: "大溫前往西雅圖最繁忙之主要客運通道，建議週末善用 NEXUS 通道或改道太平洋公路。",
        canada_bound: {
          traveller_delay_min: 5,
          traveller_status: "5 分鐘",
          commercial_delay_min: null,
          commercial_status: "不適用 (客運專用)",
          nexus_open: true
        },
        us_bound: {
          standard_delay_min: 10,
          standard_status: "10 分鐘",
          standard_lanes_open: 5,
          nexus_delay_min: 0,
          nexus_status: "免等候 (No Delay)",
          nexus_lanes_open: 2
        }
      },
      {
        id: "pacific_highway",
        name: "太平洋公路關卡 (Pacific Highway / 176 St)",
        english_name: "Pacific Highway (Truck Crossing)",
        highway: "BC Hwy 15 ↔ WA SR 543",
        lat: 49.0020,
        lon: -122.7350,
        zoom: 15.5,
        hours: "24 小時全天開放",
        crossing_type: "客車及商業貨運",
        has_nexus: true,
        has_commercial: true,
        tips: "大溫核心商業貨車通道與旅客替代通道，支援 FAST 商業快速車道與 NEXUS 車道。",
        canada_bound: {
          traveller_delay_min: 5,
          traveller_status: "5 分鐘",
          commercial_delay_min: 5,
          commercial_status: "5 分鐘",
          nexus_open: true
        },
        us_bound: {
          standard_delay_min: 5,
          standard_status: "5 分鐘",
          standard_lanes_open: 3,
          nexus_delay_min: 0,
          nexus_status: "免等候 (No Delay)",
          nexus_lanes_open: 1
        }
      },
      {
        id: "aldergrove",
        name: "奧爾德格羅夫關卡 (Aldergrove / Lynden)",
        english_name: "Aldergrove / Lynden",
        highway: "BC Hwy 13 ↔ WA SR 539",
        lat: 49.0021,
        lon: -122.4845,
        zoom: 15.5,
        hours: "08:00 - 24:00 (一般車道), NEXUS (12:00 - 20:00)",
        crossing_type: "旅客客車及部分商業",
        has_nexus: true,
        has_commercial: true,
        tips: "位於蘭里與阿伯茨福德交界，前往貝靈漢避開週末和平門長龍的捷徑。",
        canada_bound: {
          traveller_delay_min: 0,
          traveller_status: "免等候 (No Delay)",
          commercial_delay_min: 0,
          commercial_status: "免等候",
          nexus_open: true
        },
        us_bound: {
          standard_delay_min: 0,
          standard_status: "免等候 (No Delay)",
          standard_lanes_open: 2,
          nexus_delay_min: 0,
          nexus_status: "免等候",
          nexus_lanes_open: 1
        }
      },
      {
        id: "abbotsford_huntingdon",
        name: "阿伯茨福德關卡 (Abbotsford-Huntingdon / Sumas)",
        english_name: "Abbotsford-Huntingdon / Sumas",
        highway: "BC Hwy 11 ↔ WA SR 9",
        lat: 49.0022,
        lon: -122.2646,
        zoom: 15.5,
        hours: "24 小時全天開放",
        crossing_type: "客車及商業貨運",
        has_nexus: true,
        has_commercial: true,
        tips: "菲沙河谷東部重要通關樞紐，直達蘇馬斯 (Sumas)，往貝克山滑雪度假主要途徑。",
        canada_bound: {
          traveller_delay_min: 5,
          traveller_status: "5 分鐘",
          commercial_delay_min: 0,
          commercial_status: "免等候",
          nexus_open: true
        },
        us_bound: {
          standard_delay_min: 5,
          standard_status: "5 分鐘",
          standard_lanes_open: 2,
          nexus_delay_min: 0,
          nexus_status: "免等候",
          nexus_lanes_open: 1
        }
      },
      {
        id: "boundary_bay",
        name: "羅伯茨角關卡 (Boundary Bay / Point Roberts)",
        english_name: "Boundary Bay / Point Roberts",
        highway: "56th St (Tsawwassen)",
        lat: 49.0021,
        lon: -123.0682,
        zoom: 15.5,
        hours: "24 小時全天開放",
        crossing_type: "旅客客車及當地貨運",
        has_nexus: false,
        has_commercial: true,
        tips: "南三角洲 Tsawwassen 進入美國飛地 Point Roberts 的唯一步行/陸路關卡。",
        canada_bound: {
          traveller_delay_min: 0,
          traveller_status: "免等候 (No Delay)",
          commercial_delay_min: 0,
          commercial_status: "免等候",
          nexus_open: false
        },
        us_bound: {
          standard_delay_min: 0,
          standard_status: "免等候 (No Delay)",
          standard_lanes_open: 1,
          nexus_delay_min: 0,
          nexus_status: "免等候",
          nexus_lanes_open: 0
        }
      }
    ];

    setBorderCrossings(defaultCrossings);
    setLoadingBorder(false);
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'border') return;
    fetchBorderCrossings();
    const timer = setInterval(() => {
      fetchBorderCrossings(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, fetchBorderCrossings]);

  const handleSelectBorderCrossing = (crossing: BorderCrossing) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (mapInstance) {
      mapInstance.flyTo({
        center: [crossing.lon, crossing.lat],
        zoom: crossing.zoom || 15.5,
        essential: true
      });
    }
    setSearchTarget({
      id: `border_${crossing.id}`,
      title: crossing.name,
      subtitle: `${crossing.highway} · ${crossing.hours || '24小時開放'}`,
      category: 'border_crossing',
      badge: '邊境關口',
      icon: '🛂',
      lat: crossing.lat,
      lon: crossing.lon,
      zoom: crossing.zoom || 15.5,
      meta: crossing
    });
  };

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
    if (newsSearchQuery.trim()) {
      const q = newsSearchQuery.trim().toLowerCase();
      list = list.filter((a) =>
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.summary && a.summary.toLowerCase().includes(q)) ||
        (a.category && a.category.toLowerCase().includes(q))
      );
    }
    // 排序以最上面由最新開始 (Newest on top)
    return [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [newsArticles, newsFilter, newsSearchQuery]);

  // 6. Fetch Events from Vancouver Sources (Eventbrite & Destination Vancouver)
  const fetchEvents = React.useCallback(async (force = false) => {
    setLoadingEvents(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/events/latest${force ? '?refresh=true' : ''}`);
      const data = await res.json();
      setEventsList(data.events || []);
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'events') return;
    fetchEvents();
  }, [isExploreOpen, activeTab, fetchEvents]);

  // Filter events by source and search query
  const filteredEvents = useMemo(() => {
    let list = eventsList;
    if (eventsFilter !== 'all') {
      list = list.filter((e) => e.source_id === eventsFilter);
    }
    if (eventsSearchQuery.trim()) {
      const q = eventsSearchQuery.trim().toLowerCase();
      list = list.filter((e) =>
        (e.title && e.title.toLowerCase().includes(q)) ||
        (e.location_name && e.location_name.toLowerCase().includes(q)) ||
        (e.category && e.category.toLowerCase().includes(q)) ||
        (e.description && e.description.toLowerCase().includes(q))
      );
    }
    // 進行中活動優先置頂，即將舉行活動依日期由近至遠排序
    return [...list].sort((a, b) => {
      const aOngoing = a.is_ongoing ? 1 : 0;
      const bOngoing = b.is_ongoing ? 1 : 0;
      if (aOngoing !== bOngoing) return bOngoing - aOngoing;
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
  }, [eventsList, eventsFilter, eventsSearchQuery]);

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

  // 7. Fetch Ski Resorts Live Data
  const fetchSkiResorts = React.useCallback(async (force = false) => {
    setLoadingSki(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/ski/resorts${force ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && Array.isArray(data.resorts)) {
        setSkiResorts(data.resorts);
        setLoadingSki(false);
        return;
      }
    } catch (err) {
      console.warn('Backend ski API not responding, trying static cache:', err);
    }
    // Fallback to static cache
    try {
      const staticRes = await fetch('/vancouver_ski_resorts.json');
      const staticData = await staticRes.json();
      if (staticData && Array.isArray(staticData.resorts)) {
        setSkiResorts(staticData.resorts);
      }
    } catch (staticErr) {
      console.error('Failed to load static ski data:', staticErr);
    } finally {
      setLoadingSki(false);
    }
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'ski') return;
    fetchSkiResorts();
  }, [isExploreOpen, activeTab, fetchSkiResorts]);

  const handleSelectSkiResort = (resort: SkiResort) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (mapInstance) {
      mapInstance.flyTo({
        center: [resort.lon, resort.lat],
        zoom: 14.5,
        essential: true
      });
    }
    setSearchTarget({
      id: `ski_${resort.id}`,
      title: resort.name,
      subtitle: `${resort.english_name} · ${resort.status_zh}`,
      category: 'ski_resort',
      badge: '滑雪場',
      icon: '⛷️',
      lat: resort.lat,
      lon: resort.lon,
      meta: resort,
      zoom: 14.5
    });
  };

  // 8. Fetch Aurora SWPC Live Data
  const fetchAuroraData = React.useCallback(async (force = false) => {
    setLoadingAurora(true);
    const apiUrl = getApiUrl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizeAurora = (raw: any): AuroraData | null => {
      if (!raw) return null;
      if (Array.isArray(raw)) {
        const historyItems: AuroraHistoryItem[] = [];
        for (let i = 1; i < raw.length; i++) {
          const row = raw[i];
          if (Array.isArray(row) && row.length >= 2) {
            const timeTag = String(row[0]);
            const kpVal = parseFloat(row[1]) || 0;
            let gScale = 'G0';
            let gDesc = '平靜 (Quiet)';
            let gColor = '#10b981';
            if (kpVal >= 7) { gScale = 'G3+'; gDesc = '強烈磁暴 (Strong)'; gColor = '#f43f5e'; }
            else if (kpVal >= 6) { gScale = 'G2'; gDesc = '中度磁暴 (Moderate)'; gColor = '#f97316'; }
            else if (kpVal >= 5) { gScale = 'G1'; gDesc = '輕度磁暴 (Minor)'; gColor = '#eab308'; }
            else if (kpVal >= 4) { gScale = 'Active'; gDesc = '活躍 (Active)'; gColor = '#38bdf8'; }
            else if (kpVal >= 3) { gScale = 'Unsettled'; gDesc = '擾動 (Unsettled)'; gColor = '#34d399'; }
            historyItems.push({
              time_tag: timeTag,
              kp: kpVal,
              a_running: 0,
              g_scale: gScale,
              g_desc: gDesc,
              g_color: gColor
            });
          }
        }
        const last = historyItems[historyItems.length - 1] || {
          time_tag: new Date().toISOString(),
          kp: 1.67,
          a_running: 0,
          g_scale: 'G0',
          g_desc: '平靜 (Quiet)',
          g_color: '#10b981'
        };
        return {
          source: 'NOAA Space Weather Prediction Center (SWPC)',
          source_url: 'https://www.swpc.noaa.gov/products/planetary-k-index',
          api_endpoint: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
          update_frequency: '每天 2 次 (每 3 小時觀測)',
          last_updated: last.time_tag,
          latest: {
            ...last,
            kp_int: Math.round(last.kp),
            visibility: {
              level: last.kp >= 6 ? '極高 (High)' : last.kp >= 5 ? '中等 (Moderate)' : '低 (Low)',
              description: last.kp >= 5 ? '大溫哥華地區暗空處有機會以相機或肉眼觀測到極光' : '目前地磁平靜，大溫哥華地區暫無明顯極光活動。',
              chance_pct: Math.min(95, Math.round(last.kp * 10)),
              naked_eye: last.kp >= 6,
              badge_color: last.kp >= 6 ? 'text-rose-400 bg-rose-950/60' : 'text-emerald-400 bg-emerald-950/60'
            }
          },
          history: historyItems,
          spots: [
            { id: "cypress", name: "Cypress Mountain 觀景台", area: "West Vancouver", lat: 49.3565, lon: -123.1812, zoom: 13, features: "俯瞰溫哥華海灣，北面暗空無遮擋", drive_min: "距市中心約 35 分鐘" },
            { id: "porteau", name: "Porteau Cove 省立公園", area: "Sea-to-Sky Highway", lat: 49.5583, lon: -123.2389, zoom: 13, features: "大溫最知名暗空勝地，向北面峽灣開闊無光害", drive_min: "距市中心約 45 分鐘" },
            { id: "ionabeach", name: "Iona Beach Regional Park", area: "Richmond", lat: 49.2185, lon: -123.2125, zoom: 13, features: "平坦開闊海堤，向西北方視野無阻", drive_min: "距市中心約 30 分鐘" },
            { id: "boundarybay", name: "Boundary Bay Regional Park", area: "Delta / Tsawwassen", lat: 49.0333, lon: -123.0333, zoom: 12.5, features: "南方大暗空海灣，開闊地平線適合長焦與腳架", drive_min: "距市中心約 40 分鐘" }
          ]
        };
      }
      if (raw && raw.latest) {
        return {
          ...raw,
          history: Array.isArray(raw.history) ? raw.history : [],
          spots: Array.isArray(raw.spots) ? raw.spots : []
        };
      }
      return null;
    };

    try {
      const res = await fetch(`${apiUrl}/api/aurora/live${force ? '?force=true' : ''}`);
      if (res.ok) {
        const rawJson = await res.json();
        const norm = normalizeAurora(rawJson);
        if (norm) {
          setAuroraData(norm);
          setLoadingAurora(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend aurora API not responding, trying static cache:', err);
    }
    // Fallback to static cache if backend unreachable
    try {
      const staticRes = await fetch('/vancouver_aurora_cache.json');
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        const norm = normalizeAurora(staticData);
        if (norm) {
          setAuroraData(norm);
        }
      }
    } catch (staticErr) {
      console.error('Failed to load static aurora data:', staticErr);
    } finally {
      setLoadingAurora(false);
    }
  }, []);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'aurora') return;
    fetchAuroraData();
  }, [isExploreOpen, activeTab, fetchAuroraData]);

  const handleSelectAuroraSpot = (spot: AuroraSpot) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    if (mapInstance) {
      mapInstance.flyTo({
        center: [spot.lon, spot.lat],
        zoom: spot.zoom || 13.5,
        essential: true
      });
    }
    setSearchTarget({
      id: `aurora_${spot.id}`,
      title: spot.name,
      subtitle: `${spot.area} · 極光觀測點`,
      category: 'aurora_spot',
      badge: '極光觀測點',
      icon: '✨',
      lat: spot.lat,
      lon: spot.lon,
      meta: {
        local_area: spot.area,
        properties: {
          id: spot.id,
          name: spot.name,
          features: spot.features,
          drive_min: spot.drive_min
        }
      },
      zoom: spot.zoom || 13.5
    });
  };

  // 9. Fetch TransLink Live Alerts (SkyTrain, Bus, SeaBus, WCE)
  const fetchTranslinkAlerts = React.useCallback(async (force = false) => {
    setLoadingTransitAlerts(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/translink/alerts${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.alerts)) {
          setTransitAlertsData(data);
          if (data.station_alerts_map) {
            setStationAlertsMap(data.station_alerts_map);
          }
          setLoadingTransitAlerts(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend translink alerts API error, falling back to static cache:', err);
    }

    try {
      const staticRes = await fetch('/vancouver_translink_alerts_cache.json');
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        if (staticData && Array.isArray(staticData.alerts)) {
          setTransitAlertsData(staticData);
          if (staticData.station_alerts_map) {
            setStationAlertsMap(staticData.station_alerts_map);
          }
        }
      }
    } catch (staticErr) {
      console.error('Failed to load static translink alerts cache:', staticErr);
    } finally {
      setLoadingTransitAlerts(false);
    }
  }, [setStationAlertsMap]);

  // Pre-load transit alerts on mount if not loaded
  useEffect(() => {
    if (!transitAlertsData) {
      fetchTranslinkAlerts(false);
    }
  }, [fetchTranslinkAlerts, transitAlertsData]);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'alerts') return;
    fetchTranslinkAlerts();
  }, [isExploreOpen, activeTab, fetchTranslinkAlerts]);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'alerts') return;
    const intervalMin = transitAlertsRefreshInterval || 10;
    if (intervalMin <= 0) return;
    const timer = setInterval(() => {
      fetchTranslinkAlerts(true);
    }, intervalMin * 60 * 1000);
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, transitAlertsRefreshInterval, fetchTranslinkAlerts]);

  const handleStationClick = (stationName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stationInfo = (skytrainStationsData as Record<string, any>)[stationName];
    if (stationInfo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
      if (mapInstance) {
        mapInstance.flyTo({
          center: [stationInfo.lon, stationInfo.lat],
          zoom: 16,
          essential: true
        });
      }
      setSearchTarget({
        id: `station_${stationInfo.stop_id}`,
        title: stationInfo.displayName || stationInfo.name,
        subtitle: `${stationInfo.lines?.join(' · ') || '大眾運輸車站'}`,
        category: 'skytrain_station',
        badge: 'TransLink 車站',
        icon: '🚇',
        lat: stationInfo.lat,
        lon: stationInfo.lon,
        zoom: 16,
        meta: { stop_id: stationInfo.stop_id }
      });
    }
  };

  // Filtered & sorted alerts
  const filteredAndSortedAlerts = useMemo(() => {
    if (!transitAlertsData || !Array.isArray(transitAlertsData.alerts)) {
      return { banners: [], regular: [] };
    }

    const all = transitAlertsData.alerts;
    let banners = all.filter((a) => a.is_banner);
    let regular = all.filter((a) => !a.is_banner);

    // 1. 運具子分頁篩選 (同時嚴格套用於一般卡片與置頂警報，切換至特定運具時絕不混入其他運具內容)
    if (alertsSubTab !== 'all') {
      regular = regular.filter((a) => a.mode === alertsSubTab);
      banners = banners.filter((a) => a.mode === alertsSubTab);
    }

    // 2. 影響性質篩選 (包含 TransLink 實際 API 回傳之各項 effect 與中文標籤)
    if (alertsEffectFilter !== 'all') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const effectMatch = (a: any) => {
        const eff = (a.effect || '').toUpperCase();
        const effZh = (a.effect_zh || '');
        const header = (a.header || '').toLowerCase();
        const text = (a.alertText || '').toLowerCase();
        const desc = (a.description || '').toLowerCase();
        const combined = `${eff} ${effZh} ${header} ${text} ${desc}`;

        if (alertsEffectFilter === 'PLATFORM_CHANGE') {
          return eff.includes('PLATFORM') || effZh.includes('月台') || combined.includes('platform');
        }
        if (alertsEffectFilter === 'DETOUR') {
          return (
            eff.includes('DETOUR') || 
            eff.includes('STOP_MOVE') || 
            eff.includes('STOP_MOVED') || 
            effZh.includes('改道') || 
            effZh.includes('遷移') || 
            combined.includes('detour') || 
            combined.includes('stop move')
          );
        }
        if (alertsEffectFilter === 'DELAYS') {
          return eff.includes('DELAY') || effZh.includes('延誤') || combined.includes('delay');
        }
        if (alertsEffectFilter === 'CANCELLED_SERVICE') {
          return (
            eff.includes('CANCEL') || 
            eff.includes('STOP_CLOSURE') || 
            eff.includes('NO_SERVICE') || 
            effZh.includes('取消') || 
            effZh.includes('停駛') || 
            effZh.includes('暫停') || 
            combined.includes('cancel') || 
            combined.includes('no service') ||
            combined.includes('closure')
          );
        }
        if (alertsEffectFilter === 'ELEVATOR') {
          return (
            eff.includes('ELEVATOR') || 
            eff.includes('ESCALATOR') || 
            eff.includes('STATION_ISSUE') || 
            effZh.includes('電梯') || 
            effZh.includes('電扶梯') || 
            effZh.includes('維護') ||
            combined.includes('elevator') || 
            combined.includes('escalator')
          );
        }
        if (alertsEffectFilter === 'ADVISORY') {
          return (
            eff.includes('ADVISORY') || 
            eff.includes('INFORMATIONAL') || 
            eff.includes('SCHEDULE') || 
            eff.includes('SERVICE_CHANGE') || 
            effZh.includes('提示') || 
            effZh.includes('公告') || 
            effZh.includes('時刻')
          );
        }
        return true;
      };
      regular = regular.filter(effectMatch);
      banners = banners.filter(effectMatch);
    }

    // 3. 關鍵字搜尋
    if (alertsSearchQuery.trim()) {
      const q = alertsSearchQuery.trim().toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchMatch = (a: any) =>
        (a.header && a.header.toLowerCase().includes(q)) ||
        (a.alertText && a.alertText.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q)) ||
        (a.routeLongName && a.routeLongName.toLowerCase().includes(q)) ||
        (a.routeId && a.routeId.toLowerCase().includes(q)) ||
        (a.impacted_stations && a.impacted_stations.some((st: string) => st.toLowerCase().includes(q)));
      regular = regular.filter(searchMatch);
      banners = banners.filter(searchMatch);
    }

    // 4. 排序邏輯 (嚴重性優先 / 日期新至舊 / 日期舊至新)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calcSeverityScore = (a: any) => {
      let score = 0;
      if (a.is_banner) score += 1000;
      if (a.critical) score += 500;
      if (a.closed) score += 300;
      const eff = (a.effect || '').toUpperCase();
      if (eff.includes('CANCEL') || eff.includes('NO_SERVICE')) score += 200;
      else if (eff.includes('STOP_CLOSURE')) score += 180;
      else if (eff.includes('DELAY')) score += 150;
      else if (eff.includes('DETOUR') || eff.includes('STOP_MOVE')) score += 100;
      else if (eff.includes('PLATFORM')) score += 80;
      else if (eff.includes('ELEVATOR') || eff.includes('ESCALATOR')) score += 50;
      if (a.advisory) score += 20;
      return score;
    };

    regular = [...regular].sort((a, b) => {
      if (alertsSortBy === 'severity') {
        const diff = calcSeverityScore(b) - calcSeverityScore(a);
        if (diff !== 0) return diff;
      }
      const timeA = new Date(a.lastModified || a.startTime || 0).getTime();
      const timeB = new Date(b.lastModified || b.startTime || 0).getTime();
      if (alertsSortBy === 'oldest') {
        return timeA - timeB;
      }
      return timeB - timeA;
    });

    return { banners, regular };
  }, [transitAlertsData, alertsSubTab, alertsEffectFilter, alertsSearchQuery, alertsSortBy]);

  const alertsCounts = useMemo(() => {
    if (!transitAlertsData || !Array.isArray(transitAlertsData.alerts)) {
      return { all: 0, skytrain: 0, bus: 0, seabus: 0, wce: 0 };
    }
    const list = transitAlertsData.alerts.filter((a) => !a.is_banner);
    return {
      all: list.length,
      skytrain: list.filter((a) => a.mode === 'skytrain').length,
      bus: list.filter((a) => a.mode === 'bus').length,
      seabus: list.filter((a) => a.mode === 'seabus').length,
      wce: list.filter((a) => a.mode === 'wce').length
    };
  }, [transitAlertsData]);

  const exploreTabsRow1 = [
    { id: 'weather', label: '天氣', icon: CloudSun, iconColor: 'text-sky-400' },
    { id: 'news', label: '新聞', icon: Newspaper, iconColor: 'text-amber-400' },
    { id: 'events', label: '活動', icon: CalendarDays, iconColor: 'text-purple-400' },
    { id: 'beach', label: '沙灘水質', hoverLabel: '沙灘', icon: Droplets, iconColor: 'text-teal-300' },
    { id: 'ski', label: '滑雪', icon: MountainSnow, iconColor: 'text-cyan-300' },
    { id: 'aurora', label: '極光', icon: Sparkles, iconColor: 'text-emerald-300' },
  ];

  const exploreTabsRow2 = [
    { id: 'fuel', label: '燃油', icon: Fuel, iconColor: 'text-emerald-400' },
    { id: 'ev', label: '充電', icon: Zap, iconColor: 'text-yellow-400' },
    { id: 'ferry', label: '渡輪', icon: Ship, iconColor: 'text-cyan-400' },
    { id: 'cargo', label: '船運', icon: Anchor, iconColor: 'text-blue-400' },
    { id: 'alerts', label: '交通警報', icon: AlertTriangle, iconColor: 'text-rose-400' },
    { id: 'border', label: '關口', icon: ShieldCheck, iconColor: 'text-emerald-400' },
  ] as const;

  return (
    <div 
      className="fixed top-[72px] right-4 z-40 w-[380px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <Compass className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-white tracking-wide">探索</h2>
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

      {/* 探索分類分頁 - 2 行圖示按鈕組，Cursor 碰到後平滑展開文字（對標右上角按鈕），保留當前緊湊比例 */}
      <div className="flex flex-col gap-1 p-1 bg-[#10131a]/90 rounded-lg border border-[#232838] shrink-0 mb-2.5">
        {/* 第 1 行：天氣, 新聞, 活動, 沙灘水質, 滑雪, 極光 */}
        <div className="grid grid-cols-6 gap-1">
          {exploreTabsRow1.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ExploreTabType)}
                className={`flex items-center justify-center group py-1 px-1 rounded-md transition-all duration-200 text-xs font-semibold select-none min-h-[30px] ${
                  isActive
                    ? 'bg-[#252e3e] border border-cyan-500/70 text-white shadow-sm ring-1 ring-cyan-500/30'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-[#1a202c] border border-transparent hover:border-[#2b3548]'
                }`}
                title={tab.label}
              >
                <Icon className={`w-3.5 h-3.5 ${tab.iconColor} shrink-0 transition-transform duration-200 group-hover:scale-110`} />
                <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[65px] group-hover:opacity-100 group-hover:ml-1 transition-all duration-300 whitespace-nowrap text-[10.5px]">
                  {('hoverLabel' in tab && tab.hoverLabel) ? tab.hoverLabel : tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* 第 2 行：燃油, 充電, 渡輪, 船運, 交通警報, 關口 (未開發) */}
        <div className="grid grid-cols-6 gap-1">
          {exploreTabsRow2.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ExploreTabType)}
                className={`flex items-center justify-center group py-1 px-1 rounded-md transition-all duration-200 text-xs font-semibold select-none min-h-[30px] ${
                  isActive
                    ? 'bg-[#252e3e] border border-cyan-500/70 text-white shadow-sm ring-1 ring-cyan-500/30'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-[#1a202c] border border-transparent hover:border-[#2b3548]'
                }`}
                title={tab.label}
              >
                <Icon className={`w-3.5 h-3.5 ${tab.iconColor} shrink-0 transition-transform duration-200 group-hover:scale-110`} />
                <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[75px] group-hover:opacity-100 group-hover:ml-1 transition-all duration-300 whitespace-nowrap text-[10.5px]">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
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

              {/* ================= 降水雷達動態圖 (Precipitation Radar) ================= */}
              <div className="bg-[#12151e] border border-cyan-500/40 rounded-xl p-3.5 shadow-lg flex flex-col gap-3 mt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                      <CloudRain className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                        <span>即時降水雷達動態</span>
                        <span className="text-[9px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 px-1 py-0.2 rounded font-mono">
                          RainViewer
                        </span>
                      </h4>
                      <span className="text-[10px] text-gray-400">過去 2 小時至即時回波雲團</span>
                    </div>
                  </div>

                  {/* 疊加主地圖開關 */}
                  <button
                    onClick={handleToggleRadar}
                    className={`px-2.5 py-1 text-[11px] rounded-lg font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                      isRadarActive
                        ? 'bg-cyan-500 text-gray-950 ring-2 ring-cyan-400/50'
                        : 'bg-[#1e2330] text-gray-300 hover:text-white hover:bg-[#282f40] border border-[#2d3547]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isRadarActive ? 'bg-gray-950 animate-ping' : 'bg-gray-500'}`} />
                    <span>{isRadarActive ? '主地圖疊加中' : '疊加至主地圖'}</span>
                  </button>
                </div>

                {loadingRadar ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-gray-400 text-xs">
                    <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
                    <span>載入降雨雷達回波數據中...</span>
                  </div>
                ) : radarFrames.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">暫無可用之雷達影格</div>
                ) : (
                  <div className="flex flex-col gap-2.5 bg-[#0e1118] p-2.5 rounded-lg border border-[#222736]">
                    {/* 影格時間與狀態指示 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 text-[11px]">影格時間:</span>
                      <span className="font-mono font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
                        {formatRadarTime(radarFrames[currentFrameIndex]?.time)}
                      </span>
                    </div>

                    {/* 播放控制按鈕與滑桿 */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleFrameChange((currentFrameIndex - 1 + radarFrames.length) % radarFrames.length)}
                        className="p-1.5 bg-[#1a1f2b] hover:bg-[#282f40] rounded text-gray-300 hover:text-white transition-colors"
                        title="上一格"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setIsRadarPlaying(!isRadarPlaying)}
                        className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${
                          isRadarPlaying
                            ? 'bg-rose-500 hover:bg-rose-600 text-white'
                            : 'bg-cyan-500 hover:bg-cyan-400 text-gray-950'
                        }`}
                      >
                        {isRadarPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        <span>{isRadarPlaying ? '暫停' : '播放'}</span>
                      </button>
                      <button
                        onClick={() => handleFrameChange((currentFrameIndex + 1) % radarFrames.length)}
                        className="p-1.5 bg-[#1a1f2b] hover:bg-[#282f40] rounded text-gray-300 hover:text-white transition-colors"
                        title="下一格"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>

                      {/* 時間軸滑桿 */}
                      <input
                        type="range"
                        min="0"
                        max={radarFrames.length - 1}
                        value={currentFrameIndex}
                        onChange={(e) => handleFrameChange(Number(e.target.value))}
                        className="flex-1 accent-cyan-400 cursor-pointer h-1.5 bg-[#252a38] rounded-lg"
                      />
                    </div>

                    {/* 雨量強度圖例 */}
                    <div className="pt-2 border-t border-[#1f2533] flex flex-col gap-1 text-[10px] text-gray-400">
                      <span className="text-[9.5px]">降水強度圖例 (Precipitation Intensity):</span>
                      <div className="grid grid-cols-5 text-center gap-1 text-[9px] font-mono">
                        <div className="py-0.5 rounded bg-sky-900/60 text-sky-200 border border-sky-700/50">細雨 &lt;0.5</div>
                        <div className="py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/50">小雨 0.5-2</div>
                        <div className="py-0.5 rounded bg-yellow-900/60 text-yellow-200 border border-yellow-700/50">中雨 2-10</div>
                        <div className="py-0.5 rounded bg-orange-900/60 text-orange-200 border border-orange-700/50">大雨 10-30</div>
                        <div className="py-0.5 rounded bg-rose-900/60 text-rose-200 border border-rose-700/50">暴雨 &gt;30mm</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ================= 海岸潮汐與即時水位站 (Coastal Tides) ================= */}
              <div className="bg-[#12151e] border border-blue-500/40 rounded-xl p-3.5 shadow-lg flex flex-col gap-3 mt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                      <Waves className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                        <span>海岸潮汐水位</span>
                        <span className="text-[9px] bg-blue-950/80 text-blue-400 border border-blue-800/60 px-1 py-0.2 rounded font-mono">
                          DFO / CHS 官方
                        </span>
                      </h4>
                      <span className="text-[10px] text-gray-400">加拿大漁業及海洋部水文即時監測</span>
                    </div>
                  </div>
                  <button
                    onClick={() => enableLayer('tideStations')}
                    className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1"
                  >
                    <span>開啟潮汐水位圖層</span>
                    <span>❯</span>
                  </button>
                </div>

                {loadingTides ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-gray-400 text-xs">
                    <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                    <span>正在檢索大溫海岸觀測站即時潮位...</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tideStations.map((st) => {
                      const isRising = st.state_trend === 'rising';
                      const isFalling = st.state_trend === 'falling';
                      return (
                        <div
                          key={st.code}
                          onClick={() => handleLocateTideStation(st)}
                          className={`p-2.5 rounded-lg border transition-all flex flex-col gap-1.5 cursor-pointer ${
                            selectedTideCode === st.code
                              ? 'bg-blue-950/40 border-blue-500 text-white ring-1 ring-blue-500/50'
                              : 'bg-[#0f121a] border-[#222736] hover:border-blue-500/50 hover:bg-[#131926] text-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-bold text-xs text-white block">{st.name}</span>
                              <span className="text-[10px] text-gray-400">{st.area}</span>
                            </div>
                            <div className="text-right">
                              <div className="flex items-center gap-1.5 justify-end">
                                <span className="text-base font-extrabold text-blue-400 font-mono">
                                  {st.current_water_level_m} <span className="text-xs font-normal text-gray-400">m</span>
                                </span>
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono flex items-center gap-0.5 ${
                                    isRising
                                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
                                      : isFalling
                                      ? 'bg-rose-950/80 text-rose-300 border border-rose-800/50'
                                      : 'bg-gray-800 text-gray-300'
                                  }`}
                                >
                                  <span>{st.state}</span>
                                  <span>{isRising ? '↗' : isFalling ? '↘' : '→'}</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 高低潮預報 */}
                          {(st.next_high || st.next_low) && (
                            <div className="pt-1.5 border-t border-[#1c2230] flex items-center justify-between text-[10.5px]">
                              <div className="flex items-center gap-2 text-gray-400 font-mono">
                                {st.next_high && (
                                  <span className="text-emerald-400/90">
                                    滿潮: {st.next_high.value}m ({st.next_high.time.slice(11, 16)}Z)
                                  </span>
                                )}
                                {st.next_low && (
                                  <span className="text-sky-400/90">
                                    乾潮: {st.next_low.value}m ({st.next_low.time.slice(11, 16)}Z)
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-blue-400 font-medium">點擊定位 ❯</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-gray-400">目前無法取得即時天氣資料</div>
          )}
        </div>
      )}

      {/* ==================== 滑雪分頁 (Ski Resorts - Skiresort.com Live Data) ==================== */}
      {activeTab === 'ski' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-semibold flex items-center gap-1.5">
              <MountainSnow className="w-4 h-4 text-cyan-400" />
              <span>3 大滑雪場即時雪況</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
                每日 1 次更新
              </span>
              <button
                onClick={() => fetchSkiResorts(true)}
                disabled={loadingSki}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors"
                title="重新整理雪況"
              >
                <RefreshCw className={`w-3 h-3 ${loadingSki ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {/* 提示條 */}
            <div className="bg-[#121622] border border-cyan-900/40 rounded-lg p-2 text-[11px] text-cyan-200/90 flex items-center gap-2">
              <span className="text-base shrink-0">⛷️</span>
              <span className="leading-snug">
                已在地圖標註 3 大滑雪場。點擊雪場卡片，即可在地圖上自動彈跳至該雪場！
              </span>
            </div>

            {loadingSki && skiResorts.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                <span>讀取滑雪場即時雪報中...</span>
              </div>
            ) : skiResorts.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232838]">
                暫無滑雪場資料
              </div>
            ) : (
              skiResorts.map((resort) => {
                const isOpen = resort.is_open;
                return (
                  <div
                    key={resort.id}
                    onClick={() => handleSelectSkiResort(resort)}
                    className="bg-[#12151e] border border-[#262c3c] hover:border-cyan-500/50 hover:bg-[#161a25] rounded-xl p-3.5 shadow-md flex flex-col gap-2.5 transition-all group cursor-pointer"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-300 shrink-0 text-lg shadow-sm">
                          ⛷️
                        </div>
                        <div className="flex flex-col min-w-0">
                          <h4 className="text-sm font-bold text-white tracking-wide truncate group-hover:text-cyan-300 transition-colors">
                            {resort.name}
                          </h4>
                          <span className="text-[11px] text-gray-400 truncate">
                            {resort.english_name}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                        isOpen 
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' 
                          : 'bg-slate-800/80 text-slate-300 border-slate-700/60'
                      }`}>
                        {resort.status_zh || resort.status_raw || '休園中'}
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate">{resort.area}</span>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2 bg-[#0e1118] p-2.5 rounded-lg border border-[#1f2433] text-xs">
                      {/* 雪道 */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400">雪道開放</span>
                        <span className="font-mono font-bold text-white text-[12px] mt-0.5">
                          {resort.slopes_label || `${resort.slopes_open} / ${resort.slopes_total} km`}
                        </span>
                      </div>
                      {/* 纜車 */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400">纜車開放</span>
                        <span className="font-mono font-bold text-white text-[12px] mt-0.5">
                          {resort.lifts_label || `${resort.lifts_open} / ${resort.lifts_total} 座`}
                        </span>
                      </div>
                      {/* 積雪深度 */}
                      <div className="flex flex-col pt-1.5 border-t border-[#1a1f2c]">
                        <span className="text-[10px] text-gray-400">積雪 (山底 / 山頂)</span>
                        <span className="font-mono font-semibold text-cyan-300 text-[11px] mt-0.5">
                          {resort.snow_base || '-'} / {resort.snow_top || '-'}
                        </span>
                      </div>
                      {/* 海拔落差 */}
                      <div className="flex flex-col pt-1.5 border-t border-[#1a1f2c]">
                        <span className="text-[10px] text-gray-400">海拔落差 (垂直)</span>
                        <span className="font-mono font-semibold text-gray-200 text-[11px] mt-0.5">
                          {resort.altitude_base} - {resort.altitude_top} ({resort.vertical_drop})
                        </span>
                      </div>
                    </div>

                    {/* Additional Details */}
                    <div className="flex items-center justify-between text-[11px] text-gray-400 px-0.5">
                      <span className="flex items-center gap-1">
                        <span>夜滑：</span>
                        <span className={resort.night_skiing ? 'text-amber-300 font-medium' : 'text-gray-500'}>
                          {resort.night_skiing ? '🌙 有夜間滑雪' : '無夜滑'}
                        </span>
                      </span>
                      {resort.season_range && (
                        <span className="text-[10px] text-gray-400 font-mono truncate max-w-[190px]">
                          雪季: {resort.season_range}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
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

      {/* ==================== 極光分頁 (Aurora - NOAA SWPC Planetary K-index) ==================== */}
      {activeTab === 'aurora' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
          {/* Header Bar */}
          <div className="flex items-center justify-between shrink-0">
            <span className="text-xs text-gray-300 font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>極光指數與觀測預報</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono">
                每天 2 次更新
              </span>
              <button
                onClick={() => fetchAuroraData(true)}
                disabled={loadingAurora}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors"
                title="重新整理極光數據"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAurora ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
            </div>
          </div>

          {loadingAurora && !auroraData ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <span>載入 NOAA 太空天氣中心 K-index 數據...</span>
            </div>
          ) : auroraData ? (
            <>
              {/* 1. Hero Card: Current Planetary K-index */}
              <div className="bg-gradient-to-br from-[#121824] via-[#101b2b] to-[#0d1f1f] rounded-xl p-3.5 border border-[#23383a] shadow-lg flex flex-col gap-3 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                      行星 K-Index 指數 (Planetary Kp)
                    </span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-3xl font-extrabold text-white tracking-tight">
                        Kp {auroraData.latest?.kp ?? '--'}
                      </span>
                      <span className="text-xs text-gray-400">/ 9.0</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span 
                      className="px-2.5 py-1 rounded-full text-xs font-bold shadow-sm flex items-center gap-1"
                      style={{ 
                        backgroundColor: `${auroraData.latest?.g_color || '#10b981'}25`, 
                        color: auroraData.latest?.g_color || '#10b981',
                        borderColor: `${auroraData.latest?.g_color || '#10b981'}60`,
                        borderWidth: '1px'
                      }}
                    >
                      <Sparkles className="w-3 h-3" />
                      {auroraData.latest?.g_scale || 'G0'}
                    </span>
                    <span className="text-[10px] text-gray-400 mt-1">
                      {auroraData.latest?.g_desc || ''}
                    </span>
                  </div>
                </div>

                {/* Progress Meter Bar */}
                <div className="flex flex-col gap-1 relative z-10">
                  <div className="w-full bg-[#182030] h-2 rounded-full overflow-hidden border border-[#28354c] relative">
                    <div 
                      className="h-full rounded-full transition-all duration-700"
                      style={{ 
                        width: `${Math.min(100, Math.max(8, ((auroraData.latest?.kp || 0) / 9) * 100))}%`,
                        backgroundColor: auroraData.latest?.g_color || '#10b981'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-500 font-mono">
                    <span>0 (平靜)</span>
                    <span>3 (擾動)</span>
                    <span className="text-yellow-400 font-bold">5 (G1)</span>
                    <span className="text-amber-400 font-bold">6 (G2)</span>
                    <span className="text-rose-400 font-bold">7+ (強烈)</span>
                  </div>
                </div>

                {/* Visibility Evaluation for Vancouver */}
                <div className="bg-[#0b121e]/80 p-2.5 rounded-lg border border-[#1e2c3e] flex flex-col gap-1 relative z-10">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-gray-200 flex items-center gap-1">
                      <span>🍁 溫哥華觀測等級：</span>
                      <span className="text-emerald-400 font-semibold">{auroraData.latest?.visibility?.level || '低'}</span>
                    </span>
                    <span className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold ${auroraData.latest?.visibility?.badge_color || 'bg-gray-800 text-gray-300'}`}>
                      {auroraData.latest?.visibility?.naked_eye ? '肉眼可見' : '相機/暗空'}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-gray-300 leading-relaxed">
                    {auroraData.latest?.visibility?.description || '目前地磁活動平靜。'}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-[#182436] text-[10px] text-gray-400">
                    <span>可見機率預估</span>
                    <span className="font-mono font-bold text-emerald-400">{auroraData.latest?.visibility?.chance_pct ?? 0}%</span>
                  </div>
                </div>
              </div>

              {/* 2. Recent 48h Kp Trend (History) */}
              <div className="bg-[#10141e] rounded-xl p-3 border border-[#232a38] flex flex-col gap-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span>過去 48 小時 K-Index 歷史走勢 (3h 間隔)</span>
                  </span>
                  <span className="text-[9.5px] text-gray-400 font-mono">NOAA SWPC</span>
                </div>
                <div className="grid grid-cols-8 gap-1 pt-1">
                  {(auroraData.history || []).slice(-8).map((h, idx) => {
                    const timeOnly = h.time_tag.includes('T') ? h.time_tag.split('T')[1].slice(0, 5) : h.time_tag.slice(-5);
                    const isLatest = idx === (auroraData.history || []).slice(-8).length - 1;
                    return (
                      <div 
                        key={idx} 
                        className={`flex flex-col items-center justify-end p-1 rounded ${
                          isLatest ? 'bg-cyan-950/60 border border-cyan-500/50' : 'bg-[#151a26]'
                        }`}
                        title={`${h.time_tag} · Kp ${h.kp} (${h.g_desc})`}
                      >
                        <span className="text-[9px] font-bold font-mono" style={{ color: h.g_color }}>
                          {h.kp}
                        </span>
                        <div className="w-full bg-[#202738] h-10 rounded-sm flex items-end my-1 overflow-hidden">
                          <div 
                            className="w-full rounded-sm transition-all"
                            style={{ 
                              height: `${Math.min(100, Math.max(10, (h.kp / 9) * 100))}%`,
                              backgroundColor: h.g_color 
                            }}
                          />
                        </div>
                        <span className="text-[8.5px] text-gray-400 font-mono truncate">
                          {timeOnly}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[9.5px] text-gray-500 pt-1 border-t border-[#1a2233]">
                  <span>最新觀測：{auroraData.latest?.time_tag ? auroraData.latest.time_tag.replace('T', ' ') : '--'} UTC</span>
                  <span>指數等級：Kp &ge; 5 觸發磁暴警報</span>
                </div>
              </div>

              {/* 3. Aurora Spots */}
              <div className="bg-[#10141e] rounded-xl p-3 border border-[#232a38] flex flex-col gap-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                    <span>極光觀察地點</span>
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">4 大無光害點</span>
                </div>

                <div className="flex flex-col gap-2">
                  {(auroraData.spots || []).map((spot) => (
                    <div 
                      key={spot.id}
                      className="bg-[#141924] hover:bg-[#1a2233] p-2.5 rounded-lg border border-[#222b3b] hover:border-emerald-500/40 transition-all flex flex-col gap-1.5 cursor-pointer group"
                      onClick={() => handleSelectAuroraSpot(spot)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-xs text-white group-hover:text-emerald-300 transition-colors flex items-start gap-1.5 leading-snug">
                            <span className="shrink-0 text-xs">✨</span>
                            <span className="break-words whitespace-normal">{spot.name}</span>
                          </h4>
                        </div>
                        <span className="text-[9.5px] bg-[#222a3a] text-cyan-300 px-1.5 py-0.5 rounded font-mono shrink-0 whitespace-nowrap">
                          {spot.drive_min}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-gray-300 leading-snug">
                        {spot.features}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Source attribution footer */}
              <div className="p-2 rounded-lg bg-[#0e121a] border border-[#1d2330] flex items-center justify-between text-[10px] text-gray-400">
                <span className="truncate max-w-[240px]">資料來源：NOAA SWPC 太空天氣預測中心</span>
                {auroraData.source_url && (
                  <a 
                    href={auroraData.source_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 hover:underline shrink-0"
                  >
                    <span>官方監測</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </>
          ) : null}
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
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
                即時追蹤
              </span>
              <button
                onClick={() => fetchShippingVessels()}
                disabled={loadingShipping}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors"
                title="重新整理船運動態"
              >
                <RefreshCw className={`w-3 h-3 ${loadingShipping ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
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

      {/* ==================== 大溫沙灘水質分頁 (Beach Water Quality) ==================== */}
      {activeTab === 'beach' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Controls: Title, Monthly update indicator & manual refresh button */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Droplets className="w-4 h-4 text-teal-400" />
                <span>沙灘水質</span>
              </span>
              <span className="text-[10px] text-teal-400 bg-teal-950/60 border border-teal-800/50 px-1.5 py-0.5 rounded font-mono font-medium">
                每個月更新 1 次
              </span>
            </div>

            <button
              onClick={() => fetchBeachWater(true)}
              disabled={loadingBeach}
              className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-teal-400 border border-[#232838] hover:border-teal-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
              title="重新整理水質資料"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBeach ? 'animate-spin text-teal-400' : ''}`} />
            </button>
          </div>

          {/* 開啟海灘水質圖層按鈕 (Highlight Layer Switch) */}
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-teal-950/40 via-[#102422]/60 to-[#121c24] border border-teal-500/30 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-300 shrink-0">
                <Eye className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>海灘水質地圖圖層</span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-medium ${layers?.beachWaterQuality ? 'bg-teal-500/30 text-teal-200 border border-teal-500/40' : 'bg-gray-800 text-gray-400'}`}>
                    {layers?.beachWaterQuality ? '顯示中' : '已隱藏'}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 truncate">
                  地圖上即時呈現 41 座海灘水域範圍與水質警戒
                </div>
              </div>
            </div>

            <button
              onClick={handleToggleBeachLayer}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all shadow-sm flex items-center gap-1.5 ${
                layers?.beachWaterQuality
                  ? 'bg-teal-600/80 hover:bg-teal-500 text-white border border-teal-400/50'
                  : 'bg-[#1a2332] hover:bg-[#232f44] text-teal-300 border border-teal-600/40'
              }`}
            >
              <span>{layers?.beachWaterQuality ? '圖層已開啟' : '開啟海灘水質圖層'}</span>
            </button>
          </div>

          {/* 水質標準評級參考與 3 色快速篩選按鈕 (點擊切換篩選，再次點擊恢復全部) */}
          <div className="grid grid-cols-3 gap-1.5 shrink-0 text-center">
            <button
              onClick={() => setBeachStatusFilter((prev) => (prev === 'safe' ? 'all' : 'safe'))}
              className={`rounded-lg p-1.5 flex flex-col items-center transition-all cursor-pointer ${
                beachStatusFilter === 'safe'
                  ? 'bg-emerald-950/90 border-2 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/50'
                  : 'bg-[#10131a] border border-emerald-500/30 hover:border-emerald-500/60 hover:bg-[#141d19]'
              }`}
              title="點擊快速篩選適合游泳海灘 (再次點擊恢復全部)"
            >
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="text-[10px] text-emerald-400 font-bold">適合游泳</span>
              </div>
              <span className="text-xs font-bold text-white font-mono mt-0.5">{beachStats.safe} 座</span>
            </button>

            <button
              onClick={() => setBeachStatusFilter((prev) => (prev === 'advisory' ? 'all' : 'advisory'))}
              className={`rounded-lg p-1.5 flex flex-col items-center transition-all cursor-pointer ${
                beachStatusFilter === 'advisory'
                  ? 'bg-amber-950/90 border-2 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.35)] ring-1 ring-amber-400/50'
                  : 'bg-[#10131a] border border-amber-500/30 hover:border-amber-500/60 hover:bg-[#1f1a14]'
              }`}
              title="點擊快速篩選需留意海灘 (再次點擊恢復全部)"
            >
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span className="text-[10px] text-amber-400 font-bold">需留意</span>
              </div>
              <span className="text-xs font-bold text-white font-mono mt-0.5">{beachStats.advisory} 座</span>
            </button>

            <button
              onClick={() => setBeachStatusFilter((prev) => (prev === 'warning' ? 'all' : 'warning'))}
              className={`rounded-lg p-1.5 flex flex-col items-center transition-all cursor-pointer ${
                beachStatusFilter === 'warning'
                  ? 'bg-rose-950/90 border-2 border-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.35)] ring-1 ring-rose-400/50'
                  : 'bg-[#10131a] border border-rose-500/30 hover:border-rose-500/60 hover:bg-[#201417]'
              }`}
              title="點擊快速篩選超標警告海灘 (再次點擊恢復全部)"
            >
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                <span className="text-[10px] text-rose-400 font-bold">超標警告</span>
              </div>
              <span className="text-xs font-bold text-white font-mono mt-0.5">{beachStats.warning} 座</span>
            </button>
          </div>

          {/* 搜尋列 + 衛生局篩選 + 排序 (整合於同一橫行) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 搜尋海灘輸入格 */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={beachSearchQuery}
                onChange={(e) => setBeachSearchQuery(e.target.value)}
                placeholder="搜尋海灘名稱或市鎮..."
                className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-teal-500/50 transition-colors"
              />
              {beachSearchQuery && (
                <button
                  onClick={() => setBeachSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                  title="清除搜尋"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 衛生局篩選 (搜尋格右方) */}
            <select
              value={beachAuthorityFilter}
              onChange={(e) => setBeachAuthorityFilter(e.target.value as any)}
              className="bg-[#151922] text-gray-300 text-[10.5px] rounded-lg px-1.5 py-1.5 border border-[#232838] focus:outline-none focus:border-teal-500/50 shrink-0 cursor-pointer w-[92px]"
              title="篩選主管衛生局"
            >
              <option value="all">全部衛生局</option>
              <option value="vch">溫哥華沿岸</option>
              <option value="fraser">菲沙衛生局</option>
            </select>

            {/* 排序 (搜尋格右方) */}
            <select
              value={beachSortBy}
              onChange={(e) => setBeachSortBy(e.target.value as any)}
              className="bg-[#151922] text-gray-300 text-[10.5px] rounded-lg px-1.5 py-1.5 border border-[#232838] focus:outline-none focus:border-teal-500/50 shrink-0 cursor-pointer w-[80px]"
              title="海灘水質排序"
            >
              <option value="best">水質最優</option>
              <option value="worst">濃度最高</option>
              <option value="name">名稱順序</option>
            </select>
          </div>

          {/* 3 色按鈕目前篩選狀態提式列 */}
          {beachStatusFilter !== 'all' && (
            <div className="flex items-center justify-between px-2 py-1 bg-teal-950/40 border border-teal-500/30 rounded-md text-[10.5px] shrink-0">
              <span className="text-teal-300 flex items-center gap-1">
                <span>目前快速篩選：</span>
                <strong className={
                  beachStatusFilter === 'safe' ? 'text-emerald-400' :
                  beachStatusFilter === 'advisory' ? 'text-amber-400' : 'text-rose-400'
                }>
                  {beachStatusFilter === 'safe' ? '適合游泳 (≤200 MPN)' :
                   beachStatusFilter === 'advisory' ? '需留意 (201-400 MPN)' : '超標警告 (>400 MPN)'}
                </strong>
                <span className="text-gray-400">（{filteredAndSortedBeaches.length} 座）</span>
              </span>
              <button
                onClick={() => setBeachStatusFilter('all')}
                className="text-gray-400 hover:text-white underline text-[10px]"
              >
                重設顯示全部
              </button>
            </div>
          )}

          {/* 海灘列表 (Beach Cards List) */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 custom-scrollbar">
            {loadingBeach && beachList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin text-teal-400 mb-2" />
                <span className="text-xs">正在載入大溫海灘水質資料...</span>
              </div>
            ) : filteredAndSortedBeaches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-[#10131a] rounded-xl border border-[#232838] p-4 text-center">
                <Droplets className="w-8 h-8 text-teal-500/50 mb-2" />
                <span className="text-sm font-semibold text-gray-200">查無符合條件之海灘</span>
                <span className="text-xs text-gray-500 mt-1">請調整篩選分類或搜尋關鍵字</span>
              </div>
            ) : (
              filteredAndSortedBeaches.map((beach) => {
                const statusBadge = (() => {
                  if (beach.status === 'warning') {
                    return {
                      bg: 'bg-rose-950/60 text-rose-300 border-rose-500/50',
                      dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
                      text: '超標警告'
                    };
                  }
                  if (beach.status === 'advisory') {
                    return {
                      bg: 'bg-amber-950/60 text-amber-300 border-amber-500/50',
                      dot: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
                      text: '需留意'
                    };
                  }
                  return {
                    bg: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50',
                    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
                    text: '適合游泳'
                  };
                })();

                return (
                  <div
                    key={beach.id}
                    onClick={() => handleLocateBeach(beach)}
                    className="p-3 rounded-xl bg-[#141822] border border-[#232838] hover:border-teal-500/50 hover:bg-[#181d2a] transition-all shadow-sm flex flex-col gap-2 group cursor-pointer"
                  >
                    {/* Top Row: Beach name & Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusBadge.dot}`} />
                          <h4 className="text-xs font-bold text-white group-hover:text-teal-300 transition-colors truncate">
                            {beach.name}
                          </h4>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 truncate pl-3.5">
                          {beach.area || beach.municipality} · {beach.health_authority}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge.bg}`}>
                          {statusBadge.text}
                        </span>
                      </div>
                    </div>

                    {/* Metric Row: E. coli reading & sample date */}
                    <div className="grid grid-cols-2 gap-1.5 bg-[#0e1118] p-2 rounded-lg border border-[#1e2330] text-[11px]">
                      <div>
                        <span className="text-[9.5px] text-gray-400 block">大腸桿菌指標 (E. coli)</span>
                        <span className="font-mono font-bold text-white">
                          {beach.last_value !== null ? `${beach.last_value} MPN/100mL` : '定期監測中'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9.5px] text-gray-400 block">最新採樣日期</span>
                        <span className="font-mono text-gray-300 text-[10.5px]">
                          {beach.last_sample_date || '每月更新'}
                        </span>
                      </div>
                    </div>

                    {beach.notes && (
                      <p className="text-[10.5px] text-gray-400 line-clamp-2 leading-relaxed bg-[#10131a] px-2 py-1 rounded border border-[#1e2330]">
                        {beach.notes}
                      </p>
                    )}

                    {/* Actions: Google Maps Navigation & Official Health URL */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#1e2330] text-[10.5px]">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${beach.center_lat},${beach.center_lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0e121a] hover:bg-teal-950/70 text-gray-300 hover:text-teal-300 border border-[#232838] hover:border-teal-500/50 transition-colors text-[10.5px] font-medium"
                        title="使用 Google 地圖規劃導航路線至此海灘"
                      >
                        <Navigation className="w-3.5 h-3.5 text-teal-400" />
                        <span>Google 導航至此</span>
                      </a>

                      {beach.advisory_url && (
                        <a
                          href={beach.advisory_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                        >
                          <span>官方衛生局通告</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================== TransLink 即時警報分頁 (Transit Live Alerts) ==================== */}
      {activeTab === 'alerts' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Controls: Title, Auto-refresh frequency dropdown & manual refresh button */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>TransLink 交通警報</span>
              </span>
              <span className="text-[10px] text-rose-400 bg-rose-950/60 border border-rose-800/50 px-1.5 py-0.5 rounded font-mono font-bold">
                {transitAlertsData?.total ?? 0} 則
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={transitAlertsRefreshInterval}
                onChange={(e) => setTransitAlertsRefreshInterval(Number(e.target.value))}
                className="bg-[#151922] text-gray-300 text-[11px] rounded-lg px-2 py-1 border border-[#232838] focus:outline-none focus:border-rose-500/50 cursor-pointer"
                title="自訂警報自動更新頻率"
              >
                <option value={0}>手動更新</option>
                <option value={2}>每 2 分鐘</option>
                <option value={5}>每 5 分鐘</option>
                <option value={10}>每 10 分鐘 (預設)</option>
                <option value={15}>每 15 分鐘</option>
                <option value={30}>每 30 分鐘</option>
              </select>
              <button
                onClick={() => fetchTranslinkAlerts(true)}
                disabled={loadingTransitAlerts}
                className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-rose-400 border border-[#232838] hover:border-rose-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
                title="立即重新整理警報"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTransitAlerts ? 'animate-spin text-rose-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* 3.1 運具子分頁: 全部, 天車, 巴士, 水上巴士, 西岸快車 (圖示按鈕風格，Hover展開文字標籤，常駐顯示括號數字) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 shrink-0">
            {[
              { id: 'all', label: '全部', icon: LayoutGrid, count: alertsCounts.all, color: 'text-rose-400' },
              { id: 'skytrain', label: '天車', icon: Train, count: alertsCounts.skytrain, color: 'text-blue-400' },
              { id: 'bus', label: '巴士', icon: Bus, count: alertsCounts.bus, color: 'text-emerald-400' },
              { id: 'seabus', label: '水上巴士', icon: Ship, count: alertsCounts.seabus, color: 'text-cyan-400' },
              { id: 'wce', label: '西岸快車', icon: TrainTrack, count: alertsCounts.wce, color: 'text-purple-400' },
            ].map((sub) => {
              const isSelected = alertsSubTab === sub.id;
              const Icon = sub.icon;
              return (
                <button
                  key={sub.id}
                  onClick={() => setAlertsSubTab(sub.id as any)}
                  className={`flex items-center justify-center group py-1 px-2 rounded-lg transition-all duration-200 text-xs font-semibold select-none min-h-[30px] shrink-0 ${
                    isSelected
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-sm ring-1 ring-rose-500/30'
                      : 'bg-[#151922] text-gray-400 hover:text-white border border-[#232838] hover:bg-[#1c2230]'
                  }`}
                  title={`${sub.label} (${sub.count})`}
                >
                  <Icon className={`w-3.5 h-3.5 ${sub.color} shrink-0 transition-transform duration-200 group-hover:scale-110`} />
                  <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[70px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap text-[11px]">
                    {sub.label}
                  </span>
                  <span className={`text-[10px] ml-1 font-mono transition-colors ${
                    isSelected ? 'text-rose-200 font-bold' : 'text-gray-400 group-hover:text-gray-200'
                  }`}>
                    ({sub.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* 3.2 搜尋功能 */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={alertsSearchQuery}
              onChange={(e) => setAlertsSearchQuery(e.target.value)}
              placeholder="搜尋警報內容、路線或受影響車站..."
              className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-rose-500/50 transition-colors"
            />
            {alertsSearchQuery && (
              <button
                onClick={() => setAlertsSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 3.3 篩選功能 (影響性質) & 3.4 排序功能 */}
          <div className="flex items-center justify-between gap-2 shrink-0 text-xs">
            {/* 影響性質篩選 */}
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span className="text-[11px] text-gray-400 shrink-0">性質:</span>
              <select
                value={alertsEffectFilter}
                onChange={(e) => setAlertsEffectFilter(e.target.value)}
                className="bg-[#151922] text-gray-300 text-[11px] rounded-md px-2 py-1 border border-[#232838] focus:outline-none focus:border-rose-500/50 truncate w-full cursor-pointer"
              >
                <option value="all">全部性質</option>
                <option value="PLATFORM_CHANGE">月台更換</option>
                <option value="DETOUR">路線改道 / 站點變更</option>
                <option value="DELAYS">班次延誤</option>
                <option value="CANCELLED_SERVICE">班次停駛 / 站點關閉</option>
                <option value="ELEVATOR">電梯 / 電扶梯維護</option>
                <option value="ADVISORY">營運提示 / 時刻公告</option>
              </select>
            </div>

            {/* 排序功能 */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-gray-400 shrink-0">排序:</span>
              <select
                value={alertsSortBy}
                onChange={(e) => setAlertsSortBy(e.target.value as 'severity' | 'newest' | 'oldest')}
                className="bg-[#151922] text-gray-300 text-[11px] rounded-md px-2 py-1 border border-[#232838] focus:outline-none focus:border-rose-500/50 cursor-pointer"
              >
                <option value="severity">嚴重性優先</option>
                <option value="newest">發布新至舊</option>
                <option value="oldest">發布舊至新</option>
              </select>
            </div>
          </div>

          {/* Alerts List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 custom-scrollbar">
            {loadingTransitAlerts && !transitAlertsData ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin text-rose-400 mb-2" />
                <span className="text-xs">正在載入 TransLink 即時警報...</span>
              </div>
            ) : filteredAndSortedAlerts.banners.length === 0 && filteredAndSortedAlerts.regular.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-[#10131a] rounded-xl border border-[#232838] p-4 text-center">
                <ShieldAlert className="w-8 h-8 text-emerald-400/80 mb-2" />
                <span className="text-sm font-semibold text-gray-200">目前無符合條件的交通警報</span>
                <span className="text-xs text-gray-500 mt-1">目前大溫運具運行正常，或請調整篩選與搜尋關鍵字</span>
              </div>
            ) : (
              <>
                {/* 3.6 橫幅緊急通知置頂 (Banner alerts - Always on top) */}
                {filteredAndSortedAlerts.banners.map((b, bIdx) => (
                  <div
                    key={`banner_${b.id || b.alertId}_${bIdx}`}
                    className="p-3.5 rounded-xl bg-gradient-to-br from-red-950/90 via-[#2c0e14] to-[#1a0c10] border border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.25)] flex flex-col gap-2 relative overflow-hidden ring-1 ring-red-500/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                        <span className="text-xs font-bold text-red-300 uppercase tracking-wider flex items-center gap-1">
                          <BellRing className="w-3.5 h-3.5 text-red-400" />
                          <span>系統全網緊急廣播</span>
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white font-mono shrink-0">
                        EMERGENCY
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-white leading-snug">
                      {b.header || b.alertText}
                    </h4>

                    {b.description && (
                      <p className="text-[11px] text-gray-200 leading-relaxed whitespace-pre-line bg-black/30 p-2 rounded-lg border border-red-500/20">
                        {b.description}
                      </p>
                    )}

                    {b.impacted_stations && b.impacted_stations.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        <span className="text-[10.5px] text-red-300">影響車站：</span>
                        {b.impacted_stations.map((st) => (
                          <button
                            key={st}
                            onClick={() => handleStationClick(st)}
                            className="text-[10.5px] px-2 py-0.5 rounded-md bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-600/50 flex items-center gap-0.5 transition-colors"
                            title={`在地圖定位 ${st} 站`}
                          >
                            <MapPin className="w-2.5 h-2.5 text-red-400" />
                            <span>{st}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* 3.5 Regular Alert Cards */}
                {filteredAndSortedAlerts.regular.map((item, idx) => {
                  const modeBg =
                    item.mode === 'skytrain'
                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                      : item.mode === 'bus'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : item.mode === 'seabus'
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      : item.mode === 'wce'
                      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                      : 'bg-gray-500/15 text-gray-300 border-gray-500/30';

                  return (
                    <div
                      key={`reg_${item.id || item.alertId}_${item.mode}_${idx}`}
                      className="p-3 rounded-xl bg-[#131620] hover:bg-[#181d2a] border border-[#232838] hover:border-[#333d54] transition-all flex flex-col gap-2 shadow-sm"
                    >
                      {/* Card Header: Mode Badge, Effect Badge, Severity Badge */}
                      <div className="flex items-start justify-between gap-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10.5px] px-2 py-0.5 rounded-md font-semibold border ${modeBg} flex items-center gap-1`}>
                            {item.mode === 'skytrain' && <Train className="w-3 h-3" />}
                            {item.mode === 'bus' && <Bus className="w-3 h-3" />}
                            {item.mode === 'seabus' && <Ship className="w-3 h-3" />}
                            <span>{item.mode_name}</span>
                          </span>

                          {item.routeLongName && item.routeLongName !== item.mode_name && (
                            <span className="text-[10.5px] text-gray-300 font-bold bg-[#1c2230] px-2 py-0.5 rounded-md border border-[#2b3548] truncate max-w-[170px]" title={item.routeLongName}>
                              {item.routeLongName}
                            </span>
                          )}

                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2230] text-gray-300 border border-[#2b3548]">
                            {item.effect_zh}
                          </span>
                        </div>

                        {/* Critical / Advisory indicator */}
                        {item.critical ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-950/80 text-red-300 border border-red-700/60 flex items-center gap-1 shrink-0 animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-red-400"></span>
                            <span>嚴重影響</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-950/60 text-amber-300 border border-amber-800/50 flex items-center gap-1 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                            <span>營運提示</span>
                          </span>
                        )}
                      </div>

                      {/* Header / Summary */}
                      <h4 className="text-xs font-bold text-white leading-snug">
                        {item.header || item.alertText}
                      </h4>

                      {/* Description if available and different from header */}
                      {item.description && item.description.trim() !== (item.header || '').trim() && (
                        <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-line bg-[#0d1017] p-2 rounded-lg border border-[#1e2332]">
                          {item.description}
                        </p>
                      )}

                      {/* Impacted Stations Tags */}
                      {item.impacted_stations && item.impacted_stations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#1a1f2c]">
                          <span className="text-[10px] text-gray-400">受影響車站：</span>
                          {item.impacted_stations.map((st) => (
                            <button
                              key={st}
                              onClick={() => handleStationClick(st)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a2130] hover:bg-emerald-950 text-cyan-300 hover:text-emerald-300 border border-[#28354c] hover:border-emerald-500/50 flex items-center gap-0.5 transition-colors cursor-pointer"
                              title={`點擊定位 ${st} 站`}
                            >
                              <MapPin className="w-2.5 h-2.5 text-cyan-400" />
                              <span>{st}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Footer: Date and External Link */}
                      <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1 border-t border-[#1a1f2c]">
                        <span className="font-mono">
                          {item.lastModified
                            ? `更新：${new Date(item.lastModified).toLocaleDateString()} ${new Date(item.lastModified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : item.startTime
                            ? `生效：${new Date(item.startTime).toLocaleDateString()}`
                            : '即時更新'}
                        </span>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-rose-400 hover:text-rose-300 flex items-center gap-0.5 hover:underline"
                          >
                            <span>官方警報詳情</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== 5. 新聞分頁 (Vancouver News - 604 Now, CityNews, Global News BC, Daily Hive) ==================== */}
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
                { id: 'dailyhive', label: 'Daily Hive' },
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

            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={newsRefreshInterval || 15}
                onChange={(e) => setNewsRefreshInterval(Number(e.target.value))}
                className="bg-[#151922] text-gray-300 text-[11px] rounded-md px-1.5 py-1 border border-[#232838] focus:outline-none focus:border-amber-500/50 cursor-pointer"
                title="自訂新聞自動更新頻率"
              >
                <option value={5}>5分鐘</option>
                <option value={10}>10分鐘</option>
                <option value={15}>15分鐘</option>
                <option value={30}>30分鐘</option>
                <option value={60}>60分鐘</option>
              </select>
              <button
                onClick={() => fetchNews(true)}
                disabled={loadingNews}
                className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-amber-400 border border-[#232838] hover:border-amber-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
                title="立即重新整理新聞"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingNews ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* News Search Bar */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={newsSearchQuery}
              onChange={(e) => setNewsSearchQuery(e.target.value)}
              placeholder="從即時新聞清單搜尋關鍵字..."
              className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-amber-500/50 transition-colors"
            />
            {newsSearchQuery && (
              <button
                onClick={() => setNewsSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
              </button>
            )}
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
                <span className="text-xs">
                  {newsSearchQuery ? '查無符合條件之新聞' : '暫無相關新聞資料'}
                </span>
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
                  if (article.source_id === 'dailyhive') {
                    return {
                      bg: 'bg-amber-950/40 text-amber-300 border-amber-700/50',
                      name: 'Daily Hive',
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

      {/* ==================== 6. 活動分頁 (Vancouver Events - Eventbrite & Destination Vancouver) ==================== */}
      {activeTab === 'events' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Controls: Source Filter & Refresh */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              {[
                { id: 'all', label: '全部' },
                { id: 'daily_hive', label: 'Daily Hive' },
                { id: 'eventbrite', label: 'Eventbrite' },
                { id: 'destination_vancouver', label: '溫哥華旅遊局' },
              ].map((src) => {
                const isSelected = eventsFilter === src.id;
                return (
                  <button
                    key={src.id}
                    onClick={() => setEventsFilter(src.id as any)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all shrink-0 ${
                      isSelected
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm font-semibold'
                        : 'bg-[#151922] text-gray-400 hover:text-white border border-[#232838] hover:bg-[#1c2230]'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => fetchEvents(true)}
              disabled={loadingEvents}
              className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-purple-400 border border-[#232838] hover:border-purple-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
              title="重新整理活動"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin text-purple-400' : ''}`} />
            </button>
          </div>

          {/* Events Search Bar */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={eventsSearchQuery}
              onChange={(e) => setEventsSearchQuery(e.target.value)}
              placeholder="從活動清單搜尋活動名稱、場館或地點..."
              className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-purple-500/50 transition-colors"
            />
            {eventsSearchQuery && (
              <button
                onClick={() => setEventsSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Events List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 custom-scrollbar">
            {loadingEvents && filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mb-2" />
                <span className="text-xs">正在載入大溫即時熱門活動...</span>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <CalendarDays className="w-8 h-8 text-gray-600 mb-2" />
                <span className="text-xs">
                  {eventsSearchQuery ? '查無符合條件之活動' : '暫無活動資料'}
                </span>
              </div>
            ) : (
              filteredEvents.map((event) => {
                const sourceBadge = (() => {
                  if (event.source_id === 'daily_hive') {
                    return { bg: 'bg-rose-950/40 text-rose-300 border-rose-700/50', name: 'Daily Hive' };
                  }
                  if (event.source_id === 'destination_vancouver') {
                    return { bg: 'bg-purple-950/40 text-purple-300 border-purple-700/50', name: 'Destination Vancouver' };
                  }
                  return { bg: 'bg-orange-950/40 text-orange-300 border-orange-700/50', name: 'Eventbrite' };
                })();

                return (
                  <a
                    key={event.id}
                    href={(() => {
                      if (!event.url) return '#';
                      let u = event.url.replace('/listed/event/', '/listed/events/');
                      if (u.includes('destinationvancouver.com/events/') && !u.includes('/events/listings/')) {
                        u = u.replace('/events/', '/events/listings/');
                      }
                      return u;
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block p-3 rounded-xl bg-[#141822] border border-[#232838] hover:border-purple-500/50 hover:bg-[#181d2a] transition-all shadow-sm"
                  >
                    <div className="flex gap-3">
                      {event.image_url && (
                        <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-[#0c0e14] border border-[#232838] self-start">
                          <img
                            src={event.image_url}
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
                          <div className="flex items-center justify-between gap-1.5 mb-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${sourceBadge.bg}`}>
                                {sourceBadge.name}
                              </span>
                              {event.is_ongoing && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-950/50 text-amber-300 border-amber-600/60 flex items-center gap-0.5 shadow-sm">
                                  🔥 進行中
                                </span>
                              )}
                              {event.category && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700 font-medium">
                                  {event.category}
                                </span>
                              )}
                            </div>
                            <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-purple-400 transition-colors shrink-0" />
                          </div>

                          <h3 className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors line-clamp-2 leading-snug">
                            {event.title}
                          </h3>

                          {event.start_date && (
                            <div className="flex items-center gap-1 text-[10.5px] text-purple-400 mt-1 font-mono">
                              <Calendar className="w-3 h-3 shrink-0" />
                              <span className="truncate">{event.start_date}</span>
                            </div>
                          )}

                          {event.location_name && (
                            <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0 text-gray-500" />
                              <span className="truncate">{event.location_name}</span>
                            </div>
                          )}

                          {event.description && (
                            <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                              {event.description}
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

      {/* ==================== 美加邊境關口分頁 (Border Crossings - Live CBSA & CBP) ==================== */}
      {activeTab === 'border' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>美加邊境關口即時等候</span>
              </span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono font-medium">
                每 5 分鐘更新
              </span>
            </div>

            <button
              onClick={() => fetchBorderCrossings(true)}
              disabled={loadingBorder}
              className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-emerald-400 border border-[#232838] hover:border-emerald-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
              title="重新整理邊境等候時間"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBorder ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>

          {/* 方向篩選按鈕 (Direction Filter) */}
          <div className="flex items-center gap-1.5 p-1 bg-[#121620] rounded-lg border border-[#202738] shrink-0 text-xs">
            <button
              onClick={() => setBorderDirectionFilter('all')}
              className={`flex-1 py-1 rounded font-medium transition-colors ${
                borderDirectionFilter === 'all'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a202e]'
              }`}
            >
              雙向概況
            </button>
            <button
              onClick={() => setBorderDirectionFilter('us')}
              className={`flex-1 py-1 rounded font-medium transition-colors ${
                borderDirectionFilter === 'us'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a202e]'
              }`}
            >
              🇺🇸 入境美國
            </button>
            <button
              onClick={() => setBorderDirectionFilter('canada')}
              className={`flex-1 py-1 rounded font-medium transition-colors ${
                borderDirectionFilter === 'canada'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a202e]'
              }`}
            >
              🇨🇦 入境加拿大
            </button>
          </div>

          {/* 提示條 */}
          <div className="bg-[#101726] border border-emerald-900/40 rounded-lg p-2 text-[11px] text-emerald-200/90 flex items-center gap-2 shrink-0">
            <span className="text-base shrink-0">🛂</span>
            <span className="leading-snug">
              點擊關卡卡片，地圖將直接跳轉至該關口位置並顯示即時通關資訊。
            </span>
          </div>

          {/* 關卡清單 (Crossings List) */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingBorder && borderCrossings.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                <span>讀取美加邊境 (CBSA & CBP) 即時數據中...</span>
              </div>
            ) : borderCrossings.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232838]">
                暫無邊境關卡數據
              </div>
            ) : (
              borderCrossings.map((crossing) => {
                const usWait = crossing.us_bound?.standard_delay_min ?? null;
                const caWait = crossing.canada_bound?.traveller_delay_min ?? null;

                const getStatusColor = (min: number | null) => {
                  if (min === null) return 'text-gray-400 bg-gray-800/60 border-gray-700/50';
                  if (min <= 5) return 'text-emerald-300 bg-emerald-950/70 border-emerald-700/60';
                  if (min <= 20) return 'text-amber-300 bg-amber-950/70 border-amber-700/60';
                  return 'text-rose-300 bg-rose-950/70 border-rose-700/60';
                };

                return (
                  <div
                    key={crossing.id}
                    onClick={() => handleSelectBorderCrossing(crossing)}
                    className="p-3 rounded-xl bg-[#131722] hover:bg-[#181d2a] border border-[#242b3c] hover:border-emerald-500/50 transition-all shadow-sm cursor-pointer flex flex-col gap-2 group"
                  >
                    {/* Top Row: Title & Highway */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors truncate">
                          {crossing.name}
                        </h4>
                        <span className="text-[10px] text-gray-400 block truncate">
                          {crossing.english_name}
                        </span>
                      </div>
                      <span className="text-[9.5px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 px-2 py-0.5 rounded shrink-0">
                        {crossing.highway}
                      </span>
                    </div>

                    {/* Wait times boxes */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* 入境美國 (U.S. Bound) */}
                      {(borderDirectionFilter === 'all' || borderDirectionFilter === 'us') && (
                        <div className={`p-2 rounded-lg bg-[#0e121a] border border-[#1e2434] flex flex-col gap-1 ${borderDirectionFilter === 'us' ? 'col-span-2' : ''}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-sky-300 flex items-center gap-1">
                              <span>🇺🇸</span>
                              <span>南向往美國 (CBP)</span>
                            </span>
                            {crossing.us_bound?.standard_lanes_open != null && (
                              <span className="text-[9px] text-gray-400 font-mono">
                                開放 {crossing.us_bound.standard_lanes_open} 線
                              </span>
                            )}
                          </div>

                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">一般車道:</span>
                            <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded border font-mono ${getStatusColor(usWait)}`}>
                              {crossing.us_bound?.standard_status || (usWait !== null ? `${usWait} 分鐘` : '正常通行')}
                            </span>
                          </div>

                          {crossing.has_nexus && (
                            <div className="flex items-baseline justify-between text-[10px] text-gray-400 pt-1 border-t border-[#182030]">
                              <span>NEXUS:</span>
                              <span className="text-emerald-400 font-semibold font-mono">
                                {crossing.us_bound?.nexus_status || (crossing.us_bound?.nexus_delay_min === 0 ? '免等候' : `${crossing.us_bound?.nexus_delay_min} 分鐘`)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 入境加拿大 (Canada Bound) */}
                      {(borderDirectionFilter === 'all' || borderDirectionFilter === 'canada') && (
                        <div className={`p-2 rounded-lg bg-[#0e121a] border border-[#1e2434] flex flex-col gap-1 ${borderDirectionFilter === 'canada' ? 'col-span-2' : ''}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-rose-300 flex items-center gap-1">
                              <span>🇨🇦</span>
                              <span>北向往加拿大 (CBSA)</span>
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">旅客車道:</span>
                            <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded border font-mono ${getStatusColor(caWait)}`}>
                              {crossing.canada_bound?.traveller_status || (caWait !== null ? `${caWait} 分鐘` : '正常通行')}
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between text-[10px] text-gray-400 pt-1 border-t border-[#182030]">
                            <span>商業貨運:</span>
                            <span className="text-gray-300 font-mono">
                              {crossing.canada_bound?.commercial_status || '正常'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hours & Tips */}
                    {crossing.tips && (
                      <p className="text-[10.5px] text-gray-400 bg-[#0b0e14] p-1.5 rounded border border-[#1b212f] leading-relaxed">
                        {crossing.tips}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1 border-t border-[#1e2434]">
                      <span className="font-mono text-emerald-400/90">{crossing.hours || '24 小時全天開放'}</span>
                    </div>
                  </div>
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
          {activeTab === 'events' && `共收錄 ${filteredEvents.length} 項大溫熱門活動 · 來源 Daily Hive、Eventbrite 與 溫哥華旅遊局`}
          {activeTab === 'beach' && `共監測大溫 ${beachList.length || 41} 座海灘水質 · 每個月更新 1 次 · 資料來源：大溫都會局 (Metro Vancouver)`}
          {activeTab === 'ski' && `3 大滑雪場即時雪況 (賽普里斯山、松雞山、西摩山) · 每日更新`}
          {activeTab === 'aurora' && 'NOAA SWPC 行星 K-Index 極光指數 · 溫哥華可見度預測 · 每天 2 次更新'}
          {activeTab === 'fuel' && `共收錄 ${filteredFuelStations.length} 間加油站`}
          {activeTab === 'ev' && `共收錄 ${evStations.length} 座充電站`}
          {activeTab === 'ferry' && `共 ${ferryRoutes.reduce((acc, r) => acc + (r?.vessels?.length || 0), 0)} 艘渡輪即時航行中`}
          {activeTab === 'cargo' && `共追蹤 ${sortedShippingVessels.length} 艘溫哥華港口商船 (依抵達時間近至遠排序)`}
          {activeTab === 'alerts' && `共 ${filteredAndSortedAlerts.banners.length + filteredAndSortedAlerts.regular.length} 則 TransLink 即時運輸警報 · 每 ${transitAlertsRefreshInterval || 10} 分鐘自動更新`}
          {activeTab === 'border' && '美加邊境 5 大陸路關口即時等候時間 · 每 5 分鐘自動更新 · CBSA & CBP 官方數據'}
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
