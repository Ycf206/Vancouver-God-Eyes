'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Server, 
  Cloud, 
  RefreshCw, 
  Sliders, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Play, 
  Shield, 
  Search, 
  Filter, 
  Lock, 
  Unlock, 
  FileText,
  Trash2,
  BarChart3,
  Users,
  MessageSquareWarning,
  Eye, 
  EyeOff,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Zap,
  Key,
  X,
  Check,
  Mail,
  Ban,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Terminal,
  Download,
  History,
  Wrench,
  RotateCcw,
  Copy,
  Layers,
  Palette
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';
import { DEFAULT_ADMIN_SOURCES } from '@/data/defaultAdminSources';
import { useUIStore } from '@/store/useUIStore';

// 11.3 數據源對應前台圖層控制面板之 Key
const SOURCE_TO_LAYER_MAP: Record<string, string> = {
  traffic_conditions: 'traffic',
  bus_realtime: 'bus',
  bus_routes: 'busRoutes',
  skytrain_realtime: 'skytrainTrains',
  skytrain_routes: 'skytrainRoutes',
  seabus_realtime: 'seabusVehicles',
  seabus_routes: 'seabusRoutes',
  bcferries_routes: 'bcferriesRoutes',
  bcferries_vehicles: 'bcferriesVehicles',
  bcferries_terminals: 'bcferriesTerminals',
  parking_meters: 'parkingMeters',
  impark_parking: 'impark',
  accessible_parking: 'accessibleParking',
  motorcycle_parking: 'motorcycleParking',
  ev_charging: 'evCharging',
  escooter: 'escooter',
  escooter_locations: 'escooter',
  shared_bikes: 'sharedBikes',
  bikeways: 'bikeways',
  bike_racks: 'bikeRacks',
  traffic_cameras: 'trafficCameras',
  safety_cameras: 'safetyCameras',
  car_sharing: 'carSharing',
  flight_schedules: 'airports',
  maritime_shipping: 'maritimeShipping',
  marine_terminals: 'marineTerminals',
  fuel_prices: 'fuel',
  tesla_superchargers: 'tesla',
  one_way_streets: 'oneWayStreets',
  traffic_speed_limits: 'trafficSpeedLimits',
  traffic_crosswalks: 'trafficCrosswalks',
  truck_routes: 'truckRoutes',
  traffic_signals: 'trafficSignals',
  turn_restrictions: 'turnRestrictions',
  vancouver_railways: 'railways',
  vancouver_crashes: 'crashes',
  road_closures: 'roadClosures',
  road_construction: 'roadConstruction',
  snow_removal_routes: 'snowRemovalRoutes',
  street_lighting: 'streetLighting',
  street_lighting_conduits: 'streetLightingConduits',
  water_distribution_mains: 'waterDistributionMains',
  sewer_mains: 'sewerMains',
  contours: 'contours',
  fire_halls: 'fireHalls',
  police: 'police',
  fire_hydrants: 'fireHydrants',
  disaster_hubs: 'disasterHubs',
  community_centres: 'communityCentres',
  canada_post: 'canadaPost',
  fedex: 'fedex',
  purolator: 'purolator',
  banks: 'banks',
  hospitals: 'hospitals',
  parks: 'parks',
  parks_facilities: 'parksFacilities',
  community_gardens: 'communityGardens',
  drinking_fountains: 'drinkingFountains',
  public_washrooms: 'publicWashrooms',
  schools: 'schools',
  libraries: 'libraries',
  food_vendors: 'foodVendors',
  food_banks: 'foodBanks',
  garbage_collection: 'garbageCollection',
  recycling: 'recycling',
  aed: 'aed',
  aed_locations: 'aed',
  homeless_shelters: 'homelessShelters',
  public_art: 'publicArt',
  litter_containers: 'litterContainers',
  van_wifi: 'vanWifi',
  tides_hydrometric: 'tideStations',
  tide_stations: 'tideStations',
  beach_water: 'beachWaterQuality',
  beach_water_quality: 'beachWaterQuality',
  zoning_districts: 'zoningDistricts',
  public_trees: 'publicTrees',
  museums: 'museums',
};

// 圖層控制管理清單 (支援開關、面板顯示與主題色彩微調)
const LAYER_CONTROLS_LIST = [
  // 交通
  { id: 'bus', name: '巴士車輛', category: '交通', defaultColor: '#10b981' },
  { id: 'busRoutes', name: '巴士路線', category: '交通', defaultColor: '#10b981' },
  { id: 'busExchanges', name: '巴士轉車站', category: '交通', defaultColor: '#10b981' },
  { id: 'skytrainTrains', name: '天車列車 (推算)', category: '交通', defaultColor: '#3b82f6' },
  { id: 'skytrainRoutes', name: '天車路線與車站', category: '交通', defaultColor: '#3b82f6' },
  { id: 'skytrainFareZones', name: '天車收費分區', category: '交通', defaultColor: '#3b82f6' },
  { id: 'seabusVehicles', name: '水上巴士船隻', category: '交通', defaultColor: '#00a4e4' },
  { id: 'seabusRoutes', name: '水上巴士航線', category: '交通', defaultColor: '#00a4e4' },
  { id: 'bcferriesVehicles', name: '卑詩渡輪船隻', category: '交通', defaultColor: '#0060a9' },
  { id: 'bcferriesRoutes', name: '卑詩渡輪航線', category: '交通', defaultColor: '#0060a9' },
  { id: 'maritimeShipping', name: '船運船隻', category: '交通', defaultColor: '#06b6d4' },
  { id: 'marineTerminals', name: '船運碼頭', category: '交通', defaultColor: '#06b6d4' },
  { id: 'airports', name: '機場', category: '交通', defaultColor: '#38bdf8' },
  // 道路
  { id: 'trafficConditions', name: '路況色帶', category: '道路', defaultColor: '#f97316' },
  { id: 'trafficAlerts', name: '即時路況通報', category: '道路', defaultColor: '#ef4444' },
  { id: 'trafficCameras', name: '交通攝影機', category: '道路', defaultColor: '#38bdf8' },
  { id: 'safetyCameras', name: '安全攝影機', category: '道路', defaultColor: '#f43f5e' },
  { id: 'parkingMeters', name: '咪錶停車位', category: '道路', defaultColor: '#3b82f6' },
  { id: 'motorcycleParking', name: '電單車位', category: '道路', defaultColor: '#3b82f6' },
  { id: 'accessibleParking', name: '無障礙車位', category: '道路', defaultColor: '#38bdf8' },
  { id: 'evCharging', name: '充電站', category: '道路', defaultColor: '#10b981' },
  { id: 'fuel', name: '加油站', category: '道路', defaultColor: '#f59e0b' },
  { id: 'bikeways', name: '單車專用徑', category: '道路', defaultColor: '#14b8a6' },
  { id: 'sharedBikes', name: '共享單車 (Mobi)', category: '道路', defaultColor: '#14b8a6' },
  { id: 'escooter', name: '共享滑板車', category: '道路', defaultColor: '#84cc16' },
  { id: 'snowRemovalRoutes', name: '除雪主要幹道', category: '道路', defaultColor: '#06b6d4' },
  { id: 'oneWayStreets', name: '單行道導向', category: '道路', defaultColor: '#8b5cf6' },
  { id: 'speedLimits', name: '限速路段', category: '道路', defaultColor: '#f59e0b' },
  { id: 'crosswalks', name: '行人穿越道', category: '道路', defaultColor: '#ec4899' },
  // 民生
  { id: 'schools', name: '學校教育機構', category: '民生', defaultColor: '#3b82f6' },
  { id: 'libraries', name: '公共圖書館', category: '民生', defaultColor: '#f59e0b' },
  { id: 'communityCentres', name: '社區中心', category: '民生', defaultColor: '#8b5cf6' },
  { id: 'parks', name: '都會公園', category: '民生', defaultColor: '#10b981' },
  { id: 'drinkingFountains', name: '公共飲水台', category: '民生', defaultColor: '#38bdf8' },
  { id: 'publicWashrooms', name: '公共洗手間', category: '民生', defaultColor: '#06b6d4' },
  { id: 'foodVendors', name: '餐車與熟食市集', category: '民生', defaultColor: '#f97316' },
  { id: 'foodBanks', name: '食物銀行據點', category: '民生', defaultColor: '#10b981' },
  { id: 'homelessShelters', name: '庇護收容所', category: '民生', defaultColor: '#ec4899' },
  { id: 'banks', name: '銀行與 ATM', category: '民生', defaultColor: '#3b82f6' },
  { id: 'canadaPost', name: '加拿大郵政據點', category: '民生', defaultColor: '#ef4444' },
  { id: 'fedex', name: 'FedEx 據點', category: '民生', defaultColor: '#8b5cf6' },
  { id: 'purolator', name: 'Purolator 據點', category: '民生', defaultColor: '#3b82f6' },
  { id: 'publicArt', name: '公共街頭藝術', category: '民生', defaultColor: '#a855f7' },
  { id: 'museums', name: '博物館與展覽館', category: '民生', defaultColor: '#6366f1' },
  { id: 'garbageCollection', name: '垃圾清運排程', category: '民生', defaultColor: '#10b981' },
  { id: 'recycling', name: '資源回收站', category: '民生', defaultColor: '#14b8a6' },
  // 安全
  { id: 'hospitals', name: '醫院與緊急醫療', category: '安全', defaultColor: '#10b981' },
  { id: 'police', name: '警察局', category: '安全', defaultColor: '#3b82f6' },
  { id: 'fireHalls', name: '消防局', category: '安全', defaultColor: '#ef4444' },
  { id: 'fireHydrants', name: '市政消防栓', category: '安全', defaultColor: '#ef4444' },
  { id: 'disasterHubs', name: '災害支援中心', category: '安全', defaultColor: '#f59e0b' },
  { id: 'aed', name: 'AED 急救心臟去顫器', category: '安全', defaultColor: '#ef4444' },
  // 環境與地理
  { id: 'beachWaterQuality', name: '海灘水質', category: '環境', defaultColor: '#06b6d4' },
  { id: 'contours', name: '等高線高程', category: '地理', defaultColor: '#14b8a6' },
  { id: 'tideStations', name: '潮汐監測站', category: '地理', defaultColor: '#0ea5e9' },
  { id: 'waterDistributionMains', name: '自來水管道', category: '公共事業', defaultColor: '#38bdf8' },
  { id: 'sewerMains', name: '污水管道', category: '公共事業', defaultColor: '#14b8a6' },
  { id: 'streetLighting', name: '路燈燈柱', category: '公共事業', defaultColor: '#f59e0b' },
  { id: 'streetLightingConduits', name: '路燈電網管道', category: '公共事業', defaultColor: '#fbbf24' },
];

// 系統 4 大標準分頁與按鈕類別 (對應主導航與探索面板)
const SYSTEM_CATEGORIES = ['道路', '天氣', '生活', '公共事業'] as const;

function getSystemCategory(source: { id: string; category?: string; name?: string }): '道路' | '天氣' | '生活' | '公共事業' {
  const roadIds = new Set([
    'traffic_conditions', 'traffic_cameras', 'translink_realtime', 'snow_removal_routes',
    'fuel_prices', 'border_wait_times', 'flight_schedules', 'maritime_shipping',
    'parking_meters', 'impark_parking', 'motorcycle_parking', 'bikeways',
    'ev_charging', 'traffic_speed_limits', 'traffic_crosswalks', 'one_way_streets',
    'shared_bikes', 'escooter', 'truck_routes', 'traffic_signals',
    'turn_restrictions', 'vancouver_railways', 'vancouver_crashes'
  ]);
  const weatherIds = new Set([
    'weather_monitoring', 'tides_hydrometric', 'beach_water', 'aurora_forecast', 'ski_resorts'
  ]);
  const utilitiesIds = new Set([
    'water_distribution_mains', 'sewer_mains', 'street_lighting_conduits', 'street_lighting',
    'fire_hydrants', 'aed', 'zoning_districts', 'contours'
  ]);

  if (roadIds.has(source.id)) return '道路';
  if (weatherIds.has(source.id)) return '天氣';
  if (utilitiesIds.has(source.id)) return '公共事業';
  return '生活';
}


// 排程標準週期預設 (Presets)
const SCHEDULE_PRESETS: { label: string; cron: string; interval: string }[] = [
  { label: '30 s', cron: '*/30 * * * * *', interval: '每 30 秒' },
  { label: '1 min', cron: '* * * * *', interval: '每 1 分鐘' },
  { label: '5 mins', cron: '*/5 * * * *', interval: '每 5 分鐘' },
  { label: '10 mins', cron: '*/10 * * * *', interval: '每 10 分鐘' },
  { label: '30 mins', cron: '*/30 * * * *', interval: '每 30 分鐘' },
  { label: '1 hr', cron: '0 * * * *', interval: '每 1 小時' },
  { label: '2 hrs', cron: '0 */2 * * *', interval: '每 2 小時' },
  { label: '6 hrs', cron: '0 */6 * * *', interval: '每 6 小時' },
  { label: '12 hrs', cron: '0 */12 * * *', interval: '每 12 小時' },
  { label: '1 day', cron: '0 0 * * *', interval: '每日' },
  { label: '1 week', cron: '0 0 * * 0', interval: '每週' },
  { label: '1 month', cron: '0 0 1 * *', interval: '每月' },
  { label: '3 months', cron: '0 0 1 */3 *', interval: '每季 (3 個月)' },
  { label: '6 months', cron: '0 0 1 */6 *', interval: '每半年' },
  { label: '1 year', cron: '0 0 1 1 *', interval: '每年' },
];

function cronToChineseInterval(cronStr: string): string {
  const c = (cronStr || '').trim();
  if (!c) return '';

  const direct = SCHEDULE_PRESETS.find(p => p.cron === c);
  if (direct) return direct.interval;

  const parts = c.split(/\s+/);

  // 6 欄位表達式 (含秒數): */N * * * * *
  if (parts.length === 6) {
    const secMatch = parts[0].match(/^\*\/(\d+)$/);
    if (secMatch && parts.slice(1).every(p => p === '*')) {
      return `每 ${secMatch[1]} 秒`;
    }
  }

  // 5 欄位標準表達式: 分 時 日 月 星期
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;

    // 每 N 分鐘
    const minStep = min.match(/^\*\/(\d+)$/);
    if (minStep && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return `每 ${minStep[1]} 分鐘`;
    }

    // 每 N 小時
    const hourStep = hour.match(/^\*\/(\d+)$/);
    if ((min === '0' || min === '*') && hourStep && dom === '*' && mon === '*' && dow === '*') {
      return `每 ${hourStep[1]} 小時`;
    }

    const pad = (n: string | number) => String(n).padStart(2, '0');
    const isNum = (s: string) => /^\d+$/.test(s);

    // 每日固定時間
    if (isNum(min) && isNum(hour) && dom === '*' && mon === '*' && dow === '*') {
      if (min === '0' && hour === '0') return '每日';
      return `每日 ${pad(hour)}:${pad(min)}`;
    }

    // 每週固定星期與時間
    if (isNum(min) && isNum(hour) && dom === '*' && mon === '*' && isNum(dow)) {
      const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
      const dayName = days[parseInt(dow, 10)] || `週${dow}`;
      return `每${dayName} ${pad(hour)}:${pad(min)}`;
    }

    // 每月固定日期與時間
    if (isNum(min) && isNum(hour) && isNum(dom) && mon === '*' && dow === '*') {
      if (min === '0' && hour === '0' && dom === '1') return '每月';
      return `每月${dom}號 ${pad(hour)}:${pad(min)}`;
    }

    // 每 N 個月
    const monStep = mon.match(/^\*\/(\d+)$/);
    if (isNum(min) && isNum(hour) && isNum(dom) && monStep && dow === '*') {
      const step = parseInt(monStep[1], 10);
      if (step === 3) return '每季 (3 個月)';
      if (step === 6) return '每半年';
      return `每 ${step} 個月`;
    }

    // 每年固定月份與時間
    if (isNum(min) && isNum(hour) && isNum(dom) && isNum(mon) && dow === '*') {
      if (min === '0' && hour === '0' && dom === '1' && mon === '1') return '每年';
      return `每年${mon}月${dom}日 ${pad(hour)}:${pad(min)}`;
    }
  }

  return '';
}

