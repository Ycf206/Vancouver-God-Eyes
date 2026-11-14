'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { 
  CreditCard, Map, Satellite, Sun, Moon, Layers, Route, Ship, 
  Accessibility, Bike, Scooter, Camera, Siren, 
  Flame, Building2, Hospital, ChevronLeft, ChevronDown, Footprints, Flower2, 
  Droplets, Bath, Leaf, Landmark, GraduationCap, BookOpen, UtensilsCrossed, Bed, Heart,
  Calendar, Car, ShieldAlert, LifeBuoy, HeartPulse, Mountain,
  Compass, MapPin, Fuel, Train, Anchor, ArrowRight, Snowflake, Fingerprint, Waves,
  Gauge, Mail, Radio, Trash2, Recycle, RotateCcw, Wifi, Activity, Ban, Cone, Lightbulb, LandPlot, Megaphone, Truck,
  Search, X, Check,
  BusFront, Repeat, TrainFront, ShipCargo, Plane, Road, ParkingMeter, Motorbike, Milestone,
  EvCharger, TrainTrack, TrafficCone, LineSquiggle, HouseHeart, UserRoundGroup, Package,
  CircleDollarSign, Palette, Soup, HeartHandshake, Trees, Park, TreePine, Toilet,
  UserShield, FireExtinguisher, Zap, ZapOff, Earth, Grid3x2, Parasol, FunnelX, Construction, Castle
} from 'lucide-react';

// 自定義倒 U 型單車架 SVG 元件 (LetterU)
export const LetterU = ({ className = "w-3.5 h-3.5", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className} 
    {...props}
  >
    <path d="M6 4v10a6 6 0 0 0 12 0V4" />
  </svg>
);

// Helper component for Tesla Icon

// Helper component for Tesla Icon
const TeslaIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 4.2c2.2 0 4.4.4 6.2 1.2.3.1.6 0 .7-.2l.7-1.1c.1-.2 0-.5-.2-.6C17.1 2.5 14.6 2 12 2S6.9 2.5 4.6 3.5c-.2.1-.3.4-.2.6l.7 1.1c.1.2.4.3.7.2 1.8-.8 4-1.2 6.2-1.2zm0 3.3c-1.7 0-3.3.3-4.8.9-.3.1-.4.4-.3.7l.6 1.8c.1.2.3.4.5.3 1.3-.4 2.6-.6 4-.6s2.7.2 4 .6c.2.1.4-.1.5-.3l.6-1.8c.1-.3 0-.6-.3-.7-1.5-.6-3.1-.9-4.8-.9zm1.3 4.2h-2.6v9.8c0 .3.2.5.5.5h1.6c.3 0 .5-.2.5-.5V11.7z"/>
  </svg>
);

// Helper component for ImPark Icon
const ImParkIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M9 17V7h4.5a3 3 0 0 1 0 6H9" />
  </svg>
);

// Helper component for Traffic Light Icon
const TrafficLightIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="6" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="18" r="1.5" fill="currentColor" />
  </svg>
);

// Helper component for Turn Restriction Icon
const TurnRestrictionIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8h4a2 2 0 0 1 2 2v6" />
    <polyline points="13 13 16 16 19 13" />
    <line x1="5" y1="5" x2="19" y2="19" stroke="#ef4444" strokeWidth="2.2" />
  </svg>
);

// Helper component for Fire Hydrant Icon
const HydrantIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 20h14" />
    <path d="M19 12h2a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-2" />
    <path d="M5 12H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2" />
    <path d="M9 4a3 3 0 0 1 6 0v2H9V4z" />
    <path d="M7 6h10v14H7V6z" />
    <circle cx="12" cy="13" r="2" />
  </svg>
);

