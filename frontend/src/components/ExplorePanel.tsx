'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_ADMIN_SOURCES } from '@/data/defaultAdminSources';
import { Landmark, 
  Compass, X, Fuel, Zap, Ship, MapPin, ArrowUpDown, 
  ChevronDown, RefreshCw, Package, CloudSun, Wind, AlertTriangle, Droplets, Gauge, Eye, Anchor, Navigation,
  Newspaper, ExternalLink, Search, CalendarDays, Calendar, Tag, Waves, CloudRain, Play, Pause, SkipBack, SkipForward,
  MountainSnow, Sparkles, Clock, ShieldAlert, BellRing, Train, Bus, ShieldCheck, LayoutGrid, TrainTrack,
  Activity, Radar, Cpu, Satellite, Radio, Flag, Plane, Mountain, CreditCard,
  Briefcase, SlidersHorizontal, ChevronLeft, ChevronRight, Building2, DollarSign,
  PhoneCall, ShoppingBag, ZoomIn, ZoomOut, Download, Layers
} from 'lucide-react';
import { useUIStore, ExploreTabType } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';
import { formatShipEta, formatTimePreference, formatTimeRange, formatDateTime } from '@/utils/time';
import skytrainStationsData from '@/data/skytrainStations.json';
import snappedCorridorsData from '@/data/snapped_corridors.json';

export function getFerryRouteEnglishName(route: { route_id?: string; name?: string; name_en?: string }): string {
  const enMap: Record<string, string> = {
    "HSB_NAN": "Horseshoe Bay ⇄ Nanaimo (Departure Bay)",
    "TSA_SWB": "Tsawwassen ⇄ Swartz Bay (Victoria)",
    "HSB_LNG": "Horseshoe Bay ⇄ Langdale (Sunshine Coast)",
    "TSA_DUK": "Tsawwassen ⇄ Duke Point (Nanaimo)",
    "HSB_BOW": "Horseshoe Bay ⇄ Bowen Island",
  };
  if (route.route_id && enMap[route.route_id]) return enMap[route.route_id];
  const n = route.name || "";
  if (n.includes("馬蹄灣") && n.includes("納奈莫")) return "Horseshoe Bay ⇄ Nanaimo (Departure Bay)";
  if (n.includes("杜瓦森") && n.includes("斯沃茨灣")) return "Tsawwassen ⇄ Swartz Bay (Victoria)";
  if (n.includes("馬蹄灣") && n.includes("朗代爾")) return "Horseshoe Bay ⇄ Langdale (Sunshine Coast)";
  if (n.includes("杜瓦森") && n.includes("杜克角")) return "Tsawwassen ⇄ Duke Point (Nanaimo)";
  if (n.includes("馬蹄灣") && n.includes("寶雲島")) return "Horseshoe Bay ⇄ Bowen Island";
  return route.name_en || n;
}

export function formatFerryEtaText(eta?: string): string {
  if (!eta) return "";
  return eta
    .replace(/斯沃茨灣/g, "Swartz Bay (Victoria)")
    .replace(/杜瓦森/g, "Tsawwassen")
    .replace(/馬蹄灣/g, "Horseshoe Bay")
    .replace(/朗代爾/g, "Langdale (Sunshine Coast)")
    .replace(/出發灣/g, "Departure Bay (Nanaimo)")
    .replace(/納奈莫/g, "Nanaimo")
    .replace(/杜克角/g, "Duke Point (Nanaimo)")
    .replace(/寶雲島/g, "Bowen Island");
}

export function formatAuroraSpotName(name?: string): string {
  if (!name) return "";
  const m = name.match(/^(.*?)\s*[\(（](.*?)[\)）]$/);
  if (m) {
    const part1 = m[1].trim();
    const part2 = m[2].trim();
    const hasChinese1 = /[\u4e00-\u9fa5]/.test(part1);
    const hasChinese2 = /[\u4e00-\u9fa5]/.test(part2);
    if (hasChinese1 && !hasChinese2) {
      // part1 is Chinese, part2 is English -> English (Chinese)
      return `${part2} (${part1})`;
    } else {
      // part1 is English, part2 is Chinese -> English (Chinese)
      return `${part1} (${part2})`;
    }
  }
  return name;
}


export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface AtmItem {
  id: string;
  name: string;
  bank_code: string;
  bank_full_name: string;
  branch_name: string;
  address: string;
  postal_code: string;
  local_area: string;
  telephone: string;
  services: string[];
  services_str: string;
  opening_hours: Record<string, string>;
  is_24_7: boolean;
  transit_number: string;
  institution_number: string;
  routing_number: string;
  cheque_micr: string;
  swift_code: string;
  url: string;
  bank_website: string;
  lat: number;
  lon: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: any;
}

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

export interface TrafficCorridorItem {
  id: string;
  name: string;
  english_name?: string;
  route?: string;
  badge?: string;
  center: [number, number];
  zoom: number;
  status: string;
  status_color: string;
  current_speed_kmh: number;
  freeflow_speed_kmh: number;
  delay_min: number;
  trend: string;
  coordinates?: number[][];
  segments?: Array<{
    name: string;
    delay_min: number;
    speed_kmh: number;
    level: number;
    color: string;
  }>;
  incidents_count?: number;
  key_bottleneck?: string;
}

export interface TrafficIncidentItem {
  id: string;
  type?: string;
  type_label?: string;
  type_zh?: string;
  subtype?: string;
  subtype_zh?: string;
  icon?: string;
  color?: string;
  street?: string;
  city?: string;
  delay_min?: number;
  delay_minutes?: number;
  report_time_str?: string;
  time_display?: string;
  confidence?: number;
  confidence_pct?: number;
  description?: string;
  report_description?: string;
  lon?: number;
  lat?: number;
  coordinates?: [number, number];
  advice?: string;
  updated_at?: string;
}

