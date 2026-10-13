'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { 
  Map, Satellite, Sun, Moon, Bus, Layers, Route, Ship, 
  CircleDollarSign, Accessibility, Bike, Zap, Scooter, Camera, Siren, 
  Flame, Building2, Hospital, ChevronLeft, Trees, Footprints, Flower2, 
  Droplets, Bath, Leaf, Landmark, GraduationCap, BookOpen, UtensilsCrossed, Bed, Heart,
  Plane, PlaneTakeoff, Calendar
} from 'lucide-react';

export default function LayerPanel() {
  const { mapStyleType, setMapStyleType, layers, toggleLayer, isLayerPanelOpen, toggleLayerPanel, toggleFlightSchedule } = useUIStore();


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
    colorClass = 'text-blue-400', 
    activeBg = 'bg-[#1a1f2e]', 
    activeBorder = 'border-blue-500/50', 
    activeShadow = 'shadow-[0_0_6px_rgba(59,130,246,0.1)]',
    className = ''
  }: { 
    layerKey: keyof typeof layers, 
    label: string, 
    icon: React.ElementType, 
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
        <Icon className={`w-3 h-3 shrink-0 ${isActive ? '' : 'text-gray-500'}`} />
        <span className="truncate">{label}</span>
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
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs font-bold text-gray-200 tracking-wide">圖層控制</span>
        </div>
        <button 
          onClick={toggleLayerPanel}
          className="text-gray-400 hover:text-white p-1 hover:bg-[#26282e] rounded transition-colors"
          title="收合面板"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
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

        {/* Bus Row */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-emerald-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Bus className="w-3 h-3" />
              <span>大眾運輸 · 巴士</span>
            </div>
            <span className="text-[9px] text-emerald-500/70 font-mono">TransLink</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="bus" label="車輛" icon={Bus} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="busRoutes" label="路線" icon={Route} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
          </div>
        </div>

        {/* SkyTrain Row */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-blue-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Route className="w-3 h-3" />
              <span>大眾運輸 · 天車</span>
            </div>
            <span className="text-[9px] text-blue-400/70 font-mono">SkyTrain</span>
          </div>
          <div className="grid grid-cols-1 gap-1">
            <LayerButton layerKey="skytrainRoutes" label="路線" icon={Route} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_6px_rgba(59,130,246,0.15)]" />
          </div>
        </div>

        {/* SeaBus Row */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-[#d8baaa] tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Ship className="w-3 h-3 text-[#d8baaa]" />
              <span>海上巴士</span>
            </div>
            <span className="text-[9px] text-[#8b786d] font-mono">SeaBus</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="seabusVehicles" label="船隻" icon={Ship} colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" activeShadow="shadow-[0_0_6px_rgba(139,120,109,0.2)]" />
            <LayerButton layerKey="seabusRoutes" label="路線" icon={Route} colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" />
          </div>
        </div>

        {/* BC Ferries Row */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-[#3399ff] tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Ship className="w-3 h-3 text-[#3399ff]" />
              <span>卑詩渡輪</span>
            </div>
            <span className="text-[9px] text-[#0060a9] font-mono">BC Ferries</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="bcferriesVehicles" label="渡輪" icon={Ship} colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" activeShadow="shadow-[0_0_6px_rgba(0,96,169,0.2)]" />
            <LayerButton layerKey="bcferriesRoutes" label="路線" icon={Route} colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>

        {/* Aviation Row (航空) */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-sky-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Plane className="w-3 h-3 text-sky-400" />
              <span>航空</span>
            </div>
            <span className="text-[9px] text-sky-500/70 font-mono">AVIATION · YVR</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="airports" label="機場" icon={PlaneTakeoff} colorClass="text-sky-400" activeBg="bg-[#102336]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
            <button
              onClick={() => toggleFlightSchedule()}
              className="flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[11px] border transition-all truncate text-left select-none bg-[#1c1d21] border-[#2d2e32] text-amber-300 hover:bg-[#2e2618] hover:border-amber-500/50 hover:text-amber-200 font-medium shadow-[0_0_4px_rgba(245,158,11,0.1)] active:scale-[0.98]"
              title="查看 YVR 航班即時看板 (到港/離港)"
            >
              <Calendar className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate">航班班次</span>
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#26282d]"></div>


        {/* Road Infrastructure Row */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-amber-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CircleDollarSign className="w-3 h-3 text-amber-400" />
              <span>道路設施</span>
            </div>
            <span className="text-[9px] text-amber-500/70 font-mono">ROAD INFRA</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="parkingMeters" label="停車收費錶" icon={CircleDollarSign} colorClass="text-amber-400" activeBg="bg-[#2a2418]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_6px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="accessibleParking" label="無障礙停車位" icon={Accessibility} colorClass="text-sky-400" activeBg="bg-[#182633]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_6px_rgba(56,189,248,0.15)]" />
            <LayerButton layerKey="motorcycleParking" label="摩托車停車位" icon={Bike} colorClass="text-orange-400" activeBg="bg-[#2c1d18]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_6px_rgba(251,146,60,0.15)]" />
            <LayerButton layerKey="evCharging" label="電動車充電站" icon={Zap} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(52,211,153,0.15)]" />
            <LayerButton layerKey="escooter" label="共享滑板車" icon={Scooter} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_6px_rgba(132,204,22,0.15)]" />
            {/* 預留 1 格將來放置「共享汽車」 */}
            <div className="h-7 rounded border border-dashed border-[#26282e]/50 bg-[#18191d]/30 pointer-events-none" aria-hidden="true" />
            <LayerButton layerKey="sharedBikes" label="共享單車" icon={Bike} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
            <LayerButton layerKey="bikeways" label="單車徑" icon={Route} colorClass="text-teal-400" activeBg="bg-[#122826]" activeBorder="border-teal-500/50" activeShadow="shadow-[0_0_6px_rgba(20,184,166,0.15)]" />
            <LayerButton layerKey="trafficCameras" label="交通攝影機" icon={Camera} colorClass="text-cyan-400" activeBg="bg-[#14262b]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_6px_rgba(6,182,212,0.15)]" />
            <LayerButton layerKey="safetyCameras" label="路口安全相機" icon={Siren} colorClass="text-rose-400" activeBg="bg-[#2b171c]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
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
            <LayerButton layerKey="homelessShelters" label="無家者庇護所" icon={Bed} colorClass="text-rose-400" activeBg="bg-[#2a171d]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
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
        <div className="flex flex-col gap-1.5 pb-2">
          <div className="text-[10px] font-bold text-rose-400 tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Landmark className="w-3 h-3 text-rose-400" />
              <span>政府</span>
            </div>
            <span className="text-[9px] text-rose-400/70 font-mono">GOVERNMENT</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <LayerButton layerKey="fireHalls" label="消防" icon={Flame} colorClass="text-rose-400" activeBg="bg-[#2a171a]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_6px_rgba(244,63,94,0.15)]" />
            <LayerButton layerKey="hospitals" label="醫院" icon={Hospital} colorClass="text-emerald-400" activeBg="bg-[#13271d]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_6px_rgba(16,185,129,0.15)]" />
          </div>
        </div>

      </div>
    </div>
  );
}