function formatScheduleInterval(interval?: string, cron?: string): string {
  if (cron) {
    const fromCron = cronToChineseInterval(cron);
    if (fromCron) return fromCron;
  }
  if (!interval) return '未設定';
  const norm = interval.toLowerCase().trim();
  if (norm === '6 months' || norm === '6months' || norm.includes('6 month')) return '每半年';
  if (norm === '3 months' || norm === '3months' || norm.includes('3 month')) return '每季 (3 個月)';
  if (norm === '1 year' || norm === '1year' || norm.includes('1 year')) return '每年';
  if (norm === '1 month' || norm === '1month' || norm.includes('1 month')) return '每月';
  if (norm === '1 week' || norm === '1week' || norm.includes('1 week')) return '每週';
  if (norm === '1 day' || norm === '1day' || norm.includes('1 day')) return '每日';
  if (norm === '12 hrs' || norm === '12hrs' || norm.includes('12 hr')) return '每 12 小時';
  if (norm === '6 hrs' || norm === '6hrs' || norm.includes('6 hr')) return '每 6 小時';
  if (norm === '2 hrs' || norm === '2hrs' || norm.includes('2 hr')) return '每 2 小時';
  if (norm === '1 hr' || norm === '1hr' || norm.includes('1 hr')) return '每 1 小時';
  if (norm === '30 mins' || norm === '30mins' || norm.includes('30 min')) return '每 30 分鐘';
  if (norm === '10 mins' || norm === '10mins' || norm.includes('10 min')) return '每 10 分鐘';
  if (norm === '5 mins' || norm === '5mins' || norm.includes('5 min')) return '每 5 分鐘';
  if (norm === '1 min' || norm === '1min' || norm.includes('1 min')) return '每 1 分鐘';
  if (norm === '30 s' || norm === '30s' || norm.includes('30 s')) return '每 30 秒';
  return interval;
}

function parseSourcePreset(cron: string, interval: string): string {
  const norm = (interval || '').toLowerCase().trim();
  const direct = SCHEDULE_PRESETS.find(p => p.cron === cron || p.label.toLowerCase() === norm || p.interval.toLowerCase() === norm);
  if (direct) return direct.label;

  if (norm.includes('30 秒') || norm.includes('30s')) return '30 s';
  if (norm.includes('1 分鐘') || norm.includes('1m') || norm.includes('1 min')) return '1 min';
  if (norm.includes('5 分鐘') || norm.includes('5m') || norm.includes('5 min')) return '5 mins';
  if (norm.includes('10 分鐘') || norm.includes('10m') || norm.includes('10 min')) return '10 mins';
  if (norm.includes('30 分鐘') || norm.includes('30m') || norm.includes('30 min')) return '30 mins';
  if (norm.includes('1 小時') || norm === '每小時' || norm.includes('1h') || norm.includes('1 hr')) return '1 hr';
  if (norm.includes('2 小時') || norm.includes('2h') || norm.includes('2 hr')) return '2 hrs';
  if (norm.includes('6 小時') || norm.includes('6h') || norm.includes('6 hr')) return '6 hrs';
  if (norm.includes('12 小時') || norm.includes('12h') || norm.includes('12 hr')) return '12 hrs';
  if (norm.includes('1 天') || norm.includes('每日') || norm.includes('每天') || norm.includes('1d') || norm.includes('1 day')) return '1 day';
  if (norm.includes('1 週') || norm.includes('每週') || norm.includes('1w') || norm.includes('1 week')) return '1 week';
  if (norm.includes('1 個月') || norm.includes('每月') || norm.includes('1 month')) return '1 month';
  if (norm.includes('3 個月') || norm.includes('每季') || norm.includes('3 month')) return '3 months';
  if (norm.includes('6 個月') || norm.includes('每半年') || norm.includes('6 month')) return '6 months';
  if (norm.includes('1 年') || norm.includes('每年') || norm.includes('1 year')) return '1 year';

  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length === 5) {
    const [, , dom, mon, dow] = parts;
    if (dow !== '*' && dom === '*' && mon === '*') return 'custom_weekly';
    if (dom !== '*' && mon === '*' && dow === '*') return 'custom_monthly';
    if (dom !== '*' && mon !== '*' && dow === '*') return 'custom_yearly';
  }
  return 'custom';
}

interface DataSource {
  id: string;
  name: string;
  type: string;
  runner: 'github_actions' | 'oci';
  workflow_file?: string | null;
  category: string;
  cron_expr: string;
  schedule_interval: string;
  record_count: number;
  unit: string;
  last_updated: string;
  status: string;
  enabled?: boolean;
  data_pipeline_notes?: string;
  source_links?: { label: string; url: string }[];
  source_url?: string;
  url?: string;
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  source_name: string;
  runner?: string;
  status: string;
  detail: string;
}