// 支援圖層快速搜尋之索引資料表
const SEARCHABLE_LAYERS: Array<{
  id: string;
  name: string;
  category: string;
  keywords: string[];
  icon: React.ElementType;
  isSpecialAction?: boolean;
}> = [
  // 交通 TRANSPORT
  { id: 'bus', name: '巴士車輛', category: '交通', keywords: ['bus', '巴士', '公車', '車輛'], icon: BusFront },
  { id: 'busRoutes', name: '巴士路線', category: '交通', keywords: ['bus', 'route', '路線', '巴士路線'], icon: Route },
  { id: 'skytrainTrains', name: '天車列車 (推算)', category: '交通', keywords: ['skytrain', 'train', '天車', '捷運', '列車'], icon: TrainFront },
  { id: 'skytrainRoutes', name: '天車路線', category: '交通', keywords: ['skytrain', 'route', '天車路線', '世博線', '千禧線', '加拿大線'], icon: Route },
  { id: 'skytrainFareZones', name: '天車收費分區', category: '交通', keywords: ['skytrain', 'zone', '天車區域', '收費分區', '收費區'], icon: Map },
  { id: 'seabusVehicles', name: '海上巴士車輛', category: '交通', keywords: ['seabus', '渡輪', '船', '海上巴士'], icon: Ship },
  { id: 'seabusRoutes', name: '海上巴士路線', category: '交通', keywords: ['seabus', '航線', '海上巴士路線'], icon: Route },
  { id: 'bcferriesVehicles', name: '卑詩渡輪車輛', category: '交通', keywords: ['bc ferries', 'ferry', '渡輪', '卑詩渡輪'], icon: Ship },
  { id: 'bcferriesRoutes', name: '卑詩渡輪路線', category: '交通', keywords: ['ferry route', '渡輪航線', '航線'], icon: Route },
  { id: 'ferrySchedule', name: '卑詩渡輪班次', category: '交通', keywords: ['bc ferries', 'ferry schedule', '卑詩渡輪班次', '渡輪時刻', '船班'], icon: Calendar, isSpecialAction: true },
  { id: 'maritimeShipping', name: '航運船舶', category: '交通', keywords: ['ship', 'marine', 'ais', '船舶', '貨輪'], icon: ShipCargo },
  { id: 'marineTerminals', name: '航運碼頭', category: '交通', keywords: ['terminal', 'port', '碼頭', '港口'], icon: Anchor },
  { id: 'maritimeSchedule', name: '船運班次', category: '交通', keywords: ['shipping', 'cargo', 'maritime schedule', '船運班次', '商船班次', '航運'], icon: Calendar, isSpecialAction: true },
  { id: 'airports', name: '機場', category: '交通', keywords: ['airport', 'yvr', '機場', '起降'], icon: Plane },
  { id: 'airportIndoor', name: '機場內部地圖', category: '交通', keywords: ['airport indoor', 'yvr map', 'terminal', 'gate', 'lounge', '機場內部', '機場地圖', '航廈', '登機口'], icon: Map },
  { id: 'flightSchedule', name: '機場起降時刻', category: '交通', keywords: ['flight', 'schedule', '航班', '時刻表', '飛機'], icon: Calendar, isSpecialAction: true },
  { id: 'busExchanges', name: '巴士轉車站', category: '交通', keywords: ['bus exchange', 'loop', '巴士轉車站', '轉車站', '轉運站'], icon: Repeat },
  { id: 'skytrainStations', name: '天車站', category: '交通', keywords: ['station', 'skytrain station', '車站', '天車站'], icon: TrainFront },
  { id: 'bikeway', name: '單車道', category: '交通', keywords: ['bike', 'bikeway', 'bicycle', '自行車', '單車道'], icon: Bike },
  { id: 'parkingMeters', name: '咪錶車位', category: '交通', keywords: ['parking', 'meter', '咪錶', '停車位', '泊車'], icon: ParkingMeter },
  { id: 'impark', name: '私人車位 (Impark)', category: '交通', keywords: ['impark', 'parking', '私人停車場', '泊車'], icon: ImParkIcon },
  { id: 'motorcycleParking', name: '電單車位', category: '交通', keywords: ['motorcycle', 'moto', '電單車', '機車位'], icon: Motorbike },
  { id: 'accessibleParking', name: '無障礙車位', category: '交通', keywords: ['accessible', 'handicap', '無障礙', '殘疾泊車'], icon: Accessibility },
  { id: 'oneWayStreets', name: '單程路', category: '交通', keywords: ['one way', 'street', '單行道', '單程路'], icon: Milestone },
  { id: 'trafficSpeedLimits', name: '車速限制', category: '交通', keywords: ['speed', 'limit', '限速', '車速'], icon: Gauge },
  { id: 'truckRoutes', name: '貨車路網', category: '交通', keywords: ['truck', 'freight', '貨車', '卡車'], icon: Truck },
  { id: 'bikeRacks', name: '單車架', category: '交通', keywords: ['bike rack', '單車架', '自行車架'], icon: LetterU },
  { id: 'sharedBikes', name: '共享單車 (Mobi)', category: '交通', keywords: ['mobi', 'shared bike', '單車', '共享單車'], icon: Bike },
  { id: 'escooter', name: '共享滑板車', category: '交通', keywords: ['escooter', 'scooter', '滑板車'], icon: Scooter },
  { id: 'trafficSignals', name: '交通燈', category: '交通', keywords: ['traffic light', 'signal', '交通燈', '紅綠燈'], icon: TrafficLightIcon },
  { id: 'turnRestrictions', name: '轉向限制', category: '交通', keywords: ['turn restriction', '轉彎', '左轉', '轉向'], icon: TurnRestrictionIcon },
  { id: 'railways', name: '鐵路', category: '交通', keywords: ['railway', 'rail', '鐵路', '火車'], icon: TrainTrack },
  { id: 'roadClosures', name: '交通管制', category: '交通', keywords: ['closure', 'block', '封路', '管制'], icon: Ban },
  { id: 'roadConstruction', name: '道路施工', category: '交通', keywords: ['construction', 'work', '施工', '修路'], icon: TrafficCone },
  { id: 'trafficCameras', name: '交通攝影機', category: '交通', keywords: ['traffic camera', 'webcam', '路況', '攝影機', '鏡頭'], icon: Camera },
  { id: 'safetyCameras', name: '安全攝影機', category: '交通', keywords: ['safety camera', 'speed camera', '測速', '衝紅燈', '攝影機'], icon: Siren },
  { id: 'trafficConditions', name: '路況', category: '交通', keywords: ['traffic conditions', 'traffic', '路況', '塞車'], icon: LineSquiggle },

  // 生活 LIFESTYLE
  { id: 'communityCentres', name: '社區中心', category: '生活', keywords: ['community centre', '社區中心', '活動中心'], icon: UserRoundGroup },
  { id: 'libraries', name: '圖書館', category: '生活', keywords: ['library', '圖書館', '借書'], icon: BookOpen },
  { id: 'postOffices', name: '郵寄站點', category: '生活', keywords: ['post', 'mail', 'postal', 'canada post', 'fedex', 'purolator', 'dhl', '郵局', '郵寄', '快遞'], icon: Package },
  { id: 'banks', name: '銀行', category: '生活', keywords: ['bank', 'atm', 'td', 'rbc', 'bmo', 'cibc', 'scotia', 'vancity', '銀行', '櫃員機'], icon: CircleDollarSign },
  { id: 'evStations', name: '充電站', category: '生活', keywords: ['ev', 'charger', 'tesla', '充電', '電動車'], icon: EvCharger },
  { id: 'publicArt', name: '公共藝術', category: '生活', keywords: ['public art', 'art', '雕塑', '壁畫', '公共藝術'], icon: Palette },
  { id: 'foodVendors', name: '食物攤販', category: '生活', keywords: ['food vendor', 'food cart', '食物攤販', '小吃'], icon: Soup },
  { id: 'foodBanks', name: '食物援助', category: '生活', keywords: ['food bank', 'meal', '食物援助', '食物銀行'], icon: HeartHandshake },
  { id: 'drinkingFountains', name: '飲水機', category: '生活', keywords: ['drinking water', 'fountain', '飲水機', '裝水'], icon: Droplets },
  { id: 'publicWashrooms', name: '公共洗手間', category: '生活', keywords: ['washroom', 'toilet', 'restroom', '廁所', '洗手間', '公共洗手間'], icon: Toilet },
  { id: 'vanWifi', name: 'VanWiFi', category: '生活', keywords: ['wifi', 'vanwifi', 'wireless', 'internet', '無線網路', '公共wifi'], icon: Wifi },

  // 自然 NATURE
  { id: 'parks', name: '公園', category: '自然', keywords: ['park', '公園', '綠地'], icon: Trees },
  { id: 'parksFacilities', name: '休憩', category: '自然', keywords: ['park facility', '休憩', '遊樂場', '野餐'], icon: Park },
  { id: 'heritageTrees', name: '古蹟樹木', category: '自然', keywords: ['heritage tree', '古樹', '樹木'], icon: TreePine },
  { id: 'streetTrees', name: '街道樹木', category: '自然', keywords: ['street tree', '路樹', '林蔭'], icon: TreePine },
  { id: 'publicTrees', name: '樹木', category: '自然', keywords: ['public tree', '樹木'], icon: TreePine },
  { id: 'shoreline', name: '海岸線', category: '自然', keywords: ['shoreline', 'coast', '海岸', '海濱'], icon: Waves },

  // 安全 SECURITY
  { id: 'police', name: '警察', category: '安全', keywords: ['police', '警察', '警局'], icon: UserShield },
  { id: 'fireHalls', name: '消防', category: '安全', keywords: ['fire', '消防', '消防局'], icon: FireExtinguisher },
  { id: 'consulates', name: '領事館', category: '安全', keywords: ['consulate', 'consulates', 'consular', 'embassy', '領事館', '總領事館', '大使館', '簽證'], icon: Castle },

  // 能源 ENERGY
  { id: 'powerOutages', name: '停電', category: '能源', keywords: ['power outage', 'outage', 'bc hydro', 'blackout', '停電', '供電', '斷電'], icon: ZapOff },

  // 地理 GEOGRAPHY
  { id: 'localAreaBoundary', name: '社區界線', category: '地理', keywords: ['neighbourhood', 'boundary', '社區', '分區界線'], icon: MapPin },
  { id: 'postalCodeFSA', name: '郵遞區號 (FSA)', category: '地理', keywords: ['fsa', 'postal code', '郵區', '郵遞區號'], icon: Mail },
  { id: 'zoningDistricts', name: '土地規劃區', category: '地理', keywords: ['zoning', '土地分區', '地政', '規劃'], icon: LandPlot },
  { id: 'beachWaterQuality', name: '泳灘水質', category: '自然', keywords: ['beach', 'water quality', '水質', '海灘', '泳灘'], icon: Droplets },
  { id: 'propertyBoundaries', name: '土地地界線', category: '地理', keywords: ['property', 'boundary', '地界', '土地邊界'], icon: Layers },
];

