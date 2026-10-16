'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { 
  Map, Satellite, Sun, Moon, Bus, Layers, Route, Ship, 
  CircleDollarSign, Accessibility, Bike, Zap, Scooter, Camera, Siren, 
  Flame, Building2, Hospital, ChevronLeft, Trees, Footprints, Flower2, 
  Droplets, Bath, Leaf, Landmark, GraduationCap, BookOpen, UtensilsCrossed, Bed, Heart,
  PlaneTakeoff, Calendar, Car, ShieldAlert, LifeBuoy, HeartPulse, Mountain,
  Compass, MapPin, Fuel, Train, Anchor, ArrowRight, Snowflake, Fingerprint, Waves,
  Gauge, Mail, Radio, Trash2, Soup, Recycle, RotateCcw
} from 'lucide-react';

// Helper component for Tesla Icon
const TeslaIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 4.2c2.2 0 4.4.4 6.2 1.2.3.1.6 0 .7-.2l.7-1.1c.1-.2 0-.5-.2-.6C17.1 2.5 14.6 2 12 2S6.9 2.5 4.6 3.5c-.2.1-.3.4-.2.6l.7 1.1c.1.2.4.3.7.2 1.8-.8 4-1.2 6.2-1.2zm0 3.3c-1.7 0-3.3.3-4.8.9-.3.1-.4.4-.3.7l.6 1.8c.1.2.3.4.5.3 1.3-.4 2.6-.6 4-.6s2.7.2 4 .6c.2.1.4-.1.5-.3l.6-1.8c.1-.3 0-.6-.3-.7-1.5-.6-3.1-.9-4.8-.9zm1.3 4.2h-2.6v9.8c0 .3.2.5.5.5h1.6c.3 0 .5-.2.5-.5V11.7z"/>
  </svg>
);

