'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { Map, Satellite, Sun, Moon, Bus, Layers, Train, CircleDot, Route } from 'lucide-react';

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

  // Helper component for vertical Layer buttons
  const LayerButton = ({ layerKey, label, icon: Icon, colorClass = 'text-blue-400', activeBg = 'bg-[#1a1f2e]', activeBorder = 'border-blue-500/50', activeShadow = 'shadow-[0_0_8px_rgba(59,130,246,0.1)]' }: { layerKey: keyof typeof layers, label: string, icon: React.ElementType, colorClass?: string, activeBg?: string, activeBorder?: string, activeShadow?: string }) => {
    const isActive = layers[layerKey];
    return (
      <button
        onClick={() => toggleLayer(layerKey)}
        className={`flex items-center gap-3 px-3 py-2 rounded-md border text-xs transition-all duration-200 ${
          isActive 
            ? `${activeBg} ${activeBorder} ${colorClass} ${activeShadow}` 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className={`w-4 h-4 ${isActive ? '' : 'text-gray-500'}`} />
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
    <div className="absolute top-[80px] left-4 z-40 w-[240px] bg-[#161719]/95 backdrop-blur-md border border-[#2d2e32] rounded-lg shadow-2xl flex flex-col overflow-hidden">
      
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
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold text-gray-500 tracking-wider">地圖</div>
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
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold text-emerald-500 tracking-wider">交通</div>
          <div className="flex flex-col gap-1.5">
            <LayerButton layerKey="bus" label="巴士" icon={Bus} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_8px_rgba(16,185,129,0.1)]" />
            <LayerButton layerKey="busRoutes" label="路線" icon={Route} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
            <LayerButton layerKey="busStops" label="車站" icon={CircleDot} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#2d2e32]"></div>

        {/* SkyTrain Row */}
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold text-blue-400 tracking-wider">天車</div>
          <div className="flex flex-col gap-1.5">
            <LayerButton layerKey="skytrainRoutes" label="路線" icon={Train} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_8px_rgba(59,130,246,0.1)]" />
            <LayerButton layerKey="skytrainStops" label="車站" icon={CircleDot} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" />
          </div>
        </div>

      </div>
    </div>
  );
}
