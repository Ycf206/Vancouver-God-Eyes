'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import Map, { NavigationControl, Marker, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl, getWsUrl } from '@/utils/api';

// Fix Next.js App Router Web Worker crash
if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre-gl-worker.mjs');
}

interface Vehicle {
  id: string;
  route_id: string;
  route_number?: string;
  route_name?: string;
  trip_id?: string;
  direction_id?: string;
  stop_id?: string;
  stop_seq?: number;
  origin?: string;
  destination?: string;
  operator?: string;
  next_stop_name?: string;
  next_stop_time?: string;
  next_stop_minutes?: number;
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
  const { layers, mapStyleType, searchTarget, setSearchTarget, isLayerPanelOpen } = useUIStore();
  const mapRef = useRef<MapRef>(null);

  // Resize map canvas smoothly when side panel toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.resize();
    }, 220);
    return () => clearTimeout(timer);
  }, [isLayerPanelOpen]);

  useEffect(() => {
    if (!layers.airports) {
      setSelectedAirport(null);
      if (searchTarget && searchTarget.category === 'airports') {
        setSearchTarget(null);
      }
    }
  }, [layers.airports, searchTarget, setSearchTarget]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [ferryVehicles, setFerryVehicles] = useState<FerryVehicle[]>([]);
  const [ferryTerminals, setFerryTerminals] = useState<Array<{geometry: {coordinates: number[]}, properties: {name?: string, code: string}}>>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedFlight, setSelectedFlight] = useState<any | null>(null);

  // Selected Flight Route GeoJSON LineString / MultiLineString (Great Circle Trajectory)
  const routeGeoJSON = useMemo(() => {
    let rawCoords = selectedFlight?.route_coords;

    // Fallback: If route_coords is missing, generate direct great circle trajectory
    if ((!rawCoords || rawCoords.length < 2) && selectedFlight?.origin_coord && selectedFlight?.dest_coord) {
      const [oLon, oLat] = selectedFlight.origin_coord;
      const [dLon, dLat] = selectedFlight.dest_coord;
      if (typeof oLon === 'number' && typeof dLon === 'number' && (oLon !== dLon || oLat !== dLat)) {
        const diffLon = dLon - oLon;
        let adjDLon = dLon;
        if (diffLon > 180) adjDLon -= 360;
        else if (diffLon < -180) adjDLon += 360;

        const pts: [number, number][] = [];
        const steps = 14;
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const cLon = oLon + f * (adjDLon - oLon);
          let cLat = oLat + f * (dLat - oLat);
          const span = Math.abs(adjDLon - oLon);
          if (span > 15) {
            cLat = Math.min(75, cLat + Math.sin(f * Math.PI) * Math.min(10, span * 0.08));
          }
          let nLon = cLon;
          while (nLon > 180) nLon -= 360;
          while (nLon < -180) nLon += 360;
          pts.push([Math.round(nLon * 10000) / 10000, Math.round(cLat * 10000) / 10000]);
        }
        rawCoords = pts;
      }
    }

    if (!rawCoords || rawCoords.length < 2) return null;

    // Normalize all coordinates to [-180, 180]
    const normalizedPts: [number, number][] = (rawCoords as [number, number][]).map(([lon, lat]) => {
      let nLon = lon;
      while (nLon > 180) nLon -= 360;
      while (nLon < -180) nLon += 360;
      return [Math.round(nLon * 10000) / 10000, Math.round(lat * 10000) / 10000];
    });

    // Check for antimeridian crossing (>180° jump between consecutive points)
    // and split into clean MultiLineString segments to eliminate cross-world horizontal lines!
    const segments: [number, number][][] = [];
    let currentSeg: [number, number][] = [normalizedPts[0]];

    for (let i = 1; i < normalizedPts.length; i++) {
      const [lon1, lat1] = normalizedPts[i - 1];
      const [lon2, lat2] = normalizedPts[i];
      const diff = lon2 - lon1;

      if (Math.abs(diff) > 180) {
        if (diff < 0) {
          // East to West crossing (e.g. +170 to -170): interpolate edge at 180 / -180
          const f = (180 - lon1) / ((lon2 + 360) - lon1);
          const crossLat = Math.round((lat1 + f * (lat2 - lat1)) * 10000) / 10000;
          currentSeg.push([180, crossLat]);
          segments.push(currentSeg);
          currentSeg = [[-180, crossLat], normalizedPts[i]];
        } else {
          // West to East crossing (e.g. -170 to +170): interpolate edge at -180 / 180
          const f = (-180 - lon1) / ((lon2 - 360) - lon1);
          const crossLat = Math.round((lat1 + f * (lat2 - lat1)) * 10000) / 10000;
          currentSeg.push([-180, crossLat]);
          segments.push(currentSeg);
          currentSeg = [[180, crossLat], normalizedPts[i]];
        }
      } else {
        currentSeg.push(normalizedPts[i]);
      }
    }
    segments.push(currentSeg);

    if (segments.length > 1) {
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: segments
        },
        properties: {
          is_domestic: selectedFlight?.is_domestic
        }
      };
    }

    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: segments[0]
      },
      properties: {
        is_domestic: selectedFlight?.is_domestic
      }
    };
  }, [selectedFlight]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [airports, setAirports] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedAirport, setSelectedAirport] = useState<any | null>(null);
  
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
  const [selectedBus, setSelectedBus] = useState<Vehicle | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [busDetails, setBusDetails] = useState<any | null>(null);
  const [loadingBusDetails, setLoadingBusDetails] = useState(false);

  const handleSelectBus = React.useCallback((v: Vehicle) => {
    setSelectedStop(null);
    setSelectedFacility(null);
    setSelectedTerminal(null);
    setSelectedFerry(null);
    setSelectedFlight(null);
    setSelectedAirport(null);
    setSelectedBus(v);
    setLoadingBusDetails(true);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
    const qs = new URLSearchParams({
      vehicle_id: v.id || '',
      route_id: v.route_id || '',
      trip_id: v.trip_id || '',
      direction_id: v.direction_id || '0',
      stop_id: v.stop_id || '',
      stop_seq: String(v.stop_seq || 0),
      lat: String(v.lat || 0),
      lon: String(v.lon || 0),
    });
    fetch(`${apiUrl}/api/transit/vehicle-details?${qs.toString()}`)
      .then(res => res.json())
      .then(data => {
        setBusDetails(data);
        setLoadingBusDetails(false);
      })
      .catch(err => {
        console.error('Error fetching bus details:', err);
        setLoadingBusDetails(false);
      });
  }, []);

  // Keep selectedBus live coordinates & stop list synced when vehicles update via WebSocket
  useEffect(() => {
    if (!selectedBus) return;
    const updated = vehicles.find(v => v.id === selectedBus.id);
    if (updated && (updated.lat !== selectedBus.lat || updated.lon !== selectedBus.lon || updated.stop_id !== selectedBus.stop_id || updated.next_stop_name !== selectedBus.next_stop_name)) {
      setSelectedBus(updated);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
      const qs = new URLSearchParams({
        vehicle_id: updated.id || '',
        route_id: updated.route_id || '',
        trip_id: updated.trip_id || '',
        direction_id: updated.direction_id || '0',
        stop_id: updated.stop_id || '',
        stop_seq: String(updated.stop_seq || 0),
        lat: String(updated.lat || 0),
        lon: String(updated.lon || 0),
      });
      fetch(`${apiUrl}/api/transit/vehicle-details?${qs.toString()}`)
        .then(res => res.json())
        .then(data => {
          setBusDetails(data);
        })
        .catch(err => {
          console.error('Error refreshing bus details:', err);
        });
    }
  }, [vehicles, selectedBus]);

  const busRouteGeoJSON = useMemo(() => {
    if (!selectedBus || !busDetails?.shape_coords || busDetails.shape_coords.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: busDetails.shape_coords,
      },
      properties: {
        color: busDetails.color || '#10b981',
      },
    };
  }, [selectedBus, busDetails]);


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

  // States for Hospital ER Wait Times
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hospitalWaitTimes, setHospitalWaitTimes] = useState<Record<string, any>>({});
  const [loadingWaitTimes, setLoadingWaitTimes] = useState(false);
  const [hospitalRefreshKey, setHospitalRefreshKey] = useState(0);

  // Fetch ER wait times when a hospital is selected
  useEffect(() => {
    if (selectedFacility && selectedFacility.facility_type === 'hospitals') {
      setLoadingWaitTimes(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
      fetch(`${apiUrl}/api/hospitals/waittimes`)
        .then(res => res.json())
        .then(data => {
          setHospitalWaitTimes(data.hospitals || {});
          setLoadingWaitTimes(false);
        })
        .catch(err => {
          console.error('Hospital wait times fetch error:', err);
          setLoadingWaitTimes(false);
        });
    }
  }, [selectedFacility, hospitalRefreshKey]);

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
    } else if (searchTarget.category === 'airports') {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedFlight(null);
      setSelectedAirport({
        geometry: { coordinates: [searchTarget.lon, searchTarget.lat] },
        properties: { name: searchTarget.title, ...(searchTarget.meta || {}) }
      });
    } else if (searchTarget.category === 'domestic_flight' || searchTarget.category === 'intl_flight' || searchTarget.category === 'flight_schedule') {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedAirport(null);
      setSelectedFlight(searchTarget.meta);
    } else if (
      [
        'fire_halls', 'community_centres', 'ev_charging', 'escooter', 'shared_bikes', 'bikeways',
        'traffic_cameras', 'safety_cameras', 'parking_meters', 'accessible_parking', 'motorcycle_parking',
        'hospitals', 'parks', 'parks_facilities', 'community_gardens', 'drinking_fountains',
        'public_washrooms', 'schools', 'libraries', 'food_vendors', 'homeless_shelters'
      ].includes(searchTarget.category)
    ) {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
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

    fetch('/vancouver_airports.geojson')
      .then(r => r.json())
      .then(data => {
         if(data && data.features) setAirports(data.features);
      }).catch(e => {
        console.error(e);
        const apiUrl = getApiUrl();
        fetch(`${apiUrl}/api/geojson/airports`)
          .then(r => r.json())
          .then(d => { if (d && d.features) setAirports(d.features); })
          .catch(err => console.error(err));
      });
  }, []);

  useEffect(() => {
    const wsUrl = getWsUrl();
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
    style.sources['shared-bikes'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/shared_bikes` };
    style.sources['bikeways'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/bikeways` };
    style.sources['fire-halls'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/fire_halls` };
    style.sources['community-centres'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/community_centres` };
    style.sources['traffic-cameras'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/traffic_cameras` };
    style.sources['safety-cameras'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/safety_cameras` };
    style.sources['hospitals'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/hospitals` };
    style.sources['parks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/parks` };
    style.sources['parks-facilities'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/parks_facilities` };
    style.sources['community-gardens'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/community_gardens` };
    style.sources['drinking-fountains'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/drinking_fountains` };
    style.sources['public-washrooms'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/public_washrooms` };
    style.sources['schools'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/schools` };
    style.sources['libraries'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/libraries` };
    style.sources['food-vendors'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/food_vendors` };
    style.sources['homeless-shelters'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/homeless_shelters` };

    // Bus Routes & Stops (Merged under busRoutes)
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

    // SkyTrain Routes & Stops (Merged under skytrainRoutes)
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

    // SeaBus Routes & Stops (Merged under seabusRoutes)
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

    // Road Facilities: Bikeways (單車徑 LineString — 4 種高對比度鮮明配色)
    if (layers.bikeways) {
      style.layers.push({
        id: 'bikeways-casing-layer',
        type: 'line',
        source: 'bikeways',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.6, 13, 4.6, 16, 7.2],
          'line-opacity': 0.6
        }
      });
      style.layers.push({
        id: 'bikeways-layer',
        type: 'line',
        source: 'bikeways',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'bikeway_type'],
            'Protected Bike Lanes', '#10b981', // 翠綠 Emerald (受保護獨立單車道)
            'Painted Lanes', '#0ea5e9',        // 天藍 Sky Blue (路面標線單車道)
            'Local Street', '#f59e0b',         // 琥珀金 Amber (社區慢速單車街)
            'Shared Lanes', '#a855f7',         // 紫羅蘭 Purple (混合共用車道)
            '#10b981'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 3.0, 16, 4.8],
          'line-opacity': 0.94
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

    // Road Facilities: Shared Bikes (Mobi by Rogers)
    if (layers.sharedBikes) {
      style.layers.push({
        id: 'shared-bikes-layer',
        type: 'circle',
        source: 'shared-bikes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 15, 8.5, 17, 11],
          'circle-color': '#10b981',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'shared-bikes-symbol-layer',
        type: 'symbol',
        source: 'shared-bikes',
        minzoom: 15,
        layout: {
          'text-field': '🚲',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
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

    // Road Facilities: Intersection Safety Cameras (Red Light & Speed Enforcement)
    if (layers.safetyCameras) {
      style.layers.push({
        id: 'safety-cameras-layer',
        type: 'circle',
        source: 'safety-cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 15, 9, 17, 12],
          'circle-color': [
            'case',
            ['boolean', ['get', 'has_speed'], false],
            '#e11d48',
            '#f97316'
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'safety-cameras-symbol-layer',
        type: 'symbol',
        source: 'safety-cameras',
        minzoom: 15,
        layout: {
          'text-field': '🚨',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Government Facilities: Hospitals (急診醫院)
    if (layers.hospitals) {
      style.layers.push({
        id: 'hospitals-layer',
        type: 'circle',
        source: 'hospitals',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 15, 9.5, 17, 13],
          'circle-color': '#10b981',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'hospitals-symbol-layer',
        type: 'symbol',
        source: 'hospitals',
        minzoom: 15,
        layout: {
          'text-field': '🏥',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Nature Facilities: Parks (公園)
    if (layers.parks) {
      style.layers.push({
        id: 'parks-layer',
        type: 'circle',
        source: 'parks',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 15, 9, 17, 13],
          'circle-color': '#16a34a',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'parks-symbol-layer',
        type: 'symbol',
        source: 'parks',
        minzoom: 15,
        layout: {
          'text-field': '🌲',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Nature Facilities: Parks Facilities (休憩設施)
    if (layers.parksFacilities) {
      style.layers.push({
        id: 'parks-facilities-layer',
        type: 'circle',
        source: 'parks-facilities',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8, 17, 11],
          'circle-color': '#0d9488',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'parks-facilities-symbol-layer',
        type: 'symbol',
        source: 'parks-facilities',
        minzoom: 15,
        layout: {
          'text-field': '🛝',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Nature Facilities: Community Gardens (社區花園)
    if (layers.communityGardens) {
      style.layers.push({
        id: 'community-gardens-layer',
        type: 'circle',
        source: 'community-gardens',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#65a30d',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'community-gardens-symbol-layer',
        type: 'symbol',
        source: 'community-gardens',
        minzoom: 15,
        layout: {
          'text-field': '🌻',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Nature Facilities: Drinking Fountains (飲水器)
    if (layers.drinkingFountains) {
      style.layers.push({
        id: 'drinking-fountains-layer',
        type: 'circle',
        source: 'drinking-fountains',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 11],
          'circle-color': '#0284c7',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'drinking-fountains-symbol-layer',
        type: 'symbol',
        source: 'drinking-fountains',
        minzoom: 15,
        layout: {
          'text-field': '💧',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Nature Facilities: Public Washrooms (公共廁所)
    if (layers.publicWashrooms) {
      style.layers.push({
        id: 'public-washrooms-layer',
        type: 'circle',
        source: 'public-washrooms',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#06b6d4',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'public-washrooms-symbol-layer',
        type: 'symbol',
        source: 'public-washrooms',
        minzoom: 15,
        layout: {
          'text-field': '🚻',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Life Facilities: Schools (學校)
    if (layers.schools) {
      style.layers.push({
        id: 'schools-layer',
        type: 'circle',
        source: 'schools',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#3b82f6',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'schools-symbol-layer',
        type: 'symbol',
        source: 'schools',
        minzoom: 15,
        layout: {
          'text-field': '🏫',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Life Facilities: Libraries (圖書館)
    if (layers.libraries) {
      style.layers.push({
        id: 'libraries-layer',
        type: 'circle',
        source: 'libraries',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#f59e0b',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'libraries-symbol-layer',
        type: 'symbol',
        source: 'libraries',
        minzoom: 15,
        layout: {
          'text-field': '📚',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Life Facilities: Food Vendors (食品攤販)
    if (layers.foodVendors) {
      style.layers.push({
        id: 'food-vendors-layer',
        type: 'circle',
        source: 'food-vendors',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#f97316',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'food-vendors-symbol-layer',
        type: 'symbol',
        source: 'food-vendors',
        minzoom: 15,
        layout: {
          'text-field': '🍱',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Life Facilities: Homeless Shelters (無家者庇護所)
    if (layers.homelessShelters) {
      style.layers.push({
        id: 'homeless-shelters-layer',
        type: 'circle',
        source: 'homeless-shelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 15, 8.5, 17, 11],
          'circle-color': '#f43f5e',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'homeless-shelters-symbol-layer',
        type: 'symbol',
        source: 'homeless-shelters',
        minzoom: 15,
        layout: {
          'text-field': '🏠',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
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
    layers.busRoutes, 
    layers.seabusRoutes, 
    layers.bcferriesRoutes, 
    layers.parkingMeters, 
    layers.accessibleParking, 
    layers.motorcycleParking, 
    layers.evCharging, 
    layers.escooter,
    layers.sharedBikes,
    layers.bikeways,
    layers.trafficCameras,
    layers.safetyCameras,
    layers.fireHalls,
    layers.communityCentres,
    layers.hospitals,
    layers.parks,
    layers.parksFacilities,
    layers.communityGardens,
    layers.drinkingFountains,
    layers.publicWashrooms,
    layers.schools,
    layers.libraries,
    layers.foodVendors,
    layers.homelessShelters,
    mapStyleType
  ]);

  return (
    <div 
      className={`h-full absolute top-[60px] bottom-0 right-0 z-0 transition-[left,width] duration-200 ${
        isLayerPanelOpen ? 'left-[240px] w-[calc(100%-240px)]' : 'left-0 w-full'
      }`}
    >
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
          'bikeways-layer',
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
          'shared-bikes-layer',
          'shared-bikes-symbol-layer',
          'traffic-cameras-layer',
          'traffic-cameras-symbol-layer',
          'safety-cameras-layer',
          'safety-cameras-symbol-layer',
          'fire-halls-layer',
          'fire-halls-symbol-layer',
          'community-centres-layer',
          'community-centres-symbol-layer',
          'hospitals-layer',
          'hospitals-symbol-layer',
          'parks-layer',
          'parks-symbol-layer',
          'parks-facilities-layer',
          'parks-facilities-symbol-layer',
          'community-gardens-layer',
          'community-gardens-symbol-layer',
          'drinking-fountains-layer',
          'drinking-fountains-symbol-layer',
          'public-washrooms-layer',
          'public-washrooms-symbol-layer',
          'schools-layer',
          'schools-symbol-layer',
          'libraries-layer',
          'libraries-symbol-layer',
          'food-vendors-layer',
          'food-vendors-symbol-layer',
          'homeless-shelters-layer',
          'homeless-shelters-symbol-layer'
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
          } else if (layerId === 'bikeways-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? props.center_lon ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? props.center_lat ?? 49.2827;
            setSelectedFacility({
              id: props.id || '',
              facility_type: 'bikeways',
              name: props.name || '溫哥華單車專用道',
              local_area: props.local_area || '溫哥華市',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (
            layerId.startsWith('parking-meters') || 
            layerId.startsWith('accessible-parking') || 
            layerId.startsWith('motorcycle-parking') || 
            layerId.startsWith('ev-charging') ||
            layerId.startsWith('escooter') ||
            layerId.startsWith('shared-bikes') ||
            layerId.startsWith('traffic-cameras') ||
            layerId.startsWith('safety-cameras') ||
            layerId.startsWith('fire-halls') ||
            layerId.startsWith('community-centres') ||
            layerId.startsWith('hospitals') ||
            layerId.startsWith('parks') ||
            layerId.startsWith('community-gardens') ||
            layerId.startsWith('drinking-fountains') ||
            layerId.startsWith('public-washrooms') ||
            layerId.startsWith('schools') ||
            layerId.startsWith('libraries') ||
            layerId.startsWith('food-vendors') ||
            layerId.startsWith('homeless-shelters')
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
            setSelectedAirport(null);
            setSelectedFlight(null);
            setSelectedBus(null);
            setBusDetails(null);
            setSearchTarget(null);
          }
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 選中巴士之路線軌跡與沿線站點 (Selected Bus Route Line & Stops on Map) */}
        {selectedBus && busRouteGeoJSON && (
          <Source id="selected-bus-route-source" type="geojson" data={busRouteGeoJSON}>
            <Layer
              id="selected-bus-route-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': busDetails?.color || '#10b981',
                'line-width': 8,
                'line-blur': 3,
                'line-opacity': 0.55
              }}
            />
            <Layer
              id="selected-bus-route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': busDetails?.color || '#10b981',
                'line-width': 4,
                'line-opacity': 0.95
              }}
            />
          </Source>
        )}

        {selectedBus && busDetails?.stops && busDetails.stops.map((st: { seq: number; stop_id: string; name: string; lat: number; lon: number; status: string }) => (
          <Marker key={`bus-stop-seq-${st.seq}-${st.stop_id}`} longitude={st.lon} latitude={st.lat} anchor="center">
            <div
              className={`rounded-full border transition-transform ${
                st.status === 'next'
                  ? 'w-3.5 h-3.5 bg-amber-400 border-white shadow-[0_0_8px_rgba(251,191,36,0.95)] scale-125 z-20'
                  : st.status === 'passed'
                  ? 'w-2 h-2 bg-gray-400/80 border-gray-800 opacity-70 z-10'
                  : 'w-2.5 h-2.5 bg-emerald-400 border-gray-900 shadow-sm z-10'
              }`}
              title={`${st.seq}. ${st.name}`}
            />
          </Marker>
        ))}

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
          const isSelected = selectedBus?.id === v.id;
          const busNum = v.route_number || v.route_id;
          if (v.is_seabus) {
            if (!layers.seabusVehicles) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectBus(v);
                  }}
                  className={`relative flex items-center justify-center w-6 h-6 bg-[#8b786d]/90 rounded-full cursor-pointer tooltip border-[1.5px] border-white shadow-md backdrop-blur-sm transition-transform hover:scale-125 z-20 ${
                    isSelected ? 'ring-4 ring-amber-400/80 scale-125 z-30' : ''
                  }`}
                  title={`SeaBus${v.destination ? ` 往 ${v.destination}` : ''}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20"/><path d="M6 12l2-4h8l2 4"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
              </Marker>
            );
          } else {
            if (!layers.bus) return null;
            return (
              <Marker key={v.id} longitude={v.lon} latitude={v.lat} anchor="center">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectBus(v);
                  }}
                  className={`relative flex items-center justify-center w-5 h-5 bg-emerald-500/90 rounded-full cursor-pointer tooltip border border-white/80 shadow-md backdrop-blur-sm hover:scale-125 transition-transform z-10 ${
                    isSelected ? 'ring-4 ring-emerald-300/90 bg-emerald-600 scale-125 z-30' : ''
                  }`}
                  title={`巴士 ${busNum}${v.destination ? ` 去 ${v.destination}` : ''}`}
                >
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

        {/* 巴士 / 海上巴士 即時動態 Popup (Live Bus / SeaBus Click Popup) */}
        {selectedBus && (() => {
          const busNum = busDetails?.route_number || selectedBus.route_number || selectedBus.route_id;
          const destName = busDetails?.destination || selectedBus.destination || '終點站';
          const originName = busDetails?.origin || selectedBus.origin || '起點站';
          const operatorName = busDetails?.operator || selectedBus.operator || 'TransLink (CMBC 岸山巴士)';
          const nextStopName = busDetails?.next_stop_name || selectedBus.next_stop_name || '沿線行駛中';
          const nextStopTime = busDetails?.next_stop_time || selectedBus.next_stop_time || '';
          const nextStopMin = busDetails?.next_stop_minutes ?? selectedBus.next_stop_minutes;
          const stopList = busDetails?.stops || [];

          return (
            <Popup
              longitude={selectedBus.lon}
              latitude={selectedBus.lat}
              anchor="bottom"
              onClose={() => {
                setSelectedBus(null);
                setBusDetails(null);
              }}
              closeOnClick={false}
              closeButton={false}
              className="z-50"
              offset={[0, -12]}
              maxWidth="360px"
            >
              <div className="w-[310px] sm:w-[335px] max-w-[90vw] bg-[#161922] text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] -m-[10px]">
                {/* Header */}
                <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38]">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5 shadow-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate">
                        {busNum} 去 {destName}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.9)]"></span>
                        <span className="text-[11px] font-semibold text-emerald-400">即時更新中</span>
                        {selectedBus.id && (
                          <span className="text-[10px] text-gray-400 font-mono ml-1">#{selectedBus.id}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedBus(null);
                      setBusDetails(null);
                    }}
                    className="text-gray-400 hover:text-white text-xl leading-none px-1.5 py-0.5 rounded hover:bg-[#252a38] transition-colors shrink-0"
                  >
                    &times;
                  </button>
                </div>

                {/* Info Rows */}
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400 shrink-0">營辦商</span>
                    <span className="font-bold text-gray-100 text-right truncate">{operatorName}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400 shrink-0">起點</span>
                    <span className="font-bold text-gray-100 text-right truncate">{originName}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400 shrink-0">終點</span>
                    <span className="font-bold text-gray-100 text-right truncate">{destName}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400 shrink-0">當前</span>
                    <span className="font-bold text-emerald-400 text-right truncate">開往 {destName}</span>
                  </div>
                  <div className="flex justify-between items-start gap-2 pt-0.5">
                    <span className="text-gray-400 shrink-0 mt-0.5">下一站</span>
                    <div className="flex flex-col items-end text-right min-w-0">
                      <span className="font-bold text-white leading-snug">{nextStopName}</span>
                      <span className="text-[11px] font-bold text-amber-400 mt-0.5">
                        {nextStopTime
                          ? `預計 ${nextStopTime} (${nextStopMin !== undefined && nextStopMin !== null ? (nextStopMin <= 0 ? '即將進站' : `${nextStopMin} 分鐘後`) : '行駛中'})`
                          : '即時定位中'}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400 shrink-0">運行</span>
                    <span className="font-bold text-emerald-400">準時</span>
                  </div>
                </div>

                {/* Stops List Box */}
                <div className="mt-3 pt-2.5 border-t border-[#262b38]">
                  <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2">
                    <div className="text-[11px] text-gray-400 font-medium mb-1.5 px-1 flex items-center justify-between">
                      <span>
                        {loadingBusDetails
                          ? '載入路線站點中...'
                          : `${stopList.length} 個站`}
                      </span>
                      {busDetails?.route_name && (
                        <span className="text-[10px] text-emerald-400/80 font-mono truncate max-w-[140px]">
                          {busDetails.route_name}
                        </span>
                      )}
                    </div>
                    {loadingBusDetails ? (
                      <div className="py-4 flex items-center justify-center gap-2 text-xs text-gray-400">
                        <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>讀取 GTFS 站序與軌跡...</span>
                      </div>
                    ) : stopList.length > 0 ? (
                      <div className="max-h-[155px] overflow-y-auto flex flex-col gap-0.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
                        {stopList.map((st: { seq: number; stop_id: string; name: string; lat: number; lon: number; status: string; eta_time?: string; eta_minutes?: number }) => {
                          const isNext = st.status === 'next';
                          const isPassed = st.status === 'passed';
                          return (
                            <div
                              key={`popup-stop-${st.seq}`}
                              ref={isNext ? (el) => { el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } : undefined}
                              onClick={() => {
                                mapRef.current?.flyTo({ center: [st.lon, st.lat], zoom: 15.5, duration: 800 });
                              }}
                              className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[11.5px] cursor-pointer transition-colors ${
                                isNext
                                  ? 'bg-amber-500/20 border-l-2 border-amber-400 text-white font-bold'
                                  : isPassed
                                  ? 'text-gray-500 hover:bg-[#1a1f2c]'
                                  : 'text-gray-200 hover:bg-[#1a1f2c]'
                              }`}
                            >
                              <span className="truncate">
                                {st.seq}. {st.name}
                              </span>
                              <span className={`shrink-0 text-[10.5px] font-semibold ${
                                isNext
                                  ? 'text-amber-400 font-bold'
                                  : isPassed
                                  ? 'text-gray-600'
                                  : 'text-emerald-400/90 font-mono'
                              }`}>
                                {isNext
                                  ? '下個站'
                                  : isPassed
                                  ? '已過站'
                                  : st.eta_minutes !== undefined && st.eta_minutes !== null
                                  ? `${st.eta_minutes} 分`
                                  : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-500 py-2 text-center">暫無詳細站序資料</div>
                    )}
                  </div>
                </div>
              </div>
            </Popup>
          );
        })()}

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
            <div className="p-1 min-w-[215px] text-gray-800">
              <h3 className="font-bold text-sm mb-2 pb-1 border-b">{selectedStop.name} <span className="text-xs text-gray-400">({selectedStop.id})</span></h3>
              {loadingArrivals ? (
                <div className="text-xs text-gray-500 flex items-center gap-2 mt-2">
                  <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  載入預估時間...
                </div>
              ) : arrivals.length > 0 ? (
                <div className="flex flex-col gap-1.5 mt-2">
                  {arrivals.map((arr, i) => {
                    const busNumber = arr.route_number || arr.route_id;
                    const isRailOrFerry = typeof busNumber === 'string' && (busNumber.includes('Line') || busNumber.includes('SeaBus') || busNumber === 'WCE');
                    return (
                      <div key={i} className="flex justify-between items-center text-xs gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md shrink-0 font-mono">
                            {isRailOrFerry ? busNumber : `巴士 ${busNumber}`}
                          </span>
                          {arr.destination && (
                            <span className="text-[11px] text-gray-500 truncate">
                              往 {arr.destination}
                            </span>
                          )}
                        </div>
                        <span className="text-gray-600 shrink-0">
                          {arr.minutes <= 0 ? (
                            <span className="text-red-500 font-bold animate-pulse">即將進站</span>
                          ) : (
                            <span><strong className="text-base text-gray-900">{arr.minutes}</strong> 分鐘</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-500 mt-2">目前沒有即將到站的班次</div>
              )}
            </div>
          </Popup>
        )}

        {/* BC Ferries Terminals (Merged under bcferriesRoutes '路線') */}
        {layers.bcferriesRoutes && ferryTerminals.map((t, i) => (
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

        {/* 機場與水上飛機場標記 (Airports & Seaplane Bases) */}
        {(layers.airports !== false) && airports.map((ap, i) => {
          const coords = ap.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const props = ap.properties || {};
          const isMain = props.sub_type === 'international_airport';
          const isSeaplane = props.sub_type === 'seaplane_base' || props.sub_type === 'south_terminal';

          return (
            <Marker key={props.id || `ap-${i}`} longitude={coords[0]} latitude={coords[1]} anchor="center">
              <div
                className={`relative flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shadow-xl cursor-pointer backdrop-blur-md transition-all hover:scale-125 z-35 select-none ${
                  isMain 
                    ? 'bg-sky-600 text-white ring-2 ring-sky-400/50' 
                    : isSeaplane 
                    ? 'bg-teal-600 text-white' 
                    : 'bg-emerald-600 text-white'
                }`}
                title={props.name}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAirport(ap);
                }}
              >
                <span className="text-sm">{props.icon || '🛫'}</span>
              </div>
            </Marker>
          );
        })}

        {/* Airport Detail Popup */}
        {selectedAirport && (
          <Popup
            longitude={selectedAirport.geometry.coordinates[0]}
            latitude={selectedAirport.geometry.coordinates[1]}
            anchor="bottom"
            onClose={() => {
              setSelectedAirport(null);
              if (searchTarget?.category === 'airports') {
                setSearchTarget(null);
              }
            }}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -12]}
            maxWidth="360px"
          >
            <div className="p-3.5 w-[320px] sm:w-[350px] max-w-[88vw] text-gray-800">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{selectedAirport.properties?.icon || '🛫'}</span>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight">
                      {selectedAirport.properties?.name}
                    </h3>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {selectedAirport.properties?.name_en || ''}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedAirport(null);
                    if (searchTarget?.category === 'airports') {
                      setSearchTarget(null);
                    }
                  }}
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 -mt-1"
                >
                  &times;
                </button>
              </div>

              <div className="flex flex-col gap-1.5 text-xs">
                {selectedAirport.properties?.iata && (
                  <div className="flex justify-between items-center py-0.5 border-b border-gray-50">
                    <span className="text-gray-500">機場代碼</span>
                    <span className="font-mono font-bold text-sky-700">
                      IATA: {selectedAirport.properties.iata} / ICAO: {selectedAirport.properties.icao}
                    </span>
                  </div>
                )}
                {selectedAirport.properties?.address && (
                  <div className="flex justify-between items-start py-0.5 border-b border-gray-50">
                    <span className="text-gray-500 shrink-0">地址</span>
                    <span className="text-right text-gray-700">{selectedAirport.properties.address}</span>
                  </div>
                )}
                {selectedAirport.properties?.transit_access && (
                  <div className="flex justify-between items-start py-0.5 border-b border-gray-50">
                    <span className="text-gray-500 shrink-0">大眾交通</span>
                    <span className="text-right font-medium text-emerald-700">{selectedAirport.properties.transit_access}</span>
                  </div>
                )}
                {selectedAirport.properties?.runways && (
                  <div className="flex justify-between items-start py-0.5 border-b border-gray-50">
                    <span className="text-gray-500 shrink-0">跑道長度</span>
                    <span className="text-right text-gray-600 font-mono text-[11px]">{selectedAirport.properties.runways}</span>
                  </div>
                )}
                {selectedAirport.properties?.operators && (
                  <div className="flex justify-between items-start py-0.5 border-b border-gray-50">
                    <span className="text-gray-500 shrink-0">主要航司</span>
                    <span className="text-right text-gray-700">{selectedAirport.properties.operators}</span>
                  </div>
                )}
                {selectedAirport.properties?.highlights && (
                  <div className="mt-1 p-2 bg-emerald-50 rounded-lg text-[11px] text-emerald-800 border border-emerald-100">
                    {selectedAirport.properties.highlights}
                  </div>
                )}
              </div>
            </div>
          </Popup>
        )}

        {/* Selected Flight Trajectory Route Line */}
        {routeGeoJSON && (
          <Source id="flight-trajectory-source" type="geojson" data={routeGeoJSON}>
            <Layer
              id="flight-trajectory-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': selectedFlight?.is_domestic ? '#38bdf8' : '#f59e0b',
                'line-width': 7,
                'line-blur': 4,
                'line-opacity': 0.65
              }}
            />
            <Layer
              id="flight-trajectory-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': selectedFlight?.is_domestic ? '#0284c7' : '#d97706',
                'line-width': 2.8,
                'line-dasharray': [2, 1]
              }}
            />
          </Source>
        )}

        {/* Selected Flight Waypoint Markers for Origin & Destination */}
        {(() => {
          if (!selectedFlight) return null;
          const isDom = selectedFlight.is_domestic ?? false;
          const isDep = selectedFlight.flight_type === 'dep';
          let origCode = selectedFlight.origin_code;
          let origCity = selectedFlight.origin_city || selectedFlight.origin_name;
          let destCode = selectedFlight.dest_code;
          let destCity = selectedFlight.dest_city || selectedFlight.dest_name;

          if (!origCode && !destCode) {
            origCode = isDep ? 'YVR' : (isDom ? 'YYC' : 'SEA');
            origCity = isDep ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            destCode = isDep ? (isDom ? 'YYC' : 'SEA') : 'YVR';
            destCity = isDep ? (isDom ? '卡加利' : '西雅圖') : '溫哥華';
          } else if (origCode === destCode || (origCode === 'YVR' && destCode === 'YVR')) {
            if (isDep) {
              origCode = 'YVR';
              origCity = '溫哥華';
              destCode = isDom ? 'YYC' : 'SEA';
              destCity = isDom ? '卡加利' : '西雅圖';
            } else {
              origCode = isDom ? 'YYC' : 'SEA';
              origCity = isDom ? '卡加利' : '西雅圖';
              destCode = 'YVR';
              destCity = '溫哥華';
            }
          } else {
            if (!origCode) {
              origCode = destCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
              origCity = origCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            }
            if (!destCode) {
              destCode = origCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
              destCity = destCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            }
          }

          const hasOrigCoord = selectedFlight.origin_coord && selectedFlight.origin_coord.length === 2;
          const hasDestCoord = selectedFlight.dest_coord && selectedFlight.dest_coord.length === 2;

          return (
            <>
              {hasOrigCoord && (
                <Marker longitude={selectedFlight.origin_coord[0]} latitude={selectedFlight.origin_coord[1]} anchor="center">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14161a]/95 text-white border border-sky-400 shadow-xl text-[10.5px] font-bold z-30 pointer-events-none backdrop-blur-md">
                    <span className="text-xs">🛫</span>
                    <span className="font-mono">{origCode}</span>
                    {origCity && <span className="text-[9.5px] text-gray-300 font-normal">({origCity.split(' ')[0]})</span>}
                  </div>
                </Marker>
              )}
              {hasDestCoord && (
                <Marker longitude={selectedFlight.dest_coord[0]} latitude={selectedFlight.dest_coord[1]} anchor="center">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14161a]/95 text-white border border-amber-400 shadow-xl text-[10.5px] font-bold z-30 pointer-events-none backdrop-blur-md">
                    <span className="text-xs">🛬</span>
                    <span className="font-mono">{destCode}</span>
                    {destCity && <span className="text-[9.5px] text-gray-300 font-normal">({destCity.split(' ')[0]})</span>}
                  </div>
                </Marker>
              )}
            </>
          );
        })()}

        {/* Live Flight Detail Popup */}
        {selectedFlight && (() => {
          const isDom = selectedFlight.is_domestic ?? false;
          const isDep = selectedFlight.flight_type === 'dep';
          let origCode = selectedFlight.origin_code;
          let origCity = selectedFlight.origin_city || selectedFlight.origin_name;
          let destCode = selectedFlight.dest_code;
          let destCity = selectedFlight.dest_city || selectedFlight.dest_name;

          if (!origCode && !destCode) {
            origCode = isDep ? 'YVR' : (isDom ? 'YYC' : 'SEA');
            origCity = isDep ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            destCode = isDep ? (isDom ? 'YYC' : 'SEA') : 'YVR';
            destCity = isDep ? (isDom ? '卡加利' : '西雅圖') : '溫哥華';
          } else if (origCode === destCode || (origCode === 'YVR' && destCode === 'YVR')) {
            if (isDep) {
              origCode = 'YVR';
              origCity = '溫哥華';
              destCode = isDom ? 'YYC' : 'SEA';
              destCity = isDom ? '卡加利' : '西雅圖';
            } else {
              origCode = isDom ? 'YYC' : 'SEA';
              origCity = isDom ? '卡加利' : '西雅圖';
              destCode = 'YVR';
              destCity = '溫哥華';
            }
          } else {
            if (!origCode) {
              origCode = destCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
              origCity = origCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            }
            if (!destCode) {
              destCode = origCode === 'YVR' ? (isDom ? 'YYC' : 'SEA') : 'YVR';
              destCity = destCode === 'YVR' ? '溫哥華' : (isDom ? '卡加利' : '西雅圖');
            }
          }

          // Anchor popup at YVR (destination for arr, origin for dep)
          let popupLon = -123.1815;
          let popupLat = 49.1967;
          if (selectedFlight.flight_type === 'dep') {
            popupLon = selectedFlight.origin_coord?.[0] ?? -123.1815;
            popupLat = selectedFlight.origin_coord?.[1] ?? 49.1967;
          } else {
            popupLon = selectedFlight.dest_coord?.[0] ?? -123.1815;
            popupLat = selectedFlight.dest_coord?.[1] ?? 49.1967;
          }

          return (
          <Popup
            longitude={popupLon}
            latitude={popupLat}
            anchor="bottom"
            onClose={() => {
              setSelectedFlight(null);
              setSearchTarget(null);
            }}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -14]}
            maxWidth="370px"
          >
            <div className="p-3.5 w-[320px] sm:w-[350px] max-w-[90vw] text-gray-800">
              {/* Header */}
              <div className="flex items-start justify-between pb-2 mb-2.5 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0 ${
                    selectedFlight.is_domestic ? 'bg-sky-500' : 'bg-amber-500'
                  }`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
                      <path d="M10.18 9 L2.5 12.5 L2.5 14.5 L10.18 12.5 L10.18 19 L7.5 21 L7.5 22.5 L12 21 L16.5 22.5 L16.5 21 L13.82 19 L13.82 12.5 L21.5 14.5 L21.5 12.5 L13.82 9 L13.82 3 C13.82 1.9 12.92 1 12 1 C11.08 1 10.18 1.9 10.18 3 Z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-gray-900 text-base font-mono">{selectedFlight.flight_no}</h3>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                        selectedFlight.is_domestic 
                          ? 'bg-sky-100 text-sky-800 border border-sky-200' 
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}>
                        {selectedFlight.is_domestic ? '🇨🇦 國內航班' : '🌐 國際航班'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-medium truncate max-w-[190px]">
                      {selectedFlight.airline}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedFlight(null);
                    setSearchTarget(null);
                  }}
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 -mt-1"
                >
                  &times;
                </button>
              </div>

              {/* Route Banner (出發地 ➔ 目的地) */}
              <div className="mb-2.5 p-2.5 rounded-xl bg-gradient-to-r from-gray-50 via-sky-50/40 to-gray-50 border border-gray-200/80 shadow-sm">
                <div className="flex items-center justify-between">
                  {/* Origin */}
                  <div className="flex flex-col min-w-0 max-w-[44%]">
                    <span className="text-[10px] text-gray-500 flex items-center gap-1 font-medium">
                      <span>🛫</span>
                      <span>起飛出發</span>
                    </span>
                    <span className="font-bold text-gray-900 text-sm truncate font-mono">
                      {origCode}
                    </span>
                    <span className="text-[10.5px] text-gray-600 truncate font-medium">
                      {origCity}
                    </span>
                    {selectedFlight.departure_time && (
                      <span className="text-[11px] font-mono font-bold text-sky-700 mt-0.5">
                        {selectedFlight.departure_time}
                      </span>
                    )}
                  </div>

                  {/* Route Indicator Arrow */}
                  <div className="flex flex-col items-center px-1">
                    <span className="text-sky-500 font-bold text-sm">➔</span>
                    <span className="text-[9px] text-gray-400 font-mono">大圓航線</span>
                  </div>

                  {/* Destination */}
                  <div className="flex flex-col min-w-0 max-w-[44%] text-right items-end">
                    <span className="text-[10px] text-gray-500 flex items-center gap-1 font-medium">
                      <span>預計抵達</span>
                      <span>🛬</span>
                    </span>
                    <span className="font-bold text-gray-900 text-sm truncate font-mono">
                      {destCode}
                    </span>
                    <span className="text-[10.5px] text-gray-600 truncate font-medium">
                      {destCity}
                    </span>
                    {selectedFlight.arrival_time && (
                      <span className="text-[11px] font-mono font-bold text-amber-700 mt-0.5">
                        {selectedFlight.arrival_time}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Terminal & Gate & Status */}
              <div className="mb-2.5 flex items-center justify-between bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-100 text-xs">
                <div className="flex items-center gap-1.5 truncate max-w-[65%]">
                  <span className="text-gray-500 text-[11px] shrink-0">航廈/閘口:</span>
                  <span className="font-semibold text-gray-800 text-[11.5px] truncate">
                    {selectedFlight.terminal?.includes('航廈') ? selectedFlight.terminal.split(' ')[0] : selectedFlight.terminal || '主航廈'}
                    {selectedFlight.gate && selectedFlight.gate !== '--'
                      ? ` · ${
                          selectedFlight.gate.startsWith('Gate') ||
                          selectedFlight.gate.includes('登機門') ||
                          selectedFlight.gate.includes('轉盤') ||
                          selectedFlight.gate.includes('出發') ||
                          selectedFlight.gate.includes('抵達')
                            ? selectedFlight.gate
                            : `閘口 ${selectedFlight.gate}`
                        }`
                      : ''}
                  </span>
                </div>
                <span className="text-[11px] font-bold text-sky-700 flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping"></span>
                  {selectedFlight.status || '依時刻表排程'}
                </span>
              </div>

              {/* Remaining Time & Live Flight Progress Bar */}
              {(() => {
                const nowMs = Date.now();
                const liveRemaining = (() => {
                  if (selectedFlight.target_dt_iso) {
                    const targetMs = new Date(selectedFlight.target_dt_iso).getTime();
                    if (!isNaN(targetMs)) {
                      const diffMin = Math.round((targetMs - nowMs) / 60000);
                      if (diffMin < -45) return isDep ? '已起飛' : '已降落';
                      if (diffMin < 0) return isDep ? `已起飛 (${Math.abs(diffMin)}分前)` : `已降落 (${Math.abs(diffMin)}分前)`;
                      if (diffMin <= 10) return isDep ? `即將起飛 (${diffMin}分)` : `即將降落 (${diffMin}分)`;
                      if (diffMin < 60) return `剩餘 ${diffMin} 分鐘`;
                      const h = Math.floor(diffMin / 60);
                      const m = diffMin % 60;
                      return m > 0 ? `剩餘 ${h} 小時 ${m} 分` : `剩餘 ${h} 小時`;
                    }
                  }
                  return selectedFlight.remaining_time || '依表訂時刻';
                })();

                let depMs = selectedFlight.dep_dt_iso ? new Date(selectedFlight.dep_dt_iso).getTime() : NaN;
                let arrMs = selectedFlight.arr_dt_iso ? new Date(selectedFlight.arr_dt_iso).getTime() : NaN;
                const targetMs = selectedFlight.target_dt_iso ? new Date(selectedFlight.target_dt_iso).getTime() : NaN;
                if (!isNaN(targetMs)) {
                  const defaultDurMs = (isDom ? 2.5 : 8.5) * 3600000;
                  if (isDep) {
                    if (isNaN(depMs)) depMs = targetMs;
                    if (isNaN(arrMs)) arrMs = depMs + defaultDurMs;
                  } else {
                    if (isNaN(arrMs)) arrMs = targetMs;
                    if (isNaN(depMs)) depMs = arrMs - defaultDurMs;
                  }
                }

                let pct = typeof selectedFlight.progress_percent === 'number' ? selectedFlight.progress_percent : 0;
                let phaseLabel = '尚未起飛';
                if (!isNaN(depMs) && !isNaN(arrMs) && arrMs > depMs) {
                  if (nowMs <= depMs) {
                    pct = 0;
                    phaseLabel = '尚未起飛';
                  } else if (nowMs >= arrMs) {
                    pct = 100;
                    phaseLabel = '已抵達目的地';
                  } else {
                    pct = Math.max(1, Math.min(99, Math.round(((nowMs - depMs) / (arrMs - depMs)) * 100)));
                    phaseLabel = '空中飛行中';
                  }
                }

                return (
                  <div className="mb-2 p-2.5 rounded-lg bg-sky-50/70 border border-sky-100 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⏱️</span>
                        <div>
                          <span className="text-[10px] text-gray-500 block font-medium">
                            {isDep ? '預計出發倒數' : '預計降落倒數'}
                          </span>
                          <span className="font-bold text-xs text-sky-900 font-mono">
                            {liveRemaining}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100/80 text-sky-800 font-medium border border-sky-200">
                        航線圖已繪製
                      </span>
                    </div>

                    {/* Progress Bar inside Popup */}
                    <div className="pt-1.5 border-t border-sky-200/60">
                      <div className="flex items-center justify-between text-[10.5px] font-mono mb-1">
                        <span className="font-semibold text-sky-900">
                          ✈️ 飛行進度 · {phaseLabel}
                        </span>
                        <span className="font-bold text-sky-800 bg-sky-200/70 px-1.5 py-0.2 rounded">
                          {pct}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-sky-950/15 rounded-full overflow-hidden border border-sky-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-500"
                          style={{ width: `${Math.max(pct, pct > 0 && pct < 100 ? 4 : 0)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Footer */}
              <div className="pt-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between font-mono">
                <span>航班: {selectedFlight.flight_no}</span>
                <span>航線排程: FlightAware AeroAPI</span>
              </div>
            </div>
          </Popup>
          );
        })()}

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
            maxWidth={selectedFacility.facility_type === 'traffic_cameras' ? '400px' : (selectedFacility.facility_type === 'safety_cameras' || selectedFacility.facility_type === 'hospitals') ? '360px' : '320px'}
          >
            <div className={`p-3.5 ${selectedFacility.facility_type === 'traffic_cameras' ? 'w-[360px]' : (selectedFacility.facility_type === 'safety_cameras' || selectedFacility.facility_type === 'hospitals') ? 'w-[330px]' : 'w-[290px]'} max-w-[90vw] text-gray-800`}>
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    selectedFacility.facility_type === 'parking_meters' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'accessible_parking' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'motorcycle_parking' ? 'bg-orange-500' :
                    selectedFacility.facility_type === 'ev_charging' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'escooter' ? 'bg-lime-500' :
                    selectedFacility.facility_type === 'shared_bikes' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'bikeways' ? 'bg-teal-500' :
                    selectedFacility.facility_type === 'traffic_cameras' ? 'bg-cyan-500' :
                    selectedFacility.facility_type === 'safety_cameras' ? 'bg-rose-600' :
                    selectedFacility.facility_type === 'hospitals' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'fire_halls' ? 'bg-rose-500' :
                    selectedFacility.facility_type === 'parks' ? 'bg-emerald-600' :
                    selectedFacility.facility_type === 'parks_facilities' ? 'bg-teal-600' :
                    selectedFacility.facility_type === 'community_gardens' ? 'bg-lime-600' :
                    selectedFacility.facility_type === 'drinking_fountains' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'public_washrooms' ? 'bg-cyan-500' :
                    selectedFacility.facility_type === 'schools' ? 'bg-blue-500' :
                    selectedFacility.facility_type === 'libraries' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'food_vendors' ? 'bg-orange-500' :
                    selectedFacility.facility_type === 'homeless_shelters' ? 'bg-rose-500' : 'bg-violet-500'
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

              {/* Shared Bikes (Mobi by Rogers) Station Details */}
              {selectedFacility.facility_type === 'shared_bikes' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="p-2.5 rounded bg-emerald-50 border border-emerald-100 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <span>🚲</span>
                        <span>Mobi by Rogers</span>
                      </span>
                      {selectedFacility.properties.station_id && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">
                          #{selectedFacility.properties.station_id}
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-baseline pt-1 border-t border-emerald-200/60">
                      <span className="text-gray-600 text-[11px]">車柱容量 (Docks)</span>
                      <span className="font-bold text-emerald-800 text-sm">
                        {selectedFacility.properties.capacity ? `${selectedFacility.properties.capacity} 格` : '未標明'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>營運系統</span>
                      <span className="font-semibold text-gray-800">溫哥華公共共享單車</span>
                    </div>
                    {selectedFacility.properties.operator && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>營運單位</span>
                        <span className="font-medium text-gray-800">{selectedFacility.properties.operator}</span>
                      </div>
                    )}
                    {selectedFacility.properties.covered && selectedFacility.properties.covered !== '未標明' && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>遮雨頂棚</span>
                        <span className="font-medium text-gray-800">{selectedFacility.properties.covered}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href={selectedFacility.properties.website || "https://www.mobibikes.ca"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      前往 Mobi 官方網站 / 租借資訊 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Bikeways (單車徑 LineString) Details */}
              {selectedFacility.facility_type === 'bikeways' && (() => {
                const bType = selectedFacility.properties.bikeway_type || '';
                const bColor =
                  bType === 'Protected Bike Lanes' ? '#10b981' :
                  bType === 'Painted Lanes' ? '#0ea5e9' :
                  bType === 'Local Street' ? '#f59e0b' :
                  bType === 'Shared Lanes' ? '#a855f7' : '#10b981';
                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="p-2.5 rounded bg-gray-50 border border-gray-200 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900 flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full shrink-0 border border-white shadow-sm" style={{ backgroundColor: bColor }}></span>
                          <span>🚴 {selectedFacility.properties.bikeway_type_zh || '單車專用道'}</span>
                        </span>
                      </div>
                      {selectedFacility.properties.aaa_network && (
                        <div className="text-[11px] font-medium text-emerald-700 pt-1 border-t border-gray-200/70">
                          ✅ {selectedFacility.properties.aaa_network}
                        </div>
                      )}
                    </div>

                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties.bike_route_name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>單車路線</span>
                          <span className="font-bold text-gray-900">{selectedFacility.properties.bike_route_name}</span>
                        </div>
                      )}
                      {selectedFacility.properties.street_name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>所在街道</span>
                          <span className="font-semibold text-gray-800">{selectedFacility.properties.street_name}</span>
                        </div>
                      )}
                      {selectedFacility.properties.bikeway_direction && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>通行方向</span>
                          <span className="font-medium text-gray-800">{selectedFacility.properties.bikeway_direction}</span>
                        </div>
                      )}
                      {selectedFacility.properties.surface_type && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>路面材質</span>
                          <span className="font-medium text-gray-800">{selectedFacility.properties.surface_type}</span>
                        </div>
                      )}
                      {selectedFacility.properties.speed_limit && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>路段速限</span>
                          <span className="font-bold text-emerald-800">{selectedFacility.properties.speed_limit} km/h</span>
                        </div>
                      )}
                      {selectedFacility.properties.snow_removal && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>冬季養護</span>
                          <span className="font-medium text-sky-700">{selectedFacility.properties.snow_removal}</span>
                        </div>
                      )}
                    </div>

                    {/* 4種單車徑顏色圖例 */}
                    <div className="bg-gray-50/90 px-2 py-1.5 rounded border border-gray-100 grid grid-cols-2 gap-1 text-[10px] text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-1 rounded-full bg-[#10b981] shrink-0"></span>
                        <span className="truncate">受保護獨立道</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-1 rounded-full bg-[#0ea5e9] shrink-0"></span>
                        <span className="truncate">路面標線單車道</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-1 rounded-full bg-[#f59e0b] shrink-0"></span>
                        <span className="truncate">社區慢速單車街</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-1 rounded-full bg-[#a855f7] shrink-0"></span>
                        <span className="truncate">混合共用車道</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                        const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');
                        const proxySrc = `${apiUrl}/api/webcam/proxy?url=${encodeURIComponent(img.url)}&t=${hourlyTimestamp}_${webcamRefreshKey}`;
                        const directSrc = `${img.url}?t=${hourlyTimestamp}_${webcamRefreshKey}`;
                        return (
                          <div key={idx} className="relative rounded overflow-hidden border border-gray-200 bg-black aspect-[4/3] group shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={proxySrc}
                              alt={img.alt || img.direction}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (target.src !== directSrc) {
                                  target.src = directSrc;
                                }
                              }}
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

              {/* Intersection Safety Cameras Details */}
              {selectedFacility.facility_type === 'safety_cameras' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                    selectedFacility.properties.has_speed
                      ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                      : 'bg-amber-50/90 border-amber-200 text-amber-950'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <span>{selectedFacility.properties.has_speed ? '🚨' : '🛑'}</span>
                        <span>{selectedFacility.properties.camera_type || '路口安全攝影機'}</span>
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        selectedFacility.properties.has_speed ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                      }`}>
                        {selectedFacility.properties.has_speed ? '雙向取締' : '闖紅燈取締'}
                      </span>
                    </div>
                    
                    <div className="text-[11px] leading-relaxed pt-1 border-t border-rose-200/60 font-medium">
                      {selectedFacility.properties.has_speed ? (
                        <span>此路口同時具備<strong>闖紅燈照相</strong>與<strong>超速自動取締</strong>功能。</span>
                      ) : (
                        <span>此路口具備<strong>闖紅燈自動照相取締</strong>功能。</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>官方路口名稱</span>
                      <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">
                        {selectedFacility.properties.official_intersection || selectedFacility.name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600">
                      <span>所屬行政區</span>
                      <span className="font-semibold text-gray-800">溫哥華市 (City of Vancouver)</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600">
                      <span>執法主管機關</span>
                      <span className="font-semibold text-gray-800">RoadSafetyBC / ICBC / VPD</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-2 rounded text-[11px] text-gray-600 flex flex-col gap-0.5">
                    <span className="font-semibold text-gray-700">⚖️ BC 省法定裁罰標準：</span>
                    <span>• 闖紅燈違規：罰款 $167 CAD 並記扣 3 點</span>
                    <span>• 超速違規：依超速區間罰款 $138 ~ $483 CAD 及記扣點數</span>
                  </div>

                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href="https://www2.gov.bc.ca/gov/content/transportation/driving-and-cycling/roadsafetybc/intersection-safety-cameras/where-the-cameras-are"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      查看 BC 省道路安全局官方清單 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Hospitals Details & Live ER Wait Times */}
              {selectedFacility.facility_type === 'hospitals' && (() => {
                const hName = (selectedFacility.name || '').toLowerCase();
                const erKey = (selectedFacility.properties?.erstat_name || '').toLowerCase();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let waitInfo: any = hospitalWaitTimes[hName] || hospitalWaitTimes[erKey];
                if (!waitInfo) {
                  for (const [k, v] of Object.entries(hospitalWaitTimes)) {
                    if (hName.includes(k) || k.includes(hName) || (erKey && k.includes(erKey))) {
                      waitInfo = v;
                      break;
                    }
                  }
                }

                const waitTime = waitInfo?.wait_time || '--';
                const status = waitInfo?.status || 'normal';
                const isPredicted = waitInfo?.is_predicted;

                let statusBg = 'bg-emerald-50 border-emerald-200 text-emerald-900';
                let badgeBg = 'bg-emerald-600 text-white';
                let statusText = '迅速 (Quick)';
                if (status === 'packed') {
                  statusBg = 'bg-rose-50 border-rose-200 text-rose-900';
                  badgeBg = 'bg-rose-600 text-white';
                  statusText = '壅塞 (Packed)';
                } else if (status === 'moderate') {
                  statusBg = 'bg-amber-50 border-amber-200 text-amber-900';
                  badgeBg = 'bg-amber-600 text-white';
                  statusText = '適中 (Moderate)';
                } else if (status === 'quick') {
                  statusBg = 'bg-emerald-50 border-emerald-200 text-emerald-900';
                  badgeBg = 'bg-emerald-600 text-white';
                  statusText = '迅速 (Quick)';
                } else {
                  statusBg = 'bg-blue-50 border-blue-200 text-blue-900';
                  badgeBg = 'bg-blue-600 text-white';
                  statusText = '正常 (Normal)';
                }

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* Live ER Wait Time Card */}
                    <div className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${statusBg}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span>⏱️</span>
                          <span>急診預估等候時間</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          {loadingWaitTimes ? (
                            <span className="text-[10px] text-gray-500 animate-pulse">載入中...</span>
                          ) : (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeBg}`}>
                              {statusText}
                            </span>
                          )}
                          <button
                            onClick={() => setHospitalRefreshKey(k => k + 1)}
                            className="px-1.5 py-0.5 bg-white/80 border border-gray-300 hover:bg-white rounded text-[10px] text-gray-700 transition-colors"
                            title="重新整理等候時間"
                          >
                            🔄
                          </button>
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between pt-1 border-t border-black/10">
                        <span className="text-2xl font-black tracking-tight">
                          {loadingWaitTimes ? '...' : waitTime}
                        </span>
                        <span className="text-[10px] text-gray-500 font-medium">
                          {isPredicted ? '（模型預估）' : '（官方即時回報）'} · 每 1 小時更新
                        </span>
                      </div>
                    </div>

                    {/* Hospital Info Card */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties?.chinese_name && (
                        <div className="flex justify-between items-center text-gray-700 font-semibold">
                          <span>中文名稱</span>
                          <span className="text-gray-900">{selectedFacility.properties.chinese_name}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.hours && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>急診門診時間</span>
                          <span className="font-medium text-emerald-700">{selectedFacility.properties.hours}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.address && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>醫院地址</span>
                          <span className="font-medium text-gray-800 text-right truncate max-w-[170px]">
                            {selectedFacility.properties.address}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties?.phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>總機電話</span>
                          <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-blue-600 hover:underline">
                            {selectedFacility.properties.phone}
                          </a>
                        </div>
                      )}
                      {selectedFacility.properties?.operator && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>營運機構</span>
                          <span className="font-medium text-gray-800">{selectedFacility.properties.operator}</span>
                        </div>
                      )}
                    </div>

                    {/* Action Links */}
                    <div className="flex flex-col gap-1 pt-1 border-t border-gray-100">
                      <a
                        href={waitInfo?.url || selectedFacility.properties?.erstat_url || "https://erstat.ca/hospitals/bc/vancouver"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 ERstat 查看急診即時數據 ↗
                      </a>
                      {selectedFacility.properties?.website && (
                        <a
                          href={selectedFacility.properties.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium text-[11px] transition-colors text-center"
                        >
                          前往醫院官方網站 ↗
                        </a>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Parks Details */}
              {selectedFacility.facility_type === 'parks' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-emerald-50/80 p-2.5 rounded border border-emerald-100 flex flex-col gap-1 text-[11px]">
                    {selectedFacility.properties.street_address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>公園地址</span>
                        <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">{selectedFacility.properties.street_address}</span>
                      </div>
                    )}
                    {selectedFacility.properties.intersection && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>鄰近路口</span>
                        <span className="font-medium text-gray-700 text-right truncate max-w-[170px]">{selectedFacility.properties.intersection}</span>
                      </div>
                    )}
                    {selectedFacility.properties.hectare != null && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>綠地面積</span>
                        <span className="font-bold text-emerald-800">{selectedFacility.properties.hectare} 公頃 (ha)</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex items-center justify-between">
                      <span className="text-gray-500">休閒設施</span>
                      <span className={`font-semibold ${selectedFacility.properties.facilities === '有' ? 'text-emerald-700' : 'text-gray-400'}`}>
                        {selectedFacility.properties.facilities === '有' ? '✅ 配備設施' : '無'}
                      </span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex items-center justify-between">
                      <span className="text-gray-500">園區洗手間</span>
                      <span className={`font-semibold ${selectedFacility.properties.washrooms === '有' ? 'text-cyan-700' : 'text-gray-400'}`}>
                        {selectedFacility.properties.washrooms === '有' ? '🚻 有洗手間' : '無'}
                      </span>
                    </div>
                  </div>

                  {selectedFacility.properties.specialfeatures && selectedFacility.properties.specialfeatures !== 'N' && (
                    <div className="bg-amber-50/70 p-2 rounded text-[11px] text-amber-900 border border-amber-200/60">
                      <span className="font-semibold block mb-0.5">🌟 特色設施與景觀：</span>
                      <span>{selectedFacility.properties.specialfeatures}</span>
                    </div>
                  )}

                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href={`https://vancouver.ca/parks-recreation-culture/find-a-park.aspx`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      前往溫哥華公園局官方頁面 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Parks Facilities Details */}
              {selectedFacility.facility_type === 'parks_facilities' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-teal-50/80 p-2.5 rounded border border-teal-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-teal-900">
                      <span className="font-medium text-gray-600">設施類別</span>
                      <span className="font-bold text-teal-800 text-xs px-1.5 py-0.5 bg-teal-100/70 rounded">
                        {selectedFacility.properties.facility_type_name || selectedFacility.name}
                      </span>
                    </div>
                    {selectedFacility.properties.facility_count != null && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>設施數量 / 規模</span>
                        <span className="font-bold text-gray-800">{selectedFacility.properties.facility_count} 座</span>
                      </div>
                    )}
                    {selectedFacility.properties.park_name && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>所在公園</span>
                        <span className="font-semibold text-emerald-800">{selectedFacility.properties.park_name}</span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.facility_url && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.facility_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        查看設施預約與使用指南 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Community Gardens Details */}
              {selectedFacility.facility_type === 'community_gardens' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-lime-50/80 p-2.5 rounded border border-lime-200 flex flex-col gap-1 text-[11px]">
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>花園地址</span>
                        <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">{selectedFacility.properties.address}</span>
                      </div>
                    )}
                    {selectedFacility.properties.managing_org && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>營運/認養組織</span>
                        <span className="font-medium text-lime-900 text-right truncate max-w-[170px]">{selectedFacility.properties.managing_org}</span>
                      </div>
                    )}
                    {selectedFacility.properties.year_created && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>成立年份</span>
                        <span className="font-medium text-gray-800">{selectedFacility.properties.year_created} 年</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex items-center justify-between">
                      <span className="text-gray-500">耕作畦位</span>
                      <span className="font-bold text-lime-800">{selectedFacility.properties.plots != null ? `${selectedFacility.properties.plots} 格` : '未載明'}</span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex items-center justify-between">
                      <span className="text-gray-500">社區果樹</span>
                      <span className="font-bold text-emerald-800">{selectedFacility.properties.food_trees != null ? `${selectedFacility.properties.food_trees} 棵` : '無'}</span>
                    </div>
                  </div>

                  {selectedFacility.properties.food_tree_varieties && (
                    <div className="bg-emerald-50/60 p-2 rounded text-[11px] text-emerald-900 border border-emerald-100">
                      <span className="font-semibold block mb-0.5">🍎 果樹品種：</span>
                      <span>{selectedFacility.properties.food_tree_varieties}</span>
                    </div>
                  )}

                  {selectedFacility.properties.website && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-lime-600 hover:bg-lime-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往社區花園官方網頁 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Drinking Fountains Details */}
              {selectedFacility.facility_type === 'drinking_fountains' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-sky-50/80 p-2.5 rounded border border-sky-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">開放營運</span>
                      <span className="font-bold text-sky-800 bg-sky-100/70 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.in_operation || '全年開放'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">寵物友善</span>
                      <span className={`font-semibold ${selectedFacility.properties.pet_friendly?.includes('寵物') ? 'text-emerald-700' : 'text-gray-600'}`}>
                        {selectedFacility.properties.pet_friendly || '一般飲水'}
                      </span>
                    </div>
                    {selectedFacility.properties.park_or_site && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>所屬場域</span>
                        <span className="font-medium text-gray-800 text-right truncate max-w-[170px]">{selectedFacility.properties.park_or_site}</span>
                      </div>
                    )}
                    {selectedFacility.properties.location && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>具體位置</span>
                        <span className="font-medium text-gray-800 text-right truncate max-w-[170px]">{selectedFacility.properties.location}</span>
                      </div>
                    )}
                    {selectedFacility.properties.maintainer && (
                      <div className="flex justify-between items-center text-gray-500 text-[10px] pt-1 border-t border-sky-100">
                        <span>管理維護單位</span>
                        <span className="font-medium text-gray-700">{selectedFacility.properties.maintainer}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Public Washrooms Details */}
              {selectedFacility.facility_type === 'public_washrooms' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-cyan-50/80 p-2.5 rounded border border-cyan-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">公廁類型</span>
                      <span className="font-bold text-cyan-900 bg-cyan-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.washroom_type || '公共洗手間'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">無障礙規格</span>
                      <span className={`font-bold ${selectedFacility.properties.wheelchair_access?.includes('無障礙') ? 'text-blue-700' : 'text-gray-600'}`}>
                        {selectedFacility.properties.wheelchair_access || '一般規格'}
                      </span>
                    </div>
                    {selectedFacility.properties.summer_hours && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>夏季開放時間</span>
                        <span className="font-semibold text-emerald-800">{selectedFacility.properties.summer_hours}</span>
                      </div>
                    )}
                    {selectedFacility.properties.winter_hours && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>冬季開放時間</span>
                        <span className="font-medium text-gray-700">{selectedFacility.properties.winter_hours}</span>
                      </div>
                    )}
                    {selectedFacility.properties.location && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>所在位置</span>
                        <span className="font-medium text-gray-800 text-right truncate max-w-[170px]">{selectedFacility.properties.location}</span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.notes && (
                    <div className="bg-gray-50 p-2 rounded text-[11px] text-gray-600 border border-gray-100">
                      <span className="font-semibold block mb-0.5 text-gray-700">備註說明：</span>
                      <span>{selectedFacility.properties.notes}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Schools Details */}
              {selectedFacility.facility_type === 'schools' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-blue-50/80 p-2.5 rounded border border-blue-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">學校類別</span>
                      <span className="font-bold text-blue-900 bg-blue-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.school_category_zh || selectedFacility.properties.school_category || '學校'}
                      </span>
                    </div>
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>校園地址</span>
                        <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                    {selectedFacility.local_area && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>所在學區</span>
                        <span className="font-medium text-gray-800">{selectedFacility.local_area}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Libraries Details */}
              {selectedFacility.facility_type === 'libraries' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-50/80 p-2.5 rounded border border-amber-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">圖書館分館</span>
                      <span className="font-bold text-amber-900 bg-amber-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.branch_name || selectedFacility.name}
                      </span>
                    </div>
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>館址地址</span>
                        <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                    {selectedFacility.local_area && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>服務轄區</span>
                        <span className="font-medium text-gray-800">{selectedFacility.local_area}</span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.urllink && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.urllink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 VPL 溫哥華市立圖書館官網 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Food Vendors Details */}
              {selectedFacility.facility_type === 'food_vendors' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-orange-50/80 p-2.5 rounded border border-orange-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">營業狀態</span>
                      <span className="font-bold text-emerald-800 bg-emerald-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.status || '營運中'}
                      </span>
                    </div>
                    {selectedFacility.properties.description && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>餐飲特色</span>
                        <span className="font-bold text-orange-900">
                          {selectedFacility.properties.description}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.vendor_code && (
                      <div className="flex justify-between items-center text-gray-500 text-[10px]">
                        <span>攤販編號</span>
                        <span className="font-mono text-gray-700">{selectedFacility.properties.vendor_code}</span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.location_desc && (
                    <div className="bg-gray-50 p-2 rounded text-[11px] text-gray-600 border border-gray-100">
                      <span className="font-semibold block mb-0.5 text-gray-700">擺攤營業位置：</span>
                      <span>{selectedFacility.properties.location_desc}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Homeless Shelters Details */}
              {selectedFacility.facility_type === 'homeless_shelters' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-rose-50/80 p-2.5 rounded border border-rose-200 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">收容對象</span>
                      <span className="font-bold text-rose-900 bg-rose-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.category || '通用收容'}
                      </span>
                    </div>
                    {selectedFacility.local_area && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>所在社區</span>
                        <span className="font-medium text-gray-800">{selectedFacility.local_area}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[10.5px]">
                    <div className="bg-gray-50 p-1.5 rounded border border-gray-100 text-center">
                      <span className="text-gray-500 block text-[9.5px]">供餐</span>
                      <span className="font-semibold text-gray-800">{selectedFacility.properties.meals || '未註記'}</span>
                    </div>
                    <div className="bg-gray-50 p-1.5 rounded border border-gray-100 text-center">
                      <span className="text-gray-500 block text-[9.5px]">寵物</span>
                      <span className="font-semibold text-gray-800">{selectedFacility.properties.pets || '未註記'}</span>
                    </div>
                    <div className="bg-gray-50 p-1.5 rounded border border-gray-100 text-center">
                      <span className="text-gray-500 block text-[9.5px]">推車</span>
                      <span className="font-semibold text-gray-800">{selectedFacility.properties.carts || '未註記'}</span>
                    </div>
                  </div>

                  {selectedFacility.properties.phone && (
                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-100 text-[11px]">
                      <span className="text-gray-500">聯絡專線</span>
                      <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-blue-600 hover:underline">
                        📞 {selectedFacility.properties.phone}
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
