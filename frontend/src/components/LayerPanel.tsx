'use client';

import * as React from 'react';
import { useUIStore, MapStyleType } from '@/store/useUIStore';
import { Map, Satellite, Sun, Moon, Bus, Layers, Train, CircleDot } from 'lucide-react';

export default function LayerPanel() {
  const { mapStyleType, setMapStyleType, layers, toggleLayer } = useUIStore();

  const [isOpen, setIsOpen] = React.useState(true);

  // Helper component for Style buttons
  const StyleButton = ({ type, label, icon: Icon }: { type: MapStyleType, label: string, icon: React.ElementType }) => {
    const isActive = mapStyleType === type;
    return (
      <button
        onClick={() => setMapStyleType(type)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all duration-200 ${
          isActive 
            ? 'bg-[#1a1f2e] border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]' 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </button>
    );
  };

  // Helper component for Layer buttons
  const LayerButton = ({ layerKey, label, icon: Icon, colorClass = 'text-blue-400', activeBg = 'bg-[#1a1f2e]', activeBorder = 'border-blue-500/50', activeShadow = 'shadow-[0_0_10px_rgba(59,130,246,0.1)]' }: { layerKey: keyof typeof layers, label: string, icon: React.ElementType, colorClass?: string, activeBg?: string, activeBorder?: string, activeShadow?: string }) => {
    const isActive = layers[layerKey];
    return (
      <button
        onClick={() => toggleLayer(layerKey)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all duration-200 ${
          isActive 
            ? `${activeBg} ${activeBorder} ${colorClass} ${activeShadow}` 
            : 'bg-[#1c1d21] border-[#2d2e32] text-gray-400 hover:bg-[#25262b] hover:text-gray-200'
        }`}
      >
        <Icon className={`w-4 h-4 ${isActive ? '' : 'text-gray-500'}`} />
        <span>{label}</span>
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
      <div className="p-4 flex flex-col gap-4">
        
        {/* Map Styles Row */}
        <div className="grid grid-cols-[50px_1fr] gap-3 items-center">
          <div className="text-[11px] font-bold text-gray-500 tracking-wider">地圖</div>
          <div className="grid grid-cols-4 gap-1.5">
            <StyleButton type="street" label="街道" icon={Map} />
            <StyleButton type="satellite" label="衛星" icon={Satellite} />
            <StyleButton type="light" label="淺色" icon={Sun} />
            <StyleButton type="dark" label="深色" icon={Moon} />
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-[#2d2e32]"></div>

        {/* Traffic / Transit Row */}
        <div className="grid grid-cols-[50px_1fr] gap-3 items-start">
          <div className="text-[11px] font-bold text-blue-400 tracking-wider pt-2">交通</div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1.5">
              <LayerButton layerKey="bus" label="巴士" icon={Bus} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" activeShadow="shadow-[0_0_8px_rgba(16,185,129,0.1)]" />
              <LayerButton layerKey="busStops" label="巴士站點" icon={CircleDot} colorClass="text-emerald-400" activeBg="bg-[#1a2e23]" activeBorder="border-emerald-500/50" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <LayerButton layerKey="skytrain" label="天車" icon={Train} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" activeShadow="shadow-[0_0_8px_rgba(59,130,246,0.1)]" />
              <LayerButton layerKey="skytrainStops" label="天車站點" icon={CircleDot} colorClass="text-blue-400" activeBg="bg-[#1a2436]" activeBorder="border-blue-500/50" />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