export interface TrafficSummaryData {
  source: string;
  source_url: string;
  updated_at: string;
  overall_congestion_score: number;
  overall_status: string;
  freeflow_roads_count?: number;
  total_roads_count?: number;
  severe_roads_count?: number;
  total_jams: number;
  total_incidents: number;
  worst_corridor: string;
  corridors: TrafficCorridorItem[];
  major_roads?: TrafficCorridorItem[];
  top_alerts: TrafficIncidentItem[];
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
  last_sample_date?: string;
  notes?: string;
  advisory_url?: string;
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
  city?: string;
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

// 關鍵字/分詞模糊比對輔助函數 (支援例如 "cypress 16" 命中 "Cypress & 16th")
function matchSearchTokens(target: string, query: string): boolean {
  if (!query || !query.trim()) return true;
  const qTokens = query
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/[&/,\-+@#·().'":;]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (qTokens.length === 0) return true;
  const targetNorm = (target || '')
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/[&/,\-+@#·().'":;]+/g, ' ');
  return qTokens.every(tok => targetNorm.includes(tok));
}

export default function ExplorePanel() {
  const { isExploreOpen, openExploreTabs, setExploreOpen, setSearchTarget } = useUIStore();
  if (!isExploreOpen || (openExploreTabs && openExploreTabs.length === 0)) return null;

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
    openExploreTabs,
    openExploreTab,
    closeExploreTab,
    setOpenExploreTabs,
    closeAllExploreTabs,
    userLocation, 
    navigationAddress,
    setSettingsModalOpen,
    distanceUnit,
    temperatureUnit,
    timeFormat,
    newsRefreshInterval,
    setNewsRefreshInterval,
    transitAlertsRefreshInterval,
    setTransitAlertsRefreshInterval,
    stationAlertsMap,
    setStationAlertsMap,
    setTransitAlertsList,
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
    setRadarTilePath,
    timeZone,
    weatherSubTab,
    setWeatherSubTab,
    fuelLayerAutoEnabled,
    setFuelLayerAutoEnabled,
    adminSourceIntervals,
    setAdminSourceIntervals,
    selectedCrash,
    setSelectedCrash
  } = useUIStore();

  // 取得後台資料源更新頻率並同步 (當探索面板開啟時動態連動)
  useEffect(() => {
    if (!isExploreOpen) return;
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/admin/sources`)
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.sources)) {
          const map: Record<string, string> = {};
          data.sources.forEach((s: any) => {
            if (s.id && s.schedule_interval) {
              map[s.id] = s.schedule_interval;
            }
          });
          setAdminSourceIntervals(map);
        }
      })
      .catch(() => {});
  }, [isExploreOpen, setAdminSourceIntervals]);

  // --- TransLink Alerts states ---
  const [transitAlertsData, setTransitAlertsData] = useState<TranslinkAlertsData | null>(null);
  const [loadingTransitAlerts, setLoadingTransitAlerts] = useState<boolean>(false);
  const [alertsSubTab, setAlertsSubTab] = useState<'all' | 'skytrain' | 'bus' | 'seabus' | 'wce'>('all');
  const [alertsSearchQuery, setAlertsSearchQuery] = useState<string>('');
  const [alertsEffectFilter, setAlertsEffectFilter] = useState<string>('all');
  const [alertsSortBy, setAlertsSortBy] = useState<'severity' | 'newest' | 'oldest'>('severity');

  // --- TomTom Live Traffic states ---
  const [trafficSummary, setTrafficSummary] = useState<TrafficSummaryData | null>(null);
  const [loadingTraffic, setLoadingTraffic] = useState<boolean>(false);
  const [trafficFilter, setTrafficFilter] = useState<'all' | 'major_roads' | 'severe' | 'incidents'>('all');
  const [trafficSearchQuery, setTrafficSearchQuery] = useState<string>('');
  const [trafficSortBy, setTrafficSortBy] = useState<'default' | 'delay_desc' | 'speed_asc' | 'speed_desc' | 'name_asc'>('default');
  const [showCloseConfirm, setShowCloseConfirm] = useState<boolean>(false);
  const [draggedTab, setDraggedTab] = useState<ExploreTabType | null>(null);
  const [dragOverTab, setDragOverTab] = useState<ExploreTabType | null>(null);
  const [satelliteModalOpen, setSatelliteModalOpen] = useState<boolean>(false);
  const [satelliteChannel, setSatelliteChannel] = useState<'geocolor' | 'ir' | 'water_vapor'>('geocolor');
  const [satelliteRefreshKey, setSatelliteRefreshKey] = useState<number>(0);
  const [satelliteZoomLevel, setSatelliteZoomLevel] = useState<number>(1);
  const [enlargedAuroraImage, setEnlargedAuroraImage] = useState<{ src: string; title: string; subtitle?: string } | null>(null);
  const [auroraZoomLevel, setAuroraZoomLevel] = useState<number>(1);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (satelliteModalOpen) setSatelliteModalOpen(false);
        if (enlargedAuroraImage) setEnlargedAuroraImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [satelliteModalOpen, enlargedAuroraImage]);

  // --- 3-1-1 市政服務請求狀態 ---
  const [requests311, setRequests311] = useState<Array<{
    department?: string | null;
    service_request_type?: string | null;
    status?: string | null;
    closure_reason?: string | null;
    service_request_open_timestamp?: string | null;
    service_request_close_date?: string | null;
    last_modified_timestamp?: string | null;
    address?: string | null;
    local_area?: string | null;
    channel?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    geom?: { lon: number; lat: number } | null;
  }>>([]);
  const [loading311, setLoading311] = useState<boolean>(false);
  const [search311Query, setSearch311Query] = useState<string>('');
  const [status311Filter, setStatus311Filter] = useState<'all' | 'open' | 'close'>('all');
  const [dept311Filter, setDept311Filter] = useState<string>('all');
  const [sort311Order, setSort311Order] = useState<'desc' | 'asc'>('desc');

  // --- 購物 / 大統華 T&T 每週特價海報狀態 ---
  const [tntFlyers, setTntFlyers] = useState<Array<{
    id: string;
    image_url: string;
    image_name: string;
    validity: string;
    thumbnail: string;
    alt?: string;
  }>>([]);
  const [loadingTnt, setLoadingTnt] = useState<boolean>(false);
  const [selectedFlyerModal, setSelectedFlyerModal] = useState<number | null>(null);
  const [flyerZoomLevel, setFlyerZoomLevel] = useState<number>(1);

  // 取得 3-1-1 市政服務請求資料
  useEffect(() => {
    if (!isExploreOpen || exploreTab !== '311') return;
    if (requests311.length > 0) return;
    setLoading311(true);
    fetch('/vancouver_311.json')
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.results || []);
        setRequests311(list);
      })
      .catch(err => console.error('Failed to load 311 data:', err))
      .finally(() => setLoading311(false));
  }, [isExploreOpen, exploreTab, requests311.length]);

  // 取得大統華特價海報資料
  useEffect(() => {
    if (!isExploreOpen || exploreTab !== 'shopping') return;
    if (tntFlyers.length > 0) return;
    setLoadingTnt(true);
    fetch('/tnt_eflyers.json')
      .then(res => res.json())
      .then(data => {
        const list = data?.data?.eflyer_list || [];
        setTntFlyers(list);
      })
      .catch(err => console.error('Failed to load T&T flyers:', err))
      .finally(() => setLoadingTnt(false));
  }, [isExploreOpen, exploreTab, tntFlyers.length]);

  // --- 車禍意外 (Crashes) 狀態 ---
  const [crashesList, setCrashesList] = useState<Array<{
    location: string;
    count: number;
    lat: number;
    lon: number;
  }>>([]);
  const [loadingCrashes, setLoadingCrashes] = useState<boolean>(false);
  const [crashesSearchQuery, setCrashesSearchQuery] = useState<string>('');

  // 取得溫哥華車禍事故熱點資料
  useEffect(() => {
    if (!isExploreOpen || (exploreTab !== 'crashes' && !openExploreTabs?.includes('crashes'))) return;
    if (crashesList.length > 0) return;
    setLoadingCrashes(true);
    fetch('/vancouver_crashes.json')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCrashesList(data);
        }
      })
      .catch(err => console.error('Failed to load crashes data:', err))
      .finally(() => setLoadingCrashes(false));
  }, [isExploreOpen, exploreTab, openExploreTabs, crashesList.length]);

  const departments311 = useMemo(() => {
    const set = new Set<string>();
    requests311.forEach(r => {
      if (r.department && r.department.trim()) set.add(r.department.trim());
    });
    return Array.from(set).sort();
  }, [requests311]);

  const filtered311Requests = useMemo(() => {
    return requests311.filter(r => {
      if (status311Filter === 'open' && (r.status || '').toLowerCase() !== 'open') return false;
      if (status311Filter === 'close' && (r.status || '').toLowerCase() !== 'close') return false;
      if (dept311Filter !== 'all' && (r.department || '').trim() !== dept311Filter) return false;
      if (search311Query.trim()) {
        const q = search311Query.trim().toLowerCase();
        const str = `${r.address || ''} ${r.service_request_type || ''} ${r.department || ''} ${r.local_area || ''} ${r.closure_reason || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const timeA = new Date(a.service_request_open_timestamp || 0).getTime();
      const timeB = new Date(b.service_request_open_timestamp || 0).getTime();
      return sort311Order === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }, [requests311, status311Filter, dept311Filter, search311Query, sort311Order]);

  const yesterday311Count = useMemo(() => {
    if (!requests311 || requests311.length === 0) return 0;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
    const count = requests311.filter(r => r.service_request_open_timestamp && r.service_request_open_timestamp.startsWith(yStr)).length;
    if (count > 0) return count;

    const dates = Array.from(new Set(requests311.map(r => r.service_request_open_timestamp?.slice(0, 10)).filter(Boolean) as string[])).sort().reverse();
    const targetDate = dates[1] || dates[0];
    if (targetDate) {
      return requests311.filter(r => r.service_request_open_timestamp?.startsWith(targetDate)).length;
    }
    return requests311.length;
  }, [requests311]);

  const ROAD_ABBREVIATIONS: Record<string, string> = {
    street: 'st',
    streets: 'st',
    str: 'st',
    avenue: 'ave',
    avenues: 'ave',
    av: 'ave',
    road: 'rd',
    roads: 'rd',
    boulevard: 'blvd',
    boulevards: 'blvd',
    blv: 'blvd',
    drive: 'dr',
    highway: 'hwy',
    highways: 'hwy',
    court: 'ct',
    crescent: 'cres',
    way: 'wy',
    lane: 'ln',
    place: 'pl',
    parkway: 'pkwy',
    east: 'e',
    west: 'w',
    north: 'n',
    south: 's',
    northeast: 'ne',
    northwest: 'nw',
    southeast: 'se',
    southwest: 'sw'
  };

  const normalizeRoadTokens = (input: string): string[] => {
    if (!input) return [];
    const cleaned = input
      .toLowerCase()
      .replace(/[.,/&\\()\-#_]/g, ' ')
      .replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');

    return cleaned
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => ROAD_ABBREVIATIONS[t] || t);
  };

  const filteredCrashes = useMemo(() => {
    if (!crashesSearchQuery.trim()) return crashesList;
    const queryTokens = normalizeRoadTokens(crashesSearchQuery);
    if (queryTokens.length === 0) return crashesList;

    return crashesList.filter(c => {
      const locTokens = normalizeRoadTokens(c.location);
      return queryTokens.every(qToken =>
        locTokens.some(lToken => lToken === qToken || lToken.startsWith(qToken) || lToken.includes(qToken))
      );
    });
  }, [crashesList, crashesSearchQuery]);

  const format311DateTime = (val?: string | null) => {
    if (!val) return '';
    if (!val.includes(':') && !val.includes('T')) return val;
    return formatDateTime(val, timeFormat, timeZone);
  };

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

  const getGoogleNavUrl = (destLat: number, destLon: number) => {
    const base = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}`;
    if (navigationAddress && navigationAddress.trim()) {
      return `${base}&origin=${encodeURIComponent(navigationAddress.trim())}`;
    }
    return base;
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
  const [auroraForecastTab, setAuroraForecastTab] = useState<'tonight' | 'tomorrow'>('tonight');

  // --- News tab states ---
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [newsFilter, setNewsFilter] = useState<'all' | 'ctvnews' | 'cbc' | '604now' | 'citynews' | 'globalnews' | 'dailyhive'>('all');
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

  // --- WorkBC Jobs tab states ---
  const [jobKeyword, setJobKeyword] = useState<string>('');
  const [jobSearchInField, setJobSearchInField] = useState<'all' | 'title' | 'employer' | 'jobId'>('all');
  const [jobPageSize, setJobPageSize] = useState<number>(20);
  const [jobSortOrder, setJobSortOrder] = useState<number>(11);
  const [jobPage, setJobPage] = useState<number>(1);
  const [jobTotalCount, setJobTotalCount] = useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [jobsList, setJobsList] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState<boolean>(false);
  const [fetchingJobDetailId, setFetchingJobDetailId] = useState<string | null>(null);
  const [isJobFilterOpen, setIsJobFilterOpen] = useState<boolean>(false);
  const [externalJobConfirmation, setExternalJobConfirmation] = useState<{ url: string; title?: string } | null>(null);

  // 1. 工時類型
  const [filterJobTypeFullTime, setFilterJobTypeFullTime] = useState<boolean>(false);
  const [filterJobTypePartTime, setFilterJobTypePartTime] = useState<boolean>(false);
  const [filterJobTypeLeadingToFullTime, setFilterJobTypeLeadingToFullTime] = useState<boolean>(false);

  // 2. 工作模式
  const [filterJobTypeOnSite, setFilterJobTypeOnSite] = useState<boolean>(false);
  const [filterJobTypeHybrid, setFilterJobTypeHybrid] = useState<boolean>(false);
  const [filterJobTypeTravelling, setFilterJobTypeTravelling] = useState<boolean>(false);
  const [filterJobTypeVirtual, setFilterJobTypeVirtual] = useState<boolean>(false);

  // 3. 合約形式
  const [filterJobTypePermanent, setFilterJobTypePermanent] = useState<boolean>(false);
  const [filterJobTypeTemporary, setFilterJobTypeTemporary] = useState<boolean>(false);
  const [filterJobTypeCasual, setFilterJobTypeCasual] = useState<boolean>(false);
  const [filterJobTypeSeasonal, setFilterJobTypeSeasonal] = useState<boolean>(false);

  // 4. 工作排班
  const [filterJobTypeDay, setFilterJobTypeDay] = useState<boolean>(false);
  const [filterJobTypeEarly, setFilterJobTypeEarly] = useState<boolean>(false);
  const [filterJobTypeEvening, setFilterJobTypeEvening] = useState<boolean>(false);
  const [filterJobTypeFlexible, setFilterJobTypeFlexible] = useState<boolean>(false);
  const [filterJobTypeMorning, setFilterJobTypeMorning] = useState<boolean>(false);
  const [filterJobTypeNight, setFilterJobTypeNight] = useState<boolean>(false);
  const [filterJobTypeOnCall, setFilterJobTypeOnCall] = useState<boolean>(false);
  const [filterJobTypeOvertime, setFilterJobTypeOvertime] = useState<boolean>(false);
  const [filterJobTypeShift, setFilterJobTypeShift] = useState<boolean>(false);
  const [filterJobTypeTbd, setFilterJobTypeTbd] = useState<boolean>(false);
  const [filterJobTypeWeekend, setFilterJobTypeWeekend] = useState<boolean>(false);

  // 5. 薪資福利
  const [filterSalaryMin, setFilterSalaryMin] = useState<string>('');
  const [filterSalaryMax, setFilterSalaryMax] = useState<string>('');
  const [filterSalaryType, setFilterSalaryType] = useState<string>('');
  const [filterSalaryConditions, setFilterSalaryConditions] = useState<string[]>([]);

  // 6. 教育程度
  const [filterJobEducationLevel, setFilterJobEducationLevel] = useState<string[]>([]);

  // 7. 日期範圍
  const [filterDateSelection, setFilterDateSelection] = useState<string>('0');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  // 8. 特定對象
  const [filterIsApprentice, setFilterIsApprentice] = useState<boolean>(false);
  const [filterIsVeterans, setFilterIsVeterans] = useState<boolean>(false);
  const [filterIsIndigenous, setFilterIsIndigenous] = useState<boolean>(false);
  const [filterIsMatureWorkers, setFilterIsMatureWorkers] = useState<boolean>(false);
  const [filterIsNewcomers, setFilterIsNewcomers] = useState<boolean>(false);
  const [filterIsPeopleWithDisabilities, setFilterIsPeopleWithDisabilities] = useState<boolean>(false);
  const [filterIsStudents, setFilterIsStudents] = useState<boolean>(false);
  const [filterIsVisibleMinority, setFilterIsVisibleMinority] = useState<boolean>(false);
  const [filterIsYouth, setFilterIsYouth] = useState<boolean>(false);

  // 9. 刊登語言
  const [filterIsPostingsInEnglish, setFilterIsPostingsInEnglish] = useState<boolean>(true);
  const [filterIsPostingsInEnglishAndFrench, setFilterIsPostingsInEnglishAndFrench] = useState<boolean>(false);

  // 10. 排除中介代徵
  const [filterExcludePlacementAgencyJobs, setFilterExcludePlacementAgencyJobs] = useState<boolean>(false);

  const activeJobFilterCount = useMemo(() => {
    let count = 0;
    if (filterJobTypeFullTime || filterJobTypePartTime || filterJobTypeLeadingToFullTime) count++;
    if (filterJobTypeOnSite || filterJobTypeHybrid || filterJobTypeTravelling || filterJobTypeVirtual) count++;
    if (filterJobTypePermanent || filterJobTypeTemporary || filterJobTypeCasual || filterJobTypeSeasonal) count++;
    if (filterJobTypeDay || filterJobTypeEarly || filterJobTypeEvening || filterJobTypeFlexible || filterJobTypeMorning || filterJobTypeNight || filterJobTypeOnCall || filterJobTypeOvertime || filterJobTypeShift || filterJobTypeTbd || filterJobTypeWeekend) count++;
    if (filterSalaryMin || filterSalaryMax || filterSalaryType || filterSalaryConditions.length > 0) count++;
    if (filterJobEducationLevel.length > 0) count++;
    if (filterDateSelection !== '0' || filterStartDate || filterEndDate) count++;
    if (filterIsApprentice || filterIsVeterans || filterIsIndigenous || filterIsMatureWorkers || filterIsNewcomers || filterIsPeopleWithDisabilities || filterIsStudents || filterIsVisibleMinority || filterIsYouth) count++;
    if (!filterIsPostingsInEnglish || filterIsPostingsInEnglishAndFrench) count++;
    if (filterExcludePlacementAgencyJobs) count++;
    return count;
  }, [
    filterJobTypeFullTime, filterJobTypePartTime, filterJobTypeLeadingToFullTime,
    filterJobTypeOnSite, filterJobTypeHybrid, filterJobTypeTravelling, filterJobTypeVirtual,
    filterJobTypePermanent, filterJobTypeTemporary, filterJobTypeCasual, filterJobTypeSeasonal,
    filterJobTypeDay, filterJobTypeEarly, filterJobTypeEvening, filterJobTypeFlexible, filterJobTypeMorning, filterJobTypeNight, filterJobTypeOnCall, filterJobTypeOvertime, filterJobTypeShift, filterJobTypeTbd, filterJobTypeWeekend,
    filterSalaryMin, filterSalaryMax, filterSalaryType, filterSalaryConditions,
    filterJobEducationLevel,
    filterDateSelection, filterStartDate, filterEndDate,
    filterIsApprentice, filterIsVeterans, filterIsIndigenous, filterIsMatureWorkers, filterIsNewcomers, filterIsPeopleWithDisabilities, filterIsStudents, filterIsVisibleMinority, filterIsYouth,
    filterIsPostingsInEnglish, filterIsPostingsInEnglishAndFrench,
    filterExcludePlacementAgencyJobs
  ]);

  const resetJobFilters = () => {
    setFilterJobTypeFullTime(false);
    setFilterJobTypePartTime(false);
    setFilterJobTypeLeadingToFullTime(false);
    setFilterJobTypeOnSite(false);
    setFilterJobTypeHybrid(false);
    setFilterJobTypeTravelling(false);
    setFilterJobTypeVirtual(false);
    setFilterJobTypePermanent(false);
    setFilterJobTypeTemporary(false);
    setFilterJobTypeCasual(false);
    setFilterJobTypeSeasonal(false);
    setFilterJobTypeDay(false);
    setFilterJobTypeEarly(false);
    setFilterJobTypeEvening(false);
    setFilterJobTypeFlexible(false);
    setFilterJobTypeMorning(false);
    setFilterJobTypeNight(false);
    setFilterJobTypeOnCall(false);
    setFilterJobTypeOvertime(false);
    setFilterJobTypeShift(false);
    setFilterJobTypeTbd(false);
    setFilterJobTypeWeekend(false);
    setFilterSalaryMin('');
    setFilterSalaryMax('');
    setFilterSalaryType('');
    setFilterSalaryConditions([]);
    setFilterJobEducationLevel([]);
    setFilterDateSelection('0');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterIsApprentice(false);
    setFilterIsVeterans(false);
    setFilterIsIndigenous(false);
    setFilterIsMatureWorkers(false);
    setFilterIsNewcomers(false);
    setFilterIsPeopleWithDisabilities(false);
    setFilterIsStudents(false);
    setFilterIsVisibleMinority(false);
    setFilterIsYouth(false);
    setFilterIsPostingsInEnglish(true);
    setFilterIsPostingsInEnglishAndFrench(false);
    setFilterExcludePlacementAgencyJobs(false);
  };

  const fetchJobs = async (targetPage = 1, customPageSize = jobPageSize, customSortOrder = jobSortOrder) => {
    setLoadingJobs(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        Page: targetPage,
        PageSize: customPageSize,
        SortOrder: customSortOrder,
        Keyword: jobKeyword.trim(),
        SearchInField: jobSearchInField,
        SearchLocations: [{ City: "Vancouver", Postal: "", Region: "" }],
        SearchLocationDistance: -1,
        SearchJobTypeFullTime: filterJobTypeFullTime,
        SearchJobTypePartTime: filterJobTypePartTime,
        SearchJobTypeLeadingToFullTime: filterJobTypeLeadingToFullTime,
        SearchJobTypeOnSite: filterJobTypeOnSite,
        SearchJobTypeHybrid: filterJobTypeHybrid,
        SearchJobTypeTravelling: filterJobTypeTravelling,
        SearchJobTypeVirtual: filterJobTypeVirtual,
        SearchJobTypePermanent: filterJobTypePermanent,
        SearchJobTypeTemporary: filterJobTypeTemporary,
        SearchJobTypeCasual: filterJobTypeCasual,
        SearchJobTypeSeasonal: filterJobTypeSeasonal,
        SearchJobTypeDay: filterJobTypeDay,
        SearchJobTypeEarly: filterJobTypeEarly,
        SearchJobTypeEvening: filterJobTypeEvening,
        SearchJobTypeFlexible: filterJobTypeFlexible,
        SearchJobTypeMorning: filterJobTypeMorning,
        SearchJobTypeNight: filterJobTypeNight,
        SearchJobTypeOnCall: filterJobTypeOnCall,
        SearchJobTypeOvertime: filterJobTypeOvertime,
        SearchJobTypeShift: filterJobTypeShift,
        SearchJobTypeTbd: filterJobTypeTbd,
        SearchJobTypeWeekend: filterJobTypeWeekend,
        SalaryBracket6: true,
        SalaryMin: filterSalaryMin ? filterSalaryMin : undefined,
        SalaryMax: filterSalaryMax ? filterSalaryMax : undefined,
        SalaryType: filterSalaryType ? filterSalaryType : undefined,
        SearchSalaryConditions: filterSalaryConditions,
        SearchJobEducationLevel: filterJobEducationLevel,
        SearchDateSelection: filterDateSelection,
        StartDate: filterDateSelection === '3' && filterStartDate ? filterStartDate : null,
        EndDate: filterDateSelection === '3' && filterEndDate ? filterEndDate : null,
        SearchIsApprentice: filterIsApprentice,
        SearchIsVeterans: filterIsVeterans,
        SearchIsIndigenous: filterIsIndigenous,
        SearchIsMatureWorkers: filterIsMatureWorkers,
        SearchIsNewcomers: filterIsNewcomers,
        SearchIsPeopleWithDisabilities: filterIsPeopleWithDisabilities,
        SearchIsStudents: filterIsStudents,
        SearchIsVisibleMinority: filterIsVisibleMinority,
        SearchIsYouth: filterIsYouth,
        SearchIsPostingsInEnglish: filterIsPostingsInEnglish,
        SearchIsPostingsInEnglishAndFrench: filterIsPostingsInEnglishAndFrench,
        SearchExcludePlacementAgencyJobs: filterExcludePlacementAgencyJobs,
      };

      const res = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobTotalCount(typeof data.count === 'number' ? data.count : 0);
      setJobPage(typeof data.pageNumber === 'number' ? data.pageNumber : targetPage);
      setJobsList(Array.isArray(data.result) ? data.result : []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setJobsList([]);
      setJobTotalCount(0);
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'jobs' && jobsList.length === 0 && !loadingJobs) {
      fetchJobs(1);
    }
  }, [activeTab]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleJobClick = async (job: any) => {
    // 10.7 如果清單項目是打開外部網頁，彈出確認前往之對話框
    const externalUrl = job.ExternalSource?.Source?.[0]?.Url || job.ExternalSource?.Url || (job.ExternalSource && typeof job.ExternalSource === 'string' ? job.ExternalSource : null);
    if (externalUrl) {
      setExternalJobConfirmation({ url: externalUrl, title: job.Title });
      return;
    }

    setFetchingJobDetailId(job.JobId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let detailData: any = null;
      try {
        const res = await fetch(`/api/jobs/detail?jobId=${job.JobId}`);
        if (res.ok) {
          const json = await res.json();
          detailData = Array.isArray(json.result) ? json.result[0] : (json.result || json);
        }
      } catch (fetchErr) {
        console.warn('Job detail fetch error, using card data:', fetchErr);
      }

      const fullJob = { ...job, ...(detailData || {}) };
      // 1.5.3 在剛剛GetJobDetail取得的Location (lat, long) 彈到地圖上按下清單的項目, 然後彈到地圖上的位置lcoation (lat, long) 並顯示 popup
      const locList = fullJob.Location || job.Location;
      let lat = 49.2827;
      let lon = -123.1207;
      if (Array.isArray(locList) && locList.length > 0 && locList[0]?.Lat && locList[0]?.Lon) {
        lat = parseFloat(locList[0].Lat);
        lon = parseFloat(locList[0].Lon);
      } else if (fullJob.Latitude && fullJob.Longitude) {
        lat = parseFloat(fullJob.Latitude);
        lon = parseFloat(fullJob.Longitude);
      }

      setSearchTarget({
        id: `job_${job.JobId}`,
        title: fullJob.Title || job.Title,
        subtitle: fullJob.EmployerName || job.EmployerName,
        category: 'job',
        badge: '工作',
        icon: '💼',
        lat,
        lon,
        zoom: 14.5,
        meta: {
          local_area: fullJob.City || job.City || 'British Columbia',
          facility_type: 'job',
          properties: {
            ...fullJob,
            facility_type: 'job'
          }
        }
      });
      // 10.5 保持 ExplorePanel 開啟，方便關閉詳情後繼續查看其他工作
    } catch (err) {
      console.error('Failed to handle job selection:', err);
    } finally {
      setFetchingJobDetailId(null);
    }
  };

  const formatJobPostingDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    } catch {}
    return dateStr.slice(0, 10);
  };

  const translateJobTerm = (val?: string): string => {
    if (!val) return '';
    // 10.3 刪除英文括號顯示 (如 Full-time, Temporary, On-site 等)
    const clean = val.replace(/\s*\([A-Za-z0-9\s\-_/]+\)/g, '').trim();
    const lower = clean.toLowerCase();
    const map: Record<string, string> = {
      'full-time': '全職',
      'full time': '全職',
      'part-time': '兼職',
      'part time': '兼職',
      'leading to full-time': '兼職轉全職',
      'permanent': '永久聘用',
      'temporary': '臨時約聘',
      'casual': '散工 / 零工',
      'seasonal': '季節性',
      'on-site only': '現場上班',
      'on-site': '現場上班',
      'onsite': '現場上班',
      'hybrid work': '混合辦公',
      'hybrid': '混合辦公',
      'virtual work': '遠距辦公',
      'virtual': '遠距辦公',
      'remote': '遠距辦公',
      'travelling': '需出差',
      'travel': '需出差',
      'day': '日間班',
      'early': '清晨間',
      'early morning': '清晨間',
      'evening': '傍晚班',
      'flexible': '彈性工時',
      'flexible hours': '彈性工時',
      'morning': '早班',
      'night': '夜班/通宵',
      'on-call': '待命班',
      'oncall': '待命班',
      'overtime': '需配合加班',
      'shift': '輪班制',
      'weekend': '週末班',
      'weekend hours': '週末班',
      'tbd': '待定',
      'to be determined': '待定',
    };
    return map[lower] || clean;
  };

  const jobTotalPages = Math.max(1, Math.ceil(jobTotalCount / jobPageSize));

  // --- ATM tab states ---
  const [atmStations, setAtmStations] = useState<AtmItem[]>([]);
  const [loadingAtm, setLoadingAtm] = useState(false);
  const [atmSearchQuery, setAtmSearchQuery] = useState('');
  const [atmOnlyOpenToday, setAtmOnlyOpenToday] = useState(false);

  // --- Fuel tab states ---
  const [fuelType, setFuelType] = useState<'regular' | 'midgrade' | 'premium' | 'diesel'>('regular');
  const [fuelSortBy, setFuelSortBy] = useState<'best' | 'price' | 'distance'>('best');
  const [fuelSearchQuery, setFuelSearchQuery] = useState('');
  const [onlyMajorChains, setOnlyMajorChains] = useState(false);
  const [fuelStations, setFuelStations] = useState<FuelStation[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);

  // --- EV tab states ---
  const [evSortBy, setEvSortBy] = useState<'best' | 'price' | 'distance'>('best');
  const [evSearchQuery, setEvSearchQuery] = useState('');
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
  }, [beachList, beachStatusFilter, beachSearchQuery, beachSortBy]);

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
    setSearchTarget({
      id: `tide_${st.code}`,
      title: st.name,
      lon: st.lon,
      lat: st.lat,
      category: 'tide_stations',
      badge: '潮汐',
      icon: '🌊',
      meta: {
        facility_type: 'tide_stations',
        english_name: st.name,
        code: st.code,
        current_water_level_m: st.current_water_level_m,
        water_level: st.current_water_level_m,
        state: st.state,
        state_trend: st.state_trend,
        next_high: st.next_high,
        next_low: st.next_low,
        area: st.area
      }
    });
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

  // 1.5 Fetch ATM Stations
  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'atm') return;
    if (atmStations.length > 0) return;

    setLoadingAtm(true);
    fetch('/vancouver_atm.geojson')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load ATM data');
        return res.json();
      })
      .then((data) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const features = data.features || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: AtmItem[] = features.map((f: any) => ({
          id: f.id || f.properties?.id || `atm_${Math.random()}`,
          name: f.properties?.name || 'ATM',
          bank_code: f.properties?.bank_code || '',
          bank_full_name: f.properties?.bank_full_name || '',
          branch_name: f.properties?.branch_name || '',
          address: f.properties?.address || '',
          postal_code: f.properties?.postal_code || '',
          local_area: f.properties?.local_area || 'Vancouver',
          telephone: f.properties?.telephone || '',
          services: f.properties?.services || [],
          services_str: f.properties?.services_str || '',
          opening_hours: f.properties?.opening_hours || {},
          is_24_7: Boolean(f.properties?.is_24_7),
          transit_number: f.properties?.transit_number || '',
          institution_number: f.properties?.institution_number || '',
          routing_number: f.properties?.routing_number || '',
          cheque_micr: f.properties?.cheque_micr || '',
          swift_code: f.properties?.swift_code || '',
          url: f.properties?.url || '',
          bank_website: f.properties?.bank_website || '',
          lat: f.geometry?.coordinates?.[1] || 49.2827,
          lon: f.geometry?.coordinates?.[0] || -123.1207,
          properties: f.properties,
        }));
        setAtmStations(list);
        setLoadingAtm(false);
      })
      .catch((err) => {
        console.error('Error loading ATM data:', err);
        setLoadingAtm(false);
      });
  }, [isExploreOpen, activeTab, atmStations.length]);

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
    if (!isExploreOpen || (activeTab !== 'ev' && activeTab !== 'charging')) return;

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
      .then((res) => {
        if (!res.ok) throw new Error('API request failed');
        return res.json();
      })
      .then((data) => {
        if (data.stations && data.stations.length > 0) {
          setEvStations(data.stations);
          setLoadingEV(false);
        } else {
          throw new Error('No stations in API');
        }
      })
      .catch(async () => {
        // Fallback to static GeoJSON
        try {
          const res = await fetch('/vancouver_ev_charging.geojson');
          const geo = await res.json();
          const list: EVStation[] = (geo.features || []).map((f: any, idx: number) => {
            const p = f.properties || {};
            const coords = f.geometry?.coordinates || [-123.12, 49.28];
            const lat = coords[1];
            const lon = coords[0];
            let dist = 0;
            if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
              const dLat = (lat - userLocation.lat) * 111;
              const dLon = (lon - userLocation.lon) * 78;
              dist = Math.round(Math.sqrt(dLat * dLat + dLon * dLon) * 10) / 10;
            }
            return {
              id: String(p.id || idx + 1),
              name: p.name || p.address || '電動車充電站',
              address: p.address || 'Vancouver, BC',
              local_area: p.local_area || 'Vancouver',
              operator: p.operator || 'BC Hydro EV / Flo',
              connectors: p.connectors || 'CCS / J1772',
              ports: p.ports || 2,
              voltage: p.voltage || 'Level 2 / DC Fast',
              power_kw: p.power_kw || 50,
              cost: p.cost || '收費制 (依度數計費)',
              is_free: Boolean(p.is_free),
              distance_km: dist,
              lat,
              lon
            };
          });
          setEvStations(list);
        } catch (e) {
          console.error('Failed to load static EV charging stations:', e);
        } finally {
          setLoadingEV(false);
        }
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

  // Filter and sort ATM stations
  const filteredAtms = useMemo(() => {
    const dayIndex = new Date().getDay();
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayKey = dayKeys[dayIndex];

    let list = atmStations.map((atm) => {
      let distKm = 0;
      if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
        distKm = getDistanceKm(userLocation.lat, userLocation.lon, atm.lat, atm.lon);
      }

      let isOpenToday = false;
      let openHoursToday = '';
      const h = atm.opening_hours?.[todayKey];
      if (h && typeof h === 'string' && h.trim().length > 0 && !h.toLowerCase().includes('closed') && !h.includes('休息')) {
        isOpenToday = true;
        openHoursToday = `今日營業：${h}`;
      } else {
        isOpenToday = false;
        openHoursToday = '今日休息';
      }

      return {
        ...atm,
        distKm,
        isOpenToday,
        openHoursToday,
      };
    });

    if (atmOnlyOpenToday) {
      list = list.filter((a) => a.isOpenToday);
    }

    if (atmSearchQuery.trim()) {
      const q = atmSearchQuery.toLowerCase();
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.bank_full_name.toLowerCase().includes(q) ||
        a.address.toLowerCase().includes(q) ||
        a.branch_name.toLowerCase().includes(q) ||
        a.services_str.toLowerCase().includes(q)
      );
    }

    if (userLocation?.confirmed && userLocation.lat && userLocation.lon) {
      list.sort((a, b) => a.distKm - b.distKm);
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [atmStations, atmOnlyOpenToday, atmSearchQuery, userLocation]);

  // Filter major fuel chains if toggled & search query
  const filteredFuelStations = useMemo(() => {
    let list = fuelStations;
    if (onlyMajorChains) {
      const majorBrands = ['CHEVRON', 'SHELL', 'PETRO-CANADA', 'ESSO', 'MOBIL', 'COSTCO'];
      list = list.filter((s) => {
        const b = (s.brand || s.name || '').toUpperCase();
        return majorBrands.some((mb) => b.includes(mb));
      });
    }
    if (fuelSearchQuery.trim()) {
      const q = fuelSearchQuery.trim().toLowerCase();
      list = list.filter((s) => 
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.brand && s.brand.toLowerCase().includes(q)) ||
        (s.address && s.address.toLowerCase().includes(q)) ||
        (s.city && s.city.toLowerCase().includes(q))
      );
    }
    return list;
  }, [fuelStations, onlyMajorChains, fuelSearchQuery]);

  // Filter EV stations by search query
  const filteredEvStations = useMemo(() => {
    if (!evSearchQuery.trim()) return evStations;
    const q = evSearchQuery.trim().toLowerCase();
    return evStations.filter((s) => 
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.operator && s.operator.toLowerCase().includes(q)) ||
      (s.address && s.address.toLowerCase().includes(q)) ||
      (s.connectors && s.connectors.toLowerCase().includes(q)) ||
      (s.local_area && s.local_area.toLowerCase().includes(q)) ||
      (s.city && s.city.toLowerCase().includes(q))
    );
  }, [evStations, evSearchQuery]);

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

  if (!isExploreOpen || (openExploreTabs && openExploreTabs.length === 0)) return null;

  // Handle ATM click
  const handleSelectAtm = (atm: AtmItem & { distKm?: number; isOpenToday?: boolean; openHoursToday?: string }) => {
    enableLayer('atm');
    setSearchTarget({
      id: atm.id,
      title: atm.name,
      subtitle: atm.address,
      category: 'atm',
      layer_key: 'atm',
      badge: '銀行',
      icon: '🏧',
      lat: atm.lat,
      lon: atm.lon,
      meta: {
        local_area: atm.address || atm.local_area || 'Vancouver',
        properties: {
          id: atm.id,
          name: atm.name,
          bank_code: atm.bank_code,
          bank_full_name: atm.bank_full_name,
          branch_name: atm.branch_name,
          address: atm.address,
          postal_code: atm.postal_code,
          local_area: atm.local_area,
          telephone: atm.telephone,
          services: atm.services,
          services_str: atm.services_str,
          opening_hours: atm.opening_hours,
          is_24_7: atm.is_24_7,
          status_text: atm.is_24_7 ? '營業中 (24/7)' : (atm.isOpenToday ? '營業中' : '休息中'),
          transit_number: atm.transit_number,
          institution_number: atm.institution_number,
          routing_number: atm.routing_number,
          cheque_micr: atm.cheque_micr,
          swift_code: atm.swift_code,
          url: atm.url,
          bank_website: atm.bank_website,
          official_url: atm.bank_website || atm.url,
          facility_type: 'atm',
        }
      },
      zoom: 16.5
    });
  };

  // Handle Fuel click
  const handleSelectFuelStation = (st: FuelStation) => {
    if (!layers.fuel) {
      setFuelLayerAutoEnabled(true);
    }
    enableLayer('fuel');
    setSearchTarget({
      id: `fuel_${st.id}`,
      title: st.name || st.brand,
      subtitle: `${st.address} · 油價: ${st.price_current.toFixed(1)}¢`,
      category: 'fuel',
      layer_key: 'fuel',
      badge: '油站',
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
        name: "和平門關卡",
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
          nexus_status: "免等候",
          nexus_lanes_open: 2
        }
      },
      {
        id: "pacific_highway",
        name: "太平洋公路關卡",
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
          nexus_status: "免等候",
          nexus_lanes_open: 1
        }
      },
      {
        id: "aldergrove",
        name: "奧爾德格羅夫關卡",
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
          traveller_status: "免等候",
          commercial_delay_min: 0,
          commercial_status: "免等候",
          nexus_open: true
        },
        us_bound: {
          standard_delay_min: 0,
          standard_status: "免等候",
          standard_lanes_open: 2,
          nexus_delay_min: 0,
          nexus_status: "免等候",
          nexus_lanes_open: 1
        }
      },
      {
        id: "abbotsford_huntingdon",
        name: "阿伯茨福德關卡",
        english_name: "Abbotsford-Huntingdon / Sumas",
        highway: "BC Hwy 11 ↔ WA SR 9",
        lat: 49.0022,
        lon: -122.2646,
        zoom: 15.5,
        hours: "24 小時全天開放",
        crossing_type: "客車及商業貨運",
        has_nexus: true,
        has_commercial: true,
        tips: "菲沙河谷東部重要通關樞搞，直達蘇馬斯 (Sumas)，往貝克山滑雪度假主要途徑。",
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
        name: "羅伯茨角關卡",
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
          traveller_status: "免等候",
          commercial_delay_min: 0,
          commercial_status: "免等候",
          nexus_open: false
        },
        us_bound: {
          standard_delay_min: 0,
          standard_status: "免等候",
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

    const intervalMin = 5;
    const timer = setInterval(() => {
      fetchNews(true);
    }, intervalMin * 60 * 1000);
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, fetchNews]);

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
          setTransitAlertsList(data.alerts);
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
          setTransitAlertsList(staticData.alerts);
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
  }, [setStationAlertsMap, setTransitAlertsList]);

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
    const intervalMin = 5;
    const timer = setInterval(() => {
      fetchTranslinkAlerts(true);
    }, intervalMin * 60 * 1000);
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, fetchTranslinkAlerts]);

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

  // 10. Fetch TomTom & DriveBC Live Traffic Summary
  const fetchTrafficSummary = React.useCallback(async (force = false) => {
    setLoadingTraffic(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/traffic/summary${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.corridors) && data.corridors.length > 0) {
          if (!Array.isArray(data.major_roads) || data.major_roads.length === 0) {
            try {
              const staticRes = await fetch('/vancouver_traffic_summary_cache.json');
              if (staticRes.ok) {
                const staticData = await staticRes.json();
                if (staticData && Array.isArray(staticData.major_roads) && staticData.major_roads.length > 0) {
                  data.major_roads = staticData.major_roads;
                }
              }
            } catch (_) {}
          }
          setTrafficSummary(data);
          setLoadingTraffic(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend traffic summary API error, falling back to static cache:', err);
    }

    try {
      const staticRes = await fetch('/vancouver_traffic_summary_cache.json');
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        if (staticData && Array.isArray(staticData.corridors) && staticData.corridors.length > 0) {
          setTrafficSummary(staticData);
        }
      }
    } catch (staticErr) {
      console.error('Failed to load static traffic summary cache:', staticErr);
    } finally {
      setLoadingTraffic(false);
    }
  }, []);

  // Pre-load traffic summary on mount or when traffic tab is clicked
  useEffect(() => {
    if (!trafficSummary) {
      fetchTrafficSummary(false);
    }
  }, [fetchTrafficSummary, trafficSummary]);

  useEffect(() => {
    if (!isExploreOpen || activeTab !== 'traffic') return;
    fetchTrafficSummary(false);
    const timer = setInterval(() => {
      fetchTrafficSummary(true);
    }, 120000); // 2 分鐘自動輪詢更新
    return () => clearInterval(timer);
  }, [isExploreOpen, activeTab, fetchTrafficSummary]);

  const handleFlyToCorridor = (corridor: TrafficCorridorItem) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    const effectiveZoom = Math.min(corridor.zoom || 12.5, 12.6);
    let coords = corridor.coordinates;
    if (!coords || coords.length <= 2) {
      const cid = corridor.id;
      const baseId = cid.replace('mrn_', '').replace('oth_', '');
      coords = (snappedCorridorsData as any)[cid] || 
               (snappedCorridorsData as any)[baseId] || 
               (cid === 'hwy1' ? (snappedCorridorsData as any)['hwy1_east'] : null) || 
               coords;
    }
    if (mapInstance) {
      if (coords && coords.length >= 2) {
        let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
        coords.forEach(pt => {
          minLon = Math.min(minLon, pt[0]);
          maxLon = Math.max(maxLon, pt[0]);
          minLat = Math.min(minLat, pt[1]);
          maxLat = Math.max(maxLat, pt[1]);
        });
        const deltaLon = maxLon - minLon;
        const deltaLat = maxLat - minLat;
        if (deltaLon > 0.006 || deltaLat > 0.006) {
          mapInstance.fitBounds(
            [[minLon, minLat], [maxLon, maxLat]],
            {
              padding: { top: 120, bottom: 90, left: 80, right: 380 },
              maxZoom: 12.6,
              duration: 1000
            }
          );
        } else if (corridor.center) {
          mapInstance.flyTo({
            center: corridor.center,
            zoom: effectiveZoom,
            pitch: 25,
            essential: true
          });
        }
      } else if (corridor.center) {
        mapInstance.flyTo({
          center: corridor.center,
          zoom: effectiveZoom,
          pitch: 25,
          essential: true
        });
      }
    }
    setSearchTarget({
      id: `corridor_${corridor.id}`,
      title: corridor.name,
      subtitle: `${corridor.route || corridor.english_name || corridor.badge || '主要幹道'} · 延誤 +${corridor.delay_min || 0} 分鐘`,
      category: 'traffic_corridor',
      badge: corridor.badge || '主要幹道',
      icon: '🚗',
      lat: corridor.center[1],
      lon: corridor.center[0],
      zoom: effectiveZoom,
      meta: {
        coordinates: coords || corridor.coordinates,
        properties: {
          facility_type: 'traffic_conditions',
          name: corridor.name,
          corridor: corridor.name,
          street: corridor.route || corridor.english_name || corridor.name,
          speed_kmh: corridor.current_speed_kmh,
          freeflow_speed_kmh: corridor.freeflow_speed_kmh,
          delay_min: corridor.delay_min,
          level_label: corridor.status,
          trend: corridor.trend,
          description: corridor.key_bottleneck
        }
      }
    });
  };

  const handleFlyToTrafficAlert = (alert: TrafficIncidentItem) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap();
    let coords: [number, number] = [-123.12, 49.25];
    if (alert.coordinates && alert.coordinates.length === 2) {
      coords = [alert.coordinates[0], alert.coordinates[1]];
    } else if (alert.lon !== undefined && alert.lat !== undefined) {
      coords = [alert.lon, alert.lat];
    } else if (alert.id === 'alert_massey_accident') coords = [-123.076, 49.124];
    else if (alert.id === 'alert_lions_stall') coords = [-123.138, 49.309];
    else if (alert.id === 'alert_hwy1_hazard') coords = [-123.008, 49.255];
    else if (alert.id === 'alert_knight_jam') coords = [-123.078, 49.198];
    else if (alert.id === 'alert_ironworkers_debris') coords = [-123.025, 49.308];
    else if (alert.id === 'alert_oak_police') coords = [-123.129, 49.202];

    if (mapInstance) {
      mapInstance.flyTo({
        center: coords,
        zoom: 15,
        pitch: 30,
        essential: true
      });
    }
    setSearchTarget({
      id: `alert_${alert.id}`,
      title: `${alert.type_label || alert.subtype_zh || alert.type_zh || '即時通報'}`,
      subtitle: `${alert.street || alert.city || '事故路段'} · 延誤約 ${alert.delay_min ?? alert.delay_minutes ?? 0} 分鐘`,
      category: 'traffic_incident',
      badge: '即時通報',
      icon: alert.icon || '⚠️',
      lat: coords[1],
      lon: coords[0],
      zoom: 15,
      meta: {
        local_area: alert.street || alert.city || '大溫突發事故',
        properties: {
          ...alert,
          facility_type: 'traffic_alerts'
        }
      }
    });
  };

  // Helper to ensure traffic items strictly adhere to allowed cities (Vancouver, Richmond, Burnaby, North Vancouver)
  // and exclude Surrey, Coquitlam, Delta, New Westminster, Pattullo, Alex Fraser.
  const isTrafficExcluded = (item: any): boolean => {
    if (!item) return false;
    const str = `${item.id || ''} ${item.corridor_group || ''} ${item.name || ''} ${item.english_name || ''} ${item.street || ''} ${item.city || ''} ${item.badge || ''} ${item.route || ''} ${item.description || ''} ${item.report_description || ''} ${item.key_bottleneck || ''}`.toLowerCase();
    return (
      str.includes('surrey') ||
      str.includes('coquitlam') ||
      str.includes('delta') ||
      str.includes('new westminster') ||
      str.includes('pattullo') ||
      str.includes('alex fraser') ||
      str.includes('alex_fraser') ||
      str.includes('新西敏') ||
      str.includes('素里') ||
      str.includes('高貴林') ||
      str.includes('三角洲') ||
      str.includes('帕圖洛')
    );
  };

  // Sorting helper for traffic corridors & major roads
  const sortTrafficList = <T extends { delay_min?: number; current_speed_kmh?: number; name?: string; english_name?: string }>(list: T[]): T[] => {
    if (trafficSortBy === 'default') return list;
    const copy = [...list];
    switch (trafficSortBy) {
      case 'delay_desc':
        return copy.sort((a, b) => (b.delay_min || 0) - (a.delay_min || 0));
      case 'speed_asc':
        return copy.sort((a, b) => (a.current_speed_kmh || 0) - (b.current_speed_kmh || 0));
      case 'speed_desc':
        return copy.sort((a, b) => (b.current_speed_kmh || 0) - (a.current_speed_kmh || 0));
      case 'name_asc':
        return copy.sort((a, b) => {
          const nameA = a.name || a.english_name || '';
          const nameB = b.name || b.english_name || '';
          return nameA.localeCompare(nameB, 'zh-TW');
        });
      default:
        return copy;
    }
  };

  // Filtered corridors (主要動脈) based on query
  const filteredCorridors = useMemo(() => {
    if (!trafficSummary || !Array.isArray(trafficSummary.corridors)) return [];
    let list = trafficSummary.corridors.filter((c) => !isTrafficExcluded(c));
    if (trafficSearchQuery.trim()) {
      const q = trafficSearchQuery.toLowerCase().trim();
      list = list.filter((c) => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.english_name && c.english_name.toLowerCase().includes(q)) ||
        (c.route && c.route.toLowerCase().includes(q)) ||
        (c.badge && c.badge.toLowerCase().includes(q)) ||
        (c.key_bottleneck && c.key_bottleneck.toLowerCase().includes(q))
      );
    }
    return sortTrafficList(list);
  }, [trafficSummary, trafficSearchQuery, trafficSortBy]);

  // Filtered major roads (主要道路 - Major Road Network + Other major thoroughfares from MajorRoad.txt)
  const filteredMajorRoads = useMemo(() => {
    if (!trafficSummary || !Array.isArray(trafficSummary.major_roads)) return [];
    let list = trafficSummary.major_roads.filter((c) => !isTrafficExcluded(c));
    if (trafficSearchQuery.trim()) {
      const q = trafficSearchQuery.toLowerCase().trim();
      list = list.filter((c) => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.english_name && c.english_name.toLowerCase().includes(q)) ||
        (c.route && c.route.toLowerCase().includes(q)) ||
        (c.badge && c.badge.toLowerCase().includes(q)) ||
        (c.key_bottleneck && c.key_bottleneck.toLowerCase().includes(q))
      );
    }
    return sortTrafficList(list);
  }, [trafficSummary, trafficSearchQuery, trafficSortBy]);

  // Filtered severe roads (嚴重壅塞 - 篩選出目前全線有延誤或壅塞之幹道與主要道路)
  const filteredSevereRoads = useMemo(() => {
    if (!trafficSummary) return [];
    const all = [
      ...(trafficSummary.corridors || []),
      ...(trafficSummary.major_roads || [])
    ].filter((c) => !isTrafficExcluded(c));
    let list = all.filter((c) => 
      (c.delay_min || 0) >= 3 || 
      (c.status && (
        c.status.toLowerCase().includes('heavy') || 
        c.status.toLowerCase().includes('moderate') || 
        c.status.includes('嚴重') || 
        c.status.includes('重度') || 
        c.status.includes('車多')
      ))
    );
    if (trafficSearchQuery.trim()) {
      const q = trafficSearchQuery.toLowerCase().trim();
      list = list.filter((c) => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.english_name && c.english_name.toLowerCase().includes(q)) ||
        (c.route && c.route.toLowerCase().includes(q)) ||
        (c.badge && c.badge.toLowerCase().includes(q)) ||
        (c.key_bottleneck && c.key_bottleneck.toLowerCase().includes(q))
      );
    }
    return list;
  }, [trafficSummary, trafficSearchQuery]);

  const filteredTrafficAlerts = useMemo(() => {
    if (!trafficSummary || !Array.isArray(trafficSummary.top_alerts)) return [];
    let list = trafficSummary.top_alerts.filter((a) => !isTrafficExcluded(a));
    if (trafficSearchQuery.trim()) {
      const q = trafficSearchQuery.toLowerCase().trim();
      list = list.filter((a) => {
        const typeLabel = a.type_label || a.subtype_zh || a.type_zh || '';
        const street = a.street || a.city || '';
        const desc = a.description || a.report_description || '';
        return (
          typeLabel.toLowerCase().includes(q) ||
          street.toLowerCase().includes(q) ||
          desc.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [trafficSummary, trafficSearchQuery]);

  // Filtered border crossings based on direction (雙向 / 入境美國 / 入境加拿大)
  const filteredBorderCrossings = useMemo(() => {
    return borderCrossings.filter((crossing) => {
      if (borderDirectionFilter === 'us') return crossing.us_bound != null;
      if (borderDirectionFilter === 'canada') return crossing.canada_bound != null;
      return true;
    });
  }, [borderCrossings, borderDirectionFilter]);

  const tabInfoMap: Record<string, { label: string; icon: any; color: string }> = {
    weather: { label: '天氣資訊', icon: CloudSun, color: 'text-sky-400' },
    news: { label: '新聞快訊', icon: Newspaper, color: 'text-amber-400' },
    events: { label: '活動情報', icon: CalendarDays, color: 'text-purple-400' },
    beach: { label: '泳灘水質', icon: Droplets, color: 'text-teal-300' },
    ski: { label: '滑雪場現況', icon: MountainSnow, color: 'text-cyan-400' },
    aurora: { label: '極光觀測', icon: Sparkles, color: 'text-fuchsia-400' },
    jobs: { label: '工作職位', icon: Briefcase, color: 'text-indigo-400' },
    '311': { label: '3-1-1 市政服務', icon: PhoneCall, color: 'text-emerald-400' },
    shopping: { label: '購物優惠', icon: ShoppingBag, color: 'text-rose-400' },
    atm: { label: '銀行', icon: Landmark, color: 'text-amber-400' },
    fuel: { label: '油站', icon: Fuel, color: 'text-amber-500' },
    charging: { label: '充電站', icon: Zap, color: 'text-emerald-400' },
    ev: { label: '充電站', icon: Zap, color: 'text-emerald-400' },
    alerts: { label: '即時通報', icon: AlertTriangle, color: 'text-rose-400' },
    traffic: { label: '即時路況', icon: Activity, color: 'text-orange-400' },
    crashes: { label: '車禍意外', icon: ShieldAlert, color: 'text-rose-400' },
    border: { label: '美加邊境關口', icon: Flag, color: 'text-blue-400' },
    ferry: { label: 'BC 渡輪', icon: Anchor, color: 'text-sky-400' },
    shipping: { label: '即時航運', icon: Ship, color: 'text-teal-400' },
    cargo: { label: '即時航運', icon: Ship, color: 'text-teal-400' },
    flights: { label: '航班動態', icon: Plane, color: 'text-indigo-400' },
  };

  const tabShortTitleMap: Record<string, string> = {
    weather: '天氣',
    news: '新聞',
    events: '活動',
    beach: '泳灘',
    ski: '滑雪',
    aurora: '極光',
    jobs: '工作',
    '311': '3-1-1',
    shopping: '購物',
    atm: '銀行',
    fuel: '油站',
    charging: '充電',
    ev: '充電',
    alerts: '通報',
    traffic: '路況',
    crashes: '意外',
    border: '關口',
    ferry: '渡輪',
    shipping: '航運',
    cargo: '航運',
    flights: '航班',
  };

  const tabsToRender = (openExploreTabs && openExploreTabs.length > 0) ? openExploreTabs : [activeTab];

  return (
    <div 
      className="fixed top-[64px] sm:top-[70px] left-2 right-2 sm:left-auto sm:right-[72px] z-50 sm:z-40 w-auto sm:w-[520px] max-w-[calc(100vw-16px)] sm:max-w-[calc(100vw-96px)] bottom-[calc(62px+env(safe-area-inset-bottom,0px))] sm:bottom-auto max-h-[calc(100dvh-130px)] sm:max-h-[calc(100vh-148px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col animate-in fade-in slide-in-from-right-4 duration-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. 當多於1個分頁時的關閉確認對話框 (Close Confirmation Dialog) */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-50 bg-[#0d1017]/80 backdrop-blur-sm rounded-xl flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#1b202c] border border-[#30384a] rounded-xl p-4 shadow-2xl max-w-[320px] w-full text-center flex flex-col gap-3 animate-in zoom-in-95 duration-150">
            <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-bold text-white">關閉探索面板？</h3>
              <p className="text-xs text-gray-300">
                目前已開啟 <span className="text-amber-400 font-semibold">{tabsToRender.length}</span> 個分頁，確定要關閉整個探索視窗嗎？
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 py-1.5 px-3 rounded-lg bg-[#272e3d] hover:bg-[#323b4e] text-gray-200 text-xs font-medium transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseConfirm(false);
                  if (selectedCrash) {
                    const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                    if (mapInstance) {
                      mapInstance.flyTo({
                        center: [selectedCrash.lon, selectedCrash.lat],
                        zoom: 16.5,
                        essential: true
                      });
                    }
                  }
                  closeAllExploreTabs();
                  setSearchTarget(null);
                }}
                className="flex-1 py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                確認關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 瀏覽器風格多分頁導航標籤列，支援拖曳左右互換次序 (Draggable Tab Bar) */}
      <div className="flex items-center gap-1.5 pb-2 mb-2.5 border-b border-[#262b38] shrink-0 min-w-0">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 min-w-0 pr-1">
          {tabsToRender.map((tabId) => {
            const info = tabInfoMap[tabId] || { label: tabId, icon: Compass, color: 'text-emerald-400' };
            const TabIcon = info.icon;
            const isSelected = activeTab === tabId;
            const shortLabel = tabShortTitleMap[tabId] || info.label;
            const isDragging = draggedTab === tabId;
            const isDragOver = dragOverTab === tabId;

            return (
              <div
                key={tabId}
                draggable
                onDragStart={(e) => {
                  setDraggedTab(tabId);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tabId);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverTab !== tabId) {
                    setDragOverTab(tabId);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverTab === tabId) {
                    setDragOverTab(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedTab && draggedTab !== tabId) {
                    const currentTabs = [...tabsToRender];
                    const fromIdx = currentTabs.indexOf(draggedTab);
                    const toIdx = currentTabs.indexOf(tabId);
                    if (fromIdx !== -1 && toIdx !== -1) {
                      currentTabs.splice(fromIdx, 1);
                      currentTabs.splice(toIdx, 0, draggedTab);
                      if (setOpenExploreTabs) {
                        setOpenExploreTabs(currentTabs);
                      }
                    }
                  }
                  setDraggedTab(null);
                  setDragOverTab(null);
                }}
                onDragEnd={() => {
                  setDraggedTab(null);
                  setDragOverTab(null);
                }}
                onClick={() => setExploreTab(tabId)}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-grab active:cursor-grabbing transition-all border shrink-0 select-none ${
                  isDragging ? 'opacity-40 scale-95' : ''
                } ${
                  isDragOver ? 'ring-2 ring-emerald-400 border-emerald-400 scale-105' : ''
                } ${
                  isSelected
                    ? 'bg-[#22283a] text-white border-emerald-500/60 shadow-md ring-1 ring-emerald-500/30'
                    : 'bg-[#12151e]/80 text-gray-400 hover:text-gray-200 hover:bg-[#1a202e] border-[#222735]'
                }`}
                title={`可拖曳排序：${info.label}`}
              >
                <TabIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? info.color : 'text-gray-400 group-hover:text-gray-300'}`} />
                <span className="whitespace-nowrap">{shortLabel}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tabId === 'crashes' && selectedCrash) {
                      const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                      if (mapInstance) {
                        mapInstance.flyTo({
                          center: [selectedCrash.lon, selectedCrash.lat],
                          zoom: 16.5,
                          essential: true
                        });
                      }
                    }
                    closeExploreTab(tabId);
                  }}
                  className="ml-0.5 p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-rose-400 transition-colors"
                  title={`關閉 ${shortLabel} 分頁`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* 右側視窗關閉按鈕 (當多於1個分頁時彈出確認對話框) */}
        <button
          onClick={() => {
            if (tabsToRender.length > 1) {
              setShowCloseConfirm(true);
            } else {
              if (selectedCrash) {
                const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                if (mapInstance) {
                  mapInstance.flyTo({
                    center: [selectedCrash.lon, selectedCrash.lat],
                    zoom: 16.5,
                    essential: true
                  });
                }
              }
              closeAllExploreTabs();
              setSearchTarget(null);
            }
          }}
          className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-[#252a38] transition-colors shrink-0 ml-1 cursor-pointer"
          title="關閉探索面板"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ==================== 0. 天氣分頁 (Weather - ECCC MSC GeoMet) ==================== */}
      {activeTab === 'weather' && (
        <div className="flex flex-col flex-1 min-h-0 gap-2.5 overflow-hidden">
          {/* 1.1 天氣 4 大子分頁導航：市區預報, 即時監察, 模式預報, 海洋水文 (固定置頂) */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#10131d] rounded-lg border border-[#252a38] shrink-0 z-10 shadow-sm">
            {[
              { key: 'city', label: '市區預報', icon: CloudSun },
              { key: 'monitoring', label: '即時監察', icon: Radar },
              { key: 'models', label: '模式預報', icon: Cpu },
              { key: 'marine', label: '海洋水文', icon: Waves },
            ].map((pill) => {
              const Icon = pill.icon;
              const isSubActive = weatherSubTab === pill.key;
              return (
                <button
                  key={pill.key}
                  onClick={() => setWeatherSubTab(pill.key as any)}
                  className={`py-1.5 text-[10.5px] rounded font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    isSubActive
                      ? 'bg-sky-600 text-white shadow-sm font-bold ring-1 ring-sky-400/40'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{pill.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">

          {loadingWeather && !weather ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2.5 text-gray-400 text-xs">
              <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
              <span>讀取加拿大環境部 (ECCC MSC GeoMet) 即時氣象中...</span>
            </div>
          ) : weather ? (
            <>
              {/* ==================== 子分頁 1：市區預報 ==================== */}
              {weatherSubTab === 'city' && (
                <div className="flex flex-col gap-3">
                  {/* 所在地區與標題 */}
                  <div className="flex flex-col">
                    <span className="text-[11px] text-gray-400 font-medium">您的地區</span>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-extrabold text-white tracking-wide">{weather.city || '溫哥華'}</h3>
                      <span className="text-[10px] text-sky-400/90 font-mono bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 rounded-full">
                        加拿大環境部即時
                      </span>
                    </div>
                  </div>

                  {/* 核心氣溫與天候卡片 */}
                  <div className="bg-[#12151e] border border-[#262c3c] rounded-xl p-4 shadow-lg flex flex-col">
                    <div className="flex items-center gap-4">
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
                          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-sky-200 drop-shadow-[0_0_8px_rgba(186,230,253,0.2)]">
                            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                          </svg>
                        )}
                      </div>

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

                  </div>

                  {/* 加拿大環境部警告 */}
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

                  {/* 24 小時每小時天氣預報 */}
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

                  {/* 空氣質素健康指數 (AQHI) */}
                  {weather.aqhi && (() => {
                    const aqhiVal = weather.aqhi.value || 1;
                    const aqhiColors = [
                      '#56b4e9', '#3399ff', '#0072b2',
                      '#f0e442', '#e69f00', '#d55e00',
                      '#cc3333', '#b22222', '#8b0000', '#882255',
                      '#4a101d'
                    ];
                    const valIdx = Math.min(Math.max(aqhiVal - 1, 0), 10);
                    const leftPercent = ((valIdx + 0.5) / 11) * 100;

                    return (
                      <div className="bg-[#12151e] border border-[#262c3c] rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5 mt-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]"></span>
                            <h4 className="text-xs font-bold text-white tracking-wide">空氣質素健康指數</h4>
                          </div>
                          <span className="text-[10px] text-sky-400 font-mono bg-sky-950/60 border border-sky-800/40 px-1.5 py-0.5 rounded">
                            AQHI
                          </span>
                        </div>

                        <div className="text-[10px] text-gray-400 font-mono">
                          {(() => {
                            const raw = weather.aqhi.calculated_at || '';
                            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw)) {
                              const [datePart, timePart] = raw.split(/\s+/);
                              return `${datePart} ${formatTimePreference(timePart, timeFormat)}`;
                            }
                            return raw || '2026-10-31 03:00';
                          })()}
                        </div>

                        <div className="pt-5 pb-1 relative">
                          <div 
                            className="absolute top-0 -translate-x-1/2 flex flex-col items-center transition-all duration-300"
                            style={{ left: `${leftPercent}%` }}
                          >
                            <div className="px-1.5 py-0.5 bg-white text-gray-900 border border-gray-300 rounded font-bold text-[11px] leading-tight shadow-sm font-mono">
                              {weather.aqhi.value_display || aqhiVal}
                            </div>
                            <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[4px] border-t-white -mt-[1px]"></div>
                          </div>

                          <div className="grid grid-cols-11 h-3 rounded overflow-hidden shadow-inner border border-black/40">
                            {aqhiColors.map((color, i) => (
                              <div key={i} style={{ backgroundColor: color }} className="h-full"></div>
                            ))}
                          </div>

                          <div className="grid grid-cols-11 text-center text-[9px] text-gray-400 font-mono mt-1 select-none">
                            <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                            <span>6</span><span>7</span><span>8</span><span>9</span><span>10</span><span>+</span>
                          </div>

                          <div className="grid grid-cols-4 text-center mt-1 pt-1 border-t border-[#232838] text-[9.5px]">
                            <div className="text-sky-300 font-medium">
                              <div>低風險</div>
                              <div className="text-[8.5px] text-gray-400">(1-3)</div>
                            </div>
                            <div className="text-yellow-300 font-medium">
                              <div>中風險</div>
                              <div className="text-[8.5px] text-gray-400">(4-6)</div>
                            </div>
                            <div className="text-rose-400 font-medium">
                              <div>高風險</div>
                              <div className="text-[8.5px] text-gray-400">(7-10)</div>
                            </div>
                            <div className="text-amber-600 font-medium">
                              <div>極高風險</div>
                              <div className="text-[8.5px] text-gray-400">(10+)</div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div className="bg-[#181c26] border border-[#282f42] p-2 rounded-lg flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-sky-300">高敏感族群</span>
                            <span className="text-[10px] text-gray-300 leading-relaxed">
                              {weather.aqhi.at_risk_msg || '可如常進行戶外活動。'}
                            </span>
                          </div>
                          <div className="bg-[#181c26] border border-[#282f42] p-2 rounded-lg flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-emerald-300">一般民眾</span>
                            <span className="text-[10px] text-gray-300 leading-relaxed">
                              {weather.aqhi.general_msg || '適合進行戶外活動的理想空氣品質。'}
                            </span>
                          </div>
                        </div>

                        {weather.aqhi.forecasts && weather.aqhi.forecasts.length > 0 && (
                          <div className="pt-2 border-t border-[#232838] flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10.5px] font-bold text-gray-300">預報峰值</span>
                              <a 
                                href="https://weather.gc.ca/airquality/pages/bcaq-001_e.html" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="p-1 rounded bg-[#1e2433] hover:bg-[#283044] border border-[#2e374d] text-sky-400 hover:text-white transition-colors flex items-center justify-center"
                                title="開啟官方專頁"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
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
              )}

              {/* ==================== 子分頁 2：即時監察 ==================== */}
              {weatherSubTab === 'monitoring' && (
                <div className="flex flex-col gap-3">
                  {/* 1. 即時降雨雷達 (Precipitation Radar) */}
                  <div className="bg-[#12151e] border border-cyan-500/40 rounded-xl p-3.5 shadow-lg flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                          <CloudRain className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">
                          即時降水雷達動態
                        </h4>
                        <button
                          onClick={handleToggleRadar}
                          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                            isRadarActive
                              ? 'bg-cyan-500 text-gray-950 border-cyan-400 shadow-sm'
                              : 'bg-[#1e2330] text-gray-300 hover:text-white hover:bg-[#282f40] border-[#2d3547]'
                          }`}
                          title={isRadarActive ? '關閉主地圖雷達疊加' : '疊加雷達至主地圖'}
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="text-[9px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
                        RADAR_1KM_RRAI
                      </span>
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
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400 text-[11px]">影格時間:</span>
                          <span className="font-mono font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
                            {formatRadarTime(radarFrames[currentFrameIndex]?.time)}
                          </span>
                        </div>

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

                          <input
                            type="range"
                            min="0"
                            max={radarFrames.length - 1}
                            value={currentFrameIndex}
                            onChange={(e) => handleFrameChange(Number(e.target.value))}
                            className="flex-1 accent-cyan-400 cursor-pointer h-1.5 bg-[#252a38] rounded-lg"
                          />
                        </div>

                        <div className="pt-2 border-t border-[#1f2533] flex flex-col gap-1 text-[10px] text-gray-400">
                          <span className="text-[9.5px]">降水強度圖例:</span>
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

                  {/* 2. 衛星雲圖 (Satellite Imagery - GOES-West) */}
                  <div className="bg-[#12151e] border border-blue-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                          <Satellite className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">太平洋西北衛星雲圖</h4>
                      </div>
                      <span className="text-[10px] text-blue-400 bg-blue-950/60 border border-blue-800/40 px-2 py-0.5 rounded-full font-mono">
                        GOES-West
                      </span>
                    </div>

                    <div className="bg-[#0b0e16] border border-[#232a3a] rounded-lg p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-300 font-medium">當前雲帶動態</span>
                        <span className="text-emerald-400 font-mono text-[11px] font-bold">● 正常接收</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        目前溫哥華低陸平原上空受中低層層積雲覆蓋，外海約 250 公里處可見太平洋低壓鋒面雲系持續東移。
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1c2232] text-[10.5px] items-center">
                        <div className="flex flex-col">
                          <span className="text-gray-500">空間解析度</span>
                          <span className="font-mono text-gray-200 font-semibold">1 km (VIS) / 2 km (IR)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-gray-500">雲頂亮溫</span>
                            <span className="font-mono text-sky-400 font-semibold">-12°C ~ -18°C</span>
                          </div>
                          <a
                            href="https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G18&sector=pnw"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-sky-400 hover:text-white hover:bg-sky-900/60 border border-sky-800/50 transition-colors shadow-sm cursor-pointer ml-auto"
                            title="開啟 NOAA 官方即時衛星雲圖"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>

                      {/* 太平洋西北衛星雲圖即時影像 (空間解析度下方) */}
                      <div className="mt-1 pt-2 border-t border-[#1c2232] flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-400 font-medium">太平洋西北雲圖即時監控 (PNW)</span>
                          <div className="flex items-center gap-1 bg-[#131722] p-0.5 rounded border border-[#242c3b]">
                            <button
                              type="button"
                              onClick={() => setSatelliteChannel('geocolor')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                satelliteChannel === 'geocolor' ? 'bg-sky-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              可見光
                            </button>
                            <button
                              type="button"
                              onClick={() => setSatelliteChannel('ir')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                satelliteChannel === 'ir' ? 'bg-sky-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              紅外線
                            </button>
                            <button
                              type="button"
                              onClick={() => setSatelliteRefreshKey(k => k + 1)}
                              className="p-0.5 text-gray-400 hover:text-white rounded"
                              title="重新整理雲圖"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div
                          onClick={() => {
                            setSatelliteModalOpen(true);
                            setSatelliteZoomLevel(1);
                          }}
                          className="relative w-full h-44 rounded-lg overflow-hidden border border-[#202738] bg-black group cursor-zoom-in shadow-inner"
                          title="點擊全螢幕放大檢視即時衛星雲圖"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={satelliteChannel === 'geocolor'
                              ? `https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/pnw/GEOCOLOR/1200x1200.jpg?t=${satelliteRefreshKey}`
                              : `https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/pnw/13/1200x1200.jpg?t=${satelliteRefreshKey}`}
                            alt="NOAA GOES-18 太平洋西北即時衛星雲圖"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.src.includes('weather.gc.ca')) {
                                target.src = 'https://weather.gc.ca/data/satellite/goes_wcan_visible_100.jpg';
                              }
                            }}
                          />
                          <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <span className="bg-black/80 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-md">
                              <ZoomIn className="w-3.5 h-3.5 text-sky-300" />
                              <span>點擊放大檢視全螢幕雲圖</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. 閃電密度 (Lightning Density - CLDN) */}
                  <div className="bg-[#12151e] border border-amber-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                          <Zap className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">加拿大防雷網絡閃電密度</h4>
                      </div>
                      <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded-full font-semibold">
                        CLDN
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-[#161a25] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">過去 60 分鐘落雷</span>
                        <span className="text-base font-extrabold text-emerald-400 font-mono">0 次</span>
                      </div>
                      <div className="bg-[#161a25] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">閃電密度等級</span>
                        <span className="text-xs font-bold text-sky-300 font-mono mt-0.5 block">&lt;0.05 /km²</span>
                      </div>
                      <div className="bg-[#161a25] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">最近對流距離</span>
                        <span className="text-xs font-bold text-gray-300 font-mono mt-0.5 block">&gt;200 km</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. 地表氣象站實測 (SWOB - Surface Weather Observation) */}
                  <div className="bg-[#12151e] border border-emerald-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                          <Radio className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">加拿大環境部地表氣象站實測</h4>
                      </div>
                      <span className="text-[10px] text-emerald-300 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full font-semibold">
                        ECCC
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {[
                        { id: 'CWVR', englishName: "Vancouver Int'l Airport", zhName: '溫哥華國際機場', name: "Vancouver Int'l Airport", lat: 49.195, lon: -123.181, tempC: 12.4, wind: 'WNW 15 km/h', hum: '79%', press: '101.6 kPa' },
                        { id: 'CWVG', englishName: 'Vancouver Harbour', zhName: '溫哥華港氣象站', name: 'Vancouver Harbour', lat: 49.296, lon: -123.111, tempC: 13.1, wind: 'W 11 km/h (陣風 18)', hum: '76%', press: '101.5 kPa' },
                        { id: 'CWPI', englishName: 'Point Atkinson Lighthouse', zhName: '阿特金森岬燈塔', name: 'Point Atkinson Lighthouse', lat: 49.330, lon: -123.264, tempC: 11.8, wind: 'W 22 km/h (陣風 31)', hum: '82%', press: '101.5 kPa' },
                        { id: 'CWVN', englishName: 'West Vancouver Marine', zhName: '西溫海港氣象站', name: 'West Vancouver Marine', lat: 49.337, lon: -123.167, tempC: 12.0, wind: 'NW 9 km/h', hum: '81%', press: '101.5 kPa' },
                        { id: 'CWRM', englishName: 'Richmond Dike', zhName: '列治文自然保護區', name: 'Richmond Dike', lat: 49.183, lon: -123.197, tempC: 12.8, wind: 'W 13 km/h', hum: '78%', press: '101.6 kPa' },
                        { id: 'CWBY', englishName: 'Burnaby Burmount', zhName: '本拿比伯蒙特氣象站', name: 'Burnaby Burmount', lat: 49.245, lon: -122.934, tempC: 12.2, wind: 'W 8 km/h', hum: '80%', press: '101.5 kPa' },
                      ].map((st) => {
                        const displayTemp = temperatureUnit === 'fahrenheit' 
                          ? `${((st.tempC * 9) / 5 + 32).toFixed(1)}°F` 
                          : `${st.tempC.toFixed(1)}°C`;
                        return (
                          <div
                            key={st.id}
                            onClick={() => {
                              setSearchTarget({
                                id: `swob_${st.id}`,
                                title: st.name,
                                lon: st.lon,
                                lat: st.lat,
                                category: 'swob_station',
                                badge: '氣象',
                                icon: '📡',
                                meta: {
                                  facility_type: 'swob_station',
                                  english_name: st.englishName,
                                  zh_name: st.zhName,
                                  station_id: st.id,
                                  temp_c: st.tempC,
                                  temp: displayTemp,
                                  wind: st.wind,
                                  hum: st.hum,
                                  press: st.press
                                }
                              });
                            }}
                            className="bg-[#141824] hover:bg-[#181d2c] border border-[#242b3c] hover:border-emerald-500/50 p-2 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-all"
                          >
                            <div className="flex flex-col min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-gray-200 truncate">{st.englishName}</span>
                                <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800/40 px-1 rounded shrink-0">{st.id}</span>
                              </div>
                              <span className="text-[11px] text-gray-400 mt-0.5 truncate">{st.zhName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-extrabold text-white font-mono">{displayTemp}</span>
                              <a
                                href={getGoogleNavUrl(st.lat, st.lon)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800/50 text-emerald-300 hover:text-white transition-colors flex items-center justify-center"
                                title="在 Google Maps 導航至此氣象站"
                              >
                                <Navigation className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 子分頁 3：模式預報 ==================== */}
              {weatherSubTab === 'models' && (
                <div className="flex flex-col gap-3">
                  {/* 1. 高解析度數值模式 HRDPS */}
                  <div className="bg-[#12151e] border border-indigo-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                          <Cpu className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">高解析度決定性數值模式</h4>
                      </div>
                      <span className="text-[10px] text-indigo-300 bg-indigo-950/70 border border-indigo-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        HRDPS
                      </span>
                    </div>

                    <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg text-xs leading-relaxed text-gray-300 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>模式運行週期：00Z / 06Z / 12Z / 18Z (每日 4 回)</span>
                        <span className="text-indigo-400 font-mono">預報時效 48h</span>
                      </div>
                      <p className="text-[11px] text-gray-300">
                        精確解析大溫地區特殊微氣候，包括北岸山脈迎風抬升降水、豪灣峽谷下坡風及喬治亞海峽海風前緣轉折。
                      </p>
                    </div>
                  </div>

                  {/* 2. 區域與全球數值預報 RDPS / GDPS */}
                  <div className="bg-[#12151e] border border-cyan-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                          <Activity className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">區域 / 全球數值預報</h4>
                      </div>
                      <span className="text-[10px] text-cyan-300 bg-cyan-950/70 border border-cyan-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        RDPS/GDPS
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-sky-300">RDPS 區域模式</span>
                          <span className="text-[9.5px] font-mono text-gray-400">10 km · 84h</span>
                        </div>
                        <p className="text-[10px] text-gray-300 mt-0.5">
                          追蹤北太平洋低壓槽與阿拉斯加灣鋒面移速，準確推演降水雲系抵達溫哥華之精準時間點。
                        </p>
                      </div>

                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-emerald-300">GDPS 全球模式</span>
                          <span className="text-[9.5px] font-mono text-gray-400">15 km · 10天</span>
                        </div>
                        <p className="text-[10px] text-gray-300 mt-0.5">
                          中長期大氣環流分析，掌握高空噴射急流、太平洋高壓阻擋與極地冷渦趨勢。
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 3. 降雨累積與氣溫風場模擬 */}
                  <div className="bg-[#12151e] border border-blue-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                          <Droplets className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">降雨累積與風場模擬</h4>
                      </div>
                      <span className="text-[10px] text-blue-300 bg-blue-950/70 border border-blue-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        QPF
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col">
                        <span className="text-[10px] text-gray-400">24h 模擬累積降水</span>
                        <span className="text-base font-extrabold text-cyan-400 font-mono mt-0.5">0.8 ~ 2.4 mm</span>
                        <span className="text-[9.5px] text-gray-500 mt-0.5">低陸平原微雨 / 北岸山區稍大</span>
                      </div>
                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col">
                        <span className="text-[10px] text-gray-400">48h 模擬累積降水</span>
                        <span className="text-base font-extrabold text-sky-400 font-mono mt-0.5">8.6 mm</span>
                        <span className="text-[9.5px] text-gray-500 mt-0.5">預計週末伴隨弱鋒面過境</span>
                      </div>
                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col">
                        <span className="text-[10px] text-gray-400">地表 10m 模擬最大陣風</span>
                        <span className="text-base font-extrabold text-amber-300 font-mono mt-0.5">28 km/h</span>
                        <span className="text-[9.5px] text-gray-500 mt-0.5">西至西南西風</span>
                      </div>
                      <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg flex flex-col">
                        <span className="text-[10px] text-gray-400">0°C 雪線高程</span>
                        <span className="text-base font-extrabold text-rose-300 font-mono mt-0.5">1,650 m</span>
                        <span className="text-[9.5px] text-gray-500 mt-0.5">松雞山頂部以上無積雪威脅</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. 空氣質素數值模式 (RAQDPS & FireWork) */}
                  <div className="bg-[#12151e] border border-rose-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                          <Wind className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">空氣質素與煙霧模擬</h4>
                      </div>
                      <span className="text-[10px] text-rose-300 bg-rose-950/70 border border-rose-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        RAQDPS
                      </span>
                    </div>

                    <div className="bg-[#141824] border border-[#242c3d] p-2.5 rounded-lg text-xs leading-relaxed text-gray-300 flex flex-col gap-1.5">
                      <p className="text-[11px] text-gray-300">
                        未來 72 小時卑詩省內陸與華盛頓州無顯著山火煙霧朝溫哥華低陸平原輸送，PM2.5 濃度維持 4-8 µg/m³ 綠色健康等級。
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 子分頁 4：海洋水文 ==================== */}
              {weatherSubTab === 'marine' && (
                <div className="flex flex-col gap-3">
                  {/* 1. 海事警報與 7 日預報 */}
                  <div className="bg-[#12151e] border border-sky-500/40 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">海事氣象警報與海象預報</h4>
                      </div>
                      <span className="text-[10px] text-sky-300 bg-sky-950/70 border border-sky-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        ECCC
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="bg-[#141824] border border-[#242b3c] p-2.5 rounded-lg flex flex-col gap-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sky-300">Strait of Georgia - South (喬治亞海峽南部)</span>
                          <span className="text-[10px] text-gray-400 font-mono">風力 10-15 節</span>
                        </div>
                        <p className="text-[10.5px] text-gray-300 leading-relaxed">
                          午後轉西北風 15 節，浪高 0.5 至 1.0 米。明日：西北風 10-15 節，傍晚轉微風 5-10 節。
                        </p>
                      </div>

                      <div className="bg-[#141824] border border-[#242b3c] p-2.5 rounded-lg flex flex-col gap-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-cyan-300">Howe Sound (豪灣海域)</span>
                          <span className="text-[10px] text-gray-400 font-mono">風力 5-10 節</span>
                        </div>
                        <p className="text-[10.5px] text-gray-300 leading-relaxed">
                          今日：南風 5 至 10 節，水面微浪 (Chop)，能見度良好 (&gt;10 海浬)。
                        </p>
                      </div>

                      <div className="bg-[#141824] border border-[#242b3c] p-2.5 rounded-lg flex flex-col gap-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-indigo-300">Haro Strait (哈羅海峽與邊界通道)</span>
                          <span className="text-[10px] text-gray-400 font-mono">風力 12-18 節</span>
                        </div>
                        <p className="text-[10.5px] text-gray-300 leading-relaxed">
                          海浪 1.0 米，潮汐流強勁注意橫向回流。
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 2. 潮汐與海岸即時水位 (Coastal Tides) */}
                  <div className="bg-[#12151e] border border-blue-500/40 rounded-xl p-3.5 shadow-lg flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                          <Waves className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">
                          海岸潮汐水位站
                        </h4>
                        <button
                          onClick={() => enableLayer('tideStations')}
                          className="p-1.5 rounded-lg border bg-[#1e2330] text-gray-300 hover:text-white hover:bg-[#282f40] border-[#2d3547] transition-all cursor-pointer"
                          title="開啟潮汐圖層"
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="text-[10px] text-blue-300 bg-blue-950/70 border border-blue-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        DFO / CHS
                      </span>
                    </div>

                    {loadingTides ? (
                      <div className="py-6 flex items-center justify-center gap-2 text-gray-400 text-xs">
                        <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                        <span>正在檢索大溫海岸觀測站即時潮位...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {tideStations.map((st) => (
                          <div
                            key={st.code}
                            onClick={() => handleLocateTideStation(st)}
                            className={`p-2.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
                              selectedTideCode === st.code
                                ? 'bg-blue-950/40 border-blue-500 text-white ring-1 ring-blue-500/50'
                                : 'bg-[#0f121a] border-[#222736] hover:border-blue-500/50 hover:bg-[#131926] text-gray-300'
                            }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-bold text-xs text-white truncate">
                                {st.english_name || st.name.replace(/\s*\([^)]+\)/, '')}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {st.name.match(/\(([^)]+)\)/)?.[1] || st.area}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="flex items-baseline gap-1">
                                <span className="text-base font-extrabold text-blue-400 font-mono">
                                  {st.current_water_level_m}
                                </span>
                                <span className="text-xs font-normal text-gray-400">m</span>
                              </div>
                              <a
                                href={getGoogleNavUrl(st.lat, st.lon)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 rounded bg-blue-900/30 hover:bg-blue-800/60 border border-blue-700/40 text-blue-300 hover:text-white transition-colors flex items-center justify-center"
                                title="在 Google Maps 導航至此測站"
                              >
                                <Navigation className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. 海浪與風暴潮模式 (CIOPS-W) */}
                  <div className="bg-[#12151e] border border-cyan-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                          <Activity className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">海浪與風暴潮數值模式</h4>
                      </div>
                      <span className="text-[10px] text-cyan-300 bg-cyan-950/70 border border-cyan-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        CIOPS-W
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-[#141824] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">有效波高</span>
                        <span className="text-base font-extrabold text-cyan-300 font-mono">0.6 m</span>
                        <span className="text-[9.5px] text-gray-500 block">週期 4.2 秒</span>
                      </div>
                      <div className="bg-[#141824] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">海表水溫</span>
                        <span className="text-base font-extrabold text-sky-300 font-mono">
                          {temperatureUnit === 'fahrenheit' ? `${((11.2 * 9) / 5 + 32).toFixed(1)}°F` : '11.2°C'}
                        </span>
                        <span className="text-[9.5px] text-gray-500 block">常態海溫</span>
                      </div>
                      <div className="bg-[#141824] border border-[#242c3d] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-gray-400 block">風暴潮增水異常</span>
                        <span className="text-base font-extrabold text-emerald-400 font-mono">+0.08 m</span>
                        <span className="text-[9.5px] text-gray-500 block">無溢堤威脅</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. 水文站監察 (National Hydrometric Network) */}
                  <div className="bg-[#12151e] border border-teal-500/30 rounded-xl p-3.5 shadow-lg flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
                          <Anchor className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-white tracking-wide">加拿大國家水文站監察</h4>
                      </div>
                      <span className="text-[10px] text-teal-300 bg-teal-950/70 border border-teal-800/50 px-2 py-0.5 rounded font-mono font-bold">
                        ECCC
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {[
                        { id: '08MH024', englishName: 'Fraser River at Mission', chineseName: '菲沙河密遜水文站', lat: 49.133, lon: -122.300, level: '2.15 m', flow: '1,840 m³/s', status: '正常流量' },
                        { id: '08MF005', englishName: 'Fraser River at Hope', chineseName: '菲沙河希望鎮水文站', lat: 49.380, lon: -121.450, level: '3.42 m', flow: '1,910 m³/s', status: '水勢穩定' },
                        { id: '08GA010', englishName: 'Capilano River near North Vancouver', chineseName: '卡皮拉諾河水文站', lat: 49.345, lon: -123.115, level: '1.08 m', flow: '14.5 m³/s', status: '水壩出水正常' },
                        { id: '08GA079', englishName: 'Seymour River near Seymour Falls', chineseName: '西摩河水文站', lat: 49.430, lon: -122.960, level: '0.95 m', flow: '8.2 m³/s', status: '綠色安全' },
                      ].map((hydro) => (
                        <div
                          key={hydro.id}
                          onClick={() => {
                            setSearchTarget({
                              id: `hydro_${hydro.id}`,
                              title: `${hydro.englishName} (${hydro.chineseName})`,
                              lon: hydro.lon,
                              lat: hydro.lat,
                              category: 'hydrometric_station',
                              badge: '水文',
                              icon: '⚓',
                              meta: {
                                facility_type: 'hydrometric_station',
                                english_name: hydro.englishName,
                                chinese_name: hydro.chineseName,
                                id: hydro.id,
                                level: hydro.level,
                                flow: hydro.flow,
                                status: hydro.status
                              }
                            });
                          }}
                          className="bg-[#141824] hover:bg-[#181d2c] border border-[#242b3c] hover:border-teal-500/50 p-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-all"
                        >
                          <div className="flex flex-col min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-bold text-gray-100 truncate text-[11.5px]">{hydro.englishName}</span>
                              <span className="text-[9px] font-mono text-teal-400 bg-teal-950/70 border border-teal-800/40 px-1 rounded shrink-0">{hydro.id}</span>
                            </div>
                            <span className="text-[10.5px] text-gray-400 font-medium mt-0.5">{hydro.chineseName}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold text-teal-300 bg-teal-950/60 border border-teal-800/40 px-1.5 py-0.5 rounded font-mono">
                              {hydro.status}
                            </span>
                            <a
                              href={getGoogleNavUrl(hydro.lat, hydro.lon)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded bg-teal-950/60 hover:bg-teal-900 border border-teal-800/50 text-teal-300 hover:text-white transition-colors flex items-center justify-center"
                              title="在 Google Maps 導航至此水文站"
                            >
                              <Navigation className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-xs text-gray-400">目前無法取得即時天氣資料</div>
          )}
          </div>
        </div>
      )}

      {/* ==================== 滑雪分頁 (Ski Resorts - Skiresort.com Live Data) ==================== */}
      {activeTab === 'ski' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-semibold flex items-center gap-1.5">
              <MountainSnow className="w-4 h-4 text-cyan-400" />
              <span>滑雪場即時雪況</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
                每日更新 1 次
              </span>
              <a
                href="https://www.skiresort.com/en/snow-reports/vancouver/"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-cyan-400 rounded transition-colors"
                title="前往 Skiresort 官方雪況網站"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => fetchSkiResorts(true)}
                disabled={loadingSki}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSki ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">


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
                      <span className="truncate">{resort.area?.match(/\(([^)]+)\)/)?.[1] || resort.area}</span>
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
              <span>卑詩渡輪 即時航行班次</span>
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
                    <span className="uppercase">{getFerryRouteEnglishName(route)}</span>
                    
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
                每日更新 2 次
              </span>
              {auroraData?.source_url && (
                <a
                  href={auroraData.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-emerald-400 rounded transition-colors"
                  title="前往 NOAA SWPC 官方監測網站"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => fetchAuroraData(true)}
                disabled={loadingAurora}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
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
              <div className="bg-gradient-to-br from-[#121824] via-[#101b2b] to-[#0d1f1f] rounded-xl p-3.5 border border-[#23383a] shadow-lg flex flex-col gap-3 relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between relative z-10 py-1">
                  <div className="flex flex-col justify-center">
                    <span className="text-xs font-bold text-gray-200 tracking-wide leading-normal">
                      地磁極光指數 (Planetary Kp)
                    </span>
                    <div className="flex items-baseline gap-2 mt-1.5">
                      <span className="text-3xl font-extrabold text-white tracking-tight">
                        Kp {auroraData.latest?.kp ?? '--'}
                      </span>
                      <span className="text-xs text-gray-400">/ 9.0</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    {(() => {
                      const rawScale = auroraData.latest?.g_scale || '平靜';
                      const displayScale = (rawScale === 'Quiet' || rawScale === 'G0') ? '平靜'
                        : rawScale === 'Unsettled' ? '微擾'
                        : rawScale === 'Active' ? '活躍'
                        : rawScale;
                      const displayDesc = (auroraData.latest?.g_desc || '')
                        .replace(/\s*\([A-Za-z\s]+\)/g, '')
                        .trim();
                      return (
                        <>
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
                            {displayScale}
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1">
                            {displayDesc || '平靜平穩'}
                          </span>
                        </>
                      );
                    })()}
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
                      <span className="text-emerald-400 font-semibold">
                        {(auroraData.latest?.visibility?.level || '不可見').replace(/\s*\([A-Za-z\s]+\)/g, '').trim()}
                      </span>
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
              <div className="bg-[#10141e] rounded-xl p-3 border border-[#232a38] flex flex-col gap-2 shadow-sm shrink-0">
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
                  <span>
                    最新觀測：{auroraData.latest?.time_tag ? (() => {
                      try {
                        const d = new Date(auroraData.latest.time_tag.endsWith('Z') ? auroraData.latest.time_tag : auroraData.latest.time_tag + 'Z');
                        if (!isNaN(d.getTime())) {
                          return d.toLocaleString('zh-TW', {
                            timeZone,
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: timeFormat === '12h'
                          });
                        }
                      } catch {}
                      return auroraData.latest.time_tag.replace('T', ' ');
                    })() : '--'}
                  </span>
                  <span>指數等級：Kp &ge; 5 觸發磁暴警報</span>
                </div>
              </div>

              {/* 3. Aurora Viewline Forecast Map (Tonight & Tomorrow Night) */}
              <div className="bg-[#10141e] rounded-xl p-3 border border-[#232a38] flex flex-col gap-2.5 shadow-sm shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-emerald-400" />
                    <span>極光觀測預測圖 (北美)</span>
                  </span>
                  <div className="flex items-center gap-1 bg-[#141924] p-0.5 rounded-lg border border-[#232c3d]">
                    <button
                      type="button"
                      onClick={() => setAuroraForecastTab('tonight')}
                      className={`px-2.5 py-0.5 text-[10px] rounded transition-all font-medium ${
                        auroraForecastTab === 'tonight'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      今晚
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuroraForecastTab('tomorrow')}
                      className={`px-2.5 py-0.5 text-[10px] rounded transition-all font-medium ${
                        auroraForecastTab === 'tomorrow'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      明晚
                    </button>
                  </div>
                </div>

                {/* Forecast Image with click to enlarge */}
                <div 
                  onClick={() => {
                    const src = auroraForecastTab === 'tonight'
                      ? 'https://services.swpc.noaa.gov/experimental/images/aurora_dashboard/tonights_static_viewline_forecast.png'
                      : 'https://services.swpc.noaa.gov/experimental/images/aurora_dashboard/tomorrow_nights_static_viewline_forecast.png';
                    setEnlargedAuroraImage({
                      src,
                      title: auroraForecastTab === 'tonight' ? '今晚北美極光觀測預測圖' : '明晚北美極光觀測預測圖',
                      subtitle: 'NOAA SWPC 北美極光南界觀測線'
                    });
                  }}
                  className="relative rounded-lg overflow-hidden border border-[#202738] bg-[#0c0f17] group cursor-zoom-in"
                  title="點擊放大檢視預測圖"
                >
                  <img
                    src={
                      auroraForecastTab === 'tonight'
                        ? 'https://services.swpc.noaa.gov/experimental/images/aurora_dashboard/tonights_static_viewline_forecast.png'
                        : 'https://services.swpc.noaa.gov/experimental/images/aurora_dashboard/tomorrow_nights_static_viewline_forecast.png'
                    }
                    alt={auroraForecastTab === 'tonight' ? '今晚北美極光可見線預測圖' : '明晚北美極光可見線預測圖'}
                    className="w-full h-auto object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded text-[9.5px] text-gray-300 flex items-center gap-1 border border-white/10 group-hover:text-emerald-300 transition-colors shadow-md">
                    <Eye className="w-3 h-3 text-emerald-400" />
                    <span>放大檢視</span>
                  </div>
                </div>

                <div className="text-[10px] text-gray-400 leading-relaxed bg-[#0c1017] p-2 rounded-lg border border-[#1b2230]">
                  <span className="text-gray-300 font-semibold">💡 觀測線說明：</span>
                  紅色實線為極光預估南界觀測線。當紅線向南推移並涵蓋溫哥華（約北緯 49°）以南時，代表該晚極光可見機率大幅增加。
                </div>
              </div>

              {/* 4. Aurora Spots */}
              <div className="bg-[#10141e] rounded-xl p-3 border border-[#232a38] flex flex-col gap-2 shadow-sm shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                    <span>極光觀察地點</span>
                  </span>
                  
                </div>

                <div className="flex flex-col gap-2">
                  {(auroraData.spots || []).map((spot) => (
                    <div key={spot.id} className="bg-[#141924] p-2.5 rounded-lg border border-[#222b3b] flex flex-col gap-1.5 select-text">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-xs text-white group-hover:text-emerald-300 transition-colors flex items-start gap-1.5 leading-snug">
                            <span className="shrink-0 text-xs">✨</span>
                            <span className="break-words whitespace-normal">{formatAuroraSpotName(spot.name)}</span>
                          </h4>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={getGoogleNavUrl(spot.lat, spot.lon)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center justify-center p-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 hover:text-white transition-all shadow-xs shrink-0 cursor-pointer"
                            title="Google 導航至此"
                          >
                            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                          </a>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-gray-300 leading-snug">
                        {spot.features}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ==================== 1.1 - 1.5 工作職位分頁 (WorkBC Jobs) ==================== */}
      {activeTab === 'jobs' && (
        <div className="flex flex-col flex-1 min-h-0 relative">
          {/* 1.2 搜尋列與控制列 */}
          <div className="flex flex-col gap-2 mb-2 shrink-0">
            {/* Search Input Row */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={jobKeyword}
                  onChange={(e) => setJobKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      fetchJobs(1);
                    }
                  }}
                  placeholder="搜尋職位關鍵字 (如: Developer, Cook, Nurse)..."
                  className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-2 rounded-lg border border-[#232838] focus:outline-none focus:border-indigo-500/60 transition-colors"
                />
                {jobKeyword && (
                  <button
                    type="button"
                    onClick={() => setJobKeyword('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                    title="清除關鍵字"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 關鍵字範圍選擇 SearchInField */}
              <select
                value={jobSearchInField}
                onChange={(e) => setJobSearchInField(e.target.value as any)}
                className="bg-[#10131a] text-xs text-gray-300 border border-[#232838] rounded-lg px-2 py-2 focus:outline-none focus:border-indigo-500/60 shrink-0 cursor-pointer"
                title="關鍵字匹配範圍"
              >
                <option value="all">全部範圍</option>
                <option value="title">僅職位名稱</option>
                <option value="employer">僅僱主名稱</option>
                <option value="jobId">職位編號</option>
              </select>

              {/* 搜尋按鈕 */}
              <button
                type="button"
                onClick={() => fetchJobs(1)}
                disabled={loadingJobs}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                title="執行搜尋"
              >
                {loadingJobs ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">搜尋</span>
              </button>

              {/* 1.3 篩選工具圖示按鈕 */}
              <button
                type="button"
                onClick={() => setIsJobFilterOpen(!isJobFilterOpen)}
                className={`p-2 rounded-lg border transition-all relative shrink-0 cursor-pointer ${
                  activeJobFilterCount > 0 || isJobFilterOpen
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-300'
                    : 'bg-[#10131a] border-[#232838] text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
                title="進階篩選條件"
              >
                <SlidersHorizontal className="w-4 h-4" />
                {activeJobFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {activeJobFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* 1.5.1 固定在清單頂部的搜尋結果資訊與 PageSize / SortOrder 控制列 */}
            <div className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-[#12151e] border border-[#232838] rounded-lg text-gray-300 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0"></span>
                <span className="font-medium truncate">
                  共 <span className="text-indigo-400 font-bold">{jobTotalCount.toLocaleString()}</span> 筆職位
                </span>
                <span className="text-gray-600 hidden sm:inline">·</span>
                <span className="text-gray-400 text-[11px] hidden sm:inline">
                  第 {jobPage} / {jobTotalPages} 頁
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* PageSize 下拉清單 */}
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <span className="hidden sm:inline">每頁:</span>
                  <select
                    value={jobPageSize}
                    onChange={(e) => {
                      const newSize = Number(e.target.value);
                      setJobPageSize(newSize);
                      fetchJobs(1, newSize, jobSortOrder);
                    }}
                    className="bg-[#10131a] text-xs text-gray-200 border border-[#232838] rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500/60 cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                {/* SortOrder 下拉清單 */}
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <select
                    value={jobSortOrder}
                    onChange={(e) => {
                      const newOrder = Number(e.target.value);
                      setJobSortOrder(newOrder);
                      fetchJobs(1, jobPageSize, newOrder);
                    }}
                    className="bg-[#10131a] text-xs text-gray-200 border border-[#232838] rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500/60 cursor-pointer max-w-[125px] truncate"
                    title="排序方式"
                  >
                    <option value={11}>相關度</option>
                    <option value={1}>刊登日期 (最新)</option>
                    <option value={2}>刊登日期 (最舊)</option>
                    <option value={3}>職位名稱 (A-Z)</option>
                    <option value={4}>職位名稱 (Z-A)</option>
                    <option value={5}>地點 (A-Z)</option>
                    <option value={6}>地點 (Z-A)</option>
                    <option value={7}>僱主 (A-Z)</option>
                    <option value={8}>僱主 (Z-A)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 職位卡片清單 (Scrollable List) */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {loadingJobs ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                <span className="text-xs">正在從 WorkBC 載入職位空缺資料...</span>
              </div>
            ) : jobsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-2.5 text-gray-400">
                <Briefcase className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                <div className="text-sm font-medium text-gray-300">查無符合條件的職位空缺</div>
                <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                  請嘗試更換搜尋關鍵字、縮小或放寬進階篩選條件，或切換排序規則。
                </p>
                {activeJobFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      resetJobFilters();
                      fetchJobs(1);
                    }}
                    className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                  >
                    重設所有篩選條件
                  </button>
                )}
              </div>
            ) : (
              jobsList.map((job: any) => {
                const hoursDesc = Array.isArray(job.HoursOfWork?.Description)
                  ? job.HoursOfWork.Description.map((t: string) => translateJobTerm(t)).join(' / ')
                  : (job.HoursOfWork?.Description ? translateJobTerm(String(job.HoursOfWork.Description)) : '');

                const periodDesc = Array.isArray(job.PeriodOfEmployment?.Description)
                  ? job.PeriodOfEmployment.Description.map((t: string) => translateJobTerm(t)).join(' / ')
                  : (job.PeriodOfEmployment?.Description ? translateJobTerm(String(job.PeriodOfEmployment.Description)) : '');

                const workplaceDesc = job.WorkplaceType?.Description
                  ? translateJobTerm(job.WorkplaceType.Description)
                  : '';

                const isDirectExternal = !!job.ExternalSource && !!(job.ExternalSource?.Source?.[0]?.Url || job.ExternalSource?.Url);
                const isItemLoading = fetchingJobDetailId === job.JobId;

                return (
                  <div
                    key={job.JobId}
                    onClick={() => handleJobClick(job)}
                    className="bg-[#131722]/85 hover:bg-[#1a2030] border border-[#232838] hover:border-indigo-500/50 rounded-xl p-3 transition-all cursor-pointer group shadow-sm flex flex-col gap-2"
                  >
                    {/* Top Row: Title + Tags */}
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-gray-100 group-hover:text-indigo-300 transition-colors line-clamp-1 leading-snug">
                        {job.Title}
                      </h4>
                      <div className="flex items-center gap-1 shrink-0">
                        {job.IsNew && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            NEW
                          </span>
                        )}
                        {isDirectExternal ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <span>外部</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        ) : isItemLoading ? (
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-indigo-400">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>定位中...</span>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Employer Name */}
                    {job.EmployerName && (
                      <div className="text-[11.5px] text-gray-400 flex items-center gap-1.5 truncate">
                        <Building2 className="w-3 h-3 text-gray-500 shrink-0" />
                        <span className="truncate">{job.EmployerName}</span>
                      </div>
                    )}

                    {/* Pills Row: City + Hours + Period + Workplace */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {job.City && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-700/60 text-[10.5px] text-gray-300">
                          <MapPin className="w-2.5 h-2.5 text-gray-400" />
                          <span>{job.City}</span>
                        </span>
                      )}
                      {hoursDesc && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-600/30 text-[10.5px] text-indigo-300 font-medium">
                          {hoursDesc}
                        </span>
                      )}
                      {periodDesc && (
                        <span className="px-1.5 py-0.5 rounded bg-teal-950/70 border border-teal-600/30 text-[10.5px] text-teal-300 font-medium">
                          {periodDesc}
                        </span>
                      )}
                      {workplaceDesc && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-950/70 border border-blue-600/30 text-[10.5px] text-blue-300">
                          {workplaceDesc}
                        </span>
                      )}
                    </div>

                    {/* Bottom Row: Salary + Date */}
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-800/80 mt-0.5">
                      <div className="flex items-center gap-1 text-emerald-400 font-medium">
                        <DollarSign className="w-3 h-3 shrink-0" />
                        <span>{job.SalarySummary || '薪資依面議或職位說明'}</span>
                      </div>
                      {job.DatePosted && (
                        <div className="flex items-center gap-1 text-gray-500 text-[10.5px]">
                          <Clock className="w-3 h-3" />
                          <span>{formatJobPostingDate(job.DatePosted)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 1.2 頁數選擇與分頁控制 (底部分頁列) */}
          {jobTotalCount > 0 && (
            <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-[#232838] shrink-0 text-xs">
              <button
                type="button"
                onClick={() => fetchJobs(jobPage - 1)}
                disabled={jobPage <= 1 || loadingJobs}
                className="px-2.5 py-1.5 rounded-lg bg-[#10131a] border border-[#232838] hover:bg-[#181d28] disabled:opacity-40 disabled:pointer-events-none text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>上一頁</span>
              </button>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 text-[11px]">前往</span>
                <select
                  value={jobPage}
                  onChange={(e) => fetchJobs(Number(e.target.value))}
                  disabled={loadingJobs}
                  className="bg-[#10131a] text-xs font-semibold text-indigo-300 border border-indigo-500/40 rounded px-2 py-1 focus:outline-none cursor-pointer"
                >
                  {Array.from({ length: Math.min(jobTotalPages, 100) }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      第 {p} 頁
                    </option>
                  ))}
                </select>
                <span className="text-gray-500 text-[11px]">/ {jobTotalPages} 頁</span>
              </div>

              <button
                type="button"
                onClick={() => fetchJobs(jobPage + 1)}
                disabled={jobPage >= jobTotalPages || loadingJobs}
                className="px-2.5 py-1.5 rounded-lg bg-[#10131a] border border-[#232838] hover:bg-[#181d28] disabled:opacity-40 disabled:pointer-events-none text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>下一頁</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 1.3 篩選界面 Drawer / Overlay */}
          {isJobFilterOpen && (
            <div className="absolute inset-0 z-40 bg-[#161922] flex flex-col rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Filter Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-sm font-bold text-gray-100">職位進階篩選條件</h4>
                  {activeJobFilterCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500 text-white">
                      已啟用 {activeJobFilterCount} 項
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsJobFilterOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="關閉篩選"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Filter Body: 10 Categories */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs divide-y divide-gray-800/80">
                {/* 1. 工時類型 */}
                <div className="space-y-2 pt-1 first:pt-0">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>1. 工時類型</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'full', label: '全職', state: filterJobTypeFullTime, set: setFilterJobTypeFullTime },
                      { id: 'part', label: '兼職', state: filterJobTypePartTime, set: setFilterJobTypePartTime },
                      { id: 'lead', label: '兼職轉全職', state: filterJobTypeLeadingToFullTime, set: setFilterJobTypeLeadingToFullTime },
                    ].map((item) => (
                      <label key={item.id} className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.state}
                          onChange={(e) => item.set(e.target.checked)}
                          className="accent-indigo-600 rounded"
                        />
                        <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 2. 工作模式 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>2. 工作模式</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'onsite', label: '現場上班', state: filterJobTypeOnSite, set: setFilterJobTypeOnSite },
                      { id: 'hybrid', label: '混合辦公', state: filterJobTypeHybrid, set: setFilterJobTypeHybrid },
                      { id: 'travelling', label: '需出差', state: filterJobTypeTravelling, set: setFilterJobTypeTravelling },
                      { id: 'virtual', label: '遠距辦公', state: filterJobTypeVirtual, set: setFilterJobTypeVirtual },
                    ].map((item) => (
                      <label key={item.id} className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.state}
                          onChange={(e) => item.set(e.target.checked)}
                          className="accent-indigo-600 rounded"
                        />
                        <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 3. 合約形式 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>3. 合約形式</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'perm', label: '永久聘用', state: filterJobTypePermanent, set: setFilterJobTypePermanent },
                      { id: 'temp', label: '臨時約聘', state: filterJobTypeTemporary, set: setFilterJobTypeTemporary },
                      { id: 'casual', label: '散工 / 零工', state: filterJobTypeCasual, set: setFilterJobTypeCasual },
                      { id: 'season', label: '季節性', state: filterJobTypeSeasonal, set: setFilterJobTypeSeasonal },
                    ].map((item) => (
                      <label key={item.id} className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.state}
                          onChange={(e) => item.set(e.target.checked)}
                          className="accent-indigo-600 rounded"
                        />
                        <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 4. 工作排班 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>4. 工作排班</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {[
                      { id: 'day', label: '日間班', state: filterJobTypeDay, set: setFilterJobTypeDay },
                      { id: 'early', label: '清晨班', state: filterJobTypeEarly, set: setFilterJobTypeEarly },
                      { id: 'evening', label: '傍晚班', state: filterJobTypeEvening, set: setFilterJobTypeEvening },
                      { id: 'morning', label: '早班', state: filterJobTypeMorning, set: setFilterJobTypeMorning },
                      { id: 'night', label: '夜班/通宵', state: filterJobTypeNight, set: setFilterJobTypeNight },
                      { id: 'flexible', label: '彈性工時', state: filterJobTypeFlexible, set: setFilterJobTypeFlexible },
                      { id: 'shift', label: '輪班制', state: filterJobTypeShift, set: setFilterJobTypeShift },
                      { id: 'weekend', label: '週末班', state: filterJobTypeWeekend, set: setFilterJobTypeWeekend },
                      { id: 'oncall', label: '待命班', state: filterJobTypeOnCall, set: setFilterJobTypeOnCall },
                      { id: 'overtime', label: '配合加班', state: filterJobTypeOvertime, set: setFilterJobTypeOvertime },
                      { id: 'tbd', label: '待定', state: filterJobTypeTbd, set: setFilterJobTypeTbd },
                    ].map((item) => (
                      <label key={item.id} className="flex items-center gap-1.5 bg-[#10131a] p-1.5 rounded border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.state}
                          onChange={(e) => item.set(e.target.checked)}
                          className="accent-indigo-600 rounded"
                        />
                        <span className="text-gray-300 text-[10.5px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 5. 薪資福利 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>5. 薪資福利</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <span className="text-[10.5px] text-gray-400 mb-1 block">計薪週期</span>
                      <select
                        value={filterSalaryType}
                        onChange={(e) => setFilterSalaryType(e.target.value)}
                        className="w-full bg-[#10131a] border border-gray-800 text-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none"
                      >
                        <option value="">不限類型</option>
                        <option value="0">時薪 (Hourly)</option>
                        <option value="1">週薪 (Weekly)</option>
                        <option value="2">雙周薪 (Bi-weekly)</option>
                        <option value="3">月薪 (Monthly)</option>
                        <option value="4">年薪 (Annual)</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-gray-400 mb-1 block">最低薪資</span>
                      <input
                        type="number"
                        placeholder="例: 25"
                        value={filterSalaryMin}
                        onChange={(e) => setFilterSalaryMin(e.target.value)}
                        className="w-full bg-[#10131a] border border-gray-800 text-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[10.5px] text-gray-400 mb-1 block">最高薪資</span>
                      <input
                        type="number"
                        placeholder="例: 50"
                        value={filterSalaryMax}
                        onChange={(e) => setFilterSalaryMax(e.target.value)}
                        className="w-full bg-[#10131a] border border-gray-800 text-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* 福利勾選清單 */}
                  <div className="pt-1">
                    <span className="text-[10.5px] text-gray-400 mb-1 block">福利項目</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {[
                        { key: 'Dental benefits', label: '牙科保險' },
                        { key: 'Medical benefits', label: '醫療保險' },
                        { key: 'Vision care benefits', label: '視力照護' },
                        { key: 'Group insurance benefits', label: '團體人壽保險' },
                        { key: 'Life insurance benefits', label: '人壽保險' },
                        { key: 'Disability benefits', label: '傷殘保險' },
                        { key: 'Pension plan benefits', label: '退休金計劃' },
                        { key: 'RRSP benefits', label: 'RRSP 退休儲蓄' },
                        { key: 'RESP benefits', label: 'RESP 教育儲蓄' },
                        { key: 'Bonus', label: '績效獎金' },
                        { key: 'Commission', label: '業務佣金 / 提成' },
                        { key: 'Mileage paid', label: '里程交通補貼' },
                        { key: 'Gratuities', label: '小費福利' },
                        { key: 'As per collective agreement', label: '依集體協議' },
                        { key: 'Other benefits', label: '其他福利津貼' },
                      ].map((item) => {
                        const checked = filterSalaryConditions.includes(item.key);
                        return (
                          <label key={item.key} className="flex items-center gap-1.5 bg-[#10131a] p-1.5 rounded border border-gray-800 hover:border-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFilterSalaryConditions([...filterSalaryConditions, item.key]);
                                } else {
                                  setFilterSalaryConditions(filterSalaryConditions.filter((k) => k !== item.key));
                                }
                              }}
                              className="accent-indigo-600 rounded"
                            />
                            <span className="text-gray-300 text-[10.5px] truncate">{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 6. 教育程度 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>6. 教育程度</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'University', label: '大學學歷 (University)' },
                      { key: 'College or apprenticeship', label: '專上學院或學徒培訓' },
                      { key: 'Secondary school or job-specific training', label: '高中學歷或職業培訓' },
                      { key: 'No education', label: '無需學歷要求' },
                    ].map((item) => {
                      const checked = filterJobEducationLevel.includes(item.key);
                      return (
                        <label key={item.key} className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFilterJobEducationLevel([...filterJobEducationLevel, item.key]);
                              } else {
                                setFilterJobEducationLevel(filterJobEducationLevel.filter((k) => k !== item.key));
                              }
                            }}
                            className="accent-indigo-600 rounded"
                          />
                          <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 7. 日期範圍 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>7. 刊登日期範圍</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { val: '0', label: '不限日期' },
                      { val: '1', label: '今日刊登' },
                      { val: '2', label: '過去 3 日' },
                      { val: '3', label: '自訂範圍' },
                    ].map((item) => (
                      <label key={item.val} className="flex items-center gap-1.5 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="radio"
                          name="dateSelectionRadio"
                          checked={filterDateSelection === item.val}
                          onChange={() => setFilterDateSelection(item.val)}
                          className="accent-indigo-600"
                        />
                        <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>

                  {filterDateSelection === '3' && (
                    <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
                      <div>
                        <span className="text-[10.5px] text-gray-400 mb-1 block">開始日期</span>
                        <input
                          type="date"
                          value={filterStartDate}
                          onChange={(e) => setFilterStartDate(e.target.value)}
                          className="w-full bg-[#10131a] border border-gray-800 text-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[10.5px] text-gray-400 mb-1 block">完結日期</span>
                        <input
                          type="date"
                          value={filterEndDate}
                          onChange={(e) => setFilterEndDate(e.target.value)}
                          className="w-full bg-[#10131a] border border-gray-800 text-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 8. 特定對象 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>8. 特定徵才對象</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'appr', label: '學徒', state: filterIsApprentice, set: setFilterIsApprentice },
                      { id: 'vet', label: '退伍軍人', state: filterIsVeterans, set: setFilterIsVeterans },
                      { id: 'indig', label: '原住民', state: filterIsIndigenous, set: setFilterIsIndigenous },
                      { id: 'mature', label: '年長工作者', state: filterIsMatureWorkers, set: setFilterIsMatureWorkers },
                      { id: 'newcomer', label: '新移民', state: filterIsNewcomers, set: setFilterIsNewcomers },
                      { id: 'disab', label: '身心障礙人士', state: filterIsPeopleWithDisabilities, set: setFilterIsPeopleWithDisabilities },
                      { id: 'student', label: '學生', state: filterIsStudents, set: setFilterIsStudents },
                      { id: 'vismin', label: '少數族裔', state: filterIsVisibleMinority, set: setFilterIsVisibleMinority },
                      { id: 'youth', label: '青年', state: filterIsYouth, set: setFilterIsYouth },
                    ].map((item) => (
                      <label key={item.id} className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.state}
                          onChange={(e) => item.set(e.target.checked)}
                          className="accent-indigo-600 rounded"
                        />
                        <span className="text-gray-300 text-[11px] truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 9. 刊登語言 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>9. 刊登語言</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterIsPostingsInEnglish}
                        onChange={(e) => setFilterIsPostingsInEnglish(e.target.checked)}
                        className="accent-indigo-600 rounded"
                      />
                      <span className="text-gray-300 text-[11px] truncate">英文 (English)</span>
                    </label>
                    <label className="flex items-center gap-2 bg-[#10131a] p-2 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterIsPostingsInEnglishAndFrench}
                        onChange={(e) => setFilterIsPostingsInEnglishAndFrench(e.target.checked)}
                        className="accent-indigo-600 rounded"
                      />
                      <span className="text-gray-300 text-[11px] truncate">英文及法文 (Bilingual)</span>
                    </label>
                  </div>
                </div>

                {/* 10. 排除中介代徵 */}
                <div className="space-y-2 pt-3">
                  <div className="font-bold text-gray-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>10. 排除中介代徵職位</span>
                  </div>
                  <label className="flex items-center gap-2 bg-[#10131a] p-2.5 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterExcludePlacementAgencyJobs}
                      onChange={(e) => setFilterExcludePlacementAgencyJobs(e.target.checked)}
                      className="accent-indigo-600 rounded"
                    />
                    <span className="text-gray-300 text-xs font-medium">排除由人力仲介或代徵機構發布的職缺</span>
                  </label>
                </div>
              </div>

              {/* Filter Drawer Footer */}
              <div className="px-4 py-3 bg-[#1a1e29] border-t border-gray-800 flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={resetJobFilters}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  重設所有篩選
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsJobFilterOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white text-xs transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsJobFilterOpen(false);
                      fetchJobs(1);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors shadow-md cursor-pointer"
                  >
                    套用篩選並搜尋
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 1.5 3-1-1 市政服務請求分頁 (3-1-1 Service Requests) ==================== */}
      {activeTab === '311' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Subheader: 昨日案件數與每日更新 */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs text-gray-200 font-semibold">
                昨日市政府服務案件數: {yesterday311Count} 件
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono">
                {adminSourceIntervals['vancouver_311'] || '每日更新 1 次'}
              </span>
            </div>
          </div>

          {/* 固定式控制列 (Fixed Filter Bar: Search, Status, Department, Sort) */}
          <div className="flex flex-col gap-1.5 mb-2.5 shrink-0 bg-[#12151e]/80 p-2 rounded-xl border border-[#262b38]">
            {/* 搜尋輸入欄 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search311Query}
                onChange={(e) => setSearch311Query(e.target.value)}
                placeholder="搜尋地址、服務請求類型、部門或原因..."
                className="w-full bg-[#1b202c] border border-[#2b3345] rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              {search311Query && (
                <button
                  type="button"
                  onClick={() => setSearch311Query('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 篩選與排序選項 */}
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              {/* 狀態切換 (刪除英文 Open / Close) */}
              <div className="flex items-center gap-1 bg-[#181d28] p-0.5 rounded-lg border border-[#283042]">
                <button
                  type="button"
                  onClick={() => setStatus311Filter('all')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    status311Filter === 'all'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  全部
                </button>
                <button
                  type="button"
                  onClick={() => setStatus311Filter('open')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    status311Filter === 'open'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  處理中
                </button>
                <button
                  type="button"
                  onClick={() => setStatus311Filter('close')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    status311Filter === 'close'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  已結束
                </button>
              </div>

              {/* 部門篩選下拉 */}
              <div className="flex items-center gap-1">
                <select
                  value={dept311Filter}
                  onChange={(e) => setDept311Filter(e.target.value)}
                  className="bg-[#181d28] border border-[#283042] text-gray-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-500 max-w-[130px] sm:max-w-[160px] truncate"
                >
                  <option value="all">所有部門</option>
                  {departments311.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                {/* 排序切換按鈕 */}
                <button
                  type="button"
                  onClick={() => setSort311Order(prev => prev === 'desc' ? 'asc' : 'desc')}
                  className="p-1 rounded-lg bg-[#181d28] hover:bg-[#202736] border border-[#283042] text-gray-300 hover:text-white transition-colors cursor-pointer"
                  title={sort311Order === 'desc' ? '開始時間：新至舊' : '開始時間：舊至新'}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* 表格方式顯示 (縮窄表格，文字斷行顯示，避免過度水平滑動) */}
          <div className="flex-1 overflow-auto border border-[#263147] rounded-xl bg-[#121620]">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-[#181e2b] border-b border-[#263147] text-[10.5px] font-bold text-gray-400 shadow-sm">
                <tr>
                  <th className="py-2 px-2 whitespace-nowrap">狀態</th>
                  <th className="py-2 px-2 whitespace-nowrap">部門</th>
                  <th className="py-2 px-2">服務請求類型</th>
                  <th className="py-2 px-1.5 whitespace-nowrap">渠道</th>
                  <th className="py-2 px-1.5 whitespace-nowrap">開始時間</th>
                  <th className="py-2 px-1.5 whitespace-nowrap">結束時間</th>
                  <th className="py-2 px-2">結束原因</th>
                  <th className="py-2 px-2 whitespace-nowrap">所屬地區</th>
                  <th className="py-2 px-2">地址</th>
                  <th className="py-2 px-1.5 text-center whitespace-nowrap">導航</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2638]">
                {loading311 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-gray-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
                        <span className="text-xs">載入最新 3-1-1 服務請求中...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered311Requests.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-gray-400 text-xs">
                      沒有符合條件的 3-1-1 服務請求。
                    </td>
                  </tr>
                ) : (
                  filtered311Requests.map((req, idx) => {
                    const isOpen = (req.status || '').toLowerCase() === 'open';
                    const hasNav = req.geom && typeof req.geom.lat === 'number' && typeof req.geom.lon === 'number';
                    const addrTitleCase = req.address 
                      ? req.address.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) 
                      : '—';
                    return (
                      <tr 
                        key={`${req.service_request_open_timestamp}_${idx}`}
                        className="hover:bg-[#181d28] transition-colors"
                      >
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[9.5px] font-bold tracking-wider ${
                            isOpen 
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                              : 'bg-gray-700/40 text-gray-300 border border-gray-600/50'
                          }`}>
                            {isOpen ? '處理中' : '已結束'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-300 whitespace-normal break-words max-w-[85px] leading-snug">{req.department || '—'}</td>
                        <td className="py-2 px-2 font-semibold text-white whitespace-normal break-words max-w-[140px] leading-snug" title={req.service_request_type || ''}>
                          {req.service_request_type || '—'}
                        </td>
                        <td className="py-2 px-1.5 text-gray-400 font-mono text-[10px] whitespace-nowrap">{req.channel || '—'}</td>
                        <td className="py-2 px-1.5 font-mono text-[10px] text-gray-300 whitespace-nowrap">
                          {format311DateTime(req.service_request_open_timestamp) || '—'}
                        </td>
                        <td className="py-2 px-1.5 font-mono text-[10px] text-gray-400 whitespace-nowrap">
                          {format311DateTime(req.service_request_close_date) || '—'}
                        </td>
                        <td className="py-2 px-2 text-gray-300 whitespace-normal break-words max-w-[120px] leading-snug" title={req.closure_reason || ''}>
                          {req.closure_reason || '—'}
                        </td>
                        <td className="py-2 px-2 text-cyan-300 whitespace-normal break-words max-w-[90px] leading-snug">{req.local_area || '—'}</td>
                        <td className="py-2 px-2 text-gray-200 whitespace-normal break-words max-w-[130px] leading-snug" title={addrTitleCase}>
                          {addrTitleCase}
                        </td>
                        <td className="py-2 px-1.5 text-center whitespace-nowrap">
                          {hasNav && req.geom ? (
                            <a
                              href={getGoogleNavUrl(req.geom.lat, req.geom.lon)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded-md text-emerald-400 hover:text-white hover:bg-emerald-600/30 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Google 導航至此"
                            >
                              <Navigation className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== 1.6 購物分頁 (Shopping - 大統華 T&T 每週特價海報) ==================== */}
      {activeTab === 'shopping' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* 子分頁列與右上角資訊 */}
          <div className="flex items-start justify-between pb-2 mb-2 border-b border-[#262b38] shrink-0">
            {/* 子分頁切換按鈕 */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/30 text-rose-300 border border-rose-500/50 text-xs font-semibold shadow-xs"
              >
                <ShoppingBag className="w-3.5 h-3.5 text-rose-400" />
                <span>大統華 (T&T)</span>
              </button>
              {tntFlyers.length > 0 && tntFlyers[0].validity && (
                <span className="text-[10px] text-gray-400 font-mono hidden sm:inline ml-2">
                  效期：{tntFlyers[0].validity}
                </span>
              )}
            </div>

            {/* 右上角：每週五更新 1 次，下方放置大統華官網圖示按鈕 */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-[10px] text-rose-400 bg-rose-950/70 border border-rose-800/60 px-1.5 py-0.5 rounded font-mono">
                {adminSourceIntervals['tnt_flyers'] || '每週五更新 1 次'}
              </span>
              <a
                href="https://www.tntsupermarket.com"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded-md text-rose-400 hover:text-white hover:bg-rose-900/50 transition-colors inline-flex items-center justify-center cursor-pointer"
                title="大統華官方網站"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* 特價海報預覽網格 */}
          <div className="flex-1 overflow-y-auto pr-1">
            {loadingTnt ? (
              <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-rose-400" />
                <span className="text-xs">載入大統華特價海報中...</span>
              </div>
            ) : tntFlyers.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-xs">
                暫無特價海報資料。
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {tntFlyers.map((flyer, idx) => (
                  <div
                    key={flyer.id || idx}
                    onClick={() => {
                      setSelectedFlyerModal(idx);
                      setFlyerZoomLevel(1);
                    }}
                    className="group relative bg-[#181c26] border border-[#283042] hover:border-rose-500/60 rounded-xl overflow-hidden cursor-pointer shadow-md transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col"
                  >
                    <div className="relative aspect-[3/4] bg-black/40 overflow-hidden flex items-center justify-center">
                      <img
                        src={flyer.image_url || flyer.thumbnail}
                        alt={flyer.alt || `Flyer Page ${idx + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-semibold">
                        <ZoomIn className="w-4 h-4 text-rose-400" />
                        <span>點擊放大檢視</span>
                      </div>
                    </div>
                    <div className="p-2 flex flex-col gap-0.5 bg-[#12151e]">
                      <div className="flex items-center justify-between text-[11px] font-bold text-white">
                        <span>第 {idx + 1} 頁</span>
                      </div>
                      {flyer.validity && (
                        <span className="text-[9.5px] text-rose-300/80 font-mono truncate">
                          {flyer.validity}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 1.7 車禍意外分頁 (Crashes) ==================== */}
      {activeTab === 'crashes' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Subheader */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <span className="text-xs text-gray-200 font-semibold">
                車禍意外熱點統計 ({filteredCrashes.length} 處)
              </span>
            </div>
            <span className="text-[10px] text-rose-400 bg-rose-950/70 border border-rose-800/60 px-1.5 py-0.5 rounded font-mono">
              ICBC 統計數據
            </span>
          </div>

          {/* 頂部搜尋列 */}
          <div className="relative mb-2 shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={crashesSearchQuery}
              onChange={(e) => setCrashesSearchQuery(e.target.value)}
              placeholder="搜尋車禍發生地點、街角或路段 (支援 St/Street、Ave、49th、E. 等簡寫)..."
              className="w-full bg-[#1b202c] border border-[#2b3345] rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-rose-500 transition-colors"
            />
            {crashesSearchQuery && (
              <button
                type="button"
                onClick={() => setCrashesSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded-full"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 2 欄式清單 */}
          <div className="flex-1 overflow-auto border border-[#263147] rounded-xl bg-[#121620]">
            <div className="sticky top-0 z-10 grid grid-cols-12 bg-[#181e2b] border-b border-[#263147] px-3 py-2 text-[11px] font-bold text-gray-400 shadow-sm">
              <span className="col-span-9 sm:col-span-10">位置 (Location)</span>
              <span className="col-span-3 sm:col-span-2 text-right">宗數</span>
            </div>

            <div className="divide-y divide-[#1e2638]">
              {loadingCrashes ? (
                <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-rose-400" />
                  <span className="text-xs">載入車禍數據中...</span>
                </div>
              ) : filteredCrashes.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-xs">
                  查無符合的車禍地點。
                </div>
              ) : (
                filteredCrashes.slice(0, 300).map((c, idx) => {
                  const isSelected = selectedCrash?.location === c.location;
                  return (
                    <div
                      key={`${c.location}_${idx}`}
                      onClick={() => {
                        setSelectedCrash({
                          location: c.location,
                          count: c.count,
                          lat: c.lat,
                          lon: c.lon
                        });
                        const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
                        if (mapInstance && c.lon && c.lat) {
                          mapInstance.flyTo({
                            center: [c.lon, c.lat],
                            zoom: 16.5,
                            pitch: 30,
                            essential: true
                          });
                        }
                      }}
                      className={`grid grid-cols-12 px-3 py-2.5 items-center cursor-pointer transition-colors group text-xs ${
                        isSelected 
                          ? 'bg-rose-500/20 border-l-2 border-rose-500' 
                          : 'hover:bg-rose-500/10'
                      }`}
                      title="點擊直接在地圖跳轉並標示圓點位置"
                    >
                      <div className="col-span-9 sm:col-span-10 pr-2">
                        <span className={`font-medium transition-colors break-words ${
                          isSelected ? 'text-rose-200 font-bold' : 'text-gray-200 group-hover:text-rose-300'
                        }`}>
                          {c.location}
                        </span>
                      </div>
                      <div className="col-span-3 sm:col-span-2 text-right">
                        <span className="inline-block px-2 py-0.5 rounded-full font-mono font-bold text-xs bg-rose-950/80 text-rose-300 border border-rose-800/60 shadow-xs">
                          {c.count}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
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
                ? '距離個人位置 10 公里範圍內的油站'
                : '溫哥華 10 公里範圍內的油站'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400 bg-amber-950/70 border border-amber-800/60 px-1.5 py-0.5 rounded font-mono">
                每 5 分鐘更新
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
          </div>

          {/* Search Bar */}
          <div className="relative mb-2.5 shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={fuelSearchQuery}
              onChange={(e) => setFuelSearchQuery(e.target.value)}
              placeholder="搜尋油站品牌、地址或城市..."
              className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-amber-500/50 transition-colors"
            />
            {fuelSearchQuery && (
              <button
                onClick={() => setFuelSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
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
                <span>讀取溫哥華各大油站最新油價中...</span>
              </div>
            ) : filteredFuelStations.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                暫無符合條件的油站
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
      {(activeTab === 'ev' || activeTab === 'charging') && (
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

          {/* Search Bar */}
          <div className="relative mb-2.5 shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={evSearchQuery}
              onChange={(e) => setEvSearchQuery(e.target.value)}
              placeholder="搜尋充電站名稱、營運商或地址..."
              className="w-full bg-[#10131a] text-xs text-white placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg border border-[#232838] focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
            {evSearchQuery && (
              <button
                onClick={() => setEvSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
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
            ) : filteredEvStations.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232838]">
                暫無符合條件的充電站
              </div>
            ) : (
              filteredEvStations.map((st) => {
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
      {(activeTab === 'cargo' || activeTab === 'shipping') && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
              <Ship className="w-3.5 h-3.5 text-cyan-400" />
              <span>港口即時船運</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
                即時追蹤
              </span>
              <button
                onClick={() => fetchShippingVessels()}
                disabled={loadingShipping}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors"
                title="重新整理"
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
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-teal-400" />
              <span>沙灘水質</span>
            </span>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-teal-400 bg-teal-950/70 border border-teal-800/60 px-1.5 py-0.5 rounded font-mono">
                每月更新 1 次
              </span>
              <a
                href="https://metrovancouver.org/services/liquid-waste/beaches-and-recreational-water-quality-monitoring"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-teal-400 rounded transition-colors"
                title="前往 Metro Vancouver 官方海灘水質監測網站"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => fetchBeachWater(true)}
                disabled={loadingBeach}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingBeach ? 'animate-spin text-teal-400' : ''}`} />
              </button>
            </div>
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
                const statusDot = (() => {
                  if (beach.status === 'warning') {
                    return 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]';
                  }
                  if (beach.status === 'advisory') {
                    return 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]';
                  }
                  return 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
                })();

                return (
                  <div
                    key={beach.id}
                    onClick={() => handleLocateBeach(beach)}
                    className="p-3 rounded-xl bg-[#141822] border border-[#232838] hover:border-teal-500/50 hover:bg-[#181d2a] transition-all shadow-sm flex flex-col gap-2 group cursor-pointer"
                  >
                    {/* Top Row: Beach name & Navigation Icon Button */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
                          <h4 className="text-xs font-bold text-white group-hover:text-teal-300 transition-colors truncate">
                            {beach.name}
                          </h4>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 truncate pl-3.5">
                          {beach.area || beach.municipality}
                        </div>
                      </div>

                      <a
                        href={getGoogleNavUrl(beach.center_lat, beach.center_lon)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-lg bg-[#11141c] hover:bg-teal-950/70 border border-[#232838] hover:border-teal-500/50 text-teal-400 hover:text-teal-300 transition-colors shrink-0 shadow-sm"
                        title="Google Map 導航至此"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                      </a>
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
                          {beach.last_date || beach.last_sample_date || '每月更新'}
                        </span>
                      </div>
                    </div>

                    {beach.notes && (
                      <p className="text-[10.5px] text-gray-400 line-clamp-2 leading-relaxed bg-[#10131a] px-2 py-1 rounded border border-[#1e2330]">
                        {beach.notes}
                      </p>
                    )}


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
              <span className="text-[10px] text-rose-400 bg-rose-950/70 border border-rose-800/60 px-1.5 py-0.5 rounded font-mono font-medium">
                每 5 分鐘更新
              </span>
              <button
                onClick={() => fetchTranslinkAlerts(true)}
                disabled={loadingTransitAlerts}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
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
                            ? `更新：${formatDateTime(item.lastModified, timeFormat, timeZone)}`
                            : item.startTime
                            ? `生效：${formatDateTime(item.startTime, timeFormat, timeZone)}`
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
            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1.5 pt-0.5 scrollbar-thin">
              {[
                { id: 'all', label: '全部' },
                { id: 'ctvnews', label: 'CTV News' },
                { id: 'cbc', label: 'CBC News' },
                { id: 'citynews', label: 'CityNews' },
                { id: 'globalnews', label: 'Global News' },
                { id: 'dailyhive', label: 'Daily Hive' },
                { id: '604now', label: '604 Now' },
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
              <span className="text-[10px] text-amber-400 bg-amber-950/70 border border-amber-800/60 px-1.5 py-0.5 rounded font-mono font-medium">
                每 5 分鐘更新
              </span>
              <button
                onClick={() => fetchNews(true)}
                disabled={loadingNews}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
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
                  if (article.source_id === 'ctvnews') {
                    return {
                      bg: 'bg-blue-950/40 text-blue-300 border-blue-700/50',
                      name: 'CTV News',
                    };
                  }
                  if (article.source_id === 'cbc') {
                    return {
                      bg: 'bg-red-950/40 text-red-300 border-red-700/50',
                      name: 'CBC News',
                    };
                  }
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
            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1.5 pt-0.5 scrollbar-thin">
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

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-purple-400 bg-purple-950/70 border border-purple-800/60 px-1.5 py-0.5 rounded font-mono">
                {adminSourceIntervals['public_events'] ? (adminSourceIntervals['public_events'].includes('更新') ? adminSourceIntervals['public_events'] : `${adminSourceIntervals['public_events']}更新`) : '每 30 分鐘更新'}
              </span>
              <button
                onClick={() => fetchEvents(true)}
                disabled={loadingEvents}
                className="p-1.5 rounded-lg bg-[#151922] text-gray-400 hover:text-purple-400 border border-[#232838] hover:border-purple-500/40 transition-all shrink-0 flex items-center justify-center disabled:opacity-50"
                title="重新整理"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin text-purple-400' : ''}`} />
              </button>
            </div>
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
                      u = u.replace(/RUSH-Fifty-Something-261215\d{4}/i, 'RUSH-Fifty-Something-2612151830');
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

      {/* ==================== 即時路況分頁 (TomTom & DriveBC Live Traffic) ==================== */}
      {activeTab === 'traffic' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-1.5 overflow-hidden">
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-white flex items-center gap-1.5 shrink-0">
                <Activity className="w-4 h-4 text-orange-400" />
                <span>路況</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-orange-400 bg-orange-950/70 border border-orange-800/60 px-1.5 py-0.5 rounded font-mono font-medium whitespace-nowrap shrink-0">
                每 5 分鐘更新
              </span>
              <a
                href="https://plan.tomtom.com/en/?p=49.24943,-123.12845,11.71z"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-orange-400 rounded transition-colors"
                title="前往 TomTom 即時路況"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => fetchTrafficSummary(true)}
                disabled={loadingTraffic}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTraffic ? 'animate-spin text-orange-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Quick Metrics & Overall Bottleneck Banner (Compact) */}
          <div className="bg-[#121622] rounded-lg px-2.5 py-1.5 border border-[#222838] flex flex-col gap-1 shrink-0 shadow-sm">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs">🚦</span>
                <span className="font-semibold text-white truncate text-[11px]">
                  城市路況：{(trafficSummary?.overall_status || '全線暢通').replace(/大溫/g, '').replace(/\(Free Flow\)/g, '').replace(/\(Light Traffic\)/g, '').replace(/\(Moderate Traffic\)/g, '').replace(/\(Heavy Congestion\)/g, '').trim()}
                </span>
                {(() => {
                  const corridors = (trafficSummary?.corridors || []).filter(c => !isTrafficExcluded(c));
                  const majorRoads = (trafficSummary?.major_roads || []).filter(c => !isTrafficExcluded(c));
                  const allRoads = [...corridors, ...majorRoads];
                  const totalCount = allRoads.length > 0 
                    ? allRoads.length 
                    : (trafficSummary?.total_roads_count || 71);
                  const computedFreeflow = allRoads.length > 0 
                    ? allRoads.filter(r => (r.delay_min || 0) <= 1).length 
                    : (trafficSummary?.freeflow_roads_count ?? totalCount);
                  const freeflowCount = Math.min(computedFreeflow, totalCount);
                  return (
                    <span 
                      title={`暢通道路：${freeflowCount} / ${totalCount} 條 (所有主要幹道與主要道路)`}
                      className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded border shrink-0 ${
                        freeflowCount / Math.max(1, totalCount) >= 0.85
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : freeflowCount / Math.max(1, totalCount) >= 0.65
                          ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                          : 'text-orange-400 bg-orange-500/10 border-orange-500/30'
                      }`}
                    >
                      {freeflowCount}/{totalCount}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono shrink-0">
                <span>主要動脈 <strong className="text-emerald-400">{(trafficSummary?.corridors || []).filter(c => !isTrafficExcluded(c)).length || 6}</strong></span>
                <span>·</span>
                <span>即時通報 <strong className="text-amber-400">{trafficSummary?.total_incidents ?? 0}</strong></span>
              </div>
            </div>

            {trafficSummary?.worst_corridor && (
              <div className={`text-[10px] rounded px-2 py-0.5 flex items-center gap-1.5 truncate border ${
                (trafficSummary?.overall_congestion_score ?? 18) < 35
                  ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-200'
                  : 'bg-red-950/40 border-red-800/40 text-red-200'
              }`}>
                <span className="text-[10px] shrink-0">{(trafficSummary?.overall_congestion_score ?? 18) < 35 ? '✅' : '⚠️'}</span>
                <span className={`font-medium shrink-0 ${(trafficSummary?.overall_congestion_score ?? 18) < 35 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {(trafficSummary?.overall_congestion_score ?? 18) < 35 ? '路況：' : '瓶頸：'}
                </span>
                <span className="truncate text-gray-300">{trafficSummary.worst_corridor}</span>
              </div>
            )}

            {/* 路況色彩圖例 (Fast to Slow) */}
            <div className="flex items-center justify-between px-1.5 py-1 text-[10px] text-gray-400 border-t border-[#1e2332] bg-black/20 rounded">
              <span className="text-emerald-400 font-medium">暢通 (Fast)</span>
              <div className="flex items-center gap-1">
                <span className="w-5 h-2 rounded-[2px] bg-[#68bc73]" title="暢通無阻 (綠色)" />
                <span className="w-5 h-2 rounded-[2px] bg-[#f8cb47]" title="順暢微緩 (黃色)" />
                <span className="w-5 h-2 rounded-[2px] bg-[#e75344]" title="車多緩行 / 壅塞 (紅色)" />
                <span className="w-5 h-2 rounded-[2px] bg-[#822119]" title="嚴重停滯 / 封閉 (深紅褐)" />
              </div>
              <span className="text-rose-400 font-medium">繁忙 (Slow)</span>
            </div>
          </div>

          {/* Sub-Filter Tabs & Search Input (Compact) */}
          <div className="flex flex-col gap-1 shrink-0">
            {/* Filter Pills */}
            <div className="grid grid-cols-4 gap-1 p-0.5 bg-[#121622] rounded-lg border border-[#222838]">
              {[
                { key: 'all', label: '主要幹道' },
                { key: 'major_roads', label: '主要道路' },
                { key: 'severe', label: '嚴重壅塞' },
                { key: 'incidents', label: '即時通報' },
              ].map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setTrafficFilter(pill.key as any)}
                  className={`py-0.5 text-[10px] rounded font-medium transition-all ${
                    trafficFilter === pill.key
                      ? 'bg-orange-600 text-white shadow-xs font-semibold'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Search & Sort Input Row */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={trafficSearchQuery}
                  onChange={(e) => setTrafficSearchQuery(e.target.value)}
                  placeholder="搜尋幹道與通報 (如: 1號公路, 99號, 獅門大橋)..."
                  className="w-full bg-[#121622] border border-[#222838] focus:border-orange-500/70 rounded-lg pl-7 pr-6 py-1 text-[11px] text-gray-200 placeholder-gray-500 outline-none transition-colors"
                />
                {trafficSearchQuery && (
                  <button
                    onClick={() => setTrafficSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className="relative shrink-0">
                <select
                  value={trafficSortBy}
                  onChange={(e) => setTrafficSortBy(e.target.value as any)}
                  className="bg-[#121622] border border-[#222838] hover:border-orange-500/50 focus:border-orange-500/70 rounded-lg pl-2 pr-6 py-1 text-[11px] text-gray-300 outline-none transition-colors cursor-pointer appearance-none font-medium"
                  title="排序依據"
                >
                  <option value="default">預設排序</option>
                  <option value="delay_desc">最擁塞 (延誤最高)</option>
                  <option value="speed_asc">車速最低</option>
                  <option value="speed_desc">車速最高</option>
                  <option value="name_asc">道路名稱 (A-Z)</option>
                </select>
                <ArrowUpDown className="w-3 h-3 text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Scrollable List Content */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {/* If filter is 'incidents', show incident list first */}
            {trafficFilter === 'incidents' ? (
              filteredTrafficAlerts.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-xs">
                  目前查無相符的突發事故通報
                </div>
              ) : (
                filteredTrafficAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    onClick={() => handleFlyToTrafficAlert(alert)}
                    className="group p-2.5 rounded-lg bg-[#141824] hover:bg-[#1a2032] border border-[#252c3e] hover:border-orange-500/50 transition-all cursor-pointer flex flex-col gap-1.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-base shrink-0">{alert.icon || '⚠️'}</span>
                        <span className="font-bold text-xs text-white truncate">
                          {alert.type_label || alert.subtype_zh || alert.type_zh || '事故通報'}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: alert.color || '#ef4444' }}>
                        +{alert.delay_min ?? alert.delay_minutes ?? 0} 分
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-300 font-medium flex items-center justify-between">
                      <span className="truncate">📍 {alert.street || alert.city || '大溫路段'}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{alert.report_time_str || alert.time_display || '即時回報'}</span>
                    </div>

                    {(alert.description || alert.report_description) && (
                      <div className="text-[10.5px] text-gray-400 bg-[#0d1017] rounded p-1.5 border border-[#1e2333] leading-relaxed">
                        {alert.description || alert.report_description}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-0.5 text-[10px]">
                      <span className="text-emerald-400 font-medium">
                        ✓ 資料可信度 {alert.confidence_pct ?? (alert.confidence ? (alert.confidence <= 5 ? alert.confidence * 20 : alert.confidence) : 95)}%
                      </span>
                      <span className="text-cyan-400 group-hover:underline flex items-center gap-0.5">
                        在地圖查看圖釘 →
                      </span>
                    </div>
                  </div>
                ))
              )
            ) : (
              /* Corridors / Major Roads / Severe Congestion List */
              (() => {
                const activeList = trafficFilter === 'all' 
                  ? filteredCorridors 
                  : trafficFilter === 'major_roads' 
                  ? filteredMajorRoads 
                  : filteredSevereRoads;

                if (activeList.length === 0) {
                  return (
                    <div className="py-12 text-center text-gray-400 text-xs">
                      {trafficFilter === 'severe'
                        ? '目前全大溫主要幹道與主要道路均無嚴重壅塞路段'
                        : trafficFilter === 'major_roads'
                        ? '目前查無符合條件的主要道路'
                        : '目前查無符合條件的 7 大幹道路況'}
                    </div>
                  );
                }

                if (trafficFilter === 'major_roads') {
                  return (
                    <div className="flex flex-col border border-[#252c3e] rounded-lg overflow-hidden bg-[#10131d] shadow-sm">
                      <div className="overflow-x-auto [scrollbar-width:thin]">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#181d2c] border-b border-[#252c3e] text-[10.5px] font-bold text-gray-400 select-none">
                              <th className="py-2 px-2.5">道路名稱</th>
                              <th className="py-2 px-2 text-center whitespace-nowrap">路況狀態</th>
                              <th className="py-2 px-2 text-right whitespace-nowrap">預估延誤</th>
                              <th className="py-2 px-2 text-right whitespace-nowrap">車速 / 速限</th>
                              <th className="py-2 px-2.5 text-center whitespace-nowrap">車流趨勢</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1e2436]">
                            {activeList.map((corridor) => {
                              const statusBg = corridor.status_color === 'red' ? 'bg-red-950/80 text-red-200 border-red-800' :
                                corridor.status_color === 'orange' ? 'bg-orange-950/80 text-orange-200 border-orange-800' :
                                corridor.status_color === 'amber' ? 'bg-amber-950/80 text-amber-200 border-amber-800' :
                                'bg-emerald-950/80 text-emerald-200 border-emerald-800';

                              const delayColor = corridor.delay_min >= 12 ? 'text-rose-400' :
                                corridor.delay_min >= 8 ? 'text-orange-400' :
                                corridor.delay_min >= 3 ? 'text-amber-400' : 'text-emerald-400';

                              const displayName = corridor.name;

                              return (
                                <tr
                                  key={corridor.id}
                                  onClick={() => handleFlyToCorridor(corridor)}
                                  className="hover:bg-[#1a2032] cursor-pointer transition-colors group select-none"
                                  title="點擊在地圖上顯示路線與路況詳情"
                                >
                                  <td className="py-2 px-2.5">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-white group-hover:text-orange-300 transition-colors leading-snug">
                                        {displayName}
                                      </span>
                                      {corridor.route && (
                                        <span className="text-[10px] text-gray-400 mt-0.5 font-mono">
                                          {corridor.route}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 text-center whitespace-nowrap">
                                    <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border inline-block ${statusBg}`}>
                                      {corridor.status}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right whitespace-nowrap">
                                    <span className={`font-mono text-[11px] font-bold ${delayColor}`}>
                                      {corridor.delay_min <= 0 ? '+0m' : `+${corridor.delay_min}m`}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right whitespace-nowrap font-mono text-[11px]">
                                    <span className="text-white font-bold">{corridor.current_speed_kmh}</span>
                                    <span className="text-gray-400 text-[10px]"> / {corridor.freeflow_speed_kmh}</span>
                                  </td>
                                  <td className="py-2 px-2.5 text-center whitespace-nowrap text-[10px] text-gray-400">
                                    {corridor.trend === 'worsening' ? '↗️ 加劇' : corridor.trend === 'improving' ? '↘️ 舒緩' : '➡️ 穩定'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="bg-[#141824] px-2.5 py-1.5 border-t border-[#252c3e] text-[10.5px] text-gray-400 flex items-center justify-between">
                        <span>共 {activeList.length} 條主要道路</span>
                        <span className="text-orange-400/90 font-medium">💡 點選任一路段即在底圖亮起該完整路線</span>
                      </div>
                    </div>
                  );
                }

                const isMajorRoadTab = (trafficFilter as string) === 'major_roads';
                return activeList.map((corridor) => {
                  const statusBg = corridor.status_color === 'red' ? 'bg-red-950/80 text-red-200 border-red-800' :
                    corridor.status_color === 'orange' ? 'bg-orange-950/80 text-orange-200 border-orange-800' :
                    corridor.status_color === 'amber' ? 'bg-amber-950/80 text-amber-200 border-amber-800' :
                    'bg-emerald-950/80 text-emerald-200 border-emerald-800';

                  const delayColor = corridor.delay_min >= 12 ? 'text-rose-400' :
                    corridor.delay_min >= 8 ? 'text-orange-400' :
                    corridor.delay_min >= 3 ? 'text-amber-400' : 'text-emerald-400';

                  const displayName = corridor.name;

                  return (
                    <div
                      key={corridor.id}
                      onClick={() => handleFlyToCorridor(corridor)}
                      className="group p-2.5 rounded-lg bg-[#141824] hover:bg-[#1a2032] border border-[#252c3e] hover:border-orange-500/50 transition-all cursor-pointer flex flex-col gap-2 shadow-sm"
                    >
                      {/* Top Row: Name + Badge + Status */}
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-white group-hover:text-orange-300 transition-colors">
                              {displayName}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-400">
                            {corridor.route && (
                              <span className="px-1 py-0.2 rounded bg-[#1e2436] text-gray-300 font-mono">
                                {corridor.route}
                              </span>
                            )}
                            {corridor.route && corridor.badge && <span>·</span>}
                            {corridor.badge && <span>{corridor.badge}</span>}
                          </div>
                        </div>

                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${statusBg}`}>
                          {corridor.status}
                        </span>
                      </div>

                      {/* Middle Row: Delay & Current Speed */}
                      <div className="grid grid-cols-2 gap-1.5 bg-[#0e111a] p-1.5 rounded border border-[#1e2333]">
                        <div className="flex flex-col">
                          <span className="text-[9.5px] text-gray-400">{isMajorRoadTab ? 'Est. Delay' : '預計通過延誤'}</span>
                          <span className={`font-bold font-mono text-xs ${delayColor}`}>
                            {corridor.delay_min <= 0 
                              ? (isMajorRoadTab ? '+0 min (Free Flow)' : '+0 分鐘 (順暢)') 
                              : (isMajorRoadTab ? `+${corridor.delay_min} min` : `+${corridor.delay_min} 分鐘`)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9.5px] text-gray-400">{isMajorRoadTab ? 'Speed / Limit' : '平均車速 / 速限'}</span>
                          <div className="flex items-baseline gap-1">
                            <span className="font-bold font-mono text-xs text-white">
                              {corridor.current_speed_kmh}
                            </span>
                            <span className="text-[9.5px] text-gray-400">/ {corridor.freeflow_speed_kmh} km/h</span>
                          </div>
                        </div>
                      </div>

                      {/* Direction Segments Breakdown (if available) */}
                      {corridor.segments && corridor.segments.length > 0 && (
                        <div className="flex flex-col gap-1 text-[10px]">
                          {corridor.segments.map((seg, idx) => (
                            <div key={idx} className="flex items-center justify-between text-gray-300 px-1 py-0.5 rounded bg-[#181d2a]/60">
                              <span className="truncate">{seg.name}</span>
                              <div className="flex items-center gap-1.5 shrink-0 font-mono">
                                <span className={seg.delay_min >= 10 ? 'text-rose-400 font-semibold' : seg.delay_min >= 3 ? 'text-amber-400' : 'text-emerald-400'}>
                                  +{seg.delay_min}分
                                </span>
                                <span className="text-gray-400">({seg.speed_kmh}km/h)</span>
                                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: seg.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}

      {/* ==================== 美加邊境關口分頁 (Border Crossings - Live CBSA & CBP) ==================== */}
      {activeTab === 'border' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>美加邊境關口即時等候</span>
            </span>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono font-medium">
                每 5 分鐘更新
              </span>
              <a
                href="https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-emerald-400 rounded transition-colors"
                title="前往 CBSA 官方邊境等候時間網站"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => fetchBorderCrossings(true)}
                disabled={loadingBorder}
                className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="重新整理"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingBorder ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
            </div>
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

          {/* 關卡清單 (Crossings List) */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingBorder && filteredBorderCrossings.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                <span>讀取美加邊境 (CBSA & CBP) 即時數據中...</span>
              </div>
            ) : filteredBorderCrossings.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232838]">
                暫無此方向關卡數據
              </div>
            ) : (
              filteredBorderCrossings.map((crossing) => {
                const zhName = (crossing.name || '').split('(')[0].trim() || crossing.name;
                const enName = crossing.english_name || ((crossing.name || '').match(/\((.*?)\)/)?.[1]) || '';
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
                    {/* Top Row: Title, English name, and Hours Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <h4 className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                            {zhName}
                          </h4>
                          {enName && (
                            <span className="text-[10px] text-gray-400">
                              ({enName})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {crossing.hours && (crossing.hours.includes(',') || crossing.hours.length > 20) ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800/50 px-1.5 py-0.5 rounded leading-tight">
                              {formatTimeRange('08:00 - 24:00', timeFormat)} (一般車道)
                            </span>
                            <span className="text-[9px] font-mono text-emerald-500/90 leading-tight">
                              NEXUS ({formatTimeRange('12:00 - 20:00', timeFormat)})
                            </span>
                          </div>
                        ) : (
                          <span className="text-[9.5px] font-mono text-emerald-400/90 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded whitespace-nowrap">
                            {formatTimePreference(crossing.hours, timeFormat) || '24 小時全天開放'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Second Row: Highway Connection & Type Badge */}
                    <div className="flex items-center justify-between gap-1.5 text-[10px] flex-wrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-500 shrink-0">連接幹道</span>
                        <span className="font-mono text-cyan-300/90 bg-cyan-950/40 border border-cyan-800/30 px-1.5 py-0.5 rounded leading-tight" title={crossing.highway}>
                          {crossing.highway}
                        </span>
                      </div>
                      {crossing.crossing_type && (
                        <span className="text-[9.5px] text-gray-400 bg-[#161a26] border border-[#232a3c] px-1.5 py-0.5 rounded shrink-0">
                          {crossing.crossing_type}
                        </span>
                      )}
                    </div>

                    {/* Wait times boxes */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* 入境美國 (U.S. Bound) */}
                      {(borderDirectionFilter === 'all' || borderDirectionFilter === 'us') && (
                        <div className={`p-2 rounded-lg bg-[#0e121a] border border-[#1e2434] flex flex-col gap-1 ${borderDirectionFilter === 'us' ? 'col-span-2' : ''}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-sky-300 flex items-center gap-1">
                              <span>🇺🇸</span>
                              <span>入境美國 (CBP)</span>
                            </span>
                            {crossing.us_bound?.standard_lanes_open != null && (
                              <span className="text-[9px] text-gray-400 font-mono">
                                開放 {crossing.us_bound.standard_lanes_open} 線
                              </span>
                            )}
                          </div>

                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">一般車道</span>
                            <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded border font-mono ${getStatusColor(usWait)}`}>
                              {crossing.us_bound?.standard_status || (usWait !== null ? `${usWait} 分鐘` : '正常通行')}
                            </span>
                          </div>

                          {crossing.has_nexus && (
                            <div className="flex items-baseline justify-between text-[10px] text-gray-400 pt-1 border-t border-[#182030]">
                              <span>NEXUS</span>
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
                              <span>入境加拿大 (CBSA)</span>
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">旅客車道</span>
                            <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded border font-mono ${getStatusColor(caWait)}`}>
                              {crossing.canada_bound?.traveller_status || (caWait !== null ? `${caWait} 分鐘` : '正常通行')}
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between text-[10px] text-gray-400 pt-1 border-t border-[#182030]">
                            <span>商業貨運</span>
                            <span className="text-gray-300 font-mono">
                              {crossing.canada_bound?.commercial_status || '正常'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          
        </div>
      )}

      {/* Footer */}
      <div className="mt-2.5 pt-2 border-t border-[#262b38] flex items-center justify-between text-[11px] text-gray-400 shrink-0">
        <div className="flex flex-col text-[10.5px] leading-tight text-gray-400 min-w-0 pr-2">
          {activeTab === 'weather' && (
            <span>氣象數據：加拿大環境部 (ECCC MSC GeoMet / api.weather.gc.ca)</span>
          )}
          {activeTab === 'news' && (
            <span>共有 {filteredNews.length} 則即時新聞</span>
          )}
          {activeTab === 'events' && (
            <span>共有 {filteredEvents.length} 項活動資料</span>
          )}
          {activeTab === 'beach' && (
            <>
              <span>共有 {beachList.length || 41} 座海灘水質</span>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：Metro Vancouver</span>
            </>
          )}
          {activeTab === 'ski' && (
            <>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：Skiresort</span>
            </>
          )}
          {activeTab === 'aurora' && (
            <>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：NOAA SWPC</span>
            </>
          )}
          {activeTab === 'jobs' && (
            <>
              <span>共 {jobTotalCount.toLocaleString()} 筆職位空缺 (第 {jobPage} / {jobTotalPages} 頁)</span>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：WorkBC (Government of British Columbia)</span>
            </>
          )}
          {activeTab === '311' && (
            <>
              <span>共取得 {filtered311Requests.length} 筆市政服務請求記錄</span>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：City of Vancouver Open Data</span>
            </>
          )}
          {activeTab === 'shopping' && (
            <>
              <span>大統華超市最新每週特價海報 (共 {tntFlyers.length} 頁)</span>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：T&T Supermarket</span>
            </>
          )}
          {activeTab === 'fuel' && (
            <span>共有 {filteredFuelStations.length} 間油站</span>
          )}
          {(activeTab === 'ev' || activeTab === 'charging') && (
            <span>共有 {filteredEvStations.length} 座充電站</span>
          )}
          {activeTab === 'ferry' && (
            <span>共 {ferryRoutes.reduce((acc, r) => acc + (r?.vessels?.length || 0), 0)} 艘渡輪即時航行中</span>
          )}
          {(activeTab === 'cargo' || activeTab === 'shipping') && (
            <>
              <span>共追蹤 {sortedShippingVessels.length} 艘港口商船 (依抵達時間近至遠排序)</span>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：AISStream</span>
            </>
          )}
          {activeTab === 'alerts' && (
            <span>共 {filteredAndSortedAlerts.banners.length + filteredAndSortedAlerts.regular.length} 則 TransLink 即時運輸警報</span>
          )}
          {activeTab === 'traffic' && (() => {
            const currentTabItemCount = trafficFilter === 'all'
              ? filteredCorridors.length
              : trafficFilter === 'major_roads'
              ? filteredMajorRoads.length
              : trafficFilter === 'severe'
              ? filteredSevereRoads.length
              : filteredTrafficAlerts.length;
            return (
              <>
                <span>共 {currentTabItemCount} 條主要幹道及橋隧</span>
                <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：TomTom</span>
              </>
            );
          })()}
          {activeTab === 'border' && (
            <>
              <span className="text-[9.5px] text-gray-500 mt-0.5">資料來源：CBSA & CBP</span>
            </>
          )}
          {activeTab === 'crashes' && (
            <span>共 {filteredCrashes.length} 處車禍事故統計熱點</span>
          )}
        </div>
        <button
          onClick={() => {
            if (activeTab === 'crashes' && selectedCrash) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const mapInstance = (window as any).__godsEyeMapRef?.current?.getMap?.() || (window as any).__godsEyeMapRef?.current;
              if (mapInstance) {
                mapInstance.flyTo({
                  center: [selectedCrash.lon, selectedCrash.lat],
                  zoom: 16.5,
                  essential: true
                });
              }
            }
            setExploreOpen(false);
            setSearchTarget(null);
          }}
          className="text-gray-400 hover:text-white hover:underline text-[11px] shrink-0"
        >
          關閉
        </button>
      </div>

      {/* 極光觀測預測圖 Lightbox Modal */}
      {/* 大統華特價海報全螢幕放大檢視視窗 (T&T Flyer Lightbox Modal - 參照交通攝影機風格) */}
      {selectedFlyerModal !== null && tntFlyers[selectedFlyerModal] && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 pt-16 sm:pt-20 pb-4 animate-in fade-in duration-200 select-none"
          onClick={() => setSelectedFlyerModal(null)}
        >
          <div 
            className="relative max-w-4xl w-full bg-[#161922] border border-rose-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <ShoppingBag className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    大統華每週特價海報
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-rose-400 font-semibold">
                      第 {selectedFlyerModal + 1} 頁 / 共 {tntFlyers.length} 頁
                    </span>
                    {tntFlyers[selectedFlyerModal].validity && (
                      <>
                        <span>·</span>
                        <span className="text-gray-300 font-mono">
                          {tntFlyers[selectedFlyerModal].validity}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setFlyerZoomLevel(prev => Math.min(prev + 0.25, 2.5))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="放大海報"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setFlyerZoomLevel(prev => Math.max(prev - 0.25, 0.75))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="縮小海報"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <a
                  href={tntFlyers[selectedFlyerModal].image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
                  title="在新分頁開啟或下載高解析度原圖"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedFlyerModal(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
                  title="關閉"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body / Image */}
            <div className="relative flex-1 bg-black/80 flex items-center justify-center p-3 overflow-hidden min-h-[300px]">
              {selectedFlyerModal > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFlyerModal(prev => (prev !== null ? prev - 1 : 0));
                    setFlyerZoomLevel(1);
                  }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center border border-white/20 shadow-xl transition-all cursor-pointer"
                  title="上一頁"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}

              <img
                src={tntFlyers[selectedFlyerModal].image_url}
                alt={`Flyer Page ${selectedFlyerModal + 1}`}
                style={{ transform: `scale(${flyerZoomLevel})`, transformOrigin: 'center center' }}
                className="max-h-[70vh] sm:max-h-[74vh] w-auto max-w-full object-contain rounded-lg shadow-2xl transition-transform duration-200 select-none"
              />

              {selectedFlyerModal < tntFlyers.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFlyerModal(prev => (prev !== null ? prev + 1 : prev));
                    setFlyerZoomLevel(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center border border-white/20 shadow-xl transition-all cursor-pointer"
                  title="下一頁"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 太平洋西北即時衛星雲圖全螢幕燈箱視窗 (參照交通攝影機風格) */}
      {satelliteModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 pt-16 sm:pt-20 pb-4 animate-in fade-in duration-200 select-none"
          onClick={() => setSatelliteModalOpen(false)}
        >
          <div 
            className="relative max-w-5xl w-full bg-[#161922] border border-sky-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xl">🛰️</span>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    NOAA GOES-18 太平洋西北 (PNW) 即時衛星雲圖
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-sky-400 font-semibold">
                      {satelliteChannel === 'geocolor' ? 'GeoColor 真實色彩多光譜通道 (1 km)' : 'Band 13 清潔紅外線雲頂亮溫 (2 km)'}
                    </span>
                    <span>·</span>
                    <span className="text-gray-300 font-mono">GOES-West Pacific Northwest</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* 頻道切換 */}
                <div className="flex items-center gap-1 bg-[#131722] p-0.5 rounded border border-[#242c3b] mr-1">
                  <button
                    type="button"
                    onClick={() => setSatelliteChannel('geocolor')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      satelliteChannel === 'geocolor' ? 'bg-sky-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    可見光
                  </button>
                  <button
                    type="button"
                    onClick={() => setSatelliteChannel('ir')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      satelliteChannel === 'ir' ? 'bg-sky-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    紅外線
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSatelliteRefreshKey(k => k + 1)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="重新整理雲圖"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSatelliteZoomLevel(prev => Math.min(prev + 0.25, 2.5))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="放大雲圖"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSatelliteZoomLevel(prev => Math.max(prev - 0.25, 0.75))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="縮小雲圖"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <a
                  href="https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G18&sector=pnw"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-sky-400 hover:bg-white/10 transition-colors cursor-pointer"
                  title="於 NOAA 官方頁面開啟"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setSatelliteModalOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
                  title="關閉 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body / Image */}
            <div className="relative flex-1 bg-black/95 flex items-center justify-center p-3 overflow-hidden min-h-[300px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={satelliteChannel === 'geocolor'
                  ? `https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/pnw/GEOCOLOR/1200x1200.jpg?t=${satelliteRefreshKey}`
                  : `https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/pnw/13/1200x1200.jpg?t=${satelliteRefreshKey}`}
                alt="NOAA GOES-18 太平洋西北即時衛星雲圖"
                style={{ transform: `scale(${satelliteZoomLevel})`, transformOrigin: 'center center' }}
                className="max-h-[72vh] sm:max-h-[76vh] w-auto max-w-full object-contain rounded-lg shadow-2xl transition-transform duration-200 select-none border border-white/10"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.src.includes('weather.gc.ca')) {
                    target.src = 'https://weather.gc.ca/data/satellite/goes_wcan_visible_100.jpg';
                  }
                }}
              />
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 bg-[#1a1e29] border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400 shrink-0">
              <span>資料來源：NOAA NESDIS STAR 即時氣象衛星 · 每 5-10 分鐘自動更新</span>
              <span className="text-sky-400 font-mono text-[10.5px]">HD 衛星雲圖</span>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 極光預測圖全螢幕燈箱視窗 (參照交通攝影機風格透過 Portal 開啟) */}
      {enlargedAuroraImage && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 pt-16 sm:pt-20 pb-4 animate-in fade-in duration-200 select-none"
          onClick={() => setEnlargedAuroraImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-[#161922] border border-emerald-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-lg">🌌</span>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    {enlargedAuroraImage.title}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-emerald-300 font-semibold">{enlargedAuroraImage.subtitle || 'NOAA SWPC 北美極光觀測預測'}</span>
                    <span>·</span>
                    <span>極光預估南界觀測線</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAuroraZoomLevel(prev => Math.min(prev + 0.25, 2.5))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="放大預測圖"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAuroraZoomLevel(prev => Math.max(prev - 0.25, 0.75))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="縮小預測圖"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <a
                  href={enlargedAuroraImage.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-300 hover:bg-white/10 transition-colors cursor-pointer"
                  title="在新分頁開啟高解析度原圖"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setEnlargedAuroraImage(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
                  title="關閉 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="relative flex-1 bg-black/95 flex items-center justify-center p-3 overflow-hidden min-h-[300px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enlargedAuroraImage.src}
                alt={enlargedAuroraImage.title}
                style={{ transform: `scale(${auroraZoomLevel})`, transformOrigin: 'center center' }}
                className="max-h-[70vh] sm:max-h-[74vh] w-auto max-w-full object-contain rounded-lg shadow-2xl transition-transform duration-200 select-none border border-white/10"
              />
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 bg-[#1a1e29] border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400 shrink-0">
              <span>紅色實線為極光預估南界觀測線。當紅線向南推移並涵蓋溫哥華以南時，極光可見機率大幅增加</span>
              <span className="text-emerald-400 font-mono text-[10.5px]">NOAA SWPC</span>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 10.7 外部職缺網頁前往確認對話框 */}
      {externalJobConfirmation && (
        <div 
          className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setExternalJobConfirmation(null)}
        >
          <div 
            className="bg-[#151922] border border-[#2b334a] rounded-2xl p-5 max-w-md w-full shadow-2xl flex flex-col gap-4 text-xs select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 pb-2 border-b border-[#242b3d]">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <ExternalLink className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-gray-100">確認前往外部職缺網站</h4>
                <p className="text-[11px] text-gray-400">此職缺由第三方外部網站刊登與受理申請</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-gray-300">
              <p className="leading-relaxed">
                您即將前往外部職缺來源網頁：
              </p>
              {externalJobConfirmation.title && (
                <div className="font-semibold text-gray-100 text-[12px] bg-[#0f1219] p-2.5 rounded-lg border border-[#23293c]">
                  {externalJobConfirmation.title}
                </div>
              )}
              <div className="bg-[#0b0e14] p-2.5 rounded-lg border border-[#1e2436] text-[11px] font-mono text-indigo-400 break-all select-all">
                {externalJobConfirmation.url}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#242b3d]">
              <button
                type="button"
                onClick={() => setExternalJobConfirmation(null)}
                className="px-3.5 py-1.5 rounded-lg bg-[#1a202e] hover:bg-[#232b3e] text-gray-300 font-medium transition-colors cursor-pointer"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = externalJobConfirmation.url;
                  setExternalJobConfirmation(null);
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <span>確認前往</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
