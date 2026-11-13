'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Search, Settings, ChevronDown, Map as MapIcon, X, Loader2, Layers, AlertCircle, Heart, Download, History, MoreHorizontal, Compass, Filter, Check, 
  Milestone, Store, Trees, Landmark, Droplets, Clock, Sparkles, Navigation,
  CircleDollarSign, Toilet, Fuel, EvCharger, Hospital, TrainFront, ParkingMeter, Package, Waves, Fence, Repeat, BusFront, Dam,
  Ship, ShipCargo, Plane, Truck, Route, TrainTrack, TrafficCone, LineSquiggle, UserRoundGroup, Palette, Soup, HeartHandshake, Park, TreePine,
  UserShield, FireExtinguisher, Zap, ZapOff, Earth, Grid3x2, Parasol, CableCar, Siren, GitCommitHorizontal,
  Anchor, Car, Bike, Motorbike, Scooter, Footprints, GraduationCap, BookOpen, Recycle, Trash2, Bed, HeartPulse, Flower2, LifeBuoy, Wifi, Lightbulb, MapPin,
  Camera, Megaphone, Ban, Accessibility, Gauge, Construction, Boxes
} from 'lucide-react';
import { useUIStore, SearchTarget, UIState } from '@/store/useUIStore';
import ReportIssueModal from '@/components/ReportIssueModal';
import DonateModal from '@/components/DonateModal';
import SettingsModal from '@/components/SettingsModal';
import ExplorePanel from '@/components/ExplorePanel';
import ExportModal from '@/components/ExportModal';
import ChangelogModal from '@/components/ChangelogModal';
import AuthModal from '@/components/AuthModal';
import { getApiUrl } from '@/utils/api';
import { formatClock, formatDateWithTimezone } from '@/utils/time';
import { BUS_EXCHANGES } from '@/data/busExchanges';

const RECENT_SEARCHES_KEY = 'vangodseye_recent_searches_v1';
const MAX_RECENT_SEARCHES = 6;