export default function AdminPage() {
  const [sources, setSources] = useState<DataSource[]>(DEFAULT_ADMIN_SOURCES as DataSource[]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [mainTab, setMainTab] = useState<'sources' | 'layers' | 'system_logs' | 'analytics' | 'issues' | 'maintenance'>('sources');

  // 圖層控制管理狀態 (Zustand store 整合)
  const layers = useUIStore((state) => state.layers);
  const toggleLayer = useUIStore((state) => state.toggleLayer);
  const hiddenLayersInPanel = useUIStore((state) => state.hiddenLayersInPanel);
  const toggleLayerPanelHidden = useUIStore((state) => state.toggleLayerPanelHidden);
  const disabledLayers = useUIStore((state) => state.disabledLayers);
  const setDisabledLayers = useUIStore((state) => state.setDisabledLayers);
  const layerCustomColors = useUIStore((state) => state.layerCustomColors);
  const setLayerCustomColor = useUIStore((state) => state.setLayerCustomColor);
  const resetLayerCustomColors = useUIStore((state) => state.resetLayerCustomColors);
  const [layerSearchQuery, setLayerSearchQuery] = useState('');
  const [layerCategoryFilter, setLayerCategoryFilter] = useState('all');

  // 資料源來源連結 (URL) 線上編輯狀態
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [editingUrlVal, setEditingUrlVal] = useState<string>('');
  const [isSavingUrl, setIsSavingUrl] = useState<boolean>(false);
  const [savedUrlSuccessId, setSavedUrlSuccessId] = useState<string | null>(null);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('系統正在進行例行升級與維護，請稍後再試。');
  const [maintenanceUpdatedAt, setMaintenanceUpdatedAt] = useState<string | null>(null);
  const [isUpdatingMaintenance, setIsUpdatingMaintenance] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState('PREV');
  const [isTriggeringRollback, setIsTriggeringRollback] = useState(false);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [recentCommits, setRecentCommits] = useState<Array<{ sha: string; full_sha?: string; title: string; message?: string; date?: string; author?: string }>>([
    { sha: 'PREV', full_sha: 'HEAD~1', title: 'PREV (上一個運作正常的版本 - HEAD~1)', message: '上一筆穩定運作的部署版本', date: '推薦選項', author: '系統預設' },
    { sha: 'HEAD~2', full_sha: 'HEAD~2', title: 'HEAD~2 (前兩個版本)', message: '倒退兩次提交前之狀態', date: '歷史回溯', author: 'Git HEAD~2' }
  ]);
  const [issueSearch, setIssueSearch] = useState('');
  const [issueStatusFilter, setIssueStatusFilter] = useState<'all' | 'pending' | 'resolved' | 'closed'>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'github_actions' | 'oci'>('all');

  // 11.1 清單多欄位排序狀態
  const [sortField, setSortField] = useState<'status' | 'category' | 'name' | 'runner' | 'schedule_interval' | 'record_count' | 'last_updated'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 11.3 獨立圖層開關狀態
  const [hiddenLayersInPanelState, setHiddenLayersInPanelState] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('vancouver_hidden_layers_in_panel');
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    return {};
  });

  // 11.4 系統日誌狀態
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [loadingSystemLogs, setLoadingSystemLogs] = useState(false);
  const [systemRetentionDays, setSystemRetentionDays] = useState<number>(30);
  const [systemRetentionInput, setSystemRetentionInput] = useState<string>('30');
  const [systemLogLevelFilter, setSystemLogLevelFilter] = useState<string>('all');
  const [systemLogSearch, setSystemLogSearch] = useState<string>('');
  const [systemLogPage, setSystemLogPage] = useState<number>(1);
  const SYSTEM_LOG_PAGE_SIZE = 25;
  const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);

  // 11.5 排程歷史保留期限
  const [scheduleRetentionDays, setScheduleRetentionDays] = useState<number>(30);
  const [scheduleRetentionInput, setScheduleRetentionInput] = useState<string>('30');
  
  // --- Analytics & Stats states (正式開始執行後台統計資料) ---
  const [stats, setStats] = useState<{
    today_page_views: number;
    total_page_views: number;
    online_users: number;
    issue_reports_count: number;
    status_note?: string;
    daily_pv?: Record<string, number>;
  }>({
    today_page_views: 0,
    total_page_views: 0,
    online_users: 0,
    issue_reports_count: 0,
    status_note: '實時統計運作中',
    daily_pv: {}
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [issueReports, setIssueReports] = useState<any[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingResetStats, setLoadingResetStats] = useState(false);

  const handleResetStats = async () => {
    if (!window.confirm('確定要重設全站造訪次數紀錄嗎？此操作將清空本日與歷史累計瀏覽次數。')) return;
    setLoadingResetStats(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await adminApiFetch<any>('/api/admin/stats/reset', { method: 'POST' });
      if (res.ok) {
        setStats(prev => ({
          ...prev,
          today_page_views: 0,
          total_page_views: 0,
          daily_pv: {}
        }));
        await fetchAnalyticsData();
      } else {
        alert(res.error || '重設失敗，請檢查權限');
      }
    } catch (err) {
      console.error('Reset stats error:', err);
      alert('重設過程發生錯誤');
    } finally {
      setLoadingResetStats(false);
    }
  };

  const fetchAnalyticsData = async () => {
    setLoadingStats(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resStats = await adminApiFetch<any>('/api/admin/stats');
      if (resStats.ok && resStats.data) {
        setStats({
          today_page_views: resStats.data.today_page_views ?? 0,
          total_page_views: resStats.data.total_page_views ?? 0,
          online_users: resStats.data.online_users ?? resStats.data.active_online_users ?? 0,
          issue_reports_count: resStats.data.issue_reports_count ?? resStats.data.total_issue_reports ?? 0,
          status_note: resStats.data.status_note ?? '實時統計運作中',
          daily_pv: resStats.data.daily_pv || {}
        });
      }
      let combinedReports: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resReports = await adminApiFetch<any>('/api/admin/issue-reports');
      if (resReports.ok && resReports.data && Array.isArray(resReports.data.reports)) {
        combinedReports = resReports.data.reports;
      }
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('godseye_local_issue_reports');
          if (raw) {
            const localList = JSON.parse(raw);
            if (Array.isArray(localList)) {
              const seen = new Set(combinedReports.map(r => String(r.timestamp) + String(r.title)));
              for (const item of localList) {
                if (!seen.has(String(item.timestamp) + String(item.title))) {
                  combinedReports.push(item);
                  seen.add(String(item.timestamp) + String(item.title));
                }
              }
            }
          }
        } catch (_) {}
      }
      combinedReports.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setIssueReports(combinedReports);
    } catch (err) {
      console.error('Fetch analytics error:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // 判斷是否為本地開發環境 (localhost / 127.0.0.1 / :3000)
  const isDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local') ||
    window.location.port === '3000'
  );

  // 伺服器端 HMAC 簽章 Session 認證狀態 (預設鎖定，未通過後端驗證前絕不渲染後台內容)
  const [authChecking, setAuthChecking] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinErrorMsg, setPinErrorMsg] = useState<string | null>(null);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);

  useEffect(() => {
    if (!isUnlocked) return;
    if (mainTab === 'analytics' || mainTab === 'issues') {
      fetchAnalyticsData();
    } else if (mainTab === 'system_logs') {
      fetchSystemLogs();
    } else if (mainTab === 'maintenance') {
      fetchMaintenanceStatus();
    }
  }, [mainTab, isUnlocked]);

  const fetchScheduleHistory = async () => {
    try {
      const res = await adminApiFetch<{ logs: AuditLog[]; retention_days?: number }>('/api/admin/schedule-history');
      if (res.ok && res.data && Array.isArray(res.data.logs)) {
        setLogs(res.data.logs);
        if (typeof res.data.retention_days === 'number') {
          setScheduleRetentionDays(res.data.retention_days);
          setScheduleRetentionInput(String(res.data.retention_days));
        }
      }
    } catch (err) {
      console.error('Fetch schedule history error:', err);
    }
  };

  const fetchMaintenanceStatus = async () => {
    try {
      const res = await adminApiFetch<{ enabled: boolean; message: string; updated_at?: string }>('/api/admin/maintenance');
      if (res.ok && res.data) {
        setMaintenanceEnabled(Boolean(res.data.enabled));
        if (res.data.message) setMaintenanceMessage(res.data.message);
        if (res.data.updated_at) setMaintenanceUpdatedAt(res.data.updated_at);
      }
      // 讀取可供還原的 Commit 清單
      const commitsRes = await adminApiFetch<{ commits: Array<{ sha: string; full_sha?: string; title: string; message?: string; date?: string; author?: string }> }>('/api/admin/recent-commits');
      if (commitsRes.ok && commitsRes.data?.commits && commitsRes.data.commits.length > 0) {
        setRecentCommits(commitsRes.data.commits);
      }
    } catch (e) {
      console.error('Fetch maintenance status error:', e);
    }
  };

  const handleCopyLogContent = (log: any) => {
    const repeatInfo = log.repeat_count && log.repeat_count > 1 ? ` (連續重複 ${log.repeat_count} 次，最後時間: ${log.last_seen || log.timestamp})` : '';
    const fullText = `[${log.level}${repeatInfo}] ${new Date(log.timestamp).toLocaleString('zh-HK')} | ${log.file} | ${log.action}\n訊息: ${log.message}${
      log.details && Object.keys(log.details).length > 0
        ? `\n詳細資訊:\n${JSON.stringify(log.details, null, 2)}`
        : ''
    }`;
    navigator.clipboard.writeText(fullText);
    setCopiedLogId(log.id);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const handleToggleMaintenance = async () => {
    const nextState = !maintenanceEnabled;
    const confirmPrompt = nextState
      ? '確定要開啟系統維護模式嗎？開啟後，所有訪客進入首頁將會看見維護頁面且無法使用地圖。'
      : '確定要解除系統維護模式嗎？解除後系統將對所有訪客恢復正常服務。';
    if (!window.confirm(confirmPrompt)) return;

    setIsUpdatingMaintenance(true);
    try {
      const res = await adminApiFetch<{ status: string; maintenance: any }>('/api/admin/maintenance', {
        method: 'POST',
        body: JSON.stringify({
          enabled: nextState,
          message: maintenanceMessage
        })
      });
      if (res.ok) {
        setMaintenanceEnabled(nextState);
        setSuccessMsg(nextState ? '已成功開啟系統維護模式！訪客將跳轉至維護頁面。' : '已成功關閉維護模式！系統已恢復對外營運。');
      } else {
        alert(res.error || '維護模式更新失敗');
      }
    } catch (err: any) {
      alert(err?.message || '維護模式設定失敗');
    } finally {
      setIsUpdatingMaintenance(false);
    }
  };

  const handleTriggerRollback = async () => {
    if (!rollbackTarget.trim()) {
      alert('請輸入還原目標 (PREV 或 Commit SHA / Tag)');
      return;
    }
    const confirmPrompt = `⚠️ 警告：確定要執行緊急系統還原嗎？\n\n目標版本：${rollbackTarget}\n\n此操作將透過 GitHub Actions 立即重新簽出並在生產環境 (OCI VM) 重新建置部署容器。請確認無誤後再繼續！`;
    if (!window.confirm(confirmPrompt)) return;

    setIsTriggeringRollback(true);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/system-rollback', {
        method: 'POST',
        body: JSON.stringify({
          target: rollbackTarget.trim()
        })
      });
      if (res.ok && res.data?.status === 'success') {
        setSuccessMsg(`🚀 ${res.data.message}`);
      } else {
        alert(res.data?.message || res.error || '系統還原觸發失敗');
      }
    } catch (err: any) {
      alert(err?.message || '緊急系統還原請求失敗');
    } finally {
      setIsTriggeringRollback(false);
    }
  };

  // 11.4 取得系統運作日誌
  const fetchSystemLogs = async () => {
    setLoadingSystemLogs(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await adminApiFetch<any>('/api/admin/system-logs');
      if (res.ok && res.data) {
        setSystemLogs(Array.isArray(res.data.logs) ? res.data.logs : []);
        if (typeof res.data.retention_days === 'number') {
          setSystemRetentionDays(res.data.retention_days);
          setSystemRetentionInput(String(res.data.retention_days));
        }
      }
    } catch (err) {
      console.error('Fetch system logs error:', err);
    } finally {
      setLoadingSystemLogs(false);
    }
  };

  // 3.1 手動設定並儲存特定資料源之 API / 爬取連結
  const handleSaveSourceUrl = async (sourceId: string, newUrl: string) => {
    setIsSavingUrl(true);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/sources/url', {
        method: 'POST',
        body: JSON.stringify({ source_id: sourceId, source_url: newUrl })
      });
      if (res.ok) {
        setSources(prev => prev.map(s => s.id === sourceId ? { ...s, source_url: newUrl, url: newUrl } : s));
        setEditingUrlId(null);
        setSavedUrlSuccessId(sourceId);
        setTimeout(() => setSavedUrlSuccessId(null), 3000);
      } else {
        alert(res.error || '儲存來源 URL 失敗');
      }
    } catch (err: any) {
      alert(err?.message || '儲存來源 URL 網路連線錯誤');
    } finally {
      setIsSavingUrl(false);
    }
  };

  // 11.4 設定系統日誌保留期限 (自定義天數)
  const handleSystemRetentionChange = async (days: number) => {
    const safeDays = Math.max(0, Math.floor(isNaN(days) ? 0 : days));
    setSystemRetentionDays(safeDays);
    setSystemRetentionInput(String(safeDays));
    await adminApiFetch('/api/admin/system-logs/retention', {
      method: 'POST',
      body: JSON.stringify({ retention_days: safeDays })
    });
    await fetchSystemLogs();
  };

  // 11.4 清空系統日誌 (同時清空統一之系統日誌與排程記錄)
  const handleClearSystemLogs = async () => {
    if (!confirm('確定要清空所有系統運作、錯誤與資料更新日誌嗎？此操作無法還原。')) return;
    await adminApiFetch('/api/admin/system-logs/clear', { method: 'POST' });
    await adminApiFetch('/api/admin/schedule-history/clear', { method: 'POST' });
    await fetchSystemLogs();
    setLogs([]);
  };

  // 11.4 匯出系統日誌為 JSON
  const handleExportSystemLogs = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(systemLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `godseye_system_logs_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // 11.5 設定排程歷史保留期限 (自定義天數)
  const handleScheduleRetentionChange = async (days: number) => {
    const safeDays = Math.max(0, Math.floor(isNaN(days) ? 0 : days));
    setScheduleRetentionDays(safeDays);
    setScheduleRetentionInput(String(safeDays));
    await adminApiFetch('/api/admin/schedule-history/retention', {
      method: 'POST',
      body: JSON.stringify({ retention_days: safeDays })
    });
    await fetchScheduleHistory();
    await fetchAdminData();
  };

  // 11.3 獨立圖層開關：切換並同步至 localStorage、Zustand 與後端全域設定
  const handleToggleLayerVisibility = async (sourceId: string, layerKey: string) => {
    const currentHidden = !!hiddenLayersInPanelState[layerKey];
    const nextHidden = !currentHidden;
    useUIStore.getState().toggleLayerPanelHidden(layerKey);
    setHiddenLayersInPanelState(prev => ({ ...prev, [layerKey]: nextHidden }));
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('vancouver_hidden_layers_in_panel') || '{}';
        const parsed = JSON.parse(raw);
        parsed[layerKey] = nextHidden;
        localStorage.setItem('vancouver_hidden_layers_in_panel', JSON.stringify(parsed));
      } catch (_) {}
    }
    await adminApiFetch('/api/admin/sources/visibility', {
      method: 'POST',
      body: JSON.stringify({ source_id: sourceId, hidden: nextHidden })
    });
    await adminApiFetch('/api/admin/layers/config', {
      method: 'POST',
      body: JSON.stringify({ hidden_layers: { [layerKey]: nextHidden } })
    });
  };

  // 切換底圖圖層資料啟用狀態並全域持久化至後端
  const handleToggleLayerData = async (layerKey: string) => {
    const isCurrentlyDisabled = !!disabledLayers[layerKey];
    const nextDisabled = !isCurrentlyDisabled;
    const nextDisabledLayers = {
      ...disabledLayers,
      [layerKey]: nextDisabled
    };
    setDisabledLayers(nextDisabledLayers);

    await adminApiFetch('/api/admin/layers/config', {
      method: 'POST',
      body: JSON.stringify({ disabled_layers: { [layerKey]: nextDisabled } })
    });
  };

  // 修改主題色彩並全域持久化至後端
  const handleSetLayerColor = async (layerKey: string, color: string) => {
    setLayerCustomColor(layerKey, color);
    await adminApiFetch('/api/admin/layers/config', {
      method: 'POST',
      body: JSON.stringify({ custom_colors: { [layerKey]: color } })
    });
  };

  // 還原所有預設色彩並全域持久化至後端
  const handleResetAllLayerColors = async () => {
    resetLayerCustomColors();
    await adminApiFetch('/api/admin/layers/config', {
      method: 'POST',
      body: JSON.stringify({ reset_colors: true })
    });
  };

  // 11.1 清單列表多欄位排序處理
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 11.4 系統日誌過濾與分頁計算 (包含資料源更新、排程修改與系統事件)
  const filteredSystemLogs = useMemo(() => {
    return systemLogs.filter((log) => {
      if (systemLogLevelFilter !== 'all' && log.level !== systemLogLevelFilter) return false;
      if (systemLogSearch.trim()) {
        const q = systemLogSearch.toLowerCase();
        const matchFile = (log.file || '').toLowerCase().includes(q);
        const matchMsg = (log.message || '').toLowerCase().includes(q);
        const matchAction = (log.action || '').toLowerCase().includes(q);
        const matchDetails = log.details ? JSON.stringify(log.details).toLowerCase().includes(q) : false;
        if (!matchFile && !matchMsg && !matchAction && !matchDetails) return false;
      }
      return true;
    });
  }, [systemLogs, systemLogLevelFilter, systemLogSearch]);

  const totalSystemLogPages = Math.max(1, Math.ceil(filteredSystemLogs.length / SYSTEM_LOG_PAGE_SIZE));
  const pagedSystemLogs = useMemo(() => {
    const start = (systemLogPage - 1) * SYSTEM_LOG_PAGE_SIZE;
    return filteredSystemLogs.slice(start, start + SYSTEM_LOG_PAGE_SIZE);
  }, [filteredSystemLogs, systemLogPage]);

  // 更新問題回報狀態 (resolved: 完成 / closed: 關閉 / pending: 待處理)
  const handleUpdateIssueStatus = async (reportId: string, newStatus: 'resolved' | 'closed' | 'pending') => {
    try {
      // 1. 即時樂觀更新畫面
      setIssueReports((prev) =>
        prev.map((item) => {
          if (item.id === reportId || item.timestamp === reportId) {
            return { ...item, status: newStatus };
          }
          return item;
        })
      );

      // 2. 同步 localStorage
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('godseye_local_issue_reports');
          if (raw) {
            const list = JSON.parse(raw);
            const updated = list.map((x: any) =>
              x.id === reportId || x.timestamp === reportId ? { ...x, status: newStatus } : x
            );
            localStorage.setItem('godseye_local_issue_reports', JSON.stringify(updated));
          }
        } catch (_) {}
      }

      // 3. 呼叫後端 API
      await adminApiFetch(`/api/admin/issue-reports/${encodeURIComponent(reportId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      console.error('Update issue status error:', err);
    }
  };

  // 徹底刪除問題回報記錄
  const handleDeleteIssueReport = async (reportId: string) => {
    if (!window.confirm('確定要徹底刪除此則問題回報記錄嗎？此操作無法還原。')) {
      return;
    }
    try {
      // 1. 即時更新畫面狀態
      setIssueReports((prev) => prev.filter((item) => item.id !== reportId && item.timestamp !== reportId));

      // 2. 同步 localStorage
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('godseye_local_issue_reports');
          if (raw) {
            const list = JSON.parse(raw);
            const filtered = list.filter((x: any) => x.id !== reportId && x.timestamp !== reportId);
            localStorage.setItem('godseye_local_issue_reports', JSON.stringify(filtered));
          }
        } catch (_) {}
      }

      // 3. 呼叫後端 API
      await adminApiFetch(`/api/admin/issue-reports/${encodeURIComponent(reportId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Delete issue report error:', err);
    }
  };

  // GitHub Token State & Modal
  const [githubStatus, setGithubStatus] = useState<{ configured: boolean; repo: string; token_masked: string }>({
    configured: false,
    repo: 'Ycf206/Vancouver-God-Eyes',
    token_masked: '未設定'
  });
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [inputGithubToken, setInputGithubToken] = useState('');
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Operation States
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editCron, setEditCron] = useState('');
  const [editInterval, setEditInterval] = useState('');
  const [selectedSchedulePreset, setSelectedSchedulePreset] = useState<string>('custom');
  const [customDow, setCustomDow] = useState<number>(1); // 1 = 週一
  const [customDom, setCustomDom] = useState<number>(1); // 1 = 1號
  const [customMonth, setCustomMonth] = useState<number>(1); // 1 = 1月
  const [customTime, setCustomTime] = useState<string>('04:00'); // HH:mm

  const updateCustomWeekly = (dow: number, timeStr: string) => {
    const [hh, mm] = (timeStr || '04:00').split(':');
    const h = parseInt(hh, 10) || 0;
    const m = parseInt(mm, 10) || 0;
    const dowNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    setEditCron(`${m} ${h} * * ${dow}`);
    setEditInterval(`每${dowNames[dow] || '週一'} ${timeStr}`);
  };

  const updateCustomMonthly = (dom: number, timeStr: string) => {
    const [hh, mm] = (timeStr || '04:00').split(':');
    const h = parseInt(hh, 10) || 0;
    const m = parseInt(mm, 10) || 0;
    setEditCron(`${m} ${h} ${dom} * *`);
    setEditInterval(`每月${dom}號 ${timeStr}`);
  };

  const updateCustomYearly = (mon: number, dom: number, timeStr: string) => {
    const [hh, mm] = (timeStr || '04:00').split(':');
    const h = parseInt(hh, 10) || 0;
    const m = parseInt(mm, 10) || 0;
    setEditCron(`${m} ${h} ${dom} ${mon} *`);
    setEditInterval(`每年${mon}月${dom}日 ${timeStr}`);
  };

  const handleSchedulePresetSelect = (presetKey: string) => {
    setSelectedSchedulePreset(presetKey);
    const matched = SCHEDULE_PRESETS.find(p => p.label === presetKey);
    if (matched) {
      setEditCron(matched.cron);
      setEditInterval(matched.interval);
    } else if (presetKey === 'custom_weekly') {
      updateCustomWeekly(customDow, customTime);
    } else if (presetKey === 'custom_monthly') {
      updateCustomMonthly(customDom, customTime);
    } else if (presetKey === 'custom_yearly') {
      updateCustomYearly(customMonth, customDom, customTime);
    }
  };
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 徹底解決主地圖 html/body overflow:hidden 導致 admin 頁面無法拉上拉下捲動問題
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const prevHtmlOverflow = document.documentElement.style.overflow;
      const prevBodyOverflow = document.body.style.overflow;
      const prevBodyHeight = document.body.style.height;

      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'auto';
      document.body.style.height = 'auto';

      return () => {
        document.documentElement.style.overflow = prevHtmlOverflow;
        document.body.style.overflow = prevBodyOverflow;
        document.body.style.height = prevBodyHeight;
      };
    }
  }, []);

  // 統一防禦型管理 API 請求輔助函數 (嚴格透過 HttpOnly Cookie + 簽章 Session Token 驗證，絕不暴露 NEXT_PUBLIC 密鑰)
  const adminApiFetch = async <T = any>(
    path: string, 
    options: RequestInit = {}
  ): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> => {
    const sessionToken =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('gods_eye_admin_session_token') || ''
        : '';
    const tryFetch = async (url: string) => {
      const customHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {})
      };
      if (sessionToken) {
        customHeaders['X-Admin-Token'] = sessionToken;
        customHeaders['Authorization'] = `Bearer ${sessionToken}`;
      }
      if (isDev) {
        customHeaders['X-Admin-Dev-Bypass'] = 'true';
      }
      return await fetch(url, {
        ...options,
        credentials: 'include',
        headers: customHeaders
      });
    };

    let res: Response | null = null;
    let lastError = '';

    // 1. 優先採用同源相對路徑
    try {
      res = await tryFetch(path);
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

    // 2. 若相對路徑網路層失敗，備用嘗試 apiUrl
    if (!res) {
      try {
        const apiUrl = getApiUrl();
        if (apiUrl && !apiUrl.startsWith(window.location.origin)) {
          res = await tryFetch(`${apiUrl}${path}`);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (!res) {
      return { ok: false, error: lastError || '無法連線至伺服器，請檢查網路連線或稍候再試' };
    }

    if ((res.status === 401 || res.status === 403) && !path.includes('/api/admin/auth/login') && !path.includes('/api/admin/auth/verify')) {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('gods_eye_admin_session_token');
        sessionStorage.removeItem('gods_eye_admin_unlocked');
      }
      setIsUnlocked(false);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const json = await res.json();
        if (res.ok) {
          return { ok: true, data: json, status: res.status };
        } else {
          return { ok: false, error: json.message || json.detail || `請求失敗 (HTTP ${res.status})`, status: res.status };
        }
      } catch (_) {
        return { ok: false, error: '回傳資料解析失敗', status: res.status };
      }
    }

    // 非 JSON 格式 (如 Nginx 502 Bad Gateway HTML, 404, 500, 或 Cloudflare 攔截頁面)
    if (res.status === 502 || res.status === 504) {
      return { ok: false, error: `後端服務啟動中或伺服器正在重新編譯容器 (HTTP ${res.status})，請稍候 30 秒再試`, status: res.status };
    }
    if (res.status === 404) {
      return { ok: false, error: `找不到對應的後端 API 端點 (HTTP 404)`, status: res.status };
    }
    return { ok: false, error: `伺服器回應異常 (HTTP ${res.status})`, status: res.status };
  };

  // 啟動時向後端驗證現有安全 Session，並清除舊版曾殘留於瀏覽器 localStorage 的明文 Token
  useEffect(() => {
    let cancelled = false;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('gods_eye_github_token');
        localStorage.removeItem('vancouver_godseye_admin_token');
        localStorage.removeItem('gods_eye_schedule_overrides');
      } catch (_) {}
    }
    (async () => {
      try {
        const localUnlocked = typeof window !== 'undefined' && sessionStorage.getItem('gods_eye_admin_unlocked') === 'true';
        if (isDev && localUnlocked) {
          setIsUnlocked(true);
          setAuthChecking(false);
          return;
        }
        const res = await adminApiFetch<{ authenticated: boolean }>('/api/admin/auth/verify');
        if (!cancelled) {
          setIsUnlocked(Boolean((res.ok && res.data?.authenticated) || (isDev && localUnlocked)));
        }
      } catch (_) {
        const localUnlocked = typeof window !== 'undefined' && sessionStorage.getItem('gods_eye_admin_unlocked') === 'true';
        if (!cancelled) setIsUnlocked(Boolean(isDev && localUnlocked));
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAdminData = async () => {
    try {
      setIsLoading(true);
      
      const res = await adminApiFetch<{ sources: DataSource[]; logs: AuditLog[]; schedule_retention_days?: number }>('/api/admin/sources');
      let loadedSources: DataSource[] = [];
      if (res.ok && res.data && Array.isArray(res.data.sources) && res.data.sources.length > 0) {
        loadedSources = res.data.sources.map(s => ({
          ...s,
          runner: (s.runner as string) === 'github' ? 'github_actions' : s.runner
        }));
        setLogs(res.data.logs || []);
        if (typeof (res.data as any).schedule_retention_days === 'number') {
          setScheduleRetentionDays((res.data as any).schedule_retention_days);
          setScheduleRetentionInput(String((res.data as any).schedule_retention_days));
        }
        setBackendConnected(true);
      } else {
        loadedSources = DEFAULT_ADMIN_SOURCES as DataSource[];
        setBackendConnected(false);
      }
      setSources(loadedSources);
      fetchSystemLogs();

      // 查詢 GitHub Token 配置狀態 (僅由伺服器安全保存，不再寫入瀏覽器 localStorage)
      const ghRes = await adminApiFetch<{ configured: boolean; repo: string; token_masked: string }>('/api/admin/github-status');
      if (ghRes.ok && ghRes.data) {
        setGithubStatus(ghRes.data);
      } else if (isDev) {
        setGithubStatus({
          configured: true,
          repo: 'Ycf206/Vancouver-God-Eyes (開發環境模擬)',
          token_masked: 'ghp_dev_mock_token_active'
        });
      }

      // 查詢並同步後端全域圖層控制配置 (面板隱藏、自訂主題色彩、底圖啟用狀態)
      try {
        const layersRes = await adminApiFetch<{ hidden_layers?: Record<string, boolean>; disabled_layers?: Record<string, boolean>; custom_colors?: Record<string, string>; layer_states?: Record<string, boolean> }>('/api/layers/config');
        if (layersRes.ok && layersRes.data) {
          if (layersRes.data.hidden_layers) {
            setHiddenLayersInPanelState(layersRes.data.hidden_layers);
            useUIStore.getState().setHiddenLayersInPanel(layersRes.data.hidden_layers);
          }
          if (layersRes.data.disabled_layers) {
            useUIStore.getState().setDisabledLayers(layersRes.data.disabled_layers);
          }
          if (layersRes.data.custom_colors) {
            useUIStore.getState().setLayerCustomColors(layersRes.data.custom_colors);
          }
          if (layersRes.data.layer_states) {
            useUIStore.getState().setLayers(layersRes.data.layer_states);
          }
        }
      } catch (_) {}
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setSources(DEFAULT_ADMIN_SOURCES as DataSource[]);
      setBackendConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isUnlocked) return;
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked]);

  // 伺服器端密碼驗證解鎖 (具備防暴力破解鎖定與 HMAC 簽章憑證)
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwd = pinInput.trim();
    if (!pwd || isLoggingIn) return;
    setIsLoggingIn(true);
    setPinError(false);
    setPinErrorMsg(null);
    try {
      const res = await adminApiFetch<{ ok: boolean; token?: string; expires_in?: number }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok && res.data) {
        if (typeof window !== 'undefined') {
          if (res.data.token) {
            sessionStorage.setItem('gods_eye_admin_session_token', res.data.token);
          }
          sessionStorage.setItem('gods_eye_admin_unlocked', 'true');
        }
        setPinInput('');
        setPinError(false);
        setPinErrorMsg(null);
        setIsUnlockModalOpen(false);
        setIsUnlocked(true);
      } else {
        setPinError(true);
        setPinErrorMsg(res.error || '管理員密碼錯誤，請重新輸入');
        setPinInput('');
      }
    } catch (err: any) {
      setPinError(true);
      setPinErrorMsg(err?.message || '伺服器驗證連線失敗');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 安全登出並撤銷瀏覽器與 Cookie 憑證
  const handleLogout = async () => {
    try {
      await adminApiFetch('/api/admin/auth/logout', { method: 'POST' });
    } catch (_) {}
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('gods_eye_admin_session_token');
      sessionStorage.removeItem('gods_eye_admin_unlocked');
    }
    setIsUnlocked(false);
    setPinInput('');
  };

  // 儲存 GitHub Token (僅安全寫入伺服器端，絕不落地於瀏覽器 localStorage)
  const handleSaveGithubToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = inputGithubToken.trim();
    if (!token) return;
    setIsSavingToken(true);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/github-token', {
        method: 'POST',
        body: JSON.stringify({
          token,
          repo: githubStatus.repo || 'Ycf206/Vancouver-God-Eyes'
        })
      });
      if (res.ok && res.data) {
        setSuccessMsg(res.data.message || 'GitHub Token 已成功安全儲存於伺服器！');
        setTimeout(() => setSuccessMsg(null), 6000);
        setIsGithubModalOpen(false);
        setInputGithubToken('');
        await fetchAdminData();
      } else {
        alert('儲存失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      alert('儲存失敗: ' + (err?.message || err));
    } finally {
      setIsSavingToken(false);
    }
  };

  // Trigger Sync (場景一)
  const handleSync = async (sourceId: string, runner?: 'github_actions' | 'oci') => {
    if (!isUnlocked) {
      setPinInput('');
      setPinError(false);
      setIsUnlockModalOpen(true);
      return;
    }
    setSyncingId(sourceId);
    try {
      const res = await adminApiFetch<{ status: string; message: string }>('/api/admin/sources/sync', {
        method: 'POST',
        body: JSON.stringify({ source_id: sourceId, runner })
      });
      if (res.ok && res.data) {
        setSuccessMsg(res.data.message || '同步請求已成功提交！');
        setTimeout(() => setSuccessMsg(null), 5000);
        await fetchAdminData();
      } else if (isDev) {
        setSuccessMsg(`[開發環境模擬] 已模擬觸發 ${sourceId} 資料同步成功！`);
        setTimeout(() => setSuccessMsg(null), 5000);
      } else {
        alert('同步失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingId(null);
    }
  };

  // Save Schedule Change (場景二)
  const handleSaveSchedule = async (source: DataSource) => {
    if (!isUnlocked) {
      setPinInput('');
      setPinError(false);
      setIsUnlockModalOpen(true);
      return;
    }
    setIsSavingSchedule(true);
    try {
      const targetCron = editCron || source.cron_expr;
      const targetInterval = cronToChineseInterval(targetCron) || editInterval || source.schedule_interval;

      const res = await adminApiFetch<{ status: string; message: string; detail?: string }>('/api/admin/sources/schedule', {
        method: 'POST',
        body: JSON.stringify({
          source_id: source.id,
          name: editName || source.name,
          cron_expr: targetCron,
          schedule_interval: targetInterval,
          enabled: source.enabled !== false
        })
      });
      if (res.ok && res.data) {
        setSuccessMsg(`排程已儲存！${res.data.detail || res.data.message || ''}`);
        setTimeout(() => setSuccessMsg(null), 6000);
        setEditingId(null);
        await fetchAdminData();
      } else {
        alert('儲存排程失敗: ' + (res.error || '未知錯誤'));
      }
    } catch (err: any) {
      console.error('Save schedule failed:', err);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Toggle Source Enabled/Disabled
  const handleToggleEnabled = async (source: DataSource) => {
    if (!isUnlocked) {
      setPinInput('');
      setPinError(false);
      setIsUnlockModalOpen(true);
      return;
    }
    try {
      await adminApiFetch('/api/admin/sources/schedule', {
        method: 'POST',
        body: JSON.stringify({
          source_id: source.id,
          enabled: !source.enabled
        })
      });
      await fetchAdminData();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  // Clear Logs
  const handleClearLogs = async () => {
    if (!confirm('確定要清空所有系統排程與同步日誌嗎？')) return;
    try {
      await adminApiFetch('/api/admin/sources/logs/clear', { 
        method: 'POST'
      });
      await fetchAdminData();
    } catch (err) {
      console.error('Clear logs failed:', err);
    }
  };

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    sources.forEach(s => { if (s.category) set.add(s.category); });
    return Array.from(set);
  }, [sources]);

  // 11.1 支援多欄位排序之 Filtered & Sorted Sources
  const filteredSources = useMemo(() => {
    const list = sources.filter(s => {
      if (activeTab === 'github_actions' && s.runner !== 'github_actions') return false;
      if (activeTab === 'oci' && s.runner !== 'oci') return false;
      if (selectedCategory !== 'all' && getSystemCategory(s) !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.workflow_file && s.workflow_file.toLowerCase().includes(q)) ||
          s.schedule_interval.toLowerCase().includes(q) ||
          s.cron_expr.toLowerCase().includes(q)
        );
      }
      return true;
    });

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'status') {
        const order = (s: DataSource) => s.enabled === false ? 2 : (s.status === 'error' ? 0 : 1);
        cmp = order(a) - order(b);
      } else if (sortField === 'category') {
        cmp = getSystemCategory(a).localeCompare(getSystemCategory(b), 'zh-Hant');
      } else if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'zh-Hant');
      } else if (sortField === 'runner') {
        cmp = (a.runner || '').localeCompare(b.runner || '');
      } else if (sortField === 'schedule_interval') {
        cmp = (a.schedule_interval || '').localeCompare(b.schedule_interval || '', 'zh-Hant');
      } else if (sortField === 'record_count') {
        cmp = (a.record_count || 0) - (b.record_count || 0);
      } else if (sortField === 'last_updated') {
        cmp = new Date(a.last_updated || 0).getTime() - new Date(b.last_updated || 0).getTime();
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [sources, activeTab, selectedCategory, searchQuery, sortField, sortDirection]);

  const ghCount = sources.filter(s => s.runner === 'github_actions').length;
  const ociCount = sources.filter(s => s.runner === 'oci').length;

  const isSafeEmail = (val?: string | null): boolean =>
    Boolean(val && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(val.trim()));

  const isSafeRasterDataUrl = (val?: string | null): boolean =>
    Boolean(val && /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(val.trim()));

  // 未通過後端身分驗證前，嚴格阻斷渲染任何後台介面、統計與控制項
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0d1017] text-gray-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
          </div>
          <p className="text-xs text-gray-400 font-medium">正在驗證安全憑證與管理員連線...</p>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#0d1017] text-gray-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-[#141822] border border-[#283147] rounded-2xl p-7 shadow-2xl flex flex-col gap-5">
          <div className="flex flex-col items-center text-center gap-2.5">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-sky-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="font-bold text-base text-white tracking-wide">Vancouver God&apos;s Eye</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  SOC
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">獨立安全管理控制台 · 受保護存取區域</p>
            </div>
          </div>

          <form onSubmit={handleUnlock} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>管理員安全密碼 / 存取金鑰</span>
              </label>
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder="請輸入管理員驗證密碼"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError(false);
                  setPinErrorMsg(null);
                }}
                maxLength={128}
                className={`w-full bg-[#0b0e14] border ${
                  pinError ? 'border-rose-500 ring-1 ring-rose-500/60' : 'border-[#2b344a] focus:border-indigo-500'
                } px-3.5 py-2.5 rounded-xl text-white font-mono text-sm outline-none transition-colors`}
              />
              {pinError && (
                <div className="flex items-center gap-1.5 text-rose-400 text-xs font-medium mt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{pinErrorMsg || '密碼錯誤，請重新輸入'}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!pinInput.trim() || isLoggingIn}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在向伺服器驗證...</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>驗證並進入管理後台</span>
                </>
              )}
            </button>

            {isDev && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await adminApiFetch<{ ok: boolean; token?: string }>('/api/admin/auth/login', {
                      method: 'POST',
                      body: JSON.stringify({ dev_bypass: true, password: 'dev' })
                    });
                    if (res.data?.token && typeof window !== 'undefined') {
                      sessionStorage.setItem('gods_eye_admin_session_token', res.data.token);
                    }
                  } catch (_) {}
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('gods_eye_admin_unlocked', 'true');
                  }
                  setIsUnlocked(true);
                  setIsUnlockModalOpen(false);
                  setGithubStatus({
                    configured: true,
                    repo: 'Ycf206/Vancouver-God-Eyes (開發環境模擬)',
                    token_masked: 'ghp_dev_mock_token_active'
                  });
                }}
                className="w-full py-2.5 px-4 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>開發環境專用：跳過密碼直接進入</span>
              </button>
            )}
          </form>

          <div className="pt-3 border-t border-[#22293a] text-[11px] text-gray-500 text-center leading-relaxed">
            所有登入嘗試均受伺服器頻率限制與安全審計日誌保護。未授權訪問將被自動封鎖。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1017] text-gray-100 flex flex-col font-sans select-none">
      {/* Top Banner / Navigation */}
      <header className="h-16 bg-[#161a23] border-b border-[#282f40] px-6 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-white tracking-wide">Vancouver God&apos;s Eye</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                admin.vangodseye.fyi
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* GitHub Token Status Pill (Click to open setup modal) */}
          <button
            onClick={() => setIsGithubModalOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-xs cursor-pointer ${
              (githubStatus.configured || isDev)
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 animate-pulse'
            }`}
            title="點擊設定 GitHub Token，以便支援一鍵觸發 Actions 雲端工作流與動態 Commit 排程"
          >
            <Key className="w-3.5 h-3.5" />
            <span>{(githubStatus.configured || isDev) ? (isDev && !githubStatus.configured ? 'GitHub 串接 (開發模式)' : 'GitHub 串接就緒') : '未設定 GITHUB_TOKEN'}</span>
          </button>

          {/* Backend Status Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c2230] border border-[#2b3447] text-xs text-gray-300">
            <span className={`w-2 h-2 rounded-full ${backendConnected === false ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`}></span>
            <span>{backendConnected === false ? '使用內建字典展示' : '雲端與主機連線正常'}</span>
          </div>

          <button
            onClick={() => fetchAdminData()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#202738] hover:bg-[#2a344a] text-gray-200 border border-[#34405a] rounded-lg text-xs font-medium transition-all shadow-sm cursor-pointer"
            title="手動刷新清單"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            <span>重新載入</span>
          </button>

          {isUnlocked ? (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              title="安全登出並鎖定管理後台"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>登出鎖定</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setPinInput('');
                setPinError(false);
                setIsUnlockModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-xs hover:scale-105"
              title="點擊輸入管理員密碼以解鎖寫入操作"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>唯讀模式 (點擊解鎖)</span>
            </button>
          )}
        </div>
      </header>

      {/* 瀏覽器分頁風格導航列 (Chrome / Arc Tab Bar Style) */}
      <div className="bg-[#0b0e14] border-b border-[#232a3b] px-3 sm:px-6 pt-2 flex items-center justify-between overflow-x-auto select-none">
        <div className="flex items-center gap-1.5 min-w-max">
          {/* 分頁 1: 資料管線控制 */}
          <button
            onClick={() => setMainTab('sources')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'sources'
                ? 'bg-[#141822] text-white border-t-2 border-t-indigo-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <Sliders className={`w-3.5 h-3.5 ${mainTab === 'sources' ? 'text-indigo-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>資料管線控制</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              mainTab === 'sources' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-black/30 text-gray-500'
            }`}>
              {sources.length}
            </span>
            {mainTab === 'sources' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 3.3 新增分頁: 圖層控制 */}
          <button
            onClick={() => setMainTab('layers')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'layers'
                ? 'bg-[#141822] text-white border-t-2 border-t-sky-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <Layers className={`w-3.5 h-3.5 ${mainTab === 'layers' ? 'text-sky-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>圖層控制</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              mainTab === 'layers' ? 'bg-sky-500/20 text-sky-300' : 'bg-black/30 text-gray-500'
            }`}>
              {LAYER_CONTROLS_LIST.length}
            </span>
            {mainTab === 'layers' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 分頁 2: 系統日誌 (合併資料更新日誌與系統日誌) */}
          <button
            onClick={() => setMainTab('system_logs')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'system_logs'
                ? 'bg-[#141822] text-white border-t-2 border-t-sky-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <Terminal className={`w-3.5 h-3.5 ${mainTab === 'system_logs' ? 'text-sky-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>系統日誌</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              mainTab === 'system_logs' ? 'bg-sky-500/20 text-sky-300' : 'bg-black/30 text-gray-500'
            }`}>
              {systemLogs.length}
            </span>
            {mainTab === 'system_logs' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 分頁 4: 統計數據 */}
          <button
            onClick={() => setMainTab('analytics')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'analytics'
                ? 'bg-[#141822] text-white border-t-2 border-t-emerald-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <BarChart3 className={`w-3.5 h-3.5 ${mainTab === 'analytics' ? 'text-emerald-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>統計數據</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded-full font-sans bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              實時統計中
            </span>
            {mainTab === 'analytics' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 分頁 5: 系統維護 */}
          <button
            onClick={() => setMainTab('maintenance')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'maintenance'
                ? 'bg-[#141822] text-white border-t-2 border-t-amber-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <Wrench className={`w-3.5 h-3.5 ${mainTab === 'maintenance' ? 'text-amber-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>系統維護</span>
            {maintenanceEnabled && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-amber-500/20 text-amber-300 animate-pulse">
                維護中
              </span>
            )}
            {mainTab === 'maintenance' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 分頁 6: 回報問題 */}
          <button
            onClick={() => setMainTab('issues')}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-semibold transition-all cursor-pointer ${
              mainTab === 'issues'
                ? 'bg-[#141822] text-white border-t-2 border-t-rose-500 border-x border-[#232a3b] shadow-sm z-10'
                : 'bg-[#0f131a] text-gray-400 hover:text-gray-200 hover:bg-[#161c27] border-t-2 border-transparent'
            }`}
          >
            <AlertCircle className={`w-3.5 h-3.5 ${mainTab === 'issues' ? 'text-rose-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
            <span>回報問題</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              mainTab === 'issues' ? 'bg-rose-500/20 text-rose-300' : 'bg-black/30 text-gray-500'
            }`}>
              {issueReports.length}
            </span>
            {mainTab === 'issues' && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#141822]" />
            )}
          </button>

          {/* 瀏覽器分頁新增預留按鈕 */}
          <button
            onClick={() => alert('分頁擴充預留位：未來可輕鬆新增更多業務模組 (例如：用戶評論審核、自訂圖資匯入、API 存取分析等)')}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#1a2130] rounded-lg transition-colors cursor-pointer ml-1"
            title="預留新功能分頁插槽"
          >
            <span className="text-sm font-bold leading-none px-1">+</span>
          </button>
        </div>

        
      </div>

      {/* Main Container */}
      <main className="flex-1 p-3 sm:p-4 w-full max-w-[98%] 2xl:max-w-[1600px] mx-auto flex flex-col gap-3">
        
        {/* Success Alert Banner */}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center justify-between shadow-lg animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 text-xs font-bold px-2 py-0.5 cursor-pointer">✕</button>
          </div>
        )}

        {/* 分頁 1 內容：數據圖資與更新管線 (已刪除重複之第一行統計方格，完整釋放垂直清單空間) */}
        {mainTab === 'sources' && (
          <div className="flex flex-col gap-3">
            {/* View Switcher Tabs & Batch Action Bar (唯一保留之標準切換與批次操作列) */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#141822] p-2 rounded-xl border border-[#232a3b]">
              {/* Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === 'all'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
                  }`}
                >
                  <span>全部清單</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">{sources.length}</span>
                </button>

                <button
                  onClick={() => setActiveTab('github_actions')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === 'github_actions'
                      ? 'bg-sky-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>GitHub Actions 雲端管線</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">{ghCount}</span>
                </button>

                <button
                  onClick={() => setActiveTab('oci')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === 'oci'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1d2331]'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>OCI 伺服器即時服務</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">{ociCount}</span>
                </button>
              </div>

              {/* Batch Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {(activeTab === 'oci' || activeTab === 'all') && (
                  <button
                    disabled={!isUnlocked || syncingId === 'all_oci'}
                    onClick={() => handleSync('all_oci', 'oci')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                      isUnlocked
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                        : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    }`}
                    title="立即同步全部 12 項 OCI 即時交通、天氣、航班快取"
                  >
                    <Zap className={`w-3.5 h-3.5 ${syncingId === 'all_oci' ? 'animate-spin' : ''}`} />
                    <span>立即更新全部 OCI 資料</span>
                  </button>
                )}

                {(activeTab === 'github_actions' || activeTab === 'all') && (
                  <button
                    disabled={!isUnlocked || syncingId === 'all_github'}
                    onClick={() => handleSync('all_github', 'github_actions')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                      isUnlocked
                        ? 'bg-sky-600 hover:bg-sky-500 text-white cursor-pointer'
                        : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    }`}
                    title="透過 GitHub Actions 觸發全部 GeoJSON 圖層資料管線更新"
                  >
                    <Cloud className={`w-3.5 h-3.5 ${syncingId === 'all_github' ? 'animate-spin' : ''}`} />
                    <span>立即觸發所有 Actions 管線</span>
                  </button>
                )}
              </div>
            </div>

            {/* Filter / Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#141822] px-4 py-3 rounded-xl border border-[#232a3b]">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜尋資料源名稱、ID、頻率、Cron 或工作流檔案..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0d1017] border border-[#2b3346] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                <span className="text-[11px] text-gray-400 font-semibold flex items-center gap-1 shrink-0 mr-0.5">
                  <Filter className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline">分類：</span>
                </span>
                {[
                  { id: 'all', label: '全部', count: sources.length },
                  { id: '道路', label: '道路', count: sources.filter(s => getSystemCategory(s) === '道路').length },
                  { id: '天氣', label: '天氣', count: sources.filter(s => getSystemCategory(s) === '天氣').length },
                  { id: '生活', label: '生活', count: sources.filter(s => getSystemCategory(s) === '生活').length },
                  { id: '公共事業', label: '公共事業', count: sources.filter(s => getSystemCategory(s) === '公共事業').length },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedCategory(item.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedCategory === item.id
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400'
                        : 'bg-[#1a2130] text-gray-300 hover:bg-[#252f44] hover:text-white border border-[#2b3548]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      selectedCategory === item.id ? 'bg-white/20 text-white' : 'bg-black/40 text-gray-400'
                    }`}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2.6 逐行式清單 (Line-by-Line Table List View - 不要用網格) */}
            <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto max-h-[72vh] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#3e4e6d]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#161c28] border-b border-[#283144] text-gray-300 font-semibold uppercase text-[10.5px] tracking-wider shadow-sm select-none">
                      <th onClick={() => handleSort('status')} className="py-2.5 px-2 w-12 text-center cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          <span>狀態</span>
                          {sortField === 'status' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort('category')} className="py-2.5 px-2 w-16 cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>分類</span>
                          {sortField === 'category' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort('name')} className="py-2.5 px-2.5 min-w-[150px] max-w-[200px] cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>資料源與項目名稱</span>
                          {sortField === 'name' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort('runner')} className="py-2.5 px-2 w-[110px] cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>執行載體 / 管線</span>
                          {sortField === 'runner' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort('schedule_interval')} className="py-2.5 px-2 w-[130px] cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>排程週期</span>
                          {sortField === 'schedule_interval' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th className="py-2.5 px-2 min-w-[220px]">來源 API / 爬取連結 (點擊可修改)</th>
                      <th onClick={() => handleSort('last_updated')} className="py-2.5 px-2 w-[115px] whitespace-nowrap cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>上次更新</span>
                          {sortField === 'last_updated' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort('record_count')} className="py-2.5 px-2 w-[85px] whitespace-nowrap cursor-pointer hover:text-white transition-colors">
                        <div className="flex items-center gap-1">
                          <span>規模筆數</span>
                          {sortField === 'record_count' ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />) : <ArrowUpDown className="w-2.5 h-2.5 text-gray-500" />}
                        </div>
                      </th>
                      <th className="py-2.5 px-2.5 w-[145px] text-right">圖層控制 / 管理操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202738]">
                    {filteredSources.map((source) => {
                      const isEditing = editingId === source.id;
                      const isSyncing = syncingId === source.id || source.status === 'updating';
                      const isOci = source.runner === 'oci';
                      const isGitHubUnbound = !isOci && !(githubStatus.configured || isDev);

                      return (
                        <tr 
                          key={source.id} 
                          className="hover:bg-[#1a202d] transition-colors group"
                        >
                          {/* 狀態燈號 */}
                          <td className="py-2.5 px-2 text-center">
                            <span 
                              className={`inline-block w-2.5 h-2.5 rounded-full ${
                                isSyncing
                                  ? 'bg-sky-400 animate-ping'
                                  : source.status === 'error'
                                    ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                                    : source.enabled !== false
                                      ? isOci ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]'
                                      : 'bg-gray-500'
                              }`} 
                              title={
                                isSyncing
                                  ? '雲端工作流 / 資料同步執行中'
                                  : source.status === 'error'
                                    ? '最近一次更新執行失敗，請查看排程日誌'
                                    : source.enabled !== false
                                      ? '排程正常啟用中'
                                      : '排程已暫停'
                              }
                            />
                          </td>

                          {/* 1. 分類 (已移至資料源名稱左方) */}
                          <td className="py-2.5 px-2">
                            {(() => {
                              const cat = getSystemCategory(source);
                              const catColors: Record<string, string> = {
                                '道路': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                                '天氣': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
                                '生活': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                                '公共事業': 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                              };
                              return (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${catColors[cat] || 'bg-[#1d2433] text-gray-300 border-[#2f3950]'}`}>
                                  {cat}
                                </span>
                              );
                            })()}
                          </td>

                          {/* 2. 資料源名稱與 ID (支援名稱修改) */}
                          <td className="py-2.5 px-2.5">
                            {isEditing ? (
                              <div className="flex flex-col gap-1">
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  placeholder="資料源名稱"
                                  className="w-full bg-[#181d28] border border-indigo-500/80 text-white font-bold text-xs px-2 py-1 rounded outline-none focus:border-indigo-400"
                                />
                                <span className="text-[10px] text-gray-500 font-mono">
                                  {source.id}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="font-bold text-white text-xs group-hover:text-sky-300 transition-colors flex items-center gap-1.5">
                                  <span>{source.name}</span>
                                  {source.status === 'updating' && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-normal animate-pulse">
                                      執行中
                                    </span>
                                  )}
                                  {source.status === 'error' && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-normal">
                                      異常
                                    </span>
                                  )}
                                </span>
                                <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                                  {source.id}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 執行載體標籤 */}
                          <td className="py-2.5 px-2">
                            {isOci ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 w-fit">
                                  <Server className="w-3 h-3" />
                                  <span>OCI 伺服器服務</span>
                                </span>
                                <span className="text-[10px] text-emerald-500/80 font-mono">
                                  FastAPI 記憶體快取
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 w-fit">
                                  <Cloud className="w-3 h-3" />
                                  <span>GitHub Actions</span>
                                </span>
                                <span className="text-[10px] text-sky-400/80 font-mono truncate max-w-[190px]" title={source.workflow_file || `update-${source.id.replace(/_/g, "-")}.yml`}>
                                  {source.workflow_file || `update-${source.id.replace(/_/g, "-")}.yml`}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 排程週期 (Cron 或間隔) 逐行行內編輯 */}
                          <td className="py-2.5 px-2">
                            {isEditing ? (
                              <div className="flex flex-col gap-2 p-2.5 bg-[#0f1218] rounded-xl border border-indigo-500/50 shadow-xl min-w-[280px] max-w-[340px] animate-in fade-in">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1">
                                      <label className="text-[9px] text-gray-400 block mb-0.5">Cron 表達式</label>
                                      <input
                                        type="text"
                                        value={editCron}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setEditCron(val);
                                          const matched = SCHEDULE_PRESETS.find(p => p.cron === val);
                                          if (matched) {
                                            setSelectedSchedulePreset(matched.label);
                                            setEditInterval(matched.interval);
                                          } else {
                                            setSelectedSchedulePreset('custom');
                                            const autoInterval = cronToChineseInterval(val);
                                            if (autoInterval) {
                                              setEditInterval(autoInterval);
                                            }
                                          }
                                        }}
                                        placeholder="Cron 表達式"
                                        className="w-full bg-[#181d28] border border-[#343e54] text-indigo-300 text-[11px] font-mono px-2 py-1 rounded outline-none focus:border-indigo-400"
                                      />
                                    </div>
                                    <div className="w-36">
                                      <label className="text-[9px] text-gray-400 block mb-0.5">週期選單</label>
                                      <select
                                        value={selectedSchedulePreset}
                                        onChange={(e) => handleSchedulePresetSelect(e.target.value)}
                                        className="w-full bg-[#181d28] border border-[#343e54] text-white text-[11px] px-1.5 py-1 rounded outline-none focus:border-indigo-400 cursor-pointer"
                                      >
                                        <optgroup label="常用週期預設">
                                          {SCHEDULE_PRESETS.map((p) => (
                                            <option key={p.label} value={p.label}>{p.interval} ({p.label})</option>
                                          ))}
                                        </optgroup>
                                        <optgroup label="自訂排程 (Custom)">
                                          <option value="custom_weekly">每週x hh:mm</option>
                                          <option value="custom_monthly">每月x號 hh:mm</option>
                                          <option value="custom_yearly">每年x月x日 hh:mm</option>
                                          <option value="custom">自訂表達式</option>
                                        </optgroup>
                                      </select>
                                    </div>
                                  </div>

                                  {/* 自訂每週細節選單 */}
                                  {selectedSchedulePreset === 'custom_weekly' && (
                                    <div className="flex items-center gap-1.5 bg-[#141822] p-1.5 rounded-lg border border-[#232a3b] text-[11px]">
                                      <span className="text-gray-400 shrink-0">每</span>
                                      <select
                                        value={customDow}
                                        onChange={(e) => {
                                          const dow = Number(e.target.value);
                                          setCustomDow(dow);
                                          updateCustomWeekly(dow, customTime);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1.5 py-0.5 rounded text-[11px] outline-none"
                                      >
                                        <option value={1}>週一</option>
                                        <option value={2}>週二</option>
                                        <option value={3}>週三</option>
                                        <option value={4}>週四</option>
                                        <option value={5}>週五</option>
                                        <option value={6}>週六</option>
                                        <option value={0}>週日</option>
                                      </select>
                                      <input
                                        type="time"
                                        value={customTime}
                                        onChange={(e) => {
                                          const t = e.target.value;
                                          setCustomTime(t);
                                          updateCustomWeekly(customDow, t);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1.5 py-0.5 rounded text-[11px] outline-none"
                                      />
                                    </div>
                                  )}

                                  {/* 自訂每月細節選單 */}
                                  {selectedSchedulePreset === 'custom_monthly' && (
                                    <div className="flex items-center gap-1.5 bg-[#141822] p-1.5 rounded-lg border border-[#232a3b] text-[11px]">
                                      <span className="text-gray-400 shrink-0">每月</span>
                                      <select
                                        value={customDom}
                                        onChange={(e) => {
                                          const d = Number(e.target.value);
                                          setCustomDom(d);
                                          updateCustomMonthly(d, customTime);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1.5 py-0.5 rounded text-[11px] outline-none"
                                      >
                                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                          <option key={d} value={d}>{d} 號</option>
                                        ))}
                                      </select>
                                      <input
                                        type="time"
                                        value={customTime}
                                        onChange={(e) => {
                                          const t = e.target.value;
                                          setCustomTime(t);
                                          updateCustomMonthly(customDom, t);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1.5 py-0.5 rounded text-[11px] outline-none"
                                      />
                                    </div>
                                  )}

                                  {/* 自訂每年細節選單 */}
                                  {selectedSchedulePreset === 'custom_yearly' && (
                                    <div className="flex items-center gap-1.5 bg-[#141822] p-1.5 rounded-lg border border-[#232a3b] text-[11px]">
                                      <span className="text-gray-400 shrink-0">每年</span>
                                      <select
                                        value={customMonth}
                                        onChange={(e) => {
                                          const m = Number(e.target.value);
                                          setCustomMonth(m);
                                          updateCustomYearly(m, customDom, customTime);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1 py-0.5 rounded text-[11px] outline-none"
                                      >
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                          <option key={m} value={m}>{m} 月</option>
                                        ))}
                                      </select>
                                      <select
                                        value={customDom}
                                        onChange={(e) => {
                                          const d = Number(e.target.value);
                                          setCustomDom(d);
                                          updateCustomYearly(customMonth, d, customTime);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1 py-0.5 rounded text-[11px] outline-none"
                                      >
                                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                          <option key={d} value={d}>{d} 日</option>
                                        ))}
                                      </select>
                                      <input
                                        type="time"
                                        value={customTime}
                                        onChange={(e) => {
                                          const t = e.target.value;
                                          setCustomTime(t);
                                          updateCustomYearly(customMonth, customDom, t);
                                        }}
                                        className="bg-[#181d28] border border-[#343e54] text-white px-1.5 py-0.5 rounded text-[11px] outline-none"
                                      />
                                    </div>
                                  )}

                                  {/* 頻率顯示摘要 */}
                                  <div className="text-[10px] text-gray-400 flex items-center justify-between">
                                    <span>週期頻率：<strong className="text-emerald-400 font-mono">{editInterval || '未設定'}</strong></span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 justify-end pt-1 border-t border-[#232a3b]">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-white cursor-pointer"
                                  >
                                    取消
                                  </button>
                                  <button
                                    disabled={isSavingSchedule}
                                    onClick={() => handleSaveSchedule(source)}
                                    className="px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold cursor-pointer transition-colors shadow-sm"
                                  >
                                    {isSavingSchedule ? '儲存中...' : '儲存'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-gray-200">
                                    {formatScheduleInterval(source.schedule_interval, source.cron_expr)}
                                  </span>
                                  {source.enabled === false && (
                                    <span className="text-[10px] px-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                      已停用
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5 text-gray-500" />
                                  <span>{source.cron_expr}</span>
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 3.1 來源連結 / 可手動修改之 API 端點 */}
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-1.5 min-w-[220px]">
                              {editingUrlId === source.id ? (
                                <div className="flex items-center gap-1 w-full">
                                  <input
                                    type="text"
                                    value={editingUrlVal}
                                    onChange={(e) => setEditingUrlVal(e.target.value)}
                                    placeholder="https://..."
                                    className="flex-1 bg-[#131722] border border-indigo-500/80 rounded px-2 py-1 text-xs text-white outline-none font-mono focus:ring-1 focus:ring-indigo-500"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveSourceUrl(source.id, editingUrlVal);
                                      if (e.key === 'Escape') setEditingUrlId(null);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    disabled={isSavingUrl}
                                    onClick={() => handleSaveSourceUrl(source.id, editingUrlVal)}
                                    className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-xs disabled:opacity-50"
                                    title="儲存 API 連結"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingUrlId(null)}
                                    className="p-1 rounded bg-[#252c3d] hover:bg-[#323b52] text-gray-400 hover:text-white cursor-pointer"
                                    title="取消"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 w-full group/url">
                                  <input
                                    type="text"
                                    readOnly
                                    value={source.source_url || source.url || ''}
                                    onClick={() => {
                                      setEditingUrlId(source.id);
                                      setEditingUrlVal(source.source_url || source.url || '');
                                    }}
                                    placeholder="點擊設定自訂 API / 爬取連結..."
                                    className="flex-1 bg-[#151924] hover:bg-[#1c2232] border border-[#2b3347] hover:border-indigo-500/50 rounded px-2 py-1 text-[11px] text-gray-300 hover:text-white font-mono cursor-pointer transition-colors truncate"
                                    title="點擊以修改此資料源之 API 連結或爬取 URL"
                                  />
                                  {(source.source_url || source.url) && (
                                    <a
                                      href={source.source_url || source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 rounded text-gray-400 hover:text-sky-300 hover:bg-sky-500/10 border border-transparent hover:border-sky-500/30 transition-all cursor-pointer shrink-0"
                                      title="開啟並測試此端點連結"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                  {savedUrlSuccessId === source.id && (
                                    <span className="text-[10px] text-emerald-400 font-bold shrink-0 animate-pulse">已儲存</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 上次更新時間 */}
                          <td className="py-2.5 px-2 text-gray-300 font-mono text-[11px] whitespace-nowrap">
                            {source.last_updated ? (
                              <span title={`UTC: ${source.last_updated}`}>
                                {new Date(source.last_updated).toLocaleString('zh-HK', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false
                                })}
                              </span>
                            ) : (
                              <span className="text-gray-500">未執行</span>
                            )}
                          </td>

                          {/* 規模 / 筆數 */}
                          <td className="py-2.5 px-2 text-gray-400 text-[11px] whitespace-nowrap">
                            <span className="text-white font-medium">{(source.record_count ?? 0).toLocaleString()}</span>{' '}
                            <span>{source.unit}</span>
                          </td>

                          {/* 管理操作按鈕 */}
                          <td className="py-2.5 px-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* 立即同步 / 綁定 Token 按鈕 */}
                              {isGitHubUnbound && source.id !== 'food_vendors' && source.id !== 'service_requests_311' ? (
                                <button
                                  onClick={() => setIsGithubModalOpen(true)}
                                  className="px-2 py-1 rounded-md font-semibold text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                                  title="排程已自動於 GitHub 雲端執行並回寫狀態；如需從後台手動觸發此工作流，請先連接 GitHub Token"
                                >
                                  <Key className="w-3 h-3 text-amber-400" />
                                  <span>綁定觸發</span>
                                </button>
                              ) : (
                                <button
                                  disabled={!isUnlocked || isSyncing}
                                  onClick={() => handleSync(source.id, source.runner)}
                                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1 transition-all shadow-xs ${
                                    !isUnlocked
                                      ? 'bg-[#1e2433] text-gray-600 cursor-not-allowed'
                                      : isSyncing
                                        ? 'bg-sky-600 text-white animate-pulse'
                                        : isOci
                                          ? 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 cursor-pointer'
                                          : 'bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/30 cursor-pointer'
                                  }`}
                                  title={isOci ? '立即更新 OCI 實時記憶體快取' : '透過 GitHub Actions 立即觸發雲端工作流'}
                                >
                                  <Play className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                                  <span>{isSyncing ? '同步中' : '立即同步'}</span>
                                </button>
                              )}

                              {/* 修改排程按鈕 */}
                              <button
                                disabled={!isUnlocked}
                                onClick={() => {
                                  setEditingId(source.id);
                                  setEditName(source.name);
                                  setEditCron(source.cron_expr);
                                  setEditInterval(source.schedule_interval);
                                  const detected = parseSourcePreset(source.cron_expr, source.schedule_interval);
                                  setSelectedSchedulePreset(detected);
                                  const parts = (source.cron_expr || '').trim().split(/\s+/);
                                  if (parts.length === 5) {
                                    const [min, hour, dom, mon, dow] = parts;
                                    const hNum = parseInt(hour, 10);
                                    const mNum = parseInt(min, 10);
                                    if (!isNaN(hNum) && !isNaN(mNum)) {
                                      setCustomTime(`${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`);
                                    }
                                    if (dow !== '*' && !isNaN(parseInt(dow, 10))) setCustomDow(parseInt(dow, 10));
                                    if (dom !== '*' && !isNaN(parseInt(dom, 10))) setCustomDom(parseInt(dom, 10));
                                    if (mon !== '*' && !isNaN(parseInt(mon, 10))) setCustomMonth(parseInt(mon, 10));
                                  }
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  isUnlocked
                                    ? 'hover:bg-[#252d3d] text-gray-400 hover:text-gray-100 cursor-pointer'
                                    : 'text-gray-700 cursor-not-allowed'
                                }`}
                                title="修改排程週期"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                              </button>

                               {/* 啟用/暫停切換 */}
                              <button
                                disabled={!isUnlocked}
                                onClick={() => handleToggleEnabled(source)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                                  !isUnlocked
                                    ? 'text-gray-700 cursor-not-allowed'
                                    : source.enabled !== false
                                      ? 'text-emerald-400 hover:bg-emerald-500/10'
                                      : 'text-rose-400 hover:bg-rose-500/10'
                                }`}
                                title={source.enabled !== false ? '點擊暫停排程' : '點擊啟用排程'}
                              >
                                {source.enabled !== false ? '啟用' : '暫停'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredSources.length === 0 && (
                <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
                  <AlertCircle className="w-6 h-6 text-gray-600" />
                  <span>沒有符合條件的數據源項目</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3.3 分頁: 圖層控制 (面板顯示、圖層資料開關、主題色彩修改) */}
        {mainTab === 'layers' && (
          <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl flex flex-col space-y-4 p-5">
            {/* Header info & Reset All */}
            <div className="bg-sky-950/30 p-3.5 rounded-xl border border-sky-500/30 text-xs text-sky-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Sliders className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  管理員可在此自訂全域各圖層在左側控制面板之顯示/隱藏、直接開關底圖圖層資料，以及隨選調整圖層專屬主題顏色（包含控制按鈕、地圖圓點、色帶與彈出視窗）。
                </div>
              </div>
              {Object.keys(layerCustomColors).length > 0 && (
                <button
                  type="button"
                  onClick={handleResetAllLayerColors}
                  className="px-3 py-1.5 rounded-lg bg-[#232b3f] hover:bg-rose-950/60 hover:text-rose-300 border border-gray-700 text-gray-300 text-xs shrink-0 cursor-pointer transition-colors font-medium flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>還原所有預設色彩 ({Object.keys(layerCustomColors).length})</span>
                </button>
              )}
            </div>

            {/* Search and Category Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={layerSearchQuery}
                  onChange={(e) => setLayerSearchQuery(e.target.value)}
                  placeholder="搜尋圖層名稱、標識或分類..."
                  className="w-full bg-[#161a29] text-gray-200 text-xs pl-9 pr-4 py-2.5 rounded-xl border border-[#273047] focus:outline-none focus:border-sky-500 transition-colors"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-[#161a29] p-1 rounded-xl border border-[#2a334d] text-xs overflow-x-auto scrollbar-none">
                {['all', '交通', '道路', '民生', '安全', '公共事業', '地理', '環境'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setLayerCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 font-medium ${
                      layerCategoryFilter === cat ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-[#202738]'
                    }`}
                  >
                    {cat === 'all' ? '全部圖層' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Layers Table */}
            <div className="bg-[#161b2a] border border-[#273047] rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#1c2235] text-gray-400 border-b border-[#273047] text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4 font-semibold">圖層名稱 / 標識</th>
                      <th className="py-3 px-4 font-semibold">分類</th>
                      <th className="py-3 px-4 font-semibold text-center">面板顯示開關</th>
                      <th className="py-3 px-4 font-semibold text-center">底圖圖層資料</th>
                      <th className="py-3 px-4 font-semibold">主題色彩自訂 (按鈕/Popup/地圖圓點)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232b3f]">
                    {LAYER_CONTROLS_LIST.filter(l => {
                      if (layerCategoryFilter !== 'all' && l.category !== layerCategoryFilter) return false;
                      if (layerSearchQuery.trim()) {
                        const q = layerSearchQuery.trim().toLowerCase();
                        return l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || l.category.toLowerCase().includes(q);
                      }
                      return true;
                    }).map((layerItem) => {
                      const isHiddenInPanel = !!hiddenLayersInPanel[layerItem.id] || !!hiddenLayersInPanelState[layerItem.id];
                      const isDataDisabled = !!disabledLayers[layerItem.id];
                      const isDataActive = !isDataDisabled;
                      const currentColor = layerCustomColors[layerItem.id] || layerItem.defaultColor;
                      const isColorCustomized = !!layerCustomColors[layerItem.id] && layerCustomColors[layerItem.id] !== layerItem.defaultColor;

                      return (
                        <tr key={layerItem.id} className="hover:bg-[#1a2133] transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white flex items-center gap-2">
                              <span 
                                className="w-3 h-3 rounded-full inline-block shrink-0 shadow-sm border border-white/20"
                                style={{ backgroundColor: currentColor }}
                              />
                              <span className="text-[12.5px]">{layerItem.name}</span>
                            </div>
                            <div className="text-[10.5px] text-gray-500 font-mono mt-0.5">
                              {layerItem.id}
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-[#22293d] text-gray-300 border border-[#2f3954] font-medium">
                              {layerItem.category}
                            </span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleLayerVisibility(layerItem.id, layerItem.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                                !isHiddenInPanel
                                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-600/40 hover:bg-emerald-900/80 shadow-sm'
                                  : 'bg-rose-950/50 text-rose-300 border-rose-700/50 hover:bg-rose-900/70'
                              }`}
                              title={isHiddenInPanel ? '點擊在圖層控制面板中【顯示】' : '點擊在圖層控制面板中【隱藏】'}
                            >
                              {!isHiddenInPanel ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              <span>{!isHiddenInPanel ? '面板顯示' : '面板隱藏'}</span>
                            </button>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleLayerData(layerItem.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                                isDataActive
                                  ? 'bg-sky-950/70 text-sky-300 border-sky-600/50 hover:bg-sky-900/80 shadow-sm'
                                  : 'bg-rose-950/50 text-rose-300 border-rose-700/50 hover:bg-rose-900/70'
                              }`}
                              title={isDataActive ? '點擊關閉此圖層底層資料 (全域前台同步停用，使用者無法開啟)' : '點擊啟用此圖層底層資料 (全域前台恢復使用)'}
                            >
                              <span className={`w-2 h-2 rounded-full ${isDataActive ? 'bg-sky-400 animate-pulse' : 'bg-rose-400'}`} />
                              <span>{isDataActive ? '圖層啟用中' : '圖層已關閉'}</span>
                            </button>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <div className="flex items-center gap-1.5 bg-[#121622] px-2 py-1 rounded-lg border border-[#2a3449]">
                                <input
                                  type="color"
                                  value={currentColor}
                                  onChange={(e) => handleSetLayerColor(layerItem.id, e.target.value)}
                                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                                  title="點擊選擇任意顏色 (全域前台同步生效)"
                                />
                                <span className="font-mono text-[11px] text-gray-300 uppercase">
                                  {currentColor}
                                </span>
                              </div>

                              {/* 快速色盤 */}
                              <div className="flex items-center gap-1">
                                {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'].map((preset) => (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => handleSetLayerColor(layerItem.id, preset)}
                                    className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                                      currentColor.toLowerCase() === preset.toLowerCase()
                                        ? 'border-white scale-110 shadow-sm'
                                        : 'border-transparent opacity-70 hover:opacity-100'
                                    }`}
                                    style={{ backgroundColor: preset }}
                                    title={`套用 ${preset} (全域前台同步生效)`}
                                  />
                                ))}
                              </div>

                              {isColorCustomized && (
                                <button
                                  type="button"
                                  onClick={() => handleSetLayerColor(layerItem.id, layerItem.defaultColor)}
                                  className="text-[10.5px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20 cursor-pointer font-medium transition-colors"
                                  title={`恢復預設色彩 (${layerItem.defaultColor}) (全域前台同步生效)`}
                                >
                                  重設預設
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {LAYER_CONTROLS_LIST.filter(l => {
                if (layerCategoryFilter !== 'all' && l.category !== layerCategoryFilter) return false;
                if (layerSearchQuery.trim()) {
                  const q = layerSearchQuery.trim().toLowerCase();
                  return l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || l.category.toLowerCase().includes(q);
                }
                return true;
              }).length === 0 && (
                <div className="py-12 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
                  <AlertCircle className="w-6 h-6 text-gray-600" />
                  <span>沒有符合條件的圖層項目</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 11.4 分頁 2: 系統日誌 (統一整合系統運作、異常報錯、資料更新與排程記錄) */}
        {mainTab === 'system_logs' && (
          <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl flex flex-col">
            <div className="p-4 bg-[#191f2c] border-b border-[#283144] flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>系統運作與資料源更新日誌</span>
                </h3>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* 保留期限自定義設定 (自定義天數，不用下拉清單) */}
                <div className="flex items-center gap-1.5 text-xs text-gray-300 bg-[#121620] border border-[#2c374d] rounded-lg px-2.5 py-1">
                  <span className="text-gray-400 text-[11px] whitespace-nowrap">保留期限:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={9999}
                      value={systemRetentionInput}
                      onChange={(e) => setSystemRetentionInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseInt(systemRetentionInput, 10);
                        handleSystemRetentionChange(isNaN(parsed) ? 30 : parsed);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const parsed = parseInt(systemRetentionInput, 10);
                          handleSystemRetentionChange(isNaN(parsed) ? 30 : parsed);
                        }
                      }}
                      placeholder="天數"
                      className="w-14 bg-[#181d28] border border-[#3b475e] focus:border-sky-500 rounded px-1.5 py-0.5 text-xs text-sky-300 font-mono text-center outline-none"
                    />
                    <span className="text-gray-400 text-[11px]">天</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const parsed = parseInt(systemRetentionInput, 10);
                      handleSystemRetentionChange(isNaN(parsed) ? 30 : parsed);
                    }}
                    className="text-[10.5px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/30 font-medium transition-colors cursor-pointer"
                    title="儲存並套用保留天數"
                  >
                    套用
                  </button>
                </div>

                {/* 等級篩選 */}
                <div className="flex items-center gap-1 bg-[#10131d] border border-[#252a38] rounded-lg p-0.5">
                  {['all', 'INFO', 'WARNING', 'ERROR', 'SUCCESS'].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => {
                        setSystemLogLevelFilter(lvl);
                        setSystemLogPage(1);
                      }}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-semibold transition-colors cursor-pointer ${
                        systemLogLevelFilter === lvl
                          ? 'bg-sky-600 text-white'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {lvl === 'all' ? '全部' : lvl}
                    </button>
                  ))}
                </div>

                {/* 搜尋框 */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={systemLogSearch}
                    onChange={(e) => {
                      setSystemLogSearch(e.target.value);
                      setSystemLogPage(1);
                    }}
                    placeholder="搜尋檔案、動作、資料源或訊息..."
                    className="bg-[#10131a] text-xs text-gray-200 placeholder-gray-500 pl-8 pr-2.5 py-1 rounded-lg border border-[#283144] focus:outline-none focus:border-sky-500/60 w-36 sm:w-48"
                  />
                </div>

                {/* 重新整理 */}
                <button
                  type="button"
                  onClick={fetchSystemLogs}
                  disabled={loadingSystemLogs}
                  className="p-1.5 rounded-lg bg-[#1a2130] hover:bg-[#252f44] text-gray-300 border border-[#2b3548] cursor-pointer transition-colors"
                  title="重新整理日誌"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSystemLogs ? 'animate-spin text-sky-400' : ''}`} />
                </button>

                {/* 匯出 */}
                <button
                  type="button"
                  onClick={handleExportSystemLogs}
                  className="px-2.5 py-1.5 rounded-lg bg-[#1a2130] hover:bg-[#252f44] text-gray-300 border border-[#2b3548] text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  title="匯出日誌 JSON"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">匯出</span>
                </button>

                {/* 清空日誌 */}
                <button
                  type="button"
                  disabled={!isUnlocked || systemLogs.length === 0}
                  onClick={handleClearSystemLogs}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isUnlocked && systemLogs.length > 0
                      ? 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 cursor-pointer'
                      : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[72vh] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2c374d] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#3e4e6d]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#161c28] border-b border-[#283144] text-gray-300 font-semibold uppercase text-[10.5px] tracking-wider shadow-sm">
                    <th className="py-2.5 px-4 w-44">日期時間</th>
                    <th className="py-2.5 px-3 w-20 text-center">等級</th>
                    <th className="py-2.5 px-4 min-w-[220px]">執行的檔案</th>
                    <th className="py-2.5 px-3 w-36">動作 / 模組</th>
                    <th className="py-2.5 px-4">日誌內容與詳細訊息</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2535]">
                  {pagedSystemLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#19202e] transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-400 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('zh-HK', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex items-center gap-1.5 justify-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            log.level === 'ERROR'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : log.level === 'WARNING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : log.level === 'SUCCESS'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          }`}>
                            {log.level}
                          </span>
                          {log.repeat_count && log.repeat_count > 1 && (
                            <span
                              className="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              title={`智慧防抖已抑制重複寫入，此異常已連續發生 ${log.repeat_count} 次 (最後發生: ${log.last_seen || log.timestamp})`}
                            >
                              ×{log.repeat_count}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11.5px] text-indigo-300">
                        {log.file}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-800 text-gray-300 border border-gray-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-200 text-xs max-w-[500px]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="max-h-[110px] overflow-y-auto overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-300 bg-[#0b0e15] p-2 rounded-lg border border-[#202738] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700 hover:[&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">
                              {log.message}
                            </div>
                            {log.details && Object.keys(log.details).length > 0 && (
                              <div className="mt-1.5 max-h-[85px] overflow-y-auto overflow-x-auto font-mono text-[10px] text-gray-400 bg-[#0c0f16] px-2 py-1 rounded border border-[#1e2434] whitespace-pre-wrap [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                                {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyLogContent(log)}
                            className="p-1.5 rounded-md hover:bg-[#20283a] text-gray-400 hover:text-white transition-colors shrink-0 cursor-pointer border border-transparent hover:border-gray-700 mt-0.5"
                            title="複製此日誌完整內容"
                          >
                            {copiedLogId === log.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredSystemLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-500 text-xs">
                        尚無符合條件的系統日誌
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 2.1.2 系統日誌分頁控制列 */}
            <div className="p-3 bg-[#161c28] border-t border-[#283144] flex items-center justify-between flex-wrap gap-3 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <span>
                  顯示第 {filteredSystemLogs.length === 0 ? 0 : (systemLogPage - 1) * SYSTEM_LOG_PAGE_SIZE + 1} - {Math.min(systemLogPage * SYSTEM_LOG_PAGE_SIZE, filteredSystemLogs.length)} 筆，共 {filteredSystemLogs.length} 筆
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSystemLogPage((p) => Math.max(1, p - 1))}
                  disabled={systemLogPage <= 1}
                  className="px-2.5 py-1 rounded bg-[#1f2637] hover:bg-[#2b354d] text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  上一頁
                </button>
                <span className="px-2 font-mono text-gray-300">
                  {systemLogPage} / {totalSystemLogPages}
                </span>
                <button
                  type="button"
                  onClick={() => setSystemLogPage((p) => Math.min(totalSystemLogPages, p + 1))}
                  disabled={systemLogPage >= totalSystemLogPages}
                  className="px-2.5 py-1 rounded bg-[#1f2637] hover:bg-[#2b354d] text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  下一頁
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 分頁 3: 系統統計資料 (正式開始執行) */}
        {mainTab === 'analytics' && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-1 border-b border-[#232a3b]">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">全站造訪與系統流量統計</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetStats}
                  disabled={loadingResetStats}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="重設全站造訪次數紀錄"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${loadingResetStats ? 'animate-spin' : ''}`} />
                  <span>{loadingResetStats ? '重設中...' : '重設瀏覽紀錄'}</span>
                </button>
                <button
                  type="button"
                  onClick={fetchAnalyticsData}
                  className="px-3 py-1.5 rounded-lg bg-[#222a3b] hover:bg-[#2b354c] text-gray-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-[#343f58]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>刷新數據</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#141822] border border-[#232a3b] rounded-xl p-5 shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-gray-400">
                  <span className="text-xs font-medium">本日瀏覽次數</span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <Eye className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-white">{stats.today_page_views}</span>
                  <span className="text-xs text-gray-500 font-mono">(總計: {stats.total_page_views})</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[10.5px] text-emerald-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>實時統計運作中</span>
                </div>
              </div>

              <div className="bg-[#141822] border border-[#232a3b] rounded-xl p-5 shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-gray-400">
                  <span className="text-xs font-medium">目前在線人數</span>
                  <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-white">{stats.online_users}</span>
                  <span className="text-xs text-sky-400">位使用者在線</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[10.5px] text-sky-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                  <span>即時 WebSocket 連線數</span>
                </div>
              </div>

              <div className="bg-[#141822] border border-[#232a3b] rounded-xl p-5 shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-gray-400">
                  <span className="text-xs font-medium">問題回報數量</span>
                  <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-white">{issueReports.length}</span>
                  <span className="text-xs text-rose-400">件用戶反饋與建議</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[10.5px] text-rose-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
                  <span>已同步雲端反饋庫</span>
                </div>
              </div>
            </div>

            {/* 近期每日訪客瀏覽趨勢 */}
            {stats.daily_pv && Object.keys(stats.daily_pv).length > 0 && (
              <div className="bg-[#141822] border border-[#232a3b] rounded-xl p-5 shadow-xl flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#232a3b] pb-3">
                  <h4 className="text-xs font-bold text-gray-200 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    <span>近期每日瀏覽趨勢記錄</span>
                  </h4>
                  <span className="text-[10px] text-gray-500">每 30 秒自動更新並原子持久化</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-1">
                  {Object.entries(stats.daily_pv)
                    .sort((a, b) => b[0].localeCompare(a[0]))
                    .slice(0, 7)
                    .reverse()
                    .map(([day, pv]) => (
                      <div key={day} className="bg-[#0f131a] border border-[#232a3b] rounded-lg p-2.5 flex flex-col items-center justify-between text-center gap-1">
                        <span className="text-[10px] text-gray-400 font-mono">{day.slice(5)}</span>
                        <span className="text-base font-bold font-mono text-white">{pv}</span>
                        <span className="text-[9px] text-emerald-400">次瀏覽</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 分頁 4: 回報問題清單 (Issue Reports) */}
        {mainTab === 'issues' && (
          <div className="bg-[#141822] border border-[#232a3b] rounded-xl overflow-hidden shadow-xl flex flex-col animate-in fade-in duration-200">
            <div className="p-4 bg-[#191f2c] border-b border-[#283144] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>用戶回報問題與建議清單</span>
                  </h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* 狀態過濾按鈕 */}
                <div className="flex items-center bg-[#0d1017] p-1 rounded-lg border border-[#2e374c] gap-1 text-[11px]">
                  {(['all', 'pending', 'resolved', 'closed'] as const).map((st) => {
                    const labelMap = { all: '全部', pending: '待處理', resolved: '已完成', closed: '已關閉' };
                    const count = st === 'all' 
                      ? issueReports.length 
                      : issueReports.filter(r => (r.status || 'pending') === st).length;
                    const isActive = issueStatusFilter === st;
                    return (
                      <button
                        key={st}
                        onClick={() => setIssueStatusFilter(st)}
                        className={`px-2 py-0.5 rounded transition-all font-medium ${
                          isActive 
                            ? 'bg-[#222a3b] text-white shadow-sm font-semibold' 
                            : 'text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {labelMap[st]} ({count})
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={issueSearch}
                    onChange={(e) => setIssueSearch(e.target.value)}
                    placeholder="搜尋標題、內容或 Email..."
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0d1017] border border-[#2e374c] text-white text-xs placeholder:text-gray-500 focus:border-rose-400 outline-none w-44 sm:w-56"
                  />
                </div>
                <button
                  onClick={fetchAnalyticsData}
                  className="px-3 py-1.5 rounded-lg bg-[#222a3b] hover:bg-[#2b354c] text-gray-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-[#343f58]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin text-rose-400' : ''}`} />
                  <span>刷新</span>
                </button>
              </div>
            </div>

            {/* 問題清單 */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#161b26] border-b border-[#242b3b] text-gray-400 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-4 w-32">時間戳記</th>
                    <th className="py-2.5 px-3 w-24">處理狀態</th>
                    <th className="py-2.5 px-4 w-44">問題標題</th>
                    <th className="py-2.5 px-4">詳細內容與說明</th>
                    <th className="py-2.5 px-4 w-40">聯絡電郵</th>
                    <th className="py-2.5 px-2 w-16 text-center">附件</th>
                    <th className="py-2.5 px-4 w-56 text-center">處理操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2535]">
                  {issueReports
                    .filter((r) => {
                      const itemStatus = r.status || 'pending';
                      if (issueStatusFilter !== 'all' && itemStatus !== issueStatusFilter) {
                        return false;
                      }
                      if (!issueSearch.trim()) return true;
                      const q = issueSearch.toLowerCase();
                      return (
                        (r.title && r.title.toLowerCase().includes(q)) ||
                        (r.details && r.details.toLowerCase().includes(q)) ||
                        (r.contact_email && r.contact_email.toLowerCase().includes(q))
                      );
                    })
                    .map((item, idx) => {
                      const itemStatus = item.status || 'pending';
                      const reportId = item.id || item.timestamp || `report_${idx}`;
                      return (
                        <tr key={reportId} className="hover:bg-[#181d2a] transition-colors">
                          <td className="py-3 px-4 font-mono text-[11px] text-gray-400 whitespace-nowrap">
                            {item.timestamp ? new Date(item.timestamp).toLocaleString('zh-TW', { hour12: false }) : '即時回報'}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {itemStatus === 'resolved' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <Check className="w-2.5 h-2.5" /> 已完成
                              </span>
                            ) : itemStatus === 'closed' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                <Ban className="w-2.5 h-2.5" /> 已關閉
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                <Clock className="w-2.5 h-2.5" /> 待處理
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-bold text-gray-200">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                itemStatus === 'resolved' ? 'bg-emerald-500' :
                                itemStatus === 'closed' ? 'bg-gray-500' : 'bg-rose-500'
                              }`}></span>
                              <span>{item.title || '無標題'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-300 leading-relaxed max-w-md break-words whitespace-pre-wrap">
                            {item.details || '無描述內容'}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {isSafeEmail(item.contact_email) ? (
                              <a
                                href={`mailto:${encodeURIComponent(item.contact_email.trim())}?subject=${encodeURIComponent(`回覆：溫哥華上帝之眼 - ${item.title || '問題回報'}`)}`}
                                className="text-sky-400 hover:underline flex items-center gap-1"
                                title="點擊寄信回覆"
                              >
                                <span>{item.contact_email.trim()}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ) : item.contact_email ? (
                              <span className="text-gray-400">{String(item.contact_email)}</span>
                            ) : (
                              <span className="text-gray-500">未提供</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            {isSafeRasterDataUrl(item.image_base64) || item.has_attachment ? (
                              <button
                                type="button"
                                onClick={() => setPreviewModalImage(isSafeRasterDataUrl(item.image_base64) ? item.image_base64.trim() : null)}
                                disabled={!isSafeRasterDataUrl(item.image_base64)}
                                className={`px-2 py-0.5 rounded text-[10.5px] font-semibold transition-colors inline-flex items-center gap-1 ${
                                  isSafeRasterDataUrl(item.image_base64)
                                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer'
                                    : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-default'
                                }`}
                                title={isSafeRasterDataUrl(item.image_base64) ? '點擊檢視截圖' : '未附圖片或純標註'}
                              >
                                <Eye className="w-3 h-3" />
                                <span>{isSafeRasterDataUrl(item.image_base64) ? '檢視截圖' : '有截圖'}</span>
                              </button>
                            ) : (
                              <span className="text-gray-600">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-1">
                              {/* 完成按鈕 (解決問題或接受建議) */}
                              <button
                                onClick={() => handleUpdateIssueStatus(reportId, 'resolved')}
                                disabled={itemStatus === 'resolved'}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold transition-all cursor-pointer ${
                                  itemStatus === 'resolved'
                                    ? 'bg-emerald-500/10 text-emerald-500/40 border border-emerald-500/20 cursor-not-allowed'
                                    : 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 hover:shadow-sm'
                                }`}
                                title="解決問題或接受建議 (標記為已完成)"
                              >
                                <Check className="w-3 h-3 shrink-0" />
                                <span>完成</span>
                              </button>

                              {/* 關閉按鈕 (拒絕回報內容) */}
                              <button
                                onClick={() => handleUpdateIssueStatus(reportId, 'closed')}
                                disabled={itemStatus === 'closed'}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold transition-all cursor-pointer ${
                                  itemStatus === 'closed'
                                    ? 'bg-gray-700/20 text-gray-500 border border-gray-700/30 cursor-not-allowed'
                                    : 'bg-gray-600/20 hover:bg-gray-600/35 text-gray-300 border border-gray-500/40 hover:shadow-sm'
                                }`}
                                title="拒絕回報內容 (標記為已關閉)"
                              >
                                <Ban className="w-3 h-3 shrink-0" />
                                <span>關閉</span>
                              </button>

                              {/* 回覆按鈕 (若有提供電郵) */}
                              {isSafeEmail(item.contact_email) ? (
                                <a
                                  href={`mailto:${encodeURIComponent(item.contact_email.trim())}?subject=${encodeURIComponent(`回覆：溫哥華上帝之眼 - ${item.title || '問題回報'}`)}`}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-[10.5px] font-semibold transition-all hover:shadow-sm"
                                  title="寄信回覆用家"
                                >
                                  <Mail className="w-3 h-3 shrink-0" />
                                  <span>回覆</span>
                                </a>
                              ) : (
                                <span
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800/40 text-gray-600 border border-gray-700/30 text-[10.5px] font-medium cursor-not-allowed select-none"
                                  title="用家未提供聯絡電郵，無法寄信回覆"
                                >
                                  <Mail className="w-3 h-3 shrink-0" />
                                  <span>回覆</span>
                                </span>
                              )}

                              {/* 刪除按鈕 */}
                              <button
                                onClick={() => handleDeleteIssueReport(reportId)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10.5px] font-semibold transition-all cursor-pointer hover:shadow-sm ml-0.5"
                                title="徹底刪除此則回報記錄"
                              >
                                <Trash2 className="w-3 h-3 shrink-0" />
                                <span>刪除</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {issueReports.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-gray-500">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                        <p className="font-semibold text-gray-400">目前尚無任何問題回報記錄</p>
                        <p className="text-[11px] text-gray-600 mt-1">使用者在前端透過「回報問題」遞交後，將第一時間同步顯示於此。</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 分頁 5: 系統維護與還原 (Maintenance & Rollback) - 2欄1列並排佈局 */}
        {mainTab === 'maintenance' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start animate-in fade-in duration-200">
            {/* Card 1: 系統維護模式控制 */}
            <div className="bg-[#141822] border border-[#232a3b] rounded-xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#232a3b] gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-lg ${maintenanceEnabled ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    <Wrench className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-wide">
                      系統維護模式控制
                    </h2>
                    <p className="text-xs text-gray-400">
                      應付嚴重故障或架構升級時，暫時對一般訪客關閉地圖服務並導向維護頁面
                    </p>
                  </div>
                </div>
                <div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                    maintenanceEnabled 
                      ? 'bg-amber-950/80 text-amber-400 border border-amber-500/50' 
                      : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/50'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${maintenanceEnabled ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    {maintenanceEnabled ? '維護模式生效中' : '系統正常運作中'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-300">
                  訪客顯示之公告內容 (可自訂)：
                </label>
                <textarea
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  rows={3}
                  className="w-full bg-[#0d1017] border border-[#2a3246] rounded-lg p-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/70"
                  placeholder="輸入顯示於全螢幕維護頁面之公告訊息..."
                />
              </div>

              <div className="flex flex-wrap items-center justify-between pt-2 gap-2">
                <div className="text-[11px] text-gray-400">
                  {maintenanceUpdatedAt && `上次更新時間: ${maintenanceUpdatedAt}`}
                </div>
                <button
                  type="button"
                  onClick={handleToggleMaintenance}
                  disabled={isUpdatingMaintenance}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-md cursor-pointer flex items-center gap-2 ${
                    maintenanceEnabled
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  <Wrench className="w-4 h-4" />
                  <span>{maintenanceEnabled ? '關閉維護模式 (恢復對外服務)' : '立即開啟維護模式'}</span>
                </button>
              </div>
            </div>

            {/* Card 2: 生產環境緊急系統還原 (Emergency Rollback) */}
            <div className="bg-[#141822] border border-rose-900/50 rounded-xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-rose-900/40">
                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white tracking-wide">
                    緊急系統還原
                  </h2>
                  <p className="text-xs text-rose-300/80">
                    當部署後遇到重大問題或不可逆損壞時，可立即觸發 GitHub Actions 將生產伺服器還原至穩定版本
                  </p>
                </div>
              </div>

              <div className="bg-rose-950/30 border border-rose-800/40 rounded-lg p-3 text-xs text-rose-200 flex flex-col gap-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  注意事項：
                </div>
                <p className="text-[11.5px] leading-relaxed text-gray-300">
                  1. 預設目標 <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">PREV</code> 會自動將工作目錄 Reset 至上一筆 Git 提交 (HEAD~1)。
                  <br />
                  2. 可直接從下方清單選擇預設回溯級距或最近的 Commit 記錄，亦可自行輸入特定的 Git Commit SHA 或 Release Tag。
                  <br />
                  3. 觸發後 GitHub Actions Deploy 工作流將重新編譯前端與啟動容器，請預留 1-2 分鐘生效時間。
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-300">
                      選擇還原目標版本清單 (快速選取常用回退點或最近 Commit)：
                    </label>
                    <select
                      value={recentCommits.some(c => c.sha === rollbackTarget) ? rollbackTarget : 'CUSTOM'}
                      onChange={(e) => {
                        if (e.target.value !== 'CUSTOM') {
                          setRollbackTarget(e.target.value);
                        }
                      }}
                      className="w-full bg-[#0d1017] border border-[#2a3246] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-rose-500/70"
                    >
                      {recentCommits.map((c) => (
                        <option key={c.sha} value={c.sha}>
                          {c.title} {c.date ? `[${c.date}]` : ''}
                        </option>
                      ))}
                      <option value="CUSTOM">-- 手動自訂輸入 (Commit SHA 或 Tag) --</option>
                    </select>
                  </div>

                  <div className="sm:self-end">
                    <button
                      type="button"
                      onClick={handleTriggerRollback}
                      disabled={isTriggeringRollback}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold text-xs transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-4 h-4 ${isTriggeringRollback ? 'animate-spin' : ''}`} />
                      <span>{isTriggeringRollback ? '正在發送還原指令...' : '執行緊急版本還原'}</span>
                    </button>
                  </div>
                </div>

                {/* 9.2 還原目標詳細資訊卡片 (顯示 Commit 代碼、內容、作者與時間) */}
                {(() => {
                  const selectedCommit = recentCommits.find(c => c.sha === rollbackTarget);
                  if (!selectedCommit) return null;
                  return (
                    <div className="bg-[#0b0e14] border border-[#232b3c] rounded-lg p-3 text-xs flex flex-col gap-1.5 shadow-inner">
                      <div className="flex items-center justify-between text-gray-400 text-[11px]">
                        <span className="font-semibold text-rose-300 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                          已選版本代碼 (Commit SHA):
                        </span>
                        <span className="font-mono bg-rose-950/60 text-rose-300 border border-rose-800/50 px-1.5 py-0.5 rounded text-[10.5px]">
                          {selectedCommit.full_sha || selectedCommit.sha}
                        </span>
                      </div>
                      <div className="text-gray-200 font-medium text-xs leading-snug">
                        {selectedCommit.title}
                      </div>
                      {selectedCommit.message && selectedCommit.message !== selectedCommit.title && (
                        <div className="text-[11px] text-gray-400 font-mono bg-black/40 p-2 rounded border border-gray-800/80 whitespace-pre-wrap max-h-24 overflow-y-auto">
                          {selectedCommit.message}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10.5px] text-gray-500 pt-1 border-t border-gray-800/60">
                        <span>作者: {selectedCommit.author || 'Vancouver God\'s Eye'}</span>
                        <span>日期: {selectedCommit.date || '最近'}</span>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-400">
                    目前已選還原目標 (可手動修改)：
                  </label>
                  <input
                    type="text"
                    value={rollbackTarget}
                    onChange={(e) => setRollbackTarget(e.target.value)}
                    placeholder="PREV 或 Git SHA / Tag"
                    className="w-full bg-[#0d1017] border border-[#2a3246] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-rose-500/70"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* GitHub Token Setup Modal */}
      {isGithubModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#161a23] border border-[#2e374c] rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#242b3b]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">設定 GitHub Personal Access Token (PAT)</h3>
                  <p className="text-[11px] text-gray-400">用於一鍵喚醒 GitHub Actions 雲端工作流與動態 Commit 排程</p>
                </div>
              </div>
              <button 
                onClick={() => setIsGithubModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#0f1218] p-3.5 rounded-xl border border-[#252d3e] flex flex-col gap-2 text-[11px] text-gray-300">
              <span className="font-bold text-white flex items-center gap-1.5">
                <span>📖 如何取得 Token？（只需 1 分鐘）</span>
              </span>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 pl-1">
                <li>打開瀏覽器登入 GitHub，前往：<a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sky-400 underline font-mono">github.com/settings/tokens</a></li>
                <li>點擊「Generate new token」➔ 選擇「Generate new token (classic)」</li>
                <li>Note 填寫 <code className="text-sky-300 bg-black/40 px-1 py-0.5 rounded">GodsEye-Admin</code></li>
                <li>關鍵勾選兩項權限：<strong className="text-white">repo</strong>（完整儲存庫權限）與 <strong className="text-white">workflow</strong>（觸發工作流權限）</li>
                <li>點擊底部綠色按鈕「Generate token」，將生成的 <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">ghp_...</code> 複製貼在下方：</li>
              </ol>
            </div>

            <form onSubmit={handleSaveGithubToken} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-300 block mb-1">
                  貼上 GitHub Token (以 ghp_ 開頭)
                </label>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={inputGithubToken}
                  onChange={(e) => setInputGithubToken(e.target.value)}
                  className="w-full bg-[#0d1017] border border-[#2e374c] focus:border-sky-400 px-3 py-2 rounded-lg text-white font-mono text-xs outline-none"
                  required
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                <span>當前串接狀態：<strong className={githubStatus.configured ? 'text-emerald-400' : 'text-amber-400'}>{githubStatus.token_masked}</strong></span>
                <span>儲存庫：<strong className="text-gray-300 font-mono">{githubStatus.repo}</strong></span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#242b3b]">
                {isDev ? (
                  <button
                    type="button"
                    onClick={() => {
                      setGithubStatus({
                        configured: true,
                        repo: 'Ycf206/Vancouver-God-Eyes (開發環境模擬)',
                        token_masked: 'ghp_dev_mock_token_active'
                      });
                      setIsGithubModalOpen(false);
                      setSuccessMsg('開發環境：已啟用 GitHub 模擬串接！');
                      setTimeout(() => setSuccessMsg(null), 3500);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>開發環境免設定 (直接啟用)</span>
                  </button>
                ) : <div />}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsGithubModalOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f2635] text-xs font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingToken || !inputGithubToken.trim()}
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-md"
                  >
                    {isSavingToken ? '儲存中...' : '儲存 Token'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

            {/* PIN Unlock Modal */}
      {isUnlockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#161a23] border border-amber-500/40 rounded-2xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#242b3b]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">解鎖管理員操作</h3>
                  <p className="text-[11px] text-gray-400">輸入密碼以啟用排程編輯與即時同步</p>
                </div>
              </div>
              <button 
                onClick={() => { setIsUnlockModalOpen(false); setPinError(false); }}
                className="text-gray-400 hover:text-white p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUnlock} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-300 block mb-1">
                  請輸入管理員密碼
                </label>
                <input
                  type="password"
                  placeholder="輸入管理員驗證密碼"
                  value={pinInput}
                  autoFocus
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(false);
                    setPinErrorMsg(null);
                  }}
                  maxLength={128}
                  className={`w-full bg-[#0d1017] border ${pinError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-[#2e374c] focus:border-amber-400'} px-3 py-2 rounded-lg text-white font-mono text-center text-sm outline-none`}
                />
                {pinError && (
                  <p className="text-rose-400 text-[10px] mt-1 font-semibold text-center">{pinErrorMsg || '密碼錯誤，請重新輸入'}</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#242b3b]">
                {isDev ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        sessionStorage.setItem('gods_eye_admin_unlocked', 'true');
                      }
                      setIsUnlocked(true);
                      setIsUnlockModalOpen(false);
                      setPinError(false);
                      setGithubStatus({
                        configured: true,
                        repo: 'Ycf206/Vancouver-God-Eyes (開發環境模擬)',
                        token_masked: 'ghp_dev_mock_token_active'
                      });
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>開發環境免密解鎖</span>
                  </button>
                ) : <div />}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setIsUnlockModalOpen(false); setPinError(false); }}
                    className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f2635] text-xs font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!pinInput.trim()}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs transition-colors cursor-pointer shadow-md"
                  >
                    確認解鎖
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3.3 截圖預覽 Modal (嚴格限定安全點陣圖 Data URL) */}
      {previewModalImage && isSafeRasterDataUrl(previewModalImage) && (
        <div 
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewModalImage(null)}
        >
          <div 
            className="bg-[#141822] border border-[#232a3b] rounded-2xl p-4 max-w-4xl max-h-[92vh] flex flex-col shadow-2xl relative w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#232a3b]">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-400" />
                <span>用戶回報問題截圖 / 相片</span>
              </h4>
              <button
                type="button"
                onClick={() => setPreviewModalImage(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 overflow-auto flex-1 flex items-center justify-center bg-black/50 rounded-xl p-2 min-h-[300px]">
              <img 
                src={previewModalImage} 
                alt="問題截圖預覽" 
                className="max-h-[78vh] max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-4 border-t border-[#1c2230] text-center text-xs text-gray-500">
        Vancouver God&apos;s Eye Security Operations Center · 網址: admin.vangodseye.fyi · 密碼防護已啟用
      </footer>
    </div>
  );
}
