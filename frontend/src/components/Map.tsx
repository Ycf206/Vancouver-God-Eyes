'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import Map, { NavigationControl, Marker, Popup, MapRef } from 'react-map-gl/maplibre';
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
  is_bcferries?: boolean;
  vessel_name?: string;
  lat: number;
  lon: number;
  bearing: number;
}

interface FerryVehicle {
  id: string;
  route_id: string;
  vessel_name?: string;
  dep_code?: string;
  arr_code?: string;
  dep_name?: string;
  arr_name?: string;
  departure_time?: string;
  arrival_time?: string;
  fill?: number;
  progress?: number;
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

interface RoadFacilityInfo {
  id: string;
  facility_type: string;
  name: string;
  local_area?: string;
  lon: number;
  lat: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: any;
}

export default function AppMap() {
  const { layers, mapStyleType, searchTarget } = useUIStore();
  const mapRef = useRef<MapRef>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [ferryVehicles, setFerryVehicles] = useState<FerryVehicle[]>([]);
  const [ferryTerminals, setFerryTerminals] = useState<Array<{geometry: {coordinates: number[]}, properties: {name?: string, code: string}}>>([]);
  
  // States for Popup
  const [selectedStop, setSelectedStop] = useState<StopInfo | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [arrivals, setArrivals] = useState<any[]>([]);
  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<{geometry: {coordinates: number[]}, properties: {name?: string, code: string}} | null>(null);
  const [terminalSchedule, setTerminalSchedule] = useState<Array<{destination: string, time: string, arrival_time: string, vessel_name: string, status: string, fill: number}>>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [selectedFerry, setSelectedFerry] = useState<FerryVehicle | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<RoadFacilityInfo | null>(null);

  // States for Traffic Camera Images
  const [webcamImages, setWebcamImages] = useState<Array<{url: string, direction: string, alt: string}>>([]);
  const [loadingWebcam, setLoadingWebcam] = useState(false);
  const [webcamRefreshKey, setWebcamRefreshKey] = useState(0);

  // Fetch webcam images when a traffic camera is selected
  useEffect(() => {
    if (selectedFacility && selectedFacility.facility_type === 'traffic_cameras') {
      const pageUrl = selectedFacility.properties?.url;
      if (pageUrl) {
        setLoadingWebcam(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
        fetch(`${apiUrl}/api/webcam/images?url=${encodeURIComponent(pageUrl)}`)
          .then(res => res.json())
          .then(data => {
            setWebcamImages(data.images || []);
            setLoadingWebcam(false);
          })
          .catch(err => {
            console.error('Webcam image fetch error:', err);
            setLoadingWebcam(false);
          });
      }
    } else {
      setWebcamImages([]);
    }
  }, [selectedFacility, webcamRefreshKey]);

  // 響應全域搜尋項目選取 (FlyTo & 自動打開詳細資訊卡片)
  useEffect(() => {
    if (!searchTarget) return;

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [searchTarget.lon, searchTarget.lat],
        zoom: searchTarget.zoom || 16,
        duration: 1200
      });
    }

    if (searchTarget.category === 'ferry_terminal' && searchTarget.meta?.code) {
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedTerminal({
        geometry: { coordinates: [searchTarget.lon, searchTarget.lat] },
        properties: { code: searchTarget.meta.code, name: searchTarget.title }
      });
      setLoadingSchedule(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
      fetch(`${apiUrl}/api/bcferries/schedule/${searchTarget.meta.code}`)
        .then(res => res.json())
        .then(data => {
          setTerminalSchedule(data.schedule || []);
          setLoadingSchedule(false);
        })
        .catch(err => {
          console.error(err);
          setLoadingSchedule(false);
        });
    } else if (searchTarget.category === 'skytrain' || searchTarget.category === 'seabus' || searchTarget.category === 'bus_stop') {
      setSelectedTerminal(null);
      setSelectedFacility(null);
      const stopId = searchTarget.meta?.stop_id;
      setSelectedStop({
        id: stopId,
        name: searchTarget.title,
        lon: searchTarget.lon,
        lat: searchTarget.lat
      });
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
    } else if (
      ['fire_halls', 'community_centres', 'ev_charging', 'escooter', 'traffic_cameras', 'parking_meters', 'accessible_parking', 'motorcycle_parking'].includes(searchTarget.category)
    ) {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility({
        id: searchTarget.id,
        facility_type: searchTarget.category,
        name: searchTarget.title,
        local_area: searchTarget.meta?.local_area || '',
        lon: searchTarget.lon,
        lat: searchTarget.lat,
        properties: searchTarget.meta?.properties || {}
      });
    }
  }, [searchTarget]);

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
          } else if (message.type === 'bc_ferries_update') {
            setFerryVehicles(message.data);
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
          maxzoom: 24
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
    style.sources['parking-meters'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/parking_meters` };
    style.sources['accessible-parking'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/accessible_parking` };
    style.sources['motorcycle-parking'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/motorcycle_parking` };
    style.sources['ev-charging'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/ev_charging` };
    style.sources['escooter'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/escooter` };
    style.sources['fire-halls'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/fire_halls` };
    style.sources['community-centres'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/community_centres` };
    style.sources['traffic-cameras'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/traffic_cameras` };

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
        maxzoom: 24
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

    // Road Facilities: Parking Meters
    if (layers.parkingMeters) {
      style.layers.push({
        id: 'parking-meters-layer',
        type: 'circle',
        source: 'parking-meters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 4, 15, 7, 17, 9],
          'circle-color': '#f59e0b',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'parking-meters-symbol-layer',
        type: 'symbol',
        source: 'parking-meters',
        minzoom: 15,
        layout: {
          'text-field': 'P',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 17, 11],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Facilities: Accessible Parking
    if (layers.accessibleParking) {
      style.layers.push({
        id: 'accessible-parking-layer',
        type: 'circle',
        source: 'accessible-parking',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8, 17, 10],
          'circle-color': '#0ea5e9',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'accessible-parking-symbol-layer',
        type: 'symbol',
        source: 'accessible-parking',
        minzoom: 15,
        layout: {
          'text-field': '♿',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Facilities: Motorcycle Parking
    if (layers.motorcycleParking) {
      style.layers.push({
        id: 'motorcycle-parking-layer',
        type: 'circle',
        source: 'motorcycle-parking',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8, 17, 10],
          'circle-color': '#f97316',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'motorcycle-parking-symbol-layer',
        type: 'symbol',
        source: 'motorcycle-parking',
        minzoom: 15,
        layout: {
          'text-field': '🏍',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Facilities: EV Charging
    if (layers.evCharging) {
      style.layers.push({
        id: 'ev-charging-layer',
        type: 'circle',
        source: 'ev-charging',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 14, 6.5, 15, 9.5, 17, 12],
          'circle-color': '#10b981',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'ev-charging-symbol-layer',
        type: 'symbol',
        source: 'ev-charging',
        minzoom: 14,
        layout: {
          'text-field': '⚡',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Facilities: Shared E-Scooter Stations
    if (layers.escooter) {
      style.layers.push({
        id: 'escooter-layer',
        type: 'circle',
        source: 'escooter',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#84cc16',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'escooter-symbol-layer',
        type: 'symbol',
        source: 'escooter',
        minzoom: 15,
        layout: {
          'text-field': '🛴',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Government Facilities: Fire Halls
    if (layers.fireHalls) {
      style.layers.push({
        id: 'fire-halls-layer',
        type: 'circle',
        source: 'fire-halls',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 15, 9, 17, 12],
          'circle-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'fire-halls-symbol-layer',
        type: 'symbol',
        source: 'fire-halls',
        minzoom: 14,
        layout: {
          'text-field': '🚒',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Government Facilities: Community Centres
    if (layers.communityCentres) {
      style.layers.push({
        id: 'community-centres-layer',
        type: 'circle',
        source: 'community-centres',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 15, 9, 17, 12],
          'circle-color': '#8b5cf6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'community-centres-symbol-layer',
        type: 'symbol',
        source: 'community-centres',
        minzoom: 14,
        layout: {
          'text-field': '🏛️',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Facilities: Traffic Cameras
    if (layers.trafficCameras) {
      style.layers.push({
        id: 'traffic-cameras-layer',
        type: 'circle',
        source: 'traffic-cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#06b6d4',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'traffic-cameras-symbol-layer',
        type: 'symbol',
        source: 'traffic-cameras',
        minzoom: 15,
        layout: {
          'text-field': '📷',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    return style;
  }, [
    layers.skytrainRoutes, 
    layers.skytrainStops, 
    layers.busRoutes, 
    layers.busStops, 
    layers.seabusRoutes, 
    layers.seabusStops, 
    layers.bcferriesRoutes, 
    layers.parkingMeters, 
    layers.accessibleParking, 
    layers.motorcycleParking, 
    layers.evCharging, 
    layers.escooter,
    layers.trafficCameras,
    layers.fireHalls,
    layers.communityCentres,
    mapStyleType
  ]);

  return (
    <div className="w-full h-full absolute inset-0 z-0 pt-[60px]">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -123.05, latitude: 49.25, zoom: 11, pitch: 0, bearing: 0 }}
        maxZoom={20}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={[
          'bus-stops-layer', 
          'skytrain-stops-layer', 
          'seabus-stops-layer',
          'parking-meters-layer',
          'parking-meters-symbol-layer',
          'accessible-parking-layer',
          'accessible-parking-symbol-layer',
          'motorcycle-parking-layer',
          'motorcycle-parking-symbol-layer',
          'ev-charging-layer',
          'ev-charging-symbol-layer',
          'escooter-layer',
          'escooter-symbol-layer',
          'traffic-cameras-layer',
          'traffic-cameras-symbol-layer',
          'fire-halls-layer',
          'fire-halls-symbol-layer',
          'community-centres-layer',
          'community-centres-symbol-layer'
        ]}
        onClick={(e) => {
          const feature = e.features?.[0];
          if (!feature) {
            setSelectedStop(null);
            setSelectedFacility(null);
            return;
          }

          const layerId = feature.layer.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (feature.geometry as any).coordinates;

          if (layerId === 'bus-stops-layer' || layerId === 'skytrain-stops-layer' || layerId === 'seabus-stops-layer') {
            setSelectedFacility(null);
            const stopId = feature.properties?.stop_id;
            const stopName = feature.properties?.name;
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
          } else if (
            layerId.startsWith('parking-meters') || 
            layerId.startsWith('accessible-parking') || 
            layerId.startsWith('motorcycle-parking') || 
            layerId.startsWith('ev-charging') ||
            layerId.startsWith('escooter') ||
            layerId.startsWith('traffic-cameras') ||
            layerId.startsWith('fire-halls') ||
            layerId.startsWith('community-centres')
          ) {
            setSelectedStop(null);
            const props = feature.properties || {};
            setSelectedFacility({
              id: props.id || '',
              facility_type: props.facility_type || '',
              name: props.name || '',
              local_area: props.local_area || '',
              lon: coords[0],
              lat: coords[1],
              properties: props
            });
          } else {
            setSelectedStop(null);
            setSelectedFacility(null);
          }
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 搜尋目標高亮光環 (Search Target Focus Ring) */}
        {searchTarget && (
          <Marker longitude={searchTarget.lon} latitude={searchTarget.lat} anchor="center">
            <div className="relative flex items-center justify-center pointer-events-none z-40">
              <span className="absolute w-12 h-12 rounded-full bg-emerald-400/40 animate-ping"></span>
              <span className="w-7 h-7 rounded-full border-2 border-emerald-400 bg-emerald-500/30 flex items-center justify-center shadow-lg">
                <span className="text-xs">{searchTarget.icon}</span>
              </span>
            </div>
          </Marker>
        )}

        {/* 即時車輛位置 (Live TransLink Vehicles) */}
        {vehicles.map(v => {
          if (v.is_seabus) {
            if (!layers.seabusVehicles) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div className="relative flex items-center justify-center w-6 h-6 bg-[#8b786d]/90 rounded-full cursor-pointer tooltip border-[1.5px] border-white shadow-md backdrop-blur-sm transition-transform hover:scale-110 z-20" title={`SeaBus`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20"/><path d="M6 12l2-4h8l2 4"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
              </Marker>
            );
          } else {
            if (!layers.bus) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div className="relative flex items-center justify-center w-5 h-5 bg-emerald-500/80 rounded-full cursor-pointer tooltip border border-white/60 shadow-md backdrop-blur-sm hover:scale-110 transition-transform z-10" title={`Route: ${v.route_id}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
                </div>
              </Marker>
            );
          }
        })}

        {/* BC Ferries 即時船隻 (Live BC Ferries) */}
        {layers.bcferriesVehicles && ferryVehicles.map(v => (
          <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
            <div 
              className="relative flex items-center justify-center w-8 h-8 bg-[#0060a9] rounded-full cursor-pointer tooltip border-2 border-white shadow-xl backdrop-blur-sm transition-transform hover:scale-125 z-30" 
              title={`${v.vessel_name || 'BC Ferries'} (${v.route_id})`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFerry(v);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h20"/><path d="M6 12l2-4h8l2 4"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </div>
          </Marker>
        ))}

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

        {/* BC Ferries Terminals */}
        {layers.bcferriesTerminals && ferryTerminals.map((t, i) => (
          <Marker 
            key={`term-${i}`} 
            longitude={t.geometry.coordinates[0]} 
            latitude={t.geometry.coordinates[1]}
            anchor="center"
          >
            <div 
              className="w-6 h-6 bg-[#0060a9] rounded-md flex items-center justify-center border-[1.5px] border-white shadow-md cursor-pointer hover:bg-[#004080] transition-colors tooltip"
              title={t.properties?.name || 'Ferry Terminal'}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTerminal(t);
                setLoadingSchedule(true);
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
                fetch(`${apiUrl}/api/ferries/terminals/${t.properties.code}/schedule`)
                  .then(r => r.json())
                  .then(data => {
                    setTerminalSchedule(data.schedule || []);
                    setLoadingSchedule(false);
                  })
                  .catch(err => {
                    console.error(err);
                    setLoadingSchedule(false);
                  });
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="3"/>
                <line x1="12" y1="22" x2="12" y2="8"/>
                <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
              </svg>
            </div>
          </Marker>
        ))}


        {/* Terminal Popup */}
        {selectedTerminal && (
          <Popup
            longitude={selectedTerminal.geometry.coordinates[0]}
            latitude={selectedTerminal.geometry.coordinates[1]}
            anchor="bottom"
            onClose={() => setSelectedTerminal(null)}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -10]}
            maxWidth="400px"
          >
            <div className="p-3.5 w-[330px] sm:w-[360px] max-w-[88vw] overflow-hidden">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-start gap-2 pt-0.5">
                  <span className="w-2.5 h-2.5 bg-[#0060a9] rounded-full flex-shrink-0 mt-1.5 shadow-sm"></span>
                  <h3 className="font-bold text-gray-900 text-base leading-snug pr-2">{selectedTerminal.properties?.name}</h3>
                </div>
                <button 
                  onClick={() => setSelectedTerminal(null)} 
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none -mt-1"
                >
                  &times;
                </button>
              </div>
              
              <div>
                <h4 className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">今日班次 (Today&apos;s Sailings)</h4>
                
                {loadingSchedule ? (
                  <div className="flex flex-col items-center justify-center py-6 text-gray-500 text-xs gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#0060a9] border-t-transparent"></div>
                    載入班次中...
                  </div>
                ) : terminalSchedule.length === 0 ? (
                  <div className="text-xs text-gray-500 py-4 text-center bg-gray-50 rounded-lg">目前沒有即將開航的班次。</div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                    {terminalSchedule.map((sailing, i) => (
                      <div key={i} className="flex flex-col gap-1 text-xs bg-gray-50/80 p-2.5 rounded-lg border border-gray-200/60 shadow-xs hover:border-gray-300 transition-colors">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-[#0060a9] text-sm tracking-tight">
                            {sailing.time} {sailing.arrival_time ? `➝ ${sailing.arrival_time}` : ""}
                          </span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            sailing.status === 'past' ? 'bg-gray-100 text-gray-500' : 
                            sailing.status === 'current' ? 'bg-emerald-100 text-emerald-800 font-bold animate-pulse' : 
                            'bg-blue-100/80 text-blue-800'
                          }`}>
                            {sailing.status === 'past' ? '已抵達' : sailing.status === 'current' ? '航行中' : '即將開航'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-gray-600 mt-0.5">
                          <span className="font-medium text-gray-800 truncate max-w-[170px]">{sailing.vessel_name || '渡輪 (航線營運中)'}</span>
                          <span className="bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-[10px] font-medium">開往 {sailing.destination}</span>
                        </div>
                        {sailing.fill > 0 && (
                          <div className="mt-1 pt-1 border-t border-gray-100">
                            <div className="flex justify-between items-center text-[10px] text-gray-500 mb-0.5">
                              <span>車位載車率 (Deck Fill)</span>
                              <span className="font-semibold text-gray-700">{sailing.fill}%</span>
                            </div>
                            <div className="w-full bg-gray-200/80 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className={`h-1.5 rounded-full transition-all duration-300 ${sailing.fill >= 80 ? 'bg-amber-500' : 'bg-[#0060a9]'}`} 
                                style={{ width: `${Math.min(100, Math.max(0, sailing.fill))}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Popup>
        )}

        {/* Ferry Popup */}
        {selectedFerry && (
          <Popup
            longitude={selectedFerry.lon}
            latitude={selectedFerry.lat}
            anchor="bottom"
            onClose={() => setSelectedFerry(null)}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -14]}
            maxWidth="360px"
          >
            <div className="p-3.5 w-[310px] sm:w-[330px] max-w-[88vw] text-gray-800">
              <div className="flex items-start justify-between pb-2 mb-2.5 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-[#0060a9] rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12h20"/><path d="M6 12l2-4h8l2 4"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight">{selectedFerry.vessel_name || 'BC Ferries'}</h3>
                    <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      航行中 (In Transit)
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFerry(null)} 
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none -mt-1"
                >
                  &times;
                </button>
              </div>

              <div className="bg-gray-50/90 p-2.5 rounded-lg border border-gray-200/60 mb-2.5 flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">航線 (Route)</span>
                  <span className="font-bold text-[#0060a9]">{selectedFerry.route_id}</span>
                </div>
                <div className="text-xs text-gray-700 flex justify-between items-center bg-white p-1.5 rounded border border-gray-100">
                  <span className="font-medium truncate max-w-[125px]">{selectedFerry.dep_name || selectedFerry.dep_code}</span>
                  <span className="text-gray-400 font-bold">➝</span>
                  <span className="font-medium truncate max-w-[125px] text-right">{selectedFerry.arr_name || selectedFerry.arr_code}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-200/50">
                  <span className="text-gray-500">預計時間</span>
                  <span className="font-bold text-gray-900">
                    {selectedFerry.departure_time} {selectedFerry.arrival_time ? `➝ ${selectedFerry.arrival_time}` : ''}
                  </span>
                </div>
              </div>

              {selectedFerry.progress !== undefined && (
                <div className="mb-2">
                  <div className="flex justify-between items-center text-[10px] text-gray-500 mb-1">
                    <span>航程進度 (Sailing Progress)</span>
                    <span className="font-bold text-emerald-700">{selectedFerry.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200/80 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" 
                      style={{ width: `${selectedFerry.progress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {selectedFerry.fill !== undefined && selectedFerry.fill > 0 && (
                <div>
                  <div className="flex justify-between items-center text-[10px] text-gray-500 mb-1">
                    <span>車位載車率 (Deck Fill)</span>
                    <span className="font-bold text-gray-800">{selectedFerry.fill}%</span>
                  </div>
                  <div className="w-full bg-gray-200/80 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full transition-all duration-300 ${selectedFerry.fill >= 80 ? 'bg-amber-500' : 'bg-[#0060a9]'}`} 
                      style={{ width: `${Math.min(100, Math.max(0, selectedFerry.fill))}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </Popup>
        )}

        {/* Road Facility Popup */}
        {selectedFacility && (
          <Popup
            longitude={selectedFacility.lon}
            latitude={selectedFacility.lat}
            anchor="bottom"
            onClose={() => setSelectedFacility(null)}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -10]}
            maxWidth={selectedFacility.facility_type === 'traffic_cameras' ? '400px' : '320px'}
          >
            <div className={`p-3.5 ${selectedFacility.facility_type === 'traffic_cameras' ? 'w-[360px]' : 'w-[290px]'} max-w-[90vw] text-gray-800`}>
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    selectedFacility.facility_type === 'parking_meters' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'accessible_parking' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'motorcycle_parking' ? 'bg-orange-500' :
                    selectedFacility.facility_type === 'ev_charging' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'escooter' ? 'bg-lime-500' :
                    selectedFacility.facility_type === 'traffic_cameras' ? 'bg-cyan-500' :
                    selectedFacility.facility_type === 'fire_halls' ? 'bg-rose-500' : 'bg-violet-500'
                  }`}></span>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight">{selectedFacility.name}</h3>
                    {selectedFacility.local_area && (
                      <span className="text-[11px] text-gray-400">{selectedFacility.local_area}</span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFacility(null)} 
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none -mt-1"
                >
                  &times;
                </button>
              </div>

              {/* Parking Meters Details */}
              {selectedFacility.facility_type === 'parking_meters' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  {selectedFacility.properties.rate_9am_6pm && (
                    <div className="flex justify-between items-center bg-gray-50 p-1.5 rounded">
                      <span className="text-gray-500">日間費率 (9am-6pm)</span>
                      <span className="font-bold text-amber-700">{selectedFacility.properties.rate_9am_6pm} /小時</span>
                    </div>
                  )}
                  {selectedFacility.properties.rate_6pm_10pm && (
                    <div className="flex justify-between items-center bg-gray-50 p-1.5 rounded">
                      <span className="text-gray-500">夜間費率 (6pm-10pm)</span>
                      <span className="font-bold text-amber-700">{selectedFacility.properties.rate_6pm_10pm} /小時</span>
                    </div>
                  )}
                  {selectedFacility.properties.time_limit_9am_6pm && (
                    <div className="flex justify-between text-gray-600">
                      <span>停放限制</span>
                      <span>{selectedFacility.properties.time_limit_9am_6pm}</span>
                    </div>
                  )}
                  {selectedFacility.properties.credit_card && (
                    <div className="flex justify-between text-gray-600">
                      <span>支援信用卡</span>
                      <span className="font-medium">{selectedFacility.properties.credit_card === 'Yes' ? '✅ 是' : '❌ 否'}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Accessible Parking Details */}
              {selectedFacility.facility_type === 'accessible_parking' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between items-center bg-sky-50 p-1.5 rounded">
                    <span className="text-sky-700 font-medium">專用車位數</span>
                    <span className="font-bold text-sky-800 text-sm">{selectedFacility.properties.spaces || 1} 格</span>
                  </div>
                  {selectedFacility.properties.location && (
                    <div className="text-gray-600">
                      <span className="text-gray-400">位置：</span>{selectedFacility.properties.location}
                    </div>
                  )}
                  {selectedFacility.properties.type && (
                    <div className="text-gray-500 text-[11px]">
                      {selectedFacility.properties.type}
                    </div>
                  )}
                </div>
              )}

              {/* Motorcycle Parking Details */}
              {selectedFacility.facility_type === 'motorcycle_parking' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  {selectedFacility.properties.street && (
                    <div className="text-gray-700 font-medium">
                      {selectedFacility.properties.block} {selectedFacility.properties.street}
                    </div>
                  )}
                  {selectedFacility.properties.time_limit && (
                    <div className="flex justify-between text-gray-600 bg-orange-50 p-1.5 rounded">
                      <span className="text-orange-700">時間限制</span>
                      <span className="font-bold text-orange-800">{selectedFacility.properties.time_limit}</span>
                    </div>
                  )}
                </div>
              )}

              {/* EV Charging Details */}
              {selectedFacility.facility_type === 'ev_charging' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between items-center bg-emerald-50 p-1.5 rounded">
                    <span className="text-emerald-700 font-medium">充電接口 (Ports)</span>
                    <span className="font-bold text-emerald-800 text-sm">{selectedFacility.properties.ports || 2} 個</span>
                  </div>
                  {selectedFacility.properties.connectors && (
                    <div className="flex justify-between text-gray-600">
                      <span>接口規格</span>
                      <span className="font-medium text-gray-800">{selectedFacility.properties.connectors}</span>
                    </div>
                  )}
                  {selectedFacility.properties.voltage && (
                    <div className="flex justify-between text-gray-600">
                      <span>電壓</span>
                      <span className="font-medium text-gray-800">{selectedFacility.properties.voltage}</span>
                    </div>
                  )}
                  {selectedFacility.properties.cost && (
                    <div className="flex justify-between text-gray-600">
                      <span>充電費用</span>
                      <span className="font-bold text-emerald-700">{selectedFacility.properties.cost}</span>
                    </div>
                  )}
                  {selectedFacility.properties.operator && (
                    <div className="flex justify-between text-gray-500 text-[11px] pt-1 border-t border-gray-100">
                      <span>營運單位</span>
                      <span>{selectedFacility.properties.operator}</span>
                    </div>
                  )}
                </div>
              )}

              {/* E-Scooter Station Details */}
              {selectedFacility.facility_type === 'escooter' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between items-center bg-lime-50 p-1.5 rounded">
                    <span className="text-lime-800 font-medium">車位容量 (Capacity)</span>
                    <span className="font-bold text-lime-900 text-sm">{selectedFacility.properties.station_size || '—'} 輛</span>
                  </div>
                  {selectedFacility.properties.station_number && (
                    <div className="flex justify-between text-gray-600">
                      <span>站點編號</span>
                      <span className="font-medium text-gray-800">{selectedFacility.properties.station_number}</span>
                    </div>
                  )}
                  {selectedFacility.properties.placement && (
                    <div className="flex justify-between text-gray-600">
                      <span>設置位置</span>
                      <span className="font-medium text-gray-800">{selectedFacility.properties.placement}</span>
                    </div>
                  )}
                  {selectedFacility.properties.jurisdiction && (
                    <div className="flex justify-between text-gray-600">
                      <span>管轄屬性</span>
                      <span className="font-medium text-gray-800">{selectedFacility.properties.jurisdiction}</span>
                    </div>
                  )}
                  {selectedFacility.properties.installation_date && (
                    <div className="flex justify-between text-gray-500 text-[11px] pt-1 border-t border-gray-100">
                      <span>啟用日期</span>
                      <span>{String(selectedFacility.properties.installation_date).slice(0, 10)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Fire Halls Details */}
              {selectedFacility.facility_type === 'fire_halls' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  {selectedFacility.properties.address && (
                    <div className="bg-rose-50 p-2 rounded text-gray-700">
                      <span className="text-rose-800 font-medium block text-[11px] mb-0.5">局址地址</span>
                      <span className="font-bold text-rose-950 text-sm">{selectedFacility.properties.address}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-gray-600 pt-1">
                    <span>服務轄區</span>
                    <span className="font-medium text-gray-800">{selectedFacility.local_area || selectedFacility.properties.geo_local_area || '溫哥華市'}</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500 text-[11px] pt-1 border-t border-gray-100">
                    <span>緊急求助</span>
                    <span className="font-bold text-rose-600">撥打 911</span>
                  </div>
                </div>
              )}

              {/* Community Centres Details */}
              {selectedFacility.facility_type === 'community_centres' && (
                <div className="flex flex-col gap-1.5 text-xs">
                  {selectedFacility.properties.address && (
                    <div className="bg-violet-50 p-2 rounded text-gray-700">
                      <span className="text-violet-800 font-medium block text-[11px] mb-0.5">中心地址</span>
                      <span className="font-bold text-violet-950 text-sm">{selectedFacility.properties.address}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-gray-600 pt-1">
                    <span>所在社區</span>
                    <span className="font-medium text-gray-800">{selectedFacility.local_area || selectedFacility.properties.geo_local_area || '溫哥華市'}</span>
                  </div>
                  {selectedFacility.properties.urllink && (
                    <div className="pt-1.5 border-t border-gray-100">
                      <a 
                        href={selectedFacility.properties.urllink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往社區中心官方網站 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Traffic Cameras Details */}
              {selectedFacility.facility_type === 'traffic_cameras' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-gray-500 bg-cyan-50/70 p-1.5 rounded">
                    <span className="flex items-center gap-1 text-cyan-800 font-medium">
                      <span>📷 即時路況畫面</span>
                      <span className="text-[10px] text-cyan-600">（每 1 小時自動更新）</span>
                    </span>
                    <button
                      onClick={() => setWebcamRefreshKey(k => k + 1)}
                      className="px-1.5 py-0.5 bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-100 rounded text-[10px] font-medium transition-colors"
                      title="立即重新整理圖片"
                    >
                      重新整理 🔄
                    </button>
                  </div>

                  {loadingWebcam ? (
                    <div className="py-8 flex flex-col items-center justify-center text-gray-400 gap-2">
                      <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-[11px]">正在載入即時鏡頭畫面...</span>
                    </div>
                  ) : webcamImages.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {webcamImages.map((img, idx) => {
                        const hourlyTimestamp = Math.floor(Date.now() / 3600000);
                        const imgSrc = `${img.url}?t=${hourlyTimestamp}_${webcamRefreshKey}`;
                        return (
                          <div key={idx} className="relative rounded overflow-hidden border border-gray-200 bg-black aspect-[4/3] group shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgSrc}
                              alt={img.alt || img.direction}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                              loading="lazy"
                            />
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1 pt-3 text-[10px] font-medium text-white truncate text-center">
                              {img.direction}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-gray-400 text-xs">
                      目前暫無可用鏡頭畫面
                    </div>
                  )}

                  {selectedFacility.properties?.url && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-cyan-700 hover:bg-cyan-800 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往溫哥華官方路況網頁 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Popup>
        )}

      </Map>
    </div>
  );
}