const SIMP_TRAD_PAIRS: Array<[string, string]> = [
  ['温', '溫'], ['华', '華'], ['银', '銀'], ['邮', '郵'], ['电', '電'], ['车', '車'],
  ['站', '站'], ['医', '醫'], ['馆', '館'], ['图', '圖'], ['书', '書'], ['学', '學'],
  ['园', '園'], ['场', '場'], ['厕', '廁'], ['卫', '衛'], ['间', '間'], ['机', '機'],
  ['飞', '飛'], ['轮', '輪'], ['码', '碼'], ['头', '頭'], ['铁', '鐵'], ['路', '路'],
  ['桥', '橋'], ['门', '門'], ['关', '關'], ['边', '邊'], ['单', '單'], ['饮', '飲'],
  ['环', '環'], ['艺', '藝'], ['术', '術'], ['区', '區'], ['号', '號'], ['线', '線'],
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightRegex(rawQuery: string): RegExp | null {
  const cleaned = rawQuery.trim().slice(0, 60);
  if (!cleaned) return null;
  const rawTokens = cleaned
    .split(/[\s,·/|\-&]+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (rawTokens.length === 0) return null;

  // Sort longer tokens first so longest match wins
  rawTokens.sort((a, b) => b.length - a.length);
  const patterns = rawTokens.map(tok => {
    let pat = '';
    for (const ch of tok) {
      const pair = SIMP_TRAD_PAIRS.find(([s, t]) => s === ch || t === ch);
      if (pair) {
        pat += `[${escapeRegExp(pair[0])}${escapeRegExp(pair[1])}]`;
      } else {
        pat += escapeRegExp(ch);
      }
    }
    return pat;
  });

  try {
    return new RegExp(`(${patterns.join('|')})`, 'gi');
  } catch {
    return null;
  }
}

function HighlightMatch({ text, query, subtle = false }: { text: string; query: string; subtle?: boolean }) {
  const regex = useMemo(() => buildHighlightRegex(query), [query]);
  if (!regex || !text) return <>{text}</>;
  const parts = text.split(regex);
  if (parts.length <= 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className={
              subtle
                ? 'bg-emerald-500/20 text-emerald-300 rounded-xs px-0.5 not-italic'
                : 'bg-emerald-500/25 text-emerald-200 rounded-xs px-0.5 font-bold not-italic'
            }
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const QUICK_SEARCH_SHORTCUTS = [
  { label: '銀行', query: '銀行', icon: CircleDollarSign, color: 'text-amber-400' },
  { label: '洗手間', query: '公共洗手間', icon: Toilet, color: 'text-cyan-400' },
  { label: '油站', query: '油站', icon: Fuel, color: 'text-amber-400' },
  { label: '充電站', query: '充電站', icon: EvCharger, color: 'text-emerald-400' },
  { label: '醫院', query: '醫院', icon: Hospital, color: 'text-emerald-400' },
  { label: '天車站', query: '天車站', icon: TrainFront, color: 'text-blue-400' },
  { label: '停車場', query: '停車場', icon: ParkingMeter, color: 'text-[#3b82f6]' },
  { label: '郵寄快遞', query: '郵寄', icon: Package, color: 'text-red-400' },
  { label: '潮汐站', query: '潮汐', icon: Waves, color: 'text-sky-400' },
  { label: '邊境關卡', query: '邊境', icon: Fence, color: 'text-emerald-400' },
];

type QuickGroupTab = 'all' | 'poi' | 'transit' | 'road' | 'area';

function inferUiGroup(item: SearchTarget): Exclude<QuickGroupTab, 'all'> {
  if (item.ui_group) return item.ui_group;
  const c = item.category;
  if (['skytrain', 'seabus', 'bus_route', 'bus_stop', 'bus_exchange', 'ferry_terminal', 'ferry_vehicle', 'airports', 'maritime_vessel', 'marine_terminals', 'railways'].includes(c)) {
    return 'transit';
  }
  if (['address', 'coordinate', 'local_area_boundary', 'postal_code_fsa', 'zoning_districts', 'garbage_collection', 'crime_areas'].includes(c)) {
    return 'area';
  }
  if (['impark', 'accessible_parking', 'motorcycle_parking', 'parking_meters', 'traffic_cameras', 'safety_cameras', 'traffic_conditions', 'traffic_alerts', 'road_closures', 'road_construction', 'snow_removal_routes', 'one_way_streets', 'traffic_speed_limits', 'truck_routes', 'truck_routes_restriction', 'turn_restrictions', 'traffic_signals', 'traffic_crosswalks'].includes(c)) {
    return 'road';
  }
  return 'poi';
}

function renderSearchItemIcon(item: SearchTarget) {
  const c: string = item.category ? String(item.category) : '';
  const lk: string = item.layer_key ? String(item.layer_key) : '';
  const cls = "w-4 h-4 shrink-0";
  
  if (c === 'bus' || c === 'bus_vehicle' || lk === 'bus') return <BusFront className={`${cls} text-emerald-400`} />;
  if (c === 'bus_route') return <Route className={`${cls} text-emerald-400`} />;
  if (c === 'bus_stop' || lk === 'busStops') return <GitCommitHorizontal className={`${cls} text-emerald-400`} />;
  if (c === 'bus_exchange' || lk === 'busExchanges') return <Repeat className={`${cls} text-emerald-400`} />;
  if (c === 'skytrain' || c === 'skytrain_station' || c === 'skytrain_train' || lk === 'skytrain' || lk === 'skytrainStations') return <TrainFront className={`${cls} text-sky-400`} />;
  if (c === 'seabus' || lk === 'seabus' || c === 'ferry_vehicle' || lk === 'bcferriesVehicles') return <Ship className={`${cls} text-sky-400`} />;
  if (c === 'ferry_terminal' || lk === 'bcferriesRoutes') return <Anchor className={`${cls} text-sky-400`} />;
  if (c === 'maritime_vessel' || lk === 'maritimeShipping') return <ShipCargo className={`${cls} text-cyan-400`} />;
  if (c === 'marine_terminals' || lk === 'marineTerminals') return <Anchor className={`${cls} text-cyan-500`} />;
  if (c === 'airports' || lk === 'airports') return <Plane className={`${cls} text-indigo-400`} />;
  if (c === 'parking_meters' || lk === 'parkingMeters') return <ParkingMeter className={`${cls} text-blue-400`} />;
  if (c === 'impark' || lk === 'impark') return <ParkingMeter className={`${cls} text-blue-500`} />;
  if (c === 'motorcycle_parking' || lk === 'motorcycleParking') return <Motorbike className={`${cls} text-blue-400`} />;
  if (c === 'accessible_parking' || lk === 'accessibleParking') return <Accessibility className={`${cls} text-sky-400`} />;
  if (c === 'one_way_streets' || lk === 'oneWayStreets') return <Milestone className={`${cls} text-slate-300`} />;
  if (c === 'traffic_speed_limits' || lk === 'trafficSpeedLimits') return <Gauge className={`${cls} text-amber-400`} />;
  if (c === 'traffic_crosswalks' || lk === 'trafficCrosswalks') return <Footprints className={`${cls} text-amber-200`} />;
  if (c === 'car_sharing' || lk === 'carSharing') return <Car className={`${cls} text-sky-400`} />;
  if (c === 'bikeways' || lk === 'bikeways') return <Route className={`${cls} text-teal-400`} />;
  if (c === 'shared_bikes' || lk === 'sharedBikes' || c === 'bike_racks' || lk === 'bikeRacks') return <Bike className={`${cls} text-teal-400`} />;
  if (c === 'escooter' || lk === 'escooter') return <Scooter className={`${cls} text-lime-400`} />;
  if (c === 'ev_charging' || lk === 'evCharging' || c === 'tesla' || lk === 'tesla') return <EvCharger className={`${cls} text-emerald-400`} />;
  if (c === 'truck_routes' || c === 'truck_routes_restriction' || lk === 'truckRoutes') return <Truck className={`${cls} text-sky-400`} />;
  if (c === 'railways' || lk === 'railways') return <TrainTrack className={`${cls} text-indigo-400`} />;
  if (c === 'road_closures' || lk === 'roadClosures') return <Ban className={`${cls} text-rose-400`} />;
  if (c === 'road_construction' || lk === 'roadConstruction') return <TrafficCone className={`${cls} text-orange-400`} />;
  if (c === 'traffic_cameras' || lk === 'trafficCameras') return <Camera className={`${cls} text-sky-400`} />;
  if (c === 'safety_cameras' || lk === 'safetyCameras') return <Siren className={`${cls} text-rose-500`} />;
  if (c === 'traffic_conditions' || lk === 'trafficConditions') return <LineSquiggle className={`${cls} text-emerald-400`} />;
  if (c === 'traffic_alerts' || lk === 'trafficAlerts') return <Megaphone className={`${cls} text-amber-400`} />;
  if (c === 'drivebc' || lk === 'driveBC') return <Construction className={`${cls} text-amber-500`} />;
  if (c === 'fuel' || lk === 'fuel') return <Fuel className={`${cls} text-amber-400`} />;
  if (c === 'community_centres' || lk === 'communityCentres') return <UserRoundGroup className={`${cls} text-violet-400`} />;
  if (c === 'libraries' || lk === 'libraries') return <BookOpen className={`${cls} text-amber-400`} />;
  if (c === 'schools' || lk === 'schools') return <GraduationCap className={`${cls} text-blue-400`} />;
  if (c === 'canada_post' || c === 'fedex' || c === 'purolator' || lk === 'canadaPost') return <Package className={`${cls} text-rose-400`} />;
  if (c === 'banks' || c === 'atm' || lk === 'banks') return <CircleDollarSign className={`${cls} text-amber-400`} />;
  if (c === 'public_art' || lk === 'publicArt') return <Palette className={`${cls} text-fuchsia-400`} />;
  if (c === 'museums' || lk === 'museums') return <Landmark className={`${cls} text-slate-300`} />;
  if (c === 'food_vendors' || lk === 'foodVendors') return <Soup className={`${cls} text-orange-400`} />;
  if (c === 'food_banks' || lk === 'foodBanks') return <HeartHandshake className={`${cls} text-emerald-400`} />;
  if (c === 'recycling' || lk === 'recycling') return <Recycle className={`${cls} text-teal-400`} />;
  if (c === 'garbage_collection' || lk === 'garbageCollection') return <Truck className={`${cls} text-orange-400`} />;
  if (c === 'litter_containers' || lk === 'litterContainers') return <Trash2 className={`${cls} text-amber-400`} />;
  if (c === 'homeless_shelters' || lk === 'homelessShelters') return <Bed className={`${cls} text-rose-400`} />;
  if (c === 'parks' || lk === 'parks') return <Trees className={`${cls} text-emerald-400`} />;
  if (c === 'parks_facilities' || lk === 'parksFacilities') return <Park className={`${cls} text-teal-400`} />;
  if (c === 'public_trees' || c === 'street_trees' || c === 'heritage_trees' || lk === 'publicTrees') return <TreePine className={`${cls} text-emerald-400`} />;
  if (c === 'drinking_fountains' || lk === 'drinkingFountains') return <Droplets className={`${cls} text-sky-400`} />;
  if (c === 'public_washrooms' || lk === 'publicWashrooms') return <Toilet className={`${cls} text-cyan-400`} />;
  if (c === 'police' || lk === 'police') return <UserShield className={`${cls} text-blue-400`} />;
  if (c === 'fire_halls' || lk === 'fireHalls') return <FireExtinguisher className={`${cls} text-rose-400`} />;
  if (c === 'hospitals' || lk === 'hospitals') return <Hospital className={`${cls} text-emerald-400`} />;
  if (c === 'disaster_hubs' || lk === 'disasterHubs') return <LifeBuoy className={`${cls} text-amber-400`} />;
  if (c === 'van_wifi' || lk === 'vanWifi') return <Wifi className={`${cls} text-cyan-400`} />;
  if (c === 'power_outages' || c === 'power_outage' || lk === 'powerOutages') return <ZapOff className={`${cls} text-amber-400`} />;
  if (c === 'local_area_boundary' || lk === 'localAreaBoundary') return <Grid3x2 className={`${cls} text-teal-400`} />;
  if (c === 'beach_water_quality' || lk === 'beachWaterQuality') return <Parasol className={`${cls} text-teal-300`} />;
  if (c === 'border_crossing' || lk === 'borderCrossing') return <Fence className={`${cls} text-cyan-400`} />;
  if (c === 'ski_resort' || lk === 'skiResorts') return <CableCar className={`${cls} text-sky-400`} />;
  if (c === 'tide_stations' || lk === 'tideStations') return <Dam className={`${cls} text-teal-400`} />;
  if (c === 'aed' || lk === 'aed') return <HeartPulse className={`${cls} text-rose-400`} />;
  if (c === 'community_gardens' || lk === 'communityGardens') return <Flower2 className={`${cls} text-lime-400`} />;
  if (c === 'fire_hydrants' || lk === 'fireHydrants') return <FireExtinguisher className={`${cls} text-rose-500`} />;
  if (c === 'snow_removal_routes' || lk === 'snowRemovalRoutes') return <LineSquiggle className={`${cls} text-sky-400`} />;
  if (c === 'turn_restrictions' || lk === 'turnRestrictions') return <Ban className={`${cls} text-rose-500`} />;
  if (c === 'traffic_signals' || lk === 'trafficSignals') return <TrafficCone className={`${cls} text-amber-400`} />;
  if (c === 'crime_areas' || lk === 'crimeAreas') return <UserShield className={`${cls} text-rose-400`} />;
  if (c === 'zoning_districts' || lk === 'zoningDistricts') return <Grid3x2 className={`${cls} text-purple-400`} />;
  if (c === 'postal_code_fsa' || lk === 'postalCodeFSA') return <Milestone className={`${cls} text-indigo-400`} />;
  return <MapPin className={`${cls} text-emerald-400`} />;
}

export default function TopBar() {
  const { 
    setSearchTarget, 
    enableLayer, 
    disableLayer,
    layers,
    userLocation,
    distanceUnit,
    autoEnabledSearchLayer,
    setAutoEnabledSearchLayer,
    isLayerPanelOpen, 
    toggleLayerPanel,
    isExploreOpen,
    toggleExplore,
    timeFormat,
    timeZone,
    setSettingsModalOpen,
    isExportModalOpen,
    setExportModalOpen
  } = useUIStore();
  const [time, setTime] = useState<Date | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isDonateModalOpen, setIsDonateModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // 搜尋圖層篩選類別定義 (根據圖層控制面板 7 大類別分類，全採用 SVG 圖示)
  const SEARCH_CATEGORY_FILTERS = [
    {
      id: 'transport',
      label: '交通',
      icon: BusFront,
      iconColor: 'text-emerald-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'bus', 'busRoutes', 'busStops', 'busExchanges', 'skytrainTrains', 'skytrainRoutes', 'skytrainStops',
          'seabusVehicles', 'seabusRoutes', 'seabusStops', 'bcferriesVehicles', 'bcferriesRoutes',
          'bcferriesTerminals', 'maritimeShipping', 'marineTerminals', 'airports', 'railways'
        ];
        const targetCats = [
          'bus_route', 'bus_stop', 'bus_exchange', 'skytrain', 'seabus', 'bcferries', 'ferry_terminal',
          'ferry_vehicle', 'transit', 'airports', 'marine_terminals', 'maritimeShipping', 'flights', 'maritime_vessel', 'railways'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'road',
      label: '道路',
      icon: Milestone,
      iconColor: 'text-amber-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'parkingMeters', 'impark', 'motorcycleParking', 'accessibleParking',
          'oneWayStreets', 'trafficSpeedLimits', 'trafficCrosswalks', 'carSharing',
          'bikeways', 'bikeRacks', 'sharedBikes', 'escooter', 'trafficSignals',
          'turnRestrictions', 'evCharging', 'tesla', 'truckRoutes', 'roadClosures',
          'roadConstruction', 'trafficCameras', 'safetyCameras', 'fuel',
          'trafficConditions', 'snowRemovalRoutes', 'trafficAlerts', 'driveBC'
        ];
        const targetCats = [
          'parking_meters', 'impark', 'motorcycle_parking', 'accessible_parking',
          'one_way_streets', 'traffic_speed_limits', 'traffic_crosswalks', 'car_sharing',
          'bikeways', 'bike_racks', 'shared_bikes', 'escooter', 'traffic_signals',
          'turn_restrictions', 'traffic_turn_restrictions', 'ev_charging', 'tesla',
          'truck_routes', 'truck_routes_restriction', 'road_closures',
          'road_construction', 'traffic_cameras', 'safety_cameras', 'fuel',
          'traffic_conditions', 'snow_removal_routes', 'traffic_incident', 'trafficAlerts', 'drivebc'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'lifestyle',
      label: '生活',
      icon: Store,
      iconColor: 'text-purple-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'schools', 'libraries', 'communityCentres', 'banks', 'atm', 'aed', 'canadaPost',
          'publicArt', 'museums', 'foodVendors', 'foodBanks', 'recycling',
          'garbageCollection', 'litterContainers', 'homelessShelters'
        ];
        const targetCats = [
          'schools', 'libraries', 'community_centres', 'banks', 'atm', 'aed', 'canada_post', 'fedex', 'purolator',
          'post_offices', 'public_art', 'museums', 'food_vendors', 'food_banks',
          'recycling', 'garbage_collection', 'litter_containers', 'homeless_shelters'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'nature',
      label: '自然',
      icon: Trees,
      iconColor: 'text-emerald-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'parks', 'parksFacilities', 'communityGardens', 'publicTrees',
          'drinkingFountains', 'publicWashrooms', 'skiResorts', 'beachWaterQuality'
        ];
        const targetCats = [
          'parks', 'parks_facilities', 'community_gardens', 'public_trees',
          'drinking_fountains', 'public_washrooms', 'ski_resort', 'beach_water_quality'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'government',
      label: '政府',
      icon: Landmark,
      iconColor: 'text-blue-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'police', 'crimeAreas', 'fireHalls', 'fireHydrants', 'hospitals',
          'disasterHubs', 'vanWifi', 'borderCrossings'
        ];
        const targetCats = [
          'police', 'crime_areas', 'fire_halls', 'fire_hydrants', 'hospitals',
          'disaster_hubs', 'van_wifi', 'border_crossing'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'utilities',
      label: '公共事業',
      icon: ZapOff,
      iconColor: 'text-amber-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = ['powerOutages'];
        const targetCats = ['power_outages', 'power_outage', 'bchydro_outages'];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    },
    {
      id: 'geography',
      label: '地理',
      icon: Compass,
      iconColor: 'text-teal-400',
      matcher: (item: SearchTarget) => {
        const targetKeys = [
          'localAreaBoundary', 'postalCodeFSA', 'zoningDistricts', 'beachWaterQuality', 'contours', 'tides'
        ];
        const targetCats = [
          'local_area_boundary', 'postal_code_fsa', 'zoning_districts', 'beach_water_quality', 'contours', 'tide_stations', 'address', 'coordinate'
        ];
        return (item.layer_key && targetKeys.includes(item.layer_key as string)) ||
          targetCats.includes(item.category) ||
          targetKeys.some(k => item.id?.startsWith(k));
      }
    }
  ];

  // 搜尋狀態
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchTarget[]>([]);
  const [displayLimit, setDisplayLimit] = useState(40);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [selectedFilterCategoryIds, setSelectedFilterCategoryIds] = useState<string[]>([]);
  const [quickGroup, setQuickGroup] = useState<QuickGroupTab>('all');
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [recentSearches, setRecentSearches] = useState<SearchTarget[]>([]);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const searchCacheRef = useRef<Map<string, SearchTarget[]>>(new Map());
  const lastServerResultsRef = useRef<SearchTarget[]>([]);

  // 讀取最近搜尋紀錄
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, 8));
        }
      }
    } catch (e) {
      // ignore localStorage errors
    }
  }, []);

  const saveRecentSearch = useCallback((target: SearchTarget) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(x => x.id !== target.id);
      const updated = [target, ...filtered].slice(0, 8);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
      return updated;
    });
  }, []);

  const removeRecentSearch = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(x => x.id !== id);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (e) {
      // ignore
    }
  }, []);

  // 全域鍵盤快捷鍵 '/' 快速聚焦搜尋欄
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        const isEditable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || isEditable) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 依選取的圖層面板 7 大類別過濾
  const layerFilteredResults = useMemo(() => {
    if (selectedFilterCategoryIds.length === 0) return results;
    return results.filter(item => {
      return selectedFilterCategoryIds.some(catId => {
        const f = SEARCH_CATEGORY_FILTERS.find(x => x.id === catId);
        return f ? f.matcher(item) : false;
      });
    });
  }, [results, selectedFilterCategoryIds]);

  // 計算快捷分組數量 (全部 / 設施地標 / 交通航運 / 道路車位 / 地址區域)
  const groupCounts = useMemo(() => {
    const counts = { all: layerFilteredResults.length, poi: 0, transit: 0, road: 0, area: 0 };
    for (const item of layerFilteredResults) {
      const g = inferUiGroup(item);
      if (counts[g] !== undefined) counts[g]++;
    }
    return counts;
  }, [layerFilteredResults]);

  // 再依上方快捷分組切換過濾
  const filteredResults = useMemo(() => {
    if (quickGroup === 'all') return layerFilteredResults;
    return layerFilteredResults.filter(item => inferUiGroup(item) === quickGroup);
  }, [layerFilteredResults, quickGroup]);

  // 重置鍵盤游標至首項
  useEffect(() => {
    setActiveIndex(-1);
  }, [filteredResults, quickGroup]);

  // 鍵盤移動時自動滾動至可見區域
  useEffect(() => {
    if (activeIndex >= 0 && listContainerRef.current) {
      const activeEl = listContainerRef.current.querySelector(`[data-search-idx="${activeIndex}"]`);
      if (activeEl) {
        (activeEl as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  // 距離格式化輔助函數
  const formatDistance = useCallback((km?: number) => {
    if (km === undefined || km === null || Number.isNaN(km)) return null;
    if (distanceUnit === 'imperial') {
      const miles = km * 0.621371;
      if (miles < 0.1) {
        return `${Math.round(miles * 5280)} ft`;
      }
      return `${miles.toFixed(1)} mi`;
    }
    if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
  }, [distanceUnit]);

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 點擊外部關閉選單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFilterPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 搜尋防抖 (Debounce 75ms) + 坐標關聯排序 + 0ms 即時快顯
  useEffect(() => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    // 取得當前地圖中心或使用者位置坐標作為參考點
    const mapCenter = (window as any).__godsEyeMapCenter as { lat?: number; lon?: number } | undefined;
    const refLat = userLocation?.lat ?? mapCenter?.lat ?? 49.2827;
    const refLon = userLocation?.lon ?? mapCenter?.lon ?? -123.1207;
    const cacheKey = `${trimmed.toLowerCase()}|${refLat.toFixed(3)}|${refLon.toFixed(3)}`;

    const qLower = trimmed.toLowerCase();
    const matchedExchanges: SearchTarget[] = BUS_EXCHANGES.filter(exc => 
      exc.name.toLowerCase().includes(qLower) || 
      exc.name_en.toLowerCase().includes(qLower) || 
      exc.location.toLowerCase().includes(qLower) ||
      exc.routes.some(r => r.toLowerCase() === qLower || `巴士 ${r}`.toLowerCase().includes(qLower)) ||
      (qLower.includes('轉乘') || qLower.includes('轉車') || qLower.includes('exchange') || qLower.includes('loop'))
    ).map(exc => ({
      id: `bus_exchange_${exc.id}`,
      title: `${exc.name_en} (${exc.name})`,
      subtitle: `巴士轉乘站 · ${exc.location} · 路線: ${exc.routes.join(', ')}`,
      category: 'bus_exchange',
      badge: '巴士轉乘站',
      icon: '',
      lon: exc.lon,
      lat: exc.lat,
      zoom: 17,
      layer_key: 'busExchanges',
      ui_group: 'transit',
      meta: { exchange_id: exc.id }
    }));

    // 0ms 快取命中：已搜尋過的字詞立即呈現建議清單
    if (searchCacheRef.current.has(cacheKey)) {
      const cached = searchCacheRef.current.get(cacheKey)!;
      const seenIds = new Set(matchedExchanges.map(m => m.id));
      const mergedCached = [...matchedExchanges, ...cached.filter(item => !seenIds.has(item.id))];
      setResults(mergedCached);
      lastServerResultsRef.current = cached;
      setDisplayLimit(40);
      setIsLoading(false);
      setIsOpen(true);
      return;
    }

    // 0ms 樂觀本機快顯：若前次結果非空，先依子字串即時縮減以提供無縫輸入體驗
    if (lastServerResultsRef.current.length > 0 || matchedExchanges.length > 0) {
      const optimistic = lastServerResultsRef.current.filter(item => 
        item.title.toLowerCase().includes(qLower) || 
        (item.subtitle && item.subtitle.toLowerCase().includes(qLower)) ||
        (item.badge && item.badge.toLowerCase().includes(qLower))
      );
      const seenIds = new Set(matchedExchanges.map(m => m.id));
      setResults([...matchedExchanges, ...optimistic.filter(item => !seenIds.has(item.id))]);
    }

    setIsLoading(true);
    const apiUrl = getApiUrl();
    const controller = new AbortController();
    
    // 超快速 Debounce (75ms) 搭配 AbortController 避免慢速競態
    const handler = setTimeout(() => {
      const url = `${apiUrl}/api/search?q=${encodeURIComponent(trimmed)}&lat=${refLat.toFixed(6)}&lon=${refLon.toFixed(6)}&limit=80`;
      fetch(url, { signal: controller.signal })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          const list: SearchTarget[] = Array.isArray(data) ? data : (data?.results || []);
          // 保留最多 100 筆 LRU 快取
          if (searchCacheRef.current.size > 100) {
            const firstKey = searchCacheRef.current.keys().next().value;
            if (firstKey) searchCacheRef.current.delete(firstKey);
          }
          searchCacheRef.current.set(cacheKey, list);
          lastServerResultsRef.current = list;
          const seenIds = new Set(matchedExchanges.map(m => m.id));
          const mergedList = [...matchedExchanges, ...list.filter(item => !seenIds.has(item.id))];
          setResults(mergedList);
          setDisplayLimit(40);
          setIsLoading(false);
          setIsOpen(true);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          console.error('Search error:', err);
          setIsLoading(false);
        });
    }, 75);

    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [query, userLocation?.lat, userLocation?.lon]);

  const handleSelect = (target: SearchTarget) => {
    isSelectingRef.current = true;
    saveRecentSearch(target);

    // 巴士路線為獨立搜尋展示，不自動開啟全域靜態巴士路線圖層
    if (target.layer_key && target.category !== 'bus_route') {
      const lk = target.layer_key as keyof UIState['layers'];
      // 若原圖層未開啟，記錄之以便清除搜尋列時自動還原為關閉狀態
      if (lk && !layers[lk]) {
        setAutoEnabledSearchLayer(lk);
        enableLayer(lk);
      } else {
        setAutoEnabledSearchLayer(null);
      }
    } else {
      setAutoEnabledSearchLayer(null);
    }
    setSearchTarget(target);
    setQuery(target.title);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setActiveIndex(-1);
    setSearchTarget(null);
    if ((window as any).__godsEyeDismissPopup) {
      (window as any).__godsEyeDismissPopup();
    }
    if (autoEnabledSearchLayer) {
      disableLayer(autoEnabledSearchLayer);
      setAutoEnabledSearchLayer(null);
    }
  };

  const formatTime = (date: Date) => {
    return formatClock(date, timeFormat, timeZone);
  };

  const formatDate = (date: Date) => {
    return formatDateWithTimezone(date, timeZone);
  };

  return (
    <div className="fixed top-0 left-0 w-full h-[60px] bg-[#1a1b1e] border-b border-[#2d2e32] flex items-center px-4 z-50 text-white shadow-lg">
      
      {/* 標誌區域 (電腦版與手機版統一使用清晰 Icon 圖示) */}
      <div className="flex items-center justify-center mr-2.5 sm:mr-3.5 select-none shrink-0">
        <img
          src="/logo-mobile.jpg?v=20261109"
          alt="溫哥華上帝之眼"
          className="h-8 w-8 sm:h-10 sm:w-10 object-cover rounded-lg select-none shadow-sm border border-emerald-500/20"
        />
      </div>

      {/* 圖層控制切換按鈕 (樣式跟隨右上角設定按鈕：預設圖示，hover展開文字；開啟為綠色，關閉為灰色) */}
      <button 
        onClick={toggleLayerPanel}
        className={`flex items-center justify-center group h-9 px-2.5 border rounded-md transition-all shadow-sm text-xs font-semibold select-none mr-1 shrink-0 ${
          isLayerPanelOpen 
            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]' 
            : 'bg-[#25262b] hover:bg-[#2c2d33] border-[#373a40] text-gray-300 hover:text-emerald-400 hover:border-emerald-500/50'
        }`}
        title={isLayerPanelOpen ? '收合左側圖層面板' : '展開左側圖層面板'}
      >
        <Layers className={`w-4 h-4 ${isLayerPanelOpen ? 'text-emerald-400' : 'text-gray-400 group-hover:text-emerald-400'} group-hover:scale-110 transition-transform shrink-0`} />
        <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
          圖層
        </span>
      </button>

      {/* 探索功能切換按鈕 (樣式跟隨右上角設定按鈕：預設圖示，hover展開文字；開啟為綠色，關閉為灰色) */}
      <button 
        onClick={toggleExplore}
        className={`flex items-center justify-center group h-9 px-2.5 border rounded-md transition-all shadow-sm text-xs font-semibold select-none mr-1 shrink-0 ${
          isExploreOpen 
            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]' 
            : 'bg-[#25262b] hover:bg-[#2c2d33] border-[#373a40] text-gray-300 hover:text-emerald-400 hover:border-emerald-500/50'
        }`}
        title={isExploreOpen ? '收合探索面板' : '展開探索面板'}
      >
        <Compass className={`w-4 h-4 ${isExploreOpen ? 'text-emerald-400' : 'text-gray-400 group-hover:text-emerald-400'} group-hover:scale-110 transition-transform shrink-0`} />
        <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
          探索
        </span>
      </button>

      <div className="hidden sm:block h-8 w-px bg-gray-700/60 mx-2"></div>

      {/* 時間與狀態 */}
      <div className="hidden md:flex flex-col justify-center mx-1.5 shrink-0">
        {time ? (
          <>
            <span className="text-[21px] font-mono font-medium leading-none mb-1 tracking-wider text-gray-100">
              {formatTime(time)}
            </span>
            <span className="text-[10px] text-emerald-500 font-medium leading-none flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]"></span>
              {formatDate(time)}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-500">載入中...</span>
        )}
      </div>

      {/* 區域選擇 (緊貼左方日期時間，已鎖定為溫哥華，禁止點擊) */}
      <div 
        className="hidden sm:flex items-center gap-1.5 bg-[#25262b]/60 border border-[#373a40]/60 px-3 h-9 rounded-md ml-2.5 text-xs sm:text-sm text-gray-400 font-medium shadow-sm shrink-0 cursor-not-allowed select-none opacity-80"
        title="目前僅支援溫哥華地區（其他市鎮資料陸續建置中）"
      >
        <MapIcon className="w-3.5 h-3.5 text-gray-500" />
        <span>溫哥華</span>
        <ChevronDown className="w-3 h-3 text-gray-600 ml-1" />
      </div>

      {/* 搜尋列 (緊隨大溫地區，調闊寬度以容納豐富搜尋與圖標空間) */}
      <div ref={searchContainerRef} className="relative flex-1 min-w-0 max-w-[780px] ml-1.5 sm:ml-2.5 mr-2 sm:mr-4">
        <div className="flex items-center bg-[#25262b] border border-[#373a40] rounded-md px-2 sm:px-3 h-9 focus-within:border-emerald-500/70 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all shadow-inner">
          {/* 搜尋欄左方圖層篩選按鈕 */}
          <div className="relative shrink-0 mr-1 sm:mr-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterPopoverOpen(prev => !prev);
              }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
                selectedFilterCategoryIds.length > 0
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#32353d]'
              }`}
              title="篩選特定圖層搜尋"
            >
              <Filter className={`w-3.5 h-3.5 ${selectedFilterCategoryIds.length > 0 ? 'text-emerald-400' : 'text-gray-400'}`} />
              <span className="hidden sm:inline text-[11px]">
                {selectedFilterCategoryIds.length > 0 ? `已選 ${selectedFilterCategoryIds.length}` : '圖層'}
              </span>
              <ChevronDown className="w-2.5 h-2.5 text-gray-500" />
            </button>

            {/* 圖層篩選下拉選單 */}
            {filterPopoverOpen && (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="absolute top-[36px] left-0 w-64 bg-[#1b1d24] border border-[#383d4a] rounded-xl shadow-2xl p-2.5 z-[120] flex flex-col gap-2 text-xs animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-[#2a2f3d]">
                  <span className="font-bold text-gray-200 text-xs flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>搜尋圖層篩選</span>
                  </span>
                  <div className="flex items-center gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setSelectedFilterCategoryIds(SEARCH_CATEGORY_FILTERS.map(f => f.id))}
                      className="text-emerald-400 hover:underline px-1 py-0.5 rounded cursor-pointer"
                    >
                      全選
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFilterCategoryIds([])}
                      className="text-gray-400 hover:underline px-1 py-0.5 rounded cursor-pointer"
                    >
                      重設 (全部)
                    </button>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-0.5 [scrollbar-width:thin] [scrollbar-color:#4a4d57_transparent]">
                  {SEARCH_CATEGORY_FILTERS.map((cat) => {
                    const isChecked = selectedFilterCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setSelectedFilterCategoryIds(prev => 
                            prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id]
                          );
                        }}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                          isChecked 
                            ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800/50' 
                            : 'hover:bg-[#252a38] text-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <cat.icon className={`w-3.5 h-3.5 ${cat.iconColor || 'text-gray-300'} shrink-0`} />
                          <span className="text-xs font-medium">{cat.label}</span>
                        </div>
                        <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                          isChecked ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-gray-600 bg-[#161820]'
                        }`}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="pt-1.5 border-t border-[#2a2f3d] flex items-center justify-between text-[10.5px] text-gray-400">
                  <span className="truncate">
                    {selectedFilterCategoryIds.length === 0 ? '目前搜尋：全部圖層' : `已限定 ${selectedFilterCategoryIds.length} 個類別`}
                  </span>
                </div>
              </div>
            )}
          </div>

          <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
          <input 
            ref={searchInputRef}
            type="text" 
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setActiveIndex(-1);
              if (val.trim() === '') {
                handleClear();
              } else {
                setIsOpen(true);
              }
            }}
            onFocus={() => {
              setIsOpen(true);
            }}
            onKeyDown={(e) => {
              if (!isOpen) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  setIsOpen(true);
                  e.preventDefault();
                }
                return;
              }
              const currentList = filteredResults.slice(0, displayLimit);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex(prev => {
                  const next = prev + 1;
                  return next < currentList.length ? next : 0;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(prev => {
                  const next = prev - 1;
                  return next >= -1 ? next : currentList.length - 1;
                });
              } else if (e.key === 'Enter') {
                if (activeIndex >= 0 && currentList[activeIndex]) {
                  e.preventDefault();
                  handleSelect(currentList[activeIndex]);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                searchInputRef.current?.blur();
              }
            }}
            placeholder="搜尋地標、地址、站牌號碼、路線或分類..." 
            className="bg-transparent text-sm text-white w-full focus:outline-none placeholder:text-gray-500"
          />
          {!query && (
            <kbd className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono text-gray-500 bg-[#1c1d22] border border-[#383a42] rounded shrink-0 select-none pointer-events-none mr-1">
              /
            </kbd>
          )}
          {isLoading && (
            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin mr-1 shrink-0" />
          )}
          {query && (
            <button 
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-200 p-0.5 rounded transition-colors ml-1"
              title="清除搜尋"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 搜尋欄空狀態面板：最近搜尋與熱門分類捷徑 */}
        {isOpen && query.trim().length === 0 && (
          <div className="absolute top-[44px] left-0 w-full bg-[#1e2025]/98 backdrop-blur-md border border-[#373a40] rounded-xl shadow-2xl overflow-hidden z-[100] max-h-[460px] flex flex-col p-3 text-xs animate-in fade-in zoom-in-95 duration-100">
            {recentSearches.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#2d2e34] text-[11px] text-gray-400">
                  <span className="flex items-center gap-1.5 font-semibold text-gray-300">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>最近搜尋</span>
                  </span>
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-[10px] text-gray-500 hover:text-rose-400 transition-colors"
                  >
                    全部清除
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recentSearches.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="group flex items-center gap-1.5 bg-[#252830] hover:bg-[#2e323d] border border-gray-700/60 hover:border-emerald-500/50 rounded-lg px-2.5 py-1 text-gray-200 transition-all cursor-pointer shadow-sm"
                    >
                      <span className="shrink-0">{renderSearchItemIcon(item)}</span>
                      <span className="text-xs font-medium max-w-[140px] truncate">{item.title}</span>
                      <button
                        type="button"
                        onClick={(e) => removeRecentSearch(item.id, e)}
                        className="text-gray-500 hover:text-rose-400 ml-0.5 p-0.5 rounded-full hover:bg-rose-950/40"
                        title="移除此紀錄"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-1.5 pb-1.5 mb-2 border-b border-[#2d2e34] text-[11px] font-semibold text-gray-300">
                <Boxes className="w-3.5 h-3.5 text-amber-400" />
                <span>熱門分類捷徑</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {QUICK_SEARCH_SHORTCUTS.map(sc => {
                  const Icon = sc.icon;
                  return (
                    <button
                      key={sc.query}
                      type="button"
                      onClick={() => {
                        setQuery(sc.query);
                        searchInputRef.current?.focus();
                      }}
                      className="flex items-center gap-1.5 bg-[#23262e] hover:bg-emerald-950/40 hover:border-emerald-500/40 border border-[#343740] rounded-lg px-2 py-1.5 text-gray-300 hover:text-emerald-300 transition-all text-left text-xs"
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${sc.color || 'text-emerald-400'}`} />
                      <span className="truncate font-medium">{sc.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 搜尋下拉選單 (Dropdown Results) */}
        {isOpen && query.trim().length > 0 && (
          <div className="absolute top-[44px] left-0 w-full bg-[#1e2025]/95 backdrop-blur-md border border-[#373a40] rounded-lg shadow-2xl overflow-hidden z-[100] max-h-[500px] max-h-[75vh] flex flex-col">
            {/* 分類快速篩選標籤列 */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2d2e34] bg-[#191a1e]/90 text-[11px] shrink-0 gap-2 overflow-x-auto [scrollbar-width:none]">
              <div className="flex items-center gap-1 shrink-0">
                {(
                  [
                    { id: 'all', label: '全部', count: groupCounts.all },
                    { id: 'poi', label: '設施地標', count: groupCounts.poi },
                    { id: 'transit', label: '交通航運', count: groupCounts.transit },
                    { id: 'road', label: '道路車位', count: groupCounts.road },
                    { id: 'area', label: '地址區域', count: groupCounts.area },
                  ] as const
                ).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setQuickGroup(tab.id)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer ${
                      quickGroup === tab.id
                        ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#2c2f38]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[10px] ${quickGroup === tab.id ? 'text-emerald-100' : 'text-gray-500'}`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-gray-500 text-[10.5px] shrink-0 hidden sm:inline">
                按 ↑↓ 瀏覽，Enter 確定
              </span>
            </div>

            <div 
              ref={listContainerRef}
              onScroll={(e) => {
                const target = e.currentTarget;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
                  setDisplayLimit(prev => Math.min(prev + 40, filteredResults.length));
                }
              }}
              className="overflow-y-auto flex-1 min-h-0 divide-y divide-[#2a2c33]/60 py-1 [scrollbar-width:thin] [scrollbar-color:#4a4d57_transparent]"
            >
              {filteredResults.length > 0 ? (
                <>
                  {filteredResults.slice(0, displayLimit).map((item, idx) => {
                    const isSelected = idx === activeIndex;
                    const distStr = formatDistance(item.distance_km);
                    return (
                      <button
                        key={item.id}
                        data-search-idx={idx}
                        onClick={() => handleSelect(item)}
                        className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center gap-3 group ${
                          isSelected
                            ? 'bg-emerald-950/60 border-l-2 border-l-emerald-400 text-white shadow-inner'
                            : 'hover:bg-[#2c2f38]'
                        }`}
                      >
                        <span className="text-base flex-shrink-0 w-7 h-7 flex items-center justify-center bg-[#282a30] rounded border border-gray-700/50 group-hover:scale-110 transition-transform">
                          {renderSearchItemIcon(item)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-100 group-hover:text-white truncate">
                            <HighlightMatch text={item.title} query={query} />
                          </div>
                          {item.subtitle && (
                            <div className="text-[11px] text-gray-400 truncate">
                              <HighlightMatch text={item.subtitle} query={query} subtle />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {distStr && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400 bg-[#242730] border border-gray-700/60 px-1.5 py-0.5 rounded font-mono">
                              <Navigation className="w-2.5 h-2.5 text-emerald-400" />
                              <span>{distStr}</span>
                            </span>
                          )}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                            item.category === 'bus_route' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60 font-bold' :
                            item.category === 'bus_stop' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/50' :
                            item.category === 'skytrain' ? 'bg-sky-950/80 text-sky-400 border-sky-800/60' :
                            item.category === 'ferry_terminal' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                            item.category === 'ferry_vehicle' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60 font-bold' :
                            item.category === 'seabus' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'airports' ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60 font-bold' :
                            item.category === 'border_crossing' ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60 font-bold' :
                            item.category === 'fire_halls' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                            item.category === 'police' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60 font-bold' :
                            item.category === 'hospitals' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' :
                            item.category === 'disaster_hubs' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'fuel' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'tesla' ? 'bg-red-950/80 text-red-300 border-red-800/60 font-bold' :
                            item.category === 'impark' ? 'bg-red-950/80 text-red-300 border-red-800/60 font-semibold' :
                            item.category === 'parking_meters' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'accessible_parking' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                            item.category === 'aed' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                            item.category === 'car_sharing' ? 'bg-sky-950/80 text-sky-300 border-sky-800/60' :
                            item.category === 'postal_code_fsa' ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60 font-bold' :
                            item.category === 'local_area_boundary' ? 'bg-teal-950/80 text-teal-300 border-teal-800/60' :
                            item.category === 'bikeways' ? 'bg-teal-950/80 text-teal-300 border-teal-800/60' :
                            item.category === 'traffic_crosswalks' ? 'bg-yellow-950/80 text-yellow-300 border-yellow-800/60' :
                            item.category === 'litter_containers' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'public_art' ? 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-800/60 font-semibold' :
                            item.category === 'motorcycle_parking' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60 font-semibold' :
                            item.category === 'community_centres' ? 'bg-violet-950/80 text-violet-300 border-violet-800/60' :
                            item.category === 'museums' ? 'bg-slate-800 text-slate-200 border-slate-600 font-semibold' :
                            item.category === 'canada_post' ? 'bg-red-950/80 text-red-300 border-red-800/60' :
                            item.category === 'fedex' ? 'bg-purple-950/80 text-purple-300 border-purple-800/60' :
                            item.category === 'purolator' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                            (item.category === 'banks' || item.category === 'atm') ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'public_washrooms' ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60' :
                            item.category === 'ski_resort' ? 'bg-sky-950/80 text-sky-300 border-sky-800/60' :
                            item.category === 'tide_stations' ? 'bg-teal-950/80 text-teal-300 border-teal-800/60' :
                            item.category === 'address' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' :
                            item.category === 'coordinate' ? 'bg-gray-800 text-emerald-300 border-gray-600 font-mono' :
                            item.category === 'railways' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60' :
                            item.category === 'crime_areas' ? 'bg-red-950/80 text-red-300 border-red-800/60' :
                            (item.category === 'turn_restrictions' || item.category === 'traffic_turn_restrictions') ? 'bg-rose-950/80 text-rose-300 border-rose-800/60 font-semibold' :
                            item.category === 'traffic_signals' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'truck_routes' ? 'bg-sky-950/80 text-sky-300 border-sky-800/60' :
                            item.category === 'garbage_collection' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60' :
                            item.category === 'escooter' ? 'bg-lime-950/80 text-lime-300 border-lime-800/60' :
                            item.category === 'ev_charging' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' :
                            item.category === 'schools' ? 'bg-blue-950/80 text-blue-300 border-blue-800/60' :
                            item.category === 'libraries' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                            item.category === 'food_vendors' ? 'bg-orange-950/80 text-orange-300 border-orange-800/60' :
                            item.category === 'homeless_shelters' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                            'bg-gray-800 text-gray-300 border-gray-700'
                          }`}>
                            {item.badge}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredResults.length > displayLimit && (
                    <div className="text-center py-2 text-[10.5px] text-gray-400 bg-[#16171a]/50">
                      向下滾動載入更多項目 ({displayLimit} / {filteredResults.length})
                    </div>
                  )}
                </>
              ) : (
                !isLoading && (
                  <div className="py-6 px-4 text-center text-xs text-gray-400 flex flex-col items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-gray-500" />
                    <span>查無相符圖層項目（可搜尋地標、地址、巴士路線/站號、設施名）</span>
                    {selectedFilterCategoryIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedFilterCategoryIds([])}
                        className="text-emerald-400 hover:underline text-xs mt-1 cursor-pointer"
                      >
                        清除已選圖層篩選以檢視全部結果
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右側按鈕組：桌面版直接展開按鈕；手機版收合為 ⋯ 快捷功能表 */}
      <div className="relative flex items-center gap-1 sm:gap-2 shrink-0">
        {/* 手機版 ⋯ 更多選單按鈕 (參考圖片 5) */}
        <div className="sm:hidden relative">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex items-center justify-center w-9 h-9 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] rounded-md text-gray-300 hover:text-white transition-colors"
            title="更多功能選單"
          >
            <MoreHorizontal className="w-5 h-5 text-gray-300" />
          </button>

          {isMobileMenuOpen && (
            <div 
              className="absolute right-0 top-11 z-[60] w-48 bg-[#1a1c22]/98 backdrop-blur-md border border-[#373a40] rounded-xl shadow-2xl py-1 text-xs flex flex-col divide-y divide-[#2a2d36] animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="py-1">
                <button
                  onClick={() => { setExportModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Download className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>匯出</span>
                </button>
                <button
                  onClick={() => { setIsDonateModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Heart className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>贊助</span>
                </button>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { setIsChangelogModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <History className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>更新日誌</span>
                </button>
                <button
                  onClick={() => { setIsReportModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>回報問題</span>
                </button>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { setSettingsModalOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full px-3.5 py-2 flex items-center gap-2.5 text-gray-200 hover:bg-[#262832] transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>設定</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 桌面版直接平排顯示 6 大功能按鈕 */}
        <div className="hidden sm:flex items-center gap-2">

        {/* 匯出按鈕 (位於探索按鈕右方) */}
        <button 
          onClick={() => setExportModalOpen(true)}
          className={`flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border rounded-md transition-all shadow-sm text-xs font-semibold select-none ${
            isExportModalOpen 
              ? 'border-cyan-500/80 text-cyan-400 bg-[#2c2d33]' 
              : 'border-[#373a40] text-gray-300 hover:border-cyan-500/50 hover:text-cyan-400'
          }`}
          title="匯出純淨地圖截圖、向量圖資或試算表表格"
        >
          <Download className="w-4 h-4 text-cyan-400/80 group-hover:text-cyan-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            匯出
          </span>
        </button>

        {/* 贊助支持按鈕 (愛心圖示，位於回報問題左側) */}
        <button 
          onClick={() => setIsDonateModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-rose-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-rose-400 text-xs font-semibold select-none" 
        >
          <Heart className="w-4 h-4 text-rose-400/80 group-hover:text-rose-400 group-hover:scale-110 transition-transform fill-rose-500/20 shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            贊助
          </span>
        </button>

        {/* 更新日誌按鈕 (位於回報問題左方) */}
        <button 
          onClick={() => setIsChangelogModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-sky-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-sky-400 text-xs font-semibold select-none" 
          title="系統更新日誌"
        >
          <History className="w-4 h-4 text-sky-400/80 group-hover:text-sky-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            更新日誌
          </span>
        </button>

        {/* 回報問題按鈕 */}
        <button 
          onClick={() => setIsReportModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-amber-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-amber-400 text-xs font-semibold select-none" 
        >
          <AlertCircle className="w-4 h-4 text-amber-400/80 group-hover:text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[100px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            回報問題
          </span>
        </button>



        {/* 設定按鈕 (點擊開啟設定版面) */}
        <button 
          onClick={() => setSettingsModalOpen(true)}
          className="flex items-center justify-center group h-9 px-2.5 bg-[#25262b] hover:bg-[#2c2d33] border border-[#373a40] hover:border-emerald-500/50 rounded-md transition-all shadow-sm text-gray-300 hover:text-emerald-400 text-xs font-semibold select-none" 
        >
          <Settings className="w-4 h-4 text-gray-400 group-hover:text-emerald-400 group-hover:rotate-45 transition-transform shrink-0" />
          <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap hidden sm:inline">
            設定
          </span>
        </button>
        </div>
      </div>

      {/* 贊助支持彈出視窗 */}
      <DonateModal 
        isOpen={isDonateModalOpen} 
        onClose={() => setIsDonateModalOpen(false)} 
      />

      {/* 系統更新日誌彈出視窗 */}
      <ChangelogModal isOpen={isChangelogModalOpen} onClose={() => setIsChangelogModalOpen(false)} />
      {/* 會員登入彈窗 (Google 帳號) */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

      {/* 回報問題彈出視窗 */}
      <ReportIssueModal 
        isOpen={isReportModalOpen} 
        onClose={() => setIsReportModalOpen(false)} 
      />

      {/* 偏好設定彈出視窗 */}
      <SettingsModal />

      {/* 探索資訊面板 (燃油比價等) */}
      <ExplorePanel />

      {/* 地圖與圖資匯出中心彈出視窗 */}
      <ExportModal />

    </div>
  );
}