export default function LayerPanel() {
  const { 
    mapStyleType, setMapStyleType, layers, toggleLayer, resetAllLayers,
    isLayerPanelOpen, toggleLayerPanel, toggleFlightSchedule,
    contourInterval, setContourInterval
  } = useUIStore();

  const activeLayerCount = React.useMemo(() => {
    return Object.values(layers).filter(Boolean).length;
  }, [layers]);


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
    className?: string
  }) => {
    const isActive = layers[layerKey];
    return (
      <button
        onClick={() => toggleLayer(layerKey)}
        className={`flex items-center gap-1.5 px-2 h-7 rounded border text-[10.5px] transition-all duration-150 justify-center truncate ${className} ${
          isActive 
            ? `${activeBg} ${activeBorder} ${colorClass} ${activeShadow} font-semibold` 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200 font-normal'
        }`}
        title={label}
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? '' : 'text-gray-500'}`} />
        {!iconOnly && <span className="truncate">{label}</span>}
      </button>
    );
  };

  if (!isLayerPanelOpen) {
    return null;
  }

  return (
    <div className="fixed top-[60px] left-0 bottom-0 z-30 w-[240px] bg-[#161719] border-r border-[#2d2e32] flex flex-col shadow-2xl select-none">
      
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
            <RotateCcw className="w-2.5 h-2.5 shrink-0" />
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
        
        {/* Map Styles */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-gray-400 tracking-wider flex items-center justify-between">
            <span>底圖風格</span>
            <span className="text-[9px] text-gray-500 font-normal">STREET / SATELLITE</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <StyleButton type="street" title="街道地圖" icon={Map} />
            <StyleButton type="satellite" title="衛星影像" icon={Satellite} />
            <StyleButton type="light" title="淺色風格" icon={Sun} />
            <StyleButton type="dark" title="深色科技" icon={Moon} />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Transport Row (交通) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-gray-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Bus className="w-3 h-3 text-emerald-400" />
              <span>交通</span>
            </div>
            <span className="text-[9px] text-gray-500 font-mono">TRANSPORT</span>
          </div>

          <div className="flex flex-col gap-1">
            {/* 巴士 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-emerald-400 pl-0.5">巴士</span>
              <LayerButton layerKey="bus" label="車輛" icon={Bus} iconOnly colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
              <LayerButton layerKey="busRoutes" label="路線" icon={Route} iconOnly colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
            </div>

            {/* 天車 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-blue-400 pl-0.5">天車</span>
              <LayerButton layerKey="skytrainTrains" label="列車 (推算)" icon={Train} iconOnly colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
              <LayerButton layerKey="skytrainRoutes" label="路線" icon={Route} iconOnly colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" />
            </div>

            {/* 海上巴士 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-[#d8baaa] pl-0.5">海上巴士</span>
              <LayerButton layerKey="seabusVehicles" label="船隻" icon={Ship} iconOnly colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" activeShadow="shadow-[0_0_6px_rgba(139,120,109,0.2)]" />
              <LayerButton layerKey="seabusRoutes" label="路線" icon={Route} iconOnly colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" />
            </div>

            {/* 卑詩渡輪 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-[#3399ff] pl-0.5">卑詩渡輪</span>
              <LayerButton layerKey="bcferriesVehicles" label="船隻" icon={Ship} iconOnly colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" activeShadow="shadow-[0_0_6px_rgba(0,96,169,0.2)]" />
              <LayerButton layerKey="bcferriesRoutes" label="路線" icon={Route} iconOnly colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" />
            </div>

            {/* 船運 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-cyan-400 pl-0.5">船運</span>
              <LayerButton layerKey="maritimeShipping" label="船隻" icon={Ship} iconOnly colorClass="text-cyan-400" activeBg="bg-[#0e2730]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.2)]" />
              <LayerButton layerKey="marineTerminals" label="碼頭" icon={Anchor} iconOnly colorClass="text-cyan-400" activeBg="bg-[#0e2730]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.2)]" />
            </div>

            {/* 航空 */}
            <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-center">
              <span className="text-[11px] font-medium text-sky-400 pl-0.5">航空</span>
              <LayerButton layerKey="airports" label="機場" icon={PlaneTakeoff} iconOnly colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
              <button
                onClick={() => toggleFlightSchedule()}
                className="flex items-center justify-center gap-1 px-1 h-7 rounded text-[10px] border transition-all truncate text-left select-none bg-[#1c1d21] border-[#2d2e32] text-amber-300 hover:bg-[#2e2618] hover:border-amber-500/50 hover:text-amber-200 font-medium shadow-[0_0_4px_rgba(245,158,11,0.1)] active:scale-[0.98]"
                title="查看 YVR 航班即時看板 (到港/離港)"
              >
                <Calendar className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">航班班次</span>
              </button>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Road Infrastructure Row (道路) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-amber-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CircleDollarSign className="w-3 h-3 text-amber-400" />
              <span>道路</span>
            </div>
            <span className="text-[9px] text-amber-500/70 font-mono">ROAD</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {/* Row 1: 停車收費錶 | 加油站 */}
            <LayerButton layerKey="parkingMeters" label="停車收費錶" icon={CircleDollarSign} colorClass="text-amber-400" activeBg="bg-[#2a2418]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="fuel" label="加油站" icon={Fuel} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />

            {/* Row 2: 摩托車停車位 | 無障礙停車位 */}
            <LayerButton layerKey="motorcycleParking" label="摩托車停車位" icon={Bike} colorClass="text-orange-400" activeBg="bg-[#2c1d18]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(251,146,60,0.15)]" />
            <LayerButton layerKey="accessibleParking" label="無障礙停車位" icon={Accessibility} colorClass="text-sky-400" activeBg="bg-[#182633]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />

            {/* Row 3: 單程路 | 限速路段 */}
            <LayerButton layerKey="oneWayStreets" label="單程路" icon={ArrowRight} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="trafficSpeedLimits" label="限速路段" icon={Gauge} colorClass="text-emerald-400" activeBg="bg-[#142820]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />

            {/* Row 4: 斑馬線 | 共享汽車 */}
            <LayerButton layerKey="trafficCrosswalks" label="斑馬線" icon={Footprints} colorClass="text-yellow-400" activeBg="bg-[#2a2414]" activeBorder="border-yellow-500/50" activeShadow="shadow-[0_0_6px_rgba(234,179,8,0.15)]" />
            <LayerButton layerKey="carSharing" label="共享汽車" icon={Car} colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />

            {/* Row 5: 單車徑 | 單車架 */}
            <LayerButton layerKey="bikeways" label="單車徑" icon={Route} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="bikeRacks" label="單車架" icon={Bike} colorClass="text-teal-400" activeBg="bg-[#102724]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />

            {/* Row 6: 共享單車 | 共享滑板車 */}
            <LayerButton layerKey="sharedBikes" label="共享單車" icon={Bike} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="escooter" label="共享滑板車" icon={Scooter} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_6px_rgba(132,204,22,0.15)]" />

            {/* Row 7: 電動車充電站 | TESLA */}
            <LayerButton layerKey="evCharging" label="電動車充電站" icon={Zap} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(52,211,153,0.15)]" />
            <LayerButton layerKey="tesla" label="TESLA" icon={TeslaIcon} colorClass="text-red-500" activeBg="bg-[#2d1417]" activeBorder="border-red-500/60" activeShadow="shadow-[0_0_8px_rgba(232,33,39,0.3)]" />

            {/* Row 8: 交通攝影機 | 路口安全相機 */}
            <LayerButton layerKey="trafficCameras" label="交通攝影機" icon={Camera} colorClass="text-cyan-400" activeBg="bg-[#14262b]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.15)]" />
            <LayerButton layerKey="safetyCameras" label="路口安全相機" icon={Siren} colorClass="text-rose-400" activeBg="bg-[#2b171c]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />

            {/* Row 9: 鏟雪路線 */}
            <LayerButton layerKey="snowRemovalRoutes" label="鏟雪路線" icon={Snowflake} colorClass="text-sky-300" activeBg="bg-[#0f2938]" activeBorder="border-sky-400/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.2)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Lifestyle Row (生活) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-amber-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Heart className="w-3 h-3 text-amber-400" />
              <span>生活</span>
            </div>
            <span className="text-[9px] text-amber-500/70 font-mono">LIFESTYLE</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="schools" label="學校" icon={GraduationCap} colorClass="text-blue-400" activeBg="bg-[#142334]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
            <LayerButton layerKey="libraries" label="圖書館" icon={BookOpen} colorClass="text-amber-400" activeBg="bg-[#292215]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="foodVendors" label="食品攤販" icon={UtensilsCrossed} colorClass="text-orange-400" activeBg="bg-[#2b1e16]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(251,146,60,0.15)]" />
            <LayerButton layerKey="foodBanks" label="食物銀行" icon={Soup} colorClass="text-emerald-400" activeBg="bg-[#142820]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="recycling" label="環保回收" icon={Recycle} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="homelessShelters" label="無家者庇護所" icon={Bed} colorClass="text-rose-400" activeBg="bg-[#2a171d]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
            <LayerButton layerKey="litterContainers" label="垃圾箱" icon={Trash2} colorClass="text-amber-400" activeBg="bg-[#282115]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="aed" label="AED 去顫器" icon={HeartPulse} colorClass="text-red-400" activeBg="bg-[#2c1518]" activeBorder="border-red-500/50" activeShadow="shadow-[0_0_6px_rgba(239,68,68,0.15)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Nature Row (自然) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-emerald-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Leaf className="w-3 h-3 text-emerald-400" />
              <span>自然</span>
            </div>
            <span className="text-[9px] text-emerald-500/70 font-mono">NATURE</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="parks" label="公園" icon={Trees} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="parksFacilities" label="休憩設施" icon={Footprints} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="communityGardens" label="社區花園" icon={Flower2} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_6px_rgba(132,204,22,0.15)]" />
            <LayerButton layerKey="communityCentres" label="社區中心" icon={Building2} colorClass="text-violet-400" activeBg="bg-[#211a2f]" activeBorder="border-violet-500/50" activeShadow="shadow-[0_0_6px_rgba(139,92,246,0.15)]" />
            <LayerButton layerKey="drinkingFountains" label="飲水器" icon={Droplets} colorClass="text-sky-400" activeBg="bg-[#142533]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
            <LayerButton layerKey="publicWashrooms" label="公共廁所" icon={Bath} colorClass="text-cyan-400" activeBg="bg-[#13272e]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.15)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Government Row (政府) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-rose-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Landmark className="w-3 h-3 text-rose-400" />
              <span>政府</span>
            </div>
            <span className="text-[9px] text-rose-400/70 font-mono">GOVERNMENT</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="fireHalls" label="消防" icon={Flame} colorClass="text-rose-400" activeBg="bg-[#2a171a]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
            <LayerButton layerKey="hospitals" label="醫療" icon={Hospital} colorClass="text-emerald-400" activeBg="bg-[#13271d]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="police" label="警察" icon={ShieldAlert} colorClass="text-blue-400" activeBg="bg-[#142338]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
            <LayerButton layerKey="crimeAreas" label="罪案地區" icon={Fingerprint} colorClass="text-rose-400" activeBg="bg-[#2c1619]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.2)]" />
            <LayerButton layerKey="disasterHubs" label="災害支援中心" icon={LifeBuoy} colorClass="text-amber-400" activeBg="bg-[#2a2214]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Utilities Row (公共事業) - 位於政府類別下方 */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-cyan-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Droplets className="w-3 h-3 text-cyan-400" />
              <span>公共事業</span>
            </div>
            <span className="text-[9px] text-cyan-400/70 font-mono">UTILITIES</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="waterDistributionMains" label="自來水管道" icon={Droplets} colorClass="text-sky-400" activeBg="bg-[#102436]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(14,165,233,0.15)]" />
            <LayerButton layerKey="sewerMains" label="污水管道" icon={Waves} colorClass="text-teal-400" activeBg="bg-[#102826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="wirelessFacilities" label="無線設施" icon={Radio} colorClass="text-purple-400" activeBg="bg-[#241733]" activeBorder="border-purple-500/50" activeShadow="shadow-[0_0_6px_rgba(168,85,247,0.15)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Geography Row (地理) */}
        <div className="flex flex-col gap-2 pb-2">
          <div className="text-[10px] font-bold text-teal-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Compass className="w-3 h-3 text-teal-400" />
              <span>地理</span>
            </div>
            <span className="text-[9px] text-teal-500/70 font-mono">GEOGRAPHY</span>
          </div>

          {/* 區域邊界按鈕 (等高線上方) */}
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="localAreaBoundary" label="區域邊界" icon={MapPin} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="postalCodeFSA" label="郵遞編號" icon={Mail} colorClass="text-indigo-400" activeBg="bg-[#181a33]" activeBorder="border-indigo-500/50" activeShadow="shadow-[0_0_6px_rgba(99,102,241,0.15)]" />
          </div>

          {/* 等高線文字與狀態標籤 (地理文字下方、拉動條上方) */}
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

      </div>
    </div>
  );
}
