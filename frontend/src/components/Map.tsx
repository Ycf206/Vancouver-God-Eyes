'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import Map, { NavigationControl, Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/store/useUIStore';

interface Vehicle {
  id: string;
  route_id: string;
  lat: number;
  lon: number;
  bearing: number;
}

export default function AppMap() {
  const { layers } = useUIStore();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tracks, setTracks] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stops, setStops] = useState<any>(null);

  useEffect(() => {
    // 載入靜態軌道與車站 (手動 fetch 確保不會因為圖層順序被忽略)
    fetch('/skytrain_tracks.geojson').then(res => res.json()).then(setTracks).catch(console.error);
    fetch('/skytrain_stops.geojson').then(res => res.json()).then(setStops).catch(console.error);
  }, []);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
    const wsUrl = apiUrl.replace('http', 'ws') + '/ws';
    let ws: WebSocket;
    
    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => console.log('✅ Connected to Live Traffic WebSocket');
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'vehicles_update') {
            setVehicles(message.data);
          }
        } catch (e) {
          console.error('Error parsing websocket message', e);
        }
      };
      ws.onclose = () => setTimeout(connect, 5000);
    };
    
    connect();
    return () => { if (ws) ws.close(); };
  }, []);

  return (
    <div className="w-full h-full absolute inset-0 z-0 pt-[60px]">
      <Map
        initialViewState={{ longitude: -122.95, latitude: 49.25, zoom: 11, pitch: 45, bearing: -17.6 }}
        mapStyle={{
          version: 8,
          sources: {
            'esri-dark-base': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
            'esri-dark-labels': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 }
          },
          layers: [
            { id: 'esri-dark-base-layer', type: 'raster', source: 'esri-dark-base', minzoom: 0, maxzoom: 16 }
          ]
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 靜態軌道圖層 (直接傳入 JSON 物件，不依賴網址) */}
        {layers.transit && tracks && (
          <Source id="skytrain-tracks" type="geojson" data={tracks}>
            <Layer id="skytrain-tracks-layer" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.8 }} />
          </Source>
        )}

        {/* 靜態車站圖層 */}
        {layers.transit && stops && (
          <Source id="skytrain-stops" type="geojson" data={stops}>
            <Layer id="skytrain-stops-layer" type="circle" paint={{ 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#222222' }} />
          </Source>
        )}

        {/* 即時列車位置 */}
        {layers.transit && vehicles.map(v => (
          <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
            <div className="relative flex items-center justify-center w-5 h-5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_rgba(52,211,153,1)]"></span>
            </div>
          </Marker>
        ))}

        {/* 地名標籤 (獨立一層，確保在軌道與列車上方) */}
        <Source id="esri-dark-labels" type="raster" tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}']} tileSize={256}>
          <Layer id="esri-dark-labels-layer" type="raster" source="esri-dark-labels" minzoom={0} maxzoom={16} />
        </Source>

      </Map>
    </div>
  );
}
