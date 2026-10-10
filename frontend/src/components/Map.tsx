'use client';

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import Map, { NavigationControl, Marker, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/store/useUIStore';

// Fix Next.js App Router Web Worker crash
if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre-gl-worker.mjs');
}

interface Vehicle {
  id: string;
  route_id: string;
  is_seabus?: boolean;
  lat: number;
  lon: number;
  bearing: number;
}

interface StopInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export default function AppMap() {
  const { layers, mapStyleType } = useUIStore();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [ferryTerminals, setFerryTerminals] = useState<any[]>([]);
  
  // States for Popup
  const [selectedStop, setSelectedStop] = useState<StopInfo | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [arrivals, setArrivals] = useState<any[]>([]);
  const [loadingArrivals, setLoadingArrivals] = useState(false);

  
  useEffect(() => {
    fetch('/bc_ferries_terminals_points.geojson')
      .then(r => r.json())
      .then(data => {
         if(data && data.features) setFerryTerminals(data.features);
      }).catch(e => console.error(e));
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

  const mapStyle = useMemo(() => {
    // Determine Base and Label Tiles based on mapStyleType
    let baseTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'];
    let labelTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'];
    let sourceMaxZoom = 16;
    
    if (mapStyleType === 'light') {
      baseTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'];
      labelTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}'];
      sourceMaxZoom = 16;
    } else if (mapStyleType === 'street') {
      baseTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'];
      labelTiles = []; // Street map already has labels
      sourceMaxZoom = 19;
    } else if (mapStyleType === 'satellite') {
      baseTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
      labelTiles = ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'];
      sourceMaxZoom = 19;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const style: any = {
      version: 8,
      sources: {
        'esri-base': {
          type: 'raster',
          tiles: baseTiles,
          tileSize: 256,
          maxzoom: sourceMaxZoom,
          attribution: '&copy; Esri'
        }
      },
      layers: [
        {
          id: 'esri-base-layer',
          type: 'raster',
          source: 'esri-base',
          minzoom: 0,
          maxzoom: 16
        }
      ]
    };

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
    
    if (labelTiles.length > 0) {
      style.sources['esri-labels'] = {
        type: 'raster',
        tiles: labelTiles,
        tileSize: 256,
        maxzoom: sourceMaxZoom
      };
    }

    style.sources['skytrain-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/skytrain` };
    style.sources['skytrain-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/skytrain` };
    style.sources['bus-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/bus` };
    style.sources['bus-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/bus` };
    style.sources['seabus-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/seabus` };
    style.sources['seabus-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/seabus` };

    // Bus Routes
    if (layers.busRoutes) {
      style.layers.push({
        id: 'bus-tracks-layer',
        type: 'line',
        source: 'bus-tracks',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.8
        }
      });
    }

    // Bus Stops
    if (layers.busStops) {
      style.layers.push({
        id: 'bus-stops-layer',
        type: 'circle',
        source: 'bus-stops',
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#22c55e'
        }
      });
    }

    // SkyTrain Routes
    if (layers.skytrainRoutes) {
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
    }

    // SkyTrain Stops
    if (layers.skytrainStops) {
      style.layers.push({
        id: 'skytrain-stops-layer',
        type: 'circle',
        source: 'skytrain-stops',
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#00a4e4'
        }
      });
    }

    // SeaBus Routes
    if (layers.seabusRoutes) {
      style.layers.push({
        id: 'seabus-tracks-layer',
        type: 'line',
        source: 'seabus-tracks',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.8,
          'line-dasharray': [2, 2] // Dash line for ferries!
        }
      });
    }

    // SeaBus Stops
    if (layers.seabusStops) {
      style.layers.push({
        id: 'seabus-stops-layer',
        type: 'circle',
        source: 'seabus-stops',
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#8b786d'
        }
      });
    }

    if (labelTiles.length > 0) {
      style.layers.push({
        id: 'esri-labels-layer',
        type: 'raster',
        source: 'esri-labels',
        minzoom: 0,
        maxzoom: 16
      });
    }


    // BC Ferries Routes
    if (layers.bcferriesRoutes) {
      style.sources['bc-ferries-routes'] = { type: 'geojson', data: '/bc_ferries_routes.geojson' };
      style.layers.push({
        id: 'bc-ferries-routes-layer',
        type: 'line',
        source: 'bc-ferries-routes',
        paint: {
          'line-color': '#3399ff',
          'line-width': 2,
          'line-dasharray': [4, 4],
          'line-opacity': 0.7
        }
      });
    }



    return style;
  }, [layers.skytrainRoutes, layers.skytrainStops, layers.busRoutes, layers.busStops, layers.seabusRoutes, layers.seabusStops, layers.bcferriesRoutes, layers.bcferriesTerminals, mapStyleType]);

  return (
    <div className="w-full h-full absolute inset-0 z-0 pt-[60px]">
      <Map
        initialViewState={{ longitude: -123.05, latitude: 49.25, zoom: 11, pitch: 45, bearing: 0 }}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={['bus-stops-layer', 'skytrain-stops-layer', 'seabus-stops-layer']}
        onClick={(e) => {
          const feature = e.features?.[0];
          if (feature && (feature.layer.id === 'bus-stops-layer' || feature.layer.id === 'skytrain-stops-layer' || feature.layer.id === 'seabus-stops-layer')) {
            const stopId = feature.properties?.stop_id;
            const stopName = feature.properties?.name;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const coords = (feature.geometry as any).coordinates;
            setSelectedStop({ id: stopId, name: stopName, lon: coords[0], lat: coords[1] });
            
            // Fetch arrivals
            setLoadingArrivals(true);
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
            fetch(`${apiUrl}/api/stops/${stopId}/arrivals`)
              .then(res => res.json())
              .then(data => {
                setArrivals(data.arrivals || []);
                setLoadingArrivals(false);
              })
              .catch(err => {
                console.error(err);
                setLoadingArrivals(false);
              });
          } else {
            setSelectedStop(null);
          }
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 即時車輛位置 (Live Vehicles) */}
        {vehicles.map(v => {
          if (v.is_seabus) {
            if (!layers.seabusVehicles) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div className="relative flex items-center justify-center w-6 h-6 bg-[#8b786d]/80 rounded-full cursor-pointer tooltip border border-white/50 shadow-md backdrop-blur-sm" title={`SeaBus`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/></svg>
                </div>
              </Marker>
            );
          } else {
            if (!layers.bus) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div className="relative flex items-center justify-center w-5 h-5 bg-emerald-500/80 rounded-full cursor-pointer tooltip border border-white/60 shadow-md backdrop-blur-sm" title={`Route: ${v.route_id}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
                </div>
              </Marker>
            );
          }
        })}

        {/* 到站時間 Popup */}
        {selectedStop && (
          <Popup
            longitude={selectedStop.lon}
            latitude={selectedStop.lat}
            anchor="bottom"
            onClose={() => setSelectedStop(null)}
            closeButton={true}
            closeOnClick={false}
          >
            <div className="p-1 min-w-[200px] text-gray-800">
              <h3 className="font-bold text-sm mb-2 pb-1 border-b">{selectedStop.name} <span className="text-xs text-gray-400">({selectedStop.id})</span></h3>
              {loadingArrivals ? (
                <div className="text-xs text-gray-500 flex items-center gap-2 mt-2">
                  <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  載入預估時間...
                </div>
              ) : arrivals.length > 0 ? (
                <div className="flex flex-col gap-1 mt-2">
                  {arrivals.map((arr, i) => (
                    <div key={i} className="flex justify-between items-center text-xs">
                      <span className="font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md">路線 {arr.route_id}</span>
                      <span className="text-gray-600">
                        {arr.minutes <= 0 ? (
                          <span className="text-red-500 font-bold animate-pulse">即將進站</span>
                        ) : (
                          <span><strong className="text-base text-gray-900">{arr.minutes}</strong> 分鐘</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 mt-2">目前沒有即將到站的班次</div>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
