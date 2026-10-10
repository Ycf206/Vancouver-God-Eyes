'use client';

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import Map, { NavigationControl, Marker } from 'react-map-gl/maplibre';
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

  useEffect(() => {
    // 自動判斷 WebSocket 網址 (動態抓取當前瀏覽器的 IP，指向 8000 port)
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
      
      ws.onclose = () => {
        console.log('❌ WebSocket closed, retrying in 5s...');
        setTimeout(connect, 5000);
      };
    };
    
    connect();
    
    return () => {
      if (ws) ws.close();
    };
  }, []);

  // 動態建立 MapStyle 物件，確保 GeoJSON 和圖層順序正確載入
  const mapStyle = useMemo(() => {
    const style: any = {
      version: 8,
      sources: {
        'esri-dark-base': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
        },
        'esri-dark-labels': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256
        }
      },
      layers: [
        {
          id: 'esri-dark-base-layer',
          type: 'raster',
          source: 'esri-dark-base',
          minzoom: 0,
          maxzoom: 16
        }
      ]
    };

    if (layers.transit) {
      // 加入靜態軌道與車站來源
      style.sources['skytrain-tracks'] = {
        type: 'geojson',
        data: '/skytrain_tracks.geojson'
      };
      style.sources['skytrain-stops'] = {
        type: 'geojson',
        data: '/skytrain_stops.geojson'
      };

      // 加入圖層 (繪製順序：先軌道，再車站)
      style.layers.push({
        id: 'skytrain-tracks-layer',
        type: 'line',
        source: 'skytrain-tracks',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.8
        }
      });
      style.layers.push({
        id: 'skytrain-stops-layer',
        type: 'circle',
        source: 'skytrain-stops',
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#222222'
        }
      });
    }

    // 最後加上地名標籤，確保標籤在最上層
    style.layers.push({
      id: 'esri-dark-labels-layer',
      type: 'raster',
      source: 'esri-dark-labels',
      minzoom: 0,
      maxzoom: 16
    });

    return style;
  }, [layers.transit]);


  return (
    <div className="w-full h-full absolute inset-0 z-0 pt-[60px]">
      <Map
        initialViewState={{
          longitude: -122.95, // 將中心點稍微往本拿比移，以便看到整條 SkyTrain 路線
          latitude: 49.25,
          zoom: 11,
          pitch: 45,
          bearing: -17.6
        }}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 即時動態資料：SkyTrain 列車位置 (呼吸燈圓點) */}
        {layers.transit && vehicles.map(v => (
          <Marker 
            key={v.id} 
            longitude={v.lon} 
            latitude={v.lat} 
            anchor="center"
          >
            <div className="relative flex items-center justify-center w-5 h-5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_rgba(52,211,153,1)]"></span>
            </div>
          </Marker>
        ))}

      </Map>
    </div>
  );
}
