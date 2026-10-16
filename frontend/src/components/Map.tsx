'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import Map, { NavigationControl, Marker, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl, getWsUrl } from '@/utils/api';
import { formatTimePreference, formatShipEta } from '@/utils/time';
import { LocateFixed, Train, Compass, ZoomIn, X } from 'lucide-react';

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

export interface MaritimeVessel {
  mmsi: string;
  name: string;
  imo?: string;
  callsign?: string;
  type_code?: number;
  ship_type: string;
  type_group: 'cargo' | 'tanker' | 'tug' | 'passenger' | 'pleasure' | 'sailing' | 'other';
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
  nav_status: string;
  destination?: string;
  eta?: string;
  length?: number;
  width?: number;
  draft?: number;
  flag?: string;
  source?: string;
  is_live_ais?: boolean;
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

interface SkytrainTrain {
  id: string;
  line_id: string;
  line_name: string;
  color: string;
  headsign: string;
  origin: string;
  destination: string;
  direction: string;
  lat: number;
  lon: number;
  bearing: number;
  status: string;
  is_dwelling: boolean;
  speed_kmh: number;
  model: string;
  cars: number;
  current_station: string;
  next_station: string;
  next_stop_minutes: number;
  next_stop_time: string;
  operator: string;
  pattern_id: string;
  stops: Array<{
    seq: number;
    stop_id: string;
    name: string;
    lat: number;
    lon: number;
    status: 'passed' | 'next' | 'upcoming';
    eta_minutes?: number | null;
    eta_time?: string | null;
  }>;
  shape_coords: [number, number][];
}

interface SkytrainStationSchedule {
  stop_id: string;
  name: string;
  raw_name?: string;
  lat: number;
  lon: number;
  lines: string[];
  schedules: Array<{
    line_name: string;
    color: string;
    destination: string;
    direction: string;
    departures: Array<{
      minutes: number;
      time: string;
      formatted: string;
    }>;
  }>;
  updated_at: string;
}

const STANLEY_PARK_EXCLUSION_POLY = [
  [-123.1580, 49.3110],
  [-123.1430, 49.3140],
  [-123.1230, 49.3070],
  [-123.1130, 49.3010],
  [-123.1160, 49.2940],
  [-123.1380, 49.2900],
  [-123.1490, 49.2900],
  [-123.1560, 49.2980],
  [-123.1580, 49.3110]
];

function isPointInPolygon2D(lon: number, lat: number, poly: number[][]): boolean {
  let inside = false;
  let p1Lon = poly[0][0], p1Lat = poly[0][1];
  for (let i = 1; i <= poly.length; i++) {
    const p2Lon = poly[i % poly.length][0], p2Lat = poly[i % poly.length][1];
    if (lat > Math.min(p1Lat, p2Lat)) {
      if (lat <= Math.max(p1Lat, p2Lat)) {
        if (lon <= Math.max(p1Lon, p2Lon)) {
          const xinters = p1Lat !== p2Lat ? (lat - p1Lat) * (p2Lon - p1Lon) / (p2Lat - p1Lat) + p1Lon : p1Lon;
          if (p1Lon === p2Lon || lon <= xinters) {
            inside = !inside;
          }
        }
      }
    }
    p1Lon = p2Lon; p1Lat = p2Lat;
  }
  return inside;
}

function isShipOnLand(lon: number, lat: number): boolean {
  if (!lon || !lat) return false;
  return isPointInPolygon2D(lon, lat, STANLEY_PARK_EXCLUSION_POLY);
}

export default function AppMap() {
  const { layers, mapStyleType, searchTarget, setSearchTarget, isLayerPanelOpen, contourInterval, timeFormat, distanceUnit, userLocation, setExploreOpen } = useUIStore();
  const mapRef = useRef<MapRef>(null);

  // Resize map canvas smoothly when side panel toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.resize();
    }, 220);
    return () => clearTimeout(timer);
  }, [isLayerPanelOpen]);


  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [ferryVehicles, setFerryVehicles] = useState<FerryVehicle[]>([]);
  const [maritimeVessels, setMaritimeVessels] = useState<MaritimeVessel[]>([]);
  const [selectedMaritimeVessel, setSelectedMaritimeVessel] = useState<MaritimeVessel | null>(null);
  const [ferryTerminals, setFerryTerminals] = useState<Array<{geometry: {coordinates: number[]}, properties: {name?: string, code: string}}>>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedFlight, setSelectedFlight] = useState<any | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(11);
  const [zoomNotification, setZoomNotification] = useState<{
    show: boolean;
    title: string;
    message: string;
    targetZoom: number;
  } | null>(null);
  const prevLayersRef = useRef(layers);

  const handleMapMouseMove = React.useCallback((e: any) => {
    if (e.lngLat) {
      setCursorCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    }
  }, []);

  const handleMapMouseLeave = React.useCallback(() => {
    setCursorCoords(null);
  }, []);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [searchedBusRoute, setSearchedBusRoute] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingSearchedRoute, setLoadingSearchedRoute] = useState(false);

  // SkyTrain States
  const [skytrainTrains, setSkytrainTrains] = useState<SkytrainTrain[]>([]);
  const [selectedTrain, setSelectedTrain] = useState<SkytrainTrain | null>(null);
  const [selectedSkytrainStation, setSelectedSkytrainStation] = useState<SkytrainStationSchedule | null>(null);
  const [loadingStationSchedule, setLoadingStationSchedule] = useState(false);

  const lastInteractiveItemClickRef = useRef<number>(0);

  const handleSelectTrain = React.useCallback((train: SkytrainTrain) => {
    lastInteractiveItemClickRef.current = Date.now();
    setSelectedStop(null);
    setSelectedFacility(null);
    setSelectedTerminal(null);
    setSelectedFerry(null);
    setSelectedFlight(null);
    setSelectedAirport(null);
    setSelectedBus(null);
    setBusDetails(null);
    setSearchedBusRoute(null);
    setSelectedSkytrainStation(null);
    setSelectedTrain(train);
  }, []);

  // 當圖層被關閉時，自動清理對應已開啟之資訊卡片與搜尋閃爍標記 (Search Target Focus Ring)
  useEffect(() => {
    // 1. 設施類別 (Facility)
    if (selectedFacility) {
      const type = selectedFacility.facility_type;
      let facilityClosed = false;
      if (type === 'fuel' && !layers.fuel) facilityClosed = true;
      else if (type === 'tesla' && !layers.tesla) facilityClosed = true;
      else if (type === 'ev_charging' && !layers.evCharging) facilityClosed = true;
      else if (type === 'aed' && !layers.aed) facilityClosed = true;
      else if (type === 'fire_halls' && !layers.fireHalls) facilityClosed = true;
      else if (type === 'police' && !layers.police) facilityClosed = true;
      else if (type === 'disaster_hubs' && !layers.disasterHubs) facilityClosed = true;
      else if (type === 'community_centres' && !layers.communityCentres) facilityClosed = true;
      else if (type === 'hospitals' && !layers.hospitals) facilityClosed = true;
      else if (type === 'parks' && !layers.parks) facilityClosed = true;
      else if (type === 'parks_facilities' && !layers.parksFacilities) facilityClosed = true;
      else if (type === 'community_gardens' && !layers.communityGardens) facilityClosed = true;
      else if (type === 'drinking_fountains' && !layers.drinkingFountains) facilityClosed = true;
      else if (type === 'public_washrooms' && !layers.publicWashrooms) facilityClosed = true;
      else if (type === 'schools' && !layers.schools) facilityClosed = true;
      else if (type === 'libraries' && !layers.libraries) facilityClosed = true;
      else if (type === 'food_vendors' && !layers.foodVendors) facilityClosed = true;
      else if (type === 'homeless_shelters' && !layers.homelessShelters) facilityClosed = true;
      else if (type === 'traffic_cameras' && !layers.trafficCameras) facilityClosed = true;
      else if (type === 'safety_cameras' && !layers.safetyCameras) facilityClosed = true;
      else if (type === 'parking_meters' && !layers.parkingMeters) facilityClosed = true;
      else if (type === 'accessible_parking' && !layers.accessibleParking) facilityClosed = true;
      else if (type === 'motorcycle_parking' && !layers.motorcycleParking) facilityClosed = true;
      else if (type === 'shared_bikes' && !layers.sharedBikes) facilityClosed = true;
      else if (type === 'escooter' && !layers.escooter) facilityClosed = true;
      else if (type === 'contours' && !layers.contours) facilityClosed = true;
      else if (type === 'traffic_speed_limits' && !layers.trafficSpeedLimits) facilityClosed = true;
      else if (type === 'bike_racks' && !layers.bikeRacks) facilityClosed = true;
      else if (type === 'postal_code_fsa' && !layers.postalCodeFSA) facilityClosed = true;
      else if (type === 'wireless_facilities' && !layers.wirelessFacilities) facilityClosed = true;
      else if (type === 'water_distribution_mains' && !layers.waterDistributionMains) facilityClosed = true;
      else if (type === 'sewer_mains' && !layers.sewerMains) facilityClosed = true;
      else if (type === 'one_way_streets' && !layers.oneWayStreets) facilityClosed = true;
      else if (type === 'snow_removal_routes' && !layers.snowRemovalRoutes) facilityClosed = true;
      else if (type === 'traffic_crosswalks' && !layers.trafficCrosswalks) facilityClosed = true;
      else if (type === 'litter_containers' && !layers.litterContainers) facilityClosed = true;

      if (facilityClosed) {
        setSelectedFacility(null);
        setSearchTarget(null);
      }
    }

    // 2. 機場 (Airports)
    if (selectedAirport && !layers.airports) {
      setSelectedAirport(null);
      if (searchTarget && searchTarget.category === 'airports') {
        setSearchTarget(null);
      }
    }

    // 3. BC Ferries 碼頭與船隻
    if (selectedTerminal && !layers.bcferriesTerminals) {
      setSelectedTerminal(null);
      if (searchTarget && searchTarget.category === 'ferry_terminal') {
        setSearchTarget(null);
      }
    }
    if (selectedFerry && !layers.bcferriesVehicles) {
      setSelectedFerry(null);
      if (searchTarget && searchTarget.category === 'ferry_vehicle') {
        setSearchTarget(null);
      }
    }

    // 4. 巴士與天車 (全域圖層關閉時僅清除一般選取的巴士，不影響獨立搜尋的巴士路線)
    if (selectedBus && !layers.bus && !searchedBusRoute) {
      setSelectedBus(null);
      setBusDetails(null);
      if (searchTarget && searchTarget.category === 'bus') {
        setSearchTarget(null);
      }
    }
    if (selectedTrain && !layers.skytrainTrains) {
      setSelectedTrain(null);
    }
    if (selectedSkytrainStation && !layers.skytrainStops && !layers.skytrainRoutes) {
      setSelectedSkytrainStation(null);
      if (searchTarget && searchTarget.category === 'skytrain') {
        setSearchTarget(null);
      }
    }

    // 5. 搜尋目標 (Search Target) 直接聯動圖層開關
    if (searchTarget) {
      if (searchTarget.layer_key && !layers[searchTarget.layer_key]) {
        setSearchTarget(null);
      } else if ((searchTarget.category === 'fuel' || searchTarget.id?.startsWith('fuel_')) && !layers.fuel) {
        setSearchTarget(null);
      } else if ((searchTarget.category === 'tesla' || searchTarget.id?.startsWith('tesla_')) && !layers.tesla) {
        setSearchTarget(null);
      } else if ((searchTarget.category === 'ev_charging' || searchTarget.id?.startsWith('ev_')) && !layers.evCharging) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'aed' && !layers.aed) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'airports' && !layers.airports) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'ferry_terminal' && !layers.bcferriesTerminals) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'ferry_vehicle' && !layers.bcferriesVehicles) {
        setSearchTarget(null);
      }
    }
  }, [layers, selectedFacility, selectedAirport, selectedTerminal, selectedFerry, selectedBus, searchedBusRoute, selectedTrain, selectedSkytrainStation, searchTarget, setSearchTarget]);


  const fetchSkytrainStationSchedule = React.useCallback((stopId: string, stopName?: string, lat?: number, lon?: number) => {
    setSelectedStop(null);
    setSelectedFacility(null);
    setSelectedTerminal(null);
    setSelectedFerry(null);
    setSelectedFlight(null);
    setSelectedAirport(null);
    setSelectedBus(null);
    setBusDetails(null);
    setSearchedBusRoute(null);
    setSelectedTrain(null);
    setLoadingStationSchedule(true);

    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/skytrain/stations/${encodeURIComponent(stopId)}/schedule`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setSelectedSkytrainStation(data);
        } else {
          setSelectedSkytrainStation({
            stop_id: stopId,
            name: stopName || '天車站',
            raw_name: stopName || '天車站',
            lat: lat || 49.2827,
            lon: lon || -123.1207,
            lines: ['SkyTrain 天車'],
            schedules: [],
            updated_at: new Date().toLocaleTimeString('en-US', { hour12: false })
          });
        }
        setLoadingStationSchedule(false);
      })
      .catch(err => {
        console.error('Error fetching SkyTrain station schedule:', err);
        setLoadingStationSchedule(false);
      });
  }, []);

  const handleSelectBus = React.useCallback((v: Vehicle) => {
    lastInteractiveItemClickRef.current = Date.now();
    setSelectedStop(null);
    setSelectedFacility(null);
    setSelectedTerminal(null);
    setSelectedFerry(null);
    setSelectedFlight(null);
    setSelectedAirport(null);
    setSelectedTrain(null);
    setSelectedSkytrainStation(null);
    setSelectedBus(v);
    setLoadingBusDetails(true);

    const apiUrl = getApiUrl();
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

  // Fetch initial SkyTrain trains
  useEffect(() => {
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/skytrain/trains`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSkytrainTrains(data);
        }
      })
      .catch(err => console.error('Failed to load initial SkyTrain trains:', err));
  }, []);

  // Keep selectedTrain synced when skytrainTrains updates
  useEffect(() => {
    if (!selectedTrain) return;
    const updated = skytrainTrains.find(t => t.id === selectedTrain.id);
    if (updated) {
      setSelectedTrain(updated);
    }
  }, [skytrainTrains, selectedTrain]);

  // Fetch initial maritime shipping vessels
  useEffect(() => {
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/shipping/vessels`)
      .then(res => res.json())
      .then(data => {
        if (data.vessels && Array.isArray(data.vessels)) {
          setMaritimeVessels(data.vessels);
        }
      })
      .catch(err => console.error('Failed to load initial maritime vessels:', err));
  }, []);

  // Keep selectedMaritimeVessel synced when maritimeVessels updates
  useEffect(() => {
    if (!selectedMaritimeVessel) return;
    const updated = maritimeVessels.find(v => v.mmsi === selectedMaritimeVessel.mmsi);
    if (updated) {
      setSelectedMaritimeVessel(updated);
    }
  }, [maritimeVessels, selectedMaritimeVessel]);

  // Keep selectedBus live coordinates & stop list synced when vehicles update via WebSocket
  useEffect(() => {
    if (!selectedBus) return;
    const updated = vehicles.find(v => v.id === selectedBus.id);
    if (updated && (updated.lat !== selectedBus.lat || updated.lon !== selectedBus.lon || updated.stop_id !== selectedBus.stop_id || updated.next_stop_name !== selectedBus.next_stop_name)) {
      setSelectedBus(updated);
      const apiUrl = getApiUrl();
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
    if (!selectedBus && !searchedBusRoute) return null;
    const coords = busDetails?.shape_coords || searchedBusRoute?.shape_coords;
    const color = busDetails?.color || searchedBusRoute?.color || '#10b981';
    if (!coords || coords.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
      properties: {
        color: color,
      },
    };
  }, [busDetails, searchedBusRoute, selectedBus]);

  const skytrainRouteGeoJSON = useMemo(() => {
    if (!selectedTrain) return null;
    const coords = selectedTrain.shape_coords;
    if (!coords || coords.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
      properties: {
        color: selectedTrain.color || '#0033a0',
      },
    };
  }, [selectedTrain]);

  // 當搜尋特定路線時，整合該路線即時在途車輛清單 (無論是否開啟全域巴士圖層均可顯示)
  const displayVehicles = useMemo<Vehicle[]>(() => {
    if (searchedBusRoute) {
      const vDict: Record<string, Vehicle> = {};
      // 1. 先加入 route API 回傳之該路線在途車輛
      (searchedBusRoute.buses || []).forEach((b: Vehicle) => {
        if (b && b.id) vDict[String(b.id)] = b;
      });
      // 2. 結合全域 WebSocket 即時車輛資訊 (若有最新位置或方向則更新)
      vehicles.forEach(v => {
        if (
          String(v.route_id) === String(searchedBusRoute.route_id) || 
          String(v.route_number).toLowerCase() === String(searchedBusRoute.route_number).toLowerCase()
        ) {
          vDict[String(v.id)] = v;
        }
      });
      return Object.values(vDict);
    }
    return vehicles;
  }, [vehicles, searchedBusRoute]);

  // Initial System API & Map Data Loading Screen States (預留額外緩衝時間取得 API 與圖層資料)
  const [isInitialApiLoading, setIsInitialApiLoading] = useState(true);
  const [apiLoadingProgress, setApiLoadingProgress] = useState(18);
  const [apiLoadingText, setApiLoadingText] = useState('正在連線至溫哥華即時地理與交通 API...');

  useEffect(() => {
    const t1 = setTimeout(() => {
      setApiLoadingProgress(55);
      setApiLoadingText('正在載入市政設施圖層與即時大眾運輸動態...');
    }, 550);
    const t2 = setTimeout(() => {
      setApiLoadingProgress(88);
      setApiLoadingText('預留額外時間同步即時路況影像與氣象資料...');
    }, 1150);
    const t3 = setTimeout(() => {
      setApiLoadingProgress(100);
      setIsInitialApiLoading(false);
    }, 1850);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // States for Traffic Camera Images (含圖片預載緩衝與個別圖片載入狀態)
  const [webcamImages, setWebcamImages] = useState<Array<{url: string, direction: string, alt: string}>>([]);
  const [loadingWebcam, setLoadingWebcam] = useState(false);
  const [webcamLoadedCount, setWebcamLoadedCount] = useState(0);
  const [webcamImgReadyMap, setWebcamImgReadyMap] = useState<Record<number, boolean>>({});
  const [webcamRefreshKey, setWebcamRefreshKey] = useState(0);

  // Fetch webcam images when a traffic camera is selected, and reserve extra time to preload image bytes
  useEffect(() => {
    let isCancelled = false;
    if (selectedFacility && selectedFacility.facility_type === 'traffic_cameras') {
      const pageUrl = selectedFacility.properties?.url;
      if (pageUrl) {
        setLoadingWebcam(true);
        setWebcamLoadedCount(0);
        setWebcamImgReadyMap({});
        const apiUrl = getApiUrl();
        fetch(`${apiUrl}/api/webcam/images?url=${encodeURIComponent(pageUrl)}`)
          .then(res => res.json())
          .then(data => {
            if (isCancelled) return;
            const imgs: Array<{url: string, direction: string, alt: string}> = data.images || [];
            setWebcamImages(imgs);
            if (imgs.length === 0) {
              setLoadingWebcam(false);
              return;
            }
            const hourlyTimestamp = Math.floor(Date.now() / 3600000);
            let settled = 0;
            const total = imgs.length;
            const fallbackTimer = setTimeout(() => {
              if (!isCancelled) setLoadingWebcam(false);
            }, 2600);

            imgs.forEach((img, idx) => {
              const proxySrc = `${apiUrl}/api/webcam/proxy?url=${encodeURIComponent(img.url)}&t=${hourlyTimestamp}_${webcamRefreshKey}`;
              const preloader = new window.Image();
              const onDone = (ok: boolean) => {
                if (isCancelled) return;
                settled += 1;
                setWebcamLoadedCount(settled);
                if (ok) {
                  setWebcamImgReadyMap(prev => ({ ...prev, [idx]: true }));
                }
                if (settled >= total) {
                  // 預留額外 450ms 緩衝確保圖片完整解碼呈現
                  setTimeout(() => {
                    if (!isCancelled) {
                      clearTimeout(fallbackTimer);
                      setLoadingWebcam(false);
                    }
                  }, 450);
                }
              };
              preloader.onload = () => onDone(true);
              preloader.onerror = () => onDone(false);
              preloader.src = proxySrc;
            });
          })
          .catch(err => {
            if (isCancelled) return;
            console.error('Webcam image fetch error:', err);
            setLoadingWebcam(false);
          });
      }
    } else {
      setWebcamImages([]);
      setWebcamLoadedCount(0);
      setWebcamImgReadyMap({});
    }
    return () => {
      isCancelled = true;
    };
  }, [selectedFacility, webcamRefreshKey]);

  // States for Hospital ER Wait Times
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hospitalWaitTimes, setHospitalWaitTimes] = useState<Record<string, any>>({});
  const [loadingWaitTimes, setLoadingWaitTimes] = useState(false);
  const [hospitalRefreshKey, setHospitalRefreshKey] = useState(0);

  // Fetch ER wait times when a hospital is selected
  useEffect(() => {
    const isRehab = selectedFacility?.properties?.medical_type === 'rehab' || selectedFacility?.properties?.has_wait_time === false || selectedFacility?.properties?.emergency === 'no';
    if (selectedFacility && selectedFacility.facility_type === 'hospitals' && !isRehab) {
      setLoadingWaitTimes(true);
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/api/hospitals/waittimes`)
        .then(res => res.json())
        .then(data => {
          setHospitalWaitTimes(data.hospitals || {});
          setTimeout(() => setLoadingWaitTimes(false), 300);
        })
        .catch(err => {
          console.error('Hospital wait times fetch error:', err);
          setLoadingWaitTimes(false);
        });
    }
  }, [selectedFacility, hospitalRefreshKey]);

  // States for Fuel Station Live Prices
  const [fuelStationPrices, setFuelStationPrices] = useState<{
    regular: number;
    midgrade: number;
    premium: number;
    diesel: number;
  } | null>(null);
  const [loadingFuelPrices, setLoadingFuelPrices] = useState(false);

  // Fetch fuel prices when a gas station is selected
  useEffect(() => {
    if (selectedFacility && selectedFacility.facility_type === 'fuel' && selectedFacility.lat && selectedFacility.lon) {
      setLoadingFuelPrices(true);
      const apiUrl = getApiUrl();
      const url = `${apiUrl}/api/fuel/stations?lat=${selectedFacility.lat}&lon=${selectedFacility.lon}&sort_by=distance`;
      fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data.stations && data.stations.length > 0) {
            setFuelStationPrices(data.stations[0].prices || null);
          } else {
            setFuelStationPrices(null);
          }
          setLoadingFuelPrices(false);
        })
        .catch(err => {
          console.error('Fuel station prices fetch error:', err);
          setLoadingFuelPrices(false);
        });
    } else {
      setFuelStationPrices(null);
    }
  }, [selectedFacility]);

  // Compute distance from user's personal location to currently selected gas station
  const userDistanceToFuel = useMemo(() => {
    if (!selectedFacility || selectedFacility.facility_type !== 'fuel' || !userLocation?.confirmed || !userLocation.lat || !userLocation.lon) {
      return null;
    }
    const R = 6371; // km
    const dLat = (selectedFacility.lat - userLocation.lat) * Math.PI / 180;
    const dLon = (selectedFacility.lon - userLocation.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(selectedFacility.lat * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distKm = R * c;
    if (distanceUnit === 'imperial') {
      return `${(distKm * 0.621371).toFixed(1)} mi`;
    }
    return `${distKm.toFixed(1)} km`;
  }, [selectedFacility, userLocation, distanceUnit]);
  // Google Earth 風格固定長度比例尺之動態數值推算 (Fixed-width Google Earth Style Scale Calculation)
  const [scaleText, setScaleText] = useState<string>('500 米');

  const updateScale = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const scaleWidthPx = 120; // 固定物理長度 120px

    try {
      const container = map.getContainer();
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;
      const y = height - 20;
      const x2 = width - 20;
      const x1 = x2 - scaleWidthPx;

      const p1 = map.unproject([x1, y]);
      const p2 = map.unproject([x2, y]);
      const distMeters = p1.distanceTo(p2);

      if (distMeters <= 0 || isNaN(distMeters)) return;

      if (distanceUnit === 'imperial') {
        const feet = distMeters * 3.28084;
        if (feet < 5280) {
          setScaleText(`${Math.round(feet).toLocaleString()} 英呎`);
        } else {
          const miles = feet / 5280;
          setScaleText(`${miles < 10 ? miles.toFixed(2) : miles.toFixed(1)} 英里`);
        }
      } else {
        if (distMeters < 1000) {
          setScaleText(`${Math.round(distMeters)} 米`);
        } else {
          const km = distMeters / 1000;
          if (km < 10) {
            setScaleText(`${km.toFixed(2)} 公里`);
          } else if (km < 100) {
            setScaleText(`${km.toFixed(1)} 公里`);
          } else {
            setScaleText(`${Math.round(km).toLocaleString()} 公里`);
          }
        }
      }
    } catch {
      const zoom = map.getZoom();
      const lat = map.getCenter().lat;
      const rad = (lat * Math.PI) / 180;
      const metersPerPx = (40075016.686 * Math.cos(rad)) / Math.pow(2, zoom + 8);
      const distMeters = scaleWidthPx * metersPerPx;
      if (distMeters < 1000) {
        setScaleText(`${Math.round(distMeters)} 米`);
      } else {
        const km = distMeters / 1000;
        setScaleText(`${km < 10 ? km.toFixed(2) : km.toFixed(1)} 公里`);
      }
    }
  }, [distanceUnit]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const handleZoomOrMove = () => {
      updateScale();
      const z = map.getZoom();
      setCurrentZoom(z);
      setZoomNotification(prev => {
        if (prev?.show && z >= (prev.targetZoom ? prev.targetZoom - 0.5 : 13.5)) {
          return { ...prev, show: false };
        }
        return prev;
      });
    };
    updateScale();
    map.on('move', handleZoomOrMove);
    map.on('zoom', handleZoomOrMove);
    return () => {
      map.off('move', handleZoomOrMove);
      map.off('zoom', handleZoomOrMove);
    };
  }, [updateScale]);

  // 當開啟單車架、管道、斑馬線等高密度圖層時，若當前視野層級過低，主動提示用家放大檢視
  useEffect(() => {
    const prev = prevLayersRef.current;
    prevLayersRef.current = layers;

    const turnedOnWater = !prev.waterDistributionMains && layers.waterDistributionMains;
    const turnedOnSewer = !prev.sewerMains && layers.sewerMains;
    const turnedOnBikeRacks = !prev.bikeRacks && layers.bikeRacks;
    const turnedOnCrosswalks = !prev.trafficCrosswalks && layers.trafficCrosswalks;
    const turnedOnLitter = !prev.litterContainers && layers.litterContainers;

    const map = mapRef.current?.getMap();
    const z = map ? map.getZoom() : currentZoom;

    // 1. 單車架 (Bike Racks)
    if (turnedOnBikeRacks) {
      if (z < 13.5) {
        setZoomNotification({
          show: true,
          title: '已開啟單車架圖層',
          message: '單車架設施點位較為密集，請放大地圖以清晰檢視位置與圖示。',
          targetZoom: 14.5
        });
        return;
      }
    }

    // 2. 自來水管道或污水管道 (Water / Sewer Mains)
    if (turnedOnWater || turnedOnSewer) {
      if (z < 12.5) {
        const names = [];
        if (turnedOnWater || layers.waterDistributionMains) names.push('自來水管道');
        if (turnedOnSewer || layers.sewerMains) names.push('污水管道');
        setZoomNotification({
          show: true,
          title: `已開啟${names.join('與')}`,
          message: '地下管道網數據較為龐大密集，請將地圖放大以檢視詳細線路分佈。',
          targetZoom: 13.5
        });
        return;
      }
    }

    // 3. 斑馬線 (Crosswalks)
    if (turnedOnCrosswalks) {
      if (z < 13.5) {
        setZoomNotification({
          show: true,
          title: '已開啟斑馬線圖層',
          message: '斑馬線點位密集，請放大地圖以檢視詳細路口分佈。',
          targetZoom: 14.5
        });
        return;
      }
    }

    // 4. 垃圾箱 (Litter Containers)
    if (turnedOnLitter) {
      if (z < 13.5) {
        setZoomNotification({
          show: true,
          title: '已開啟垃圾箱圖層',
          message: '垃圾箱數據較為密集，請放大地圖以清晰檢視分佈與圖示。',
          targetZoom: 14.5
        });
        return;
      }
    }
  }, [layers, currentZoom]);

  useEffect(() => {
    if (zoomNotification?.show) {
      const timer = setTimeout(() => {
        setZoomNotification(prev => (prev ? { ...prev, show: false } : null));
      }, 9000);
      return () => clearTimeout(timer);
    }
  }, [zoomNotification?.show]);

  // 響應全域搜尋項目選取 (FlyTo & 自動打開詳細資訊卡片)
  useEffect(() => {
    if (!searchTarget) {
      setSearchedBusRoute(null);
      return;
    }

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [searchTarget.lon, searchTarget.lat],
        zoom: searchTarget.zoom || 16,
        duration: 1200
      });
    }

    if (searchTarget.category === 'bus_route') {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
      setSelectedBus(null);
      setBusDetails(null);

      const routeId = searchTarget.meta?.route_id || searchTarget.id.replace('route_', '');
      const variantKey = searchTarget.meta?.variant_key || '';
      setLoadingSearchedRoute(true);
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/api/transit/route/${encodeURIComponent(routeId)}${variantKey ? `?variant=${encodeURIComponent(variantKey)}` : ''}`)
        .then(res => res.json())
        .then(data => {
          setSearchedBusRoute(data);
          setLoadingSearchedRoute(false);
          // 搜尋完畢後不自動彈出 popup，僅平滑移動至路線視野供使用者查看與自由點選車輛
          if (data.buses && data.buses.length > 0) {
            const midBus = data.buses[Math.floor(data.buses.length / 2)];
            if (mapRef.current) {
              mapRef.current.flyTo({
                center: [midBus.lon, midBus.lat],
                zoom: 13.5,
                duration: 1200
              });
            }
          } else if (data.stops && data.stops.length > 0) {
            const midIdx = Math.floor(data.stops.length / 2);
            if (mapRef.current) {
              mapRef.current.flyTo({
                center: [data.stops[midIdx].lon, data.stops[midIdx].lat],
                zoom: 13,
                duration: 1200
              });
            }
          }
        })
        .catch(err => {
          console.error('Error fetching searched bus route:', err);
          setLoadingSearchedRoute(false);
        });
    } else if (searchTarget.category === 'ferry_terminal' && searchTarget.meta?.code) {
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedTerminal({
        geometry: { coordinates: [searchTarget.lon, searchTarget.lat] },
        properties: { code: searchTarget.meta.code, name: searchTarget.title }
      });
      setLoadingSchedule(true);
      const apiUrl = getApiUrl();
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
    } else if (searchTarget.category === 'ferry_vehicle') {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
      setSelectedBus(null);

      // Match vessel in live ferryVehicles by id or name
      const targetName = (searchTarget.title || '').trim().toLowerCase();
      const liveVessel = ferryVehicles.find(v => 
        (v.id && searchTarget.id && v.id === searchTarget.id) ||
        (v.vessel_name && v.vessel_name.toLowerCase() === targetName) ||
        (v.vessel_name && targetName.includes(v.vessel_name.toLowerCase()))
      );

      const targetLon = liveVessel ? liveVessel.lon : searchTarget.lon;
      const targetLat = liveVessel ? liveVessel.lat : searchTarget.lat;

      if (liveVessel) {
        setSelectedFerry(liveVessel);
      } else {
        setSelectedFerry({
          id: searchTarget.id,
          route_id: searchTarget.meta?.route_id || 'BC Ferries',
          vessel_name: searchTarget.title,
          dep_name: searchTarget.meta?.dep_name || '',
          arr_name: searchTarget.meta?.arr_name || '',
          progress: searchTarget.meta?.progress || 50,
          fill: searchTarget.meta?.fill || 0,
          departure_time: searchTarget.meta?.departure_time || '',
          arrival_time: searchTarget.meta?.arrival_time || '',
          lat: targetLat,
          lon: targetLon,
          bearing: 0
        });
      }

      if (mapRef.current) {
        mapRef.current.flyTo({
          center: [targetLon, targetLat],
          zoom: 13,
          duration: 1200
        });
      }
    } else if (searchTarget.category === 'skytrain') {
      setSelectedTerminal(null);
      setSelectedFacility(null);
      setSelectedFerry(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
      setSelectedBus(null);
      setSearchedBusRoute(null);
      setSelectedStop(null);
      setSelectedTrain(null);
      const stopId = searchTarget.meta?.stop_id || searchTarget.id.replace('stop_', '');
      fetchSkytrainStationSchedule(String(stopId), searchTarget.title, searchTarget.lon, searchTarget.lat);
      if (mapRef.current) {
        mapRef.current.flyTo({
          center: [searchTarget.lon, searchTarget.lat],
          zoom: 16,
          duration: 1200
        });
      }
    } else if (searchTarget.category === 'seabus' || searchTarget.category === 'bus_stop') {
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
      const apiUrl = getApiUrl();
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
    } else if (searchTarget.category === 'maritime_vessel') {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFacility(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
      setSelectedBus(null);
      setSelectedTrain(null);
      setSelectedFerry(null);

      const ship = maritimeVessels.find(v => v.mmsi === searchTarget.id || v.name === searchTarget.title);
      if (ship) {
        setSelectedMaritimeVessel(ship);
      } else if (searchTarget.meta) {
        setSelectedMaritimeVessel(searchTarget.meta as MaritimeVessel);
      }

      if (mapRef.current) {
        mapRef.current.flyTo({
          center: [searchTarget.lon, searchTarget.lat],
          zoom: 14,
          duration: 1200
        });
      }
    } else {
      setSelectedTerminal(null);
      setSelectedStop(null);
      setSelectedFlight(null);
      setSelectedAirport(null);
      const facType = searchTarget.meta?.properties?.facility_type || (searchTarget.category === 'road' ? (searchTarget.id?.startsWith('fuel_') ? 'fuel' : 'ev_charging') : searchTarget.category);
      setSelectedFacility({
        id: searchTarget.id,
        facility_type: facType,
        name: searchTarget.title,
        local_area: searchTarget.meta?.local_area || '',
        lon: searchTarget.lon,
        lat: searchTarget.lat,
        properties: searchTarget.meta?.properties || searchTarget.meta || {}
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
          } else if (message.type === 'skytrain_trains_update') {
            setSkytrainTrains(message.data);
          } else if (message.type === 'maritime_vessels_update' && Array.isArray(message.data)) {
            setMaritimeVessels(message.data);
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
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

    const apiUrl = getApiUrl();
    
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
    style.sources['car-sharing'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/car_sharing?v=2` };
    style.sources['police'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/police` };
    style.sources['disaster-hubs'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/disaster_hubs` };
    style.sources['local-area-boundary'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/local_area_boundary` };
    style.sources['fuel'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/fuel` };
    style.sources['tesla'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/tesla` };
    style.sources['marine_terminals'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/marine_terminals` };
    style.sources['aed'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/aed` };

    // Crime Areas (罪案地區 - 各區犯罪率面圖層)
    if (layers.crimeAreas) {
      style.sources['crime_areas'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/crime_areas` };
      style.layers.push({
        id: 'crime-areas-fill',
        type: 'fill',
        source: 'crime_areas',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.35
        }
      });
      style.layers.push({
        id: 'crime-areas-line',
        type: 'line',
        source: 'crime_areas',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2.0,
          'line-opacity': 0.85
        }
      });
      style.layers.push({
        id: 'crime-areas-label',
        type: 'symbol',
        source: 'crime_areas',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 2
        }
      });
    }

    // Bus Routes & Stops (Merged under busRoutes) - 當正在搜尋特定巴士路線或選中特定巴士時，只顯示該專屬路線，不繪製底圖全域 99 及 R1~R6 路線
    if (layers.busRoutes && !searchedBusRoute && !selectedBus) {
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

    // Road Facilities: One-Way Streets (單程路 LineString with Directional Arrows)
    if (layers.oneWayStreets) {
      style.sources['one_way_streets'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/one_way_streets` };
      style.layers.push({
        id: 'one-way-streets-casing-layer',
        type: 'line',
        source: 'one_way_streets',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.8, 14, 5.0, 17, 8.0],
          'line-opacity': 0.8
        }
      });
      style.layers.push({
        id: 'one-way-streets-layer',
        type: 'line',
        source: 'one_way_streets',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14, 3.4, 17, 5.8],
          'line-opacity': 0.95
        }
      });
      style.layers.push({
        id: 'one-way-streets-arrows',
        type: 'symbol',
        source: 'one_way_streets',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 75,
          'text-field': '▶',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 15, 12, 17, 16],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-keep-upright': false,
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#fbbf24',
          'text-halo-width': 1.5
        }
      });
    }

    // Road Facilities: Snow Removal Routes (鏟雪路線 LineString / MultiLineString with Ice Blue Styling)
    if (layers.snowRemovalRoutes) {
      style.sources['snow_removal_routes'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/snow_removal_routes` };
      style.layers.push({
        id: 'snow-removal-routes-casing-layer',
        type: 'line',
        source: 'snow_removal_routes',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#082f49',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.2, 13, 5.2, 16, 7.8],
          'line-opacity': 0.85
        }
      });
      style.layers.push({
        id: 'snow-removal-routes-layer',
        type: 'line',
        source: 'snow_removal_routes',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'priority'], 1], '#0284c7',
            '#38bdf8'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.0, 13, 3.6, 16, 5.6],
          'line-opacity': 0.95
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#10b981',
          'circle-stroke-width': 1.5,
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

    // Road Facilities: Car Sharing (共享汽車 - Evo & Modo)
    if (layers.carSharing) {
      style.layers.push({
        id: 'car-sharing-layer',
        type: 'circle',
        source: 'car-sharing',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': ['match', ['get', 'operator'], 'Evo', '#0284c7', 'Modo', '#e11d48', '#0284c7'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'car-sharing-symbol-layer',
        type: 'symbol',
        source: 'car-sharing',
        minzoom: 14,
        layout: {
          'text-field': '🚗',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#ef4444',
          'circle-stroke-width': 1.5,
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

    // Government Facilities: Police (警察局與社區警務中心)
    if (layers.police) {
      style.layers.push({
        id: 'police-layer',
        type: 'circle',
        source: 'police',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#2563eb',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'police-symbol-layer',
        type: 'symbol',
        source: 'police',
        minzoom: 14,
        layout: {
          'text-field': '👮',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 17, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Government Facilities: Disaster Support Hubs (災害支援中心 - 海嘯與地震緊急集合點)
    if (layers.disasterHubs) {
      style.layers.push({
        id: 'disaster-hubs-layer',
        type: 'circle',
        source: 'disaster-hubs',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#d97706',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'disaster-hubs-symbol-layer',
        type: 'symbol',
        source: 'disaster-hubs',
        minzoom: 13,
        layout: {
          'text-field': '🆘',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 15],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#8b5cf6',
          'circle-stroke-width': 1.5,
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': [
            'case',
            ['boolean', ['get', 'has_speed'], false],
            '#e11d48',
            '#f97316'
          ],
          'circle-stroke-width': 1.5,
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

    // Road Infrastructure: Gas Stations (加油站)
    if (layers.fuel) {
      style.layers.push({
        id: 'fuel-layer',
        type: 'circle',
        source: 'fuel',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#f59e0b',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'fuel-symbol-layer',
        type: 'symbol',
        source: 'fuel',
        minzoom: 14,
        layout: {
          'text-field': '⛽',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Road Infrastructure: Tesla Superchargers & Service Centers (TESLA 專屬超級充電與服務中心)
    if (layers.tesla) {
      style.layers.push({
        id: 'tesla-layer',
        type: 'circle',
        source: 'tesla',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#e82127',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'tesla-symbol-layer',
        type: 'symbol',
        source: 'tesla',
        minzoom: 12,
        layout: {
          'text-field': '⚡',
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 15, 11, 17, 13],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Maritime: Marine Terminals (溫哥華港口深水碼頭)
    if (layers.marineTerminals) {
      style.layers.push({
        id: 'marine-terminals-layer',
        type: 'circle',
        source: 'marine_terminals',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#0891b2',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'marine-terminals-symbol-layer',
        type: 'symbol',
        source: 'marine_terminals',
        minzoom: 11,
        layout: {
          'text-field': '⚓',
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13, 17, 16],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Government Facilities: Hospitals & UPCC (醫療: 急診醫院、復健醫院與急症基層醫療中心)
    if (layers.hospitals) {
      style.layers.push({
        id: 'hospitals-layer',
        type: 'circle',
        source: 'hospitals',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': [
            'case',
            ['==', ['get', 'medical_type'], 'upcc'], '#06b6d4',
            ['==', ['get', 'medical_type'], 'rehab'], '#14b8a6',
            '#10b981'
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'hospitals-symbol-layer',
        type: 'symbol',
        source: 'hospitals',
        minzoom: 11,
        layout: {
          'text-field': [
            'case',
            ['==', ['get', 'medical_type'], 'upcc'], '🩺',
            '🏥'
          ],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 14, 17, 17],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'hospitals-label-layer',
        type: 'symbol',
        source: 'hospitals',
        minzoom: 11.5,
        layout: {
          'text-field': ['coalesce', ['get', 'short_name'], ['get', 'chinese_name'], ['get', 'name']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10, 16, 12],
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-allow-overlap': true,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': [
            'case',
            ['==', ['get', 'medical_type'], 'upcc'], '#38bdf8',
            ['==', ['get', 'medical_type'], 'rehab'], '#2dd4bf',
            '#34d399'
          ],
          'text-halo-color': '#0f172a',
          'text-halo-width': 2
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#16a34a',
          'circle-stroke-width': 1.5,
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
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

    // Lifestyle Facilities: AED (自動體外心臟去顫器)
    if (layers.aed) {
      style.layers.push({
        id: 'aed-layer',
        type: 'circle',
        source: 'aed',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#dc2626',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'aed-symbol-layer',
        type: 'symbol',
        source: 'aed',
        minzoom: 14,
        layout: {
          'text-field': '⚡',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 12],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Geography: Elevation Contour Lines (等高線: 1m / 2m / 10m)
    if (layers.contours && contourInterval !== 'off') {
      style.sources['contours'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/contours?interval=${contourInterval}` };
      const isOneMetre = contourInterval === '1m';
      const isTwoMetre = contourInterval === '2m';
      style.layers.push({
        id: 'contours-layer',
        type: 'line',
        source: 'contours',
        paint: {
          'line-color': ['case', ['get', 'is_major'], '#0d9488', '#14b8a6'],
          'line-width': isOneMetre 
            ? ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.8, 16, 1.2]
            : isTwoMetre
            ? ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 1.0, 16, 1.5]
            : ['interpolate', ['linear'], ['zoom'], 11, 0.7, 14, 1.3, 16, 2.0],
          'line-opacity': isOneMetre ? 0.65 : 0.8
        }
      });
      style.layers.push({
        id: 'contours-label-layer',
        type: 'symbol',
        source: 'contours',
        minzoom: isOneMetre ? 14.5 : isTwoMetre ? 13.5 : 12.5,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-offset': [0, 0.5]
        },
        paint: {
          'text-color': '#0f766e',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5
        }
      });
    }

    // Geography: Local Area Boundary (區域邊界)
    if (layers.localAreaBoundary) {
      style.layers.push({
        id: 'local-area-boundary-fill',
        type: 'fill',
        source: 'local-area-boundary',
        paint: {
          'fill-color': '#0d9488',
          'fill-opacity': 0.08
        }
      });
      style.layers.push({
        id: 'local-area-boundary-line',
        type: 'line',
        source: 'local-area-boundary',
        paint: {
          'line-color': '#14b8a6',
          'line-width': 1.8,
          'line-dasharray': [3, 2],
          'line-opacity': 0.85
        }
      });
      style.layers.push({
        id: 'local-area-boundary-label',
        type: 'symbol',
        source: 'local-area-boundary',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#2dd4bf',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2
        }
      });
    }

    // Utilities: Water Distribution Mains (自來水管道)
    if (layers.waterDistributionMains) {
      style.sources['water_distribution_mains'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/water_distribution_mains` };
      style.layers.push({
        id: 'water-distribution-mains-layer',
        type: 'line',
        source: 'water_distribution_mains',
        minzoom: 12,
        paint: {
          'line-color': '#0ea5e9',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            12, 1.2,
            15, 2.5,
            18, 4.5
          ],
          'line-opacity': 0.85
        }
      });
    }

    // Utilities: Sewer Mains (污水管道)
    if (layers.sewerMains) {
      style.sources['sewer_mains'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/sewer_mains` };
      style.layers.push({
        id: 'sewer-mains-layer',
        type: 'line',
        source: 'sewer_mains',
        minzoom: 12,
        paint: {
          'line-color': '#14b8a6',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            12, 1.2,
            15, 2.5,
            18, 4.5
          ],
          'line-opacity': 0.85
        }
      });
    }

    // Road: Traffic Speed Limits (限速路段)
    if (layers.trafficSpeedLimits) {
      style.sources['traffic_speed_limits'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/traffic_speed_limits` };
      style.layers.push({
        id: 'traffic-speed-limits-casing-layer',
        type: 'line',
        source: 'traffic_speed_limits',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 17, 7.5],
          'line-opacity': 0.7
        }
      });
      style.layers.push({
        id: 'traffic-speed-limits-layer',
        type: 'line',
        source: 'traffic_speed_limits',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'match',
            ['to-string', ['get', 'speed_limit']],
            '30', '#10b981',
            '40', '#f59e0b',
            '50', '#3b82f6',
            '#6366f1'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 3.2, 17, 5.2],
          'line-opacity': 0.95
        }
      });
      style.layers.push({
        id: 'traffic-speed-limits-label',
        type: 'symbol',
        source: 'traffic_speed_limits',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 120,
          'text-field': ['concat', ['to-string', ['get', 'speed_limit']], ' km/h'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 15, 11, 17, 13],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-keep-upright': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2
        }
      });
    }

    // Road: Bike Racks (單車架)
    if (layers.bikeRacks) {
      style.sources['bike_racks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/bike_racks` };
      style.layers.push({
        id: 'bike-racks-layer',
        type: 'circle',
        source: 'bike_racks',
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#0d9488',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'bike-racks-symbol-layer',
        type: 'symbol',
        source: 'bike_racks',
        minzoom: 15,
        layout: {
          'text-field': '🚲',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 14],
          'text-allow-overlap': false
        }
      });
    }

    // Geography: Postal Code FSA (郵遞編號分區)
    if (layers.postalCodeFSA) {
      style.sources['postal_code_fsa'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/postal_code_fsa` };
      style.layers.push({
        id: 'postal-code-fsa-fill',
        type: 'fill',
        source: 'postal_code_fsa',
        paint: {
          'fill-color': '#6366f1',
          'fill-opacity': 0.08
        }
      });
      style.layers.push({
        id: 'postal-code-fsa-line',
        type: 'line',
        source: 'postal_code_fsa',
        paint: {
          'line-color': '#818cf8',
          'line-width': 1.8,
          'line-dasharray': [4, 2],
          'line-opacity': 0.85
        }
      });
      style.layers.push({
        id: 'postal-code-fsa-label',
        type: 'symbol',
        source: 'postal_code_fsa',
        layout: {
          'text-field': ['get', 'fsa'],
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#4f46e5',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2
        }
      });
    }

    // Utilities: Wireless Facilities (無線設施)
    if (layers.wirelessFacilities) {
      style.sources['wireless_facilities'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/wireless_facilities` };
      style.layers.push({
        id: 'wireless-facilities-layer',
        type: 'circle',
        source: 'wireless_facilities',
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#9333ea',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'wireless-facilities-symbol-layer',
        type: 'symbol',
        source: 'wireless_facilities',
        minzoom: 14,
        layout: {
          'text-field': '📡',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 14],
          'text-allow-overlap': false
        }
      });
    }

    // Road: Traffic Crosswalks (斑馬線)
    if (layers.trafficCrosswalks) {
      style.sources['traffic_crosswalks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/traffic_crosswalks` };
      style.layers.push({
        id: 'traffic-crosswalks-layer',
        type: 'circle',
        source: 'traffic_crosswalks',
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#eab308',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'traffic-crosswalks-symbol-layer',
        type: 'symbol',
        source: 'traffic_crosswalks',
        minzoom: 15,
        layout: {
          'text-field': '🚶',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 14],
          'text-allow-overlap': false
        }
      });
    }

    // Living: Litter Containers (垃圾箱)
    if (layers.litterContainers) {
      style.sources['litter_containers'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/litter_containers` };
      style.layers.push({
        id: 'litter-containers-layer',
        type: 'circle',
        source: 'litter_containers',
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#d97706',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'litter-containers-symbol-layer',
        type: 'symbol',
        source: 'litter_containers',
        minzoom: 15,
        layout: {
          'text-field': '🗑️',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 14],
          'text-allow-overlap': false
        }
      });
    }

    return style;
  }, [
    layers.skytrainRoutes, 
    layers.busRoutes, 
    searchedBusRoute,
    selectedBus,
    layers.seabusRoutes, 
    layers.bcferriesRoutes, 
    layers.parkingMeters, 
    layers.accessibleParking, 
    layers.motorcycleParking, 
    layers.evCharging, 
    layers.escooter,
    layers.carSharing,
    layers.sharedBikes,
    layers.bikeways,
    layers.trafficCameras,
    layers.safetyCameras,
    layers.fireHalls,
    layers.police,
    layers.disasterHubs,
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
    layers.aed,
    layers.homelessShelters,
    layers.contours,
    layers.localAreaBoundary,
    layers.fuel,
    layers.tesla,
    layers.oneWayStreets,
    layers.snowRemovalRoutes,
    layers.marineTerminals,
    layers.crimeAreas,
    layers.waterDistributionMains,
    layers.sewerMains,
    layers.trafficSpeedLimits,
    layers.bikeRacks,
    layers.postalCodeFSA,
    layers.wirelessFacilities,
    layers.trafficCrosswalks,
    layers.litterContainers,
    contourInterval,
    mapStyleType
  ]);

  return (
    <div 
      className={`absolute top-[60px] bottom-0 right-0 h-[calc(100vh-60px)] z-0 transition-[left,width] duration-200 overflow-hidden ${
        isLayerPanelOpen ? 'left-[240px] w-[calc(100%-240px)]' : 'left-0 w-full'
      }`}
    >
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -123.05, latitude: 49.25, zoom: 11, pitch: 0, bearing: 0 }}
        maxZoom={20}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        onMove={updateScale}
        onZoom={updateScale}
        onLoad={() => updateScale()}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
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
          'hospitals-label-layer',
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
          'homeless-shelters-symbol-layer',
          'car-sharing-layer',
          'car-sharing-symbol-layer',
          'police-layer',
          'police-symbol-layer',
          'disaster-hubs-layer',
          'disaster-hubs-symbol-layer',
          'aed-layer',
          'aed-symbol-layer',
          'fuel-layer',
          'fuel-symbol-layer',
          'tesla-layer',
          'tesla-symbol-layer',
          'marine-terminals-layer',
          'marine-terminals-symbol-layer',
          'one-way-streets-layer',
          'snow-removal-routes-layer',
          'traffic-speed-limits-layer',
          'bike-racks-layer',
          'bike-racks-symbol-layer',
          'postal-code-fsa-fill',
          'wireless-facilities-layer',
          'wireless-facilities-symbol-layer',
          'traffic-crosswalks-layer',
          'traffic-crosswalks-symbol-layer',
          'litter-containers-layer',
          'litter-containers-symbol-layer',
          'water-distribution-mains-layer',
          'sewer-mains-layer',
          'contours-layer',
          'contours-label-layer'
        ]}
        onClick={(e) => {
          // 若剛剛點擊了車輛、列車或標記，阻止地圖畫布背景點擊事件清理所選內容
          if (Date.now() - lastInteractiveItemClickRef.current < 450) {
            return;
          }

          const feature = e.features?.[0];
          if (!feature) {
            setSelectedStop(null);
            setSelectedFacility(null);
            setSelectedAirport(null);
            setSelectedFlight(null);
            setSelectedBus(null);
            setBusDetails(null);
            setSearchedBusRoute(null);
            setSelectedTrain(null);
            setSelectedSkytrainStation(null);
            setSelectedTerminal(null);
            setSelectedFerry(null);
            setSearchTarget(null);
            return;
          }

          const layerId = feature.layer.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (feature.geometry as any).coordinates;

          if (layerId === 'skytrain-stops-layer') {
            setSelectedFacility(null);
            setSelectedStop(null);
            setSelectedBus(null);
            setSelectedTrain(null);
            const stopId = feature.properties?.stop_id || feature.properties?.id;
            const stopName = feature.properties?.name || '天車站';
            fetchSkytrainStationSchedule(String(stopId), stopName, coords[0], coords[1]);
          } else if (layerId === 'bus-stops-layer' || layerId === 'seabus-stops-layer') {
            setSelectedFacility(null);
            setSelectedTrain(null);
            setSelectedSkytrainStation(null);
            const stopId = feature.properties?.stop_id;
            const stopName = feature.properties?.name;
            setSelectedStop({ id: stopId, name: stopName, lon: coords[0], lat: coords[1] });
            
            // Fetch arrivals
            setLoadingArrivals(true);
            const apiUrl = getApiUrl();
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
          } else if (layerId === 'one-way-streets-layer' || layerId === 'one-way-streets-casing-layer' || layerId === 'one-way-streets-arrows') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.hblock ? `oneway_${props.hblock}` : `oneway_${clickLon}_${clickLat}`,
              facility_type: 'one_way_streets',
              name: props.hblock || '單程路',
              local_area: '溫哥華單向道路管制',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'snow-removal-routes-layer' || layerId === 'snow-removal-routes-casing-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.object_id ? `snow_${props.object_id}` : `snow_${clickLon}_${clickLat}`,
              facility_type: 'snow_removal_routes',
              name: props.name || '鏟雪優先路線',
              local_area: '溫哥華冬季鏟雪與除冰路網',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'water-distribution-mains-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: `water_${clickLon}_${clickLat}`,
              facility_type: 'water_distribution_mains',
              name: '自來水主管道',
              local_area: '溫哥華市區供水主幹管網',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'sewer-mains-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: `sewer_${clickLon}_${clickLat}`,
              facility_type: 'sewer_mains',
              name: '污水下水道',
              local_area: '溫哥華市政排水與污水管網',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'contours-layer' || layerId === 'contours-label-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.id || `contour_${props.elevation}`,
              facility_type: 'contours',
              name: `海拔等高線: ${props.label || props.elevation + 'm'}`,
              local_area: '溫哥華地形等高線',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'traffic-speed-limits-layer' || layerId === 'traffic-speed-limits-casing-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.object_id ? `speed_${props.object_id}` : `speed_${clickLon}_${clickLat}`,
              facility_type: 'traffic_speed_limits',
              name: props.name || props.hblock || '速限管制路段',
              local_area: props.segment_type ? `分區: ${props.segment_type}` : '溫哥華市區道路',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'postal-code-fsa-fill' || layerId === 'postal-code-fsa-line') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.fsa ? `fsa_${props.fsa}` : `fsa_${clickLon}_${clickLat}`,
              facility_type: 'postal_code_fsa',
              name: `郵遞編號分區 ${props.fsa || ''}`,
              local_area: props.province || '溫哥華前瞻轉運區 (FSA)',
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
            layerId.startsWith('car-sharing') ||
            layerId.startsWith('shared-bikes') ||
            layerId.startsWith('bike-racks') ||
            layerId.startsWith('wireless-facilities') ||
            layerId.startsWith('traffic-crosswalks') ||
            layerId.startsWith('litter-containers') ||
            layerId.startsWith('traffic-cameras') ||
            layerId.startsWith('safety-cameras') ||
            layerId.startsWith('fuel') ||
            layerId.startsWith('tesla') ||
            layerId.startsWith('marine-terminals') ||
            layerId.startsWith('fire-halls') ||
            layerId.startsWith('police') ||
            layerId.startsWith('disaster-hubs') ||
            layerId.startsWith('community-centres') ||
            layerId.startsWith('hospitals') ||
            layerId.startsWith('parks') ||
            layerId.startsWith('community-gardens') ||
            layerId.startsWith('drinking-fountains') ||
            layerId.startsWith('public-washrooms') ||
            layerId.startsWith('schools') ||
            layerId.startsWith('libraries') ||
            layerId.startsWith('food-vendors') ||
            layerId.startsWith('aed') ||
            layerId.startsWith('homeless-shelters')
          ) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const isFuel = layerId.startsWith('fuel');
            const isTesla = layerId.startsWith('tesla');
            const isMarineTerminal = layerId.startsWith('marine-terminals');
            const isBikeRack = layerId.startsWith('bike-racks');
            const isWireless = layerId.startsWith('wireless-facilities');
            const isCrosswalk = layerId.startsWith('traffic-crosswalks');
            const isLitter = layerId.startsWith('litter-containers');
            setSelectedFacility({
              id: props.id || (props.object_id ? `${props.facility_type || (isBikeRack ? 'bike_rack' : (isWireless ? 'wireless' : (isCrosswalk ? 'crosswalk' : (isLitter ? 'litter' : 'fac'))))}_${props.object_id}` : ''),
              facility_type: props.facility_type || (isFuel ? 'fuel' : (isTesla ? 'tesla' : (isMarineTerminal ? 'marine_terminals' : (isBikeRack ? 'bike_racks' : (isWireless ? 'wireless_facilities' : (isCrosswalk ? 'traffic_crosswalks' : (isLitter ? 'litter_containers' : ''))))))),
              name: props.name || (isCrosswalk ? (props.location ? `斑馬線 - ${props.location}` : '行人斑馬線') : (isLitter ? (props.address ? `垃圾箱 - ${props.address}` : '公用垃圾箱') : (isBikeRack ? (props.location ? `單車架 - ${props.location}` : '公用單車架') : (isWireless ? (props.site_name || `無線設施 #${props.pole_number || ''}`) : (props.brand || (isFuel ? '加油站' : (isTesla ? 'Tesla 站點' : (isMarineTerminal ? '港口碼頭' : '')))))))),
              local_area: props.waterway || props.local_area || props.location || props.company || props.address || props.city || '',
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
            setSearchedBusRoute(null);
            setSearchTarget(null);
            setSelectedTrain(null);
            setSelectedSkytrainStation(null);
            setSelectedTerminal(null);
            setSelectedFerry(null);
          }
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch={true} />

        {/* 選中巴士或搜尋路線之路線軌跡與沿線站點 */}
        {busRouteGeoJSON && (
          <Source id="selected-bus-route-source" type="geojson" data={busRouteGeoJSON}>
            <Layer
              id="selected-bus-route-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': busDetails?.color || searchedBusRoute?.color || '#10b981',
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
                'line-color': busDetails?.color || searchedBusRoute?.color || '#10b981',
                'line-width': 4,
                'line-opacity': 0.95
              }}
            />
          </Source>
        )}

        {(selectedBus || searchedBusRoute) && ((busDetails?.stops && busDetails.stops.length > 0) ? busDetails.stops : (searchedBusRoute?.stops || [])).map((st: { seq: number; stop_id: string; name: string; lat: number; lon: number; status?: string }) => (
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

        {/* 選中天車之路線軌跡與沿線站點 */}
        {skytrainRouteGeoJSON && (
          <Source id="selected-train-route-source" type="geojson" data={skytrainRouteGeoJSON}>
            <Layer
              id="selected-train-route-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': selectedTrain?.color || '#0033a0',
                'line-width': 8,
                'line-blur': 3,
                'line-opacity': 0.6
              }}
            />
            <Layer
              id="selected-train-route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': selectedTrain?.color || '#0033a0',
                'line-width': 4,
                'line-opacity': 0.95
              }}
            />
          </Source>
        )}

        {selectedTrain && selectedTrain.stops.map((st) => (
          <Marker key={`train-stop-${st.seq}-${st.stop_id}`} longitude={st.lon} latitude={st.lat} anchor="center">
            <div
              className={`rounded-full border transition-transform ${
                st.status === 'next'
                  ? 'w-3.5 h-3.5 bg-amber-400 border-white shadow-[0_0_8px_rgba(251,191,36,0.95)] scale-125 z-20'
                  : st.status === 'passed'
                  ? 'w-2 h-2 bg-gray-400/80 border-gray-800 opacity-70 z-10'
                  : 'w-2.5 h-2.5 bg-blue-400 border-gray-900 shadow-sm z-10'
              }`}
              title={`${st.seq}. ${st.name}`}
            />
          </Marker>
        ))}

        {/* 搜尋目標高亮光環 (Search Target Focus Ring) - 巴士路線等整條路線不顯示中心點閃爍標記 */}
        {searchTarget && searchTarget.category !== 'bus_route' && searchTarget.category !== 'ferry_vehicle' && (
          <Marker longitude={searchTarget.lon} latitude={searchTarget.lat} anchor="center">
            <div 
              onClick={(e) => {
                e.stopPropagation();
                setSearchTarget(null);
                if (selectedFacility) setSelectedFacility(null);
              }}
              className="relative flex items-center justify-center cursor-pointer z-40 group"
              title="點擊清除閃爍標記"
            >
              <span className="absolute w-12 h-12 rounded-full bg-emerald-400/40 animate-ping pointer-events-none"></span>
              <span className="w-7 h-7 rounded-full border-2 border-emerald-400 bg-emerald-500/30 group-hover:bg-rose-500/60 group-hover:border-rose-400 flex items-center justify-center shadow-lg transition-all">
                <span className="text-xs group-hover:hidden">{searchTarget.icon}</span>
                <span className="text-xs hidden group-hover:inline text-white font-bold leading-none">✕</span>
              </span>
            </div>
          </Marker>
        )}

        {/* 個人設定位置標記 (User Confirmed Personal Location) */}
        {userLocation?.confirmed && userLocation.lat && userLocation.lon && (
          <Marker longitude={userLocation.lon} latitude={userLocation.lat} anchor="bottom">
            <div 
              className="group relative flex flex-col items-center cursor-pointer z-35 select-none"
              onClick={(e) => {
                e.stopPropagation();
                mapRef.current?.flyTo({
                  center: [userLocation.lon!, userLocation.lat!],
                  zoom: 15,
                  duration: 800
                });
              }}
            >
              <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2.5 py-1 rounded-md bg-gray-900/95 text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none border border-indigo-500/40 z-50">
                <span>🏠 個人位置：{userLocation.displayName || userLocation.address}</span>
              </div>
              <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 border-2 border-white shadow-[0_2px_12px_rgba(79,70,229,0.5)] text-white hover:scale-115 transition-transform">
                <span className="text-base leading-none">🏠</span>
              </div>
              <div className="w-2 h-2 bg-indigo-600 rotate-45 -mt-1 border-r border-b border-white shadow-sm"></div>
            </div>
          </Marker>
        )}

        {/* 即時車輛位置 (Live TransLink Vehicles) */}
        {displayVehicles.map(v => {
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
            const isRapidBus = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', '99'].includes(busNum);
            const isSearchedRouteBus = searchedBusRoute && (
              String(v.route_id) === String(searchedBusRoute.route_id) || 
              String(v.route_number).toLowerCase() === String(searchedBusRoute.route_number).toLowerCase()
            );

            // 若目前搜尋特定巴士路線，則僅顯示該路線在途車輛；若無搜尋，則依照一般巴士圖層開關顯示 RapidBus / 99
            if (searchedBusRoute) {
              if (!isSearchedRouteBus) return null;
            } else {
              if (!layers.bus || !isRapidBus) return null;
            }

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

        {/* 🚢 Maritime Shipping 港口商船 (Live AIS Shipping from Aisstream.io) */}
        {layers.maritimeShipping && maritimeVessels.filter(ship => !isShipOnLand(ship.lon, ship.lat)).map(ship => {
          const isSelected = selectedMaritimeVessel?.mmsi === ship.mmsi;
          const headingDeg = ship.cog || ship.heading || 0;
          
          const bgColor = 
            ship.type_group === 'cargo' ? '#16a34a' :
            ship.type_group === 'tanker' ? '#dc2626' :
            ship.type_group === 'tug' ? '#0891b2' :
            ship.type_group === 'passenger' ? '#2563eb' :
            ship.type_group === 'pleasure' || ship.type_group === 'sailing' ? '#a855f7' :
            ship.type_group === 'other' ? '#a855f7' : '#16a34a';

          const isMoving = (ship.sog && ship.sog > 0.5);

          return (
            <Marker 
              key={`ship-${ship.mmsi}`} 
              longitude={ship.lon} 
              latitude={ship.lat} 
              anchor="center"
              onClick={(e) => {
                e.originalEvent?.stopPropagation();
                setSelectedMaritimeVessel(ship);
              }}
            >
              <div 
                className={`relative flex items-center justify-center w-7 h-7 rounded-full cursor-pointer tooltip border-2 border-white shadow-xl backdrop-blur-sm transition-transform hover:scale-125 z-30 ${
                  isSelected ? 'ring-4 ring-cyan-400 scale-125 z-40' : ''
                }`}
                style={{ backgroundColor: bgColor }}
                title={`${ship.name} (${ship.ship_type}) · ${ship.sog} 節 · ${ship.nav_status}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedMaritimeVessel(ship);
                }}
              >
                <div 
                  className="w-full h-full flex items-center justify-center transition-transform duration-300"
                  style={{ transform: `rotate(${headingDeg}deg)` }}
                >
                  {isMoving ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="white" strokeWidth="1" className="text-white drop-shadow-sm">
                      <polygon points="12,2 19,21 12,17 5,21" />
                    </svg>
                  ) : (
                    <div className="w-2.5 h-2.5 rounded-full bg-white/90 shadow-sm" />
                  )}
                </div>
              </div>
            </Marker>
          );
        })}

        {/* SkyTrain 即時推算列車 (Live Estimated SkyTrain Trains) */}
        {layers.skytrainTrains && skytrainTrains.map(train => {
          const isSelected = selectedTrain?.id === train.id;
          return (
            <Marker 
              key={train.id} 
              longitude={train.lon} 
              latitude={train.lat} 
              anchor="center"
              onClick={(e) => {
                e.originalEvent?.stopPropagation();
                handleSelectTrain(train);
              }}
            >
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent?.stopImmediatePropagation();
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.nativeEvent?.stopImmediatePropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.nativeEvent?.stopImmediatePropagation();
                  handleSelectTrain(train);
                }}
                className={`relative flex items-center justify-center w-6 h-6 rounded-full cursor-pointer tooltip border-[1.5px] border-white shadow-lg backdrop-blur-sm transition-transform hover:scale-125 z-30 ${
                  isSelected ? 'ring-4 ring-amber-400 scale-125 z-40' : ''
                }`}
                style={{
                  backgroundColor: train.color,
                  boxShadow: `0 0 10px ${train.color}bb`
                }}
                title={`${train.line_name} 往 ${train.destination} (${train.status})`}
              >
                <span className="text-[12px] leading-none select-none">🚆</span>
              </div>
            </Marker>
          );
        })}



        {/* 到站時間 Popup */}
        {selectedStop && (
          <Popup
            longitude={selectedStop.lon}
            latitude={selectedStop.lat}
            anchor="bottom"
            onClose={() => {
              setSelectedStop(null);
              setSearchTarget(null);
            }}
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
                const apiUrl = getApiUrl();
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
            onClose={() => {
              setSelectedTerminal(null);
              setSearchTarget(null);
            }}
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
                  onClick={() => {
                    setSelectedTerminal(null);
                    setSearchTarget(null);
                  }} 
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
                            {formatTimePreference(sailing.time, timeFormat)} {sailing.arrival_time ? `➝ ${formatTimePreference(sailing.arrival_time, timeFormat)}` : ""}
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
            onClose={() => {
              setSelectedFerry(null);
              setSearchTarget(null);
            }}
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
                  onClick={() => {
                    setSelectedFerry(null);
                    setSearchTarget(null);
                  }} 
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
                    {formatTimePreference(selectedFerry.departure_time, timeFormat)} {selectedFerry.arrival_time ? `➝ ${formatTimePreference(selectedFerry.arrival_time, timeFormat)}` : ''}
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

        {/* 🚢 Maritime Shipping Vessel Popup (港口船運商船彈出卡) */}
        {selectedMaritimeVessel && (
          <Popup
            longitude={selectedMaritimeVessel.lon}
            latitude={selectedMaritimeVessel.lat}
            anchor="bottom"
            onClose={() => {
              setSelectedMaritimeVessel(null);
              setSearchTarget(null);
            }}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -14]}
            maxWidth="380px"
          >
            <div className="p-3.5 w-[320px] sm:w-[350px] max-w-[90vw] text-gray-800">
              <div className="flex items-start justify-between pb-2 mb-2.5 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0 ${
                    selectedMaritimeVessel.type_group === 'tanker' ? 'bg-[#ea580c]' :
                    selectedMaritimeVessel.type_group === 'tug' ? 'bg-[#0891b2]' :
                    selectedMaritimeVessel.type_group === 'passenger' ? 'bg-[#059669]' :
                    selectedMaritimeVessel.type_group === 'other' ? 'bg-[#475569]' : 'bg-[#1d4ed8]'
                  }`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
                      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/>
                      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
                      <path d="M12 10v4"/>
                      <path d="M12 2v3"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight flex items-center gap-1.5">
                      <span>{selectedMaritimeVessel.name}</span>
                      {selectedMaritimeVessel.flag && (
                        <span className="text-[10px] text-gray-500 font-normal">({selectedMaritimeVessel.flag})</span>
                      )}
                    </h3>
                    <div className="text-[10px] text-sky-700 font-semibold flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>{selectedMaritimeVessel.nav_status || '航行中'}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setSelectedMaritimeVessel(null);
                    setSearchTarget(null);
                  }} 
                  className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none -mt-1"
                >
                  &times;
                </button>
              </div>

              {/* Vessel specs */}
              <div className="flex flex-col gap-1.5 mb-2.5 bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 text-[11px]">船舶類型</span>
                  <span className="font-semibold text-gray-800 text-[11px]">{selectedMaritimeVessel.ship_type}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 text-[11px]">即時航速 (SOG)</span>
                  <span className="font-bold text-emerald-700 font-mono text-[11px]">
                    {selectedMaritimeVessel.sog} 節 ({Math.round(selectedMaritimeVessel.sog * 1.852)} km/h)
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 text-[11px]">對地航向 / 艏向</span>
                  <span className="font-medium text-gray-800 font-mono text-[11px]">
                    {Math.round(selectedMaritimeVessel.cog)}° / {Math.round(selectedMaritimeVessel.heading)}°
                  </span>
                </div>
                {selectedMaritimeVessel.destination && (
                  <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-200/60">
                    <span className="text-gray-500 text-[11px]">申報目的地</span>
                    <span className="font-semibold text-sky-800 text-[11px] truncate max-w-[190px]">
                      {selectedMaritimeVessel.destination}
                    </span>
                  </div>
                )}
                {selectedMaritimeVessel.eta && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 text-[11px]">預計抵達 (ETA)</span>
                    <span className="font-medium text-gray-700 text-[11px]">{formatShipEta(selectedMaritimeVessel.eta, timeFormat)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-200/60">
                  <span className="text-gray-500 text-[10px]">船體尺寸 / 吃水</span>
                  <span className="font-mono text-gray-600 text-[10px]">
                    {selectedMaritimeVessel.length || '--'}m × {selectedMaritimeVessel.width || '--'}m · 吃水 {selectedMaritimeVessel.draft || '--'}m
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 text-[10px]">MMSI / 呼號</span>
                  <span className="font-mono text-gray-600 text-[10px]">
                    {selectedMaritimeVessel.mmsi} {selectedMaritimeVessel.callsign ? `· ${selectedMaritimeVessel.callsign}` : ''}
                  </span>
                </div>
              </div>

              {/* Data source attribution */}
              <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1 border-t border-gray-100">
                <span>{selectedMaritimeVessel.source || 'Aisstream.io (即時 AIS 串流)'}</span>
                <span className="text-emerald-600 font-medium">即時連線</span>
              </div>
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
                        {formatTimePreference(selectedFlight.departure_time, timeFormat)}
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
                        {formatTimePreference(selectedFlight.arrival_time, timeFormat)}
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
            onClose={() => {
              setSelectedFacility(null);
              setSearchTarget(null);
            }}
            closeOnClick={false}
            closeButton={false}
            className="z-50"
            offset={[0, -10]}
            maxWidth={
              selectedFacility.facility_type === 'traffic_cameras' ? '400px' : 
              (selectedFacility.facility_type === 'safety_cameras' || selectedFacility.facility_type === 'hospitals' || selectedFacility.facility_type === 'car_sharing' || selectedFacility.facility_type === 'fuel' || selectedFacility.facility_type === 'tesla' || selectedFacility.facility_type === 'marine_terminals' || selectedFacility.facility_type === 'one_way_streets' || selectedFacility.facility_type === 'snow_removal_routes' || selectedFacility.facility_type === 'water_distribution_mains' || selectedFacility.facility_type === 'sewer_mains' || selectedFacility.facility_type === 'traffic_speed_limits' || selectedFacility.facility_type === 'postal_code_fsa' || selectedFacility.facility_type === 'bike_racks' || selectedFacility.facility_type === 'wireless_facilities' || selectedFacility.facility_type === 'traffic_crosswalks' || selectedFacility.facility_type === 'litter_containers') ? '360px' : 
              '320px'
            }
          >
            <div className={`p-3.5 ${
              selectedFacility.facility_type === 'traffic_cameras' ? 'w-[360px]' : 
              (selectedFacility.facility_type === 'safety_cameras' || selectedFacility.facility_type === 'hospitals' || selectedFacility.facility_type === 'car_sharing' || selectedFacility.facility_type === 'fuel' || selectedFacility.facility_type === 'tesla' || selectedFacility.facility_type === 'marine_terminals' || selectedFacility.facility_type === 'one_way_streets' || selectedFacility.facility_type === 'snow_removal_routes' || selectedFacility.facility_type === 'water_distribution_mains' || selectedFacility.facility_type === 'sewer_mains' || selectedFacility.facility_type === 'traffic_speed_limits' || selectedFacility.facility_type === 'postal_code_fsa' || selectedFacility.facility_type === 'bike_racks' || selectedFacility.facility_type === 'wireless_facilities' || selectedFacility.facility_type === 'traffic_crosswalks' || selectedFacility.facility_type === 'litter_containers') ? 'w-[340px]' : 
              'w-[290px]'
            } max-w-[90vw] text-gray-800`}>
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    selectedFacility.facility_type === 'water_distribution_mains' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'sewer_mains' ? 'bg-teal-500' :
                    selectedFacility.facility_type === 'traffic_speed_limits' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'postal_code_fsa' ? 'bg-indigo-600' :
                    selectedFacility.facility_type === 'bike_racks' ? 'bg-teal-600' :
                    selectedFacility.facility_type === 'wireless_facilities' ? 'bg-purple-600' :
                    selectedFacility.facility_type === 'traffic_crosswalks' ? 'bg-yellow-500' :
                    selectedFacility.facility_type === 'litter_containers' ? 'bg-amber-600' :
                    selectedFacility.facility_type === 'tesla' ? 'bg-red-600' :
                    selectedFacility.facility_type === 'marine_terminals' ? 'bg-cyan-600' :
                    selectedFacility.facility_type === 'snow_removal_routes' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'one_way_streets' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'fuel' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'parking_meters' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'accessible_parking' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'motorcycle_parking' ? 'bg-orange-500' :
                    selectedFacility.facility_type === 'ev_charging' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'escooter' ? 'bg-lime-500' :
                    selectedFacility.facility_type === 'car_sharing' ? 'bg-sky-600' :
                    selectedFacility.facility_type === 'shared_bikes' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'bikeways' ? 'bg-teal-500' :
                    selectedFacility.facility_type === 'traffic_cameras' ? 'bg-cyan-500' :
                    selectedFacility.facility_type === 'safety_cameras' ? 'bg-rose-600' :
                    selectedFacility.facility_type === 'hospitals' ? 'bg-emerald-500' :
                    selectedFacility.facility_type === 'fire_halls' ? 'bg-rose-500' :
                    selectedFacility.facility_type === 'police' ? 'bg-blue-600' :
                    selectedFacility.facility_type === 'disaster_hubs' ? 'bg-amber-600' :
                    selectedFacility.facility_type === 'parks' ? 'bg-emerald-600' :
                    selectedFacility.facility_type === 'parks_facilities' ? 'bg-teal-600' :
                    selectedFacility.facility_type === 'community_gardens' ? 'bg-lime-600' :
                    selectedFacility.facility_type === 'drinking_fountains' ? 'bg-sky-500' :
                    selectedFacility.facility_type === 'public_washrooms' ? 'bg-cyan-500' :
                    selectedFacility.facility_type === 'schools' ? 'bg-blue-500' :
                    selectedFacility.facility_type === 'libraries' ? 'bg-amber-500' :
                    selectedFacility.facility_type === 'food_vendors' ? 'bg-orange-500' :
                    selectedFacility.facility_type === 'aed' ? 'bg-red-600' :
                    selectedFacility.facility_type === 'contours' ? 'bg-teal-700' :
                    selectedFacility.facility_type === 'homeless_shelters' ? 'bg-rose-500' : 'bg-violet-500'
                  }`}></span>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight">{selectedFacility.name}</h3>
                    {selectedFacility.local_area && (
                      <span className="text-[11px] text-gray-400">{selectedFacility.local_area}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 shrink-0 -mt-1 -mr-1">
                  <button 
                    onClick={() => {
                      setSelectedFacility(null);
                      setSearchTarget(null);
                    }} 
                    className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none"
                    title="關閉"
                  >
                    &times;
                  </button>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-md text-sky-600 hover:text-sky-700 hover:bg-sky-50 transition-colors flex items-center justify-center shadow-sm border border-sky-100"
                    title="Google 導航至此"
                  >
                    <Compass className="w-3.5 h-3.5" />
                  </a>
                </div>
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

              {/* Car Sharing Details (Evo & Modo) */}
              {selectedFacility.facility_type === 'car_sharing' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className={`p-2.5 rounded border flex flex-col gap-1 ${
                    selectedFacility.properties.operator === 'Modo' 
                      ? 'bg-red-50/80 border-red-200 text-red-950' 
                      : 'bg-cyan-50/80 border-cyan-200 text-cyan-950'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <span>🚗</span>
                        <span>{selectedFacility.properties.operator_name || (selectedFacility.properties.operator === 'Modo' ? 'Modo Co-op' : 'Evo Car Share')}</span>
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${
                        selectedFacility.properties.operator === 'Modo' ? 'bg-red-600' : 'bg-cyan-600'
                      }`}>
                        {selectedFacility.properties.operator || '共享汽車'}
                      </span>
                    </div>
                    {selectedFacility.properties.capacity && (
                      <div className="flex justify-between items-baseline pt-1 border-t border-black/10">
                        <span className="text-gray-600 text-[11px]">車位規模</span>
                        <span className="font-bold text-sm text-gray-900">{selectedFacility.properties.capacity}</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.vehicle_type && (
                      <div className="flex justify-between items-start gap-2 text-gray-600">
                        <span className="shrink-0 text-gray-500">提供車種</span>
                        <span className="font-semibold text-gray-800 text-right leading-relaxed">
                          {selectedFacility.properties.vehicle_type}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.pricing && (
                      <div className="flex justify-between items-start gap-2 text-gray-600">
                        <span className="shrink-0 text-gray-500">計費方案</span>
                        <span className="font-bold text-emerald-700 text-right leading-relaxed">
                          {selectedFacility.properties.pricing}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-start gap-2 text-gray-600">
                        <span className="shrink-0 text-gray-500">站點位置</span>
                        <span className="font-medium text-gray-800 text-right leading-relaxed">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href={selectedFacility.properties.app_url || (selectedFacility.properties.operator === 'Modo' ? "https://modo.coop" : "https://evo.ca")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center justify-center w-full py-1.5 px-3 text-white rounded font-medium text-xs transition-colors shadow-sm ${
                        selectedFacility.properties.operator === 'Modo' ? 'bg-red-600 hover:bg-red-700' : 'bg-cyan-600 hover:bg-cyan-700'
                      }`}
                    >
                      前往 {selectedFacility.properties.operator || '共享汽車'} 官網 / App ↗
                    </a>
                  </div>
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

              {/* Police (警察) Details */}
              {selectedFacility.facility_type === 'police' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-blue-50/80 p-2.5 rounded border border-blue-200 flex flex-col gap-1 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">執法機關</span>
                      <span className="font-bold text-blue-900 bg-blue-100/80 px-1.5 py-0.5 rounded">
                        {selectedFacility.properties.operator || 'Vancouver Police Department (VPD)'}
                      </span>
                    </div>
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-blue-100">
                        <span>設施地址</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[170px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.opening_hours && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>開放時間</span>
                        <span className="font-medium text-emerald-800 text-right">
                          {selectedFacility.properties.opening_hours}
                        </span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.phone && (
                    <div className="bg-gray-50 p-2 rounded border border-gray-100 flex justify-between items-center text-[11px]">
                      <span className="text-gray-500">聯絡專線</span>
                      <a href={`tel:${selectedFacility.properties.phone.split(' ')[0]}`} className="font-bold text-blue-600 hover:underline">
                        📞 {selectedFacility.properties.phone}
                      </a>
                    </div>
                  )}

                  <div className="bg-amber-50/80 p-2 rounded border border-amber-200 text-[11px] text-amber-900">
                    <span className="font-bold block mb-0.5">🚨 報案指引：</span>
                    <span>重大緊急危難請即刻撥打 <strong>911</strong>；非緊急報案請撥 <strong>604-717-3321</strong>。</span>
                  </div>

                  {selectedFacility.properties.website && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 VPD 溫哥華警察局官網 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Disaster Support Hubs (災害支援中心 - 海嘯與地震避難集合點) Details */}
              {selectedFacility.facility_type === 'disaster_hubs' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-50/90 p-2.5 rounded-lg border border-amber-200 flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                        <span>🛟</span>
                        <span>官方災害支援中心</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white">
                        Disaster Hub
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold text-amber-900 pt-1 border-t border-amber-200/60">
                      {selectedFacility.properties.purpose || '海嘯與地震緊急集合點 (Disaster Support Hub)'}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1 text-[11px]">
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>中心地址</span>
                        <span className="font-semibold text-gray-800 text-right truncate max-w-[170px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.phone && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>聯絡電話</span>
                        <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-blue-600 hover:underline">
                          📞 {selectedFacility.properties.phone}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 p-2 rounded text-[11px] text-gray-600 border border-gray-100 leading-relaxed">
                    <span className="font-semibold block mb-0.5 text-gray-700">📍 功能說明：</span>
                    <span>重大災害（如大地震、海嘯）發生後，市民集結互助、協調支援、領取緊急救援資訊與物資之官方指定避難集合中心。</span>
                  </div>

                  <div className="pt-1 border-t border-gray-100 flex flex-col gap-1">
                    <a
                      href="https://vancouver.ca/home-property-development/disaster-support-hubs.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium text-[11px] transition-colors text-center"
                    >
                      查看溫哥華市政府災害中心專頁 ↗
                    </a>
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
                    <div className="py-7 px-3 flex flex-col items-center justify-center bg-slate-900/95 rounded-lg border border-cyan-500/30 text-gray-200 gap-2.5 shadow-inner">
                      <div className="relative flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-cyan-500/30 rounded-full"></div>
                        <div className="absolute w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs">📷</span>
                      </div>
                      <div className="flex flex-col items-center gap-1 text-center">
                        <span className="text-[11px] font-bold text-cyan-300 tracking-wide">
                          正在從溫哥華交通局 API 載入即時路況圖片...
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {webcamImages.length > 0
                            ? `已預載 ${webcamLoadedCount} / ${webcamImages.length} 個方向鏡頭畫面`
                            : '正在連線取得多角度路口監視器訊號，請稍候'}
                        </span>
                      </div>
                      {webcamImages.length > 0 && (
                        <div className="w-40 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                            style={{ width: `${Math.max(15, Math.round((webcamLoadedCount / webcamImages.length) * 100))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ) : webcamImages.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {webcamImages.map((img, idx) => {
                        const hourlyTimestamp = Math.floor(Date.now() / 3600000);
                        const apiUrl = getApiUrl();
                        const proxySrc = `${apiUrl}/api/webcam/proxy?url=${encodeURIComponent(img.url)}&t=${hourlyTimestamp}_${webcamRefreshKey}`;
                        const directSrc = `${img.url}?t=${hourlyTimestamp}_${webcamRefreshKey}`;
                        const isImgReady = webcamImgReadyMap[idx];
                        return (
                          <div key={idx} className="relative rounded overflow-hidden border border-gray-200 bg-slate-900 aspect-[4/3] group shadow-sm">
                            {!isImgReady && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-cyan-400 gap-1 z-10">
                                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-[9px] text-gray-400">載入圖片中...</span>
                              </div>
                            )}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={proxySrc}
                              alt={img.alt || img.direction}
                              referrerPolicy="no-referrer"
                              className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
                                isImgReady ? 'opacity-100' : 'opacity-0'
                              }`}
                              onLoad={() => {
                                setWebcamImgReadyMap(prev => ({ ...prev, [idx]: true }));
                              }}
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (target.src !== directSrc) {
                                  target.src = directSrc;
                                } else {
                                  setWebcamImgReadyMap(prev => ({ ...prev, [idx]: true }));
                                }
                              }}
                            />
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1 pt-3 text-[10px] font-medium text-white truncate text-center z-20">
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

              {/* Hospitals, UPCC & Rehab Centre Details & Live Wait Times */}
              {selectedFacility.facility_type === 'hospitals' && (() => {
                const isUPCC = selectedFacility.properties?.medical_type === 'upcc';
                const isRehab = selectedFacility.properties?.medical_type === 'rehab' || selectedFacility.properties?.has_wait_time === false || selectedFacility.properties?.emergency === 'no';
                const normalizeStr = (s: string) => (s || '').toLowerCase().replace(/[\u2018\u2019`]/g, "'").trim();
                const hName = normalizeStr(selectedFacility.name || '');
                const erKey = normalizeStr(selectedFacility.properties?.erstat_name || '');
                const shortKey = normalizeStr(selectedFacility.properties?.short_name || '');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let waitInfo: any = hospitalWaitTimes[hName] || hospitalWaitTimes[erKey] || hospitalWaitTimes[shortKey];
                if (!waitInfo && !isRehab) {
                  for (const [k, v] of Object.entries(hospitalWaitTimes)) {
                    const normK = normalizeStr(k);
                    if (hName.includes(normK) || normK.includes(hName) || (erKey && normK.includes(erKey))) {
                      waitInfo = v;
                      break;
                    }
                  }
                }

                const waitTime = waitInfo?.wait_time || '--';
                const elosTime = waitInfo?.elos_time || null;
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
                    {/* Facility Type Badge */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isRehab
                          ? 'bg-teal-100 text-teal-800 border border-teal-300'
                          : isUPCC
                          ? 'bg-cyan-100 text-cyan-800 border border-cyan-300'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      }`}>
                        {selectedFacility.properties?.type_label || (isRehab ? '專科復健中心 (Rehabilitation Centre)' : isUPCC ? '急症基層醫療中心 (UPCC)' : '急症綜合醫院')}
                      </span>
                      {selectedFacility.properties?.short_name && (
                        <span className="text-[10px] font-mono text-gray-500 font-bold">
                          {selectedFacility.properties.short_name}
                        </span>
                      )}
                    </div>

                    {/* Live ER/UPCC Wait Time Card OR Rehab Facility Notice */}
                    {isRehab ? (
                      <div className="p-2.5 rounded-lg border bg-teal-50/90 border-teal-200 text-teal-950 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs flex items-center gap-1.5">
                            <span>🏥</span>
                            <span>專科復健與長者照護醫院</span>
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-700 text-white">
                            非急診機構
                          </span>
                        </div>
                        <div className="text-[11px] text-teal-800 pt-1 border-t border-teal-200/60 leading-relaxed">
                          此院區主要提供<strong>住院物理/職能復健服務</strong>及<strong>長期照護</strong>，未設急診室（edwaittimes.ca 無等候時間數據）。
                        </div>
                      </div>
                    ) : (
                      <div className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${statusBg}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs flex items-center gap-1.5">
                            <span>⏱️</span>
                            <span>{isUPCC ? '門診預估等候時間' : '急診預估等候時間'}</span>
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
                          <span className="text-[10px] text-gray-600 font-medium">
                            {isPredicted ? '（模型預估）' : '（edwaittimes.ca 即時數據）'}
                          </span>
                        </div>

                        {elosTime && !loadingWaitTimes && (
                          <div className="flex items-center justify-between text-[10.5px] pt-1 border-t border-black/5 opacity-90">
                            <span>預估總停留時間 (Length of Stay)</span>
                            <span className="font-bold font-mono">{elosTime}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Hospital / UPCC / Rehab Info Card */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties?.chinese_name && (
                        <div className="flex justify-between items-center text-gray-700 font-semibold">
                          <span>中文名稱</span>
                          <span className="text-gray-900">{selectedFacility.properties.chinese_name}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.services && (
                        <div className="flex justify-between items-start text-gray-600 gap-2">
                          <span className="shrink-0">主要服務</span>
                          <span className="font-medium text-teal-800 text-right">{selectedFacility.properties.services}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.hours && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>{isRehab ? '服務時間' : isUPCC ? '門診服務時間' : '急診門診時間'}</span>
                          <span className="font-medium text-emerald-700 text-right">{selectedFacility.properties.hours}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.address && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>機構地址</span>
                          <span className="font-medium text-gray-800 text-right truncate max-w-[175px]">
                            {selectedFacility.properties.address}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties?.phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
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
                    <div className="flex flex-col gap-1.5 pt-1 border-t border-gray-100">
                      {!isRehab && (
                        <a
                          href="https://www.edwaittimes.ca"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 edwaittimes.ca 查看即時等候時間 ↗
                        </a>
                      )}
                      
                      {selectedFacility.properties?.website && (
                        <a
                          href={selectedFacility.properties.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium text-[11px] transition-colors text-center"
                        >
                          {isRehab ? '前往復健中心官方網站 ↗' : isUPCC ? '前往醫療中心官方網站 ↗' : '前往醫院官方網站 ↗'}
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

              {/* AED (自動體外心臟去顫器) Details */}
              {selectedFacility.facility_type === 'aed' && (() => {
                const facName = selectedFacility.properties?.FACILITY_NAME || selectedFacility.name;
                const addr = selectedFacility.properties?.ADDRESS || selectedFacility.properties?.address;
                const locDesc = selectedFacility.properties?.LOCATION_DESCRIPTION || selectedFacility.properties?.location_description;
                const objId = selectedFacility.properties?.OBJECTID ?? selectedFacility.properties?.object_id;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-red-50/90 p-2.5 rounded-lg border border-red-200 flex flex-col gap-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-red-950 flex items-center gap-1.5">
                          <span>⚡</span>
                          <span>AED 自動體外心臟去顫器</span>
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">
                          {objId != null ? `#${objId}` : 'BC PAD'}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-red-800 pt-1 border-t border-red-200/60">
                        心臟驟停急救設備 · 溫哥華公共場所配置
                      </div>
                    </div>

                    {locDesc && (
                      <div className="bg-amber-50/90 p-2.5 rounded-lg border border-amber-200 text-[11px] flex flex-col gap-1">
                        <span className="font-bold text-amber-900 flex items-center gap-1">
                          <span>📍</span>
                          <span>詳細擺放位置 (Location Details)</span>
                        </span>
                        <span className="font-semibold text-gray-900 leading-relaxed break-words">
                          {locDesc}
                        </span>
                      </div>
                    )}

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-start text-gray-600 gap-2">
                        <span className="shrink-0">設置場所</span>
                        <span className="font-bold text-gray-900 text-right max-w-[180px] break-words">
                          {facName}
                        </span>
                      </div>
                      {addr && (
                        <div className="flex justify-between items-start text-gray-600 gap-2 pt-1 border-t border-gray-100">
                          <span className="shrink-0">所在地址</span>
                          <span className="font-semibold text-gray-800 text-right max-w-[180px] break-words">
                            {addr}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.municipality && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>所屬轄區</span>
                          <span className="font-medium text-gray-700">{selectedFacility.properties.municipality}</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-rose-50 p-2 rounded text-[11px] text-rose-900 border border-rose-100 leading-relaxed">
                      <span className="font-bold block mb-0.5">⚠️ 急救重要提示：</span>
                      <span>若發現疑似心臟驟停患者，請<strong>立即撥打 911</strong>，同時派人取用此處 AED 依照語音指引施救。</span>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-1 border-t border-gray-100">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white rounded font-medium text-xs transition-colors shadow-sm gap-1"
                      >
                        <span>🗺️</span>
                        <span>Google Map 導航至此 AED 位置 ↗</span>
                      </a>
                      <a
                        href="https://bcpadprogram.ca/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium text-[11px] transition-colors"
                      >
                        前往 BC PAD 心臟去顫器登記計畫 ↗
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Contours (等高線) Details */}
              {selectedFacility.facility_type === 'contours' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-teal-50/90 p-2.5 rounded border border-teal-200 flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-teal-950 flex items-center gap-1.5">
                        <span>⛰️</span>
                        <span>溫哥華地形等高線</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-700 text-white">
                        10m Contours
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline pt-1 border-t border-teal-200/60">
                      <span className="text-gray-600 text-[11px]">海平面標高 (Elevation)</span>
                      <span className="font-black text-teal-900 text-lg">
                        {selectedFacility.properties.elevation != null ? `${selectedFacility.properties.elevation} m` : selectedFacility.name}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1 text-[11px] text-gray-600">
                    <div className="flex justify-between items-center">
                      <span>資料來源</span>
                      <span className="font-medium text-gray-800">City of Vancouver Open Data</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>等高線間隔</span>
                      <span className="font-medium text-gray-800">10 公尺 (10-metre intervals)</span>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href="https://opendata.vancouver.ca/explore/dataset/elevation-contours/information/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-teal-700 hover:bg-teal-800 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      查看溫哥華開放資料等高線圖資 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Gas Station (Fuel) Details */}
              {selectedFacility.facility_type === 'fuel' && (
                <div className="flex flex-col gap-2.5 text-xs">
                  {/* Brand & Address Header Card */}
                  <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                        <span className="text-base">⛽</span>
                        <span>{selectedFacility.properties.brand || selectedFacility.name || '溫哥華加油站'}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white">
                        {selectedFacility.properties.opening_hours || '24/7'}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-700 flex items-center gap-1">
                      <span className="text-gray-400">📍</span>
                      <span className="truncate">{selectedFacility.properties.address || selectedFacility.local_area || '溫哥華市區'}</span>
                    </div>
                    {userDistanceToFuel ? (
                      <div className="flex items-center justify-between pt-1 border-t border-amber-500/20 text-[11px]">
                        <span className="text-gray-500">離個人設定位置</span>
                        <span className="font-bold text-amber-700">約 {userDistanceToFuel}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1 border-t border-amber-500/20 text-[10.5px] text-gray-400">
                        <span>離個人位置</span>
                        <span>可在右上角「⚙️ 設定」中輸入地址</span>
                      </div>
                    )}
                  </div>

                  {/* Gas Prices Grid */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>即時參考油價 (加分/公升 ¢/L)</span>
                      <span className="text-[9.5px] text-amber-700/80 font-mono bg-amber-50 px-1 py-0.5 rounded">GasBuddy · BC</span>
                    </div>

                    {loadingFuelPrices ? (
                      <div className="py-4 text-center text-gray-400 text-xs flex items-center justify-center gap-1.5 bg-gray-50 rounded border border-gray-100">
                        <span className="animate-spin text-sm">⏳</span>
                        <span>正在載入最新油價...</span>
                      </div>
                    ) : fuelStationPrices ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-gradient-to-br from-amber-50 to-orange-50/40 p-2 rounded border border-amber-200/80 flex flex-col">
                          <span className="text-[10px] text-gray-500 font-medium">Regular 87 (無鉛)</span>
                          <span className="text-base font-black text-amber-900 mt-0.5">
                            {fuelStationPrices.regular.toFixed(1)} <span className="text-[10px] font-normal text-gray-600">¢</span>
                          </span>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                          <span className="text-[10px] text-gray-500 font-medium">Midgrade 89 (中級)</span>
                          <span className="text-base font-black text-gray-800 mt-0.5">
                            {fuelStationPrices.midgrade.toFixed(1)} <span className="text-[10px] font-normal text-gray-600">¢</span>
                          </span>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                          <span className="text-[10px] text-gray-500 font-medium">Premium 91 (高級)</span>
                          <span className="text-base font-black text-gray-800 mt-0.5">
                            {fuelStationPrices.premium.toFixed(1)} <span className="text-[10px] font-normal text-gray-600">¢</span>
                          </span>
                        </div>
                        <div className="bg-slate-50 p-2 rounded border border-slate-200/80 flex flex-col">
                          <span className="text-[10px] text-slate-500 font-medium">Diesel (柴油)</span>
                          <span className="text-base font-black text-slate-800 mt-0.5">
                            {fuelStationPrices.diesel.toFixed(1)} <span className="text-[10px] font-normal text-gray-600">¢</span>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 text-center text-gray-400 text-xs bg-gray-50 rounded border border-gray-100">
                        暫無油價資料
                      </div>
                    )}
                  </div>

                  {/* Actions: Navigation & Compare in Explore */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center py-1.5 px-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors shadow-sm gap-1"
                    >
                      <span>🗺️</span>
                      <span>Google 導航</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setExploreOpen(true)}
                      className="inline-flex items-center justify-center py-1.5 px-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-medium text-xs transition-colors border border-gray-200 gap-1"
                    >
                      <span>🧭</span>
                      <span>探索比價</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tesla Supercharger & Service Center Details */}
              {selectedFacility.facility_type === 'tesla' && (
                <div className="flex flex-col gap-2.5 text-xs">
                  {/* Category Banner */}
                  <div className="bg-red-500/10 p-2.5 rounded-lg border border-red-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-red-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-red-600 font-bold">⚡</span>
                        <span>{selectedFacility.properties.name || 'Tesla 站點'}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white shrink-0">
                        {selectedFacility.properties.sub_type === 'supercharger' ? '超級充電' : selectedFacility.properties.sub_type === 'destination_charger' ? '目的地充電' : selectedFacility.properties.sub_type === 'center' ? '體驗/服務中心' : '移動服務'}
                      </span>
                    </div>
                    {selectedFacility.properties.address && (
                      <div className="text-[11px] text-gray-700 flex items-center gap-1">
                        <span className="text-gray-400">📍</span>
                        <span className="truncate">{selectedFacility.properties.address}</span>
                      </div>
                    )}
                  </div>

                  {/* Charging Specifications */}
                  {(selectedFacility.properties.power_kw > 0 || selectedFacility.properties.stalls > 0) && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">充電規格</span>
                        <span className="text-sm font-bold text-red-600 mt-0.5">
                          {selectedFacility.properties.power_kw ? `${selectedFacility.properties.power_kw} kW` : '原廠技術'}
                        </span>
                        <span className="text-[10px] text-gray-400 truncate">
                          {selectedFacility.properties.charging_speed || (selectedFacility.properties.sub_type === 'destination_charger' ? 'Level 2 AC' : '超級充電')}
                        </span>
                      </div>
                      <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">充電樁 / 車位</span>
                        <span className="text-sm font-bold text-gray-800 mt-0.5">
                          {selectedFacility.properties.stalls != null && selectedFacility.properties.stalls > 0 ? `${selectedFacility.properties.stalls} 個車位` : '原廠工位'}
                        </span>
                        <span className="text-[10px] text-gray-400 truncate">
                          {selectedFacility.properties.access_type || '公眾開放'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Access & Compatibility */}
                  {selectedFacility.properties.charging_access && (
                    <div className="flex justify-between items-center text-gray-600 bg-gray-50 px-2 py-1.5 rounded border border-gray-100">
                      <span className="shrink-0 text-gray-500">適用車型</span>
                      <span className="font-semibold text-gray-800 text-right truncate max-w-[190px]">
                        {selectedFacility.properties.charging_access}
                      </span>
                    </div>
                  )}

                  {/* Hours */}
                  {selectedFacility.properties.hours && (
                    <div className="flex justify-between items-center text-gray-600 px-1">
                      <span className="shrink-0 text-gray-500">開放時間</span>
                      <span className="font-medium text-gray-800 text-right">
                        {selectedFacility.properties.hours}
                      </span>
                    </div>
                  )}

                  {/* Phone */}
                  {selectedFacility.properties.phone && (
                    <div className="flex justify-between items-center text-gray-600 px-1">
                      <span className="shrink-0 text-gray-500">服務中心電話</span>
                      <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-blue-600 hover:underline">
                        {selectedFacility.properties.phone}
                      </a>
                    </div>
                  )}

                  {/* Services List (for Vancouver-Raymur center) */}
                  {selectedFacility.properties.services && Array.isArray(selectedFacility.properties.services) && selectedFacility.properties.services.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1.5 border-t border-gray-100">
                      <span className="text-gray-500 text-[11px] font-medium">站點提供服務：</span>
                      <div className="flex flex-col gap-1">
                        {selectedFacility.properties.services.map((svc: string, sIdx: number) => (
                          <div key={sIdx} className="flex items-center gap-1.5 text-[11px] text-gray-700 bg-red-50/60 px-2 py-1 rounded border border-red-100/60">
                            <span className="text-red-500 text-[10px]">●</span>
                            <span>{svc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {selectedFacility.properties.notes && (
                    <div className="text-[11px] text-gray-600 bg-amber-50 p-2 rounded border border-amber-200/60">
                      💡 {selectedFacility.properties.notes}
                    </div>
                  )}
                </div>
              )}

              {/* Marine Terminals (港口碼頭) Details */}
              {selectedFacility.facility_type === 'marine_terminals' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-950 text-xs flex items-center gap-1.5">
                        <span className="text-sm text-cyan-600 font-bold">⚓</span>
                        <span>{selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-700 text-white shrink-0">
                        {selectedFacility.properties.terminal_type?.split('(')[0]?.trim() || '深水碼頭'}
                      </span>
                    </div>
                    {selectedFacility.properties.waterway && (
                      <div className="text-[11px] text-cyan-900 font-medium">
                        🌊 水域位置：{selectedFacility.properties.waterway}
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.operator && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>營運單位</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.operator}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.cargo && (
                      <div className="flex justify-between items-start text-gray-600 pt-1 border-t border-gray-100">
                        <span className="shrink-0">主要貨類</span>
                        <span className="font-semibold text-gray-800 text-right max-w-[190px]">
                          {selectedFacility.properties.cargo}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.berths || selectedFacility.properties.draught) && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>泊位與水深</span>
                        <span className="font-mono text-cyan-800 font-semibold text-right">
                          {selectedFacility.properties.berths || ''} {selectedFacility.properties.draught ? `(吃水 ${selectedFacility.properties.draught})` : ''}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.capacity && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>年處理能力</span>
                        <span className="font-medium text-emerald-700 text-right">
                          {selectedFacility.properties.capacity}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-500 text-[10.5px] pt-1 border-t border-gray-100">
                        <span>碼頭地址</span>
                        <span className="text-gray-700 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* One-Way Streets (單程路) Details */}
              {selectedFacility.facility_type === 'one_way_streets' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-amber-600 font-bold">➡️</span>
                        <span>{selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white shrink-0">
                        單程管制
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-900 font-medium">
                      ⚠️ 單向行車路段，請依地面標線與箭頭方向行駛
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.hblock && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>街區路段</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.hblock}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.streetuse && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>道路等級分類</span>
                        <span className="font-semibold text-gray-800 text-right">
                          {selectedFacility.properties.streetuse}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Snow Removal Routes (鏟雪路線) Details */}
              {selectedFacility.facility_type === 'snow_removal_routes' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-sky-600 font-bold">❄️</span>
                        <span className="truncate max-w-[200px]">{selectedFacility.name}</span>
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0 ${
                        selectedFacility.properties.priority === 1 ? 'bg-sky-700' : 'bg-sky-600'
                      }`}>
                        {selectedFacility.properties.priority === 1 ? '第 1 優先' : '第 2 優先'}
                      </span>
                    </div>
                    <div className="text-[11px] text-sky-900 font-medium">
                      {selectedFacility.properties.priority === 1 
                        ? '🚛 市府第 1 優先清掃主要幹道與急救動線' 
                        : '🚜 市府第 2 優先清掃重要陡坡、學校及主要單車道'}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.route_type_zh && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>路線屬性</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.route_type_zh}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.priority_zh && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>優先級別</span>
                        <span className="font-semibold text-gray-800 text-right">
                          {selectedFacility.properties.priority_zh}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.length_display || selectedFacility.properties.shape_length) && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>路段長度</span>
                        <span className="font-mono text-gray-800 text-right">
                          {selectedFacility.properties.length_display || `${Math.round(selectedFacility.properties.shape_length)} 公尺`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Water Distribution Mains (自來水管道) Details */}
              {selectedFacility.facility_type === 'water_distribution_mains' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-sky-600 font-bold">💧</span>
                        <span>自來水主管道</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white shrink-0">
                        {selectedFacility.properties.diameter_mm ? `${selectedFacility.properties.diameter_mm} mm` : '供水管網'}
                      </span>
                    </div>
                    <div className="text-[11px] text-sky-900 font-medium">
                      🚰 溫哥華市政自來水輸送與配水主管網
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.diameter_mm && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>管道管徑 (Diameter)</span>
                        <span className="font-bold text-gray-900 font-mono">
                          {selectedFacility.properties.diameter_mm} mm
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.material && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>管材材質 (Material)</span>
                        <span className="font-semibold text-gray-800">
                          {selectedFacility.properties.material}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.lining_material && selectedFacility.properties.lining_material !== 'blank' && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>內襯材料 (Lining)</span>
                        <span className="font-medium text-gray-800">
                          {selectedFacility.properties.lining_material}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.installation_date && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>鋪設安裝年份</span>
                        <span className="font-mono text-gray-700">
                          {selectedFacility.properties.installation_date}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sewer Mains (污水管道) Details */}
              {selectedFacility.facility_type === 'sewer_mains' && (() => {
                const effluent = selectedFacility.properties.effluent_type || 'Sewer';
                const effluentZh = 
                  effluent === 'Storm' ? '雨水排放管網 (Storm)' :
                  effluent === 'Sanitary' ? '生活污水管網 (Sanitary)' :
                  effluent === 'Combined' ? '合流下水道 (Combined)' : effluent;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/25 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                          <span className="text-base text-teal-600 font-bold">🌊</span>
                          <span>市政下水道管線</span>
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">
                          {effluent}
                        </span>
                      </div>
                      <div className="text-[11px] text-teal-900 font-medium">
                        🌀 {effluentZh}
                      </div>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties.street_name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>所在街道</span>
                          <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                            {selectedFacility.properties.street_name}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>下水道排水類型</span>
                        <span className="font-bold text-teal-900">
                          {effluentZh}
                        </span>
                      </div>
                      {selectedFacility.properties.diameter_mm && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>管徑規格 (Diameter)</span>
                          <span className="font-mono font-bold text-teal-800">
                            {selectedFacility.properties.diameter_mm} mm
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.material && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>管道結構材質</span>
                          <span className="font-semibold text-gray-800">
                            {selectedFacility.properties.material}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.pipe_use && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>管線功能用途</span>
                          <span className="font-medium text-gray-800">
                            {selectedFacility.properties.pipe_use}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.service_status && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>管線營運狀態</span>
                          <span className={`font-semibold ${selectedFacility.properties.service_status.includes('Abandoned') ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {selectedFacility.properties.service_status}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.install_date && (
                        <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                          <span>建造鋪設年份</span>
                          <span className="font-mono text-gray-700">
                            {selectedFacility.properties.install_date}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Traffic Speed Limits (限速路段) Details */}
              {selectedFacility.facility_type === 'traffic_speed_limits' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-amber-600 font-bold">⏱️</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.properties.hblock || selectedFacility.name}</span>
                      </span>
                      <span className="text-xs font-black px-2 py-0.5 rounded bg-amber-600 text-white shrink-0 tracking-wide">
                        {selectedFacility.properties.speed_limit || '30'} km/h
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-900 font-medium">
                      ⚠️ 本路段道路速限為 {selectedFacility.properties.speed_limit || '30'} 公里/小時，請小心駕駛
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.hblock && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>街區門牌 (Block)</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.hblock}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.segment_type && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>路段屬性 (Zone Type)</span>
                        <span className="font-semibold text-gray-800 text-right">
                          {selectedFacility.properties.segment_type === 'Residential' ? '住宅區 (Residential)' : selectedFacility.properties.segment_type}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bike Racks (單車架) Details */}
              {selectedFacility.facility_type === 'bike_racks' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-teal-600 font-bold">🚲</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.properties.location || selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">
                        {selectedFacility.properties.num_racks ? `${selectedFacility.properties.num_racks} 組車架` : '公用單車架'}
                      </span>
                    </div>
                    <div className="text-[11px] text-teal-900 font-medium">
                      🚲 溫哥華市政公共自行車停放設施
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.location && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>設置地點</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.location}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.num_racks && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>單車架數量</span>
                        <span className="font-bold text-teal-700">
                          {selectedFacility.properties.num_racks} 組
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.rack_type && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>車架規格款式</span>
                        <span className="font-medium text-gray-800">
                          {selectedFacility.properties.rack_type}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.status && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>設施狀態</span>
                        <span className="font-semibold text-gray-800">
                          {selectedFacility.properties.status === 'Active' ? '使用中 (Active)' : selectedFacility.properties.status}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.year_installed && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>安裝年份</span>
                        <span className="font-mono text-gray-700">
                          {selectedFacility.properties.year_installed} 年
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Postal Code FSA (郵遞編號分區) Details */}
              {selectedFacility.facility_type === 'postal_code_fsa' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-indigo-500/10 p-2.5 rounded-lg border border-indigo-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-indigo-600 font-bold">📮</span>
                        <span>郵遞前瞻轉運區 (FSA)</span>
                      </span>
                      <span className="text-sm font-black px-2 py-0.5 rounded bg-indigo-600 text-white shrink-0 tracking-wider font-mono">
                        {selectedFacility.properties.fsa}
                      </span>
                    </div>
                    <div className="text-[11px] text-indigo-900 font-medium">
                      🇨🇦 加拿大郵政前瞻性排序區 (Forward Sortation Area)
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>郵遞區號字首 (FSA Code)</span>
                      <span className="font-mono font-bold text-indigo-700 text-sm">
                        {selectedFacility.properties.fsa}
                      </span>
                    </div>
                    {selectedFacility.properties.province && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>所屬省份</span>
                        <span className="font-medium text-gray-800">
                          {selectedFacility.properties.province}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Wireless Facilities (無線設施) Details */}
              {selectedFacility.facility_type === 'wireless_facilities' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-purple-600 font-bold">📡</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.properties.company || '電信運營商'}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-600 text-white shrink-0">
                        {selectedFacility.properties.facility_type_label || '基地台'}
                      </span>
                    </div>
                    <div className="text-[11px] text-purple-900 font-medium">
                      📶 {selectedFacility.name}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.company && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>營運電信商 (Carrier)</span>
                        <span className="font-bold text-purple-900">
                          {selectedFacility.properties.company}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.pole_number && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>附掛燈桿編號 (Pole)</span>
                        <span className="font-mono font-medium text-gray-800 text-right truncate max-w-[180px]">
                          {selectedFacility.properties.pole_number}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.map_id && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>站點代碼 (Site ID)</span>
                        <span className="font-mono text-gray-800">
                          {selectedFacility.properties.map_id}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.status && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>安裝附掛狀態</span>
                        <span className="font-semibold text-emerald-700">
                          {selectedFacility.properties.status}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.attachment_location && (
                      <div className="flex flex-col gap-0.5 pt-1 border-t border-gray-100 text-gray-600">
                        <span>附掛安裝細節:</span>
                        <span className="text-gray-800 text-[10px] leading-tight bg-white p-1 rounded border border-gray-100">
                          {selectedFacility.properties.attachment_location}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.contact_info && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>聯絡服務電話</span>
                        <a href={`tel:${selectedFacility.properties.contact_info}`} className="text-purple-600 hover:underline font-mono">
                          {selectedFacility.properties.contact_info}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Traffic Crosswalks (斑馬線) Details */}
              {selectedFacility.facility_type === 'traffic_crosswalks' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-yellow-500/10 p-2.5 rounded-lg border border-yellow-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-yellow-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-yellow-600 font-bold">🚶</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.properties.location || selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500 text-gray-900 shrink-0">
                        行人斑馬線
                      </span>
                    </div>
                    <div className="text-[11px] text-yellow-900 font-medium">
                      🚶 溫哥華市區交通行人穿越安全設施 (Traffic Crosswalk)
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.location && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>路口 / 位置</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.location}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.object_id && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>設施編號 (ID)</span>
                        <span className="font-mono text-gray-700">
                          #{selectedFacility.properties.object_id}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Litter Containers (垃圾箱) Details */}
              {selectedFacility.facility_type === 'litter_containers' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-amber-600 font-bold">🗑️</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.properties.address || selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white shrink-0">
                        {selectedFacility.properties.capacity ? `${selectedFacility.properties.capacity}L 垃圾箱` : '公用垃圾箱'}
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-900 font-medium">
                      🗑️ 溫哥華市政公共垃圾收集設施
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.address && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>放置地址</span>
                        <span className="font-bold text-gray-900 text-right truncate max-w-[190px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.model_type && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>垃圾箱型號</span>
                        <span className="font-medium text-gray-800">
                          {selectedFacility.properties.model_type}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.capacity && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>容量規格</span>
                        <span className="font-bold text-amber-700">
                          {selectedFacility.properties.capacity} 公升 (L)
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.service_status && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>服務運作狀態</span>
                        <span className="font-semibold text-emerald-700">
                          {selectedFacility.properties.service_status}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.owner && (
                      <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                        <span>管理所屬單位</span>
                        <span className="text-gray-700">
                          {selectedFacility.properties.owner}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Local Area Boundary (區域邊界) Details */}
              {selectedFacility.facility_type === 'local_area_boundary' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/25 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-teal-600 font-bold">📍</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">
                        區域邊界
                      </span>
                    </div>
                    <div className="text-[11px] text-teal-900 font-medium">
                      🗺️ 溫哥華官方劃定社區分區 (Local Area Boundary)
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>分區名稱</span>
                      <span className="font-bold text-gray-900">
                        {selectedFacility.name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1 border-t border-gray-100">
                      <span>中心座標</span>
                      <span className="font-mono text-gray-700">
                        {selectedFacility.lat.toFixed(4)}, {selectedFacility.lon.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Popup>
        )}

      </Map>

      {/* 密集圖層（管道/單車架/斑馬線等）放大檢視提示 Toast (Zoom-in prompt for dense network layers) */}
      {zoomNotification?.show && (
        <div className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[60] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl px-4 py-2.5 shadow-[0_10px_35px_rgba(0,0,0,0.6)] border border-sky-500/50 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 select-none max-w-[calc(100vw-32px)] ring-1 ring-sky-400/20">
          <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0 animate-pulse">
            <ZoomIn className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0 pr-1">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>{zoomNotification.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium">建議放大檢視</span>
            </div>
            <div className="text-[11px] text-gray-300 mt-0.5 line-clamp-1">
              {zoomNotification.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              mapRef.current?.flyTo({
                zoom: zoomNotification.targetZoom,
                duration: 900
              });
              setZoomNotification(prev => prev ? { ...prev, show: false } : null);
            }}
            className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-lg transition-all shrink-0 shadow-md flex items-center gap-1 cursor-pointer active:scale-95"
          >
            一鍵放大
          </button>
          <button
            type="button"
            onClick={() => setZoomNotification(prev => prev ? { ...prev, show: false } : null)}
            className="p-1 text-gray-400 hover:text-white rounded-md transition-colors shrink-0 cursor-pointer ml-0.5"
            title="關閉提示"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 重設地圖視角至溫哥華地區按鈕 (Reset Map View to Vancouver) - 精緻控制項樣式避免阻擋地圖或縮放控制 */}
      <div className="absolute bottom-[164px] right-2.5 z-20 select-none">
        <button
          type="button"
          onClick={() => {
            mapRef.current?.flyTo({
              center: [-123.05, 49.25],
              zoom: 11,
              pitch: 0,
              bearing: 0,
              duration: 1200
            });
          }}
          className="group relative flex items-center justify-center w-[29px] h-[29px] bg-[#161922]/95 hover:bg-[#202533] text-gray-200 hover:text-white rounded border border-[#2d3448] shadow-md backdrop-blur-md transition-all hover:border-emerald-500/60 hover:shadow-[0_0_10px_rgba(16,185,129,0.25)] active:scale-95 cursor-pointer"
        >
          <LocateFixed className="w-4 h-4 text-emerald-400 group-hover:rotate-90 transition-transform duration-300 shrink-0" />
          <span className="pointer-events-none absolute right-[36px] top-1/2 -translate-y-1/2 px-2 py-1 bg-[#10131a]/95 text-white text-[11px] font-medium rounded border border-[#262b3a] shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            重設溫哥華視角
          </span>
        </button>
      </div>

      {/* Google Earth 風格固定長度比例圖例 (Google Earth Style Fixed-Width Scale Ruler) - 提高底部間距以防與底圖版權白底甲面重疊 */}
      <div className="absolute bottom-[38px] right-14 z-20 pointer-events-none select-none">
        <div className="flex flex-col items-end">
          <div className="text-right text-[11px] font-sans font-semibold text-white tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] mb-0.5 leading-none select-none">
            {scaleText}
          </div>
          <svg width="120" height="12" viewBox="0 0 120 12" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] overflow-visible">
            {/* 基準橫線 */}
            <line x1="0.5" y1="11" x2="119.5" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            {/* 左端主刻度 */}
            <line x1="0.5" y1="1" x2="0.5" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            {/* 25% 次刻度 */}
            <line x1="30.25" y1="6" x2="30.25" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            {/* 50% 中間刻度 */}
            <line x1="60" y1="4.5" x2="60" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            {/* 75% 次刻度 */}
            <line x1="89.75" y1="6" x2="89.75" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            {/* 右端主刻度 */}
            <line x1="119.5" y1="1" x2="119.5" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
        </div>
      </div>

      {/* 滑鼠即時經緯度座標顯示 (Cursor Latitude & Longitude HUD - 位於地圖下方中央) */}
      {cursorCoords && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none flex items-center gap-2 px-3 py-1 bg-[#10131a]/90 backdrop-blur-md rounded-full border border-[#2a2f3d]/90 shadow-lg text-[11px] font-mono text-gray-200 transition-opacity duration-150">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="tracking-tight text-gray-300">
            {Math.abs(cursorCoords.lat).toFixed(4)}° {cursorCoords.lat >= 0 ? 'N' : 'S'}, {Math.abs(cursorCoords.lng).toFixed(4)}° {cursorCoords.lng >= 0 ? 'E' : 'W'}
          </span>
        </div>
      )}

      {/* 罪案地區圖例卡片 (Crime Rate Legend) */}
      {layers.crimeAreas && (
        <div className="absolute bottom-6 left-4 z-20 bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-[#2a2f3d] select-none max-w-[340px] animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"></span>
              <span className="text-[11px] font-bold text-gray-200">每年每平方公里警方記錄罪案數</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">2026</span>
          </div>

          {/* 5 階色塊指示條 */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <div className="flex flex-col items-center gap-1">
              <div className="w-full h-2.5 rounded-full bg-[#94a3b8] shadow-sm"></div>
              <span className="text-[9px] text-gray-300 whitespace-nowrap">少過10</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-full h-2.5 rounded-full bg-[#2e7d32] shadow-sm"></div>
              <span className="text-[9px] text-gray-300 whitespace-nowrap">10–50</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-full h-2.5 rounded-full bg-[#6ee7b7] shadow-sm"></div>
              <span className="text-[9px] text-gray-300 whitespace-nowrap">50–150</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-full h-2.5 rounded-full bg-[#f59e0b] shadow-sm"></div>
              <span className="text-[9px] text-gray-300 whitespace-nowrap">150–400</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-full h-2.5 rounded-full bg-[#dc2626] shadow-sm"></div>
              <span className="text-[9px] text-gray-300 whitespace-nowrap">400+</span>
            </div>
          </div>

          <div className="text-[10px] text-gray-400 text-center pt-1 border-t border-[#262b38]/80">
            數據只供參考，不構成安全評分標準。
          </div>
        </div>
      )}

      {/* 搜尋路線時若尚未選取車輛，在右上方顯示精簡提示卡 */}
      {searchedBusRoute && !selectedBus && (
        <div className="fixed top-[72px] right-4 z-40 bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl px-4 py-3 shadow-2xl border border-[#2a2f3d] flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-200 select-none max-w-[calc(100vw-32px)]">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>
            </svg>
          </div>
          <div className="min-w-0 pr-1">
            <div className="text-sm font-bold text-white truncate">
              {searchedBusRoute.route_number || searchedBusRoute.route_id} 去 {searchedBusRoute.destination || '終點站'}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 truncate">
              {searchedBusRoute.stops ? `沿途 ${searchedBusRoute.stops.length} 個站點 · ` : ''}
              {displayVehicles.filter(v => 
                String(v.route_id) === String(searchedBusRoute.route_id) || 
                String(v.route_number).toLowerCase() === String(searchedBusRoute.route_number).toLowerCase()
              ).length > 0 
                ? `${displayVehicles.filter(v => 
                    String(v.route_id) === String(searchedBusRoute.route_id) || 
                    String(v.route_number).toLowerCase() === String(searchedBusRoute.route_number).toLowerCase()
                  ).length} 輛在途行駛 · 點選車輛查看動態`
                : '目前暫無在途班次 · 已載入沿線車站'}
            </div>
          </div>
          <button
            onClick={() => {
              setSelectedBus(null);
              setBusDetails(null);
              setSearchedBusRoute(null);
              setSearchTarget(null);
            }}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#252a38] transition-colors ml-1 shrink-0"
            title="關閉路線"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      {/* 點選巴士時固定在右方展示之即時動態資料面板 */}
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
          <div className="fixed top-[72px] right-4 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
            {/* Header */}
            <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
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
                  setSearchedBusRoute(null);
                  setSearchTarget(null);
                }}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#252a38] transition-colors shrink-0"
                title="關閉"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Info Rows */}
            <div className="flex flex-col gap-2 text-xs shrink-0">
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
                      ? `預計 ${formatTimePreference(nextStopTime, timeFormat)} (${nextStopMin !== undefined && nextStopMin !== null ? (nextStopMin <= 0 ? '即將進站' : `${nextStopMin} 分鐘後`) : '行駛中'})`
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
            <div className="mt-3 pt-2.5 border-t border-[#262b38] flex-1 flex flex-col min-h-0">
              <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2 flex-1 flex flex-col min-h-0">
                <div className="text-[11px] text-gray-400 font-medium mb-1.5 px-1 flex items-center justify-between shrink-0">
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
                  <div className="overflow-y-auto flex-1 flex flex-col gap-0.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
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
                              ? `${st.eta_minutes} 分${st.eta_time ? ` (${formatTimePreference(st.eta_time, timeFormat)})` : ''}`
                              : st.eta_time
                              ? formatTimePreference(st.eta_time, timeFormat)
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
        );
      })()}

      {/* 點選天車列車時固定在右方展示之即時動態資料面板 */}
      {selectedTrain && (() => {
        const lineName = selectedTrain.line_name;
        const destName = selectedTrain.destination;
        const originName = selectedTrain.origin;
        const operatorName = selectedTrain.operator;
        const nextStopName = selectedTrain.next_station || '沿線行駛中';
        const nextStopTime = selectedTrain.next_stop_time || '';
        const nextStopMin = selectedTrain.next_stop_minutes;
        const stopList = selectedTrain.stops || [];

        return (
          <div className="fixed top-[72px] right-4 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
            {/* Header */}
            <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
              <div className="flex items-start gap-2.5 min-w-0">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-sm text-white"
                  style={{ backgroundColor: `${selectedTrain.color}33`, borderColor: `${selectedTrain.color}88`, borderWidth: '1px' }}
                >
                  <Train className="w-4 h-4" style={{ color: selectedTrain.color }} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate">
                    {lineName} 去 {destName}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span 
                      className="w-2 h-2 rounded-full animate-pulse shadow-sm"
                      style={{ backgroundColor: selectedTrain.color }}
                    ></span>
                    <span className="text-[11px] font-semibold text-blue-400">即時推算中</span>
                    <span className="text-[10px] text-gray-400 font-mono ml-1">#{selectedTrain.id}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedTrain(null)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#252a38] transition-colors shrink-0"
                title="關閉"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Info Rows */}
            <div className="flex flex-col gap-2 text-xs shrink-0">
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-400 shrink-0">營辦商</span>
                <span className="font-bold text-gray-100 text-right truncate">{operatorName}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-400 shrink-0">列車型號</span>
                <span className="font-bold text-gray-100 text-right truncate">{selectedTrain.model} ({selectedTrain.cars} 卡)</span>
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
                <span className="font-bold text-right truncate" style={{ color: selectedTrain.color }}>
                  開往 {destName} ({selectedTrain.status}{selectedTrain.speed_kmh > 0 ? ` · ${selectedTrain.speed_kmh} km/h` : ''})
                </span>
              </div>
              <div className="flex justify-between items-start gap-2 pt-0.5">
                <span className="text-gray-400 shrink-0 mt-0.5">下一站</span>
                <div className="flex flex-col items-end text-right min-w-0">
                  <span className="font-bold text-white leading-snug">{nextStopName}</span>
                  <span className="text-[11px] font-bold text-amber-400 mt-0.5">
                    {nextStopTime
                      ? `預計 ${formatTimePreference(nextStopTime, timeFormat)} (${nextStopMin <= 0 ? '即將進站' : `${nextStopMin} 分鐘後`})`
                      : '即時運行中'}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-400 shrink-0">運行</span>
                <span className="font-bold text-emerald-400">推算準時</span>
              </div>
            </div>

            {/* Stops List Box */}
            <div className="mt-3 pt-2.5 border-t border-[#262b38] flex-1 flex flex-col min-h-0">
              <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2 flex-1 flex flex-col min-h-0">
                <div className="text-[11px] text-gray-400 font-medium mb-1.5 px-1 flex items-center justify-between shrink-0">
                  <span>{stopList.length} 個站</span>
                  <span className="text-[10px] font-mono truncate max-w-[140px]" style={{ color: selectedTrain.color }}>
                    {selectedTrain.line_name}
                  </span>
                </div>
                <div className="overflow-y-auto flex-1 flex flex-col gap-0.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
                  {stopList.map((st) => {
                    const isNext = st.status === 'next';
                    const isPassed = st.status === 'passed';
                    return (
                      <div
                        key={`train-popup-stop-${st.seq}`}
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
                            : 'text-blue-400/90 font-mono'
                        }`}>
                          {isNext
                            ? '下個站'
                            : isPassed
                            ? '已過站'
                            : st.eta_minutes !== undefined && st.eta_minutes !== null
                            ? `${st.eta_minutes} 分${st.eta_time ? ` (${formatTimePreference(st.eta_time, timeFormat)})` : ''}`
                            : st.eta_time
                            ? formatTimePreference(st.eta_time, timeFormat)
                            : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 點選天車站點時展示之路線班次面板 */}
      {selectedSkytrainStation && (
        <div className="fixed top-[72px] right-4 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
          {/* Header */}
          <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0 mt-0.5 shadow-sm">
                <span className="text-base select-none">🚉</span>
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate">
                  {selectedSkytrainStation.name}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {selectedSkytrainStation.lines.map((ln) => (
                    <span 
                      key={ln}
                      className={`text-[9.5px] font-semibold px-1.5 py-0.2 rounded border ${
                        ln.includes('Expo') ? 'bg-[#0033a0]/30 text-blue-300 border-[#0033a0]/60' :
                        ln.includes('Millennium') ? 'bg-amber-500/20 text-yellow-300 border-amber-500/50' :
                        'bg-teal-500/20 text-teal-300 border-teal-500/50'
                      }`}
                    >
                      {ln}
                    </span>
                  ))}
                  <span className="text-[10px] text-gray-400 font-mono">#{selectedSkytrainStation.stop_id}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedSkytrainStation(null)}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#252a38] transition-colors shrink-0"
              title="關閉"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>

          {/* Subheader info */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 pb-2 mb-2 border-b border-[#262b38]/60 shrink-0">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
              <span>推算班次時刻</span>
            </span>
            <span className="font-mono text-[10px] text-gray-400">
              更新於 {formatTimePreference(selectedSkytrainStation.updated_at, timeFormat)}
            </span>
          </div>

          {/* Schedules Content */}
          <div className="overflow-y-auto flex-1 flex flex-col gap-2.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingStationSchedule ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                <span>載入天車站點班次中...</span>
              </div>
            ) : selectedSkytrainStation.schedules && selectedSkytrainStation.schedules.length > 0 ? (
              selectedSkytrainStation.schedules.map((group, gIdx) => (
                <div 
                  key={`sched-grp-${gIdx}`}
                  className="bg-[#10131a] rounded-lg border border-[#232836] p-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span 
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      ></span>
                      <span className="font-bold text-xs text-white truncate">
                        {group.line_name}
                      </span>
                      <span className="text-[11px] text-gray-300 truncate">
                        往 {group.destination}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {group.departures.map((dep, dIdx) => (
                      <div 
                        key={`dep-${dIdx}`}
                        className={`flex flex-col px-2 py-1.5 rounded border ${
                          dIdx === 0 
                            ? 'bg-blue-950/40 border-blue-500/40 text-blue-200' 
                            : 'bg-[#181d28] border-[#292f3f] text-gray-300'
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className={`text-[12px] font-bold ${dIdx === 0 ? 'text-amber-400' : 'text-gray-100'}`}>
                            {dep.formatted}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {formatTimePreference(dep.time, timeFormat)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836]">
                目前暫無推算班次資料
              </div>
            )}
          </div>
        </div>
      )}

      {/* 系統與 API 初始載入畫面 (API Data & Image Preloading Screen) */}
      {isInitialApiLoading && (
        <div className="fixed inset-0 z-[100] bg-[#0c0e14]/90 backdrop-blur-md flex flex-col items-center justify-center select-none transition-opacity duration-300">
          <div className="bg-[#161922] border border-[#2a2f3d] rounded-2xl p-6 shadow-2xl max-w-[360px] w-[90%] flex flex-col items-center gap-4">
            <div className="relative flex items-center justify-center w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20"></div>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></div>
              <span className="text-2xl">🌐</span>
            </div>

            <div className="flex flex-col items-center gap-1 text-center">
              <h3 className="text-sm font-bold text-white tracking-wide">
                正在載入大溫哥華即時 API 與圖資數據
              </h3>
              <p className="text-xs text-emerald-400 font-medium">
                {apiLoadingText}
              </p>
            </div>

            <div className="w-full flex flex-col gap-1.5">
              <div className="w-full h-2 bg-[#0c0e14] rounded-full overflow-hidden border border-[#252a38]">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-300 rounded-full"
                  style={{ width: `${apiLoadingProgress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono">
                <span>預留額外緩衝時間取得 API 及圖片資源</span>
                <span className="text-emerald-400 font-bold">{apiLoadingProgress}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
