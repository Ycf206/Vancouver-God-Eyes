'use client';

import * as React from 'react';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function AppMap() {
  // 現在由 page.tsx 的 next/dynamic 處理 SSR，這裡可以移除 mounted 判斷，保持乾淨
  return (
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
