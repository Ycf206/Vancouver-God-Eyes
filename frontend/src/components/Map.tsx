'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function AppMap() {
  const [mounted, setMounted] = useState(false);

  // 確保在客戶端 (Browser) 才渲染地圖，避免 Next.js SSR 導致地圖消失或報錯
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-full h-full bg-[#111] flex items-center justify-center text-gray-500 text-sm">載入地圖引擎中...</div>;
  }

  return (
    // pt-[60px] 用於向下偏移，避免被上方 60px 高的 TopBar 蓋住
    <div className="w-full h-full absolute inset-0 z-0 pt-[60px]">
      <Map
        initialViewState={{
          longitude: -123.1207,
          latitude: 49.2827,
          zoom: 11.5,
          pitch: 45,
          bearing: -17.6
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
