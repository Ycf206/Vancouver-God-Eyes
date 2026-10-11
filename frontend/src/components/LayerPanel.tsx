'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { Map, Satellite, Sun, Moon, Bus, Layers, CircleDot, Route, Ship, CircleDollarSign, Accessibility, Bike, Zap, Scooter, Camera, Siren, Flame, Building2, Hospital } from 'lucide-react';

export default function LayerPanel() {
  const { mapStyleType, setMapStyleType, layers, toggleLayer } = useUIStore();
  const [isOpen, setIsOpen] = React.useState(true);

  // Helper component for Style buttons (Icon only)
  const StyleButton = ({ type, icon: Icon, title }: { type: MapStyleType, icon: React.ElementType, title: string }) => {
    const isActive = mapStyleType === type;
    return (
      <button
        onClick={() => setMapStyleType(type)}
        title={title}
        className={`flex items-center justify-center w-full h-8 rounded-md border transition-all duration-200 tooltip ${
          isActive 
            ? 'bg-[#1a1f2e] border-emerald-500/50 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]' 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className="w-4 h-4" />
      </button>
    );
  };

  // Helper component for horizontal Layer buttons
  const LayerButton = ({ 
    layerKey, 
    label, 
    icon: Icon, 
    colorClass = 'text-blue-400', 
    activeBg = 'bg-[#1a1f2e]', 
    activeBorder = 'border-blue-500/50', 
    activeShadow = 'shadow-[0_0_8px_rgba(59,130,246,0.1)]',
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
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] transition-all duration-200 justify-center ${className} ${
          isActive 
            ? `${activeBg} ${activeBorder} ${colorClass} ${activeShadow}` 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className={`w-3.5 h-3.5 ${isActive ? '' : 'text-gray-500'}`} />
        <span className="font-medium">{label}</span>
      </button>
    );
  };

  if (!isOpen) {
    return (
      <div className="absolute top-[80px] left-4 z-40">
        <button 
          onClick={() => setIsOpen(true)}
          className="flex items-center justify-center w-8 h-8 bg-[#161719] border border-[#2d2e32] rounded-md text-white shadow-lg hover:bg-[#202125]"
        >
          <Layers className="w-4 h-4 text-emerald-500" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-[80px] left-4 z-40 w-[380px] bg-[#161719]/95 backdrop-blur-md border border-[#2d2e32] rounded-lg shadow-2xl flex flex-col overflow-hidden">
      
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2d2e32] bg-[#1a1b1e]">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs font-semibold text-gray-200">圖層控制</span>
        </div>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-3">
        
        {/* Map Styles Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-center">
          <div className="text-[11px] font-bold text-gray-500 tracking-wider">地圖</div>
          <div className="grid grid-cols-4 gap-1.5">
            <StyleButton type="street" title="街道" icon={Map} />
            <StyleButton type="satellite" title="衛星" icon={Satellite} />
            <StyleButton type="light" title="淺色" icon={Sun} />
            <StyleButton type="dark" title="深色" icon={Moon} />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#2d2e32]"></div>

        {/* Traffic Row (Bus) */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-center">
          <div className="text-[11px] font-bold text-emerald-500 tracking-wider">巴士</div>
          <div className="grid grid-cols-3 gap-1.5">
            <LayerButton layerKey="bus" label="車輛" icon={Bus} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_8px_rgba(16,185,129,0.1)]" />
            <LayerButton layerKey="busRoutes" label="路線" icon={Route} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
            <LayerButton layerKey="busStops" label="車站" icon={CircleDot} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
          </div>
        </div>

        {/* SkyTrain Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-center">
          <div className="text-[11px] font-bold text-blue-400 tracking-wider">天車</div>
          <div className="grid grid-cols-3 gap-1.5">
            <div></div>
            <LayerButton layerKey="skytrainRoutes" label="路線" icon={Route} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_8px_rgba(59,130,246,0.1)]" />
            <LayerButton layerKey="skytrainStops" label="車站" icon={CircleDot} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" />
          </div>
        </div>

        {/* SeaBus Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-center">
          <div className="text-[10px] font-bold text-[#8b786d] tracking-wider">海上巴士</div>
          <div className="grid grid-cols-3 gap-1.5">
            <LayerButton layerKey="seabusVehicles" label="船隻" icon={Ship} colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" activeShadow="shadow-[0_0_8px_rgba(139,120,109,0.2)]" />
            <LayerButton layerKey="seabusRoutes" label="路線" icon={Route} colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" />
            <LayerButton layerKey="seabusStops" label="車站" icon={CircleDot} colorClass="text-[#d8baaa]" activeBg="bg-[#2a221f]" activeBorder="border-[#8b786d]/50" />
          </div>
        </div>

        {/* BC Ferries Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-center">
          <div className="text-[10px] font-bold text-[#0060a9] tracking-wider leading-tight">卑詩渡輪</div>
          <div className="grid grid-cols-3 gap-1.5">
            <LayerButton layerKey="bcferriesVehicles" label="渡輪" icon={Ship} colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" activeShadow="shadow-[0_0_8px_rgba(0,96,169,0.2)]" />
            <LayerButton layerKey="bcferriesRoutes" label="航線" icon={Route} colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" />
            <LayerButton layerKey="bcferriesTerminals" label="碼頭" icon={CircleDot} colorClass="text-[#3399ff]" activeBg="bg-[#0f1b2e]" activeBorder="border-[#0060a9]/50" />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-700/60 my-1"></div>

        {/* Road Infrastructure Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-start pt-1">
          <div className="text-[11px] font-bold text-amber-400 tracking-wider pt-2">道路</div>
          <div className="grid grid-cols-2 gap-1.5">
            <LayerButton layerKey="parkingMeters" label="停車收費錶" icon={CircleDollarSign} colorClass="text-amber-400" activeBg="bg-[#2a2418]" activeBorder="border-amber-500/50" activeShadow="shadow-[0_0_8px_rgba(245,158,11,0.15)]" />
            <LayerButton layerKey="accessibleParking" label="無障礙停車位" icon={Accessibility} colorClass="text-sky-400" activeBg="bg-[#182633]" activeBorder="border-sky-500/50" activeShadow="shadow-[0_0_8px_rgba(56,189,248,0.15)]" />
            <LayerButton layerKey="motorcycleParking" label="摩托車停車位" icon={Bike} colorClass="text-orange-400" activeBg="bg-[#2c1d18]" activeBorder="border-orange-500/50" activeShadow="shadow-[0_0_8px_rgba(251,146,60,0.15)]" />
            <LayerButton layerKey="evCharging" label="電動車充電站" icon={Zap} colorClass="text-emerald-400" activeBg="bg-[#14291f]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_8px_rgba(52,211,153,0.15)]" />
            <LayerButton layerKey="escooter" label="共享電動滑板車" icon={Scooter} colorClass="text-lime-400" activeBg="bg-[#1e2a14]" activeBorder="border-lime-500/50" activeShadow="shadow-[0_0_8px_rgba(132,204,22,0.15)]" />
            <div></div>
            <LayerButton layerKey="trafficCameras" label="交通攝影機" icon={Camera} colorClass="text-cyan-400" activeBg="bg-[#14262b]" activeBorder="border-cyan-500/50" activeShadow="shadow-[0_0_8px_rgba(6,182,212,0.15)]" />
            <LayerButton layerKey="safetyCameras" label="路口安全攝影機" icon={Siren} colorClass="text-rose-400" activeBg="bg-[#2b171c]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_8px_rgba(244,63,94,0.15)]" />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-700/60 my-1"></div>

        {/* Government Row */}
        <div className="grid grid-cols-[60px_1fr] gap-3 items-start pt-1">
          <div className="text-[11px] font-bold text-rose-400 tracking-wider pt-2">政府</div>
          <div className="grid grid-cols-2 gap-1.5">
            <LayerButton layerKey="fireHalls" label="消防局" icon={Flame} colorClass="text-rose-400" activeBg="bg-[#2a171a]" activeBorder="border-rose-500/50" activeShadow="shadow-[0_0_8px_rgba(244,63,94,0.15)]" />
            <LayerButton layerKey="communityCentres" label="社區中心" icon={Building2} colorClass="text-violet-400" activeBg="bg-[#211a2f]" activeBorder="border-violet-500/50" activeShadow="shadow-[0_0_8px_rgba(139,92,246,0.15)]" />
            <LayerButton layerKey="hospitals" label="醫院" icon={Hospital} colorClass="text-emerald-400" activeBg="bg-[#13271d]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_8px_rgba(16,185,129,0.15)]" />
            <div></div>
          </div>
        </div>

      </div>
    </div>
  );
}
