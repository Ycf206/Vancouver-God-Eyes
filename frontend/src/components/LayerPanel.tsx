'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import {
  LAYER_CATEGORIES,
  LAYER_CATALOG,
  TRANSPORT_GROUPS,
  type LayerCatalogEntry,
  type LayerCategoryId,
  type LayerIconKey,
} from '@/data/layerRegistry';
import {
  Accessibility,
  Anchor,
  Ban,
  Bed,
  Bike,
  BookOpen,
  BusFront,
  Calendar,
  Camera,
  Car,
  Castle,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  Construction,
  Droplets,
  Earth,
  EvCharger,
  Fingerprint,
  FireExtinguisher,
  Flower2,
  Footprints,
  Fuel,
  FunnelX,
  Gauge,
  GraduationCap,
  Grid3x2,
  HeartHandshake,
  HeartPulse,
  Hospital,
  HouseHeart,
  LandPlot,
  Landmark,
  Layers,
  Leaf,
  LifeBuoy,
  LineSquiggle,
  Mail,
  Map,
  Megaphone,
  Milestone,
  Moon,
  Motorbike,
  Mountain,
  Package,
  Palette,
  Parasol,
  Park,
  ParkingMeter,
  Plane,
  Recycle,
  Repeat,
  Road,
  Route,
  Satellite,
  Scooter,
  Search,
  ShieldAlert,
  Ship,
  ShipCargo,
  Siren,
  Snowflake,
  Soup,
  Sun,
  Toilet,
  TrafficCone,
  TrainFront,
  TrainTrack,
  Trash2,
  TreePine,
  Trees,
  Truck,
  UserRoundGroup,
  UserShield,
  Waves,
  Wifi,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';

// 自定義倒 U 型單車架 SVG 元件 (LetterU)
export const LetterU = ({ className = 'w-3.5 h-3.5', ...props }: React.SVGProps<SVGSVGElement>) => (
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
const TeslaIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 4.2c2.2 0 4.4.4 6.2 1.2.3.1.6 0 .7-.2l.7-1.1c.1-.2 0-.5-.2-.6C17.1 2.5 14.6 2 12 2S6.9 2.5 4.6 3.5c-.2.1-.3.4-.2.6l.7 1.1c.1.2.4.3.7.2 1.8-.8 4-1.2 6.2-1.2zm0 3.3c-1.7 0-3.3.3-4.8.9-.3.1-.4.4-.3.7l.6 1.8c.1.2.3.4.5.3 1.3-.4 2.6-.6 4-.6s2.7.2 4 .6c.2.1.4-.1.5-.3l.6-1.8c.1-.3 0-.6-.3-.7-1.5-.6-3.1-.9-4.8-.9zm1.3 4.2h-2.6v9.8c0 .3.2.5.5.5h1.6c.3 0 .5-.2.5-.5V11.7z" />
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

const ICON_MAP: Record<LayerIconKey, React.ElementType> = {
  Accessibility,
  Anchor,
  Ban,
  Bed,
  Bike,
  BookOpen,
  BusFront,
  Calendar,
  Camera,
  Car,
  Castle,
  CircleDollarSign,
  Construction,
  Droplets,
  EvCharger,
  Fingerprint,
  FireExtinguisher,
  Flower2,
  Footprints,
  Fuel,
  Gauge,
  GraduationCap,
  Grid3x2,
  HeartHandshake,
  HeartPulse,
  Hospital,
  HydrantIcon,
  ImParkIcon,
  LandPlot,
  Landmark,
  LetterU,
  LifeBuoy,
  LineSquiggle,
  Mail,
  Map,
  Megaphone,
  Milestone,
  Motorbike,
  Mountain,
  Package,
  Palette,
  Parasol,
  Park,
  ParkingMeter,
  Plane,
  Recycle,
  Repeat,
  Route,
  Scooter,
  Ship,
  ShipCargo,
  Siren,
  Snowflake,
  Soup,
  TeslaIcon,
  Toilet,
  TrafficCone,
  TrafficLightIcon,
  TrainFront,
  TrainTrack,
  Trash2,
  TreePine,
  Trees,
  Truck,
  TurnRestrictionIcon,
  UserRoundGroup,
  UserShield,
  Waves,
  Wifi,
  ZapOff,
};

const CATEGORY_VISUALS: Record<
  LayerCategoryId,
  { icon: React.ElementType; colorClass: string; subColorClass: string }
> = {
  transport: { icon: BusFront, colorClass: 'text-emerald-400', subColorClass: 'text-gray-500' },
  road: { icon: Road, colorClass: 'text-amber-400', subColorClass: 'text-amber-500/70' },
  lifestyle: { icon: HouseHeart, colorClass: 'text-amber-400', subColorClass: 'text-amber-500/70' },
  nature: { icon: Leaf, colorClass: 'text-emerald-400', subColorClass: 'text-emerald-500/70' },
  government: { icon: ShieldAlert, colorClass: 'text-rose-400', subColorClass: 'text-rose-400/70' },
  utilities: { icon: Zap, colorClass: 'text-cyan-400', subColorClass: 'text-cyan-400/70' },
  geography: { icon: Earth, colorClass: 'text-teal-400', subColorClass: 'text-teal-500/70' },
};

const MAP_STYLE_OPTIONS: Array<{
  type: MapStyleType;
  title: string;
  icon: React.ElementType;
  keywords: string[];
}> = [
  { type: 'street', title: '街道地圖', icon: Map, keywords: ['street', 'map', '街道', '道路地圖', '底圖', '風格'] },
  { type: 'satellite', title: '衛星影像', icon: Satellite, keywords: ['satellite', 'aerial', '衛星', '航拍', '影像', '底圖', '風格'] },
  { type: 'light', title: '淺色風格', icon: Sun, keywords: ['light', '淺色', '亮色', '底圖', '風格'] },
  { type: 'dark', title: '深色科技', icon: Moon, keywords: ['dark', 'night', '深色', '暗色', '科技', '底圖', '風格'] },
];

export default function LayerPanel() {
  const {
    mapStyleType,
    setMapStyleType,
    layers,
    toggleLayer,
    resetAllLayers,
    isLayerPanelOpen,
    toggleLayerPanel,
    toggleFlightSchedule,
    isFlightScheduleOpen,
    toggleFerrySchedule,
    isFerryScheduleOpen,
    toggleMaritimeSchedule,
    isMaritimeScheduleOpen,
    setPowerOutagesOpen,
    contourInterval,
    setContourInterval,
    hiddenLayersInPanel,
    disabledLayers,
    layerCustomColors,
  } = useUIStore();

  const [layerSearchQuery, setLayerSearchQuery] = React.useState('');
  const [searchCollapseOverrides, setSearchCollapseOverrides] = React.useState<Record<string, boolean>>({});

  const normalizedQuery = layerSearchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  React.useEffect(() => {
    setSearchCollapseOverrides({});
  }, [normalizedQuery]);

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
    if (isSearching) {
      setSearchCollapseOverrides((prev) => ({
        ...prev,
        [catId]: !prev[catId],
      }));
      return;
    }
    setCollapsedCategories((prev) => {
      const next = {
        ...prev,
        [catId]: !prev[catId],
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
    return Object.entries(layers).filter(([key, val]) => Boolean(val) && !disabledLayers?.[key]).length;
  }, [layers, disabledLayers]);

  const categoryMetaMap = React.useMemo(() => {
    return Object.fromEntries(LAYER_CATEGORIES.map((c) => [c.id, c])) as Record<LayerCategoryId, (typeof LAYER_CATEGORIES)[number]>;
  }, []);

  const transportGroupLabelMap = React.useMemo(() => {
    return Object.fromEntries(TRANSPORT_GROUPS.map((g) => [g.id, g.label])) as Record<string, string>;
  }, []);

  const matchesEntry = React.useCallback(
    (entry: LayerCatalogEntry): boolean => {
      if (!isSearching) return true;
      const cat = categoryMetaMap[entry.categoryId];
      const groupLabel = entry.transportGroup ? transportGroupLabelMap[entry.transportGroup] || '' : '';
      return (
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.buttonLabel.toLowerCase().includes(normalizedQuery) ||
        entry.id.toLowerCase().includes(normalizedQuery) ||
        (entry.title?.toLowerCase().includes(normalizedQuery) ?? false) ||
        entry.category.toLowerCase().includes(normalizedQuery) ||
        cat.english.toLowerCase().includes(normalizedQuery) ||
        groupLabel.toLowerCase().includes(normalizedQuery) ||
        entry.keywords.some((k) => k.toLowerCase().includes(normalizedQuery))
      );
    },
    [isSearching, normalizedQuery, categoryMetaMap, transportGroupLabelMap]
  );

  const visibleEntries = React.useMemo(() => {
    return LAYER_CATALOG.filter((entry) => {
      if (entry.showInLayerPanel === false) return false;
      const hideKey = entry.layerKey || entry.id;
      if (hiddenLayersInPanel?.[hideKey]) return false;
      return matchesEntry(entry);
    });
  }, [hiddenLayersInPanel, matchesEntry]);

  const visibleStyles = React.useMemo(() => {
    if (!isSearching) return MAP_STYLE_OPTIONS;
    if ('底圖風格'.includes(normalizedQuery) || 'street / satellite'.includes(normalizedQuery)) {
      return MAP_STYLE_OPTIONS;
    }
    return MAP_STYLE_OPTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(normalizedQuery) ||
        s.type.toLowerCase().includes(normalizedQuery) ||
        s.keywords.some((k) => k.toLowerCase().includes(normalizedQuery))
    );
  }, [isSearching, normalizedQuery]);

  const entriesByCategory = React.useMemo(() => {
    const grouped: Record<LayerCategoryId, LayerCatalogEntry[]> = {
      transport: [],
      road: [],
      lifestyle: [],
      nature: [],
      government: [],
      utilities: [],
      geography: [],
    };
    for (const entry of visibleEntries) {
      grouped[entry.categoryId].push(entry);
    }
    return grouped;
  }, [visibleEntries]);

  const categoryActiveCounts = React.useMemo(() => {
    const counts: Record<LayerCategoryId | 'styles', number> = {
      styles: 1,
      transport: 0,
      road: 0,
      lifestyle: 0,
      nature: 0,
      government: 0,
      utilities: 0,
      geography: 0,
    };
    for (const entry of LAYER_CATALOG) {
      if (entry.showInLayerPanel === false) continue;
      const hideKey = entry.layerKey || entry.id;
      if (hiddenLayersInPanel?.[hideKey]) continue;

      let active = false;
      if (entry.isSpecialAction === 'flightSchedule') active = isFlightScheduleOpen;
      else if (entry.isSpecialAction === 'ferrySchedule') active = isFerryScheduleOpen;
      else if (entry.isSpecialAction === 'maritimeSchedule') active = isMaritimeScheduleOpen;
      else if (entry.isSpecialAction === 'contours') active = contourInterval !== 'off';
      else if (entry.layerKey) active = !disabledLayers?.[entry.layerKey] && Boolean(layers[entry.layerKey]);

      if (active) {
        counts[entry.categoryId] += 1;
      }
    }
    return counts;
  }, [layers, disabledLayers, hiddenLayersInPanel, isFlightScheduleOpen, isFerryScheduleOpen, isMaritimeScheduleOpen, contourInterval]);

  const totalMatchesCount = (isSearching ? visibleEntries.length + (visibleStyles.length > 0 ? visibleStyles.length : 0) : 0);

  const isCategoryCollapsed = (catId: string): boolean => {
    if (isSearching) return !!searchCollapseOverrides[catId];
    return !!collapsedCategories[catId];
  };

  // Helper component for Style buttons (Icon only)
  const StyleButton = ({ type, icon: Icon, title }: { type: MapStyleType; icon: React.ElementType; title: string }) => {
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

  // Helper component for Layer & Special Action buttons
  const renderEntryButton = (entry: LayerCatalogEntry, forceIconOnly?: boolean) => {
    const Icon = ICON_MAP[entry.iconKey];
    const iconOnly = forceIconOnly ?? Boolean(entry.iconOnly);

    if (entry.isSpecialAction && entry.isSpecialAction !== 'contours') {
      const specialStateMap = {
        ferrySchedule: { active: isFerryScheduleOpen, toggle: toggleFerrySchedule },
        maritimeSchedule: { active: isMaritimeScheduleOpen, toggle: toggleMaritimeSchedule },
        flightSchedule: { active: isFlightScheduleOpen, toggle: toggleFlightSchedule },
      };
      const action = specialStateMap[entry.isSpecialAction];
      const isSpecialActive = action.active;
      return (
        <button
          key={entry.id}
          type="button"
          onClick={() => action.toggle()}
          className={`group relative flex items-center justify-center h-7 rounded border text-[10.5px] transition-all duration-150 select-none cursor-pointer ${
            isSpecialActive
              ? `${entry.activeBg} ${entry.activeBorder} ${entry.colorClass} ${entry.activeShadow || ''} font-semibold`
              : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-white font-normal'
          }`}
          title={entry.title || entry.name}
        >
          <Icon className={`w-3.5 h-3.5 shrink-0 ${isSpecialActive ? entry.colorClass : 'text-gray-500 group-hover:text-white'}`} />
          <span className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex items-center px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-white text-[10px] whitespace-nowrap shadow-lg z-50">
            {entry.name}
          </span>
        </button>
      );
    }

    if (!entry.layerKey) return null;
    const layerKey = entry.layerKey;
    const isDisabled = Boolean(disabledLayers && disabledLayers[layerKey]);
    const isActive = !isDisabled && layers[layerKey];
    const customColor = layerCustomColors?.[layerKey];
    const customStyle =
      !isDisabled && isActive && customColor
        ? {
            borderColor: customColor,
            color: customColor,
            backgroundColor: `${customColor}22`,
            boxShadow: `0 0 10px ${customColor}44`,
          }
        : undefined;

    return (
      <button
        key={entry.id}
        onClick={() => {
          if (isDisabled) return;
          toggleLayer(layerKey);
          if (layerKey === 'powerOutages') {
            setPowerOutagesOpen(!isActive);
          }
        }}
        disabled={isDisabled}
        style={customStyle}
        className={`flex items-center gap-1.5 px-2 h-7 rounded border text-[10.5px] transition-all duration-150 justify-center truncate ${
          isDisabled
            ? 'bg-[#151619] border-[#222327] text-gray-600 opacity-40 cursor-not-allowed font-normal'
            : isActive
              ? `${entry.activeBg} ${entry.activeBorder} ${entry.colorClass} ${entry.activeShadow || ''} font-semibold`
              : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200 font-normal'
        }`}
        title={isDisabled ? `${entry.name} (此圖層底層資料已被管理員關閉)` : entry.title || entry.name}
      >
        <Icon
          className={`w-3.5 h-3.5 shrink-0 ${isDisabled ? 'text-gray-600' : isActive ? '' : 'text-gray-500'}`}
          style={!isDisabled && isActive && customColor ? { color: customColor } : undefined}
        />
        {!iconOnly && <span className="truncate">{entry.buttonLabel}</span>}
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
    matchCount,
  }: {
    id: string;
    title: string;
    english: string;
    icon?: React.ElementType;
    colorClass?: string;
    subColorClass?: string;
    matchCount?: number;
  }) => {
    const isCollapsed = isCategoryCollapsed(id);
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
          {isSearching && typeof matchCount === 'number' && matchCount > 0 && (
            <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-mono">
              {matchCount}
            </span>
          )}
          {!isSearching && isCollapsed && activeCount > 0 && id !== 'styles' && (
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLayerPanelOpen) {
    return null;
  }

  const visibleCategorySections = LAYER_CATEGORIES.filter((cat) => entriesByCategory[cat.id].length > 0);
  const showStylesSection = !isSearching || visibleStyles.length > 0;
  const hasAnySearchResults = visibleStyles.length > 0 || visibleCategorySections.length > 0;

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

        {/* Sticky Layer Quick Search Bar */}
        <div className="px-2.5 py-2 border-b border-[#26282d] bg-[#161719] shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={layerSearchQuery}
              onChange={(e) => setLayerSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && layerSearchQuery) {
                  setLayerSearchQuery('');
                }
              }}
              placeholder="搜尋圖層名稱或分類..."
              className="w-full bg-[#12141a] border border-[#2b303e] rounded-lg pl-8 pr-14 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/80 transition-colors"
            />
            {isSearching && (
              <div className="absolute right-1.5 flex items-center gap-1">
                <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {totalMatchesCount}
                </span>
                <button
                  type="button"
                  onClick={() => setLayerSearchQuery('')}
                  className="text-gray-400 hover:text-white p-0.5 rounded cursor-pointer"
                  title="清除搜尋"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Body with custom scrollbar */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3036] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#42454d]">
          {/* Empty Search State */}
          {isSearching && !hasAnySearchResults && (
            <div className="flex flex-col items-center justify-center py-10 px-3 text-center gap-2.5 bg-[#12141a]/80 border border-[#26282d] rounded-xl">
              <Search className="w-6 h-6 text-gray-500" />
              <div className="text-xs font-semibold text-gray-300">
                找不到與「{layerSearchQuery.trim()}」相符的圖層
              </div>
              <p className="text-[10.5px] text-gray-500 leading-relaxed">
                可嘗試搜尋圖層名稱、分類（交通 / 道路 / 安全 / 能源）或英文關鍵字
              </p>
              <button
                type="button"
                onClick={() => setLayerSearchQuery('')}
                className="px-3 py-1 rounded-lg bg-[#1c1f29] hover:bg-[#252936] border border-[#2e3444] text-emerald-400 text-[11px] font-semibold transition-colors cursor-pointer"
              >
                清除搜尋
              </button>
            </div>
          )}

          {/* 1. Map Styles (底圖風格) */}
          {showStylesSection && (
            <div className="flex flex-col gap-1.5">
              <CategoryHeader
                id="styles"
                title="底圖風格"
                english="STREET / SATELLITE"
                matchCount={isSearching ? visibleStyles.length : undefined}
              />
              {!isCategoryCollapsed('styles') && (
                <div className="grid grid-cols-4 gap-1 animate-in fade-in duration-150">
                  {visibleStyles.map((styleOpt) => (
                    <StyleButton key={styleOpt.type} type={styleOpt.type} title={styleOpt.title} icon={styleOpt.icon} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 2..8 Layer Categories (In-place Category Filtering + Auto-Expand) */}
          {visibleCategorySections.map((cat, idx) => {
            const entries = entriesByCategory[cat.id];
            const visuals = CATEGORY_VISUALS[cat.id];
            const collapsed = isCategoryCollapsed(cat.id);
            const isGeography = cat.id === 'geography';
            const contoursEntry = isGeography ? entries.find((e) => e.isSpecialAction === 'contours') : undefined;
            const regularEntries = isGeography ? entries.filter((e) => e.isSpecialAction !== 'contours') : entries;
            const showDivider = showStylesSection || idx > 0;

            return (
              <React.Fragment key={cat.id}>
                {showDivider && <div className="w-full h-px bg-[#26282d]" />}

                <div className={`flex flex-col ${isGeography ? 'gap-2 pb-2' : 'gap-1.5'}`}>
                  <CategoryHeader
                    id={cat.id}
                    title={cat.title}
                    english={cat.english}
                    icon={visuals.icon}
                    colorClass={visuals.colorClass}
                    subColorClass={visuals.subColorClass}
                    matchCount={isSearching ? entries.length : undefined}
                  />

                  {!collapsed && (
                    <>
                      {cat.id === 'transport' ? (
                        <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                          {TRANSPORT_GROUPS.map((group) => {
                            const groupEntries = regularEntries.filter((e) => e.transportGroup === group.id);
                            if (groupEntries.length === 0) return null;
                            return (
                              <div key={group.id} className={`grid ${group.gridClass} gap-1 items-center`}>
                                <span className={`text-[11px] font-medium ${group.labelClass} pl-0.5`}>
                                  {group.label}
                                </span>
                                {groupEntries.map((entry) => renderEntryButton(entry, true))}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={`flex flex-col ${isGeography ? 'gap-2' : 'gap-1'} animate-in fade-in duration-150`}>
                          {regularEntries.length > 0 && (
                            <div className="grid grid-cols-2 gap-1">
                              {regularEntries.map((entry) => renderEntryButton(entry, false))}
                            </div>
                          )}

                          {isGeography && contoursEntry && (
                            <>
                              <div className="text-[10px] font-bold text-teal-400 tracking-wider flex items-center justify-between pt-1">
                                <div className="flex items-center gap-1">
                                  <Mountain className="w-3 h-3 text-teal-400" />
                                  <span>等高線</span>
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    contourInterval === 'off'
                                      ? 'bg-[#1c1d21] text-gray-400 border-[#2d2e32]'
                                      : 'bg-teal-950/80 text-teal-300 border-teal-500/50 shadow-[0_0_6px_rgba(20,184,166,0.2)]'
                                  }`}
                                >
                                  {contourInterval === 'off'
                                    ? 'OFF 關閉'
                                    : `${contourInterval === '1m' ? '1米' : contourInterval === '2m' ? '2米' : '10米'}間距`}
                                </span>
                              </div>

                              <div className="bg-[#1c1d21] p-2 rounded-lg border border-[#2d2e32] flex flex-col gap-2 shadow-inner">
                                <div className="relative flex items-center px-1">
                                  <input
                                    type="range"
                                    min="0"
                                    max="3"
                                    step="1"
                                    aria-label="等高線間隔選擇"
                                    value={
                                      contourInterval === 'off'
                                        ? 0
                                        : contourInterval === '1m'
                                          ? 1
                                          : contourInterval === '2m'
                                            ? 2
                                            : 3
                                    }
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      const opts: ('off' | '1m' | '2m' | '10m')[] = ['off', '1m', '2m', '10m'];
                                      setContourInterval(opts[val]);
                                    }}
                                    className="w-full h-1.5 bg-[#2a2b30] rounded-lg appearance-none cursor-pointer accent-teal-400 focus:outline-none"
                                  />
                                </div>

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
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </>
  );
}