export default function LayerPanel() {
  const { 
    mapStyleType, setMapStyleType, layers, toggleLayer, resetAllLayers,
    isLayerPanelOpen, toggleLayerPanel, toggleFlightSchedule, isFlightScheduleOpen,
    toggleFerrySchedule, isFerryScheduleOpen, toggleMaritimeSchedule, isMaritimeScheduleOpen,
    isPowerOutagesOpen, togglePowerOutages, setPowerOutagesOpen,
    contourInterval, setContourInterval, hiddenLayersInPanel,
    disabledLayers,
    layerCustomColors
  } = useUIStore();

  const [layerSearchQuery, setLayerSearchQuery] = React.useState('');

  const matchedLayers = React.useMemo(() => {
    const q = layerSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return SEARCHABLE_LAYERS.filter(item => {
      if (item.name.toLowerCase().includes(q)) return true;
      if (item.category.toLowerCase().includes(q)) return true;
      return item.keywords.some(k => k.toLowerCase().includes(q));
    });
  }, [layerSearchQuery]);

  const [collapsedCategories, setCollapsedCategories] = React.useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('vancouver_layer_collapsed_categories');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse collapsedCategories from localStorage', e);
      }
    }
    return {};
  });

  const toggleCategory = (catId: string) => {
    setCollapsedCategories(prev => {
      const next = {
        ...prev,
        [catId]: !prev[catId]
      };
      try {
        localStorage.setItem('vancouver_layer_collapsed_categories', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsedCategories to localStorage', e);
      }
      return next;
    });
  };

  const activeLayerCount = React.useMemo(() => {
    return Object.values(layers).filter(Boolean).length;
  }, [layers]);

  const categoryActiveCounts = React.useMemo(() => {
    const transportKeys = [
      'bus', 'busRoutes', 'skytrainTrains', 'skytrainRoutes',
      'seabusVehicles', 'seabusRoutes', 'bcferriesVehicles', 'bcferriesRoutes',
      'maritimeShipping', 'marineTerminals', 'airports', 'airportIndoor'
    ] as const;
    const roadKeys = [
      'parkingMeters', 'impark', 'motorcycleParking', 'accessibleParking',
      'oneWayStreets', 'trafficSpeedLimits', 'trafficCrosswalks', 'carSharing',
      'bikeways', 'bikeRacks', 'sharedBikes', 'escooter', 'trafficSignals',
      'turnRestrictions', 'evCharging', 'tesla', 'truckRoutes', 'railways', 'roadClosures',
      'roadConstruction', 'trafficCameras', 'safetyCameras', 'fuel',
      'trafficConditions', 'snowRemovalRoutes', 'trafficAlerts'
    ] as const;
    const lifestyleKeys = [
      'schools', 'libraries', 'communityCentres', 'atm', 'aed', 'canadaPost',
      'publicArt', 'museums', 'foodVendors', 'foodBanks', 'recycling',
      'garbageCollection', 'litterContainers', 'homelessShelters', 'vanWifi'
    ] as const;
    const natureKeys = [
      'parks', 'parksFacilities', 'communityGardens', 'publicTrees',
      'drinkingFountains', 'publicWashrooms', 'beachWaterQuality'
    ] as const;
    const governmentKeys = [
      'police', 'crimeAreas', 'fireHalls', 'fireHydrants', 'hospitals',
      'disasterHubs', 'consulates'
    ] as const;
    const utilitiesKeys = [
      'powerOutages'
    ] as const;
    const geographyKeys = [
      'localAreaBoundary', 'postalCodeFSA', 'zoningDistricts'
    ] as const;

    const count = (keys: readonly (keyof typeof layers)[]) => keys.filter((k) => layers[k]).length;

    return {
      styles: 1,
      transport: count(transportKeys) + (isFlightScheduleOpen ? 1 : 0) + (isFerryScheduleOpen ? 1 : 0) + (isMaritimeScheduleOpen ? 1 : 0),
      road: count(roadKeys),
      lifestyle: count(lifestyleKeys),
      nature: count(natureKeys),
      government: count(governmentKeys),
      utilities: count(utilitiesKeys),
      geography: count(geographyKeys) + (contourInterval !== 'off' ? 1 : 0),
    };
  }, [layers, isFlightScheduleOpen, isFerryScheduleOpen, isMaritimeScheduleOpen, contourInterval]);

  // Helper component for Style buttons (Icon only)
  const StyleButton = ({ type, icon: Icon, title }: { type: MapStyleType, icon: React.ElementType, title: string }) => {
    const isActive = mapStyleType === type;
    return (
      <button
        onClick={() => setMapStyleType(type)}
        title={title}
        className={`flex items-center justify-center w-full h-7 rounded border transition-all duration-150 tooltip ${
          isActive 
            ? 'bg-[#1a1f2e] border-emerald-500/60 text-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.15)]' 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    );
  };

  // Helper component for Layer buttons
  const LayerButton = ({ 
    layerKey, 
    label, 
    icon: Icon, 
    iconOnly = false,
    colorClass = 'text-blue-400', 
    activeBg = 'bg-[#1a1f2e]', 
    activeBorder = 'border-blue-500/50', 
    activeShadow = 'shadow-[0_0_6px_rgba(59,130,246,0.1)]',
    title,
    className = ''
  }: { 
    layerKey: keyof typeof layers, 
    label: string, 
    icon: React.ElementType, 
    iconOnly?: boolean,
    colorClass?: string, 
    activeBg?: string, 
    activeBorder?: string, 
    activeShadow?: string,
    title?: string,
    className?: string
  }) => {
    // 11.3 獨立圖層開關: 若在後台設為隱藏，則不渲染於圖層控制面板中
    if (hiddenLayersInPanel && hiddenLayersInPanel[layerKey]) {
      return null;
    }
    const isDisabled = !!(disabledLayers && disabledLayers[layerKey]);
    const isActive = !isDisabled && layers[layerKey];
    const customColor = layerCustomColors?.[layerKey];
    const customStyle = (!isDisabled && isActive && customColor) ? {
      borderColor: customColor,
      color: customColor,
      backgroundColor: `${customColor}22`,
      boxShadow: `0 0 10px ${customColor}44`
    } : undefined;

    return (
      <button
        onClick={() => {
          if (isDisabled) return;
          toggleLayer(layerKey);
          if (layerKey === 'powerOutages') {
            setPowerOutagesOpen(!isActive);
          }
        }}
        disabled={isDisabled}
        style={customStyle}
        className={`flex items-center gap-1.5 px-2 h-7 rounded border text-[10.5px] transition-all duration-150 justify-center truncate ${className} ${
          isDisabled
            ? 'bg-[#151619] border-[#222327] text-gray-600 opacity-40 cursor-not-allowed font-normal'
            : isActive 
              ? `${activeBg} ${activeBorder} ${colorClass} ${activeShadow} font-semibold` 
              : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200 font-normal'
        }`}
        title={isDisabled ? `${label} (此圖層底層資料已被管理員關閉)` : (title || label)}
      >
        <Icon 
          className={`w-3.5 h-3.5 shrink-0 ${isDisabled ? 'text-gray-600' : isActive ? '' : 'text-gray-500'}`} 
          style={!isDisabled && isActive && customColor ? { color: customColor } : undefined}
        />
        {!iconOnly && <span className="truncate">{label}</span>}
      </button>
    );
  };

  // Helper component for Category Header with Collapse Toggle
  const CategoryHeader = ({
    id,
    title,
    english,
    icon: Icon,
    colorClass = 'text-gray-400',
    subColorClass = 'text-gray-500',
  }: {
    id: string;
    title: string;
    english: string;
    icon?: React.ElementType;
    colorClass?: string;
    subColorClass?: string;
  }) => {
    const isCollapsed = !!collapsedCategories[id];
    const activeCount = categoryActiveCounts[id as keyof typeof categoryActiveCounts] || 0;

    return (
      <button
        type="button"
        onClick={() => toggleCategory(id)}
        className="w-full text-[10px] font-bold tracking-wider flex items-center justify-between py-1 cursor-pointer hover:opacity-90 select-none group transition-opacity"
        title={isCollapsed ? `展開 ${title}` : `收起 ${title}`}
      >
        <div className={`flex items-center gap-1 ${colorClass}`}>
          {Icon && <Icon className="w-3 h-3" />}
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {isCollapsed && activeCount > 0 && id !== 'styles' && (
            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              {activeCount}
            </span>
          )}
          <span className={`text-[9px] font-mono ${subColorClass}`}>{english}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-200 transition-transform duration-200 ${
              isCollapsed ? '-rotate-90 text-gray-500' : 'rotate-0'
            }`}
          />
        </div>
      </button>
    );
  };

  // On mobile initial load, default to closed
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      if (isLayerPanelOpen) toggleLayerPanel();
    }
  }, []);

  if (!isLayerPanelOpen) {
    return null;
  }

  return (
    <>
      {/* Mobile Backdrop */}
      <div 
        onClick={toggleLayerPanel}
        className="fixed inset-0 top-[60px] z-40 bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in duration-200"
      />

      <div 
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="fixed top-[60px] left-0 bottom-0 z-50 md:z-30 w-[280px] sm:w-[240px] bg-[#161719] border-r border-[#2d2e32] flex flex-col shadow-2xl select-none animate-in slide-in-from-left duration-150"
      >
      
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-[#2d2e32] bg-[#1a1b1e] shrink-0">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs font-bold text-gray-200 tracking-wide">圖層控制</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={resetAllLayers}
            disabled={activeLayerCount === 0}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
              activeLayerCount > 0
                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 shadow-sm cursor-pointer'
                : 'bg-transparent text-gray-600 border border-transparent opacity-40 cursor-not-allowed'
            }`}
            title="一鍵全部關閉已開啟的圖層"
          >
            <FunnelX className="w-2.5 h-2.5 shrink-0" />
            <span>全關 ({activeLayerCount})</span>
          </button>
          <button 
            onClick={toggleLayerPanel}
            className="text-gray-400 hover:text-white p-1 hover:bg-[#26282e] rounded transition-colors"
            title="收合面板"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Body with custom scrollbar */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3036] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#42454d]">
        
        {/* 1. Map Styles (底圖風格) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="styles" title="底圖風格" english="STREET / SATELLITE" />
          {!collapsedCategories['styles'] && (
            <div className="grid grid-cols-4 gap-1 animate-in fade-in duration-150">
              <StyleButton type="street" title="街道地圖" icon={Map} />
              <StyleButton type="satellite" title="衛星影像" icon={Satellite} />
              <StyleButton type="light" title="淺色風格" icon={Sun} />
              <StyleButton type="dark" title="深色科技" icon={Moon} />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 圖層快速搜尋列 (Layer Quick Search) - 介於底層風格和交通類別之間 */}
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={layerSearchQuery}
              onChange={(e) => setLayerSearchQuery(e.target.value)}
              placeholder="搜尋圖層"
              className="w-full bg-[#16181f] border border-[#2b303e] rounded-lg pl-8 pr-7 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/80 transition-colors"
            />
            {layerSearchQuery && (
              <button
                type="button"
                onClick={() => setLayerSearchQuery('')}
                className="absolute right-2 text-gray-400 hover:text-white p-0.5 rounded cursor-pointer"
                title="清除搜尋"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 搜尋建議清單 (Autocomplete Suggestions) */}
          {layerSearchQuery.trim().length > 0 && (
            <div className="mt-1.5 bg-[#141720] border border-emerald-500/40 rounded-lg shadow-2xl p-1.5 flex flex-col gap-1 max-h-56 overflow-y-auto z-30 animate-in fade-in slide-in-from-top-1 duration-150">
              {matchedLayers.length === 0 ? (
                <div className="text-center py-2.5 text-[11px] text-gray-400">
                  未找到相符圖層
                </div>
              ) : (
                matchedLayers.map(item => {
                  const Icon = item.icon;
                  const isLayerDisabled = !item.isSpecialAction && !!(disabledLayers && disabledLayers[item.id]);
                  const isLayerActive = !isLayerDisabled && (item.isSpecialAction 
                    ? (item.id === 'flightSchedule' ? isFlightScheduleOpen : item.id === 'ferrySchedule' ? isFerryScheduleOpen : isMaritimeScheduleOpen)
                    : !!(layers as any)[item.id]);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={isLayerDisabled}
                      onClick={() => {
                        if (isLayerDisabled) return;
                        if (item.isSpecialAction) {
                          if (item.id === 'flightSchedule') toggleFlightSchedule();
                          else if (item.id === 'ferrySchedule') toggleFerrySchedule();
                          else if (item.id === 'maritimeSchedule') toggleMaritimeSchedule();
                        } else {
                          toggleLayer(item.id as any);
                        }
                      }}
                      title={isLayerDisabled ? `${item.name} (此圖層底層資料已被管理員關閉)` : undefined}
                      className={`flex items-center justify-between px-2 py-1.5 rounded text-left transition-all ${
                        isLayerDisabled
                          ? 'opacity-40 cursor-not-allowed bg-black/20 text-gray-500'
                          : isLayerActive 
                            ? 'bg-emerald-950/60 border border-emerald-600/40 text-emerald-200 cursor-pointer' 
                            : 'hover:bg-[#1f2533] text-gray-300 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isLayerActive ? 'text-emerald-400' : 'text-gray-400'}`} />
                        <span className="text-xs truncate font-medium">{item.name}</span>
                        <span className="text-[9.5px] px-1 py-0.2 rounded bg-black/40 text-gray-400 shrink-0">
                          {item.category}
                        </span>
                      </div>
                      <div className="shrink-0 flex items-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                          isLayerActive 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-gray-800 text-gray-400'
                        }`}>
                          {isLayerActive ? '已開啟' : '已關閉'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 2. Transport Row (交通) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="transport" title="交通" english="TRANSPORT" icon={BusFront} colorClass="text-emerald-400" subColorClass="text-gray-500" />
          {!collapsedCategories['transport'] && (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
              {/* 巴士 */}
              <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-emerald-400 pl-0.5">巴士</span>
                <LayerButton layerKey="bus" label="車輛" title="巴士車輛" icon={BusFront} iconOnly colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
                <LayerButton layerKey="busRoutes" label="路線" title="巴士路線" icon={Route} iconOnly colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
                <LayerButton layerKey="busExchanges" label="轉車站" title="巴士轉車站" icon={Repeat} iconOnly colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
              </div>

              {/* 天車 */}
              <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-blue-400 pl-0.5">天車</span>
                <LayerButton layerKey="skytrainTrains" label="列車 (推算)" title="天車列車 (推算)" icon={TrainFront} iconOnly colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
                <LayerButton layerKey="skytrainRoutes" label="車站" title="天車站點與路線" icon={Route} iconOnly colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" />
                <LayerButton layerKey="skytrainFareZones" label="天車區域" title="天車收費區域" icon={Map} iconOnly colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
              </div>

              {/* 海上巴士 */}
              <div className="grid grid-cols-[48px_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-[#00a4e4] pl-0.5">海上巴士</span>
                <LayerButton layerKey="seabusVehicles" label="船隻" title="海上巴士船隻" icon={Ship} iconOnly colorClass="text-[#00a4e4]" activeBg="bg-[#0e2738]" activeBorder="border-[#00a4e4]/50" activeShadow="shadow-[0_0_6px_rgba(0,164,228,0.2)]" />
                <LayerButton layerKey="seabusRoutes" label="路線" title="海上巴士路線" icon={Route} iconOnly colorClass="text-[#00a4e4]" activeBg="bg-[#0e2738]" activeBorder="border-[#00a4e4]/50" />
              </div>

              {/* 卑詩渡輪 */}
              <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-[#3399ff] pl-0.5">卑詩渡輪</span>
                <LayerButton layerKey="bcferriesVehicles" label="船隻" title="卑詩渡輪船隻" icon={Ship} iconOnly colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" activeShadow="shadow-[0_0_6px_rgba(0,96,169,0.2)]" />
                <LayerButton layerKey="bcferriesRoutes" label="路線" title="卑詩渡輪航線" icon={Route} iconOnly colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" />
                <button
                  type="button"
                  onClick={() => toggleFerrySchedule()}
                  className={`group relative flex items-center justify-center h-7 rounded border text-[10.5px] transition-all duration-150 select-none cursor-pointer ${
                    isFerryScheduleOpen
                      ? 'bg-[#0f1b2e] border-sky-500/50 text-[#3399ff] shadow-[0_0_6px_rgba(0,96,169,0.25)] font-semibold'
                      : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-white font-normal'
                  }`}
                  title="卑詩渡輪班次"
                >
                  <Calendar className={`w-3.5 h-3.5 shrink-0 ${isFerryScheduleOpen ? 'text-[#3399ff]' : 'text-gray-500 group-hover:text-white'}`} />
                  <span className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex items-center px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-white text-[10px] whitespace-nowrap shadow-lg z-50">
                    卑詩渡輪班次
                  </span>
                </button>
              </div>

              {/* 船運 */}
              <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-cyan-400 pl-0.5">船運</span>
                <LayerButton layerKey="maritimeShipping" label="船隻" title="船運船隻" icon={ShipCargo} iconOnly colorClass="text-cyan-400" activeBg="bg-[#0e2730]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.2)]" />
                <LayerButton layerKey="marineTerminals" label="碼頭" title="船運碼頭" icon={Anchor} iconOnly colorClass="text-cyan-400" activeBg="bg-[#0e2730]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.2)]" />
                <button
                  type="button"
                  onClick={() => toggleMaritimeSchedule()}
                  className={`group relative flex items-center justify-center h-7 rounded border text-[10.5px] transition-all duration-150 select-none cursor-pointer ${
                    isMaritimeScheduleOpen
                      ? 'bg-[#0e2730] border-cyan-500/50 text-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.25)] font-semibold'
                      : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-white font-normal'
                  }`}
                  title="船運班次"
                >
                  <Calendar className={`w-3.5 h-3.5 shrink-0 ${isMaritimeScheduleOpen ? 'text-cyan-400' : 'text-gray-500 group-hover:text-white'}`} />
                  <span className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex items-center px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-white text-[10px] whitespace-nowrap shadow-lg z-50">
                    船運班次
                  </span>
                </button>
              </div>

              {/* 航空 */}
              <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-1 items-center">
                <span className="text-[11px] font-medium text-sky-400 pl-0.5">航空</span>
                <LayerButton layerKey="airports" label="機場" title="機場" icon={Plane} iconOnly colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
                <LayerButton layerKey="airportIndoor" label="機場內部地圖" title="機場內部地圖" icon={Map} iconOnly colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
                <button
                  type="button"
                  onClick={() => toggleFlightSchedule()}
                  className={`group relative flex items-center justify-center h-7 rounded border text-[10.5px] transition-all duration-150 select-none cursor-pointer ${
                    isFlightScheduleOpen
                      ? 'bg-[#102336] border-sky-500/50 text-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.15)] font-semibold'
                      : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-white font-normal'
                  }`}
                  title="航班班次"
                >
                  <Calendar className={`w-3.5 h-3.5 shrink-0 ${isFlightScheduleOpen ? 'text-sky-400' : 'text-gray-500 group-hover:text-white'}`} />
                  <span className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex items-center px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-white text-[10px] whitespace-nowrap shadow-lg z-50">
                    航班班次
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 3. Road Infrastructure Row (道路) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="road" title="道路" english="ROAD" icon={Road} colorClass="text-amber-400" subColorClass="text-amber-500/70" />
          {!collapsedCategories['road'] && (
            <div className="grid grid-cols-2 gap-1 animate-in fade-in duration-150">
              {/* Row 1: 停車收費錶 | ImPark */}
              <LayerButton layerKey="parkingMeters" label="停車收費錶" icon={ParkingMeter} colorClass="text-[#3b82f6]" activeBg="bg-[#1e293b]" activeBorder="border-blue-600/50" activeShadow="shadow-[0_0_6px_rgba(37,99,235,0.2)]" />
              <LayerButton layerKey="impark" label="私人停車場" icon={ImParkIcon} colorClass="text-[#d9261c]" activeBg="bg-[#2d1417]" activeBorder="border-[#d9261c]/60" activeShadow="shadow-[0_0_8px_rgba(217,38,28,0.3)]" />

              {/* Row 2: 摩托車停車位 | 無障礙停車位 */}
              <LayerButton layerKey="motorcycleParking" label="摩托車停車位" icon={Motorbike} colorClass="text-[#3b82f6]" activeBg="bg-[#1e293b]" activeBorder="border-blue-600/50" activeShadow="shadow-[0_0_6px_rgba(37,99,235,0.2)]" />
              <LayerButton layerKey="accessibleParking" label="無障礙停車位" icon={Accessibility} colorClass="text-[#38bdf8]" activeBg="bg-[#0c2e46]" activeBorder="border-[#0284c7]/60" activeShadow="shadow-[0_0_6px_rgba(2,132,199,0.2)]" />

              {/* Row 3: 單程路段 | 限速路段 */}
              <LayerButton layerKey="oneWayStreets" label="單程路段" icon={Milestone} colorClass="text-slate-300" activeBg="bg-[#0f172a]" activeBorder="border-slate-500/50" activeShadow="shadow-[0_0_6px_rgba(15,23,42,0.4)]" />
              <LayerButton layerKey="trafficSpeedLimits" label="限速路段" icon={Gauge} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

              {/* Row 4: 行人穿越道 | 共享汽車 */}
              <LayerButton layerKey="trafficCrosswalks" label="行人穿越道" icon={Footprints} colorClass="text-amber-200" activeBg="bg-[#2a2518]" activeBorder="border-amber-300/50" activeShadow="shadow-[0_0_6px_rgba(254,243,199,0.2)]" />
              <LayerButton layerKey="carSharing" label="共享汽車" icon={Car} colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />

              {/* Row 5: 單車徑 | 單車架 */}
              <LayerButton layerKey="bikeways" label="單車徑" icon={Route} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
              <LayerButton layerKey="bikeRacks" label="單車架" icon={LetterU} colorClass="text-emerald-400" activeBg="bg-[#062c22]" activeBorder="border-emerald-600/50" activeShadow="shadow-[0_0_6px_rgba(6,95,70,0.2)]" />

              {/* Row 6: 共享單車 | 共享滑板車 */}
              <LayerButton layerKey="sharedBikes" label="共享單車" icon={Bike} colorClass="text-teal-400" activeBg="bg-[#0e2d30]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(0,163,173,0.2)]" />
              <LayerButton layerKey="escooter" label="共享滑板車" icon={Scooter} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_6px_rgba(132,204,22,0.15)]" />

              {/* Row 7: 交通燈 | 轉向限制 (位於共享單車與電動車充電站之間) */}
              <LayerButton layerKey="trafficSignals" label="交通燈" icon={TrafficLightIcon} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
              <LayerButton layerKey="turnRestrictions" label="轉向限制" icon={TurnRestrictionIcon} colorClass="text-rose-400" activeBg="bg-[#2a171a]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />

              {/* Row 8: 電動車充電站 | TESLA */}
              <LayerButton layerKey="evCharging" label="電動車充電站" icon={EvCharger} colorClass="text-emerald-400" activeBg="bg-[#0b291e]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(5,150,105,0.2)]" />
              <LayerButton layerKey="tesla" label="TESLA" icon={TeslaIcon} colorClass="text-[#E82127]" activeBg="bg-[#2d1417]" activeBorder="border-[#E82127]/60" activeShadow="shadow-[0_0_8px_rgba(232,33,39,0.3)]" />

              {/* Row 9: 貨車路線 | 鐵路 */}
              <LayerButton layerKey="truckRoutes" label="貨車路線" icon={Truck} colorClass="text-sky-400" activeBg="bg-[#0f2438]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(14,165,233,0.2)]" />
              <LayerButton layerKey="railways" label="鐵路" icon={TrainTrack} colorClass="text-indigo-400" activeBg="bg-[#181a38]" activeBorder="border-indigo-500/50" activeShadow="shadow-[0_0_6px_rgba(99,102,241,0.2)]" />

              {/* Row 10: 交通封閉 | 道路施工 */}
              <LayerButton layerKey="roadClosures" label="交通封閉" icon={Ban} title="交通封閉" colorClass="text-red-400" activeBg="bg-[#2b171c]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(220,38,38,0.2)]" />
              <LayerButton layerKey="roadConstruction" label="道路施工" icon={TrafficCone} title="道路施工" colorClass="text-orange-400" activeBg="bg-[#2d1b10]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(234,88,12,0.2)]" />

              {/* Row 11: 交通攝影機 | 路口安全相機 */}
              <LayerButton layerKey="trafficCameras" label="交通攝影機" icon={Camera} colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(2,132,199,0.2)]" />
              <LayerButton layerKey="safetyCameras" label="路口安全相機" icon={Siren} colorClass="text-red-500" activeBg="bg-[#2d1216]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(220,38,38,0.25)]" />

              {/* Row 12: 油站 (路況左方) | 路況 */}
              <LayerButton layerKey="fuel" label="油站" icon={Fuel} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
              <LayerButton layerKey="trafficConditions" label="路況" icon={LineSquiggle} title="即時路況：TomTom 全大溫街道即時暢通度 (綠/黃/紅)" colorClass="text-emerald-400" activeBg="bg-[#142820]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />

              {/* Row 13: Drive BC | 即時通報 (路況下方) */}
              <LayerButton layerKey="driveBC" label="Drive BC" icon={Construction} title="Drive BC：BC 省即時路況事件、施工、天候封閉與未來預告" colorClass="text-amber-500" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
              <LayerButton layerKey="trafficAlerts" label="即時通報" icon={Megaphone} title="即時通報：TomTom 即時標出事故、封路、施工與危險障礙點" colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

              {/* Row 14: 鏟雪路線 */}
              <LayerButton layerKey="snowRemovalRoutes" label="鏟雪路線" icon={Snowflake} title="鏟雪路線" colorClass="text-sky-200" activeBg="bg-[#172836]" activeBorder="border-sky-300/50" activeShadow="shadow-[0_0_6px_rgba(240,249,255,0.2)]" />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 4. Lifestyle Row (生活) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="lifestyle" title="生活" english="LIFESTYLE" icon={HouseHeart} colorClass="text-amber-400" subColorClass="text-amber-500/70" />
          {!collapsedCategories['lifestyle'] && (
            <div className="grid grid-cols-2 gap-1 animate-in fade-in duration-150">
              {/* Row 1: 學校 | 圖書館 */}
              <LayerButton layerKey="schools" label="學校" icon={GraduationCap} colorClass="text-blue-400" activeBg="bg-[#142334]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
              <LayerButton layerKey="libraries" label="圖書館" icon={BookOpen} colorClass="text-amber-400" activeBg="bg-[#292215]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

              {/* Row 2: 社區中心 | 銀行 */}
              <LayerButton layerKey="communityCentres" label="社區中心" icon={UserRoundGroup} colorClass="text-violet-400" activeBg="bg-[#211a2f]" activeBorder="border-violet-500/50" activeShadow="shadow-[0_0_6px_rgba(139,92,246,0.15)]" />
              <LayerButton layerKey="banks" label="銀行" icon={CircleDollarSign} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

              {/* Row 3: AED | Canada Post */}
              <LayerButton layerKey="aed" label="AED" icon={HeartPulse} colorClass="text-red-400" activeBg="bg-[#2c1518]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(239,68,68,0.15)]" />
              <LayerButton layerKey="canadaPost" label="郵寄" icon={Package} colorClass="text-red-400" activeBg="bg-[#2a171c]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(239,68,68,0.15)]" />

              {/* Row 4: 公共藝術 | 博物館 */}
              <LayerButton layerKey="publicArt" label="公共藝術" icon={Palette} colorClass="text-fuchsia-400" activeBg="bg-[#2a1428]" activeBorder="border-fuchsia-500/50" activeShadow="shadow-[0_0_6px_rgba(217,70,239,0.15)]" />
              <LayerButton layerKey="museums" label="博物館" icon={Landmark} colorClass="text-slate-300" activeBg="bg-[#1e232d]" activeBorder="border-slate-500/50" activeShadow="shadow-[0_0_6px_rgba(100,116,139,0.25)]" />

              {/* Row 5: 食品攤販 | 食物援助 */}
              <LayerButton layerKey="foodVendors" label="食品攤販" icon={Soup} colorClass="text-orange-400" activeBg="bg-[#2b1e16]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(251,146,60,0.15)]" />
              <LayerButton layerKey="foodBanks" label="食物援助" icon={HeartHandshake} colorClass="text-emerald-400" activeBg="bg-[#142820]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />

              {/* Row 6: 環保回收 | 廢物回收 */}
              <LayerButton layerKey="recycling" label="環保回收" icon={Recycle} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
              <LayerButton layerKey="garbageCollection" label="廢物回收" icon={Truck} colorClass="text-orange-400" activeBg="bg-[#291e17]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(249,115,22,0.2)]" />

              {/* Row 7: 垃圾箱 | 無家者庇護所 */}
              <LayerButton layerKey="litterContainers" label="垃圾箱" icon={Trash2} colorClass="text-amber-400" activeBg="bg-[#282115]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
              <LayerButton layerKey="homelessShelters" label="無家者庇護所" icon={Bed} colorClass="text-rose-400" activeBg="bg-[#2a171d]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />

              {/* Row 8: VanWiFi (垃圾箱下方) */}
              <LayerButton layerKey="vanWifi" label="VanWiFi" icon={Wifi} colorClass="text-cyan-400" activeBg="bg-[#102632]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.15)]" />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 5. Nature Row (自然) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="nature" title="自然" english="NATURE" icon={Leaf} colorClass="text-emerald-400" subColorClass="text-emerald-500/70" />
          {!collapsedCategories['nature'] && (
            <div className="grid grid-cols-2 gap-1 animate-in fade-in duration-150">
              <LayerButton layerKey="parks" label="公園" icon={Trees} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(168,85,247,0.15)]" />
              <LayerButton layerKey="parksFacilities" label="休憩" icon={Park} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
              <LayerButton layerKey="communityGardens" label="社區花園" icon={Flower2} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_6px_rgba(132,204,22,0.15)]" />
              <LayerButton layerKey="publicTrees" label="樹木" icon={TreePine} title="街道樹木" colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
              <LayerButton layerKey="drinkingFountains" label="飲水器" icon={Droplets} colorClass="text-sky-400" activeBg="bg-[#142533]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
              <LayerButton layerKey="publicWashrooms" label="公共洗手間" icon={Toilet} colorClass="text-cyan-400" activeBg="bg-[#13272e]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.15)]" />
              <LayerButton layerKey="beachWaterQuality" label="海灘水質" icon={Parasol} title="海灘水質" colorClass="text-teal-300" activeBg="bg-[#0e2a2a]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 6. Security Row (安全) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="government" title="安全" english="SECURITY" icon={ShieldAlert} colorClass="text-rose-400" subColorClass="text-rose-400/70" />
          {!collapsedCategories['government'] && (
            <div className="grid grid-cols-2 gap-1 animate-in fade-in duration-150">
              {/* Row 1: 警察 | 罪案地區 */}
              <LayerButton layerKey="police" label="警察" icon={UserShield} colorClass="text-blue-400" activeBg="bg-[#142338]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
              <LayerButton layerKey="crimeAreas" label="罪案地區" icon={Fingerprint} colorClass="text-rose-400" activeBg="bg-[#2c1619]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.2)]" />

              {/* Row 2: 消防 | 消防栓 */}
              <LayerButton layerKey="fireHalls" label="消防" icon={FireExtinguisher} colorClass="text-rose-400" activeBg="bg-[#2a171a]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
              <LayerButton layerKey="fireHydrants" label="消防栓" icon={HydrantIcon} title="市政消防栓" colorClass="text-red-400" activeBg="bg-[#2a171a]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(239,68,68,0.15)]" />

              {/* Row 3: 醫療 | 災害支援中心 */}
              <LayerButton layerKey="hospitals" label="醫療" icon={Hospital} colorClass="text-emerald-400" activeBg="bg-[#13271d]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
              <LayerButton layerKey="disasterHubs" label="災害支援中心" icon={LifeBuoy} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

              {/* Row 4: 領事館 */}
              <LayerButton layerKey="consulates" label="領事館" icon={Castle} colorClass="text-indigo-400" activeBg="bg-[#1b1c32]" activeBorder="border-indigo-500/50" activeShadow="shadow-[0_0_6px_rgba(99,102,241,0.15)]" />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 7. Energy Row (能源) */}
        <div className="flex flex-col gap-1.5">
          <CategoryHeader id="utilities" title="能源" english="ENERGY" icon={Zap} colorClass="text-cyan-400" subColorClass="text-cyan-400/70" />
          {!collapsedCategories['utilities'] && (
            <div className="grid grid-cols-2 gap-1 animate-in fade-in duration-150">
              <LayerButton layerKey="powerOutages" label="停電" icon={ZapOff} title="卑詩省停電即時情況" colorClass="text-amber-400" activeBg="bg-[#2d1b14]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.2)]" />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* 8. Geography Row (地理) */}
        <div className="flex flex-col gap-2 pb-2">
          <CategoryHeader id="geography" title="地理" english="GEOGRAPHY" icon={Earth} colorClass="text-teal-400" subColorClass="text-teal-500/70" />
          {!collapsedCategories['geography'] && (
            <div className="flex flex-col gap-2 animate-in fade-in duration-150">
              {/* 區域邊界、郵遞編號、土地規劃 */}
              <div className="grid grid-cols-2 gap-1">
                {/* Row 1: 區域邊界 | 郵遞編號 */}
                <LayerButton layerKey="localAreaBoundary" label="區域邊界" icon={Grid3x2} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
                <LayerButton layerKey="postalCodeFSA" label="郵遞編號" icon={Mail} colorClass="text-indigo-400" activeBg="bg-[#181a33]" activeBorder="border-indigo-500/50" activeShadow="shadow-[0_0_6px_rgba(99,102,241,0.15)]" />

                {/* Row 2: 土地規劃 */}
                <LayerButton layerKey="zoningDistricts" label="土地規劃" icon={LandPlot} title="土地規劃分區" colorClass="text-indigo-400" activeBg="bg-[#181a33]" activeBorder="border-indigo-500/50" activeShadow="shadow-[0_0_6px_rgba(99,102,241,0.15)]" />
              </div>

              {/* 等高線文字與狀態標籤 */}
              <div className="text-[10px] font-bold text-teal-400 tracking-wider flex items-center justify-between pt-1">
                <div className="flex items-center gap-1">
                  <Mountain className="w-3 h-3 text-teal-400" />
                  <span>等高線</span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                  contourInterval === 'off'
                    ? 'bg-[#1c1d21] text-gray-400 border-[#2d2e32]'
                    : 'bg-teal-950/80 text-teal-300 border-teal-500/50 shadow-[0_0_6px_rgba(20,184,166,0.2)]'
                }`}>
                  {contourInterval === 'off' ? 'OFF 關閉' : `${contourInterval === '1m' ? '1米' : contourInterval === '2m' ? '2米' : '10米'}間距`}
                </span>
              </div>

              {/* Stepped Slider Controls */}
              <div className="bg-[#1c1d21] p-2 rounded-lg border border-[#2d2e32] flex flex-col gap-2 shadow-inner">
                <div className="relative flex items-center px-1">
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="1"
                    aria-label="等高線間隔選擇"
                    value={
                      contourInterval === 'off' ? 0 :
                      contourInterval === '1m' ? 1 :
                      contourInterval === '2m' ? 2 : 3
                    }
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const opts: ('off' | '1m' | '2m' | '10m')[] = ['off', '1m', '2m', '10m'];
                      setContourInterval(opts[val]);
                    }}
                    className="w-full h-1.5 bg-[#2a2b30] rounded-lg appearance-none cursor-pointer accent-teal-400 focus:outline-none"
                  />
                </div>

                {/* Stepped Snap Button Labels */}
                <div className="grid grid-cols-4 gap-1">
                  {(['off', '1m', '2m', '10m'] as const).map((opt) => {
                    const labelMap = { off: 'OFF', '1m': '1米', '2m': '2米', '10m': '10米' };
                    const isActive = contourInterval === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => setContourInterval(opt)}
                        className={`py-1 text-[10px] rounded transition-all duration-150 text-center ${
                          isActive
                            ? 'bg-teal-500 text-black font-bold shadow-[0_0_8px_rgba(20,184,166,0.4)]'
                            : 'bg-[#25262b] text-gray-400 hover:text-gray-200 hover:bg-[#2d2e34] font-normal'
                        }`}
                      >
                        {labelMap[opt]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
    </>
  );
}
