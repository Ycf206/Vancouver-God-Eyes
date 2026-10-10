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
        mapStyle={{
          version: 8,
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: [
                'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
              ],
              tileSize: 256,
              attribution: '&copy; CARTO, &copy; OpenStreetMap contributors'
            }
          },
          layers: [
            {
              id: 'carto-dark-layer',
              type: 'raster',
              source: 'carto-dark',
              minzoom: 0,
              maxzoom: 22
            }
          ]
        }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
