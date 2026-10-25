'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import Map, { NavigationControl, Marker, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl, getWsUrl } from '@/utils/api';
import { formatTimePreference, formatShipEta, formatTimeRange } from '@/utils/time';
import { formatTitleCase } from '@/utils/text';
import { getSkytrainStationMapUrls } from '@/utils/skytrainMaps';
import skytrainStationsData from '@/data/skytrainStations.json';
import { 
  LocateFixed, Train, Compass, ZoomIn, X, Copy, Check, 
  Navigation, ExternalLink, Clock, Bike, Car, Info, 
  ChevronDown, ChevronUp, SlidersHorizontal, Fuel, Zap, Wifi, Waves, Play, Pause, CloudRain,
  RotateCcw, RotateCw, MapPin, Crosshair, Activity, Ban, Cone, Lightbulb, Ship,
  Camera, Gauge, Footprints, ArrowRight, Mail, AlertCircle, Radio, Anchor
} from 'lucide-react';

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
  waypoints?: number[][];
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
  first_last?: {
    weekday?: { first_train?: string; last_train?: string; first?: string; last?: string };
    saturday?: { first_train?: string; last_train?: string; first?: string; last?: string };
    sunday_holiday?: { first_train?: string; last_train?: string; first?: string; last?: string };
  };
  frequencies?: {
    peak?: string;
    midday?: string;
    evening?: string;
    late_night?: string;
  };
  station_map_url?: string;
  entrance_map_url?: string;
  fare_zone?: string;
  has_park_and_ride?: boolean;
  has_bike_parkade?: boolean;
  facilities?: {
    bike_parkade?: boolean;
    park_and_ride?: boolean;
  };
  is_accessible?: boolean;
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

const DOWNTOWN_VANCOUVER_POLY = [
  [-123.1420, 49.2870],
  [-123.1180, 49.2910],
  [-123.1090, 49.2880],
  [-123.0950, 49.2840],
  [-123.1000, 49.2730],
  [-123.1250, 49.2730],
  [-123.1390, 49.2800],
  [-123.1420, 49.2870]
];

function isShipOnLand(lon: number, lat: number): boolean {
  if (!lon || !lat) return false;
  return isPointInPolygon2D(lon, lat, STANLEY_PARK_EXCLUSION_POLY) || isPointInPolygon2D(lon, lat, DOWNTOWN_VANCOUVER_POLY);
}

const HEAVY_LAYERS_CONFIG: Record<string, { label: string; prefixes: string[] }> = {
  bikeRacks: { label: '單車架', prefixes: ['bike-racks'] },
  waterDistributionMains: { label: '自來水管道', prefixes: ['water-distribution-mains'] },
  sewerMains: { label: '污水管道', prefixes: ['sewer-mains'] },
  contours: { label: '等高線', prefixes: ['contours'] },
  snowRemovalRoutes: { label: '鏟雪路線', prefixes: ['snow-removal-routes'] },
  litterContainers: { label: '垃圾箱', prefixes: ['litter-containers'] },
  bikeways: { label: '單車道路網', prefixes: ['bikeways'] },
  parkingMeters: { label: '收費錶', prefixes: ['parking-meters'] },
  streetLighting: { label: '路燈燈柱', prefixes: ['street-lighting-poles', 'street_lighting_poles'] },
  streetLightingConduits: { label: '路燈電網', prefixes: ['street-lighting-conduits', 'street_lighting_conduits', 'street-lighting-glow', 'street-lighting-layer'] },
  beachWaterQuality: { label: '海灘水質', prefixes: ['beach-water', 'beach_water'] },
  fireHydrants: { label: '消防栓', prefixes: ['fire-hydrants', 'fire_hydrants'] },
  zoningDistricts: { label: '土地規劃', prefixes: ['zoning-districts', 'zoning_districts'] },
  publicTrees: { label: '街道樹木', prefixes: ['public-trees', 'public_trees'] },
};

const SKI_RESORT_POINTS = [
  {
    id: 'cypress',
    uid: 425,
    name: '賽普里斯山滑雪場',
    english_name: 'Cypress Mountain',
    area: '西溫哥華 · 賽普里斯省立公園 (West Vancouver)',
    lat: 49.3957,
    lon: -123.2045,
    zoom: 14,
    vertical_drop: '616 m',
    official_url: 'https://cypressmountain.com',
    skiresort_url: 'https://www.skiresort.com/en/ski-resort/cypress-mountain/snow-report/',
    status_zh: '季節休園',
    is_open: false,
    season_range: '12 Dec 2026 - 11 Apr 2027',
    slopes_label: '0 of 51 km of slopes',
    lifts_label: '0 of 7 lifts',
    snow_base: '-',
    snow_top: '-',
    altitude_base: '824 m',
    altitude_top: '1440 m',
    night_skiing: true,
  },
  {
    id: 'grouse',
    uid: 427,
    name: '松雞山滑雪場',
    english_name: 'Grouse Mountain',
    area: '北溫哥華 · 溫哥華之峰 (North Vancouver)',
    lat: 49.3795,
    lon: -123.0825,
    zoom: 14,
    vertical_drop: '400 m',
    official_url: 'https://www.grousemountain.com',
    skiresort_url: 'https://www.skiresort.com/en/ski-resort/grouse-mountain/snow-report/',
    status_zh: '季節休園',
    is_open: false,
    season_range: '19 Nov 2026 - 18 Apr 2027',
    slopes_label: '0 of 33 km of slopes',
    lifts_label: '0 of 5 lifts',
    snow_base: '-',
    snow_top: '-',
    altitude_base: '850 m',
    altitude_top: '1250 m',
    night_skiing: true,
  },
  {
    id: 'seymour',
    uid: 443,
    name: '西摩山滑雪場',
    english_name: 'Mount Seymour',
    area: '北溫哥華 · 西摩山省立公園 (North Vancouver)',
    lat: 49.3672,
    lon: -122.9486,
    zoom: 14,
    vertical_drop: '330 m',
    official_url: 'https://mtseymour.ca',
    skiresort_url: 'https://www.skiresort.com/en/ski-resort/mount-seymour/snow-report/',
    status_zh: '季節休園',
    is_open: false,
    season_range: '10 Dec 2026 - 11 Apr 2027',
    slopes_label: '0 of 23 km of slopes',
    lifts_label: '0 of 5 lifts',
    snow_base: '-',
    snow_top: '-',
    altitude_base: '935 m',
    altitude_top: '1265 m',
    night_skiing: true,
  }
];

const BORDER_CROSSING_POINTS = [
  {
    id: "peace_arch",
    name: "和平門關卡 (Peace Arch / Douglas)",
    english_name: "Peace Arch / Douglas Crossing",
    highway: "BC Hwy 99 ↔ US I-5",
    lat: 49.0022,
    lon: -122.7567,
    zoom: 15.5,
    hours: "24 小時全天開放",
    crossing_type: "旅客客車專用",
    has_nexus: true,
    has_commercial: false,
    tips: "大溫前往西雅圖最繁忙之主要客運通道，建議週末善用 NEXUS 通道或改道太平洋公路。",
    canada_bound: {
      traveller_delay_min: 5,
      traveller_status: "5 分鐘",
      commercial_delay_min: null,
      commercial_status: "不適用 (客運專用)",
      nexus_open: true
    },
    us_bound: {
      standard_delay_min: 10,
      standard_status: "10 分鐘",
      standard_lanes_open: 5,
      nexus_delay_min: 0,
      nexus_status: "免等候 (No Delay)",
      nexus_lanes_open: 2
    }
  },
  {
    id: "pacific_highway",
    name: "太平洋公路關卡 (Pacific Highway / 176 St)",
    english_name: "Pacific Highway (Truck Crossing)",
    highway: "BC Hwy 15 ↔ WA SR 543",
    lat: 49.0020,
    lon: -122.7350,
    zoom: 15.5,
    hours: "24 小時全天開放",
    crossing_type: "客車及商業貨運",
    has_nexus: true,
    has_commercial: true,
    tips: "大溫核心商業貨車通道與旅客替代通道，支援 FAST 商業快速車道與 NEXUS 車道。",
    canada_bound: {
      traveller_delay_min: 5,
      traveller_status: "5 分鐘",
      commercial_delay_min: 5,
      commercial_status: "5 分鐘",
      nexus_open: true
    },
    us_bound: {
      standard_delay_min: 5,
      standard_status: "5 分鐘",
      standard_lanes_open: 3,
      nexus_delay_min: 0,
      nexus_status: "免等候 (No Delay)",
      nexus_lanes_open: 1
    }
  },
  {
    id: "aldergrove",
    name: "奧爾德格羅夫關卡 (Aldergrove / Lynden)",
    english_name: "Aldergrove / Lynden",
    highway: "BC Hwy 13 ↔ WA SR 539",
    lat: 49.0021,
    lon: -122.4845,
    zoom: 15.5,
    hours: "08:00 - 24:00 (一般車道), NEXUS (12:00 - 20:00)",
    crossing_type: "旅客客車及部分商業",
    has_nexus: true,
    has_commercial: true,
    tips: "位於蘭里與阿伯茨福德交界，前往貝靈漢避開週末和平門長龍的捷徑。",
    canada_bound: {
      traveller_delay_min: 0,
      traveller_status: "免等候 (No Delay)",
      commercial_delay_min: 0,
      commercial_status: "免等候",
      nexus_open: true
    },
    us_bound: {
      standard_delay_min: 0,
      standard_status: "免等候 (No Delay)",
      standard_lanes_open: 2,
      nexus_delay_min: 0,
      nexus_status: "免等候",
      nexus_lanes_open: 1
    }
  },
  {
    id: "abbotsford_huntingdon",
    name: "阿伯茨福德關卡 (Abbotsford-Huntingdon / Sumas)",
    english_name: "Abbotsford-Huntingdon / Sumas",
    highway: "BC Hwy 11 ↔ WA SR 9",
    lat: 49.0022,
    lon: -122.2646,
    zoom: 15.5,
    hours: "24 小時全天開放",
    crossing_type: "客車及商業貨運",
    has_nexus: true,
    has_commercial: true,
    tips: "菲沙河谷東部重要通關樞紐，直達蘇馬斯 (Sumas)，往貝克山滑雪度假主要途徑。",
    canada_bound: {
      traveller_delay_min: 5,
      traveller_status: "5 分鐘",
      commercial_delay_min: 0,
      commercial_status: "免等候",
      nexus_open: true
    },
    us_bound: {
      standard_delay_min: 5,
      standard_status: "5 分鐘",
      standard_lanes_open: 2,
      nexus_delay_min: 0,
      nexus_status: "免等候",
      nexus_lanes_open: 1
    }
  },
  {
    id: "boundary_bay",
    name: "羅伯茨角關卡 (Boundary Bay / Point Roberts)",
    english_name: "Boundary Bay / Point Roberts",
    highway: "56th St (Tsawwassen)",
    lat: 49.0021,
    lon: -123.0682,
    zoom: 15.5,
    hours: "24 小時全天開放",
    crossing_type: "旅客客車及當地貨運",
    has_nexus: false,
    has_commercial: true,
    tips: "南三角洲 Tsawwassen 進入美國飛地 Point Roberts 的唯一步行/陸路關卡。",
    canada_bound: {
      traveller_delay_min: 0,
      traveller_status: "免等候 (No Delay)",
      commercial_delay_min: 0,
      commercial_status: "免等候",
      nexus_open: false
    },
    us_bound: {
      standard_delay_min: 0,
      standard_status: "免等候 (No Delay)",
      standard_lanes_open: 1,
      nexus_delay_min: 0,
      nexus_status: "免等候",
      nexus_lanes_open: 0
    }
  }
];

export default function AppMap() {
  const { 
    layers, mapStyleType, searchTarget, setSearchTarget, isLayerPanelOpen, 
    contourInterval, timeFormat, distanceUnit, userLocation, setUserLocation, setExploreOpen,
    isExploreOpen, exploreTab, weatherSubTab, setExploreTab, openExploreTab, openExploreTabs, setSettingsModalOpen,
    parkingMeterFilter, setParkingMeterFilter,
    motorcycleParkingFilter, setMotorcycleParkingFilter,
    radiusExploration, setRadiusExploration,
    fuelFilter, setFuelFilter,
    evChargingFilter, setEvChargingFilter,
    isRadarActive, setIsRadarActive,
    radarFrameTime, radarHost, radarTilePath,
    stationAlertsMap, transitAlertsList, setTransitAlertsList,
    timeZone
  } = useUIStore();
  const mapRef = useRef<MapRef>(null);

  const [selectedStationAlertMarker, setSelectedStationAlertMarker] = useState<{
    name: string;
    displayName: string;
    stop_id: string;
    lat: number;
    lon: number;
    critical: boolean;
    count: number;
    alertIds: string[];
  } | null>(null);

  // 當關閉探索介面或切到非警報分頁時，關閉車站警報彈窗
  useEffect(() => {
    if (!isExploreOpen || exploreTab !== 'alerts') {
      setSelectedStationAlertMarker(null);
    }
  }, [isExploreOpen, exploreTab]);

  // 保底：若探索交通警報開啟但本地尚未加載 alerts 列表，預載靜態快取
  useEffect(() => {
    if (isExploreOpen && exploreTab === 'alerts' && (!transitAlertsList || transitAlertsList.length === 0)) {
      fetch('/vancouver_translink_alerts_cache.json')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.alerts)) {
            setTransitAlertsList(data.alerts);
          }
        })
        .catch(() => {});
    }
  }, [isExploreOpen, exploreTab, transitAlertsList, setTransitAlertsList]);

  // Active Station Alert Warning Triangles (Non-critical: Yellow, Critical: Red)
  // 只有打開交通警報分頁時才在地圖上顯示黃/紅三角形標記，關閉探索介面或切到其他分頁時三角形自動隱藏
  const activeStationAlertMarkers = useMemo(() => {
    if (!isExploreOpen || exploreTab !== 'alerts') return [];
    if (!stationAlertsMap || Object.keys(stationAlertsMap).length === 0) return [];
    const list: Array<{
      name: string;
      displayName: string;
      stop_id: string;
      lat: number;
      lon: number;
      critical: boolean;
      count: number;
      alertIds: string[];
    }> = [];

    const stationEntries = Object.values(skytrainStationsData as Record<string, {
      name: string;
      displayName: string;
      stop_id: string;
      lat: number;
      lon: number;
      lines: string[];
    }>);

    for (const st of stationEntries) {
      let alertInfo = stationAlertsMap[st.name];
      if (!alertInfo) {
        for (const [k, val] of Object.entries(stationAlertsMap)) {
          const kNorm = k.trim().toLowerCase();
          const stNameNorm = st.name.trim().toLowerCase();
          const stDisplayNorm = st.displayName ? st.displayName.trim().toLowerCase() : '';
          if (kNorm === stNameNorm || kNorm === stDisplayNorm || kNorm.replace(' station', '') === stNameNorm) {
            alertInfo = val;
            break;
          }
        }
      }

      if (alertInfo && alertInfo.count > 0) {
        list.push({
          name: st.name,
          displayName: st.displayName,
          stop_id: st.stop_id,
          lat: st.lat,
          lon: st.lon,
          critical: alertInfo.critical,
          count: alertInfo.count,
          alertIds: alertInfo.alert_ids || []
        });
      }
    }
    return list;
  }, [stationAlertsMap, isExploreOpen, exploreTab]);

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
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [cursorNeighbourhood, setCursorNeighbourhood] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localAreaBoundariesRef = useRef<any[]>([]);
  const [parkingMeterFilterOpen, setParkingMeterFilterOpen] = useState(true);
  const [motorcycleFilterOpen, setMotorcycleFilterOpen] = useState(true);
  const [fuelFilterOpen, setFuelFilterOpen] = useState(true);
  const [evFilterOpen, setEvFilterOpen] = useState(true);
  const [showTimePeriodInfo, setShowTimePeriodInfo] = useState(false);
  const [timeInfoHovered, setTimeInfoHovered] = useState(false);
  const [carSharingLegendOpen, setCarSharingLegendOpen] = useState(true);
  const [bikewaysLegendOpen, setBikewaysLegendOpen] = useState(true);
  const [carSharingFilter, setCarSharingFilter] = useState<{ evo: boolean; modo: boolean }>({ evo: true, modo: true });
  const [bikewaysFilter, setBikewaysFilter] = useState<Record<string, boolean>>({
    'Protected Bike Lanes': true,
    'Painted Lanes': true,
    'Local Street': true,
    'Shared Lanes': true,
  });
  const [safetyCamerasLegendOpen, setSafetyCamerasLegendOpen] = useState(true);
  const [safetyCamerasFilter, setSafetyCamerasFilter] = useState<{ redLightSpeed: boolean; redLightOnly: boolean }>({
    redLightSpeed: true,
    redLightOnly: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [nearbyFacilities, setNearbyFacilities] = useState<any[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mapSkiResorts, setMapSkiResorts] = useState<any[]>(SKI_RESORT_POINTS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mapBorderCrossings, setMapBorderCrossings] = useState<any[]>(BORDER_CROSSING_POINTS);

  useEffect(() => {
    if ((isExploreOpen && exploreTab === 'border') || searchTarget?.category === 'border_crossing') {
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/api/border/wait-times`)
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.crossings) && data.crossings.length > 0) {
            setMapBorderCrossings(data.crossings);
          }
        })
        .catch(() => {});
    }
  }, [isExploreOpen, exploreTab, searchTarget]);

  const [skytrainDetailTab, setSkytrainDetailTab] = useState<'departures' | 'schedules' | 'facilities'>('departures');
  const [currentZoom, setCurrentZoom] = useState<number>(11);
  const [loadingHeavyLayers, setLoadingHeavyLayers] = useState<{ [key: string]: string }>({});
  const [zoomNotification, setZoomNotification] = useState<{
    show: boolean;
    title: string;
    message: string;
    targetZoom: number;
  } | null>(null);
  const prevLayersRef = useRef(layers);
  // 地圖右鍵自訂選單狀態
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lat: number;
    lon: number;
  } | null>(null);
  const [copiedCoordsToast, setCopiedCoordsToast] = useState(false);
  const [copiedFacilityToast, setCopiedFacilityToast] = useState(false);

  // 預載溫哥華市區 22 個 Local Area 邊界幾何，用於滑鼠即時社區判定
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__godsEyeMapRef = mapRef;
    }
    fetch('/vancouver_local_area_boundary.geojson')
      .then(res => {
        if (!res.ok) throw new Error('Local fetch failed');
        return res.json();
      })
      .catch(() => fetch(`${getApiUrl()}/api/geojson/road/local_area_boundary`).then(r => r.json()))
      .then(data => {
        if (data?.features && Array.isArray(data.features)) {
          localAreaBoundariesRef.current = data.features;
        }
      })
      .catch(err => console.warn('Local area boundaries load warning:', err));
  }, []);

  const getNeighbourhood = useCallback((lon: number, lat: number): string => {
    const boundaries = localAreaBoundariesRef.current;
    if (boundaries && boundaries.length > 0) {
      for (const feat of boundaries) {
        const geom = feat.geometry;
        if (!geom) continue;
        if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
          if (isPointInPolygon2D(lon, lat, geom.coordinates[0])) {
            return feat.properties?.name || 'Vancouver';
          }
        } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
          for (const poly of geom.coordinates) {
            if (poly?.[0] && isPointInPolygon2D(lon, lat, poly[0])) {
              return feat.properties?.name || 'Vancouver';
            }
          }
        }
      }
    }
    // 大溫各區域經緯度範圍判定 (純英文顯示，不帶中文)
    if (lat >= 49.11 && lat <= 49.20 && lon >= -123.21 && lon <= -123.05) return 'Richmond';
    if (lat >= 49.20 && lat <= 49.29 && lon >= -123.03 && lon <= -122.88) return 'Burnaby';
    if (lat >= 49.30 && lat <= 49.38 && lon >= -123.15 && lon <= -122.95) return 'North Vancouver';
    if (lat >= 49.32 && lon <= -123.15) return 'West Vancouver';
    if (lat >= 49.05 && lat <= 49.22 && lon >= -122.89 && lon <= -122.68) return 'Surrey';
    if (lat >= 49.23 && lat <= 49.30 && lon >= -122.88 && lon <= -122.75) return 'Coquitlam';
    if (lat >= 49.20 && lat <= 49.24 && lon >= -122.95 && lon <= -122.88) return 'New Westminster';
    if (lat >= 49.20 && lat <= 49.30 && lon >= -123.26 && lon <= -123.02) return 'Vancouver';
    return '';
  }, []);

  const copyCoordinatesToClipboard = useCallback((lat: number, lon: number) => {
    const text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedCoordsToast(true);
      setTimeout(() => setCopiedCoordsToast(false), 2200);
    }
  }, []);

  const copyFacilityDetailsToClipboard = useCallback((facility: RoadFacilityInfo, customTitle?: string) => {
    const text = customTitle || facility.name || '';
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedFacilityToast(true);
      setTimeout(() => setCopiedFacilityToast(false), 2200);
    }
  }, []);

  const handleCopyCoordinates = useCallback(() => {
    if (!cursorCoords) return;
    const text = `${cursorCoords.lat.toFixed(5)}, ${cursorCoords.lng.toFixed(5)}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 2200);
    }
  }, [cursorCoords]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapMouseMove = React.useCallback((e: any) => {
    if (e.lngLat) {
      setCursorCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      const nName = getNeighbourhood(e.lngLat.lng, e.lngLat.lat);
      setCursorNeighbourhood(nName);
    }
  }, [getNeighbourhood]);

  const handleMapMouseLeave = React.useCallback(() => {
    setCursorCoords(null);
    setCursorNeighbourhood('');
  }, []);

  // 生成半徑探索之 GeoJSON 圓形多邊形 (64 頂點)
  const createGeoJSONCircle = useCallback((center: [number, number], radiusInMeters: number, points = 64) => {
    const [lon, lat] = center;
    const coords: [number, number][] = [];
    const radiusInKm = radiusInMeters / 1000.0;
    const distanceX = radiusInKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    const distanceY = radiusInKm / 110.574;

    for (let i = 0; i <= points; i++) {
      const theta = (i / points) * (2 * Math.PI);
      const x = distanceX * Math.cos(theta);
      const y = distanceY * Math.sin(theta);
      coords.push([lon + x, lat + y]);
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        },
        properties: {}
      }]
    };
  }, []);

  const radiusCircleGeoJSON = useMemo(() => {
    if (!radiusExploration || !radiusExploration.active) return null;
    return createGeoJSONCircle([radiusExploration.lon, radiusExploration.lat], radiusExploration.radiusM || 500);
  }, [radiusExploration, createGeoJSONCircle]);

  // 半徑探索周邊設施查詢 (必定查詢範圍內全部項目，不受限於圖層開關狀態)
  useEffect(() => {
    if (!radiusExploration || !radiusExploration.active) {
      setNearbyFacilities([]);
      return;
    }
    setLoadingNearby(true);
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/explore/nearby?lat=${radiusExploration.lat}&lon=${radiusExploration.lon}&radius=${radiusExploration.radiusM || 500}`)
      .then(res => res.json())
      .then(data => {
        setNearbyFacilities(data.items || []);
        setLoadingNearby(false);
      })
      .catch(err => {
        console.error('Nearby exploration fetch error:', err);
        setLoadingNearby(false);
      });
  }, [radiusExploration?.lat, radiusExploration?.lon, radiusExploration?.radiusM, radiusExploration?.active]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapContextMenu = useCallback((e: any) => {
    if (e && e.lngLat) {
      if (e.preventDefault) e.preventDefault();
      if (e.originalEvent?.preventDefault) e.originalEvent.preventDefault();
      const x = e.point?.x ?? e.originalEvent?.clientX ?? 0;
      const y = e.point?.y ?? e.originalEvent?.clientY ?? 0;
      setContextMenu({
        x,
        y,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng
      });
    }
  }, []);

  // 點擊地圖外部或按下 ESC 時自動關閉右鍵選單
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    if (contextMenu) {
      window.addEventListener('click', handleGlobalClick);
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('click', handleGlobalClick);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu]);

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

  // Auto-dismiss popup if the selected facility is filtered out
  useEffect(() => {
    if (!selectedFacility) return;
    if (selectedFacility.facility_type === 'car_sharing') {
      const op = selectedFacility.properties?.operator;
      if (op === 'Evo' && !carSharingFilter.evo) setSelectedFacility(null);
      if (op === 'Modo' && !carSharingFilter.modo) setSelectedFacility(null);
    } else if (selectedFacility.facility_type === 'bikeways') {
      const bType = selectedFacility.properties?.bikeway_type;
      if (bType && bikewaysFilter[bType] === false) setSelectedFacility(null);
    } else if (selectedFacility.facility_type === 'safety_cameras') {
      const hasSpeed = Boolean(selectedFacility.properties?.has_speed);
      if (hasSpeed && !safetyCamerasFilter.redLightSpeed) setSelectedFacility(null);
      if (!hasSpeed && !safetyCamerasFilter.redLightOnly) setSelectedFacility(null);
    }
  }, [selectedFacility, carSharingFilter, bikewaysFilter, safetyCamerasFilter]);

  // 當設施彈窗切換或關閉時，重設時段說明面板狀態
  useEffect(() => {
    setShowTimePeriodInfo(false);
    setTimeInfoHovered(false);
  }, [selectedFacility?.id]);
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

  // 周邊半徑探索點選之設施標記 (即使圖層未開啟亦在地圖常駐顯著標示，關閉探索時才隱藏)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [explorationSelectedFacility, setExplorationSelectedFacility] = useState<any | null>(null);

  // 當周邊探索被關閉時，連帶清除專屬設施標記
  useEffect(() => {
    if (!radiusExploration?.active) {
      setExplorationSelectedFacility(null);
    }
  }, [radiusExploration?.active]);

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
      // 若為周邊半徑探索選取之設施，即便該圖層目前關閉，亦予以保留展示
      const isExplorationActiveSelection = Boolean(
        radiusExploration?.active && 
        explorationSelectedFacility && 
        selectedFacility && 
        String(explorationSelectedFacility.id) === String(selectedFacility.id)
      );
      
      if (!isExplorationActiveSelection) {
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
        else if (type === 'food_banks' && !layers.foodBanks) facilityClosed = true;
        else if (type === 'recycling' && !layers.recycling) facilityClosed = true;
        else if (type === 'homeless_shelters' && !layers.homelessShelters) facilityClosed = true;
        else if (type === 'traffic_cameras' && !layers.trafficCameras) facilityClosed = true;
        else if (type === 'safety_cameras' && !layers.safetyCameras) facilityClosed = true;
        else if (type === 'parking_meters' && !layers.parkingMeters) facilityClosed = true;
        else if (type === 'impark' && !layers.impark) facilityClosed = true;
        else if (type === 'accessible_parking' && !layers.accessibleParking) facilityClosed = true;
        else if (type === 'motorcycle_parking' && !layers.motorcycleParking) facilityClosed = true;
        else if (type === 'car_sharing' && !layers.carSharing) facilityClosed = true;
        else if (type === 'shared_bikes' && !layers.sharedBikes) facilityClosed = true;
        else if (type === 'bikeways' && !layers.bikeways) facilityClosed = true;
        else if (type === 'escooter' && !layers.escooter) facilityClosed = true;
        else if (type === 'contours' && !layers.contours) facilityClosed = true;
        else if (type === 'local_area_boundary' && !layers.localAreaBoundary) facilityClosed = true;
        else if (type === 'marine_terminals' && !layers.marineTerminals) facilityClosed = true;
        else if (type === 'crime_areas' && !layers.crimeAreas) facilityClosed = true;
        else if (type === 'traffic_speed_limits' && !layers.trafficSpeedLimits) facilityClosed = true;
        else if (type === 'bike_racks' && !layers.bikeRacks) facilityClosed = true;
        else if (type === 'postal_code_fsa' && !layers.postalCodeFSA) facilityClosed = true;
        else if (type === 'public_art' && !layers.publicArt) facilityClosed = true;
        else if (type === 'water_distribution_mains' && !layers.waterDistributionMains) facilityClosed = true;
        else if (type === 'sewer_mains' && !layers.sewerMains) facilityClosed = true;
        else if (type === 'one_way_streets' && !layers.oneWayStreets) facilityClosed = true;
        else if (type === 'snow_removal_routes' && !layers.snowRemovalRoutes) facilityClosed = true;
        else if (type === 'traffic_crosswalks' && !layers.trafficCrosswalks) facilityClosed = true;
        else if (type === 'litter_containers' && !layers.litterContainers) facilityClosed = true;
        else if (type === 'van_wifi' && !layers.vanWifi) facilityClosed = true;
        else if (type === 'tide_stations' && !layers.tideStations) facilityClosed = true;
        else if ((type === 'traffic_conditions' || type === 'traffic_corridor') && !layers.trafficConditions && !(isExploreOpen && exploreTab === 'traffic') && selectedFacility.id !== 'lions_gate_bridge_atis' && selectedFacility.id !== searchTarget?.id) facilityClosed = true;
        else if ((type === 'traffic_alerts' || type === 'traffic_incident') && !layers.trafficAlerts && !(isExploreOpen && exploreTab === 'traffic') && selectedFacility.id !== searchTarget?.id) facilityClosed = true;
        else if (type === 'road_closures' && !layers.roadClosures) facilityClosed = true;
        else if (type === 'road_construction' && !layers.roadConstruction) facilityClosed = true;
        else if (type === 'street_lighting' && !layers.streetLighting) facilityClosed = true;
        else if (type === 'street_lighting_conduits' && !layers.streetLightingConduits) facilityClosed = true;
        else if (type === 'beach_water_quality' && !layers.beachWaterQuality) facilityClosed = true;
        else if (type === 'fire_hydrants' && !layers.fireHydrants) facilityClosed = true;
        else if (type === 'zoning_districts' && !layers.zoningDistricts) facilityClosed = true;
        else if (type === 'public_trees' && !layers.publicTrees) facilityClosed = true;
        else if (type === 'museums' && !layers.museums) facilityClosed = true;
        else if (type === 'garbage_collection' && !layers.garbageCollection) facilityClosed = true;

        if (facilityClosed) {
          setSelectedFacility(null);
          setSearchTarget(null);
        }
      }

      if (!layers.trafficConditions && !(isExploreOpen && exploreTab === 'traffic') && searchTarget?.id !== selectedFacility?.id) {
        if (searchTarget?.category === 'traffic_corridor') {
          setSearchTarget(null);
        }
      }
      if (!layers.trafficAlerts && !(isExploreOpen && exploreTab === 'traffic') && searchTarget?.id !== selectedFacility?.id) {
        if (searchTarget?.category === 'traffic_incident') {
          setSearchTarget(null);
        }
      }
    }

    // 2. 機場 (Airports)
    if (selectedAirport && !layers.airports) {
      setSelectedAirport(null);
      if (searchTarget && searchTarget.category === 'airports') {
        setSearchTarget(null);
      }
    }

    // 3. BC Ferries 碼頭與船隻、以及港口船運商船
    if (selectedTerminal && !layers.bcferriesRoutes) {
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
    if (selectedMaritimeVessel && !layers.maritimeShipping) {
      setSelectedMaritimeVessel(null);
      if (searchTarget && searchTarget.category === 'maritime_vessel') {
        setSearchTarget(null);
      }
    }

    // 4. 巴士與海上巴士 (全域圖層關閉時僅清除選取的車輛，不影響獨立搜尋的巴士路線與半徑探索)
    if (selectedBus && !searchedBusRoute) {
      if (selectedBus.is_seabus) {
        if (!layers.seabusVehicles) {
          setSelectedBus(null);
          setBusDetails(null);
        }
      } else if (!layers.bus) {
        setSelectedBus(null);
        setBusDetails(null);
        if (searchTarget && searchTarget.category === 'bus') {
          setSearchTarget(null);
        }
      }
    }
    const isStopExplorationActive = Boolean(
      radiusExploration?.active &&
      explorationSelectedFacility &&
      selectedStop &&
      String(explorationSelectedFacility.id) === String(selectedStop.id)
    );
    const isSeaBusStop = Boolean(
      selectedStop && (
        selectedStop.id === '8035' || 
        selectedStop.id === '8036' || 
        selectedStop.name.includes('SeaBus') || 
        selectedStop.name.includes('Lonsdale Quay') ||
        selectedStop.name.includes('Waterfront')
      )
    );
    if (selectedStop && !isStopExplorationActive) {
      if (isSeaBusStop) {
        if (!layers.seabusRoutes) {
          setSelectedStop(null);
          if (searchTarget && searchTarget.category === 'seabus') {
            setSearchTarget(null);
          }
        }
      } else {
        if (!layers.busRoutes) {
          setSelectedStop(null);
          if (searchTarget && searchTarget.category === 'bus_stop') {
            setSearchTarget(null);
          }
        }
      }
    }
    if (selectedTrain && !layers.skytrainTrains) {
      setSelectedTrain(null);
    }
    const isStationExplorationActive = Boolean(
      radiusExploration?.active && 
      explorationSelectedFacility && 
      selectedSkytrainStation && 
      String(explorationSelectedFacility.id) === String(selectedSkytrainStation.stop_id)
    );
    if (selectedSkytrainStation && !layers.skytrainRoutes && !isStationExplorationActive) {
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
      } else if (searchTarget.category === 'ferry_terminal' && !layers.bcferriesRoutes) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'ferry_vehicle' && !layers.bcferriesVehicles) {
        setSearchTarget(null);
      } else if (searchTarget.category === 'maritime_vessel' && !layers.maritimeShipping) {
        setSearchTarget(null);
      }
    }
  }, [layers, selectedFacility, selectedAirport, selectedTerminal, selectedFerry, selectedMaritimeVessel, selectedBus, searchedBusRoute, selectedStop, selectedTrain, selectedSkytrainStation, searchTarget, setSearchTarget, isExploreOpen, exploreTab, radiusExploration, explorationSelectedFacility]);


  const fetchSkytrainStationSchedule = React.useCallback((stopId: string, stopName?: string, lon?: number, lat?: number) => {
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
    setSelectedTrain(null);
    setLoadingStationSchedule(true);

    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/api/skytrain/stations/${encodeURIComponent(stopId)}/schedule`)
      .then(res => res.json())
      .then(data => {
        const localMaps = getSkytrainStationMapUrls(data?.name || stopName || '');
        if (data && !data.error) {
          setSelectedSkytrainStation({
            ...data,
            station_map_url: data.station_map_url || localMaps?.Station || data.entrance_map_url,
            entrance_map_url: data.entrance_map_url || localMaps?.Entrance || localMaps?.Station
          });
        } else {
          setSelectedSkytrainStation({
            stop_id: stopId,
            name: stopName || '天車站',
            raw_name: stopName || '天車站',
            lat: lat || 49.2827,
            lon: lon || -123.1207,
            lines: ['SkyTrain 天車'],
            schedules: [],
            station_map_url: localMaps?.Station,
            entrance_map_url: localMaps?.Entrance || localMaps?.Station,
            updated_at: new Date().toLocaleTimeString('en-US', { hour12: false })
          });
        }
        setLoadingStationSchedule(false);
      })
      .catch(err => {
        console.error('Error fetching SkyTrain station schedule:', err);
        const localMaps = getSkytrainStationMapUrls(stopName || '');
        setSelectedSkytrainStation({
          stop_id: stopId,
          name: stopName || '天車站',
          raw_name: stopName || '天車站',
          lat: lat || 49.2827,
          lon: lon || -123.1207,
          lines: ['SkyTrain 天車'],
          schedules: [],
          station_map_url: localMaps?.Station,
          entrance_map_url: localMaps?.Entrance || localMaps?.Station,
          updated_at: new Date().toLocaleTimeString('en-US', { hour12: false })
        });
        setLoadingStationSchedule(false);
      });
  }, []);

  const fetchArrivals = React.useCallback((stopId: string) => {
    if (!stopId) return;
    setLoadingArrivals(true);
    setArrivals([]);
    fetch(`${getApiUrl()}/api/stops/${encodeURIComponent(stopId)}/arrivals`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch stop arrivals');
        return res.json();
      })
      .then((data) => {
        setArrivals(data.arrivals || []);
        setLoadingArrivals(false);
      })
      .catch(() => {
        setArrivals([]);
        setLoadingArrivals(false);
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

  // Fetch initial maritime shipping vessels and live poll
  useEffect(() => {
    const apiUrl = getApiUrl();
    const fetchVessels = () => {
      fetch(`${apiUrl}/api/shipping/vessels`)
        .then(res => res.json())
        .then(data => {
          if (data.vessels && Array.isArray(data.vessels)) {
            setMaritimeVessels(data.vessels);
          }
        })
        .catch(err => console.error('Failed to load maritime vessels:', err));
    };

    fetchVessels();
    let interval: NodeJS.Timeout | null = null;
    if (layers.maritimeShipping || (isExploreOpen && exploreTab === 'cargo')) {
      interval = setInterval(fetchVessels, 4000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [layers.maritimeShipping, isExploreOpen, exploreTab]);

  // Periodic polling for TomTom traffic corridors and alerts (every 180s / 3 mins)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (layers.trafficAlerts || (isExploreOpen && exploreTab === 'traffic')) {
      const pollTomTomData = async () => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const apiUrl = getApiUrl();
        const t = Date.now();

        if (isExploreOpen && exploreTab === 'traffic') {
          try {
            const res = await fetch(`${apiUrl}/api/traffic/jams?t=${t}`);
            if (res.ok) {
              const data = await res.json();
              const src = map.getSource('traffic_conditions') as any;
              if (src && src.setData) src.setData(data);
            } else {
              const staticRes = await fetch('/vancouver_traffic_conditions.geojson');
              if (staticRes.ok) {
                const data = await staticRes.json();
                const src = map.getSource('traffic_conditions') as any;
                if (src && src.setData) src.setData(data);
              }
            }
          } catch (_) {
            try {
              const staticRes = await fetch('/vancouver_traffic_conditions.geojson');
              if (staticRes.ok) {
                const data = await staticRes.json();
                const src = map.getSource('traffic_conditions') as any;
                if (src && src.setData) src.setData(data);
              }
            } catch { /* empty */ }
          }
        }

        if (layers.trafficAlerts) {
          try {
            const res = await fetch(`${apiUrl}/api/traffic/alerts?t=${t}`);
            if (res.ok) {
              const data = await res.json();
              const src = map.getSource('traffic_alerts') as any;
              if (src && src.setData) src.setData(data);
            } else {
              const src = map.getSource('traffic_alerts') as any;
              if (src && src.setData) src.setData({ type: 'FeatureCollection', features: [] });
            }
          } catch (_) {
            const src = map.getSource('traffic_alerts') as any;
            if (src && src.setData) src.setData({ type: 'FeatureCollection', features: [] });
          }
        }
      };

      pollTomTomData();
      interval = setInterval(pollTomTomData, 180000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [layers.trafficAlerts, isExploreOpen, exploreTab]);

  // 當離開探索 - 路況分頁時，若開啟著獅門大橋 popup 則自動關閉
  useEffect(() => {
    if (selectedFacility?.id === 'lions_gate_bridge_atis' && (!isExploreOpen || exploreTab !== 'traffic')) {
      setSelectedFacility(null);
    }
  }, [isExploreOpen, exploreTab, selectedFacility]);

  // Keep selectedMaritimeVessel synced when maritimeVessels updates
  useEffect(() => {
    if (!selectedMaritimeVessel) return;
    const updated = maritimeVessels.find(v => v.mmsi === selectedMaritimeVessel.mmsi);
    if (updated) {
      setSelectedMaritimeVessel(updated);
    }
  }, [maritimeVessels, selectedMaritimeVessel]);

  // 選中商船之航線軌跡 GeoJSON (Selected Vessel Navigation Route)
  const vesselRouteGeoJSON = useMemo(() => {
    if (!selectedMaritimeVessel) return null;
    let coords: [number, number][] = [];

    // 判斷船隻是否為靜態泊靠 (繫泊或錨泊狀態不繪製穿透陸地的直線)
    const isStationary = selectedMaritimeVessel.sog < 0.6 || 
      (selectedMaritimeVessel.nav_status && (
        selectedMaritimeVessel.nav_status.includes('繫泊') || 
        selectedMaritimeVessel.nav_status.includes('錨泊') ||
        selectedMaritimeVessel.nav_status.includes('Moored') ||
        selectedMaritimeVessel.nav_status.includes('Anchor')
      ));

    if (selectedMaritimeVessel.waypoints && selectedMaritimeVessel.waypoints.length >= 2) {
      // 預設深水水路航道：去重並保留真實深水通道線段
      const rawWp = selectedMaritimeVessel.waypoints;
      const cleanWp: [number, number][] = [];
      for (let i = 0; i < rawWp.length; i++) {
        const pt = [rawWp[i][0], rawWp[i][1]] as [number, number];
        if (cleanWp.length === 0) {
          cleanWp.push(pt);
        } else {
          const last = cleanWp[cleanWp.length - 1];
          if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.0001) {
            cleanWp.push(pt);
          }
        }
      }
      coords = cleanWp;
    } else if (!isStationary && selectedMaritimeVessel.sog >= 0.6) {
      // 航行中船隻：依即時航速與航向繪製「標準海事 6 分鐘推算航向向量 (ECDIS Dead Reckoning Vector)」
      const lon = selectedMaritimeVessel.lon;
      const lat = selectedMaritimeVessel.lat;
      const headingDeg = selectedMaritimeVessel.cog || selectedMaritimeVessel.heading || 0;
      const rad = (headingDeg * Math.PI) / 180.0;
      // 6 分鐘預估前進距離 (節 * 0.1852 km)，嚴格限制在 0.3km ~ 1.5km 水面範圍，絕不盲目射向數公里外的陸地
      const distKm = Math.min(Math.max(selectedMaritimeVessel.sog * 0.1852, 0.35), 1.5);
      const dLat = (distKm / 111.32) * Math.cos(rad);
      const dLon = (distKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);

      const targetPt: [number, number] = [lon + dLon, lat + dLat];
      if (!isShipOnLand(targetPt[0], targetPt[1])) {
        coords = [
          [lon, lat],
          targetPt
        ];
      } else {
        coords = [
          [lon, lat],
          [lon + dLon * 0.25, lat + dLat * 0.25]
        ];
      }
    }

    if (coords.length < 2) return null;

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {
            mmsi: selectedMaritimeVessel.mmsi,
            name: selectedMaritimeVessel.name
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: coords
          }
        }
      ]
    };
  }, [selectedMaritimeVessel]);

  // 選中主要幹道或主要道路之路線軌跡 GeoJSON (Selected Traffic Corridor / Major Road Route Line)
  const corridorRouteGeoJSON = useMemo(() => {
    if (searchTarget?.category !== 'traffic_corridor') return null;
    const coords = searchTarget.meta?.coordinates || searchTarget.meta?.line_coords;
    if (coords && Array.isArray(coords) && coords.length >= 2) {
      return {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: searchTarget.meta?.properties || {},
            geometry: {
              type: 'LineString' as const,
              coordinates: coords
            }
          }
        ]
      };
    }
    return null;
  }, [searchTarget]);

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
  const [cameraSecondsAgo, setCameraSecondsAgo] = useState(0);
  const cameraLastUpdatedRef = useRef<number>(Date.now());

  // 15.3 交通攝影機 30 秒自動輪巡計時器與 X 秒前更新計數器
  useEffect(() => {
    if (selectedFacility && selectedFacility.facility_type === 'traffic_cameras') {
      const now = Date.now();
      cameraLastUpdatedRef.current = now;
      setCameraSecondsAgo(0);

      const secTimer = setInterval(() => {
        setCameraSecondsAgo(Math.floor((Date.now() - cameraLastUpdatedRef.current) / 1000));
      }, 1000);

      const autoRefreshTimer = setInterval(() => {
        setWebcamRefreshKey(k => k + 1);
        const t = Date.now();
        cameraLastUpdatedRef.current = t;
        setCameraSecondsAgo(0);
      }, 30000);

      return () => {
        clearInterval(secTimer);
        clearInterval(autoRefreshTimer);
      };
    }
  }, [selectedFacility]);
  const [enlargedCameraImage, setEnlargedCameraImage] = useState<{
    src: string;
    directSrc: string;
    alt: string;
    title: string;
    direction: string;
  } | null>(null);

  // Close camera lightbox on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && enlargedCameraImage) {
        setEnlargedCameraImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enlargedCameraImage]);

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

    try {
      const z = map.getZoom();
      if (typeof z === 'number' && !isNaN(z)) {
        setCurrentZoom(z);
      }
    } catch (_) {}

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

    // 5. 路燈配電管線 (Street Lighting Conduits)
    const turnedOnStreetLighting = !prev.streetLighting && layers.streetLighting;
    if (turnedOnStreetLighting) {
      if (z < 12) {
        setZoomNotification({
          show: true,
          title: '已開啟路燈管線圖層',
          message: '全市設有 65,000+ 筆地下照明配電管線，資料量較龐大載入需數秒，地圖已渲染亮黃色照明線網。',
          targetZoom: 13.5
        });
        return;
      }
    }

    // 6. 消防栓 (Fire Hydrants - 高密度聚合與放大提示)
    const turnedOnHydrants = !prev.fireHydrants && layers.fireHydrants;
    if (turnedOnHydrants) {
      if (z < 13.5) {
        setZoomNotification({
          show: true,
          title: '已開啟消防栓圖層',
          message: '全溫哥華逾 6,600 座消防栓，已啟用點位聚合渲染。請放大地圖以檢視各街區詳細位置資料。',
          targetZoom: 14.5
        });
        return;
      }
    }

    // 7. 海灘水質 (Beach Water Quality)
    const turnedOnBeachWater = !prev.beachWaterQuality && layers.beachWaterQuality;
    if (turnedOnBeachWater) {
      const map = mapRef.current?.getMap();
      if (map) {
        map.flyTo({ center: [-123.16, 49.28], zoom: 12.5, duration: 600 });
      }
    }

    // 8. 街道樹木 (Public Trees - 高密度聚合與放大提示)
    const turnedOnPublicTrees = !prev.publicTrees && layers.publicTrees;
    if (turnedOnPublicTrees) {
      if (z < 13.5) {
        setZoomNotification({
          show: true,
          title: '已開啟街道樹木圖層',
          message: '全溫哥華逾 15 萬棵公有街道樹木，已啟用點位聚合渲染。請放大地圖以檢視各街區詳細樹種與位置資料。',
          targetZoom: 14.5
        });
        return;
      }
    }

    // 當開啟大量資料圖層時，顯示「載入中」提示
    const newLoading: { [key: string]: string } = {};
    for (const [key, conf] of Object.entries(HEAVY_LAYERS_CONFIG)) {
      if (key === 'contours') continue;
      const k = key as keyof typeof layers;
      if (!prev[k] && layers[k]) {
        newLoading[key] = conf.label;
      }
    }

    if (Object.keys(newLoading).length > 0) {
      setLoadingHeavyLayers(curr => ({ ...curr, ...newLoading }));
      setTimeout(() => {
        setLoadingHeavyLayers(curr => {
          const next = { ...curr };
          for (const k of Object.keys(newLoading)) {
            delete next[k];
          }
          return next;
        });
      }, 3500);
    }

    // 當用家關閉圖層時，即刻移除其載入中提示
    setLoadingHeavyLayers(curr => {
      let changed = false;
      const next = { ...curr };
      for (const key of Object.keys(next)) {
        if (key !== 'contours') {
          const k = key as keyof typeof layers;
          if (!layers[k]) {
            delete next[key];
            changed = true;
          }
        }
      }
      return changed ? next : curr;
    });
  }, [layers, currentZoom]);

  // 等高線切換獨立載入提示 (支援間距切換 10m/2m/1m 及圖層開關)
  const prevContourStateRef = useRef<{ enabled: boolean; interval: string }>({
    enabled: layers.contours,
    interval: contourInterval,
  });

  useEffect(() => {
    const wasActive = prevContourStateRef.current.enabled && prevContourStateRef.current.interval !== 'off';
    const isActive = layers.contours && contourInterval !== 'off';
    const intervalChanged = prevContourStateRef.current.interval !== contourInterval;
    const enabledChanged = prevContourStateRef.current.enabled !== layers.contours;

    if (isActive && (!wasActive || intervalChanged || enabledChanged)) {
      const label = contourInterval === '1m'
        ? '等高線 (1米間距·精細數據)'
        : contourInterval === '2m'
        ? '等高線 (2米間距)'
        : '等高線 (10米間距)';

      setLoadingHeavyLayers(curr => ({ ...curr, contours: label }));

      // 對於 1m / 2m 精細等高線，若當前視野較遠，提醒用家放大檢視
      if ((contourInterval === '1m' || contourInterval === '2m') && currentZoom < 14) {
        setZoomNotification({
          show: true,
          title: `已開啟${label}`,
          message: `${label}線條密度極高，建議放大至街區層級以清晰檢視地形起伏。`,
          targetZoom: 14.5
        });
      }

      // 等高線資料量較大（1m/2m 資料可達數十 MB），提供充裕的 15 秒安全超時（若 source 提早載入完成會由 handleMapSourceData 自動隱藏）
      const timer = setTimeout(() => {
        setLoadingHeavyLayers(curr => {
          if (!curr.contours) return curr;
          const next = { ...curr };
          delete next.contours;
          return next;
        });
      }, 15000);

      prevContourStateRef.current = { enabled: layers.contours, interval: contourInterval };
      return () => clearTimeout(timer);
    } else if (!isActive && wasActive) {
      setLoadingHeavyLayers(curr => {
        if (!curr.contours) return curr;
        const next = { ...curr };
        delete next.contours;
        return next;
      });
      prevContourStateRef.current = { enabled: layers.contours, interval: contourInterval };
    } else {
      prevContourStateRef.current = { enabled: layers.contours, interval: contourInterval };
    }
  }, [layers.contours, contourInterval, currentZoom]);

  // MapLibre 資料載入完成事件監聽：當大數據圖層來源已就緒時自動隱藏載入提示
  const handleMapSourceData = useCallback((e: any) => {
    if (e.isSourceLoaded && e.sourceId) {
      const sid = String(e.sourceId);
      setLoadingHeavyLayers(curr => {
        let changed = false;
        const next = { ...curr };
        for (const [key, conf] of Object.entries(HEAVY_LAYERS_CONFIG)) {
          if (next[key] && conf.prefixes.some(p => sid.includes(p))) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : curr;
      });
    }
  }, []);

  // MapLibre 完全閒置（所有圖層瓦片渲染完成）
  const handleMapIdle = useCallback(() => {
    setLoadingHeavyLayers(curr => {
      if (Object.keys(curr).length === 0) return curr;
      return {};
    });
  }, []);

  useEffect(() => {
    if (zoomNotification?.show) {
      const timer = setTimeout(() => {
        setZoomNotification(prev => (prev ? { ...prev, show: false } : null));
      }, 9000);
      return () => clearTimeout(timer);
    }
  }, [zoomNotification?.show]);

  // 當開啟即時降水雷達回波時，自動記錄當前縮放比並縮放至能完整顯示雷達雲團動態的地圖大小 (Zoom 7 全域視角)
  // 當關閉即時降水雷達回波時，自動回復打開前的地圖縮放比例與中心視角
  const prevRadarActiveRef = useRef(isRadarActive);
  const preRadarViewStateRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (isRadarActive && !prevRadarActiveRef.current) {
      const currentZoom = map.getZoom();
      const currentCenter = map.getCenter();
      // 記錄開啟前的地圖縮放比與中心視角
      preRadarViewStateRef.current = {
        center: [currentCenter.lng, currentCenter.lat],
        zoom: currentZoom,
        pitch: map.getPitch(),
        bearing: map.getBearing()
      };

      if (currentZoom > 7.5) {
        map.flyTo({
          center: [-123.12, 49.25],
          zoom: 7,
          pitch: 0,
          bearing: 0,
          duration: 1200,
          essential: true
        });
      }
    } else if (!isRadarActive && prevRadarActiveRef.current) {
      // 關閉雷達時：回復開啟前的位置與縮放比
      if (preRadarViewStateRef.current) {
        map.flyTo({
          center: preRadarViewStateRef.current.center,
          zoom: preRadarViewStateRef.current.zoom,
          pitch: preRadarViewStateRef.current.pitch,
          bearing: preRadarViewStateRef.current.bearing,
          duration: 1000,
          essential: true
        });
        preRadarViewStateRef.current = null;
      }
    }
    prevRadarActiveRef.current = isRadarActive;
  }, [isRadarActive]);

  // 當開啟周邊半徑探索時，自動記錄當前縮放比與中心視角
  // 當關閉周邊半徑探索清單時，自動回復打開前的地圖縮放比例與中心視角
  const prevRadiusActiveRef = useRef(Boolean(radiusExploration?.active));
  const preRadiusViewStateRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const isCurrentActive = Boolean(radiusExploration?.active);
    if (isCurrentActive && !prevRadiusActiveRef.current) {
      const currentCenter = map.getCenter();
      preRadiusViewStateRef.current = {
        center: [currentCenter.lng, currentCenter.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
      };
    } else if (!isCurrentActive && prevRadiusActiveRef.current) {
      if (preRadiusViewStateRef.current) {
        map.flyTo({
          center: preRadiusViewStateRef.current.center,
          zoom: preRadiusViewStateRef.current.zoom,
          pitch: preRadiusViewStateRef.current.pitch,
          bearing: preRadiusViewStateRef.current.bearing,
          duration: 900,
          essential: true
        });
        preRadiusViewStateRef.current = null;
      }
    }
    prevRadiusActiveRef.current = isCurrentActive;
  }, [radiusExploration?.active]);

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
      const facType = searchTarget.meta?.facility_type || searchTarget.meta?.properties?.facility_type || (searchTarget.category === 'road' ? (searchTarget.id?.startsWith('fuel_') ? 'fuel' : 'ev_charging') : searchTarget.category);
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
    let ws: WebSocket | null = null;
    let isDisposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    
    const connect = () => {
      if (isDisposed) return;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => console.log('✅ Connected to Live Traffic WebSocket');
      ws.onmessage = (event) => {
        if (isDisposed) return;
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
      ws.onclose = () => {
        if (!isDisposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    };
    
    connect();
    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
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

    if (layers.skytrainRoutes) {
      style.sources['skytrain-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/skytrain` };
      style.sources['skytrain-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/skytrain` };
    }
    if (layers.busRoutes && !searchedBusRoute && !selectedBus) {
      style.sources['bus-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/bus` };
      style.sources['bus-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/bus` };
    }
    if (layers.seabusRoutes) {
      style.sources['seabus-tracks'] = { type: 'geojson', data: `${apiUrl}/api/geojson/tracks/seabus` };
      style.sources['seabus-stops'] = { type: 'geojson', data: `${apiUrl}/api/geojson/stops/seabus` };
    }
    if (layers.parkingMeters) {
      const pmParams = new URLSearchParams();
      if (parkingMeterFilter?.maxRate !== undefined && parkingMeterFilter.maxRate < 20) {
        pmParams.set('max_rate', parkingMeterFilter.maxRate.toString());
      }
      if (parkingMeterFilter?.creditCardOnly) {
        pmParams.set('credit_card_only', 'true');
      }
      if (parkingMeterFilter?.timePeriod) {
        pmParams.set('time_period', parkingMeterFilter.timePeriod);
      }
      const pmQuery = pmParams.toString() ? `?${pmParams.toString()}` : '';
      style.sources['parking-meters'] = { 
        type: 'geojson', 
        data: `${apiUrl}/api/geojson/road/parking_meters${pmQuery}`,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
      };
    }
    if (layers.impark) {
      style.sources['impark'] = { type: 'geojson', data: '/vancouver_impark.geojson' };
    }
    if (layers.accessibleParking) {
      style.sources['accessible-parking'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/accessible_parking` };
    }
    if (layers.motorcycleParking) {
      const mpParams = new URLSearchParams();
      if (motorcycleParkingFilter?.maxRate !== undefined && motorcycleParkingFilter.maxRate < 20) {
        mpParams.set('max_rate', motorcycleParkingFilter.maxRate.toString());
      }
      if (motorcycleParkingFilter?.creditCardOnly) {
        mpParams.set('credit_card_only', 'true');
      }
      if (motorcycleParkingFilter?.timePeriod) {
        mpParams.set('time_period', motorcycleParkingFilter.timePeriod);
      }
      const mpQuery = mpParams.toString() ? `?${mpParams.toString()}` : '';
      style.sources['motorcycle-parking'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/motorcycle_parking${mpQuery}` };
    }
    if (layers.evCharging) {
      style.sources['ev-charging'] = { type: 'geojson', data: '/vancouver_ev_charging.geojson' };
    }
    if (layers.escooter) {
      style.sources['escooter'] = { type: 'geojson', data: '/vancouver_escooter.geojson' };
    }
    if (layers.sharedBikes) {
      style.sources['shared-bikes'] = { type: 'geojson', data: '/vancouver_shared_bikes.geojson' };
    }
    if (layers.bikeways) {
      style.sources['bikeways'] = { type: 'geojson', data: '/vancouver_bikeways.geojson' };
    }
    if (layers.fireHalls) {
      style.sources['fire-halls'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/fire_halls` };
    }
    if (layers.communityCentres) {
      style.sources['community-centres'] = { type: 'geojson', data: `${apiUrl}/api/geojson/road/community_centres` };
    }
    if (layers.trafficCameras) {
      style.sources['traffic-cameras'] = { type: 'geojson', data: '/vancouver_traffic_cameras.geojson' };
    }
    if (layers.safetyCameras) {
      style.sources['safety-cameras'] = { type: 'geojson', data: '/vancouver_safety_cameras.geojson' };
    }
    if (layers.hospitals) {
      style.sources['hospitals'] = { type: 'geojson', data: '/vancouver_hospitals.geojson' };
    }
    if (layers.parks) {
      style.sources['parks'] = { type: 'geojson', data: '/vancouver_parks.geojson' };
    }
    if (layers.parksFacilities) {
      style.sources['parks-facilities'] = { type: 'geojson', data: '/vancouver_parks_facilities.geojson' };
    }
    if (layers.communityGardens) {
      style.sources['community-gardens'] = { type: 'geojson', data: '/vancouver_community_gardens.geojson' };
    }
    if (layers.drinkingFountains) {
      style.sources['drinking-fountains'] = { type: 'geojson', data: '/vancouver_drinking_fountains.geojson' };
    }
    if (layers.publicWashrooms) {
      style.sources['public-washrooms'] = { type: 'geojson', data: '/vancouver_public_washrooms.geojson' };
    }
    if (layers.schools) {
      style.sources['schools'] = { type: 'geojson', data: '/vancouver_schools.geojson' };
    }
    if (layers.libraries) {
      style.sources['libraries'] = { type: 'geojson', data: '/vancouver_libraries.geojson' };
    }
    if (layers.foodVendors) {
      style.sources['food-vendors'] = { type: 'geojson', data: '/vancouver_food_vendors.geojson' };
    }
    if (layers.foodBanks) {
      style.sources['food-banks'] = { type: 'geojson', data: '/vancouver_food_banks.geojson' };
    }
    if (layers.recycling) {
      style.sources['recycling'] = { type: 'geojson', data: '/vancouver_recycling.geojson' };
    }
    if (layers.homelessShelters) {
      style.sources['homeless-shelters'] = { type: 'geojson', data: '/vancouver_homeless_shelters.geojson' };
    }
    if (layers.carSharing) {
      style.sources['car-sharing'] = { type: 'geojson', data: '/vancouver_car_sharing.geojson' };
    }
    if (layers.police) {
      style.sources['police'] = { type: 'geojson', data: '/vancouver_police.geojson' };
    }
    if (layers.disasterHubs) {
      style.sources['disaster-hubs'] = { type: 'geojson', data: '/vancouver_disaster_hubs.geojson' };
    }
    if (layers.localAreaBoundary) {
      style.sources['local-area-boundary'] = { type: 'geojson', data: '/vancouver_local_area_boundary.geojson' };
    }
    if (layers.fuel) {
      style.sources['fuel'] = { type: 'geojson', data: '/vancouver_fuel.geojson' };
    }
    if (layers.tesla) {
      style.sources['tesla'] = { type: 'geojson', data: '/vancouver_tesla.geojson' };
    }
    if (layers.marineTerminals) {
      style.sources['marine_terminals'] = { type: 'geojson', data: '/vancouver_marine_terminals.geojson' };
    }
    if (layers.aed) {
      style.sources['aed'] = { type: 'geojson', data: '/vancouver_aed.geojson' };
    }

    // VanWiFi (溫哥華官方免費公共 WiFi)
    if (layers.vanWifi) {
      style.sources['van-wifi'] = { 
        type: 'geojson', 
        data: '/vancouver_van_wifi.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45
      };
    }

    // Coastal Tide Stations (大溫海岸潮汐與即時水位站 - 僅在海洋水文開啟)
    const showTideStations = (isExploreOpen && exploreTab === 'weather' && weatherSubTab === 'marine');
    if (showTideStations) {
      style.sources['tide-stations'] = {
        type: 'geojson',
        data: `${apiUrl}/api/geojson/road/tide_stations`
      };
    }

    // RainViewer Radar (即時降水雷達回波 - 免費 API 最高支援至 7 級，設定 maxzoom: 7 避免請求超額瓦片造成 "Zoom Level Not Supported")
    if (isRadarActive && radarTilePath) {
      style.sources['rainviewer-radar'] = {
        type: 'raster',
        tiles: [`${radarHost || 'https://tilecache.rainviewer.com'}${radarTilePath}/256/{z}/{x}/{y}/2/1_1.png`],
        tileSize: 256,
        maxzoom: 7
      };
    }

    // Crime Areas (罪案地區 - 各區犯罪率面圖層)
    if (layers.crimeAreas) {
      style.sources['crime_areas'] = { type: 'geojson', data: '/vancouver_crime_areas.geojson' };
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

      // 1. 車站透明點擊感應層 (22px 寬容感應，徹底解決手機與電腦難以精確點擊的問題)
      style.layers.push({
        id: 'skytrain-stops-hit-layer',
        type: 'circle',
        source: 'skytrain-stops',
        paint: {
          'circle-radius': 22,
          'circle-opacity': 0
        }
      });

      // 2. 車站外環 (顏色跟隨天車路線：Canada Line 碧藍 #0097a9、Millennium Line 金黃 #f59e0b、Expo Line 深藍 #0033a0)
      style.layers.push({
        id: 'skytrain-stops-layer',
        type: 'circle',
        source: 'skytrain-stops',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            10, ['case', ['get', 'is_interchange'], 6.5, 4.8],
            13, ['case', ['get', 'is_interchange'], 9.5, 7.2],
            16, ['case', ['get', 'is_interchange'], 12.5, 9.8]
          ],
          'circle-color': [
            'case',
            ['has', 'color'], ['get', 'color'],
            '#0033a0'
          ],
          'circle-stroke-width': [
            'interpolate', ['linear'], ['zoom'],
            10, 1.8,
            13, 2.5,
            16, 3.2
          ],
          'circle-stroke-color': '#ffffff'
        }
      });

      // 3. 車站白色圓心
      style.layers.push({
        id: 'skytrain-stops-inner-layer',
        type: 'circle',
        source: 'skytrain-stops',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            10, ['case', ['get', 'is_interchange'], 2.8, 2],
            13, ['case', ['get', 'is_interchange'], 4.5, 3.2],
            16, ['case', ['get', 'is_interchange'], 6, 4.5]
          ],
          'circle-color': '#ffffff'
        }
      });

      // 4. 車站文字標籤 (縮放層級 >= 12 時自動標註站名，點擊文字亦可直接打開資訊 Popup)
      style.layers.push({
        id: 'skytrain-stops-label-layer',
        type: 'symbol',
        source: 'skytrain-stops',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            12, 10,
            15, 12
          ],
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-optional': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0c1017',
          'text-halo-width': 2,
          'text-halo-blur': 0.5
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
      style.layers.push({
        id: 'seabus-stops-label-layer',
        type: 'symbol',
        source: 'seabus-stops',
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            11, 10,
            14, 12
          ],
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-optional': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0c1017',
          'text-halo-width': 2,
          'text-halo-blur': 0.5
        }
      });
    }

    // Road Facilities: TomTom Full-Street Live Traffic Flow Tiles (路況圖層：全大溫全部街道綠/黃/紅即時暢通度，僅限大溫哥華區域)
    if (layers.trafficConditions) {
      style.sources['tomtom_traffic_flow'] = {
        type: 'raster',
        tiles: [`${apiUrl}/api/traffic/tiles/{z}/{x}/{y}.png?style=relative&thickness=2`],
        tileSize: 256,
        bounds: [-123.28, 49.115, -122.892, 49.39],
        minzoom: 6,
        maxzoom: 19
      };
      style.layers.push({
        id: 'tomtom-traffic-flow-layer',
        type: 'raster',
        source: 'tomtom_traffic_flow',
        paint: {
          'raster-opacity': 0.95,
          'raster-fade-duration': 150
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
      const activeBikewayTypes = Object.entries(bikewaysFilter)
        .filter(([, active]) => active)
        .map(([type]) => type);

      const bikewayMapFilter = 
        activeBikewayTypes.length === 4 ? undefined :
        activeBikewayTypes.length === 0 ? ['==', ['get', 'bikeway_type'], '__NONE__'] :
        activeBikewayTypes.length === 1 ? ['==', ['get', 'bikeway_type'], activeBikewayTypes[0]] :
        ['any', ...activeBikewayTypes.map(t => ['==', ['get', 'bikeway_type'], t])];

      style.layers.push({
        id: 'bikeways-casing-layer',
        type: 'line',
        source: 'bikeways',
        ...(bikewayMapFilter ? { filter: bikewayMapFilter } : {}),
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
        ...(bikewayMapFilter ? { filter: bikewayMapFilter } : {}),
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
      style.sources['one_way_streets'] = { type: 'geojson', data: '/vancouver_one_way_streets.geojson' };
      style.layers.push({
        id: 'one-way-streets-casing-layer',
        type: 'line',
        source: 'one_way_streets',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#0F172A',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.2, 14, 5.6, 17, 8.8],
          'line-opacity': 0.95
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
          'line-color': '#FFFFFF',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14, 3.2, 17, 5.2],
          'line-dasharray': [2, 2],
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
          'text-color': '#FFFFFF',
          'text-halo-color': '#0F172A',
          'text-halo-width': 1.8
        }
      });
    }

    // Road Facilities: Snow Removal Routes (鏟雪路線 LineString / MultiLineString with Ice Blue Styling)
    if (layers.snowRemovalRoutes) {
      style.sources['snow_removal_routes'] = { type: 'geojson', data: '/vancouver_snow_removal_routes.geojson' };
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

    // Explore Traffic Tab: Major Highways & Bridges Only (探索 - 路況分頁：僅顯示 7 大主要公路與跨海橋隧之綠/黃/紅暢通度)
    const isExploreTrafficCorridorsVisible = isExploreOpen && exploreTab === 'traffic';
    if (isExploreTrafficCorridorsVisible) {
      style.sources['traffic_conditions'] = { 
        type: 'geojson', 
        data: `${apiUrl}/api/traffic/jams` 
      };

      const trafficLayerFilter = [
        'any',
        ['==', ['get', 'is_key_corridor'], true],
        ['in', ['get', 'corridor_group'], ['literal', ['hwy1', 'massey', 'lions_gate', 'knight', 'ironworkers', 'oak']]],
        ['in', ['get', 'id'], ['literal', ['hwy1_east', 'hwy1_west', 'massey_tunnel', 'lions_gate', 'knight_st_bridge', 'ironworkers_bridge', 'oak_st_bridge']]]
      ];

      // 底層暗色描邊 (外框線條立體感)
      style.layers.push({
        id: 'traffic-conditions-casing-layer',
        type: 'line',
        source: 'traffic_conditions',
        filter: trafficLayerFilter,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'coalesce',
            ['get', 'casing_color'],
            '#064e3b'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 12, 7.5, 15, 11, 18, 15],
          'line-opacity': 0.82
        }
      });
      // 核心路況色帶 (綠/黃/橘/紅 TomTom 主要公路與橋樑車速分級)
      style.layers.push({
        id: 'traffic-conditions-layer',
        type: 'line',
        source: 'traffic_conditions',
        filter: trafficLayerFilter,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'coalesce',
            ['get', 'color'],
            '#10b981'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.8, 12, 5.0, 15, 8.0, 18, 11],
          'line-opacity': 0.95
        }
      });
      // 主要公路與橋樑名稱及延誤標籤
      style.layers.push({
        id: 'traffic-conditions-label-layer',
        type: 'symbol',
        source: 'traffic_conditions',
        minzoom: 11.5,
        filter: trafficLayerFilter,
        layout: {
          'text-field': [
            'case',
            ['>', ['to-number', ['coalesce', ['get', 'delay_min'], 0]], 0],
            ['concat', ['get', 'name'], ' (+', ['to-string', ['get', 'delay_min']], '分)'],
            ['concat', ['get', 'name'], ' (暢通)']
          ],
          'symbol-placement': 'line-center',
          'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10, 14, 12],
          'text-offset': [0, -0.8],
          'text-anchor': 'bottom',
          'text-optional': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#111827',
          'text-halo-width': 2.5
        }
      });
    }

    // Road Facilities: Traffic Alerts (TomTom 即時突發事故與路況圖釘 Point — 僅於開啟「大眾通報」圖層時顯示)
    if (layers.trafficAlerts) {
      style.sources['traffic_alerts'] = { 
        type: 'geojson', 
        data: `${apiUrl}/api/traffic/alerts` 
      };
      // 外層警示微光光環 (柔和呼吸光芒)
      style.layers.push({
        id: 'traffic-alerts-pulse-layer',
        type: 'circle',
        source: 'traffic_alerts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 13, 13, 19, 16, 25],
          'circle-color': ['coalesce', ['get', 'color'], '#ef4444'],
          'circle-opacity': 0.18,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': ['coalesce', ['get', 'color'], '#ef4444'],
          'circle-stroke-opacity': 0.45
        }
      });
      // 核心高對比徽章底座 (白邊立體飽和圓標)
      style.layers.push({
        id: 'traffic-alerts-layer',
        type: 'circle',
        source: 'traffic_alerts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8.5, 13, 12, 16, 16],
          'circle-color': ['coalesce', ['get', 'color'], '#ef4444'],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      // 事故類別表情符號圖示 (💥/⚠️/⛔/🚧/🚗)
      style.layers.push({
        id: 'traffic-alerts-symbol-layer',
        type: 'symbol',
        source: 'traffic_alerts',
        layout: {
          'text-field': ['coalesce', ['get', 'icon'], '⚠️'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13, 16, 17],
          'text-allow-overlap': true
        }
      });
      // 事故摘要標籤 (典雅白字搭配深色陰影)
      style.layers.push({
        id: 'traffic-alerts-label-layer',
        type: 'symbol',
        source: 'traffic_alerts',
        minzoom: 12,
        layout: {
          'text-field': ['coalesce', ['get', 'type_label'], ['get', 'subtype_zh'], ['get', 'type_zh'], '即時通報'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 12],
          'text-offset': [0, 1.45],
          'text-anchor': 'top',
          'text-optional': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2.5
        }
      });
    }

    // Road Facilities: Road Closures (交通封閉)
    if (layers.roadClosures) {
      style.sources['road_closures'] = { type: 'geojson', data: '/vancouver_road_closures.geojson' };
      // 外框底線
      style.layers.push({
        id: 'road-closures-casing-layer',
        type: 'line',
        source: 'road_closures',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#4c0519',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 6.5, 16, 9],
          'line-opacity': 0.9
        }
      });
      // 警示純紅虛線
      style.layers.push({
        id: 'road-closures-layer',
        type: 'line',
        source: 'road_closures',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#DC2626',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4.2, 16, 6],
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.95
        }
      });
    }

    // Road Facilities: Road Construction (道路施工)
    if (layers.roadConstruction) {
      style.sources['road_construction'] = { type: 'geojson', data: '/vancouver_road_construction.geojson' };
      // 外框底線
      style.layers.push({
        id: 'road-construction-casing-layer',
        type: 'line',
        source: 'road_construction',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#451a03',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 6.5, 16, 9],
          'line-opacity': 0.9
        }
      });
      // 施工亮橘條紋線
      style.layers.push({
        id: 'road-construction-layer',
        type: 'line',
        source: 'road_construction',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#EA580C',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4.2, 16, 6],
          'line-dasharray': [3, 2],
          'line-opacity': 0.95
        }
      });
    }

    // Road Facilities: Parking Meters
    if (layers.parkingMeters) {
      // Cluster circle layer
      style.layers.push({
        id: 'parking-meters-cluster-layer',
        type: 'circle',
        source: 'parking-meters',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#3b82f6',
            50, '#2563eb',
            200, '#1d4ed8'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            50, 22,
            200, 28
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });
      // Cluster count text
      style.layers.push({
        id: 'parking-meters-cluster-count',
        type: 'symbol',
        source: 'parking-meters',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      // Single unclustered points
      style.layers.push({
        id: 'parking-meters-layer',
        type: 'circle',
        source: 'parking-meters',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#1D4ED8',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'parking-meters-symbol-layer',
        type: 'symbol',
        source: 'parking-meters',
        filter: ['!', ['has', 'point_count']],
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

    
    // Road Facilities: ImPark Lots
    if (layers.impark) {
      style.layers.push({
        id: 'impark-layer',
        type: 'circle',
        source: 'impark',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 14, 6, 15, 9, 17, 12],
          'circle-color': '#d9261c',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'impark-symbol-layer',
        type: 'symbol',
        source: 'impark',
        minzoom: 13,
        layout: {
          'text-field': 'P',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 8.5, 15, 10.5, 17, 12],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': false
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
          'circle-color': '#0284C7',
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
          'circle-color': '#1D4ED8',
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evFilters: any[] = ['all'];
      if (evChargingFilter.speed === 'fast') {
        evFilters.push(['>=', ['coalesce', ['get', 'power_kw'], 0], 50]);
      } else if (evChargingFilter.speed === 'slow') {
        evFilters.push(['<', ['coalesce', ['get', 'power_kw'], 0], 50]);
      }
      if (evChargingFilter.freeOnly) {
        evFilters.push(['==', ['coalesce', ['get', 'is_free'], false], true]);
      }
      if (evChargingFilter.connector && evChargingFilter.connector !== 'all') {
        evFilters.push(['!=', ['index-of', evChargingFilter.connector, ['coalesce', ['get', 'connectors'], '']], -1]);
      }
      const evFilterExpr = evFilters.length > 1 ? evFilters : undefined;

      style.layers.push({
        id: 'ev-charging-layer',
        type: 'circle',
        source: 'ev-charging',
        ...(evFilterExpr ? { filter: evFilterExpr } : {}),
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#059669',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'ev-charging-symbol-layer',
        type: 'symbol',
        source: 'ev-charging',
        ...(evFilterExpr ? { filter: evFilterExpr } : {}),
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
      const activeCarOps: string[] = [];
      if (carSharingFilter.evo) activeCarOps.push('Evo');
      if (carSharingFilter.modo) activeCarOps.push('Modo');

      const carFilter = 
        activeCarOps.length === 2 ? undefined :
        activeCarOps.length === 1 ? ['==', ['get', 'operator'], activeCarOps[0]] :
        ['==', ['get', 'operator'], '__NONE__'];

      style.layers.push({
        id: 'car-sharing-layer',
        type: 'circle',
        source: 'car-sharing',
        ...(carFilter ? { filter: carFilter } : {}),
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': ['match', ['get', 'operator'], 'Evo', '#0284C7', 'Modo', '#B91C1C', '#0284C7'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'car-sharing-symbol-layer',
        type: 'symbol',
        source: 'car-sharing',
        minzoom: 14,
        ...(carFilter ? { filter: carFilter } : {}),
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
          'circle-color': '#00A3AD',
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

    // Government Facilities: Fire Hydrants (消防栓 - 6,600+ 溫哥華市政消防栓，每1星期更新，高密度點位聚合)
    if (layers.fireHydrants) {
      style.sources['fire_hydrants'] = {
        type: 'geojson',
        data: '/vancouver_fire_hydrants.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45
      };

      // 1. Cluster background circle
      style.layers.push({
        id: 'fire-hydrants-cluster-layer',
        type: 'circle',
        source: 'fire_hydrants',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#ef4444', // < 20
            20,
            '#dc2626', // 20 - 100
            100,
            '#b91c1c'  // 100+
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            15,
            20,
            20,
            100,
            26
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.92
        }
      });

      // 2. Cluster count text
      style.layers.push({
        id: 'fire-hydrants-cluster-count',
        type: 'symbol',
        source: 'fire_hydrants',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      // 3. Single unclustered points glow
      style.layers.push({
        id: 'fire-hydrants-glow',
        type: 'circle',
        source: 'fire_hydrants',
        filter: ['!', ['has', 'point_count']],
        minzoom: 10,
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 12, 3, 15, 6, 17, 10],
          'circle-opacity': 0.35,
          'circle-blur': 0.8
        }
      });

      // 4. Single unclustered points core
      style.layers.push({
        id: 'fire-hydrants-layer',
        type: 'circle',
        source: 'fire_hydrants',
        filter: ['!', ['has', 'point_count']],
        minzoom: 10,
        paint: {
          'circle-color': '#dc2626',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 12, 2.5, 15, 4.2, 17, 6],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // 5. Single unclustered points icon
      style.layers.push({
        id: 'fire-hydrants-symbol-layer',
        type: 'symbol',
        source: 'fire_hydrants',
        filter: ['!', ['has', 'point_count']],
        minzoom: 15,
        layout: {
          'text-field': '🧯',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        }
      });
    }

    // Nature Facilities: Public Trees (街道樹木 - 溫哥華公有街道樹木，每1個月更新，高密度點位聚合渲染)
    if (layers.publicTrees) {
      style.sources['public_trees'] = {
        type: 'geojson',
        data: '/vancouver_public_trees.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45
      };

      // 1. Cluster background circle
      style.layers.push({
        id: 'public-trees-cluster-layer',
        type: 'circle',
        source: 'public_trees',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#10b981', // < 20
            20,
            '#059669', // 20 - 100
            100,
            '#047857'  // 100+
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            15,
            20,
            20,
            100,
            26
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.92
        }
      });

      // 2. Cluster count text
      style.layers.push({
        id: 'public-trees-cluster-count',
        type: 'symbol',
        source: 'public_trees',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      // 3. Single unclustered points glow
      style.layers.push({
        id: 'public-trees-glow',
        type: 'circle',
        source: 'public_trees',
        filter: ['!', ['has', 'point_count']],
        minzoom: 11,
        paint: {
          'circle-color': '#34d399',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 13, 3, 15, 6, 17, 10],
          'circle-opacity': 0.35,
          'circle-blur': 0.8
        }
      });

      // 4. Single unclustered points core
      style.layers.push({
        id: 'public-trees-layer',
        type: 'circle',
        source: 'public_trees',
        filter: ['!', ['has', 'point_count']],
        minzoom: 11,
        paint: {
          'circle-color': '#059669',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 13, 2.8, 15, 4.5, 17, 6.5],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // 5. Single unclustered points icon
      style.layers.push({
        id: 'public-trees-symbol-layer',
        type: 'symbol',
        source: 'public_trees',
        filter: ['!', ['has', 'point_count']],
        minzoom: 15.5,
        layout: {
          'text-field': '🌳',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10, 18, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true
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
          'circle-color': '#0284C7',
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let safetyCamFilterExpr: any = undefined;
      if (!safetyCamerasFilter.redLightSpeed && !safetyCamerasFilter.redLightOnly) {
        safetyCamFilterExpr = ['==', ['to-string', ['get', 'id']], '__none__'];
      } else if (safetyCamerasFilter.redLightSpeed && !safetyCamerasFilter.redLightOnly) {
        safetyCamFilterExpr = ['==', ['boolean', ['get', 'has_speed'], false], true];
      } else if (!safetyCamerasFilter.redLightSpeed && safetyCamerasFilter.redLightOnly) {
        safetyCamFilterExpr = ['!=', ['boolean', ['get', 'has_speed'], false], true];
      }

      style.layers.push({
        id: 'safety-cameras-layer',
        type: 'circle',
        source: 'safety-cameras',
        ...(safetyCamFilterExpr ? { filter: safetyCamFilterExpr } : {}),
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': [
            'case',
            ['boolean', ['get', 'has_speed'], false],
            '#111827', // 黑色: 闖紅燈+超速
            '#dc2626'  // 紅色: 闖紅燈
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'safety-cameras-symbol-layer',
        type: 'symbol',
        source: 'safety-cameras',
        ...(safetyCamFilterExpr ? { filter: safetyCamFilterExpr } : {}),
        minzoom: 15,
        layout: {
          'text-field': [
            'case',
            ['boolean', ['get', 'has_speed'], false],
            '🚨',
            '🛑'
          ],
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fuelFilterExpr: any = undefined;
      if (fuelFilter.brands && fuelFilter.brands.length > 0 && !fuelFilter.brands.includes('all')) {
        const conditions = fuelFilter.brands.map(b => {
          if (b === 'Petro-Canada') {
            return ['any', ['==', ['get', 'brand'], 'Petro-Canada'], ['==', ['get', 'brand'], 'Petro']];
          }
          if (b === 'Other') {
            return ['!', ['in', ['get', 'brand'], ['literal', ['Chevron', 'Shell', 'Petro-Canada', 'Petro', 'Esso', 'Mobil']]]];
          }
          return ['==', ['get', 'brand'], b];
        });
        fuelFilterExpr = conditions.length === 1 ? conditions[0] : ['any', ...conditions];
      }

      style.layers.push({
        id: 'fuel-layer',
        type: 'circle',
        source: 'fuel',
        ...(fuelFilterExpr ? { filter: fuelFilterExpr } : {}),
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
        ...(fuelFilterExpr ? { filter: fuelFilterExpr } : {}),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teslaFilters: any[] = ['all'];
      if (evChargingFilter.speed === 'fast') {
        teslaFilters.push(['>=', ['coalesce', ['get', 'power_kw'], 0], 50]);
      } else if (evChargingFilter.speed === 'slow') {
        teslaFilters.push(['<', ['coalesce', ['get', 'power_kw'], 0], 50]);
      }
      if (evChargingFilter.freeOnly) {
        teslaFilters.push(['==', ['get', 'sub_type'], 'destination_charger']);
      }
      if (evChargingFilter.connector && evChargingFilter.connector !== 'all' && evChargingFilter.connector !== 'Tesla') {
        teslaFilters.push(['==', ['get', 'sub_type'], 'none']);
      }
      const teslaFilterExpr = teslaFilters.length > 1 ? teslaFilters : undefined;

      style.layers.push({
        id: 'tesla-layer',
        type: 'circle',
        source: 'tesla',
        ...(teslaFilterExpr ? { filter: teslaFilterExpr } : {}),
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
        ...(teslaFilterExpr ? { filter: teslaFilterExpr } : {}),
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

    // Government: VanWiFi (溫哥華官方公共免費無線網絡)
    if (layers.vanWifi) {
      style.layers.push({
        id: 'van-wifi-cluster-layer',
        type: 'circle',
        source: 'van-wifi',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#06b6d4',
            10, '#0891b2',
            30, '#0e7490'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            10, 20,
            30, 24
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'van-wifi-cluster-count-layer',
        type: 'symbol',
        source: 'van-wifi',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 11,
          'text-font': ['Open Sans Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'van-wifi-layer',
        type: 'circle',
        source: 'van-wifi',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 16, 9],
          'circle-color': '#06b6d4',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'van-wifi-symbol-layer',
        type: 'symbol',
        source: 'van-wifi',
        filter: ['!', ['has', 'point_count']],
        minzoom: 14,
        layout: {
          'text-field': '📶',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        }
      });
    }

    // Nature: Coastal Tide Stations (大溫海岸潮汐與即時水位站 - 僅在海洋水文開啟)
    if (isExploreOpen && exploreTab === 'weather' && weatherSubTab === 'marine') {
      style.layers.push({
        id: 'tide-stations-layer',
        type: 'circle',
        source: 'tide-stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 12, 11, 15, 15],
          'circle-color': '#0284c7',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#38bdf8'
        }
      });
      style.layers.push({
        id: 'tide-stations-symbol-layer',
        type: 'symbol',
        source: 'tide-stations',
        layout: {
          'text-field': ['get', 'badge'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12, 16, 14],
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-font': ['Open Sans Bold']
        },
        paint: {
          'text-color': '#38bdf8',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2
        }
      });
    }

    // Precipitation Radar (即時降水雷達回波)
    if (isRadarActive && radarTilePath) {
      style.layers.push({
        id: 'rainviewer-radar-layer',
        type: 'raster',
        source: 'rainviewer-radar',
        paint: {
          'raster-opacity': 0.75,
          'raster-fade-duration': 150
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

    // Life Facilities: Food Banks (食物銀行與免費餐點計畫)
    if (layers.foodBanks) {
      style.layers.push({
        id: 'food-banks-layer',
        type: 'circle',
        source: 'food-banks',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#10b981',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'food-banks-symbol-layer',
        type: 'symbol',
        source: 'food-banks',
        minzoom: 15,
        layout: {
          'text-field': '🥫',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 14],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
    }

    // Life Facilities: Recycling (環保資源回收站)
    if (layers.recycling) {
      style.layers.push({
        id: 'recycling-layer',
        type: 'circle',
        source: 'recycling',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#0d9488',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'recycling-symbol-layer',
        type: 'symbol',
        source: 'recycling',
        minzoom: 14,
        layout: {
          'text-field': '♻️',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 17, 14],
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

    // Geography: Zoning Districts (土地規劃分區 - 每3個月更新)
    if (layers.zoningDistricts) {
      style.sources['zoning_districts'] = {
        type: 'geojson',
        data: '/vancouver_zoning_districts.geojson'
      };
      // 土地規劃半透明多邊形填色 (依都市計畫土地使用類別著色)
      style.layers.push({
        id: 'zoning-districts-fill',
        type: 'fill',
        source: 'zoning_districts',
        paint: {
          'fill-color': [
            'match',
            ['get', 'zoning_category'],
            'CD', '#818cf8',      // Comprehensive Development 綜合發展區 - 靛藍
            'RS', '#34d399',      // One-Family Residential 單戶住宅區 - 翠綠
            'RT', '#2dd4bf',      // Two-Family Residential 雙戶住宅區 - 青綠
            'RM', '#38bdf8',      // Multiple Dwelling 多戶集合住宅 - 天藍
            'C', '#fbbf24',       // Commercial 商業區 - 琥珀黃
            'FC', '#f97316',      // False Creek 假溪特區 - 橙色
            'M', '#a78bfa',       // Industrial 工業區 - 紫色
            'I', '#c084fc',       // Industrial 輕工業區 - 紫羅蘭
            'HA', '#f472b6',      // Historic Area 歷史街區 - 粉紅
            'RA', '#a3e635',      // Limited Agriculture 農業與受限區 - 青檸
            '#94a3b8'             // Default slate
          ],
          'fill-opacity': 0.28
        }
      });
      // 土地規劃分區邊界外框線
      style.layers.push({
        id: 'zoning-districts-line',
        type: 'line',
        source: 'zoning_districts',
        paint: {
          'line-color': [
            'match',
            ['get', 'zoning_category'],
            'CD', '#6366f1',
            'RS', '#059669',
            'RT', '#0d9488',
            'RM', '#0284c7',
            'C', '#d97706',
            'FC', '#ea580c',
            'M', '#7c3aed',
            'I', '#9333ea',
            'HA', '#db2777',
            'RA', '#65a30d',
            '#64748b'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 14, 2, 17, 3],
          'line-opacity': 0.8
        }
      });
      // 土地規劃分區代碼標籤 (例如 CD-1 (302), RS-1, C-2)
      style.layers.push({
        id: 'zoning-districts-label',
        type: 'symbol',
        source: 'zoning_districts',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'zoning_district'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 15, 11, 17, 13],
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#f8fafc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.8
        }
      });
    }

    // Utilities: Water Distribution Mains (自來水管道)
    if (layers.waterDistributionMains) {
      style.sources['water_distribution_mains'] = { type: 'geojson', data: '/vancouver_water_distribution_mains.geojson' };
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
      style.sources['sewer_mains'] = { type: 'geojson', data: '/vancouver_sewer_mains.geojson' };
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
      style.sources['traffic_speed_limits'] = { type: 'geojson', data: '/vancouver_traffic_speed_limits.geojson' };
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
          'line-color': '#F59E0B',
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
          'text-field': [
            'concat',
            ['to-string', ['case', ['<=', ['to-number', ['get', 'speed_limit']], 0], 30, ['get', 'speed_limit']]],
            ' km/h'
          ],
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
      style.sources['bike_racks'] = { 
        type: 'geojson', 
        data: '/vancouver_bike_racks.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
      };
      style.layers.push({
        id: 'bike-racks-cluster-layer',
        type: 'circle',
        source: 'bike_racks',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#0d9488',
            50, '#0f766e',
            200, '#115e59'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            50, 22,
            200, 28
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });
      style.layers.push({
        id: 'bike-racks-cluster-count',
        type: 'symbol',
        source: 'bike_racks',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'bike-racks-layer',
        type: 'circle',
        source: 'bike_racks',
        filter: ['!', ['has', 'point_count']],
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#065F46',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'bike-racks-symbol-layer',
        type: 'symbol',
        source: 'bike_racks',
        filter: ['!', ['has', 'point_count']],
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
      style.sources['postal_code_fsa'] = { type: 'geojson', data: '/vancouver_postal_code_fsa.geojson' };
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

    // Lifestyle: Public Art (公共藝術)
    if (layers.publicArt) {
      style.sources['public_art'] = { type: 'geojson', data: '/vancouver_public_art.geojson' };
      style.layers.push({
        id: 'public-art-layer',
        type: 'circle',
        source: 'public_art',
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5.5, 16, 8, 18, 10],
          'circle-color': '#c026d3',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'public-art-symbol-layer',
        type: 'symbol',
        source: 'public_art',
        minzoom: 14,
        layout: {
          'text-field': '🎨',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 15],
          'text-allow-overlap': false
        }
      });
    }

    // Lifestyle: Museums (38 博物館圖層 - 深灰色)
    if (layers.museums) {
      style.sources['museums'] = { type: 'geojson', data: '/vancouver_museums.geojson' };
      style.layers.push({
        id: 'museums-layer',
        type: 'circle',
        source: 'museums',
        minzoom: 10,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6.5, 16, 9, 18, 12],
          'circle-color': '#475569',
          'circle-stroke-width': 1.8,
          'circle-stroke-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'museums-symbol-layer',
        type: 'symbol',
        source: 'museums',
        minzoom: 13,
        layout: {
          'text-field': '🏛️',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 18, 16],
          'text-allow-overlap': false
        }
      });
    }

    // Lifestyle: Garbage Collection Zones (39 廢物回收圖層)
    if (layers.garbageCollection) {
      style.sources['garbage_collection'] = { type: 'geojson', data: '/vancouver_garbage_collection.geojson' };
      style.layers.push({
        id: 'garbage-collection-fill-layer',
        type: 'fill',
        source: 'garbage_collection',
        paint: {
          'fill-color': ['coalesce', ['get', 'color_hex'], '#f97316'],
          'fill-opacity': 0.22
        }
      });
      style.layers.push({
        id: 'garbage-collection-outline-layer',
        type: 'line',
        source: 'garbage_collection',
        paint: {
          'line-color': ['coalesce', ['get', 'color_hex'], '#f97316'],
          'line-width': 2.0,
          'line-opacity': 0.85
        }
      });
      style.layers.push({
        id: 'garbage-collection-label-layer',
        type: 'symbol',
        source: 'garbage_collection',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'zone_name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 2
        }
      });
    }

    // Utilities: Street Lighting Conduits (路燈地下配電管線)
    if (layers.streetLightingConduits) {
      style.sources['street_lighting_conduits'] = { 
        type: 'geojson', 
        data: '/vancouver_street_lighting_conduits.geojson'
      };
      // 路燈配電管線外發光
      style.layers.push({
        id: 'street-lighting-glow-layer',
        type: 'line',
        source: 'street_lighting_conduits',
        paint: {
          'line-color': '#eab308',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3, 17, 6],
          'line-opacity': 0.65,
          'line-blur': 1.5
        }
      });
      // 路燈配電管線核心亮黃線條
      style.layers.push({
        id: 'street-lighting-layer',
        type: 'line',
        source: 'street_lighting_conduits',
        paint: {
          'line-color': '#fef08a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 1.8, 17, 3.5],
          'line-opacity': 0.95
        }
      });
    }

    // Utilities: Street Lighting Poles (溫哥華市政公用路燈燈柱 - 58,000+ 燈柱)
    if (layers.streetLighting) {
      style.sources['street_lighting_poles'] = { 
        type: 'geojson', 
        data: '/vancouver_street_lighting_poles.geojson'
      };
      // 外層暖黃微光光暈
      style.layers.push({
        id: 'street-lighting-poles-glow',
        type: 'circle',
        source: 'street_lighting_poles',
        paint: {
          'circle-color': '#f59e0b',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 4, 16, 7, 18, 10],
          'circle-opacity': 0.45,
          'circle-blur': 0.8
        }
      });
      // 內層路燈燈柱光點
      style.layers.push({
        id: 'street-lighting-poles-layer',
        type: 'circle',
        source: 'street_lighting_poles',
        paint: {
          'circle-color': '#fef08a',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 14, 2.2, 16, 3.5, 18, 5],
          'circle-opacity': 0.95,
          'circle-stroke-color': '#b45309',
          'circle-stroke-width': 0.8
        }
      });
    }

    // Geography: Beach Water Quality (大溫海灘水質)
    if (layers.beachWaterQuality) {
      style.sources['beach_water_quality'] = { 
        type: 'geojson', 
        data: `${apiUrl}/api/geojson/beach-water`
      };
      // 海灘水質多邊形半透明填充
      style.layers.push({
        id: 'beach-water-fill-layer',
        type: 'fill',
        source: 'beach_water_quality',
        paint: {
          'fill-color': [
            'match',
            ['get', 'status'],
            'safe', '#10b981',
            'advisory', '#f59e0b',
            'warning', '#ef4444',
            '#06b6d4'
          ],
          'fill-opacity': 0.38
        }
      });
      // 海灘水質多邊形邊界
      style.layers.push({
        id: 'beach-water-outline-layer',
        type: 'line',
        source: 'beach_water_quality',
        paint: {
          'line-color': [
            'match',
            ['get', 'status'],
            'safe', '#059669',
            'advisory', '#d97706',
            'warning', '#dc2626',
            '#0891b2'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 17, 4.5],
          'line-opacity': 0.9
        }
      });
      // 海灘水質名稱標記
      style.layers.push({
        id: 'beach-water-symbol-layer',
        type: 'symbol',
        source: 'beach_water_quality',
        minzoom: 11,
        layout: {
          'text-field': ['concat', '🏖️ ', ['get', 'name']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12, 17, 14],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'center',
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2
        }
      });
    }

    // Road: Traffic Crosswalks (斑馬線)
    if (layers.trafficCrosswalks) {
      style.sources['traffic_crosswalks'] = { 
        type: 'geojson', 
        data: '/vancouver_traffic_crosswalks.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
      };
      style.layers.push({
        id: 'traffic-crosswalks-cluster-layer',
        type: 'circle',
        source: 'traffic_crosswalks',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#eab308',
            50, '#ca8a04',
            200, '#a16207'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            50, 22,
            200, 28
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });
      style.layers.push({
        id: 'traffic-crosswalks-cluster-count',
        type: 'symbol',
        source: 'traffic_crosswalks',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'traffic-crosswalks-layer',
        type: 'circle',
        source: 'traffic_crosswalks',
        filter: ['!', ['has', 'point_count']],
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 15, 8, 17, 10],
          'circle-color': '#FEF3C7',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#D97706'
        }
      });
      style.layers.push({
        id: 'traffic-crosswalks-symbol-layer',
        type: 'symbol',
        source: 'traffic_crosswalks',
        filter: ['!', ['has', 'point_count']],
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
      style.sources['litter_containers'] = { 
        type: 'geojson', 
        data: '/vancouver_litter_containers.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
      };
      style.layers.push({
        id: 'litter-containers-cluster-layer',
        type: 'circle',
        source: 'litter_containers',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#d97706',
            50, '#b45309',
            200, '#92400e'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            50, 22,
            200, 28
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });
      style.layers.push({
        id: 'litter-containers-cluster-count',
        type: 'symbol',
        source: 'litter_containers',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
        },
        paint: {
          'text-color': '#ffffff'
        }
      });
      style.layers.push({
        id: 'litter-containers-layer',
        type: 'circle',
        source: 'litter_containers',
        filter: ['!', ['has', 'point_count']],
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
        filter: ['!', ['has', 'point_count']],
        minzoom: 15,
        layout: {
          'text-field': '🗑️',
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 14],
          'text-allow-overlap': false
        }
      });
    }

    // 周邊半徑探索範圍圓形圖層 (Nearby Exploration Radius Circle)
    if (radiusCircleGeoJSON) {
      style.sources['radius-circle-source'] = {
        type: 'geojson',
        data: radiusCircleGeoJSON
      };
      style.layers.push({
        id: 'radius-circle-fill',
        type: 'fill',
        source: 'radius-circle-source',
        paint: {
          'fill-color': '#0ea5e9',
          'fill-opacity': 0.12
        }
      });
      style.layers.push({
        id: 'radius-circle-line',
        type: 'line',
        source: 'radius-circle-source',
        paint: {
          'line-color': '#0ea5e9',
          'line-width': 2.5,
          'line-dasharray': [3, 2],
          'line-opacity': 0.85
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
    parkingMeterFilter.maxRate,
    parkingMeterFilter.creditCardOnly,
    parkingMeterFilter.timePeriod,
    radiusCircleGeoJSON,
    layers.impark,
    layers.accessibleParking, 
    layers.motorcycleParking, 
    motorcycleParkingFilter.maxRate,
    motorcycleParkingFilter.creditCardOnly,
    motorcycleParkingFilter.timePeriod,
    layers.evCharging, 
    layers.escooter,
    layers.carSharing,
    carSharingFilter.evo,
    carSharingFilter.modo,
    layers.sharedBikes,
    layers.bikeways,
    bikewaysFilter['Protected Bike Lanes'],
    bikewaysFilter['Painted Lanes'],
    bikewaysFilter['Local Street'],
    bikewaysFilter['Shared Lanes'],
    layers.trafficCameras,
    layers.safetyCameras,
    safetyCamerasFilter.redLightSpeed,
    safetyCamerasFilter.redLightOnly,
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
    layers.foodBanks,
    layers.recycling,
    layers.aed,
    layers.homelessShelters,
    layers.contours,
    layers.localAreaBoundary,
    layers.fuel,
    fuelFilter.brands,
    layers.tesla,
    layers.evCharging,
    evChargingFilter.speed,
    evChargingFilter.connector,
    evChargingFilter.freeOnly,
    layers.vanWifi,
    layers.tideStations,
    isRadarActive,
    radarTilePath,
    radarHost,
    layers.oneWayStreets,
    layers.snowRemovalRoutes,
    layers.marineTerminals,
    layers.crimeAreas,
    layers.waterDistributionMains,
    layers.sewerMains,
    layers.trafficSpeedLimits,
    layers.bikeRacks,
    layers.postalCodeFSA,
    layers.publicArt,
    layers.trafficConditions,
    layers.trafficAlerts,
    layers.roadClosures,
    layers.roadConstruction,
    layers.streetLighting,
    layers.streetLightingConduits,
    layers.beachWaterQuality,
    layers.fireHydrants,
    layers.zoningDistricts,
    layers.trafficCrosswalks,
    layers.litterContainers,
    layers.publicTrees,
    layers.museums,
    layers.garbageCollection,
    contourInterval,
    mapStyleType,
    isExploreOpen,
    exploreTab,
    weatherSubTab
  ]);

  const getFloatingPanelPos = (offsetIdx: number) => {
    switch (offsetIdx) {
      case 0:
        return 'top-[96px] left-4 md:left-[256px]';
      case 1:
        return 'top-[156px] md:top-[96px] left-4 md:left-[568px]';
      case 2:
        return 'top-[216px] md:top-[96px] left-4 md:left-[880px]';
      case 3:
        return 'top-[276px] md:top-[96px] left-4 md:left-[1190px]';
      case 4:
        return 'top-[336px] md:top-[96px] left-4 md:left-[1480px]';
      default:
        return 'top-[396px] md:top-[244px] left-4 md:left-[256px]';
    }
  };

  return (
    <div 
      className={`absolute top-[60px] bottom-0 right-0 h-[calc(100vh-60px)] z-0 transition-[left,width] duration-200 overflow-hidden ${
        isLayerPanelOpen ? 'left-[240px] w-[calc(100%-240px)]' : 'left-0 w-full'
      }`}
    >
      <Map
        ref={mapRef}
        canvasContextAttributes={{ preserveDrawingBuffer: true, antialias: true }}
        initialViewState={{ longitude: -123.05, latitude: 49.25, zoom: 11, pitch: 0, bearing: 0 }}
        maxZoom={20}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        onMove={(e: any) => {
          updateScale();
          if (e.viewState?.zoom !== undefined) setCurrentZoom(e.viewState.zoom);
        }}
        onZoom={(e: any) => {
          updateScale();
          if (e.viewState?.zoom !== undefined) setCurrentZoom(e.viewState.zoom);
        }}
        onLoad={(e: any) => {
          updateScale();
          const z = e.target?.getZoom ? e.target.getZoom() : e.viewState?.zoom;
          if (z !== undefined) setCurrentZoom(z);
        }}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
        onContextMenu={handleMapContextMenu}
        onSourceData={handleMapSourceData}
        onIdle={handleMapIdle}
        interactiveLayerIds={[
          'bus-stops-layer', 
          'skytrain-stops-hit-layer',
          'skytrain-stops-layer', 
          'skytrain-stops-inner-layer',
          'skytrain-stops-label-layer',
          'seabus-stops-layer',
          'seabus-stops-label-layer',
          'bikeways-layer',
          'parking-meters-cluster-layer',
          'parking-meters-layer',
          'parking-meters-symbol-layer',
          'impark-layer',
          'impark-symbol-layer',
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
          'food-banks-layer',
          'food-banks-symbol-layer',
          'recycling-layer',
          'recycling-symbol-layer',
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
          'bike-racks-cluster-layer',
          'bike-racks-layer',
          'bike-racks-symbol-layer',
          'public-art-layer',
          'public-art-symbol-layer',
          'museums-layer',
          'museums-symbol-layer',
          'garbage-collection-fill-layer',
          'garbage-collection-outline-layer',
          'traffic-crosswalks-cluster-layer',
          'traffic-crosswalks-layer',
          'traffic-crosswalks-symbol-layer',
          'litter-containers-cluster-layer',
          'litter-containers-layer',
          'litter-containers-symbol-layer',
          'water-distribution-mains-layer',
          'sewer-mains-layer',
          'contours-layer',
          'contours-label-layer',
          'van-wifi-cluster-layer',
          'van-wifi-layer',
          'van-wifi-symbol-layer',
          'tide-stations-layer',
          'tide-stations-symbol-layer',
          'traffic-conditions-casing-layer',
          'traffic-conditions-layer',
          'traffic-conditions-label-layer',
          'traffic-alerts-pulse-layer',
          'traffic-alerts-layer',
          'traffic-alerts-symbol-layer',
          'traffic-alerts-label-layer',
          'road-closures-casing-layer',
          'road-closures-layer',
          'road-construction-casing-layer',
          'road-construction-layer',
          'street-lighting-cluster-layer',
          'street-lighting-layer',
          'street-lighting-symbol-layer',
          'fire-hydrants-cluster-layer',
          'fire-hydrants-layer',
          'fire-hydrants-symbol-layer',
          'zoning-districts-fill',
          'public-trees-cluster-layer',
          'public-trees-layer',
          'public-trees-symbol-layer'
        ]}
        onClick={(e) => {
          if (contextMenu) {
            setContextMenu(null);
          }
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
            // 只有點擊搜尋卡片右上角 X 按鈕時才關閉路線，點擊地圖背景不關閉 searchedBusRoute
            setSelectedTrain(null);
            setSelectedSkytrainStation(null);
            setSelectedTerminal(null);
            setSelectedFerry(null);
            if (searchTarget?.category !== 'bus_route') {
              setSearchTarget(null);
            }
            return;
          }

          const layerId = feature.layer.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (feature.geometry as any).coordinates;

          // 處理高密度聚類點位點擊 (點擊數字圓圈平滑放大至街區層級展開)
          if (feature.properties?.cluster || layerId.includes('-cluster-')) {
            const clusterId = feature.properties?.cluster_id;
            const sourceName = feature.layer.source;
            const map = mapRef.current?.getMap();
            if (map && clusterId !== undefined && sourceName) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const src: any = map.getSource(sourceName);
              if (src && typeof src.getClusterExpansionZoom === 'function') {
                src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
                  if (!err && zoom !== undefined) {
                    map.easeTo({
                      center: coords,
                      zoom: Math.min(zoom, 18),
                      duration: 400
                    });
                  }
                });
                return;
              }
            }
            map?.easeTo({
              center: coords,
              zoom: (map.getZoom() || 12) + 2,
              duration: 400
            });
            return;
          }

          if (
            layerId === 'skytrain-stops-layer' || 
            layerId === 'skytrain-stops-hit-layer' || 
            layerId === 'skytrain-stops-inner-layer' || 
            layerId === 'skytrain-stops-label-layer'
          ) {
            setSelectedFacility(null);
            setSelectedStop(null);
            setSelectedBus(null);
            setSelectedTrain(null);
            const stopId = feature.properties?.stop_id || feature.properties?.id;
            const stopName = feature.properties?.name || '天車站';
            const clickLon = coords?.[0] ?? e.lngLat?.lng;
            const clickLat = coords?.[1] ?? e.lngLat?.lat;
            fetchSkytrainStationSchedule(String(stopId), stopName, clickLon, clickLat);
            return;
          } else if (layerId === 'bus-stops-layer' || layerId === 'seabus-stops-layer' || layerId === 'seabus-stops-label-layer') {
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
              name: 'Water Distribution Mains',
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
              name: 'Sewer Mains',
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
            const props = { ...(feature.properties || {}) };
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            if (!props.speed_limit || Number(props.speed_limit) <= 0) {
              const isRes = (props.segment_type || '').toLowerCase().includes('residential');
              props.speed_limit = isRes ? 30 : 50;
              if (props.name) {
                props.name = props.name.replace(/限速 0 km\/h/g, `限速 ${props.speed_limit} km/h`);
              }
            }
            const cleanSpeedRoadName = (props.hblock || props.name || '速限管制路段')
              .replace(/\s*\(限速.*?\)/g, '')
              .replace(/\s*\(Speed.*?\)/g, '')
              .trim();
            setSelectedFacility({
              id: props.object_id ? `speed_${props.object_id}` : `speed_${clickLon}_${clickLat}`,
              facility_type: 'traffic_speed_limits',
              name: cleanSpeedRoadName,
              local_area: '限速路段',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'traffic-conditions-layer' || layerId === 'traffic-conditions-casing-layer' || layerId === 'traffic-conditions-label-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            setSelectedFacility({
              id: props.id ? `traffic_${props.id}` : `traffic_${clickLon}_${clickLat}`,
              facility_type: 'traffic_conditions',
              name: props.name || '即時路況色帶',
              local_area: props.street || props.corridor || props.city || '大溫主要幹道',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId.startsWith('traffic-alerts')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            let clickLon = e.lngLat?.lng ?? -123.1207;
            let clickLat = e.lngLat?.lat ?? 49.2827;
            if (feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
              clickLon = feature.geometry.coordinates[0];
              clickLat = feature.geometry.coordinates[1];
            }
            const alertCat = props.type_label || props.subtype_zh || props.type_zh || props.category_zh || props.category || '即時通報';
            setSelectedFacility({
              id: props.id ? `traffic_alert_${props.id}` : `traffic_alert_${clickLon}_${clickLat}`,
              facility_type: 'traffic_alerts',
              name: alertCat,
              local_area: props.street || props.city || '大溫突發事故',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'road-closures-layer' || layerId === 'road-closures-casing-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? (props.geo_point_2d?.lon || -123.1207);
            const clickLat = e.lngLat?.lat ?? (props.geo_point_2d?.lat || 49.2827);
            setSelectedFacility({
              id: props.id || `closure_${clickLon}_${clickLat}`,
              facility_type: 'road_closures',
              name: props.name || props.project || '交通封閉路段',
              local_area: props.location || props.street || '溫哥華工程道路封閉',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId === 'road-construction-layer' || layerId === 'road-construction-casing-layer') {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? (props.geo_point_2d?.lon || -123.1207);
            const clickLat = e.lngLat?.lat ?? (props.geo_point_2d?.lat || 49.2827);
            setSelectedFacility({
              id: props.id || `construction_${clickLon}_${clickLat}`,
              facility_type: 'road_construction',
              name: props.name || props.project || '道路施工路段',
              local_area: props.location || props.street || '溫哥華道路維修與施工',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId.startsWith('beach-water')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? (props.center_lon || -123.1441);
            const clickLat = e.lngLat?.lat ?? (props.center_lat || 49.2845);
            setSelectedFacility({
              id: props.id || `beach_${clickLon}_${clickLat}`,
              facility_type: 'beach_water_quality',
              name: props.name || '海灘水質監測',
              local_area: props.municipality ? `${props.municipality} ${props.area ? `· ${props.area}` : ''}` : (props.area || '大溫公眾海灘'),
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId.startsWith('street-lighting-poles')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const poleCoords = feature.geometry?.type === 'Point' 
              ? (feature.geometry.coordinates as [number, number]) 
              : [e.lngLat?.lng ?? -123.1207, e.lngLat?.lat ?? 49.2827];
            const block = props.block_number || '';
            const node = props.node_number !== undefined ? props.node_number : '';
            setSelectedFacility({
              id: props.id || `pole_${block}_${node}`,
              facility_type: 'street_lighting',
              name: block ? `路燈燈柱 (${block} 號街區 #${node})` : '路燈燈柱',
              local_area: props.local_area || props.geo_local_area || '溫哥華市政公用照明',
              lon: poleCoords[0],
              lat: poleCoords[1],
              properties: props
            });
          } else if (layerId.startsWith('street-lighting')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            const wireset = props.wireset_type || '標準線組';
            setSelectedFacility({
              id: props.id || `conduit_${clickLon}_${clickLat}`,
              facility_type: 'street_lighting_conduits',
              name: 'Street Lighting Conduits',
              local_area: props.local_area || '溫哥華市政路燈配電管網',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId.startsWith('fire-hydrants')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const hydCoords = feature.geometry?.type === 'Point' 
              ? (feature.geometry.coordinates as [number, number]) 
              : [e.lngLat?.lng ?? -123.1207, e.lngLat?.lat ?? 49.2827];
            const street = props.street || '';
            const hydId = props.id || props.oldhydnum || '';
            setSelectedFacility({
              id: props.id || `hydrant_${hydCoords[0]}_${hydCoords[1]}`,
              facility_type: 'fire_hydrants',
              name: street || (hydId ? `市政消防栓 #${hydId}` : '市政消防栓'),
              local_area: props.geo_local_area || 'Vancouver, BC',
              lon: hydCoords[0],
              lat: hydCoords[1],
              properties: props
            });
          } else if (layerId.startsWith('zoning-districts')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const clickLon = e.lngLat?.lng ?? -123.1207;
            const clickLat = e.lngLat?.lat ?? 49.2827;
            const dist = props.zoning_district || '';
            const cat = props.zoning_category || '';
            setSelectedFacility({
              id: props.object_id ? `zoning_${props.object_id}` : `zoning_${clickLon}_${clickLat}`,
              facility_type: 'zoning_districts',
              name: dist ? `土地規劃分區 - ${dist}` : '土地規劃分區',
              local_area: props.zoning_classification ? `${props.zoning_classification} (${cat})` : '溫哥華土地規劃分區 (每3個月更新)',
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else if (layerId.startsWith('public-trees')) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const treeCoords = feature.geometry?.type === 'Point' 
              ? (feature.geometry.coordinates as [number, number]) 
              : [e.lngLat?.lng ?? -123.1207, e.lngLat?.lat ?? 49.2827];
            const treeId = props.tree_id || props.id || '';
            const cName = props.common_name || props.name || '街道樹木';
            setSelectedFacility({
              id: props.id || `tree_${treeId || `${treeCoords[0]}_${treeCoords[1]}`}`,
              facility_type: 'public_trees',
              name: cName,
              local_area: props.neighbourhood_name ? `${props.neighbourhood_name} · ${props.address || '街道樹木'}` : (props.address || '溫哥華市政公有林木 (每1個月更新)'),
              lon: treeCoords[0],
              lat: treeCoords[1],
              properties: props
            });
          } else if (
            layerId.startsWith('impark') ||
            layerId.startsWith('parking-meters') || 
            layerId.startsWith('accessible-parking') || 
            layerId.startsWith('motorcycle-parking') || 
            layerId.startsWith('ev-charging') ||
            layerId.startsWith('escooter') ||
            layerId.startsWith('car-sharing') ||
            layerId.startsWith('shared-bikes') ||
            layerId.startsWith('bike-racks') ||
            layerId.startsWith('public-art') ||
            layerId.startsWith('traffic-conditions') ||
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
            layerId.startsWith('food-banks') ||
            layerId.startsWith('recycling') ||
            layerId.startsWith('aed') ||
            layerId.startsWith('homeless-shelters') ||
            layerId.startsWith('van-wifi') ||
            layerId.startsWith('tide-stations') ||
            layerId.startsWith('museums') ||
            layerId.startsWith('garbage-collection')
          ) {
            setSelectedStop(null);
            const props = feature.properties || {};
            const isFuel = layerId.startsWith('fuel');
            const isTesla = layerId.startsWith('tesla');
            const isMarineTerminal = layerId.startsWith('marine-terminals');
            const isBikeRack = layerId.startsWith('bike-racks');
            const isPublicArt = layerId.startsWith('public-art');
            const isImpark = layerId.startsWith('impark');
            const isMuseums = layerId.startsWith('museums');
            const isGarbage = layerId.startsWith('garbage-collection');
            const isTraffic = layerId.startsWith('traffic-conditions');
            const isStreetLighting = layerId.startsWith('street-lighting') || layerId.startsWith('street_lighting');
            const isCrosswalk = layerId.startsWith('traffic-crosswalks');
            const isLitter = layerId.startsWith('litter-containers');
            const isRecycling = layerId.startsWith('recycling');
            const isVanWifi = layerId.startsWith('van-wifi');
            const isTideStation = layerId.startsWith('tide-stations');
            const derivedFacilityType = layerId
              .replace(/-(?:symbol|cluster|casing|label|glow|hit|inner|fill|line|outline)-layer$/, '')
              .replace(/-(?:layer|fill|line|label|glow|arrows)$/, '')
              .replace(/-/g, '_');
            const clickLon = e.lngLat?.lng ?? (Array.isArray(coords[0]) ? (Array.isArray(coords[0][0]) ? coords[0][0][0] : coords[0][0]) : coords[0]);
            const clickLat = e.lngLat?.lat ?? (Array.isArray(coords[0]) ? (Array.isArray(coords[0][1]) ? coords[0][0][1] : coords[0][1]) : coords[1]);

            let facilityType = props.facility_type || derivedFacilityType || 'fac';
            if (isImpark) facilityType = 'impark';
            else if (isMuseums) facilityType = 'museums';
            else if (isGarbage) facilityType = 'garbage_collection';
            else if (isPublicArt) facilityType = 'public_art';
            else if (isTraffic) facilityType = 'traffic_conditions';
            else if (isStreetLighting) facilityType = 'street_lighting';
            else if (isVanWifi) facilityType = 'van_wifi';
            else if (isTideStation) facilityType = 'tide_stations';
            else if (isFuel) facilityType = 'fuel';
            else if (isTesla) facilityType = 'tesla';
            else if (isMarineTerminal) facilityType = 'marine_terminals';
            else if (isBikeRack) facilityType = 'bike_racks';
            else if (isCrosswalk) facilityType = 'traffic_crosswalks';
            else if (isLitter) facilityType = 'litter_containers';
            else if (isRecycling) facilityType = 'recycling';

            let facilityName = props.name;
            if (!facilityName) {
              if (isImpark) facilityName = props.lot_name || ('ImPark Lot ' + props.lot_number);
              else if (isGarbage) facilityName = props.zone_name || '廢物回收分區';
              else if (isMuseums) facilityName = props.name || '博物館';
              else if (isPublicArt) facilityName = props.sitename || props.title_of_work || '公共藝術';
              else if (isTraffic) facilityName = '獅門大橋即時路況';
              else if (isStreetLighting) facilityName = props.pole_number ? `路燈柱 #${props.pole_number}` : (props.service_panel_number ? `路燈控制盤 #${props.service_panel_number}` : '路燈');
              else if (isVanWifi) facilityName = props.site_name || 'VanWiFi 公共無線網絡';
              else if (isTideStation) facilityName = props.english_name || '潮汐水位';
              else if (isCrosswalk) facilityName = props.location || '行人穿越道';
              else if (isLitter) facilityName = props.address ? `垃圾箱 - ${props.address}` : '公用垃圾箱';
              else if (isBikeRack) facilityName = props.location ? `單車架 - ${props.location}` : '公用單車架';
              else if (isRecycling) facilityName = props.brand || '環保回收站';
              else if (isFuel) facilityName = props.brand || '加油站';
              else if (isTesla) facilityName = 'Tesla 站點';
              else if (isMarineTerminal) facilityName = '港口碼頭';
            }

            let facilityLocalArea = '';
            if (isGarbage) facilityLocalArea = props.zone_code || '';
            else if (isMuseums) facilityLocalArea = props.address || '';
            else if (isPublicArt) facilityLocalArea = props.siteaddress || props.local_area || '';
            else if (isCrosswalk) facilityLocalArea = '行人穿越道';
            else facilityLocalArea = props.waterway || props.area || props.local_area || props.location || props.company || props.address || props.city || '';

            setSelectedFacility({
              id: props.id || (props.object_id ? `${facilityType}_${props.object_id}` : (props.registryid ? `art_${props.registryid}` : '')),
              facility_type: facilityType,
              name: facilityName || '設施',
              local_area: facilityLocalArea,
              lon: clickLon,
              lat: clickLat,
              properties: props
            });
          } else {
            setSelectedStop(null);
            setSelectedFacility(null);
            setSelectedAirport(null);
            setSelectedFlight(null);
            setSelectedBus(null);
            setBusDetails(null);
            // 只有點擊搜尋卡片右上角 X 按鈕時才關閉路線，點擊地圖其他圖層不關閉 searchedBusRoute
            if (searchTarget?.category !== 'bus_route') {
              setSearchTarget(null);
            }
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

        {/* 選中商船之深水航道與航行航線軌跡 (Selected Maritime Vessel Navigation Route) */}
        {vesselRouteGeoJSON && (
          <Source id="selected-vessel-route-source" type="geojson" data={vesselRouteGeoJSON}>
            <Layer
              id="selected-vessel-route-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#06b6d4',
                'line-width': 8,
                'line-blur': 4,
                'line-opacity': 0.65
              }}
            />
            <Layer
              id="selected-vessel-route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#22d3ee',
                'line-width': 3.2,
                'line-dasharray': [2, 1]
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

        {/* 選中主要幹道或主要道路之路線高亮軌跡 (Selected Traffic Corridor / Major Road Route Overlay) */}
        {corridorRouteGeoJSON && (
          <Source id="selected-corridor-route-source" type="geojson" data={corridorRouteGeoJSON}>
            <Layer
              id="selected-corridor-route-glow"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#f97316',
                'line-width': 10,
                'line-blur': 4,
                'line-opacity': 0.65
              }}
            />
            <Layer
              id="selected-corridor-route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': '#ea580c',
                'line-width': 5,
                'line-opacity': 0.95
              }}
            />
          </Source>
        )}

        {/* 搜尋目標高亮光環 (Search Target Focus Ring) - 巴士路線等整條路線不顯示中心點閃爍標記 */}
        {searchTarget && searchTarget.category !== 'bus_route' && searchTarget.category !== 'ferry_vehicle' && searchTarget.category !== 'traffic_corridor' && (
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

        {/* 個人設定位置標記 (User Confirmed Personal Location / Realtime GPS) */}
        {userLocation?.confirmed && userLocation.lat && userLocation.lon && (
          <Marker 
            longitude={userLocation.lon} 
            latitude={userLocation.lat} 
            anchor={userLocation.address?.includes('GPS') || userLocation.displayName?.includes('GPS') ? 'center' : 'bottom'}
          >
            {userLocation.address?.includes('GPS') || userLocation.displayName?.includes('GPS') ? (
              <div 
                className="group relative flex items-center justify-center cursor-pointer z-40 select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  mapRef.current?.flyTo({
                    center: [userLocation.lon!, userLocation.lat!],
                    zoom: 16,
                    duration: 800
                  });
                }}
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2.5 py-1 rounded-md bg-gray-900/95 text-white text-[11px] font-medium whitespace-nowrap shadow-xl pointer-events-none border border-sky-500/50 z-50">
                  <span>📍 我的目前即時位置 (GPS)</span>
                </div>
                <div className="relative flex items-center justify-center pointer-events-auto">
                  <span className="animate-ping absolute inline-flex h-9 w-9 rounded-full bg-sky-400 opacity-60"></span>
                  <span className="absolute inline-flex h-6 w-6 rounded-full bg-sky-500/30 border border-sky-400"></span>
                  <div className="relative inline-flex rounded-full h-4 w-4 bg-sky-500 border-2 border-white shadow-[0_0_12px_rgba(14,165,233,0.9)]"></div>
                </div>
              </div>
            ) : (
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
            )}
          </Marker>
        )}

        {/* 周邊探索中心點標記 (Radius Exploration Center Marker) */}
        {radiusExploration?.active && (
          <Marker 
            longitude={radiusExploration.lon} 
            latitude={radiusExploration.lat} 
            anchor="center"
          >
            <div className="relative flex items-center justify-center pointer-events-none select-none">
              <span className="animate-ping absolute inline-flex h-10 w-10 rounded-full bg-cyan-400 opacity-60"></span>
              <div className="relative inline-flex rounded-full h-7 w-7 bg-cyan-500 border-2 border-white shadow-2xl items-center justify-center text-xs text-white">
                🎯
              </div>
            </div>
          </Marker>
        )}

        {/* 周邊探索選中設施之專屬常駐標記 (即使所屬圖層未開啟亦常駐顯示，直至關閉周邊半徑探索) */}
        {radiusExploration?.active && explorationSelectedFacility && explorationSelectedFacility.lon && explorationSelectedFacility.lat && (
          <Marker
            longitude={Number(explorationSelectedFacility.lon)}
            latitude={Number(explorationSelectedFacility.lat)}
            anchor="bottom"
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                lastInteractiveItemClickRef.current = Date.now();
                if (
                  explorationSelectedFacility.facility_type === 'skytrain_stations' || 
                  explorationSelectedFacility.facility_type === 'skytrain_station'
                ) {
                  setSelectedFacility(null);
                  setSelectedStop(null);
                  fetchSkytrainStationSchedule(
                    String(explorationSelectedFacility.id),
                    explorationSelectedFacility.name,
                    Number(explorationSelectedFacility.lon),
                    Number(explorationSelectedFacility.lat)
                  );
                } else if (
                  explorationSelectedFacility.facility_type === 'bus_stops' ||
                  explorationSelectedFacility.facility_type === 'bus_stop'
                ) {
                  setSelectedFacility(null);
                  setSelectedSkytrainStation(null);
                  setSelectedStop({
                    id: String(explorationSelectedFacility.id),
                    name: explorationSelectedFacility.name,
                    lon: Number(explorationSelectedFacility.lon),
                    lat: Number(explorationSelectedFacility.lat)
                  });
                  fetchArrivals(String(explorationSelectedFacility.id));
                } else {
                  setSelectedStop(null);
                  setSelectedSkytrainStation(null);
                  setSelectedFacility({
                    id: explorationSelectedFacility.id,
                    facility_type: explorationSelectedFacility.facility_type,
                    name: explorationSelectedFacility.name,
                    local_area: explorationSelectedFacility.local_area,
                    lon: Number(explorationSelectedFacility.lon),
                    lat: Number(explorationSelectedFacility.lat),
                    properties: explorationSelectedFacility.properties || {}
                  });
                }
              }}
              className="group relative flex flex-col items-center cursor-pointer select-none z-50 hover:scale-110 transition-transform"
            >
              {/* 頂部常駐標籤 (設施名稱與距離) */}
              <div className="mb-1.5 px-2.5 py-1 rounded-md bg-[#0f131c]/95 text-white text-[11px] font-bold whitespace-nowrap shadow-2xl border border-cyan-400/90 backdrop-blur-md flex items-center gap-1.5 ring-2 ring-cyan-500/30">
                <span className="text-cyan-400">
                  {explorationSelectedFacility.icon || (
                   explorationSelectedFacility.facility_type === 'aed' ? '⚡' :
                   explorationSelectedFacility.facility_type === 'public_washrooms' ? '🚻' :
                   explorationSelectedFacility.facility_type === 'bike_racks' || explorationSelectedFacility.facility_type === 'shared_bikes' ? '🚲' :
                   explorationSelectedFacility.facility_type === 'litter_containers' ? '🗑️' :
                   explorationSelectedFacility.facility_type === 'parking_meters' ? '🅿️' :
                   (explorationSelectedFacility.facility_type === 'skytrain_stations' || explorationSelectedFacility.facility_type === 'skytrain_station') ? '🚉' :
                   (explorationSelectedFacility.facility_type === 'bus_stops' || explorationSelectedFacility.facility_type === 'bus_stop') ? '🚏' :
                   explorationSelectedFacility.facility_type === 'food_banks' ? '🥫' :
                   explorationSelectedFacility.facility_type === 'drinking_fountains' ? '🚰' :
                   explorationSelectedFacility.facility_type === 'hospitals' ? '🏥' :
                   explorationSelectedFacility.facility_type === 'schools' ? '🏫' :
                   explorationSelectedFacility.facility_type === 'libraries' ? '📚' :
                   explorationSelectedFacility.facility_type === 'fuel' ? '⛽' :
                   explorationSelectedFacility.facility_type === 'van_wifi' ? '📶' :
                   explorationSelectedFacility.facility_type === 'tide_stations' ? '🌊' :
                   explorationSelectedFacility.facility_type === 'traffic_crosswalks' ? '🚶' : '📍')}
                </span>
                <span className="max-w-[150px] truncate">{explorationSelectedFacility.name}</span>
                {(explorationSelectedFacility.distance_meters !== undefined || explorationSelectedFacility.distance_m !== undefined) && (
                  <span className="text-[10px] text-cyan-300 font-mono font-normal">
                    ({explorationSelectedFacility.distance_meters ?? explorationSelectedFacility.distance_m}m)
                  </span>
                )}
              </div>

              {/* 外圈動畫波紋與中心圓標 */}
              <div className="relative flex items-center justify-center">
                <span className="animate-ping absolute inline-flex h-9 w-9 rounded-full bg-cyan-400 opacity-75"></span>
                <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500 border-2 border-white shadow-[0_2px_16px_rgba(6,182,212,0.8)] text-white">
                  <span className="text-sm leading-none">
                    {explorationSelectedFacility.icon || (
                     explorationSelectedFacility.facility_type === 'aed' ? '⚡' :
                     explorationSelectedFacility.facility_type === 'public_washrooms' ? '🚻' :
                     explorationSelectedFacility.facility_type === 'bike_racks' || explorationSelectedFacility.facility_type === 'shared_bikes' ? '🚲' :
                     explorationSelectedFacility.facility_type === 'litter_containers' ? '🗑️' :
                     explorationSelectedFacility.facility_type === 'parking_meters' ? '🅿️' :
                     (explorationSelectedFacility.facility_type === 'skytrain_stations' || explorationSelectedFacility.facility_type === 'skytrain_station') ? '🚉' :
                     (explorationSelectedFacility.facility_type === 'bus_stops' || explorationSelectedFacility.facility_type === 'bus_stop') ? '🚏' :
                     explorationSelectedFacility.facility_type === 'food_banks' ? '🥫' :
                     explorationSelectedFacility.facility_type === 'drinking_fountains' ? '🚰' :
                     explorationSelectedFacility.facility_type === 'hospitals' ? '🏥' :
                     explorationSelectedFacility.facility_type === 'schools' ? '🏫' :
                     explorationSelectedFacility.facility_type === 'libraries' ? '📚' :
                     explorationSelectedFacility.facility_type === 'fuel' ? '⛽' :
                     explorationSelectedFacility.facility_type === 'van_wifi' ? '📶' :
                     explorationSelectedFacility.facility_type === 'tide_stations' ? '🌊' :
                     explorationSelectedFacility.facility_type === 'traffic_crosswalks' ? '🚶' : '📍')}
                  </span>
                </div>
              </div>
              {/* 下方箭頭針 */}
              <div className="w-2.5 h-2.5 bg-cyan-500 rotate-45 -mt-1.5 border-r-2 border-b-2 border-white shadow-md"></div>
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
                  className={`relative flex items-center justify-center w-8 h-8 bg-gradient-to-tr from-sky-700 via-sky-600 to-cyan-500 rounded-full cursor-pointer tooltip border-2 border-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-125 z-30 ${
                    isSelected ? 'ring-4 ring-amber-400 scale-125 z-40 shadow-xl' : ''
                  }`}
                  title={`SeaBus 跨海渡輪${v.destination ? ` 往 ${v.destination}` : ''}`}
                >
                  <Ship className="w-4 h-4 text-white drop-shadow-sm" />
                  {v.bearing !== undefined && (
                    <div 
                      className="absolute -top-1 w-2 h-2 pointer-events-none"
                      style={{ transform: `rotate(${v.bearing}deg)` }}
                    >
                      <div className="w-1.5 h-1.5 bg-amber-300 rotate-45 mx-auto shadow-xs border-[0.5px] border-white"></div>
                    </div>
                  )}
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
            closeButton={false}
            closeOnClick={false}
            className="z-50"
            offset={[0, -8]}
            maxWidth="none"
          >
            <div className="p-3 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] text-gray-800">
              {(() => {
                const isSeaBusStop = selectedStop.id === '8035' || selectedStop.id === '8036' || selectedStop.name.includes('SeaBus') || selectedStop.name.includes('Lonsdale Quay') || selectedStop.name.includes('Waterfront');
                const cleanStopName = selectedStop.name.replace(/\s*(?:Northbound|Southbound)\s*$/i, '').trim();
                return (
                  <div className="flex items-start justify-between pb-1.5 mb-2 border-b border-gray-100">
                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                      <span className="text-base shrink-0">{isSeaBusStop ? '⛴️' : '🚏'}</span>
                      <div className="min-w-0">
                        <h3 className="font-bold text-sm leading-tight text-gray-900 truncate max-w-[160px] sm:max-w-[190px]" title={cleanStopName}>
                          {cleanStopName}
                        </h3>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {isSeaBusStop ? `SeaBus 碼頭 #${selectedStop.id}` : `#${selectedStop.id}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 -mt-0.5 -mr-0.5">
                      <button
                        onClick={() => copyCoordinatesToClipboard(selectedStop.lat, selectedStop.lon)}
                        className="p-1 rounded-md text-gray-500 hover:text-cyan-600 hover:bg-cyan-50 transition-colors flex items-center justify-center shadow-xs border border-gray-100"
                        title="複製坐標"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.lat},${selectedStop.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md text-sky-600 hover:text-sky-700 hover:bg-sky-50 transition-colors flex items-center justify-center shadow-xs border border-sky-100"
                        title="Google Map 導航至此"
                      >
                        <Navigation className="w-3.5 h-3.5 text-sky-600" />
                      </a>
                      <button
                        onClick={() => {
                          setSelectedStop(null);
                          setSearchTarget(null);
                        }}
                        className="text-gray-400 hover:text-gray-700 text-xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none ml-0.5"
                        title="關閉"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                );
              })()}
              {loadingArrivals ? (
                <div className="text-xs text-gray-500 flex items-center gap-2 mt-2">
                  <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  載入預估時間...
                </div>
              ) : arrivals.length > 0 ? (
                <div className="flex flex-col gap-1.5 mt-2">
                  {arrivals.map((arr, i) => {
                    const busNumber = arr.route_number || arr.route_id;
                    const isSeaBus = typeof busNumber === 'string' && busNumber.includes('SeaBus');
                    const isRailOrFerry = isSeaBus || (typeof busNumber === 'string' && (busNumber.includes('Line') || busNumber === 'WCE'));
                    return (
                      <div key={i} className="flex justify-between items-center text-xs gap-3 py-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`font-bold px-2 py-0.5 rounded-md shrink-0 font-mono ${
                            isSeaBus 
                              ? 'bg-sky-100 text-sky-800 border border-sky-300' 
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {isRailOrFerry ? busNumber : `巴士 ${busNumber}`}
                          </span>
                          {arr.destination && (
                            <span className="text-[11.5px] text-gray-600 truncate max-w-[135px] sm:max-w-[160px]" title={arr.destination}>
                              往 {arr.destination}
                            </span>
                          )}
                        </div>
                        <span className="text-gray-600 shrink-0 whitespace-nowrap pl-2 text-right">
                          {arr.minutes <= 0 ? (
                            <span className="text-red-500 font-bold animate-pulse">{isSeaBus ? '即將開出' : '即將進站'}</span>
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

        {/* SkyTrain & SeaBus Station Warning Triangles for Active Alerts (Critical: Red, Non-critical: Yellow) */}
        {isExploreOpen && exploreTab === 'alerts' && activeStationAlertMarkers.map((marker) => (
          <Marker
            key={`st_alert_${marker.name}`}
            longitude={marker.lon}
            latitude={marker.lat}
            anchor="bottom"
            offset={[0, -14]}
            style={{ zIndex: 45 }}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSelectedStationAlertMarker(marker);
                setSelectedStop(null);
                setSelectedFacility(null);
                mapRef.current?.flyTo({ center: [marker.lon, marker.lat], zoom: 15.5, essential: true });
              }}
              className={`cursor-pointer group flex items-center justify-center transition-transform hover:scale-125 select-none ${
                marker.critical
                  ? 'animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]'
                  : 'drop-shadow-[0_0_6px_rgba(234,179,8,0.9)]'
              }`}
              title={`${marker.name} · ${marker.critical ? '嚴重警報 (Critical Alert)' : '營運警報 (Advisory)'} (${marker.count} 則警報)`}
            >
              <div className={`flex items-center justify-center w-6 h-6 rounded-md border shadow-lg ${
                marker.critical 
                  ? 'bg-red-950/95 border-red-500 text-red-400' 
                  : 'bg-amber-950/95 border-amber-500 text-amber-400'
              }`}>
                {marker.critical ? (
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2L1 21h22L12 2zm0 3.5L20.3 19H3.7L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2L1 21h22L12 2zm0 3.5L20.3 19H3.7L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                  </svg>
                )}
              </div>
            </div>
          </Marker>
        ))}

        {/* SkyTrain & SeaBus Station Warning Alert Info Popup */}
        {selectedStationAlertMarker && (() => {
          const matchingAlerts = (transitAlertsList || []).filter((a: any) => {
            if (selectedStationAlertMarker.alertIds?.includes(a.id)) return true;
            const stName = selectedStationAlertMarker.name.toLowerCase();
            const stDisplay = (selectedStationAlertMarker.displayName || '').toLowerCase();
            const impacted = (a.impacted_stations || []).map((s: string) => s.toLowerCase());
            return impacted.some((s: string) => s.includes(stName) || stName.includes(s) || (stDisplay && s.includes(stDisplay)));
          });
          const officialAlertUrl = matchingAlerts.find((a: any) => a.url)?.url || 'https://www.translink.ca/alerts';

          return (
            <Popup
              longitude={selectedStationAlertMarker.lon}
              latitude={selectedStationAlertMarker.lat}
              closeOnClick={false}
              closeButton={false}
              onClose={() => setSelectedStationAlertMarker(null)}
              offset={[0, -28]}
              className="z-50 station-alert-popup"
              maxWidth="none"
            >
              <div className="flex flex-col gap-2 text-xs text-gray-900 w-[290px] sm:w-[325px] max-w-[calc(100vw-32px)] p-0.5">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 pb-2 border-b border-gray-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      selectedStationAlertMarker.critical 
                        ? 'bg-red-100 text-red-600 border border-red-300' 
                        : 'bg-amber-100 text-amber-600 border border-amber-300'
                    }`}>
                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2L1 21h22L12 2zm0 3.5L20.3 19H3.7L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm text-gray-900 truncate">
                        {selectedStationAlertMarker.displayName || selectedStationAlertMarker.name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          selectedStationAlertMarker.critical
                            ? 'bg-red-600 text-white'
                            : 'bg-amber-500 text-white'
                        }`}>
                          {selectedStationAlertMarker.critical ? '嚴重警報' : '營運提示'}
                        </span>
                        <span className="text-[11px] text-gray-500 font-medium">
                          共 {selectedStationAlertMarker.count} 則警報
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 右上角按鈕組：官方通報圖示 + 關閉按鈕 */}
                  <div className="flex items-center gap-1 shrink-0">
                    {officialAlertUrl && (
                      <a
                        href={officialAlertUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer flex items-center justify-center"
                        title="前往 TransLink 官方通報"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedStationAlertMarker(null)}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                      title="關閉"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Alert Details List */}
                <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
                  {matchingAlerts.length === 0 ? (
                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-[11.5px] leading-relaxed">
                      ⚠️ 該站點目前有即時營運通報，請留意車站現場廣播、跑馬燈指示或至 TransLink 官網查詢。
                    </div>
                  ) : (
                    matchingAlerts.map((alt: any, idx: number) => {
                      let displayTime = '--';
                      if (alt.lastModified) {
                        try {
                          const d = new Date(alt.lastModified);
                          if (!isNaN(d.getTime())) {
                            const h = d.getHours().toString().padStart(2, '0');
                            const m = d.getMinutes().toString().padStart(2, '0');
                            displayTime = `${d.getMonth() + 1}月${d.getDate()}日 ${h}:${m}`;
                          }
                        } catch {
                          displayTime = String(alt.lastModified);
                        }
                      }

                      return (
                        <div 
                          key={alt.id || idx}
                          className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                            alt.critical 
                              ? 'bg-red-50/70 border-red-200' 
                              : 'bg-amber-50/60 border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                alt.critical 
                                ? 'bg-red-600 text-white' 
                                : 'bg-amber-600 text-white'
                              }`}>
                                {alt.effect_zh || '營運提示'}
                              </span>
                              {alt.routeLongName && (
                                <span className="text-[10.5px] font-semibold text-gray-700 truncate max-w-[150px]">
                                  {alt.routeLongName}
                                </span>
                              )}
                            </div>
                            {alt.url && (
                              <a
                                href={alt.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 flex items-center justify-center"
                                title="前往官方通報"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          <h4 className="font-bold text-xs text-gray-900 leading-snug">
                            {alt.header || alt.alertText || '營運通知'}
                          </h4>

                          {alt.description && alt.description !== alt.header && (
                            <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line line-clamp-4">
                              {alt.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 text-[10px] text-gray-500">
                            <span>
                              {displayTime !== '--' ? `更新：${displayTime}` : '即時通告'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </Popup>
          );
        })()}

        {/* BC Ferries Terminals (Merged under bcferriesRoutes '路線') */}
        {layers.bcferriesRoutes && ferryTerminals.map((t, i) => (
          <Marker 
            key={`term-${i}`} 
            longitude={t.geometry.coordinates[0]} 
            latitude={t.geometry.coordinates[1]}
            anchor="center"
          >
            <div className="flex flex-col items-center cursor-pointer select-none">
              <div 
                className="w-6 h-6 bg-[#0060a9] rounded-md flex items-center justify-center border-[1.5px] border-white shadow-md hover:bg-[#004080] transition-colors tooltip"
                title={t.properties?.name || 'Ferry Terminal'}
                onClick={(e) => {
                  e.stopPropagation();
                  lastInteractiveItemClickRef.current = Date.now();
                  setSelectedStop(null);
                  setSelectedFacility(null);
                  setSelectedFerry(null);
                  setSelectedAirport(null);
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
              {currentZoom >= 10 && t.properties?.name && (
                <span 
                  className="mt-1 text-[11px] font-semibold text-white px-1.5 py-0.5 rounded bg-[#0a121e]/90 border border-sky-400/40 shadow-sm whitespace-nowrap pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                >
                  {t.properties.name}
                </span>
              )}
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
            maxWidth="none"
          >
            <div className="p-3.5 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] overflow-hidden">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-start gap-2 pt-0.5 min-w-0 pr-2">
                  <span className="w-2.5 h-2.5 bg-[#0060a9] rounded-full flex-shrink-0 mt-1.5 shadow-sm"></span>
                  <h3 className="font-bold text-gray-900 text-base leading-snug truncate">{selectedTerminal.properties?.name}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0 -mt-0.5 -mr-0.5">
                  <button
                    onClick={() => copyCoordinatesToClipboard(selectedTerminal.geometry.coordinates[1], selectedTerminal.geometry.coordinates[0])}
                    className="p-1 rounded-md text-gray-500 hover:text-cyan-600 hover:bg-cyan-50 transition-colors flex items-center justify-center shadow-xs border border-gray-100"
                    title="複製坐標"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedTerminal.geometry.coordinates[1]},${selectedTerminal.geometry.coordinates[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-md text-sky-600 hover:text-sky-700 hover:bg-sky-50 transition-colors flex items-center justify-center shadow-xs border border-sky-100"
                    title="Google Map 導航至此"
                  >
                    <Navigation className="w-3.5 h-3.5 text-sky-600" />
                  </a>
                  <button 
                    onClick={() => {
                      setSelectedTerminal(null);
                      setSearchTarget(null);
                    }} 
                    className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none ml-0.5"
                    title="關閉"
                  >
                    &times;
                  </button>
                </div>
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
                          <span className="font-medium text-gray-800 truncate max-w-[130px] sm:max-w-[160px]">{sailing.vessel_name || '渡輪 (航線營運中)'}</span>
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
            maxWidth="none"
          >
            <div className="p-3.5 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] text-gray-800">
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
                  <span className="font-medium truncate max-w-[100px] sm:max-w-[115px]">{selectedFerry.dep_name || selectedFerry.dep_code}</span>
                  <span className="text-gray-400 font-bold">➝</span>
                  <span className="font-medium truncate max-w-[100px] sm:max-w-[115px] text-right">{selectedFerry.arr_name || selectedFerry.arr_code}</span>
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
            maxWidth="none"
          >
            <div className="p-3.5 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] text-gray-800">
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
              <div className="flex flex-col gap-1.5 mb-2.5 bg-gray-50/80 p-2.5 rounded-lg border border-gray-100 text-[11px]">
                <div className="flex justify-between items-center text-gray-600">
                  <span>船舶類型</span>
                  <span className="text-gray-900 font-medium text-right">{selectedMaritimeVessel.ship_type}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                  <span>即時航速 (SOG)</span>
                  <span className="text-gray-900 font-medium text-right">
                    {selectedMaritimeVessel.sog} 節 ({Math.round(selectedMaritimeVessel.sog * 1.852)} km/h)
                  </span>
                </div>
                <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                  <span>對地航向 / 艏向</span>
                  <span className="text-gray-900 font-medium text-right">
                    {Math.round(selectedMaritimeVessel.cog)}° / {Math.round(selectedMaritimeVessel.heading)}°
                  </span>
                </div>

                {(selectedMaritimeVessel.destination || selectedMaritimeVessel.eta) && (
                  <div className="border-t border-gray-200/80 my-0.5" />
                )}

                {selectedMaritimeVessel.destination && (
                  <div className="flex justify-between items-center text-gray-600">
                    <span>申報目的地</span>
                    <span className="text-gray-800 text-right truncate max-w-[140px] sm:max-w-[165px]">
                      {selectedMaritimeVessel.destination}
                    </span>
                  </div>
                )}
                {selectedMaritimeVessel.eta && (
                  <div className={`flex justify-between items-center text-gray-600 ${selectedMaritimeVessel.destination ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                    <span>預計抵達 (ETA)</span>
                    <span className="text-gray-900 font-medium text-right">{formatShipEta(selectedMaritimeVessel.eta, timeFormat)}</span>
                  </div>
                )}

                <div className="border-t border-gray-200/80 my-0.5" />

                <div className="flex justify-between items-center text-gray-600">
                  <span>船體尺寸 / 吃水</span>
                  <span className="text-gray-900 font-medium text-right">
                    {selectedMaritimeVessel.length || '--'}m × {selectedMaritimeVessel.width || '--'}m · 吃水 {selectedMaritimeVessel.draft || '--'}m
                  </span>
                </div>
                <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                  <span>MMSI / 呼號</span>
                  <span className="text-gray-900 font-medium text-right">
                    {selectedMaritimeVessel.mmsi} {selectedMaritimeVessel.callsign ? `· ${selectedMaritimeVessel.callsign}` : ''}
                  </span>
                </div>
              </div>

              {/* Route status banner */}
              {vesselRouteGeoJSON && (
                <div className="flex items-center gap-1.5 text-[10.5px] text-cyan-800 bg-cyan-50 px-2 py-1.5 rounded-lg border border-cyan-200/80 mb-2 font-medium">
                  <Navigation className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  <span>已在地圖繪製深水航線與航行軌跡</span>
                </div>
              )}

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
                  lastInteractiveItemClickRef.current = Date.now();
                  setSelectedStop(null);
                  setSelectedFacility(null);
                  setSelectedTerminal(null);
                  setSelectedFerry(null);
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
            maxWidth="none"
          >
            <div className="p-3.5 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] text-gray-800">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-start gap-2 min-w-0 pr-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${
                    selectedAirport.properties?.sub_type === 'international_airport'
                      ? 'bg-sky-500'
                      : selectedAirport.properties?.sub_type === 'seaplane_base' || selectedAirport.properties?.sub_type === 'south_terminal'
                      ? 'bg-teal-500'
                      : 'bg-emerald-500'
                  }`}></span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 text-sm leading-snug break-words">
                      {selectedAirport.properties?.name_en || selectedAirport.properties?.name}
                    </h3>
                    {(selectedAirport.properties?.address || selectedAirport.properties?.local_area) && (
                      <span className="text-[11px] text-gray-400 block leading-snug break-words mt-0.5">
                        {selectedAirport.properties?.address || selectedAirport.properties?.local_area || 'Vancouver, BC'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                  <button
                    onClick={() =>
                      copyFacilityDetailsToClipboard({
                        id: selectedAirport.properties?.id || 'airport',
                        facility_type: 'airports',
                        name: selectedAirport.properties?.name_en || selectedAirport.properties?.name || '機場設施',
                        local_area: selectedAirport.properties?.address || '',
                        lon: selectedAirport.geometry.coordinates[0],
                        lat: selectedAirport.geometry.coordinates[1],
                        properties: selectedAirport.properties || {}
                      })
                    }
                    className="p-1 rounded-md text-gray-500 hover:text-cyan-600 hover:bg-cyan-50 transition-colors flex items-center justify-center shadow-xs border border-gray-100"
                    title="複製名稱及地址"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedAirport.geometry.coordinates[1]},${selectedAirport.geometry.coordinates[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-md text-sky-600 hover:text-sky-700 hover:bg-sky-50 transition-colors flex items-center justify-center shadow-xs border border-sky-100"
                    title="Google Map 導航至此"
                  >
                    <Navigation className="w-3.5 h-3.5 text-sky-600" />
                  </a>
                  <button
                    onClick={() => {
                      setSelectedAirport(null);
                      if (searchTarget?.category === 'airports') {
                        setSearchTarget(null);
                      }
                    }}
                    className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none ml-0.5"
                    title="關閉"
                  >
                    &times;
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-xs">
                {/* 1.1 淺藍區塊只有:左方是設施類別, 右方是淺藍底白字"航空" */}
                <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex items-center justify-between gap-2">
                  <span className="font-bold text-xs text-sky-950 flex items-center gap-1.5">
                    <span className="text-base text-sky-600 font-bold">🛫</span>
                    <span>{selectedAirport.properties?.badge || '航空設施'}</span>
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-600 text-white shrink-0 shadow-xs whitespace-nowrap">
                    航空
                  </span>
                </div>

                {/* 1.3 現在所有資料放到淺藍色區塊下方 (刪除設施地址、設施類別、所在區域) */}
                <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                  {selectedAirport.properties?.iata && (
                    <div className="flex justify-between items-center text-gray-600">
                      <span className="shrink-0">機場代碼</span>
                      <span className="text-gray-900 font-medium text-right">
                        IATA: {selectedAirport.properties.iata} / ICAO: {selectedAirport.properties.icao}
                      </span>
                    </div>
                  )}
                  {selectedAirport.properties?.transit_access && (
                    <div className={`flex justify-between items-start gap-2 text-gray-600 ${selectedAirport.properties?.iata ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                      <span className="shrink-0">大眾交通</span>
                      <span className="text-gray-800 text-right leading-snug">
                        {selectedAirport.properties.transit_access}
                      </span>
                    </div>
                  )}
                  {selectedAirport.properties?.runways && (
                    <div className={`flex justify-between items-start gap-2 text-gray-600 ${(selectedAirport.properties?.iata || selectedAirport.properties?.transit_access) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                      <span className="shrink-0">跑道長度</span>
                      <span className="text-gray-800 text-right leading-snug">
                        {selectedAirport.properties.runways}
                      </span>
                    </div>
                  )}
                  {selectedAirport.properties?.operators && (
                    <div className={`flex justify-between items-start gap-2 text-gray-600 ${(selectedAirport.properties?.iata || selectedAirport.properties?.transit_access || selectedAirport.properties?.runways) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                      <span className="shrink-0">主要航司</span>
                      <span className="text-gray-800 text-right leading-snug">
                        {selectedAirport.properties.operators}
                      </span>
                    </div>
                  )}
                  {selectedAirport.properties?.destinations && (
                    <div className={`flex justify-between items-start gap-2 text-gray-600 ${(selectedAirport.properties?.iata || selectedAirport.properties?.transit_access || selectedAirport.properties?.runways || selectedAirport.properties?.operators) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                      <span className="shrink-0">直航航點</span>
                      <span className="text-gray-800 text-right leading-snug">
                        {selectedAirport.properties.destinations}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 設施通用坐標與複製按鈕 */}
              <div className="flex items-center justify-between text-[11px] text-gray-500 pt-2.5 mt-2.5 border-t border-gray-100 font-mono">
                <span className="flex items-center gap-1 text-gray-600">
                  <span>📍</span>
                  <span>{selectedAirport.geometry.coordinates[1].toFixed(6)}, {selectedAirport.geometry.coordinates[0].toFixed(6)}</span>
                </span>
                <button
                  onClick={() => copyCoordinatesToClipboard(selectedAirport.geometry.coordinates[1], selectedAirport.geometry.coordinates[0])}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 hover:bg-cyan-50 hover:text-cyan-600 text-gray-700 transition-colors text-[10.5px] font-sans font-medium border border-gray-200/60 shadow-xs"
                  title="複製坐標"
                >
                  <Copy className="w-3 h-3 text-cyan-600" />
                  <span>複製坐標</span>
                </button>
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

        {/* 滑雪場標記 (當開啟探索且分頁為滑雪時，在地圖上為 3 個滑雪場加上圖示，按下即彈去該地點) */}
        {((isExploreOpen && exploreTab === 'ski') || (searchTarget && searchTarget.category === 'ski_resort')) && mapSkiResorts.map((resort) => {
          const isSelected = selectedFacility?.id === `ski_${resort.id}` || searchTarget?.id === `ski_${resort.id}`;
          return (
            <Marker
              key={`ski-resort-${resort.id}`}
              longitude={resort.lon}
              latitude={resort.lat}
              anchor="bottom"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedStop(null);
                  setSelectedFacility({
                    id: `ski_${resort.id}`,
                    facility_type: 'ski_resort',
                    name: resort.name,
                    local_area: resort.area,
                    lon: resort.lon,
                    lat: resort.lat,
                    properties: resort
                  });
                  mapRef.current?.flyTo({
                    center: [resort.lon, resort.lat],
                    zoom: 14.5,
                    essential: true
                  });
                }}
                className="group relative flex flex-col items-center cursor-pointer z-35 select-none"
              >
                {/* 標記光環與按鈕 */}
                <div className={`relative flex items-center justify-center w-9 h-9 rounded-full border-2 shadow-xl backdrop-blur-md transition-all duration-300 group-hover:scale-125 ${
                  isSelected 
                    ? 'bg-cyan-500 border-white text-white scale-120 shadow-[0_0_20px_rgba(6,182,212,0.8)] ring-4 ring-cyan-400/40' 
                    : 'bg-[#121927]/95 border-cyan-400/80 text-cyan-300 hover:border-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                }`}>
                  <span className="text-base">⛷️</span>
                  {/* 小脈衝指示圈 */}
                  <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${
                    resort.is_open ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                  }`} />
                </div>

                {/* 底部名牌 */}
                <div className={`mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold shadow-lg border backdrop-blur-md whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-cyan-950/95 text-cyan-200 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                    : 'bg-[#141720]/95 text-gray-200 border-[#2f384d] group-hover:border-cyan-400 group-hover:text-white'
                }`}>
                  <span>{resort.name}</span>
                  <span className={`text-[9.5px] px-1 py-0.2 rounded font-normal ${
                    resort.is_open ? 'text-emerald-400 bg-emerald-950/80' : 'text-gray-400 bg-gray-800/80'
                  }`}>
                    {resort.status_zh || '休園中'}
                  </span>
                </div>
              </div>
            </Marker>
          );
        })}

        {/* 美加邊境關口標記 (當開啟探索且分頁為關口時，或 searchTarget 為 border_crossing 時，在地圖上為 5 個關卡加上圖示，按下即彈去該地點) */}
        {((isExploreOpen && exploreTab === 'border') || (searchTarget && searchTarget.category === 'border_crossing')) && mapBorderCrossings.map((crossing) => {
          const isSelected = selectedFacility?.id === `border_${crossing.id}` || searchTarget?.id === `border_${crossing.id}`;
          return (
            <Marker
              key={`border-crossing-${crossing.id}`}
              longitude={crossing.lon}
              latitude={crossing.lat}
              anchor="bottom"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedStop(null);
                  setSelectedFacility({
                    id: `border_${crossing.id}`,
                    facility_type: 'border_crossing',
                    name: crossing.name,
                    local_area: crossing.highway,
                    lon: crossing.lon,
                    lat: crossing.lat,
                    properties: crossing
                  });
                  mapRef.current?.flyTo({
                    center: [crossing.lon, crossing.lat],
                    zoom: crossing.zoom || 15.5,
                    essential: true
                  });
                }}
                className="group relative flex flex-col items-center cursor-pointer z-35 select-none"
              >
                {/* 標記光環與按鈕 */}
                <div className={`relative flex items-center justify-center w-9 h-9 rounded-full border-2 shadow-xl backdrop-blur-md transition-all duration-300 group-hover:scale-125 ${
                  isSelected 
                    ? 'bg-emerald-500 border-white text-white scale-120 shadow-[0_0_20px_rgba(16,185,129,0.8)] ring-4 ring-emerald-400/40' 
                    : 'bg-[#121927]/95 border-emerald-400/80 text-emerald-300 hover:border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                }`}>
                  <span className="text-base">🛂</span>
                </div>

                {/* 底部名牌 */}
                <div className={`mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold shadow-lg border backdrop-blur-md whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-emerald-950/95 text-emerald-200 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                    : 'bg-[#141720]/95 text-gray-200 border-[#2f384d] group-hover:border-emerald-400 group-hover:text-white'
                }`}>
                  <span>{crossing.name?.split('(')[0]?.trim() || crossing.name}</span>
                  <span className="text-[9.5px] px-1 py-0.2 rounded font-normal text-cyan-300 bg-cyan-950/80">
                    {crossing.highway?.split('↔')[0]?.trim()}
                  </span>
                </div>
              </div>
            </Marker>
          );
        })}

        {/* 獅門大橋即時路況標記 (當開啟探索且分頁為路況時顯示) */}
        {isExploreOpen && exploreTab === 'traffic' && (
          <Marker
            longitude={-123.1385}
            latitude={49.3148}
            anchor="bottom"
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSelectedStop(null);
                setSelectedFacility({
                  id: 'lions_gate_bridge_atis',
                  facility_type: 'traffic_conditions',
                  name: '獅門大橋 (Lions Gate Bridge)',
                  local_area: '史丹利公園 ↔ 西溫/北溫',
                  lon: -123.1385,
                  lat: 49.3148,
                  properties: {
                    name: '獅門大橋 (Lions Gate Bridge)',
                    speed_kmh: null,
                    delay_min: null,
                    is_atis: true
                  }
                });
                mapRef.current?.flyTo({
                  center: [-123.1385, 49.3148],
                  zoom: 14.5,
                  essential: true
                });
              }}
              className="group relative flex flex-col items-center cursor-pointer z-35 select-none"
            >
              <div className="relative flex items-center justify-center w-9 h-9 rounded-full border-2 shadow-xl backdrop-blur-md transition-all duration-300 group-hover:scale-125 bg-[#121927]/95 border-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.5)]">
                <span className="text-base">🌉</span>
              </div>
              <div className="mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold shadow-lg border backdrop-blur-md whitespace-nowrap bg-[#141720]/95 text-emerald-200 border-emerald-400">
                <span>獅門大橋</span>
              </div>
            </div>
          </Marker>
        )}

        {/* 即時通報選中圖釘 (當在探索分頁點選通報時，在地圖上精準顯示標記圖釘) */}
        {selectedFacility && (selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident') && selectedFacility.lat && selectedFacility.lon && (
          <Marker
            longitude={selectedFacility.lon}
            latitude={selectedFacility.lat}
            anchor="bottom"
          >
            <div className="relative flex flex-col items-center cursor-pointer z-40 select-none animate-pulse">
              <div 
                className="w-8 h-8 rounded-full border-2 border-white shadow-[0_0_15px_rgba(239,68,68,0.8)] flex items-center justify-center text-white text-sm"
                style={{ backgroundColor: selectedFacility.properties?.color || '#ef4444' }}
              >
                <span>{selectedFacility.properties?.icon || '⚠️'}</span>
              </div>
              <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5 shadow-sm" />
            </div>
          </Marker>
        )}

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
            maxWidth="none"
          >
            <div className="p-3.5 w-[300px] sm:w-[335px] max-w-[calc(100vw-32px)] text-gray-800">
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
                    <p className="text-xs text-gray-600 font-medium truncate max-w-[140px] sm:max-w-[165px]">
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
            maxWidth="none"
          >
            <div className={`p-3.5 ${
              (selectedFacility.facility_type === 'traffic_conditions' || selectedFacility.facility_type === 'traffic_corridor') ? 'w-[300px] sm:w-[335px]' :
              (selectedFacility.facility_type === 'traffic_cameras') ? 'w-[320px] sm:w-[350px]' : 
              (selectedFacility.facility_type === 'water_distribution_mains' || selectedFacility.facility_type === 'sewer_mains' || selectedFacility.facility_type === 'street_lighting_conduits' || selectedFacility.facility_type === 'street_lighting') ? 'w-[280px] sm:w-[310px]' :
              'w-[300px] sm:w-[335px]'
            } max-w-[calc(100vw-32px)] text-gray-800`}>
              {(() => {
                const headerBadge = (() => {
                  const t = selectedFacility.facility_type;
                  if (t === 'parking_meters') return { label: '停車收費錶', bg: 'bg-[#1D4ED8] text-white' };
                  if (t === 'motorcycle_parking') return { label: '摩托車停車位', bg: 'bg-[#1D4ED8] text-white' };
                  if (t === 'fuel') return { label: '加油站', bg: 'bg-amber-600 text-white' };
                  if (t === 'accessible_parking') return { label: '無障礙停車位', bg: 'bg-[#0284C7] text-white' };
                  if (t === 'one_way_streets') return { label: '單程路段', bg: 'bg-[#0F172A] text-white' };
                  if (t === 'traffic_speed_limits') return { label: '限速路段', bg: 'bg-[#F59E0B] text-white' };
                  if (t === 'traffic_crosswalks') return { label: '行人穿越道', bg: 'bg-[#FEF3C7] text-amber-900 border border-amber-300' };
                  if (t === 'car_sharing') {
                    const isModo = selectedFacility.properties?.operator === 'Modo';
                    return { label: '共享汽車', bg: isModo ? 'bg-[#B91C1C] text-white' : 'bg-[#0284C7] text-white' };
                  }
                  if (t === 'bikeways') return { label: '單車徑', bg: 'bg-teal-600 text-white' };
                  if (t === 'bike_racks') return { label: '單車架', bg: 'bg-[#065F46] text-white' };
                  if (t === 'shared_bikes') return { label: '共享單車', bg: 'bg-[#00A3AD] text-white' };
                  if (t === 'escooter') return { label: '共享滑板車', bg: 'bg-lime-600 text-white' };
                  if (t === 'ev_charging') return { label: '電動車充電站', bg: 'bg-[#059669] text-white' };
                  if (t === 'tesla') return { label: 'TESLA', bg: 'bg-[#E82127] text-white', isTesla: true };
                  if (t === 'road_closures') return { label: '交通封閉', bg: 'bg-[#DC2626] text-white' };
                  if (t === 'road_construction') return { label: '道路施工', bg: 'bg-[#EA580C] text-white' };
                  if (t === 'traffic_cameras') return { label: '交通攝影機', bg: 'bg-[#0284C7] text-white' };
                  if (t === 'impark') return { label: 'ImPark', bg: 'bg-[#d9261c] text-white' };
                  if (t === 'safety_cameras') {
                    const hasSpeed = Boolean(selectedFacility.properties?.has_speed);
                    return { label: '路口安全相機', bg: hasSpeed ? 'bg-[#991B1B] text-white' : 'bg-[#DC2626] text-white' };
                  }
                  if (t === 'snow_removal_routes') return { label: '鏟雪路線', bg: 'bg-[#F0F9FF] text-sky-900 border border-sky-300' };
                  if (t === 'schools') return { label: '學校', bg: 'bg-blue-600 text-white' };
                  if (t === 'libraries') return { label: '圖書館', bg: 'bg-amber-500 text-white' };
                  if (t === 'food_vendors') return { label: '食品攤販', bg: 'bg-orange-500 text-white' };
                  if (t === 'food_banks') return { label: '食物援助', bg: 'bg-emerald-600 text-white' };
                  if (t === 'homeless_shelters') return { label: '無家者庇護所', bg: 'bg-rose-600 text-white' };
                  if (t === 'aed') return { label: 'AED 去顫器', bg: 'bg-red-600 text-white' };
                  if (t === 'community_centres') return { label: '社區中心', bg: 'bg-violet-600 text-white' };
                  if (t === 'public_art') return { label: '公共藝術', bg: 'bg-fuchsia-600 text-white' };
                  if (t === 'police') return { label: '警察', bg: 'bg-blue-600 text-white' };
                  if (t === 'fire_halls') return { label: '消防', bg: 'bg-rose-600 text-white' };
                  if (t === 'fire_hydrants') return { label: '消防栓', bg: 'bg-red-600 text-white' };
                  if (t === 'hospitals') return { label: '醫療', bg: 'bg-emerald-600 text-white' };
                  if (t === 'disaster_hubs') return { label: '災害支援中心', bg: 'bg-amber-600 text-white' };
                  if (t === 'van_wifi') return { label: 'VanWiFi', bg: 'bg-sky-600 text-white' };
                  if (t === 'parks') return { label: '公園', bg: 'bg-emerald-600 text-white' };
                  if (t === 'parks_facilities') return { label: '公園設施', bg: 'bg-teal-600 text-white' };
                  if (t === 'community_gardens') return { label: '社區花園', bg: 'bg-lime-600 text-white' };
                  if (t === 'public_trees') return { label: '市區行道樹', bg: 'bg-emerald-700 text-white' };
                  if (t === 'water_distribution_mains') return { label: '自來水管道', bg: 'bg-sky-600 text-white' };
                  if (t === 'sewer_mains') return { label: '污水管線', bg: 'bg-teal-600 text-white' };
                  if (t === 'street_lighting_conduits') return { label: '路燈電纜線', bg: 'bg-amber-500 text-white' };
                  if (t === 'street_lighting') return { label: '路燈燈桿', bg: 'bg-amber-500 text-white' };
                  if (t === 'drinking_fountains') return { label: '飲水器', bg: 'bg-sky-600 text-white' };
                  if (t === 'public_washrooms') return { label: '公共洗手間', bg: 'bg-cyan-600 text-white' };
                  if (t === 'museums') return { label: '博物館', bg: 'bg-slate-700 text-white' };
                  if (t === 'garbage_collection') return { label: '廢物回收', bg: 'bg-orange-600 text-white' };
                  if (t === 'recycling') return { label: '環保回收', bg: 'bg-emerald-600 text-white' };
                  if (t === 'litter_containers') return { label: '垃圾箱', bg: 'bg-amber-600 text-white' };
                  if (t === 'zoning_districts') return { label: '土地規劃', bg: 'bg-purple-600 text-white' };
                  if (t === 'tide_stations') return { label: '潮汐', bg: 'bg-[#38bdf8] text-white' };
                  if (t === 'swob_station' || t === 'weather_station') return { label: '氣象', bg: 'bg-[#16a34a] text-white' };
                  if (t === 'hydrometric_station') return { label: '水文', bg: 'bg-[#0284c7] text-white' };
                  if (t === 'traffic_conditions' || t === 'traffic_corridor') return { label: '路況', bg: 'bg-[#ea580c] text-white' };
                  if (t === 'ski_resort') return { label: '滑雪', bg: 'bg-cyan-500 text-white' };
                  if (t === 'traffic_alerts' || t === 'traffic_incident') return { label: '即時通報', bg: 'bg-amber-600 text-white' };
                  return null;
                })();

                const formatStreetAttrLocal = (val?: any) => {
                  if (!val) return '';
                  const s = String(val).trim();
                  if (/^arterial$/i.test(s)) return '主幹道';
                  if (/^residential$/i.test(s)) return '住宅區';
                  if (/^secondary\s*arterial$/i.test(s)) return '次幹道';
                  if (/^collector$/i.test(s)) return '集散道';
                  if (/^secondary\s*arterial\s*\/\s*collector$/i.test(s)) return '次幹道 / 集散道';
                  if (/^(?:lane|alley|lane\s*\/\s*alley)$/i.test(s)) return '後巷';
                  if (/^leased$/i.test(s)) return '專用路段';
                  return s.replace(/\s*\([^)]*\)/g, '').trim();
                };

                const popupTitle = (() => {
                  let title = (() => {
                    if (selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident') {
                      return selectedFacility.properties?.type_label || selectedFacility.properties?.subtype_zh || selectedFacility.properties?.type_zh || selectedFacility.properties?.category_zh || (selectedFacility.name || '').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim() || '即時通報';
                    }
                    if (selectedFacility.facility_type === 'traffic_speed_limits') {
                      return (selectedFacility.properties?.hblock || selectedFacility.name || '').replace(/\s*\(限速.*?\)/g, '').replace(/\s*\(Speed.*?\)/g, '').trim();
                    }
                    if (selectedFacility.facility_type === 'traffic_crosswalks') {
                      return (selectedFacility.properties?.location || selectedFacility.name || '').replace(/^斑馬線\s*-\s*/, '').trim();
                    }
                    if (selectedFacility.facility_type === 'bikeways') {
                      return selectedFacility.properties?.bike_route_name || (selectedFacility.name || '').replace(/\s*單車徑.*$/, '').trim();
                    }
                    if (selectedFacility.facility_type === 'bike_racks') {
                      return (selectedFacility.properties?.location || selectedFacility.name || '').replace(/^單車架\s*-\s*/, '').trim();
                    }
                    if (selectedFacility.facility_type === 'car_sharing') {
                      if (selectedFacility.properties?.operator === 'Modo') return 'Modo Co-op';
                      return (selectedFacility.name || 'Evo Car Share').replace(/\s*\(\d+\s*車位專用站點\)/g, '').trim();
                    }
                    if (selectedFacility.facility_type === 'ski_resort' || selectedFacility.facility_type === 'swob_station' || selectedFacility.facility_type === 'weather_station' || selectedFacility.facility_type === 'tide_stations' || selectedFacility.facility_type === 'hydrometric_station') {
                      return selectedFacility.properties?.english_name || (selectedFacility as any).english_name || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'escooter') {
                      return selectedFacility.properties?.station_name || selectedFacility.properties?.station_location || selectedFacility.name || 'Lime 共享滑板車站點';
                    }
                    if (selectedFacility.facility_type === 'ev_charging') {
                      return selectedFacility.properties?.address || selectedFacility.name || '電動車充電站';
                    }
                    if (selectedFacility.facility_type === 'tesla') {
                      let title = selectedFacility.properties?.display_name || '';
                      if (!title) {
                        const match = (selectedFacility.name || '').match(/\(([^)]+)\)/);
                        title = match ? match[1] : (selectedFacility.name || '');
                      }
                      title = title.replace(/^Tesla\s*[-–—:]*\s*/i, '').trim();
                      title = title.replace(/Tesla\s*(?:超級充電站|目的地充電站|充電站|服務與體驗中心)?/gi, '').replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
                      return title || selectedFacility.properties?.display_name || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'food_vendors') {
                      const bizName = selectedFacility.properties?.business_name;
                      const rawName = selectedFacility.name || '';
                      let cleanName = rawName.replace(/\s*\([^)]*\)/g, '').trim();
                      if (!cleanName || cleanName === '餐車攤商') {
                        if (bizName && bizName !== '餐車攤商') {
                          cleanName = bizName.replace(/\s*\([^)]*\)/g, '').trim();
                        }
                      }
                      if (!cleanName || cleanName === '餐車攤商') {
                        cleanName = selectedFacility.properties?.description || selectedFacility.properties?.food_type || '街頭食品攤販';
                      }
                      return cleanName;
                    }
                    if (selectedFacility.facility_type === 'litter_containers') {
                      const addr = selectedFacility.properties?.address;
                      const raw = selectedFacility.name || '';
                      const clean = raw.replace(/^垃圾箱\s*[-–—:]*\s*/, '').trim();
                      return clean || addr || '市政公共垃圾箱';
                    }
                    if (selectedFacility.facility_type === 'public_art') {
                      return selectedFacility.properties?.sitename || selectedFacility.properties?.title_of_work || selectedFacility.name || '公共藝術';
                    }
                    if (selectedFacility.facility_type === 'parking_meters') {
                      return (selectedFacility.name || '').replace(/^停車收費錶\s*/, '').replace(/^收費錶\s*/, '').trim() || (selectedFacility.properties?.meter_id ? `#${selectedFacility.properties.meter_id}` : selectedFacility.name);
                    }
                    if (selectedFacility.facility_type === 'motorcycle_parking') {
                      const mid = selectedFacility.properties?.meter_id;
                      if (mid) return `#${String(mid).replace(/^#+/, '')}`;
                      const street = selectedFacility.properties?.street;
                      const block = selectedFacility.properties?.block;
                      if (street) return `${block ? block + ' ' : ''}${street}`.trim();
                      return '摩托車停車位';
                    }
                    if (selectedFacility.facility_type === 'drinking_fountains') {
                      const rawName = selectedFacility.properties?.name || selectedFacility.name || '';
                      const cleanName = rawName.replace(/^Fountain location:\s*/i, '').trim();
                      return cleanName || selectedFacility.properties?.location || '飲水器';
                    }
                    if (selectedFacility.facility_type === 'public_washrooms') {
                      return (selectedFacility.name || '').replace(/\s*(?:公園公廁|公廁|公共洗手間|洗手間)\s*$/g, '').trim() || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'parks_facilities') {
                      return selectedFacility.properties?.park_name || (selectedFacility.name || '').replace(/\s*-\s*[^-]+$/, '').trim() || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'zoning_districts') {
                      return selectedFacility.properties?.zoning_district || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'fire_hydrants') {
                      return selectedFacility.properties?.street || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'water_distribution_mains') {
                      return 'Water Distribution Mains';
                    }
                    if (selectedFacility.facility_type === 'sewer_mains') {
                      return 'Sewer Mains';
                    }
                    if (selectedFacility.facility_type === 'street_lighting_conduits') {
                      return 'Street Lighting Conduits';
                    }
                    if (selectedFacility.facility_type === 'tide_stations') {
                      return selectedFacility.properties?.english_name || selectedFacility.name?.replace(/[\u4e00-\u9fa5（）\(\)]+/g, '').trim() || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'food_banks') {
                      return selectedFacility.properties?.program_name || selectedFacility.properties?.name || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'fire_halls') {
                      return selectedFacility.properties?.address || selectedFacility.name;
                    }
                    if (selectedFacility.facility_type === 'road_closures') {
                      return (selectedFacility.name || '交通封閉路段').replace(/-/g, '\u2011');
                    }
                    if (selectedFacility.facility_type === 'garbage_collection') {
                      return selectedFacility.properties?.zone_name || selectedFacility.name || '廢物回收分區';
                    }
                    if (selectedFacility.facility_type === 'museums') {
                      return selectedFacility.properties?.name || selectedFacility.name || '博物館';
                    }
                    if (selectedFacility.facility_type === 'ski_resort' || selectedFacility.facility_type === 'swob_station' || selectedFacility.facility_type === 'weather_station' || selectedFacility.facility_type === 'tide_stations' || selectedFacility.facility_type === 'hydrometric_station') {
                      return selectedFacility.properties?.english_name || (selectedFacility as any).english_name || selectedFacility.name;
                    }
                    return selectedFacility.name || '';
                  })();

                  // 0.4 標題的英文確保統一每個英文字中首個英文字母大階 (如 Heather Street, 13th Ave…)
                  title = formatTitleCase(title);
                  if (selectedFacility.facility_type === 'road_closures') {
                    title = title.replace(/-/g, '\u2011');
                  }
                  return title;
                })();

                return (
                  <div className="flex items-start justify-between pb-2 mb-2 border-b border-gray-100 gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                      {headerBadge ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 leading-none shadow-xs whitespace-nowrap ${headerBadge.bg}`}>
                          {headerBadge.label}
                        </span>
                      ) : (
                        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                          selectedFacility.facility_type === 'public_trees' ? 'bg-emerald-600' :
                          selectedFacility.facility_type === 'border_crossing' ? 'bg-emerald-600 shadow-[0_0_6px_rgba(16,185,129,0.5)]' :
                          (selectedFacility.facility_type === 'traffic_conditions' || selectedFacility.facility_type === 'traffic_corridor') ? 'bg-orange-500 shadow-[0_0_6px_rgba(234,88,12,0.5)]' :
                          (selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident') ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]' :
                          selectedFacility.facility_type === 'road_closures' ? 'bg-red-600' :
                          selectedFacility.facility_type === 'road_construction' ? 'bg-orange-600' :
                          (selectedFacility.facility_type === 'street_lighting' || selectedFacility.facility_type === 'street_lighting_conduits') ? 'bg-amber-400' :
                          selectedFacility.facility_type === 'beach_water_quality' ? 'bg-teal-500' :
                          selectedFacility.facility_type === 'fire_hydrants' ? 'bg-red-600' :
                          selectedFacility.facility_type === 'zoning_districts' ? 'bg-indigo-600' :
                          selectedFacility.facility_type === 'van_wifi' ? 'bg-cyan-500' :
                          selectedFacility.facility_type === 'tide_stations' ? 'bg-blue-600' :
                          selectedFacility.facility_type === 'water_distribution_mains' ? 'bg-sky-500' :
                          selectedFacility.facility_type === 'sewer_mains' ? 'bg-teal-500' :
                          selectedFacility.facility_type === 'traffic_speed_limits' ? 'bg-amber-500' :
                          selectedFacility.facility_type === 'postal_code_fsa' ? 'bg-indigo-600' :
                          selectedFacility.facility_type === 'bike_racks' ? 'bg-emerald-800' :
                          selectedFacility.facility_type === 'public_art' ? 'bg-fuchsia-600' :
                          selectedFacility.facility_type === 'traffic_crosswalks' ? 'bg-yellow-500' :
                          selectedFacility.facility_type === 'litter_containers' ? 'bg-amber-600' :
                          selectedFacility.facility_type === 'tesla' ? 'bg-red-600' :
                          selectedFacility.facility_type === 'marine_terminals' ? 'bg-cyan-600' :
                          selectedFacility.facility_type === 'snow_removal_routes' ? 'bg-sky-500' :
                          selectedFacility.facility_type === 'one_way_streets' ? 'bg-slate-900' :
                          selectedFacility.facility_type === 'fuel' ? 'bg-amber-500' :
                          selectedFacility.facility_type === 'parking_meters' ? 'bg-blue-700' :
                          selectedFacility.facility_type === 'accessible_parking' ? 'bg-sky-600' :
                          selectedFacility.facility_type === 'motorcycle_parking' ? 'bg-blue-700' :
                          selectedFacility.facility_type === 'ev_charging' ? 'bg-emerald-600' :
                          selectedFacility.facility_type === 'escooter' ? 'bg-lime-500' :
                          selectedFacility.facility_type === 'car_sharing' ? (selectedFacility.properties?.operator === 'Modo' ? 'bg-red-700' : 'bg-sky-600') :
                          selectedFacility.facility_type === 'shared_bikes' ? 'bg-[#00A3AD]' :
                          selectedFacility.facility_type === 'bikeways' ? 'bg-teal-600' :
                          selectedFacility.facility_type === 'traffic_cameras' ? 'bg-sky-600' :
                          selectedFacility.facility_type === 'safety_cameras' ? (selectedFacility.properties?.has_speed ? 'bg-gray-950 border border-gray-400 shadow-[0_0_6px_rgba(0,0,0,0.6)]' : 'bg-red-600 shadow-[0_0_6px_rgba(239,68,68,0.5)]') :
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
                          selectedFacility.facility_type === 'libraries' ? 'bg-orange-500' :
                          selectedFacility.facility_type === 'food_vendors' ? 'bg-orange-500' :
                          selectedFacility.facility_type === 'food_banks' ? 'bg-emerald-500' :
                          selectedFacility.facility_type === 'recycling' ? 'bg-emerald-600' :
                          selectedFacility.facility_type === 'aed' ? 'bg-red-600' :
                          selectedFacility.facility_type === 'contours' ? 'bg-teal-700' :
                          selectedFacility.facility_type === 'homeless_shelters' ? 'bg-rose-500' : 'bg-violet-500'
                        }`}></span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-gray-900 text-sm leading-snug break-words">
                          {popupTitle}
                        </h3>
                        {(selectedFacility.local_area || selectedFacility.facility_type === 'one_way_streets' || selectedFacility.facility_type === 'escooter' || selectedFacility.facility_type === 'safety_cameras' || selectedFacility.facility_type === 'tide_stations' || selectedFacility.facility_type === 'hospitals' || selectedFacility.facility_type === 'disaster_hubs' || selectedFacility.facility_type === 'van_wifi' || selectedFacility.facility_type === 'water_distribution_mains' || selectedFacility.facility_type === 'sewer_mains' || selectedFacility.facility_type === 'street_lighting_conduits' || selectedFacility.facility_type === 'traffic_crosswalks' || selectedFacility.facility_type === 'traffic_speed_limits' || selectedFacility.facility_type === 'bikeways' || selectedFacility.facility_type === 'bike_racks' || selectedFacility.facility_type === 'shared_bikes' || selectedFacility.facility_type === 'tesla' || selectedFacility.facility_type === 'road_closures' || selectedFacility.facility_type === 'road_construction' || selectedFacility.facility_type === 'snow_removal_routes' || selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident' || selectedFacility.facility_type === 'recycling' || selectedFacility.facility_type === 'libraries' || selectedFacility.facility_type === 'litter_containers' || selectedFacility.facility_type === 'aed' || selectedFacility.facility_type === 'public_art' || selectedFacility.facility_type === 'motorcycle_parking' || selectedFacility.facility_type === 'parks' || selectedFacility.facility_type === 'parks_facilities' || selectedFacility.facility_type === 'community_gardens' || selectedFacility.facility_type === 'community_centres' || selectedFacility.facility_type === 'public_trees' || selectedFacility.facility_type === 'schools' || selectedFacility.facility_type === 'police' || selectedFacility.facility_type === 'fire_halls' || selectedFacility.facility_type === 'fire_hydrants' || selectedFacility.facility_type === 'drinking_fountains' || selectedFacility.facility_type === 'public_washrooms' || selectedFacility.facility_type === 'impark' || selectedFacility.facility_type === 'ski_resort' ||
                  selectedFacility.facility_type === 'parking_meters' || selectedFacility.facility_type === 'zoning_districts' || selectedFacility.facility_type === 'car_sharing') && (
                          <span className="text-[11px] text-gray-400 block leading-snug break-words">
                            {(() => {
                              if (selectedFacility.facility_type === 'ski_resort') {
                                const rawArea = selectedFacility.properties?.area || selectedFacility.local_area || '';
                                const match = rawArea.match(/\(([^)]+)\)/);
                                return match ? match[1].trim() : (rawArea || 'West Vancouver');
                              }
                              if (selectedFacility.facility_type === 'escooter') {
                                const stNum = selectedFacility.properties?.station_number;
                                if (stNum) return `#${String(stNum).replace(/^#+/, '')}`;
                                return 'Vancouver, BC';
                              }
                              if (selectedFacility.facility_type === 'traffic_crosswalks') {
                                return selectedFacility.properties?.object_id ? `#${selectedFacility.properties.object_id}` : (selectedFacility.properties?.id ? `#${selectedFacility.properties.id}` : 'Vancouver, BC');
                              }
                              if (selectedFacility.facility_type === 'shared_bikes') {
                                return selectedFacility.properties?.station_id ? `#${selectedFacility.properties.station_id}` : 'Vancouver, BC';
                              }
                              if (selectedFacility.facility_type === 'one_way_streets') {
                                return formatStreetAttrLocal(selectedFacility.properties?.streetuse || selectedFacility.properties?.type) || '單向行車路段';
                              }
                              if (selectedFacility.facility_type === 'ev_charging') {
                                return selectedFacility.properties?.local_area || selectedFacility.local_area || 'Vancouver, BC';
                              }
                              if (selectedFacility.facility_type === 'car_sharing') {
                                if (selectedFacility.properties?.operator === 'Modo') {
                                  return selectedFacility.properties?.location || selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                                }
                                return 'Vancouver, BC';
                              }
                              if (selectedFacility.facility_type === 'safety_cameras') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'tide_stations') return 'British Columbia';
                              if (selectedFacility.facility_type === 'hospitals') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'disaster_hubs') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'van_wifi') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'water_distribution_mains') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'sewer_mains') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'street_lighting_conduits') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'schools') return selectedFacility.properties?.address || selectedFacility.properties?.street_address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'police') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'fire_halls') return selectedFacility.properties?.geo_local_area || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'fire_hydrants') {
                                const area = selectedFacility.properties?.geo_local_area || selectedFacility.local_area;
                                return (area ? area.replace(/\s*·\s*溫哥華消防局.*/, '') : '') || 'Vancouver, BC';
                              }
                              if (selectedFacility.facility_type === 'parks') return selectedFacility.properties?.street_address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'parks_facilities') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'zoning_districts') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'community_gardens') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'community_centres') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'museums') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'garbage_collection') return selectedFacility.properties?.zone_code || selectedFacility.local_area || '';
                              if (selectedFacility.facility_type === 'public_trees') return selectedFacility.properties?.address || `${selectedFacility.properties?.civic_number || ''} ${selectedFacility.properties?.std_street || ''}`.trim() || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'aed') return selectedFacility.properties?.ADDRESS || selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'public_art') return selectedFacility.properties?.siteaddress || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'motorcycle_parking') return selectedFacility.properties?.local_area || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'snow_removal_routes') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'traffic_speed_limits') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'bikeways') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'bike_racks') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'tesla') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'road_closures') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'road_construction') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'litter_containers') return 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'recycling') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'libraries') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'food_vendors') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'food_banks') return selectedFacility.properties?.address || selectedFacility.local_area || 'Vancouver, BC';
                              if (selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident') {
                                const rawStreet = selectedFacility.properties?.street || selectedFacility.local_area || '';
                                const match = rawStreet.match(/\(([^)]+)\)/);
                                if (match) return match[1].trim();
                                const en = rawStreet.replace(/[\u4e00-\u9fa5]+/g, '').replace(/^[\s\-\–\—\:\/]+|[\s\-\–\—\:\/]+$/g, '').trim();
                                if (en) return en;
                                return selectedFacility.properties?.from || 'Vancouver, BC';
                              }
                              return selectedFacility.local_area;
                            })()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                      <button
                        onClick={() => copyFacilityDetailsToClipboard(selectedFacility, popupTitle)}
                        className="p-1 rounded-md text-gray-500 hover:text-cyan-600 hover:bg-cyan-50 transition-colors flex items-center justify-center shadow-xs border border-gray-100"
                        title="複製名稱"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md text-sky-600 hover:text-sky-700 hover:bg-sky-50 transition-colors flex items-center justify-center shadow-xs border border-sky-100"
                        title="Google Map 導航至此"
                      >
                        <Navigation className="w-3.5 h-3.5 text-sky-600" />
                      </a>
                      <button 
                        onClick={() => {
                          setSelectedFacility(null);
                          setSearchTarget(null);
                        }} 
                        className="text-gray-400 hover:text-gray-700 text-2xl font-light leading-none px-1 py-0.5 rounded transition-colors focus:outline-none ml-0.5"
                        title="關閉"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Border Crossing Details */}
              {selectedFacility.facility_type === 'border_crossing' && (() => {
                const props = selectedFacility.properties || {};
                const us = props.us_bound || {};
                const ca = props.canada_bound || {};
                return (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
                      <div>
                        <span className="text-[10px] text-gray-500 block">所屬公路線</span>
                        <span className="font-bold text-gray-800 text-xs">{props.highway || '美加邊境公路'}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block">通關服務時間</span>
                        <span className="text-emerald-700 font-semibold text-[11px]">{formatTimePreference(props.hours, timeFormat) || '24 小時開放'}</span>
                      </div>
                    </div>

                    {/* Wait times grid */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* US Bound */}
                      <div className="p-2 rounded-lg bg-sky-50/70 border border-sky-200 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-sky-900 font-bold text-[11px]">
                          <span>🇺🇸 入境美國 (CBP)</span>
                        </div>
                        <div className="flex justify-between items-baseline pt-0.5">
                          <span className="text-gray-600 text-[10.5px]">一般客車:</span>
                          <span className="font-bold font-mono text-sky-800">
                            {us.standard_status || (us.standard_delay_min != null ? `${us.standard_delay_min} 分鐘` : '正常通行')}
                          </span>
                        </div>
                        {us.standard_lanes_open != null && (
                          <div className="text-[10px] text-gray-500">
                            開放車道: {us.standard_lanes_open} 線
                          </div>
                        )}
                        {props.has_nexus && (
                          <div className="flex justify-between items-baseline pt-1 border-t border-sky-100 text-[10.5px]">
                            <span className="text-emerald-700 font-medium">NEXUS:</span>
                            <span className="font-bold font-mono text-emerald-700">
                              {us.nexus_status || (us.nexus_delay_min === 0 ? '免等候' : `${us.nexus_delay_min} 分鐘`)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Canada Bound */}
                      <div className="p-2 rounded-lg bg-rose-50/70 border border-rose-200 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-rose-900 font-bold text-[11px]">
                          <span>🇨🇦 入境加拿大 (CBSA)</span>
                        </div>
                        <div className="flex justify-between items-baseline pt-0.5">
                          <span className="text-gray-600 text-[10.5px]">一般客車:</span>
                          <span className="font-bold font-mono text-rose-800">
                            {ca.traveller_status || (ca.traveller_delay_min != null ? `${ca.traveller_delay_min} 分鐘` : '正常通行')}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline pt-1 border-t border-rose-100 text-[10.5px]">
                          <span className="text-gray-600">商業貨運:</span>
                          <span className="font-mono text-gray-700 font-medium">
                            {ca.commercial_status || '正常'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {props.tips && (
                      <p className="text-[11px] text-gray-600 bg-amber-50/60 p-2 rounded-lg border border-amber-200 leading-relaxed">
                        💡 {props.tips}
                      </p>
                    )}
                  </div>
                );
              })()}

              
              {/* ImPark Parking Lot Details */}
              {selectedFacility.facility_type === 'impark' && (() => {
                const p = selectedFacility.properties || {};
                const hasTransient = p.hasTransientRates;
                const transientRate = p.lowestTransientRate;
                const hasMonthly = p.hasMonthlyRates;
                const monthlyRate = p.lowestMonthlyRate;
                const hasPromo = p.hasPromotions;
                const features: string[] = Array.isArray(p.features) ? p.features : [];
                const streetView = p.streetViewUrl;

                return (
                  <div className="flex flex-col gap-2.5 text-xs text-gray-700">
                    {/* 5.1 標題下方加入色塊 */}
                    <div className="bg-red-500/10 p-2.5 rounded-lg border border-red-500/25 flex items-start gap-2 text-[11px] text-red-700 font-medium leading-relaxed">
                      <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5 text-[#d9261c] font-bold text-[10px]">
                        P
                      </div>
                      <span>北美規模最大的私營停車場管理公司之一，擁有超過 3,000 個停車場，涵蓋商業大樓、購物中心、醫院、機場、飯店及體育場館。</span>
                    </div>

                    {/* 5.2 灰色區塊 (參考圖3風格：淺灰底色、灰底黑字、數值貼右邊、無冒號) */}
                    {(hasTransient || hasMonthly || hasPromo) && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-2 text-[11px]">
                        {hasTransient && (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="font-medium">臨時方案</span>
                              <span className="text-emerald-700 font-semibold text-right">
                                {transientRate?.label || '時租 / 臨時費率'}
                              </span>
                            </div>
                            {transientRate?.value && (
                              <div className="flex justify-between items-center text-gray-600">
                                <span>最低階梯費率</span>
                                <span className="text-gray-900 font-semibold text-right font-mono">
                                  {transientRate.value}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {hasMonthly && (
                          <div className={`flex flex-col gap-1.5 ${hasTransient ? 'pt-2 border-t border-gray-200/60' : ''}`}>
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="font-medium">月租車位</span>
                              <span className="text-sky-700 font-semibold text-right">
                                {monthlyRate?.label || '月租方案'}
                              </span>
                            </div>
                            {monthlyRate?.value && (
                              <div className="flex justify-between items-center text-gray-600">
                                <span>最低月租費率</span>
                                <span className="text-gray-900 font-semibold text-right font-mono">
                                  {monthlyRate.value}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {hasPromo && (
                          <div className={`flex justify-between items-center text-gray-600 ${hasTransient || hasMonthly ? 'pt-2 border-t border-gray-200/60' : ''}`}>
                            <span className="font-medium">優惠活動</span>
                            <span className="text-amber-700 font-semibold text-right">
                              {typeof p.promotions === 'string' ? p.promotions : '目前有提供優惠活動'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Features & Services */}
                    {features.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] text-gray-600 font-medium">場地設施與服務：</span>
                        <div className="flex flex-wrap gap-1.5">
                          {features.map((feat: string, idx: number) => {
                            let zhLabel = feat;
                            if (feat.includes('Parker Pete')) zhLabel = '道路救援';
                            else if (feat.includes('attendant') || feat.includes('Attendant')) zhLabel = '駐場管理員';
                            else if (feat.includes('EV') || feat.includes('Charger')) zhLabel = '電動車充電樁';
                            else if (feat.includes('Heater') || feat.includes('Block Heater')) zhLabel = '引擎加熱器';
                            else if (feat.includes('Wash') || feat.includes('Car Wash')) zhLabel = '洗車';
                            else if (feat.includes('Valet')) zhLabel = '代客泊車';
                            return (
                              <span key={idx} className="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-700 text-[10.5px] font-medium shadow-xs">
                                {zhLabel}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 4. Street View Link (紅底白字按鈕) */}
                    {streetView && (
                      <a
                        href={streetView}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full mt-1 py-2 px-3 bg-[#d9261c] hover:bg-[#b81d14] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm select-none"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-white" />
                        <span>查看 Google 街景照片</span>
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Parking Meters Details */}
              {selectedFacility.facility_type === 'parking_meters' && (() => {
                const is12h = timeFormat === '12h';
                const dayRangeStr = is12h ? '9:00 AM - 6:00 PM' : '09:00 - 18:00';
                const nightRangeStr = is12h ? '6:00 PM - 10:00 PM' : '18:00 - 22:00';
                const freeRangeStr = is12h ? '10:00 PM - 9:00 AM' : '22:00 - 09:00';

                const activePeriod = selectedFacility.properties.active_period || (() => {
                  try {
                    const vancouverHour = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Vancouver" })).getHours();
                    if (parkingMeterFilter.timePeriod === 'night') return 'night';
                    if (parkingMeterFilter.timePeriod === 'day') return 'day';
                    return (9 <= vancouverHour && vancouverHour < 18) ? 'day' : (18 <= vancouverHour && vancouverHour < 22) ? 'night' : 'free';
                  } catch {
                    return 'day';
                  }
                })();

                const formatTimeLimit = (val?: any) => {
                  if (val === null || val === undefined || val === '') return null;
                  const s = String(val).trim();
                  if (/^no(?:\s*time\s*limit)?$/i.test(s) || /no\s*limit/i.test(s)) return '無時限';
                  return s.replace(/小時/g, 'hr').replace(/\bHours?\b/gi, 'hr').replace(/\bHrs\b/gi, 'hr');
                };

                const formatMeterHead = (val?: any) => {
                  if (!val) return null;
                  const s = String(val).trim();
                  if (/pay\s*station/i.test(s)) return '繳費機';
                  if (/dual/i.test(s) || /twin/i.test(s)) return '雙向';
                  if (/zone\s*only/i.test(s)) return '區域';
                  if (/single/i.test(s)) return '單一';
                  return s;
                };

                const formatRate = (val?: any) => {
                  if (!val) return null;
                  const s = String(val).trim();
                  if (s.toLowerCase().includes('/hr') || s.toLowerCase().includes('/小時')) return s.replace(/小時/g, 'hr');
                  return `${s} /hr`;
                };

                const formatCreditCard = (val?: any) => {
                  if (val === null || val === undefined || val === '') return null;
                  const s = String(val).trim().toLowerCase();
                  if (s === 'yes' || s === 'true' || s === '1') return '是';
                  if (s === 'no' || s === 'false' || s === '0') return '否';
                  return String(val);
                };

                const formatRushHours = (val?: string) => {
                  if (!val) return null;
                  const match = val.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*[-–至]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i);
                  if (match) {
                    return formatTimeRange(match[1].replace(/\./g, ''), match[2].replace(/\./g, ''), timeFormat);
                  }
                  return val;
                };

                const props = selectedFacility.properties || {};

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 1.1 皇家藍色區塊：左方目前時段，右方時段資訊觸碰鍵（只要碰到就顯示資訊） */}
                    <div className="bg-blue-600/10 p-2.5 rounded-lg border border-blue-600/25 flex items-center justify-between text-blue-950 text-[11px] font-medium leading-snug">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        <span>
                          目前時段: {activePeriod === 'day' ? `日間 (${dayRangeStr})` : activePeriod === 'night' ? `夜間 (${nightRangeStr})` : `深夜 (${freeRangeStr})`}
                        </span>
                      </div>

                      {/* 時段資訊觸碰鍵 (純 hover 觸發，不需點擊) */}
                      <div 
                        className="relative shrink-0"
                        onMouseEnter={() => setTimeInfoHovered(true)}
                        onMouseLeave={() => setTimeInfoHovered(false)}
                      >
                        <div
                          className="p-1 rounded-full text-blue-700 hover:text-blue-950 hover:bg-blue-600/20 transition-all cursor-pointer flex items-center justify-center"
                          title="查看時段說明"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </div>

                        {/* 懸浮小資訊界面 */}
                        <div
                          className={`absolute right-0 top-full mt-1.5 w-[220px] z-50 bg-[#161922]/95 backdrop-blur-md text-gray-100 p-2.5 rounded-lg shadow-2xl border border-gray-700/80 transition-all duration-150 flex flex-col gap-1.5 text-xs select-none ${
                            timeInfoHovered ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                          }`}
                        >
                          <div className="flex items-center justify-between pb-1.5 border-b border-gray-700/60">
                            <span className="font-bold text-white text-[11px] flex items-center gap-1">
                              <Clock className="w-3 h-3 text-blue-400" />
                              停車時段說明
                            </span>
                            <span className="text-[9.5px] text-blue-300 font-mono">溫哥華標準時間</span>
                          </div>

                          <div className="flex flex-col gap-1 text-[11px]">
                            {/* 日間時段 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors ${
                              activePeriod === 'day' ? 'bg-blue-600/30 text-white font-bold ring-1 ring-blue-500/40' : 'text-gray-300'
                            }`}>
                              <span>日間時段</span>
                              <span className="font-mono text-blue-300">{dayRangeStr}</span>
                            </div>

                            {/* 夜間時段 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors ${
                              activePeriod === 'night' ? 'bg-blue-600/30 text-white font-bold ring-1 ring-blue-500/40' : 'text-gray-300'
                            }`}>
                              <span>夜間時段</span>
                              <span className="font-mono text-blue-300">{nightRangeStr}</span>
                            </div>

                            {/* 深夜免費 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors pt-1 border-t border-gray-700/40 ${
                              activePeriod === 'free' ? 'bg-emerald-500/20 text-white font-bold ring-1 ring-emerald-500/40' : 'text-gray-400'
                            }`}>
                              <span>深夜免費</span>
                              <span className="font-mono text-emerald-400">{freeRangeStr}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 1.4 常規規則小型表格 (圖1) */}
                    <div className="bg-gray-50 rounded border border-gray-100 overflow-hidden text-[11px]">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-100/70 border-b border-gray-200/80 text-[10.5px] text-gray-500">
                            <th className="py-1.5 px-2.5 font-medium">時段</th>
                            <th className="py-1.5 px-2.5 font-medium text-center">日間 ({dayRangeStr})</th>
                            <th className="py-1.5 px-2.5 font-medium text-center">夜間 ({nightRangeStr})</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-800">
                          {(props.rate_9am_6pm || props.rate_6pm_10pm) && (
                            <tr>
                              <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">費率</td>
                              <td className="py-1.5 px-2.5 text-center font-semibold font-mono">{formatRate(props.rate_9am_6pm) || '-'}</td>
                              <td className="py-1.5 px-2.5 text-center font-semibold font-mono">{formatRate(props.rate_6pm_10pm) || '-'}</td>
                            </tr>
                          )}
                          {(props.time_limit_9am_6pm || props.time_limit_6pm_10pm) && (
                            <tr>
                              <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">平日上限</td>
                              <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_9am_6pm) || '-'}</td>
                              <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_6pm_10pm) || '-'}</td>
                            </tr>
                          )}
                          {(props.time_limit_weekend_9am_6pm || props.time_limit_weekend_6pm_10pm) && (
                            <tr>
                              <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">週末上限</td>
                              <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_weekend_9am_6pm) || '-'}</td>
                              <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_weekend_6pm_10pm) || '-'}</td>
                            </tr>
                          )}
                          {(props.am_rush_hours || props.pm_rush_hours) && (
                            <tr className="bg-amber-50/50 text-amber-900">
                              <td className="py-1.5 px-2.5 text-amber-800 whitespace-nowrap font-medium">禁停限制</td>
                              <td className="py-1.5 px-2.5 text-center font-mono text-[10px] leading-tight">
                                {formatRushHours(props.am_rush_hours) || '-'}
                              </td>
                              <td className="py-1.5 px-2.5 text-center font-mono text-[10px] leading-tight">
                                {formatRushHours(props.pm_rush_hours) || '-'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* 1.5 機具與付款區獨立灰色區塊 */}
                    {(props.meter_head || props.credit_card || props.mobile_payment_number) && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                        {props.meter_head && (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>收費錶類型</span>
                            <span className="text-gray-900 font-medium text-right">{formatMeterHead(props.meter_head)}</span>
                          </div>
                        )}
                        {props.credit_card && (
                          <div className={`flex justify-between items-center text-gray-600 ${props.meter_head ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>支援信用卡</span>
                            <span className="text-gray-900 font-medium text-right">{formatCreditCard(props.credit_card)}</span>
                          </div>
                        )}
                        {props.mobile_payment_number && (
                          <div className={`flex justify-between items-center text-gray-600 ${(props.meter_head || props.credit_card) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>手機支付代碼</span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-gray-900">{props.mobile_payment_number}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (navigator?.clipboard?.writeText) {
                                    navigator.clipboard.writeText(String(props.mobile_payment_number));
                                    setCopiedFacilityToast(true);
                                    setTimeout(() => setCopiedFacilityToast(false), 2200);
                                  }
                                }}
                                className="p-1 rounded text-gray-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                                title="複製手機支付代碼"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Accessible Parking Details */}
              {selectedFacility.facility_type === 'accessible_parking' && (() => {
                const formatAccessibleParkingType = (val?: any) => {
                  if (!val) return '專用時段';
                  const s = String(val).trim();

                  // 3.4.3: 有小時在前方就顯示 “X 小時專用時段” (如: 2HR Accessible Parking Space)
                  const hrMatch = s.match(/^(\d+)\s*(?:hr|hours?)\b/i);
                  if (hrMatch) {
                    const hours = hrMatch[1];
                    const timeMatch = s.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*[-–至]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i);
                    if (timeMatch) {
                      const range = formatTimeRange(timeMatch[1].replace(/\./g, ''), timeMatch[2].replace(/\./g, ''), timeFormat);
                      return `${hours} 小時專用時段 (${range})`;
                    }
                    return `${hours} 小時專用時段`;
                  }

                  // 3.4.1: 有時間改成”管制時段” 及顯示時段 (Accessible Parking Space - 8a.m. - 5p.m. Mon-Fri)
                  const timeMatch = s.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?))\s*[-–至]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?))/i);
                  if (timeMatch) {
                    const range = formatTimeRange(timeMatch[1].replace(/\./g, ''), timeMatch[2].replace(/\./g, ''), timeFormat);
                    let days = '';
                    if (/mon(?:day)?\s*[-–至]\s*fri(?:day)?/i.test(s)) days = ' Mon-Fri';
                    else if (/school\s*days?/i.test(s)) days = ' 上課日';
                    else if (/sun(?:day)?s?/i.test(s)) days = ' 週日';
                    return `管制時段 (${range}${days})`;
                  }

                  // 3.4.2: 沒有時間就顯示 “專用時段”(Accessible Parking Space)
                  if (/accessible\s*parking\s*spaces?/i.test(s)) {
                    return '專用時段';
                  }
                  if (/metered/i.test(s)) {
                    return '收費專用時段';
                  }
                  return s;
                };

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 3.1 & 3.3 湛藍色區塊：刪除道路設施行，保留許可證提醒文字 */}
                    <div className="bg-[#0284C7]/10 p-2.5 rounded-lg border border-[#0284C7]/25 flex items-center gap-2 text-[11px] text-[#0284C7] font-medium leading-snug">
                      <div className="w-5 h-5 rounded-full bg-[#0284C7]/20 flex items-center justify-center shrink-0">
                        <span className="text-xs">♿</span>
                      </div>
                      <span className="whitespace-nowrap">必須持有有效的 SPARC BC 殘障人士停車許可證。</span>
                    </div>

                    {/* 3.4 & 3.5 灰色區塊：類別與車位數（不加格字） */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>類別</span>
                        <span className="text-gray-900 font-medium text-right">
                          {formatAccessibleParkingType(selectedFacility.properties?.type)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>專用車位數</span>
                        <span className="text-gray-900 font-medium text-right">{selectedFacility.properties?.spaces || 1}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Motorcycle Parking Details */}
              {selectedFacility.facility_type === 'motorcycle_parking' && (() => {
                const is12h = timeFormat === '12h';
                const dayRangeStr = is12h ? '9:00 AM - 6:00 PM' : '09:00 - 18:00';
                const nightRangeStr = is12h ? '6:00 PM - 10:00 PM' : '18:00 - 22:00';
                const freeRangeStr = is12h ? '10:00 PM - 9:00 AM' : '22:00 - 09:00';

                const activePeriod = selectedFacility.properties.active_period || (() => {
                  try {
                    const vancouverHour = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Vancouver" })).getHours();
                    if (motorcycleParkingFilter.timePeriod === 'night') return 'night';
                    if (motorcycleParkingFilter.timePeriod === 'day') return 'day';
                    return (9 <= vancouverHour && vancouverHour < 18) ? 'day' : (18 <= vancouverHour && vancouverHour < 22) ? 'night' : 'free';
                  } catch {
                    return 'day';
                  }
                })();

                const formatTimeLimit = (val?: any) => {
                  if (val === null || val === undefined || val === '') return null;
                  const s = String(val).trim();
                  if (/^no(?:\s*time\s*limit)?$/i.test(s) || /no\s*limit/i.test(s)) return '無時限';
                  return s.replace(/小時/g, 'hr').replace(/\bHours?\b/gi, 'hr').replace(/\bHrs\b/gi, 'hr');
                };

                const formatMeterHead = (val?: any) => {
                  if (!val) return null;
                  const s = String(val).trim();
                  if (/zone\s*only/i.test(s)) return '區域';
                  if (/single/i.test(s)) return '單一';
                  if (/pay\s*station/i.test(s)) return '繳費機';
                  if (/dual/i.test(s) || /twin/i.test(s)) return '雙向';
                  return s;
                };

                const formatRate = (val?: any) => {
                  if (!val) return null;
                  const s = String(val).trim();
                  if (s.toLowerCase().includes('/hr') || s.toLowerCase().includes('/小時')) return s.replace(/小時/g, 'hr');
                  return `${s} /hr`;
                };

                const formatCreditCard = (val?: any) => {
                  if (val === null || val === undefined || val === '') return null;
                  const s = String(val).trim().toLowerCase();
                  if (s === 'yes' || s === 'true' || s === '1') return '是';
                  if (s === 'no' || s === 'false' || s === '0') return '否';
                  return String(val);
                };

                const formatRushHours = (val?: string) => {
                  if (!val) return null;
                  const match = val.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*[-–至]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i);
                  if (match) {
                    return formatTimeRange(match[1].replace(/\./g, ''), match[2].replace(/\./g, ''), timeFormat);
                  }
                  return val;
                };

                const props = selectedFacility.properties || {};
                const hasSec1 = Boolean(props.rate_9am_6pm || props.rate_6pm_10pm);
                const hasSec2 = Boolean(props.time_limit_9am_6pm || props.time_limit_6pm_10pm || props.time_limit_weekend_9am_6pm || props.time_limit_weekend_6pm_10pm || props.am_rush_hours || props.pm_rush_hours);
                const hasSec3 = Boolean(props.meter_head || props.mobile_payment_number || props.credit_card);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 1.1 皇家藍色區塊：左方目前時段，右方時段資訊觸碰鍵（只要碰到就顯示資訊） */}
                    <div className="bg-blue-600/10 p-2.5 rounded-lg border border-blue-600/25 flex items-center justify-between text-blue-950 text-[11px] font-medium leading-snug">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        <span>
                          目前時段: {activePeriod === 'day' ? `日間 (${dayRangeStr})` : activePeriod === 'night' ? `夜間 (${nightRangeStr})` : `深夜 (${freeRangeStr})`}
                        </span>
                      </div>

                      {/* 時段資訊觸碰鍵 (純 hover 觸發，不需點擊) */}
                      <div 
                        className="relative shrink-0"
                        onMouseEnter={() => setTimeInfoHovered(true)}
                        onMouseLeave={() => setTimeInfoHovered(false)}
                      >
                        <div
                          className="p-1 rounded-full text-blue-700 hover:text-blue-950 hover:bg-blue-600/20 transition-all cursor-pointer flex items-center justify-center"
                          title="查看時段說明"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </div>

                        {/* 懸浮小資訊界面 */}
                        <div
                          className={`absolute right-0 top-full mt-1.5 w-[220px] z-50 bg-[#161922]/95 backdrop-blur-md text-gray-100 p-2.5 rounded-lg shadow-2xl border border-gray-700/80 transition-all duration-150 flex flex-col gap-1.5 text-xs select-none ${
                            timeInfoHovered ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                          }`}
                        >
                          <div className="flex items-center justify-between pb-1.5 border-b border-gray-700/60">
                            <span className="font-bold text-white text-[11px] flex items-center gap-1">
                              <Clock className="w-3 h-3 text-blue-400" />
                              停車時段說明
                            </span>
                            <span className="text-[9.5px] text-blue-300 font-mono">溫哥華標準時間</span>
                          </div>

                          <div className="flex flex-col gap-1 text-[11px]">
                            {/* 日間時段 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors ${
                              activePeriod === 'day' ? 'bg-blue-600/30 text-white font-bold ring-1 ring-blue-500/40' : 'text-gray-300'
                            }`}>
                              <span>日間時段</span>
                              <span className="font-mono text-blue-300">{dayRangeStr}</span>
                            </div>

                            {/* 夜間時段 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors ${
                              activePeriod === 'night' ? 'bg-blue-600/30 text-white font-bold ring-1 ring-blue-500/40' : 'text-gray-300'
                            }`}>
                              <span>夜間時段</span>
                              <span className="font-mono text-blue-300">{nightRangeStr}</span>
                            </div>

                            {/* 深夜免費 */}
                            <div className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors pt-1 border-t border-gray-700/40 ${
                              activePeriod === 'free' ? 'bg-emerald-500/20 text-white font-bold ring-1 ring-emerald-500/40' : 'text-gray-400'
                            }`}>
                              <span>深夜免費</span>
                              <span className="font-mono text-emerald-400">{freeRangeStr}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 1.4 常規規則小型表格 (圖1) */}
                    {(hasSec1 || hasSec2) ? (
                      <div className="bg-gray-50 rounded border border-gray-100 overflow-hidden text-[11px]">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-100/70 border-b border-gray-200/80 text-[10.5px] text-gray-500">
                              <th className="py-1.5 px-2.5 font-medium">時段</th>
                              <th className="py-1.5 px-2.5 font-medium text-center">日間 ({dayRangeStr})</th>
                              <th className="py-1.5 px-2.5 font-medium text-center">夜間 ({nightRangeStr})</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-800">
                            {(props.rate_9am_6pm || props.rate_6pm_10pm) && (
                              <tr>
                                <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">費率</td>
                                <td className="py-1.5 px-2.5 text-center font-semibold font-mono">{formatRate(props.rate_9am_6pm) || '-'}</td>
                                <td className="py-1.5 px-2.5 text-center font-semibold font-mono">{formatRate(props.rate_6pm_10pm) || '-'}</td>
                              </tr>
                            )}
                            {(props.time_limit_9am_6pm || props.time_limit_6pm_10pm) && (
                              <tr>
                                <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">平日上限</td>
                                <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_9am_6pm) || '-'}</td>
                                <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_6pm_10pm) || '-'}</td>
                              </tr>
                            )}
                            {(props.time_limit_weekend_9am_6pm || props.time_limit_weekend_6pm_10pm) && (
                              <tr>
                                <td className="py-1.5 px-2.5 text-gray-500 whitespace-nowrap">週末上限</td>
                                <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_weekend_9am_6pm) || '-'}</td>
                                <td className="py-1.5 px-2.5 text-center font-mono">{formatTimeLimit(props.time_limit_weekend_6pm_10pm) || '-'}</td>
                              </tr>
                            )}
                            {(props.am_rush_hours || props.pm_rush_hours) && (
                              <tr className="bg-amber-50/50 text-amber-900">
                                <td className="py-1.5 px-2.5 text-amber-800 whitespace-nowrap font-medium">禁停限制</td>
                                <td className="py-1.5 px-2.5 text-center font-mono text-[10px] leading-tight">
                                  {formatRushHours(props.am_rush_hours) || '-'}
                                </td>
                                <td className="py-1.5 px-2.5 text-center font-mono text-[10px] leading-tight">
                                  {formatRushHours(props.pm_rush_hours) || '-'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex justify-between items-center text-[11px] text-gray-600">
                        <span>停放限制</span>
                        <span className="text-gray-900 font-medium text-right">免費專用機車位 ({props.time_limit === 'no' ? '無時限' : (props.time_limit || '依現場標誌')})</span>
                      </div>
                    )}

                    {/* 1.5 機具與付款區獨立灰色區塊 */}
                    {(props.meter_head || props.credit_card || props.mobile_payment_number) && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                        {props.meter_head && (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>收費錶類型</span>
                            <span className="text-gray-900 font-medium text-right">{formatMeterHead(props.meter_head)}</span>
                          </div>
                        )}
                        {props.credit_card && (
                          <div className={`flex justify-between items-center text-gray-600 ${props.meter_head ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>支援信用卡</span>
                            <span className="text-gray-900 font-medium text-right">{formatCreditCard(props.credit_card)}</span>
                          </div>
                        )}
                        {props.mobile_payment_number && (
                          <div className={`flex justify-between items-center text-gray-600 ${(props.meter_head || props.credit_card) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>手機支付代碼</span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-gray-900">{props.mobile_payment_number}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (navigator?.clipboard?.writeText) {
                                    navigator.clipboard.writeText(String(props.mobile_payment_number));
                                    setCopiedFacilityToast(true);
                                    setTimeout(() => setCopiedFacilityToast(false), 2200);
                                  }
                                }}
                                className="p-1 rounded text-gray-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                                title="複製手機支付代碼"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* EV Charging Details */}
              {selectedFacility.facility_type === 'ev_charging' && (() => {
                const props = selectedFacility.properties || {};
                const formatLotType = (val?: string) => {
                  if (!val) return '';
                  const s = val.trim();
                  if (/curbside/i.test(s)) return '路邊';
                  if (/parkade/i.test(s)) return '室內停車場';
                  if (/surface/i.test(s)) return '室外停車場';
                  if (/lot/i.test(s)) return '停車場';
                  return s;
                };
                const lotTypeZh = formatLotType(props.lot_type);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 12.1 主題 #059669，12.2 已刪除「道路設施」列 */}
                    <div className="bg-[#059669]/10 p-2.5 rounded-lg border border-[#059669]/25 flex items-center justify-between text-[#059669] font-medium leading-snug">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Zap className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                        <span>溫哥華公用電動車充電站設施</span>
                      </div>
                    </div>

                    {/* 12.4 灰色區塊：統一文字字體、大小 text-[11px]、顏色黑色 text-gray-800、不粗體 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {props.operator && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>營運單位</span>
                          <span className="text-gray-900 font-medium text-right">{props.operator}</span>
                        </div>
                      )}
                      {lotTypeZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${props.operator ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>地點種類</span>
                          <span className="text-gray-900 font-medium text-right">{lotTypeZh}</span>
                        </div>
                      )}
                      {props.location && (
                        <div className={`flex justify-between items-center text-gray-600 ${(props.operator || lotTypeZh) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>詳細位置</span>
                          <span className="text-gray-900 font-medium text-right">{props.location}</span>
                        </div>
                      )}

                      {(props.operator || lotTypeZh || props.location) && (props.connectors || props.ports || props.level_1 || props.voltage || props.cost) && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {props.connectors && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>接口規格</span>
                          <span className="text-gray-900 font-medium text-right">{props.connectors}</span>
                        </div>
                      )}
                      {props.level_1 && (
                        <div className={`flex justify-between items-center text-gray-600 ${props.connectors ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>充電等級</span>
                          <span className="text-gray-900 font-medium text-right">{String(props.level_1).startsWith('Level') ? props.level_1 : `Level ${props.level_1}`}</span>
                        </div>
                      )}
                      <div className={`flex justify-between items-center text-gray-600 ${(props.connectors || props.level_1) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>充電接口</span>
                        <span className="text-gray-900 font-medium text-right">{props.ports || 2}</span>
                      </div>
                      {props.voltage && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>電壓</span>
                          <span className="text-gray-900 font-medium text-right">{props.voltage}</span>
                        </div>
                      )}
                      {props.cost && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>充電費用</span>
                          <span className="text-gray-900 font-medium text-right">{props.cost}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* E-Scooter Station Details */}
              {selectedFacility.facility_type === 'escooter' && (() => {
                const props = selectedFacility.properties || {};
                const availableVehicles = props.available_vehicles ?? 0;
                const availableDocks = props.available_docks ?? 0;
                const totalCap = props.capacity || (availableVehicles + availableDocks) || 6;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 11.1 & 11.2 淺綠色區塊：刪除「道路設施」那行，顯示頭盔警語 */}
                    <div className="bg-lime-500/10 p-2.5 rounded-lg border border-lime-500/25 flex items-center gap-1.5 text-[11px] text-lime-950 font-medium leading-snug">
                      <Bike className="w-3.5 h-3.5 text-lime-700 shrink-0" />
                      <span>騎滑板車必須佩戴符合安全規範的頭盔，並注意安全。</span>
                    </div>

                    {/* 11.3 & 11.4 灰底文字：刪除站點編號, 設施位置, 管轄屬性, 啟用日期；車位用量改為車位容量（不加車位量詞） */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>車位容量</span>
                        <span className="text-gray-900 font-medium text-right">{totalCap}</span>
                      </div>
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>車位狀態</span>
                        <span className="text-gray-900 font-medium text-right">
                          可借車輛: {availableVehicles} / 可還車位: {availableDocks}
                        </span>
                      </div>

                      {/* 11.6 分隔線與費用資料 */}
                      <div className="border-t border-gray-200/80 my-0.5" />
                      <div className="flex justify-between items-center text-gray-600">
                        <span>計費方案</span>
                        <span className="text-gray-900 font-medium text-right">約 $1.25 解鎖 + $0.39 /min</span>
                      </div>
                    </div>

                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href="https://www.li.me/locations/vancouver"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-lime-600 hover:bg-lime-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 Lime 官方網站 ↗
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Car Sharing Details (Evo & Modo) */}
              {selectedFacility.facility_type === 'car_sharing' && (() => {
                const isModo = selectedFacility.properties.operator === 'Modo';
                const rawCap = String(selectedFacility.properties.capacity || '').replace(/[^\d]/g, '').trim() || '1';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 7.1.1 Evo #0284C7 / 7.2.1 Modo #B91C1C；刪除上半部「道路設施」 */}
                    <div className={`p-2.5 rounded-lg border flex items-center gap-2 leading-snug ${
                      isModo 
                        ? 'bg-[#B91C1C]/10 border-[#B91C1C]/25 text-[#B91C1C]' 
                        : 'bg-[#0284C7]/10 border-[#0284C7]/25 text-[#0284C7]'
                    }`}>
                      <Car className="w-4 h-4 shrink-0" />
                      <span className="text-[11px] font-medium">
                        {isModo 
                          ? '主打「原站借還」與多元車型選擇，適合預先規劃、載物出遊的中長途來回行程。' 
                          : '主打「隨租隨還」與即時彈性，適合臨時起意、點對點的市區短途代步。'}
                      </span>
                    </div>

                    {/* 灰色區塊：統一文字字體、大小 text-[11px]、顏色黑色 text-gray-800、不粗體 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>提供車種</span>
                        <span className="text-gray-900 font-medium text-right">
                          {isModo ? '轎車 / SUV / 卡車 / 箱型車 / 電車' : 'Toyota Prius / Corolla Hybrid'}
                        </span>
                      </div>

                      {/* 7.1.5 & 7.2.5 車位專用站點加到提供車種下方及計費方法上方（不加車位量詞） */}
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>車位專用站點</span>
                        <span className="text-gray-900 font-medium text-right">{rawCap}</span>
                      </div>

                      {/* 分隔線 */}
                      <div className="border-t border-gray-200/80 my-0.5" />

                      {/* 7.1.4 Evo 計費方案 (圖2) / 7.2.4 Modo 計費方案 (圖3) */}
                      <div className="flex flex-col gap-1.5 pt-0.5">
                        <span className="text-gray-600 font-medium">計費方案</span>
                        {isModo ? (
                          <div className="flex flex-col gap-1 bg-white p-2 rounded border border-gray-200/70 text-[10.5px]">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">每小時</span>
                              <span className="text-gray-800 font-medium">$5 起 /hr + 35¢ /km</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                              <span className="text-gray-600">每程附加費</span>
                              <span className="text-gray-800 font-medium">電車 $1 / 非電車 $3</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                              <span className="text-gray-600">每日特惠</span>
                              <span className="text-gray-800 font-medium">$100 起 /day (含 500km 里程)</span>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-1 bg-white p-2 rounded border border-gray-200/70 text-[10.5px]">
                            <div className="flex justify-between items-center pr-1 border-r border-gray-100">
                              <span className="text-gray-600">每分鐘</span>
                              <span className="text-gray-800 font-medium">$0.49 /min</span>
                            </div>
                            <div className="flex justify-between items-center pl-1">
                              <span className="text-gray-600">每小時</span>
                              <span className="text-gray-800 font-medium">$17.99 /hr</span>
                            </div>
                            <div className="flex justify-between items-center pr-1 border-r border-gray-100 pt-1 border-t border-gray-100">
                              <span className="text-gray-600">每日 (24hr)</span>
                              <span className="text-gray-800 font-medium">$104.99 /day</span>
                            </div>
                            <div className="flex justify-between items-center pl-1 pt-1 border-t border-gray-100">
                              <span className="text-gray-600">每程附加費</span>
                              <span className="text-gray-800 font-medium">$1.85 /trip</span>
                            </div>
                            <div className="flex justify-between items-center pr-1 border-r border-gray-100 pt-1 border-t border-gray-100">
                              <span className="text-gray-600">3天特惠</span>
                              <span className="text-gray-800 font-medium">$264.99 (省$50)</span>
                            </div>
                            <div className="flex justify-between items-center pl-1 pt-1 border-t border-gray-100">
                              <span className="text-gray-600">5天特惠</span>
                              <span className="text-gray-800 font-medium">$424.99 (省$100)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.app_url || (isModo ? "https://modo.coop" : "https://evo.ca")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center justify-center w-full py-1.5 px-3 text-white rounded font-medium text-xs transition-colors shadow-sm ${
                          isModo ? 'bg-[#B91C1C] hover:bg-red-800' : 'bg-[#0284C7] hover:bg-sky-700'
                        }`}
                      >
                        {isModo ? '前往 Modo 官方網頁 ↗' : '前往 Evo 官方網頁 ↗'}
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Shared Bikes (Mobi by Rogers) Station Details */}
              {selectedFacility.facility_type === 'shared_bikes' && (() => {
                const props = selectedFacility.properties || {};
                const bikeOwner = props.owner || props.operator || 'Mobi by Rogers';
                const availableBikes = props.available_bikes ?? 0;
                const availableSlots = props.available_slots ?? 0;
                const capacity = props.capacity || (availableBikes + availableSlots) || 0;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 10.1 主題 #00A3AD，10.2 刪除「道路設施」那行，10.4 說明文字 */}
                    <div className="bg-[#00A3AD]/10 p-2.5 rounded-lg border border-[#00A3AD]/25 flex items-center gap-1.5 text-[11px] text-[#00A3AD] font-medium leading-snug">
                      <Bike className="w-3.5 h-3.5 text-[#00A3AD] shrink-0" />
                      <span>騎乘單車必須佩戴符合安全規範的頭盔，並注意安全。</span>
                    </div>

                    {/* 灰色區塊：統一文字字體、大小 text-[11px]、顏色黑色 text-gray-800、不粗體 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {bikeOwner && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>營運單位</span>
                          <span className="text-gray-900 font-medium text-right">{bikeOwner}</span>
                        </div>
                      )}

                      {/* 10.5 車柱用量改為車位容量（不加車位量詞） */}
                      <div className={`flex justify-between items-center text-gray-600 ${bikeOwner ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>車位容量</span>
                        <span className="text-gray-900 font-medium text-right">{capacity}</span>
                      </div>

                      {/* 10.6 新增車位狀態 */}
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>車位狀態</span>
                        <span className="text-gray-900 font-medium text-right">
                          可借車輛: {availableBikes} / 可還車位: {availableSlots}
                        </span>
                      </div>

                      {props.covered && props.covered !== '未標明' && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>遮雨頂棚</span>
                          <span className="text-gray-900 font-medium text-right">{props.covered}</span>
                        </div>
                      )}

                      {/* 10.7 分隔線與計費方案表格 (圖4) */}
                      <div className="border-t border-gray-200/80 my-0.5" />
                      <div className="flex flex-col gap-1.5 pt-0.5">
                        <span className="text-gray-600 font-medium">計費方案</span>
                        <div className="flex flex-col gap-1 bg-white p-2 rounded border border-gray-200/70 text-[10.5px]">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">一般單車 (Classic)</span>
                            <span className="text-gray-800 font-medium">$1.25 解鎖 + $0.29 /min</span>
                          </div>
                          <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                            <span className="text-gray-600">電動單車 (E-Bike)</span>
                            <span className="text-gray-800 font-medium">$2.00 解鎖 + $0.39 /min</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.website || "https://www.mobibikes.ca"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-[#00A3AD] hover:bg-teal-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 Mobi 官方網站 ↗
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Bikeways (單車徑 LineString) Details */}
              {selectedFacility.facility_type === 'bikeways' && (() => {
                const bType = selectedFacility.properties.bikeway_type || '';
                const theme = 
                  bType === 'Protected Bike Lanes' ? { bg: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-950', badge: 'bg-emerald-600' } :
                  bType === 'Painted Lanes' ? { bg: 'bg-sky-500/10 border-sky-500/25 text-sky-950', badge: 'bg-sky-600' } :
                  bType === 'Local Street' ? { bg: 'bg-amber-500/10 border-amber-500/25 text-amber-950', badge: 'bg-amber-600' } :
                  bType === 'Shared Lanes' ? { bg: 'bg-purple-500/10 border-purple-500/25 text-purple-950', badge: 'bg-purple-600' } :
                  { bg: 'bg-teal-500/10 border-teal-500/25 text-teal-950', badge: 'bg-teal-600' };

                const bikewayLabel = (() => {
                  if (bType === 'Protected Bike Lanes') return '受保護獨立單車道';
                  if (bType === 'Painted Lanes') return '路面標線單車道';
                  if (bType === 'Local Street') return '社區慢速單車街';
                  if (bType === 'Shared Lanes') return '混合共用車道';
                  return (selectedFacility.properties.bikeway_type_zh || '單車專用道').replace(/\s*\([^)]*\)/g, '').trim();
                })();

                const dirRaw = String(selectedFacility.properties.bikeway_direction || '').trim();
                const dirLower = dirRaw.toLowerCase();
                const isTwoWay = dirLower.includes('bidirectional') || dirLower.includes('two-way') || dirLower.includes('two way') || dirRaw.includes('雙向');
                const isContraFlow = dirLower.includes('cflow') || dirLower.includes('contra') || dirLower.includes('counter') || dirRaw.includes('逆向');
                const isOneWay = dirLower.includes('one-way') || dirLower.includes('one way') || dirLower === 'ow' || dirRaw.includes('單向');
                const dirZh = isTwoWay ? '雙向通行' : isContraFlow ? '逆向通行' : isOneWay ? '單向通行' : dirRaw.replace(/\s*\([^)]*\)/g, '').trim();

                const surfaceZh = selectedFacility.properties.surface_type 
                  ? String(selectedFacility.properties.surface_type).replace(/\s*\([^)]*\)/g, '').trim() 
                  : '';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 8.1 刪除「道路設施」那行，下半部改成騎乘單車必須佩戴頭盔警語 */}
                    <div className={`p-2.5 rounded-lg border flex items-center gap-1.5 text-[11px] font-medium leading-snug ${theme.bg}`}>
                      <Bike className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <span>騎乘單車必須佩戴符合安全規範的頭盔，並注意安全。</span>
                    </div>

                    {/* 灰色區塊：統一文字字體、大小 text-[11px]、顏色黑色 text-gray-800、不粗體；8.2 刪除雪花圖示 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {bikewayLabel && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>單車道類型</span>
                          <span className="text-gray-900 font-medium text-right">{bikewayLabel}</span>
                        </div>
                      )}
                      {dirZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${bikewayLabel ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>通行方向</span>
                          <span className="text-gray-900 font-medium text-right">{dirZh}</span>
                        </div>
                      )}
                      {surfaceZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${(bikewayLabel || dirZh) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>路面材質</span>
                          <span className="text-gray-900 font-medium text-right">{surfaceZh}</span>
                        </div>
                      )}
                      {selectedFacility.properties.speed_limit && (
                        <div className={`flex justify-between items-center text-gray-600 ${(bikewayLabel || dirZh || surfaceZh) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>路段速限</span>
                          <span className="text-gray-900 font-medium text-right">{selectedFacility.properties.speed_limit} km/h</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Fire Halls Details */}
              {selectedFacility.facility_type === 'fire_halls' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/25 flex items-center gap-1.5 text-xs text-rose-950 font-medium leading-snug">
                    <span className="text-base text-rose-600 font-bold shrink-0">🚒</span>
                    <span>緊急求助撥打 911</span>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>分局</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties?.name || selectedFacility.name}
                      </span>
                    </div>
                    {(selectedFacility.local_area || selectedFacility.properties?.geo_local_area) && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>服務轄區</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties?.geo_local_area || selectedFacility.local_area}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Police (警察) Details */}
              {selectedFacility.facility_type === 'police' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-blue-500/10 p-2.5 rounded-lg border border-blue-500/25 flex items-center gap-1.5 text-xs text-blue-950 font-medium leading-snug">
                    <span className="text-base text-blue-600 font-bold shrink-0">🚨</span>
                    <div className="flex flex-col leading-tight">
                      <span>重大緊急危難撥打 911</span>
                      <span className="mt-0.5 text-[10.5px] text-blue-900">非緊急報案 604-717-3321</span>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>執法機關</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.operator || 'Vancouver Police Department (VPD)'}
                      </span>
                    </div>
                    {selectedFacility.properties.opening_hours && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>開放時間</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.opening_hours}
                        </span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.website && (
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={selectedFacility.properties.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                      >
                        前往 Vancouver Police Department 官方網頁 ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Disaster Support Hubs (災害支援中心 - 海嘯與地震避難集合點) Details */}
              {selectedFacility.facility_type === 'disaster_hubs' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex flex-col gap-1.5">
                    <div className="text-[11px] text-amber-950 font-medium leading-relaxed flex items-center gap-1.5">
                      <span className="text-base text-amber-600 font-bold shrink-0">⚠️</span>
                      <span>重大災害（如大地震、海嘯）發生後，市民集結互助、協調支援、領取緊急救援資訊與物資之官方指定避難集合中心。</span>
                    </div>
                  </div>

                  {selectedFacility.properties.phone && (
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>聯絡電話</span>
                        <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                          {selectedFacility.properties.phone}
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="pt-1 border-t border-gray-100 flex flex-col gap-1">
                    <a
                      href="https://vancouver.ca/home-property-development/disaster-support-hubs.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors shadow-sm text-center"
                    >
                      查看溫哥華市政府災害中心專頁 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Community Centres Details */}
              {selectedFacility.facility_type === 'community_centres' && (() => {
                const props = selectedFacility.properties || {};
                const hours = props.hours;
                const phone = props.phone;
                const fax = props.fax;
                const email = props.email;
                const urllink = props.urllink || 'https://vancouver.ca/parks-recreation-culture/community-and-cultural-centres.aspx';

                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const dayNamesZh: Record<string, string> = {
                  Sunday: '週日',
                  Monday: '週一',
                  Tuesday: '週二',
                  Wednesday: '週三',
                  Thursday: '週四',
                  Friday: '週五',
                  Saturday: '週六'
                };
                const todayKey = daysOfWeek[new Date().getDay()];
                const todayVal = hours && typeof hours === 'object' ? hours[todayKey] : (typeof hours === 'string' ? hours : null);
                const todayHoursStr = todayVal ? formatTimePreference(todayVal, timeFormat) : '';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 36.1 紫色區塊 */}
                    <div className="bg-violet-500/10 p-2.5 rounded-lg border border-violet-500/25 flex items-center gap-1.5 text-[11px] text-violet-950 font-medium leading-relaxed">
                      <span className="text-base text-violet-600 font-bold shrink-0">🏛️</span>
                      <span>鄰里共融的休閒與文康樞紐，提供各類康體設施、場地租借及豐富的社區居民活動。</span>
                    </div>

                    {/* 36.2.2 灰色區塊 (圖5) */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {hours && (
                        typeof hours === 'object' ? (
                          <details className="group">
                            <summary className="flex justify-between items-center text-gray-600 cursor-pointer list-none hover:text-violet-700">
                              <span>開放時間</span>
                              <span className="text-gray-800 text-right font-medium flex items-center gap-1">
                                <span>{dayNamesZh[todayKey]}: {todayHoursStr || '未公佈'}</span>
                                <span className="text-[9px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                              </span>
                            </summary>
                            <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1 text-[10.5px]">
                              {Object.entries(hours).map(([day, val]) => (
                                <div key={day} className={`flex justify-between gap-2 ${day === todayKey ? 'font-semibold text-violet-800' : 'text-gray-600'}`}>
                                  <span className="shrink-0">{dayNamesZh[day] || day}</span>
                                  <span className="text-right leading-tight">{formatTimePreference(String(val), timeFormat)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>開放時間</span>
                            <span className="text-gray-900 font-medium text-right">{todayHoursStr}</span>
                          </div>
                        )
                      )}

                      {(phone || email || fax) && <div className="border-t border-gray-200/80 my-0.5" />}

                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 hover:text-violet-600 font-medium break-all text-right text-[10.5px] leading-tight"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-violet-50 text-violet-600 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`發送郵件至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}

                      {fax && (
                        <div className={`flex justify-between items-center text-gray-600 ${(phone || email) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>傳真</span>
                          <span className="text-gray-800 font-medium">{fax}</span>
                        </div>
                      )}
                    </div>

                    {urllink && (
                      <div className="pt-1 border-t border-gray-100">
                        <a 
                          href={urllink} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 {selectedFacility.name || props.name || '社區中心'} 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Museums (38 博物館) Details */}
              {selectedFacility.facility_type === 'museums' && (() => {
                const props = selectedFacility.properties || {};
                const hours = props.hours;
                const admission = props.admission_rates;
                const notes = props.notes;
                const phone = props.phone;
                const email = props.email;
                const urllink = props.urllink;
                const museumName = selectedFacility.name || props.name || '博物館';

                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const dayNamesZh: Record<string, string> = {
                  Sunday: '週日',
                  Monday: '週一',
                  Tuesday: '週二',
                  Wednesday: '週三',
                  Thursday: '週四',
                  Friday: '週五',
                  Saturday: '週六'
                };
                const todayKey = daysOfWeek[new Date().getDay()];
                const todayVal = hours && typeof hours === 'object' ? hours[todayKey] : (typeof hours === 'string' ? hours : null);
                const todayHoursStr = todayVal ? formatTimePreference(todayVal, timeFormat) : '';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 深灰色區塊 */}
                    <div className="bg-slate-500/10 p-2.5 rounded-lg border border-slate-500/25 flex items-center gap-1.5 text-[11px] text-slate-800 font-medium leading-relaxed">
                      <span className="text-base text-slate-600 font-bold shrink-0">🏛️</span>
                      <span>典藏歷史文脈與藝術結晶，展現溫哥華多元豐富的文化景觀與人文風采。</span>
                    </div>

                    {/* 灰色區塊 (圖1) */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {/* 開放時間 */}
                      {hours && (
                        typeof hours === 'object' ? (
                          <details className="group">
                            <summary className="flex justify-between items-center text-gray-600 cursor-pointer list-none hover:text-slate-800">
                              <span>開放時間</span>
                              <span className="text-gray-800 text-right font-medium flex items-center gap-1">
                                <span>{dayNamesZh[todayKey]}: {todayHoursStr || '未公佈'}</span>
                                <span className="text-[9px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                              </span>
                            </summary>
                            <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1 text-[10.5px]">
                              {Object.entries(hours).map(([day, val]) => (
                                <div key={day} className={`flex justify-between gap-2 ${day === todayKey ? 'font-semibold text-slate-900' : 'text-gray-600'}`}>
                                  <span className="shrink-0">{dayNamesZh[day] || (day === 'Holidays_and_Seasonal' ? '節假日／特別排程' : day)}</span>
                                  <span className="text-right leading-tight">{formatTimePreference(String(val), timeFormat)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>開放時間</span>
                            <span className="text-gray-900 font-medium text-right">{todayHoursStr}</span>
                          </div>
                        )
                      )}

                      {/* 分隔線 */}
                      {(admission || notes) && <div className="border-t border-gray-200/80 my-0.5" />}

                      {/* 入場費用 */}
                      {admission && (
                        typeof admission === 'object' ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-gray-600 font-medium">入場費用</span>
                            <div className="flex flex-col gap-1 pt-0.5">
                              {Object.entries(admission).map(([tier, rate]) => (
                                <div key={tier} className="flex items-center justify-between text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-gray-200/60">
                                  <span className="text-gray-700">{tier}</span>
                                  <span className="font-semibold text-slate-800 font-mono">{String(rate)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>入場費用</span>
                            <span className="text-gray-800 font-medium">{String(admission)}</span>
                          </div>
                        )
                      )}

                      {/* 備註 */}
                      {notes && (
                        <div className="mt-1 p-2 bg-amber-50 rounded border border-amber-200/60 text-[10.5px] text-amber-900 leading-snug flex items-start gap-1">
                          <span className="shrink-0">💡</span>
                          <span>{notes}</span>
                        </div>
                      )}

                      {/* 分隔線 */}
                      {(phone || email) && <div className="border-t border-gray-200/80 my-0.5" />}

                      {/* 聯絡電話 */}
                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {/* 聯絡電郵 */}
                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 hover:text-slate-900 font-medium break-all text-right text-[10.5px] leading-tight"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`發送郵件至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 38.6 前往官方網頁按鈕 */}
                    {urllink && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={urllink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded font-medium text-xs transition-colors shadow-sm text-center"
                        >
                          前往 {museumName} 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Garbage Collection (39 廢物回收) Details */}
              {selectedFacility.facility_type === 'garbage_collection' && (() => {
                const props = selectedFacility.properties || {};
                const freqGarbage = props.frequency_garbage;
                const freqGreen = props.frequency_green_bin;
                const sampleDates = Array.isArray(props.sample_garbage_dates_2026_2027) ? props.sample_garbage_dates_2026_2027 : [];
                const extraLeafDates = Array.isArray(props.extra_leaf_dates) ? props.extra_leaf_dates : [];
                const xmasTree = props.christmas_tree_pickup;
                const chipping = props.tree_chipping_event;
                const setOutRules = props.set_out_rules;
                const colorHex = props.color_hex || '#f97316';

                // Find next upcoming date from sampleDates
                const todayStr = new Date().toISOString().split('T')[0];
                const upcomingDates = sampleDates.filter((d: string) => d >= todayStr);
                const nextDate = upcomingDates[0] || sampleDates[0];

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 顏色區塊 */}
                    <div 
                      className="p-2.5 rounded-lg border flex items-center gap-1.5 text-[11px] font-medium leading-relaxed"
                      style={{ 
                        backgroundColor: `${colorHex}18`, 
                        borderColor: `${colorHex}45`,
                        color: '#431407'
                      }}
                    >
                      <span className="text-base font-bold shrink-0">🚛</span>
                      <span>溫哥華市政公共垃圾與綠色廚餘定期收集分區排程，落實資源循環減碳。</span>
                    </div>

                    {/* 灰色區塊 (圖2) */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {/* 垃圾回收頻率 */}
                      {freqGarbage && (
                        <div className="flex justify-between items-start text-gray-600 gap-2">
                          <span className="shrink-0 font-medium">垃圾回收頻率</span>
                          <span className="text-gray-900 font-medium text-right">{freqGarbage}</span>
                        </div>
                      )}

                      {/* 廚餘回收頻率 */}
                      {freqGreen && (
                        <div className="flex justify-between items-start text-gray-600 gap-2 pt-1 border-t border-gray-100">
                          <span className="shrink-0 font-medium">廚餘回收頻率</span>
                          <span className="text-gray-900 font-medium text-right">{freqGreen}</span>
                        </div>
                      )}

                      {/* 分隔線 */}
                      {(sampleDates.length > 0 || extraLeafDates.length > 0 || xmasTree || chipping) && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {/* 垃圾回收排程 */}
                      {sampleDates.length > 0 && (
                        <details className="group">
                          <summary className="flex justify-between items-center text-gray-600 cursor-pointer list-none hover:text-orange-700">
                            <span className="font-medium">垃圾回收排程</span>
                            <span className="text-gray-800 text-right font-mono flex items-center gap-1">
                              <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold text-[10px]">下次: {nextDate}</span>
                              <span className="text-[9px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                            </span>
                          </summary>
                          <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-wrap gap-1 max-h-32 overflow-y-auto [scrollbar-width:thin] p-0.5">
                            {sampleDates.map((d: string) => (
                              <span
                                key={d}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                  d === nextDate 
                                    ? 'bg-orange-500 text-white border-orange-600 font-bold' 
                                    : 'bg-white text-gray-700 border-gray-200'
                                }`}
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* 額外樹葉收集 */}
                      {extraLeafDates.length > 0 && (
                        <div className="flex justify-between items-start text-gray-600 pt-1 border-t border-gray-100 gap-2">
                          <span className="shrink-0 font-medium">額外樹葉收集</span>
                          <div className="flex flex-wrap justify-end gap-1">
                            {extraLeafDates.map((ld: string) => (
                              <span key={ld} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono">
                                {ld}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 聖誕樹回收 */}
                      {xmasTree && (
                        <div className="flex justify-between items-start text-gray-600 pt-1 border-t border-gray-100 gap-2">
                          <span className="shrink-0 font-medium">聖誕樹回收</span>
                          <span className="text-gray-800 text-right text-[10.5px] leading-snug">{xmasTree}</span>
                        </div>
                      )}

                      {/* 碎樹活動 */}
                      {chipping && (
                        <div className="flex justify-between items-start text-gray-600 pt-1 border-t border-gray-100 gap-2">
                          <span className="shrink-0 font-medium">碎樹活動</span>
                          <span className="text-gray-800 text-right font-mono text-[10.5px]">{chipping}</span>
                        </div>
                      )}

                      {/* 分隔線 */}
                      {setOutRules && <div className="border-t border-gray-200/80 my-0.5" />}

                      {/* 放置規定 */}
                      {setOutRules && (
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-600 font-medium">放置規定</span>
                          <div className="p-2 bg-amber-50 rounded border border-amber-200/60 text-[10.5px] text-amber-900 leading-relaxed flex items-start gap-1">
                            <span className="shrink-0">📋</span>
                            <span>{setOutRules}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href="https://vancouver.ca/home-property-development/garbage-and-recycling-collection-schedules.aspx"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-orange-600 hover:bg-orange-700 text-white rounded font-medium text-xs transition-colors shadow-sm text-center"
                      >
                        前往 廢物回收時間表 官方網頁 ↗
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Traffic Cameras Details */}
              {selectedFacility.facility_type === 'traffic_cameras' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 15.1 顏色主題 #0284C7；15.2 刪除「道路設施」那行；15.3 右方貼邊加入 (x秒前更新) 與手動更新按鈕 */}
                  <div className="bg-[#0284C7]/10 p-2.5 rounded-lg border border-[#0284C7]/25 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-[#0284C7] font-medium">
                      <Camera className="w-3.5 h-3.5 text-[#0284C7] shrink-0" />
                      <span>即時路況畫面</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-gray-500 font-mono">
                        {selectedFacility.properties?.provider === 'DriveBC' ? '(每 15 分鐘更新)' : `(${cameraSecondsAgo} 秒前更新)`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setWebcamRefreshKey(k => k + 1);
                          cameraLastUpdatedRef.current = Date.now();
                          setCameraSecondsAgo(0);
                        }}
                        className="p-1 bg-white border border-[#0284C7]/30 text-[#0284C7] hover:bg-[#0284C7]/10 rounded-md transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
                        title="手動重新整理即時畫面"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {selectedFacility.properties?.provider === 'DriveBC' || selectedFacility.properties?.camera_id ? (() => {
                    const camId = selectedFacility.properties.camera_id;
                    const fifteenMinTimestamp = Math.floor(Date.now() / (15 * 60 * 1000));
                    const directSrc = `https://www.drivebc.ca/images/${camId}.jpg?t=${fifteenMinTimestamp}_${webcamRefreshKey}`;
                    return (
                      <div className="flex flex-col gap-2 pt-0.5">
                        <div
                          onClick={() => setEnlargedCameraImage({
                            src: directSrc,
                            directSrc: directSrc,
                            alt: selectedFacility.name,
                            title: selectedFacility.name,
                            direction: selectedFacility.properties.description || selectedFacility.properties.direction || 'DriveBC 即時監視'
                          })}
                          className="w-full h-48 bg-black rounded-lg overflow-hidden relative cursor-zoom-in group shadow-inner flex items-center justify-center border border-gray-700/60"
                          title="點擊放大檢視即時畫面"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={directSrc}
                            alt={selectedFacility.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none z-10">
                            <span className="bg-black/75 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                              <ZoomIn className="w-3 h-3 text-cyan-300" />
                              <span>點擊放大檢視</span>
                            </span>
                          </div>
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-1.5 pt-3 text-[10.5px] font-medium text-white flex items-center justify-between z-20">
                            <span>{selectedFacility.properties.direction || selectedFacility.properties.highway || 'Highway 1'}</span>
                            <span className="font-mono text-cyan-300 text-[10px]">每 15 分鐘自動更新</span>
                          </div>
                        </div>

                        {selectedFacility.properties.description && (
                          <div className="p-2 bg-gray-50 rounded border border-gray-100 text-[11px] text-gray-700 leading-snug">
                            <span>{selectedFacility.properties.description}</span>
                          </div>
                        )}

                        {selectedFacility.properties.url && (
                          <div className="pt-0.5">
                            <a
                              href={selectedFacility.properties.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                            >
                              <span>前往 DriveBC 官方攝影機網頁 ↗</span>
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })() : loadingWebcam ? (
                    <div className="py-7 px-3 flex flex-col items-center justify-center bg-slate-900/95 rounded-lg border border-cyan-500/30 text-gray-200 gap-2.5 shadow-inner">
                      <div className="relative flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-cyan-500/30 rounded-full"></div>
                        <div className="absolute w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs">📷</span>
                      </div>
                      <div className="flex flex-col items-center gap-1 text-center">
                        <span className="text-[11px] font-bold text-cyan-300 tracking-wide">
                          正在從交通局 API 載入即時路況圖片...
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
                          <div
                            key={idx}
                            onClick={() => {
                              if (isImgReady) {
                                setEnlargedCameraImage({
                                  src: proxySrc,
                                  directSrc: directSrc,
                                  alt: img.alt || img.direction,
                                  title: selectedFacility.name || '即時路況攝影機',
                                  direction: img.direction
                                });
                              }
                            }}
                            className="relative rounded overflow-hidden border border-gray-200 bg-slate-900 aspect-[4/3] group shadow-sm cursor-zoom-in"
                            title="點擊放大檢視畫面"
                          >
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
                            {/* Hover overlay hint */}
                            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none z-10">
                              <span className="bg-black/75 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                                <ZoomIn className="w-3 h-3 text-cyan-300" />
                                <span>點擊放大</span>
                              </span>
                            </div>
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
                </div>
              )}

              {/* Intersection Safety Cameras Details */}
              {selectedFacility.facility_type === 'safety_cameras' && (() => {
                const hasSpeed = Boolean(selectedFacility.properties?.has_speed);
                const themeColor = hasSpeed ? '#991B1B' : '#DC2626';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 16.1.1 #DC2626 / 16.2.1 #991B1B */}
                    <div className={`p-2.5 rounded-lg border flex items-center gap-1.5 leading-snug ${
                      hasSpeed 
                        ? 'bg-[#991B1B]/10 border-[#991B1B]/25 text-[#991B1B]' 
                        : 'bg-[#DC2626]/10 border-[#DC2626]/25 text-[#DC2626]'
                    }`}>
                      <span className="text-base shrink-0">{hasSpeed ? '🚨' : '🛑'}</span>
                      <span className="text-xs font-bold">
                        {hasSpeed ? '闖紅燈及超速照相取締' : '闖紅燈照相取締'}
                      </span>
                    </div>

                    {/* 16.1.3 (圖1) / 16.2.3 (圖2) BC 省法定裁罰標準表格 */}
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-700 font-semibold text-[11px]">BC 省法定裁罰標準</span>
                      <div className="overflow-hidden rounded border border-gray-200 text-[11px] bg-white">
                        <table className="w-full text-center border-collapse">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 font-bold">
                              <th className="py-1 px-2 border-r border-gray-200 text-left font-normal text-gray-500">違規項目</th>
                              <th className="py-1 px-2 border-r border-gray-200">處罰金額</th>
                              <th className="py-1 px-2">記扣點數</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 text-gray-800">
                            <tr>
                              <td className="py-1.5 px-2 border-r border-gray-200 text-left font-medium">闖紅燈違規</td>
                              <td className="py-1.5 px-2 border-r border-gray-200 font-medium">$167</td>
                              <td className="py-1.5 px-2 font-medium">記扣 3 點</td>
                            </tr>
                            {hasSpeed && (
                              <tr>
                                <td className="py-1.5 px-2 border-r border-gray-200 text-left font-medium">路口超速違規</td>
                                <td className="py-1.5 px-2 border-r border-gray-200 font-medium">$138 - $483</td>
                                <td className="py-1.5 px-2 font-medium">依超速幅度記點</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-[10px] text-gray-500 text-right pt-0.5">
                        執法機構：RoadSafetyBC / ICBC / VPD 聯合管轄
                      </div>
                    </div>

                    {/* 16. 前往 RoadSafetyBC 官方網頁 */}
                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href="https://www2.gov.bc.ca/gov/content/transportation/driving-and-cycling/roadsafetybc/intersection-safety-cameras/where-the-cameras-are"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center justify-center w-full py-1.5 px-3 text-white rounded font-medium text-xs transition-colors shadow-sm ${
                          hasSpeed ? 'bg-[#991B1B] hover:bg-red-900' : 'bg-[#DC2626] hover:bg-red-700'
                        }`}
                      >
                        前往 RoadSafetyBC 官方網頁 ↗
                      </a>
                    </div>
                  </div>
                );
              })()}

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
                let statusText = '迅速';
                if (status === 'packed') {
                  statusBg = 'bg-rose-50 border-rose-200 text-rose-900';
                  badgeBg = 'bg-rose-600 text-white';
                  statusText = '壅塞';
                } else if (status === 'moderate') {
                  statusBg = 'bg-amber-50 border-amber-200 text-amber-900';
                  badgeBg = 'bg-amber-600 text-white';
                  statusText = '適中';
                } else if (status === 'quick') {
                  statusBg = 'bg-emerald-50 border-emerald-200 text-emerald-900';
                  badgeBg = 'bg-emerald-600 text-white';
                  statusText = '迅速';
                } else {
                  statusBg = 'bg-blue-50 border-blue-200 text-blue-900';
                  badgeBg = 'bg-blue-600 text-white';
                  statusText = '正常';
                }

                const rawTypeLabel = selectedFacility.properties?.type_label || (isRehab ? '專科復健中心' : isUPCC ? '急症基層醫療中心' : '急症綜合醫院');
                const cleanTypeLabel = (rawLabel?: string) => (rawLabel || '').replace(/\s*\([A-Za-z\s/]+\)/g, '').trim();

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* Facility Type Green Block: 刪除英文 (如: Emergency Hospital/UPCC) */}
                    <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/25 flex items-center justify-between text-[11px] text-emerald-950 font-medium leading-snug">
                      <span className="flex items-center gap-1.5">
                        <span className="text-base text-emerald-600 font-bold">🏥</span>
                        <span>{cleanTypeLabel(rawTypeLabel)}</span>
                      </span>
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
                            <span>預估總停留時間</span>
                            <span className="font-bold font-mono">{elosTime}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Hospital / UPCC / Rehab Info Card */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties?.services && (
                        <div className="flex justify-between items-start text-gray-600 gap-2">
                          <span className="shrink-0">主要服務</span>
                          <span className="text-gray-900 font-medium text-right">{selectedFacility.properties.services}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.operator && (
                        <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties?.services ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>營運機構</span>
                          <span className="text-gray-900 font-medium text-right">{selectedFacility.properties.operator}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.hours && (
                        <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties?.services || selectedFacility.properties?.operator) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>{isRehab ? '服務時間' : isUPCC ? '門診服務時間' : '急診門診時間'}</span>
                          <span className="text-gray-900 font-medium text-right">{selectedFacility.properties.hours}</span>
                        </div>
                      )}
                      {selectedFacility.properties?.phone && (
                        <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties?.services || selectedFacility.properties?.operator || selectedFacility.properties?.hours) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>聯絡電話</span>
                          <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {selectedFacility.properties.phone}
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Action Links */}
                    {selectedFacility.properties?.website && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={selectedFacility.properties.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 {selectedFacility.properties?.short_name || selectedFacility.name} 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Parks Details */}
              {selectedFacility.facility_type === 'parks' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 33.1 公園：已移至左上角膠囊，保留公園設施標題 */}
                  <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/25 flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                    <span className="text-base text-emerald-600 font-bold">🌲</span>
                    <span>公園設施</span>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>綠地面積</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.hectare != null ? `${selectedFacility.properties.hectare} 公頃 (ha)` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>休閒設施</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.facilities === '有' ? '有' : '無'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>園區廁所</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.washrooms === '有' ? '有' : '無'}
                      </span>
                    </div>
                  </div>

                  {selectedFacility.properties.specialfeatures && 
                   selectedFacility.properties.specialfeatures !== 'N' && 
                   selectedFacility.properties.specialfeatures !== 'Y' && 
                   String(selectedFacility.properties.specialfeatures).trim().length > 1 && (
                    <div className="bg-amber-50/70 p-2 rounded text-[11px] text-amber-900 border border-amber-200/60">
                      <span className="font-semibold block mb-0.5">🌟 特色設施與景觀：</span>
                      <span>{selectedFacility.properties.specialfeatures}</span>
                    </div>
                  )}

                  {/* 26.2 前往 Vancouver Board of Parks and Recreation 官方網頁 */}
                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href="https://vancouver.ca/parks-recreation-culture/parks-and-recreation.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      前往 Vancouver Board of Parks and Recreation 官方網頁 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Parks Facilities Details */}
              {selectedFacility.facility_type === 'parks_facilities' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 33.2 公園設施：已移至左上角膠囊 */}
                  <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/25 flex items-center gap-1.5 text-xs font-bold text-teal-950">
                    <span className="text-base text-teal-600 font-bold">🛝</span>
                    <span>公園設施</span>
                  </div>

                  {/* 27.2 & 27.3 灰底區塊：設施名稱與設施數量 */}
                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>設施</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.facility_type_name || selectedFacility.name}
                      </span>
                    </div>
                    {selectedFacility.properties.facility_count != null && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>設施數量</span>
                        <span className="text-gray-900 font-medium text-right">{selectedFacility.properties.facility_count} 座</span>
                      </div>
                    )}
                  </div>

                  {/* 27.4 底部加入前往 Vancouver Board of Parks and Recreation 官方網頁 */}
                  <div className="pt-1 border-t border-gray-100">
                    <a
                      href="https://vancouver.ca/parks-recreation-culture/parks-and-recreation.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      前往 Vancouver Board of Parks and Recreation 官方網頁 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Community Gardens Details */}
              {selectedFacility.facility_type === 'community_gardens' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 33.3 社區花園：已移至左上角膠囊 */}
                  <div className="bg-lime-500/10 p-2.5 rounded-lg border border-lime-500/25 flex items-center gap-1.5 text-xs font-bold text-lime-950">
                    <span className="text-base text-lime-600 font-bold">🌻</span>
                    <span>公園設施</span>
                  </div>

                  {/* 28.2 灰色區塊內無 emoji，耕作畦位下方若有果樹則加分隔線顯示品種 */}
                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span className="shrink-0">營運組織</span>
                      <span className="text-gray-800 text-right leading-snug">
                        {selectedFacility.properties.managing_org || '志工/社區共同維護'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>成立年份</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.year_created ? `${selectedFacility.properties.year_created} 年` : '未載明'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>耕作畦位</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.plots != null ? `${selectedFacility.properties.plots} 格` : '未載明'}
                      </span>
                    </div>

                    {((selectedFacility.properties.food_trees != null && selectedFacility.properties.food_trees > 0) || selectedFacility.properties.food_tree_varieties) && (
                      <>
                        <div className="border-t border-gray-200/80 my-0.5" />
                        {selectedFacility.properties.food_trees != null && (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>社區果樹</span>
                            <span className="text-gray-900 font-medium text-right">
                              {selectedFacility.properties.food_trees} 棵
                            </span>
                          </div>
                        )}
                        {selectedFacility.properties.food_tree_varieties && (
                          <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.food_trees != null ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span className="shrink-0">果樹品種</span>
                            <span className="text-gray-900 font-medium text-right">
                              {selectedFacility.properties.food_tree_varieties}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

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
              {selectedFacility.facility_type === 'drinking_fountains' && (() => {
                const inOp = selectedFacility.properties.in_operation;
                const loc = selectedFacility.properties.location;
                const pf = selectedFacility.properties.pet_friendly;
                const maintainer = selectedFacility.properties.maintainer;

                const formatPetFriendly = (raw?: string | null) => {
                  if (!raw) return null;
                  const s = String(raw).trim().toUpperCase();
                  if (s === 'Y' || s === 'YES' || s.includes('友善') || s === '是') return '是';
                  if (s === 'N' || s === 'NO' || s.includes('一般') || s === '否') return '否';
                  return raw;
                };
                const pfZh = formatPetFriendly(pf);

                const formatInOp = (raw?: string | null) => {
                  if (!raw) return null;
                  const s = String(raw).trim().toLowerCase();
                  if (s.includes('spring') && s.includes('fall')) return '春季至秋季開放';
                  if (s.includes('year')) return '全年開放';
                  if (s.includes('may') && s.includes('october')) return '5月至10月開放';
                  return raw;
                };
                const inOpZh = formatInOp(inOp);

                const formatMaintainer = (raw?: string | null) => {
                  if (!raw) return null;
                  const s = String(raw).trim();
                  if (s.toLowerCase() === 'parks') return '公園局 (Parks)';
                  if (s.toLowerCase() === 'engineering') return '工程局 (Engineering)';
                  return raw;
                };
                const maintainerZh = formatMaintainer(maintainer);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 30.5 公園設施標題 */}
                    <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex items-center gap-1.5 text-xs font-bold text-sky-950">
                      <span className="text-base text-sky-600 font-bold">💧</span>
                      <span>公園設施</span>
                    </div>

                    {/* 30.6 灰底資料掛序：開放營運(不加粗) -> 詳細位置 -> 寵物友善(是/否) -> 管理維護單位 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {inOpZh && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>開放營運</span>
                          <span className="text-gray-900 font-medium text-right">
                            {inOpZh}
                          </span>
                        </div>
                      )}
                      {loc && (
                        <div className={`flex justify-between items-center text-gray-600 ${inOpZh ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span className="shrink-0">詳細位置</span>
                          <span className="text-gray-900 font-medium text-right">{loc}</span>
                        </div>
                      )}
                      {pfZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${(inOpZh || loc) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>寵物友善</span>
                          <span className="text-gray-900 font-medium text-right">{pfZh}</span>
                        </div>
                      )}
                      {maintainerZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${(inOpZh || loc || pfZh) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>管理維護單位</span>
                          <span className="text-gray-900 font-medium text-right">{maintainerZh}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Public Washrooms Details */}
              {selectedFacility.facility_type === 'public_washrooms' && (() => {
                const loc = selectedFacility.properties.location;
                const rawType = selectedFacility.properties.washroom_type || selectedFacility.properties.type;
                const formatWashroomType = (t?: string) => {
                  if (!t) return null;
                  if (t === 'LargeAPT') return '自動洗手間 (Large APT)';
                  if (t === 'SmallAPT') return '自動洗手間 (Small APT)';
                  if (t === 'ComfortStation') return '常設洗手間 (Comfort Station)';
                  if (t === 'Community Center') return '社區中心洗手間';
                  return t;
                };
                const washType = formatWashroomType(rawType);

                const rawWheelchair = selectedFacility.properties.wheelchair_access;
                const wheelchairZh = (() => {
                  if (!rawWheelchair) return null;
                  const s = String(rawWheelchair).toLowerCase();
                  if (s.includes('yes') || s.includes('無障礙') || s === 'y' || s === '是') return '是';
                  if (s.includes('no') || s.includes('一般') || s === 'n' || s === '否') return '否';
                  return null;
                })();

                const formatHours = (h?: string) => {
                  if (!h) return null;
                  return h.replace(/24hrs\s*-\s*24hrs/gi, '24hrs');
                };
                const summerH = formatHours(selectedFacility.properties.summer_hours);
                const winterH = formatHours(selectedFacility.properties.winter_hours);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 31.2 公園設施標題 */}
                    <div className="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/25 flex items-center gap-1.5 text-xs font-bold text-cyan-950">
                      <span className="text-base text-cyan-600 font-bold">🚻</span>
                      <span>公園設施</span>
                    </div>

                    {/* 31.5 灰底資料掛序：詳細位置 -> 公廁類型(不粗體) -> 無障礙規格(是/否) -> 夏季開放時間 -> 冬季開放時間 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {loc && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span className="shrink-0">詳細位置</span>
                          <span className="text-gray-900 font-medium text-right">{loc}</span>
                        </div>
                      )}
                      {washType && (
                        <div className={`flex justify-between items-center text-gray-600 ${loc ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>公廁類型</span>
                          <span className="text-gray-900 font-medium text-right">
                            {washType}
                          </span>
                        </div>
                      )}
                      {wheelchairZh && (
                        <div className={`flex justify-between items-center text-gray-600 ${(loc || washType) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>無障礙規格</span>
                          <span className="text-gray-900 font-medium text-right">
                            {wheelchairZh}
                          </span>
                        </div>
                      )}
                      {summerH && (
                        <div className={`flex justify-between items-center text-gray-600 ${(loc || washType || wheelchairZh) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>夏季開放時間</span>
                          <span className="text-gray-900 font-medium text-right">{summerH}</span>
                        </div>
                      )}
                      {winterH && (
                        <div className={`flex justify-between items-center text-gray-600 ${(loc || washType || wheelchairZh || summerH) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>冬季開放時間</span>
                          <span className="text-gray-900 font-medium text-right">{winterH}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Schools Details */}
              {selectedFacility.facility_type === 'schools' && (() => {
                const props = selectedFacility.properties || {};
                const rawCat = props.school_category_zh || props.school_category || props.category || '';
                const categoryDisplay = rawCat === 'StrongStart BC' || /StrongStart/i.test(rawCat) 
                  ? '學前課程' 
                  : (rawCat || '公立學校');
                const phone = props.phone;
                const email = props.email;
                const url = props.url;
                const schoolName = props.vsb_name || selectedFacility.name;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-blue-500/10 p-2.5 rounded-lg border border-blue-500/25 flex items-center gap-1.5 text-[11px] font-medium text-blue-950 leading-relaxed">
                      <span className="text-sm shrink-0">🚸</span>
                      <span>留意校區慢行管制路段，上課日 08:00 - 17:00 法定最高限速 30/40 km/h，請隨時注意學童穿越。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>類別</span>
                        <span className="text-gray-900 font-medium text-right">
                          {categoryDisplay}
                        </span>
                      </div>

                      {(phone || email) && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 font-medium break-all text-right text-[10.5px] leading-tight hover:text-blue-600"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-blue-50 text-blue-600 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`寄信至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>

                    {url && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 {schoolName} 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Libraries Details */}
              {selectedFacility.facility_type === 'libraries' && (() => {
                const props = selectedFacility.properties || {};
                const hours = props.hours;
                const upcomingClosures = props.upcoming_closures;
                const bookDrop = props.after_hours_book_drop;
                const phone = props.phone;
                const email = props.email;
                const urllink = props.urllink;

                // Format hours
                let todayHoursStr = '';
                if (hours && typeof hours === 'object') {
                  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                  const todayName = daysOfWeek[new Date().getDay()];
                  const h = hours[todayName];
                  if (h) todayHoursStr = formatTimePreference(h, timeFormat);
                } else if (typeof hours === 'string') {
                  todayHoursStr = formatTimePreference(hours, timeFormat);
                }

                const upcomingClosure = Array.isArray(upcomingClosures) && upcomingClosures.length > 0 
                  ? upcomingClosures[0] 
                  : (typeof upcomingClosures === 'string' ? upcomingClosures : null);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex items-center gap-1.5 text-[11px] font-medium text-amber-950 leading-relaxed">
                      <span className="text-sm shrink-0">📚</span>
                      <span>共同維護優質閱覽環境，館內請保持安靜與輕聲細語。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {todayHoursStr && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>開放時間</span>
                          <span className="text-gray-900 font-medium text-right">{todayHoursStr}</span>
                        </div>
                      )}

                      {upcomingClosure && (
                        <div className={`flex justify-between items-start text-gray-600 ${todayHoursStr ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">閉館日</span>
                          <span className="text-gray-800 text-right font-medium leading-snug">{upcomingClosure}</span>
                        </div>
                      )}

                      {bookDrop && (
                        <div className={`flex justify-between items-center text-gray-600 ${(todayHoursStr || upcomingClosure) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>閉館還書</span>
                          <span className="text-gray-900 font-medium text-right">
                            {bookDrop === 'Yes' || bookDrop === 'yes' || bookDrop === true ? '有提供 (24hr 還書箱)' : bookDrop}
                          </span>
                        </div>
                      )}

                      {(phone || email) && <div className="border-t border-gray-200/80 my-0.5" />}

                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 font-medium break-all text-right text-[10.5px] leading-tight hover:text-amber-600"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-amber-50 text-amber-600 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`發送郵件至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>

                    {urllink && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={urllink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 Vancouver Public Library 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Food Vendors Details */}
              {selectedFacility.facility_type === 'food_vendors' && (() => {
                const props = selectedFacility.properties || {};
                const name = props.name || selectedFacility.name;
                const address = props.address;
                const rawHours = props.hours || props.operating_hours;
                const hours = rawHours ? formatTimePreference(rawHours, timeFormat) : null;
                const creditCard = props.credit_card || props.payment_methods || '支援';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-orange-500/10 p-2.5 rounded-lg border border-orange-500/25 flex items-center gap-1.5 text-[11px] font-medium text-orange-950 leading-relaxed">
                      <span className="text-base text-orange-600 font-bold shrink-0">🍱</span>
                      <span>特色街頭餐車與小吃點，營業時間與出攤位置可能受天候與活動影響。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>名稱</span>
                          <span className="text-gray-900 font-medium text-right">{name}</span>
                        </div>
                      )}
                      {address && (
                        <div className={`flex justify-between items-center text-gray-600 ${name ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>地址</span>
                          <span className="text-gray-800 text-right max-w-[190px] truncate">{address}</span>
                        </div>
                      )}
                      {hours && (
                        <div className={`flex justify-between items-center text-gray-600 ${(name || address) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>營業時間</span>
                          <span className="text-gray-900 font-medium text-right">{hours}</span>
                        </div>
                      )}
                      {creditCard && (
                        <div className={`flex justify-between items-center text-gray-600 ${(name || address || hours) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>支援信用卡</span>
                          <span className="text-gray-900 font-medium text-right">{creditCard}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Homeless Shelters Details */}
              {selectedFacility.facility_type === 'homeless_shelters' && (() => {
                const formatShelterYesNo = (val?: string) => {
                  if (!val || val === '未註記' || val.toLowerCase() === 'unknown') return '不詳';
                  if (val.includes('有') || val.includes('允許') || val.includes('可') || /^(yes|true)$/i.test(val)) return '是';
                  if (val.includes('無') || val.includes('不可') || /^(no|false)$/i.test(val)) return '否';
                  return val;
                };

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/25 flex items-center gap-1.5 text-[11px] font-medium text-rose-950 leading-relaxed">
                      <span className="text-base text-rose-600 font-bold shrink-0">🏠</span>
                      <span>全天候庇護與包容性收容空間，守護每一位需要協助的市民，提供尊嚴、安全與重返穩定的轉機。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-2 text-[11px]">
                      {selectedFacility.properties.category && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>收容對象</span>
                          <span className="text-gray-900 font-medium text-right">
                            {(() => {
                              const cat = String(selectedFacility.properties.category);
                              if (/Adults\s*\(all\s*gender\)/i.test(cat) || /All\s*gender/i.test(cat)) return '成人';
                              if (/Men\s*&\s*Women/i.test(cat)) return '男性與女性';
                              if (/^Men$/i.test(cat.trim())) return '男性';
                              if (/^Women$/i.test(cat.trim())) return '女性';
                              if (/Youth/i.test(cat)) return '青年';
                              return cat.replace(/Men/g, '男性').replace(/Women/g, '女性').replace(/Adults/g, '成人').replace(/Youth/g, '青年');
                            })()}
                          </span>
                        </div>
                      )}

                      {/* 24.2 一列三欄橫向顯示 (是/否) meal, pets, carts */}
                      <div className="grid grid-cols-3 gap-1.5 text-center pt-1.5 border-t border-gray-200/60">
                        <div className="bg-white p-1 rounded border border-gray-100 flex flex-col items-center">
                          <span className="text-[10px] text-gray-500">膳食</span>
                          <span className="text-[11px] text-gray-800">
                            {formatShelterYesNo(selectedFacility.properties.meals || selectedFacility.properties.meal)}
                          </span>
                        </div>
                        <div className="bg-white p-1 rounded border border-gray-100 flex flex-col items-center">
                          <span className="text-[10px] text-gray-500">寵物</span>
                          <span className="text-[11px] text-gray-800">
                            {formatShelterYesNo(selectedFacility.properties.pets)}
                          </span>
                        </div>
                        <div className="bg-white p-1 rounded border border-gray-100 flex flex-col items-center">
                          <span className="text-[10px] text-gray-500">推車</span>
                          <span className="text-[11px] text-gray-800">
                            {formatShelterYesNo(selectedFacility.properties.carts)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 24.3 如有電話或官方網站，在下方新增一個獨立灰色區塊 */}
                    {(selectedFacility.properties.phone || selectedFacility.properties.website) && (
                      <div className="flex flex-col gap-1.5 bg-gray-50 p-2.5 rounded border border-gray-100 text-[11px]">
                        {selectedFacility.properties.phone && (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>聯絡專線</span>
                            <a href={`tel:${selectedFacility.properties.phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                              {selectedFacility.properties.phone}
                            </a>
                          </div>
                        )}
                        {selectedFacility.properties.website && (
                          <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.phone ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>官方網站</span>
                            <a 
                              href={selectedFacility.properties.website}
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="font-semibold text-rose-600 hover:underline"
                            >
                              前往官方網站 ↗
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Food Assistance (食物援助) Details */}
              {selectedFacility.facility_type === 'food_banks' && (() => {
                const props = selectedFacility.properties || {};
                const type = props.type;
                const target = props.target;
                const cost = props.cost;
                const isFreeMeal = type && /free\s*meal/i.test(type);
                const showCost = !isFreeMeal && cost && !/^(free|免費)$/i.test(String(cost).trim());
                const dayAndTime = props.day_and_time;
                const keyInfo = props.key_information;
                const phone = props.phone;
                const email = props.email;
                const website = props.website;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 22.2 綠色區塊 */}
                    <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/25 flex items-center gap-1.5 text-[11px] font-medium text-emerald-950 leading-relaxed">
                      <span className="text-base text-emerald-600 font-bold shrink-0">🥫</span>
                      <span>歡迎捐贈未開封常溫食品與善款，攜手守護鄰里溫飽與社區互助網。</span>
                    </div>

                    {/* 22.3.2 灰色區塊 (圖5) */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {type && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>援助類別</span>
                          <span className="text-gray-900 font-medium text-right">{type}</span>
                        </div>
                      )}
                      {target && (
                        <div className={`flex justify-between items-start text-gray-600 ${type ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">目標對象</span>
                          <span className="text-gray-800 text-right font-medium leading-snug break-words">{target}</span>
                        </div>
                      )}
                      {showCost && (
                        <div className={`flex justify-between items-center text-gray-600 ${(type || target) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>費用</span>
                          <span className="text-gray-900 font-medium text-right">{cost}</span>
                        </div>
                      )}
                      {dayAndTime && (
                        <div className={`flex justify-between items-start text-gray-600 ${(type || target || showCost) ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">開放時間</span>
                          <span className="text-gray-800 text-right font-medium leading-snug break-words">{dayAndTime}</span>
                        </div>
                      )}

                      {keyInfo && (
                        <>
                          <div className="border-t border-gray-200/80 my-0.5" />
                          <div className="flex flex-col gap-1">
                            <span className="text-gray-600 font-medium">詳細資料</span>
                            <span className="text-gray-800 text-[10.5px] leading-relaxed break-words">{keyInfo}</span>
                          </div>
                        </>
                      )}

                      {(phone || email) && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 hover:text-emerald-600 font-medium break-all text-right text-[10.5px] leading-tight"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-emerald-50 text-emerald-600 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`發送郵件至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>

                    {website && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 食物援助機構 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Recycling (環保回收站) Details (34.2 & 圖4) */}
              {selectedFacility.facility_type === 'recycling' && (() => {
                const props = selectedFacility.properties || {};
                const hours = props.hours || props.opening_hours;
                const phone = props.phone;
                const email = props.email;
                const notes = props.notes;
                const urllink = props.urllink || props.website;

                let recTypes: string[] = [];
                if (Array.isArray(props.recycling_types_accepted)) {
                  recTypes = props.recycling_types_accepted;
                } else if (props.recycling_types_accepted && typeof props.recycling_types_accepted === 'object') {
                  if (Array.isArray(props.recycling_types_accepted['Return-It'])) {
                    recTypes = props.recycling_types_accepted['Return-It'];
                  }
                }

                let otherMat: string[] = [];
                if (Array.isArray(props.other_materials_accepted)) {
                  otherMat = props.other_materials_accepted;
                } else if (props.recycling_types_accepted?.other_materials_accepted) {
                  otherMat = props.recycling_types_accepted.other_materials_accepted;
                }

                const bevContainers: string[] = Array.isArray(props.beverage_containers_accepted) ? props.beverage_containers_accepted : [];

                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const dayNamesZh: Record<string, string> = {
                  Sunday: '週日',
                  Monday: '週一',
                  Tuesday: '週二',
                  Wednesday: '週三',
                  Thursday: '週四',
                  Friday: '週五',
                  Saturday: '週六',
                  Holidays: '節假日'
                };
                const todayKey = daysOfWeek[new Date().getDay()];
                const todayVal = hours && typeof hours === 'object' ? hours[todayKey] : (typeof hours === 'string' ? hours : null);
                const todayHoursStr = todayVal ? formatTimePreference(todayVal, timeFormat) : '';

                const isZeroWaste = (props.name || selectedFacility.name || '').toLowerCase().includes('zero waste') || (urllink || '').toLowerCase().includes('zero-waste');

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 34.1 綠色區塊標語 */}
                    <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/25 flex items-center gap-1.5 text-[11px] font-medium leading-relaxed text-emerald-950">
                      <span className="text-base text-emerald-600 font-bold shrink-0">♻️</span>
                      <span>分類與減廢是城市守護綠色永續的具體實踐，落實資源循環，讓日常廢棄物轉化為新生資源。</span>
                    </div>

                    {/* 34.2.2 灰色區塊 (圖4) */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {hours && (
                        typeof hours === 'object' ? (
                          <details className="group">
                            <summary className="flex justify-between items-center text-gray-600 cursor-pointer list-none hover:text-emerald-700">
                              <span>開放時間</span>
                              <span className="text-gray-800 text-right font-medium flex items-center gap-1">
                                <span>{dayNamesZh[todayKey] || todayKey}: {todayHoursStr || '未公佈'}</span>
                                <span className="text-[9px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                              </span>
                            </summary>
                            <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1 text-[10.5px]">
                              {Object.entries(hours).map(([day, val]) => (
                                <div key={day} className={`flex justify-between gap-2 ${day === todayKey ? 'font-semibold text-emerald-800' : 'text-gray-600'}`}>
                                  <span className="shrink-0">{dayNamesZh[day] || day}</span>
                                  <span className="text-right leading-tight">{formatTimePreference(String(val), timeFormat)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>開放時間</span>
                            <span className="text-gray-900 font-medium text-right">{todayHoursStr}</span>
                          </div>
                        )
                      )}

                      {(recTypes.length > 0 || otherMat.length > 0 || bevContainers.length > 0 || notes) && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {recTypes.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-600 font-medium">接受回收種類</span>
                          <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto pr-1">
                            {recTypes.map((item: string, i: number) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-white text-emerald-800 rounded border border-emerald-200 font-medium shadow-2xs">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {(otherMat.length > 0 || bevContainers.length > 0) && (
                        <div className={`grid grid-cols-2 gap-2 ${recTypes.length > 0 ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-gray-600 font-medium">其他物料</span>
                            {otherMat.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-h-[75px] overflow-y-auto pr-0.5">
                                {otherMat.map((m: string, i: number) => (
                                  <span key={i} className="text-[9.5px] px-1 py-0.5 bg-white text-teal-800 rounded border border-teal-200 truncate max-w-full font-medium" title={m}>
                                    {m}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400">無</span>
                            )}
                          </div>

                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-gray-600 font-medium">飲料器皿</span>
                            {bevContainers.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-h-[75px] overflow-y-auto pr-0.5">
                                {bevContainers.map((b: string, i: number) => (
                                  <span key={i} className="text-[9.5px] px-1 py-0.5 bg-white text-sky-800 rounded border border-sky-200 truncate max-w-full font-medium" title={b}>
                                    {b}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400">無</span>
                            )}
                          </div>
                        </div>
                      )}

                      {notes && (
                        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-gray-100">
                          <span className="text-gray-600 font-medium">備註</span>
                          <span className="text-gray-700 text-[10.5px] leading-relaxed break-words bg-amber-50/60 p-1.5 rounded border border-amber-200/60">
                            {notes}
                          </span>
                        </div>
                      )}

                      {(phone || email) && <div className="border-t border-gray-200/80 my-0.5" />}

                      {phone && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>聯絡電話</span>
                          <a href={`tel:${phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                            {phone}
                          </a>
                        </div>
                      )}

                      {email && (
                        <div className={`flex justify-between items-center text-gray-600 ${phone ? 'pt-1.5 border-t border-gray-100' : ''} gap-2`}>
                          <span className="shrink-0">聯絡電郵</span>
                          <div className="flex items-center gap-1.5 min-w-0 justify-end">
                            <a
                              href={`mailto:${email}`}
                              className="text-gray-800 hover:text-emerald-600 font-medium break-all text-right text-[10.5px] leading-tight"
                            >
                              {email}
                            </a>
                            <a
                              href={`mailto:${email}`}
                              className="p-1 rounded bg-white hover:bg-emerald-50 text-emerald-600 border border-gray-200 transition-colors shadow-2xs shrink-0"
                              title={`發送郵件至 ${email}`}
                            >
                              <Mail className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 34.2.3 底部連結按鈕 */}
                    {urllink && (
                      <div className="pt-1 border-t border-gray-100">
                        <a
                          href={urllink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition-colors shadow-sm"
                        >
                          前往 {isZeroWaste ? 'Vancouver Zero Waste Centre' : 'Return-It'} 官方網頁 ↗
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* AED (自動體外心臟電擊去顫器) Details */}
              {selectedFacility.facility_type === 'aed' && (() => {
                const locDesc = selectedFacility.properties?.LOCATION_DESCRIPTION || selectedFacility.properties?.location_description;
                const objId = selectedFacility.properties?.OBJECTID ?? selectedFacility.properties?.object_id;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 紅色區塊：急救重要提示 */}
                    <div className="bg-red-50/90 p-2.5 rounded-lg border border-red-200 text-[11px] text-red-800 leading-relaxed font-medium">
                      ⚠️ 若發現疑似心臟驟停患者，請<strong>立即撥打 911</strong>，依照語音指引施救。
                    </div>

                    {/* 紅區塊下方顯示設備編號 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between items-center text-gray-600">
                        <span>設備編號</span>
                        <span className="text-gray-900 font-medium text-right">
                          {objId != null ? `#${objId}` : 'BC PAD'}
                        </span>
                      </div>
                    </div>

                    {/* 詳細位置 (灰色區塊無 emoji) */}
                    {locDesc && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 text-[11px] flex flex-col gap-1">
                        <span className="font-semibold text-gray-700">詳細位置</span>
                        <span className="text-gray-800 leading-relaxed break-words">
                          {locDesc}
                        </span>
                      </div>
                    )}

                    {/* 最底部連結按鈕：紅底白字風格 */}
                    <div className="flex flex-col gap-1.5 pt-1 border-t border-gray-100">
                      <a
                        href="https://bcpadprogram.ca/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white rounded font-medium text-xs transition-colors shadow-xs"
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

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>資料來源</span>
                      <span className="text-gray-900 font-medium text-right">City of Vancouver Open Data</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>等高線間隔</span>
                      <span className="text-gray-900 font-medium text-right">10 公尺 (10-metre intervals)</span>
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

              {/* VanWiFi 公共無線網絡 Details */}
              {selectedFacility.facility_type === 'van_wifi' && (() => {
                const props = selectedFacility.properties || {};
                const siteName = props.name || props.site_name || selectedFacility.name;
                const address = props.address || props.Address || '';
                const ssid = props.ssid || props.SSID || '#VanWiFi';
                const serviceProvider = props.service_provider || props.SERVICEPROVIDER || 'City of Vancouver';
                const apCount = props.ap_count || props.AP_COUNT;
                const siteType = props.site_type || props.SITE_TYPE;
                const infoUrl = props.info_url || props.URL || 'https://vancouver.ca/your-government/vanwifi.aspx';

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 32.2 刪除「政府設施」列，改為簡潔標語 */}
                    <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex items-center gap-1.5 text-[11px] font-medium leading-relaxed text-sky-950">
                      <span className="text-base text-sky-600 font-bold shrink-0">📶</span>
                      <span>市政公共免費無線網絡（免註冊登入）</span>
                    </div>

                    {/* 3.2 刪除Site Name, Address */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {/* 3.3 SSID 改成 服務集識別碼 (SSID) */}
                      <div className="flex justify-between items-center text-gray-600">
                        <span>服務集識別碼 (SSID)</span>
                        <span className="text-gray-900 font-medium text-right">
                          {ssid}
                        </span>
                      </div>

                      {/* 3.3 SERVICE PROVIDER 改成服務供應商 */}
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>服務供應商</span>
                        <span className="text-gray-900 font-medium text-right">{serviceProvider}</span>
                      </div>

                      {/* 3.4 場地類型刪除英文"(Site Type)" */}
                      {siteType && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>場地類型</span>
                          <span className="text-gray-900 font-medium text-right">{siteType}</span>
                        </div>
                      )}

                      {/* 3.5 發射器數量改成 整數 及刪去"個"字 */}
                      {apCount != null && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>發射器數量</span>
                          <span className="text-gray-900 font-medium text-right">
                            {isNaN(Number(apCount)) ? apCount : Math.round(Number(apCount))}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-1 border-t border-gray-100">
                      <a
                        href={infoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full py-1.5 px-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded font-medium text-xs transition-colors shadow-sm gap-1"
                      >
                        <span>前往 VanWiFi 官方網頁</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Coastal Tide Stations (大溫海岸潮汐與即時水位站) Details */}
              {selectedFacility.facility_type === 'tide_stations' && (() => {
                const props = selectedFacility.properties || {};
                const currentLevel = props.current_water_level_m ?? selectedFacility.name;
                const state = props.state || '潮位觀測中';
                const stateTrend = props.state_trend;
                const isRising = stateTrend === 'rising';
                const isFalling = stateTrend === 'falling';
                const nextHighTime = props.next_high_time;
                const nextHighVal = props.next_high_val;
                const nextLowTime = props.next_low_time;
                const nextLowVal = props.next_low_val;

                const formatTideTime = (isoString?: string) => {
                  if (!isoString) return '--';
                  try {
                    const d = new Date(isoString);
                    if (isNaN(d.getTime())) return isoString;
                    const effectiveTz = timeZone === 'auto' ? undefined : (timeZone === 'America/Vancouver' ? 'America/Vancouver' : timeZone);
                    return d.toLocaleTimeString('zh-TW', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      ...(effectiveTz ? { timeZone: effectiveTz } : {})
                    });
                  } catch {
                    return isoString.slice(11, 16);
                  }
                };

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 1.2 藍區塊:左上方為“地理資料”, 右方是淺藍底白字"潮汐水位", 下半部保留說明文字 */}
                    <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex items-center gap-1.5 text-[11px] text-sky-950 font-medium leading-snug">
                      <span className="text-base text-sky-600 font-bold shrink-0">🌊</span>
                      <span>海岸潮汐水位</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">即時海面潮位</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xl font-black text-blue-600 font-mono">
                            {currentLevel} <span className="text-xs font-normal text-gray-500">m</span>
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                            isRising ? 'bg-emerald-100 text-emerald-800' : isFalling ? 'bg-rose-100 text-rose-800' : 'bg-gray-200 text-gray-700'
                          }`}>
                            {state} {isRising ? '↗' : isFalling ? '↘' : '→'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-gray-200/60">
                        <div className="bg-white p-2 rounded border border-gray-200 flex flex-col">
                          <span className="text-[10px] text-gray-500">下次滿潮</span>
                          <span className="text-sm font-bold text-emerald-700 font-mono mt-0.5">
                            {nextHighVal ? `${nextHighVal}m` : '--'}
                          </span>
                          {nextHighTime && (
                            <span className="text-[9.5px] text-gray-500 font-mono mt-0.5">{formatTideTime(nextHighTime)}</span>
                          )}
                        </div>
                        <div className="bg-white p-2 rounded border border-gray-200 flex flex-col">
                          <span className="text-[10px] text-gray-500">下次乾潮</span>
                          <span className="text-sm font-bold text-sky-700 font-mono mt-0.5">
                            {nextLowVal ? `${nextLowVal}m` : '--'}
                          </span>
                          {nextLowTime && (
                            <span className="text-[9.5px] text-gray-500 font-mono mt-0.5">{formatTideTime(nextLowTime)}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-[10px] text-gray-500 leading-relaxed pt-1 border-t border-gray-200/60">
                        數據來源：加拿大漁業及海洋部水文觀測網 (Fisheries and Oceans Canada)
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Gas Station (Fuel) Details */}
              {selectedFacility.facility_type === 'fuel' && (() => {
                const openingHoursText = (() => {
                  const rawHours = selectedFacility.properties.opening_hours;
                  if (!rawHours || rawHours === '24/7' || rawHours.toLowerCase() === '24 hours') {
                    return '營業中 (24/7)';
                  }
                  const formatted = formatTimePreference(rawHours, timeFormat);
                  let isOpen = true;
                  try {
                    const vHours = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Vancouver" })).getHours();
                    const timeMatch = rawHours.match(/(\d{1,2})(?::(\d{2}))?\s*[-–至]\s*(\d{1,2})(?::(\d{2}))?/);
                    if (timeMatch) {
                      const openH = parseInt(timeMatch[1], 10);
                      const closeH = parseInt(timeMatch[3], 10);
                      if (closeH > openH) {
                        isOpen = vHours >= openH && vHours < closeH;
                      }
                    }
                  } catch {
                    isOpen = true;
                  }
                  return isOpen ? `營業中 (${formatted})` : `休息中 (${formatted})`;
                })();

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 2.1 刪除「道路設施」列；2.2 改為「設定個人位置」，右方貼邊顯示營業狀態 */}
                    <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 text-gray-700 min-w-0">
                        <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span className="text-gray-600 shrink-0">離個人位置:</span>
                        {userDistanceToFuel ? (
                          <span className="text-gray-800 font-medium shrink-0">約 {userDistanceToFuel}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSettingsModalOpen(true)}
                            className="text-amber-800 hover:text-amber-950 underline font-normal truncate cursor-pointer transition-colors"
                            title="點擊打開設定個人位置"
                          >
                            設定個人位置
                          </button>
                        )}
                      </div>
                      <span className="text-[10px] font-medium text-amber-950 shrink-0 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30">
                        {openingHoursText}
                      </span>
                    </div>

                    {/* Gas Prices Grid */}
                    <div className="flex flex-col gap-1.5">
                      {/* 2.3 即時參考油價右方貼邊加入 (每 5 分鐘更新) */}
                      <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                        <span>即時參考油價 (¢/L)</span>
                        <span className="text-[10px] text-gray-400 font-mono">(每 5 分鐘更新)</span>
                      </div>

                      {loadingFuelPrices ? (
                        <div className="py-4 text-center text-gray-400 text-xs flex items-center justify-center gap-1.5 bg-gray-50 rounded border border-gray-100">
                          <span className="animate-spin text-sm">⏳</span>
                          <span>正在載入最新油價...</span>
                        </div>
                      ) : fuelStationPrices ? (
                        <div className="grid grid-cols-2 gap-1.5">
                          {/* 2.3 刪除價錢後方仙/¢符號 */}
                          <div className="bg-gradient-to-br from-amber-50 to-orange-50/40 p-2 rounded border border-amber-200/80 flex flex-col">
                            <span className="text-[10px] text-gray-500 font-medium">Regular 87 (無鉛)</span>
                            <span className="text-base font-bold text-amber-900 mt-0.5">
                              {fuelStationPrices.regular.toFixed(1)}
                            </span>
                          </div>
                          <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                            <span className="text-[10px] text-gray-500 font-medium">Midgrade 89 (中級)</span>
                            <span className="text-base font-bold text-gray-800 mt-0.5">
                              {fuelStationPrices.midgrade.toFixed(1)}
                            </span>
                          </div>
                          <div className="bg-gray-50 p-2 rounded border border-gray-100 flex flex-col">
                            <span className="text-[10px] text-gray-500 font-medium">Premium 91 (高級)</span>
                            <span className="text-base font-bold text-gray-800 mt-0.5">
                              {fuelStationPrices.premium.toFixed(1)}
                            </span>
                          </div>
                          <div className="bg-slate-50 p-2 rounded border border-slate-200/80 flex flex-col">
                            <span className="text-[10px] text-slate-500 font-medium">Diesel (柴油)</span>
                            <span className="text-base font-bold text-slate-800 mt-0.5">
                              {fuelStationPrices.diesel.toFixed(1)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 text-center text-gray-400 text-xs bg-gray-50 rounded border border-gray-100">
                          暫無油價資料
                        </div>
                      )}
                    </div>

                    {/* 2.4 Actions：「探索比價」作為主要實心按鈕，與「GasBuddy」交換顏色和左右順序 */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => {
                          setExploreTab('fuel');
                          setExploreOpen(true);
                        }}
                        className="inline-flex items-center justify-center py-1.5 px-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors shadow-sm gap-1"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>探索比價</span>
                      </button>
                      <a
                        href="https://www.gasbuddy.com/gasprices/british-columbia/vancouver"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center py-1.5 px-2.5 bg-white hover:bg-gray-50 text-gray-800 rounded font-medium text-xs transition-colors border border-gray-300 gap-1 shadow-2xs"
                        title="前往 GasBuddy 溫哥華即時油價網頁"
                      >
                        <Fuel className="w-3.5 h-3.5 text-amber-700" />
                        <span>GasBuddy</span>
                        <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Tesla Supercharger & Service Center Details */}
              {selectedFacility.facility_type === 'tesla' && (() => {
                const props = selectedFacility.properties || {};
                const isSupercharger = props.sub_type === 'supercharger';
                const isCenter = props.sub_type === 'center';
                const isMobile = props.sub_type === 'mobile_service';
                const subTypeTitle = isSupercharger ? 'Tesla 超級充電站' :
                  isCenter ? 'Tesla 服務與體驗中心' :
                  isMobile ? 'Tesla 移動服務站' :
                  'Tesla 目的地充電站';

                const stationServices = (() => {
                  if (!props.services || !Array.isArray(props.services) || props.services.length === 0) return [];
                  return props.services.map((svc: string) => {
                    const s = String(svc);
                    if (s.includes('售後') || s.includes('Service') || s.includes('維修')) return '原廠售後維修';
                    if (s.includes('展示') || s.includes('銷售') || s.includes('Sales') || s.includes('Gallery')) return '展銷試駕';
                    if (s.includes('交付') || s.includes('Delivery')) return '新車交付';
                    if (s.includes('超級充電') || s.includes('Supercharger')) return props.power_kw >= 250 ? 'V3 超充' : '超級充電';
                    if (s.includes('目的地') || s.includes('Destination')) return '目的地充電';
                    if (s.includes('移動') || s.includes('Mobile')) return '移動維修';
                    return s.replace(/\s*\([^)]*\)/g, '').trim();
                  });
                })();

                const hasChargingModule = props.power_kw > 0 || props.stalls > 0 || isSupercharger || props.sub_type === 'destination_charger';
                const chargingTitle = props.power_kw >= 250 
                  ? 'V3 超級充電站' 
                  : (props.charging_speed || (isSupercharger ? '超級充電站' : '目的地充電站'));

                const chargingAccessDisplay = (() => {
                  const access = props.charging_access;
                  if (!access) return 'NACS 專用';
                  if (access.includes('NACS') && access.includes('Tesla')) return '支援 NACS / Tesla';
                  if (access.includes('Tesla 專用') || access.includes('Tesla Only')) return 'Tesla 專用';
                  return access;
                })();

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 18.1 & 18.2 主題 #E82127，右側顯示 Tesla 圖示 */}
                    <div className="bg-[#E82127]/10 p-2.5 rounded-lg border border-[#E82127]/25 flex items-center justify-between">
                      <span className="font-bold text-[#E82127] text-xs flex items-center gap-1.5">
                        <span className="text-base font-bold">⚡</span>
                        <span>{subTypeTitle}</span>
                      </span>
                      {/* Tesla Logo SVG */}
                      <svg className="w-4 h-4 text-[#E82127] shrink-0" viewBox="0 0 342.4 342.4" fill="currentColor">
                        <path d="M0 32.5c46.7 0 117.8 8.8 171.2 34.6C224.6 41.3 295.7 32.5 342.4 32.5v19.1c-40.4 0-101.4 7.6-148.6 30.2l-.7 230.1h-43.4l-.7-230.1C101.8 59.2 40.8 51.6.4 51.6V32.5H0zm171.2-32.5C124.6 0 54.4 7.5 0 22.8l7.6 19.1c47.9-12.8 110.2-19.1 163.6-19.1 53.4 0 115.7 6.3 163.6 19.1l7.6-19.1C288 7.5 217.8 0 171.2 0z"/>
                      </svg>
                    </div>

                    {/* 18.5 紅色區塊下所有資料收納於單一灰底區塊 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-2 text-[11px]">
                      {/* 18.4 充電資訊模組 (圖3) */}
                      {hasChargingModule && (
                        <div className="bg-white rounded border border-gray-200/80 overflow-hidden text-center shadow-2xs">
                          <div className="py-1 px-2 bg-gray-50/80 border-b border-gray-200/80 font-bold text-gray-800 text-xs">
                            {chargingTitle}
                          </div>
                          <div className="grid grid-cols-3 divide-x divide-gray-200/80 py-1.5 px-1 items-center">
                            <div className="font-bold text-gray-800">
                              {props.power_kw ? `${props.power_kw} kW` : '原廠技術'}
                            </div>
                            <div className="font-bold text-gray-800">
                              {props.stalls != null && props.stalls > 0 ? `${props.stalls} 樁位` : '原廠工位'}
                            </div>
                            <div className="font-bold text-gray-800 truncate px-1 text-[10.5px]">
                              {chargingAccessDisplay}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 18.3 站點服務 膠囊標籤群 */}
                      {stationServices.length > 0 && (
                        <>
                          {hasChargingModule && <div className="border-t border-gray-200/80 my-0.5" />}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-gray-500 font-medium">站點服務</span>
                            <div className="flex flex-wrap gap-1.5">
                              {stationServices.map((svc: string, idx: number) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded-full bg-white text-gray-700 font-medium text-[10.5px] border border-gray-200 shadow-2xs"
                                >
                                  {svc}
                                </span>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      {/* 開放時間 */}
                      {props.hours && (
                        <>
                          {(hasChargingModule || stationServices.length > 0) && (
                            <div className="border-t border-gray-200/80 my-0.5" />
                          )}
                          <div className="flex justify-between items-center text-gray-600">
                            <span className="shrink-0 text-gray-500">開放時間</span>
                            <span className="font-medium text-gray-800 text-right">
                              {formatTimePreference(props.hours, timeFormat)}
                            </span>
                          </div>
                        </>
                      )}

                      {/* 聯絡電話 */}
                      {props.phone && (
                        <>
                          {(hasChargingModule || stationServices.length > 0 || props.hours) && (
                            <div className="border-t border-gray-200/80 my-0.5" />
                          )}
                          <div className="flex justify-between items-center text-gray-600">
                            <span className="shrink-0 text-gray-500">聯絡電話</span>
                            <a href={`tel:${props.phone}`} className="font-bold text-rose-600 font-mono hover:underline">
                              {props.phone}
                            </a>
                          </div>
                        </>
                      )}

                      {/* Notes 備註 */}
                      {props.notes && (
                        <>
                          <div className="border-t border-gray-200/80 my-0.5" />
                          <div className="text-[10.5px] text-gray-500 leading-snug">
                            💡 {props.notes}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

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
                        <span className="text-gray-800 text-right truncate max-w-[140px] sm:max-w-[165px]">
                          {selectedFacility.properties.operator}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.cargo && (
                      <div className={`flex justify-between items-start text-gray-600 ${selectedFacility.properties.operator ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span className="shrink-0">主要貨類</span>
                        <span className="text-gray-800 text-right max-w-[190px]">
                          {selectedFacility.properties.cargo}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.berths || selectedFacility.properties.draught) && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.operator || selectedFacility.properties.cargo) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>泊位與水深</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.berths || ''} {selectedFacility.properties.draught ? `(吃水 ${selectedFacility.properties.draught})` : ''}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.capacity && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.operator || selectedFacility.properties.cargo || selectedFacility.properties.berths || selectedFacility.properties.draught) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>年處理能力</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.capacity}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.address && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.operator || selectedFacility.properties.cargo || selectedFacility.properties.berths || selectedFacility.properties.draught || selectedFacility.properties.capacity) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>碼頭地址</span>
                        <span className="text-gray-800 text-right truncate max-w-[140px] sm:max-w-[165px]">
                          {selectedFacility.properties.address}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* One-Way Streets (單程路段) Details */}
              {selectedFacility.facility_type === 'one_way_streets' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 4.1 主題 #0F172A；4.3 刪除「道路設施」列；4.4 標語 */}
                  <div className="bg-[#0F172A]/10 p-2.5 rounded-lg border border-[#0F172A]/25 flex items-center gap-2 text-[11px] text-[#0F172A] font-medium leading-snug">
                    <ArrowRight className="w-3.5 h-3.5 text-[#0F172A] shrink-0" />
                    <span>請依地面標線與箭頭方向行駛，嚴禁逆向進入。</span>
                  </div>
                </div>
              )}

              {/* Snow Removal Routes (鏟雪路線) Details */}
              {selectedFacility.facility_type === 'snow_removal_routes' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 17.1 主題 #F0F9FF；17.2 刪除「道路設施」列 */}
                  <div className="bg-[#F0F9FF] p-2.5 rounded-lg border border-sky-200/80 text-[11px] text-sky-950 font-medium flex items-center gap-2 leading-snug">
                    <span className="text-base text-sky-600 font-bold shrink-0">❄️</span>
                    <span>
                      {selectedFacility.properties.priority === 1 
                        ? '第 1 優先 · 清掃主要幹道與急救動線' 
                        : '第 2 優先 · 清掃重要陡坡、學校及主要單車道'}
                    </span>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.route_type_zh && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>路線屬性</span>
                        <span className="text-gray-800 text-right truncate max-w-[140px] sm:max-w-[165px]">
                          {(selectedFacility.properties.route_type_zh || '').replace(/\s*\([^)]*\)/g, '').trim()}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.length_display || selectedFacility.properties.shape_length) && (
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.route_type_zh ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>路段長度</span>
                        <span className="text-gray-900 font-medium text-right">
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
                  {/* 4.1 淺藍區塊:左方是公共事業 */}
                  <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/25 flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-sky-950 flex items-center gap-1.5">
                      <span className="text-base text-sky-600 font-bold">💧</span>
                      <span>公共事業</span>
                    </span>
                  </div>

                  {/* 4.3 淺藍區塊下的資料, 刪除英文 (Diameter, Material) */}
                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.diameter_mm && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>管道管徑</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.diameter_mm} mm
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.material && (
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.diameter_mm ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>管材材質</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.material}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.lining_material && selectedFacility.properties.lining_material !== 'blank' && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.diameter_mm || selectedFacility.properties.material) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>內襯材料</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.lining_material}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.installation_date && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.diameter_mm || selectedFacility.properties.material || selectedFacility.properties.lining_material) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>鋪設安裝年份</span>
                        <span className="text-gray-900 font-medium text-right">
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
                    {/* 5.1 青綠區塊 (與膠囊標籤相同): 左方是公共事業 */}
                    <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/25 flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-teal-950 flex items-center gap-1.5">
                        <span className="text-base text-teal-600 font-bold">🌊</span>
                        <span>公共事業</span>
                      </span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties.street_name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>所在街道</span>
                          <span className="text-gray-800 text-right truncate max-w-[140px] sm:max-w-[165px]">
                            {selectedFacility.properties.street_name}
                          </span>
                        </div>
                      )}
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.street_name ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>下水道排水類型</span>
                        <span className="text-gray-900 font-medium text-right">
                          {effluentZh}
                        </span>
                      </div>
                      {selectedFacility.properties.diameter_mm && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>管徑規格</span>
                          <span className="text-gray-900 font-medium text-right">
                            {selectedFacility.properties.diameter_mm} mm
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.material && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>管道結構材質</span>
                          <span className="text-gray-900 font-medium text-right">
                            {selectedFacility.properties.material}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.pipe_use && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>管線功能用途</span>
                          <span className="text-gray-900 font-medium text-right">
                            {selectedFacility.properties.pipe_use}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.service_status && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>管線營運狀態</span>
                          <span className="text-gray-900 font-medium text-right">
                            {selectedFacility.properties.service_status}
                          </span>
                        </div>
                      )}
                      {selectedFacility.properties.install_date && (
                        <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                          <span>建造鋪設年份</span>
                          <span className="text-gray-900 font-medium text-right">
                            {selectedFacility.properties.install_date}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Traffic Speed Limits (限速路段) Details */}
              {selectedFacility.facility_type === 'traffic_speed_limits' && (() => {
                const formatStreetAttribute = (val?: any) => {
                  if (!val) return '';
                  const s = String(val).trim();
                  if (/^arterial$/i.test(s)) return '主幹道';
                  if (/^residential$/i.test(s)) return '住宅區';
                  if (/^secondary\s*arterial$/i.test(s)) return '次幹道';
                  if (/^collector$/i.test(s)) return '集散道';
                  if (/^secondary\s*arterial\s*\/\s*collector$/i.test(s)) return '次幹道 / 集散道';
                  if (/^(?:lane|alley|lane\s*\/\s*alley)$/i.test(s)) return '後巷';
                  if (/^leased$/i.test(s)) return '專用路段';
                  return s.replace(/\s*\([^)]*\)/g, '').trim();
                };

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 5.1 主題 #F59E0B；5.2 刪除「道路設施」那行；5.3 警示標語 */}
                    <div className="bg-[#F59E0B]/10 p-2.5 rounded-lg border border-[#F59E0B]/25 flex items-center gap-2 text-[11px] text-[#B45309] font-medium leading-snug">
                      <Gauge className="w-4 h-4 text-[#B45309] shrink-0" />
                      <span>本路段為速限管制 · 請依限速行駛並禮讓行人。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {selectedFacility.properties.segment_type && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>路段屬性</span>
                          <span className="text-gray-900 font-medium text-right">
                            {formatStreetAttribute(selectedFacility.properties.segment_type)}
                          </span>
                        </div>
                      )}
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.segment_type ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>道路限速</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.speed_limit || '30'} km/h
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Bike Racks (單車架) Details */}
              {selectedFacility.facility_type === 'bike_racks' && (() => {
                const props = selectedFacility.properties || {};
                const formatBikeRackOwner = (owner?: any) => {
                  if (!owner || !String(owner).trim()) return null;
                  const s = String(owner).trim();
                  if (/^cov$/i.test(s) || /city of vancouver/i.test(s)) return '溫哥華市政府 (COV)';
                  if (/^bia$/i.test(s)) return '商業促進會 (BIA)';
                  if (/contractor/i.test(s)) return '承包商 (Contractor)';
                  if (/engineering/i.test(s)) return '工務工程部 (Engineering)';
                  if (/private/i.test(s)) return '私人設施 (Private)';
                  return s;
                };

                const formatRackType = (raw?: any) => {
                  if (!raw) return null;
                  const r = String(raw).trim().toLowerCase();
                  if (r === 'hanger') return '掛架';
                  if (r === 'u-rack' || r === 'urack') return '倒U型架';
                  if (r.includes('post') && r.includes('ring')) return '柱環型架';
                  if (r === 'heart') return '心形架';
                  if (r === 'mountains') return '群山造型架';
                  if (r === 'leaf') return '葉片造型架';
                  if (r === 'petal') return '花瓣造型架';
                  if (r === 'corral') return '單車專用圍欄';
                  if (r === 'other' || /guard\s*bird/i.test(r) || /guardbird/i.test(r)) return '其他';
                  return String(raw);
                };

                const ownerDisplay = formatBikeRackOwner(props.owner);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 9.1 刪除「道路設施」列；9.2 主題 #065F46；標語 */}
                    <div className="bg-[#065F46]/10 p-2.5 rounded-lg border border-[#065F46]/25 flex items-center gap-1.5 text-[11px] text-[#065F46] font-medium leading-snug">
                      <Bike className="w-3.5 h-3.5 text-[#065F46] shrink-0" />
                      <span>市政公共單車停放設施，請自備防盜車鎖。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {ownerDisplay && (
                        <>
                          <div className="flex justify-between items-center text-gray-600">
                            <span>營運單位</span>
                            <span className="text-gray-900 font-medium text-right">{ownerDisplay}</span>
                          </div>
                          <div className="border-t border-gray-200/80 my-0.5" />
                        </>
                      )}
                      {props.skytrain_station_name && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>天車車站</span>
                          <span className="text-gray-800 text-right flex items-center gap-1">
                            <span>🚇</span>
                            <span>{props.skytrain_station_name}</span>
                          </span>
                        </div>
                      )}
                      {props.num_racks && (
                        <div className={`flex justify-between items-center text-gray-600 ${props.skytrain_station_name ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          {/* 9.3 單車架數量改成車架數量，並刪除右方「組」字 */}
                          <span>車架數量</span>
                          <span className="text-gray-900 font-medium text-right">
                            {props.num_racks}
                          </span>
                        </div>
                      )}
                      {props.rack_type && (
                        <div className={`flex justify-between items-center text-gray-600 ${(props.skytrain_station_name || props.num_racks) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>車架款式</span>
                          <span className="text-gray-900 font-medium text-right">
                            {formatRackType(props.rack_type)}
                          </span>
                        </div>
                      )}
                      {props.year_installed && (
                        <div className={`flex justify-between items-center text-gray-600 ${(props.skytrain_station_name || props.num_racks || props.rack_type) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>安裝年份</span>
                          <span className="text-gray-900 font-medium text-right">
                            {props.year_installed} 年
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

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
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.fsa}
                      </span>
                    </div>
                    {selectedFacility.properties.province && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>所屬省份</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.province}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>資料更新頻率</span>
                      <span className="text-gray-900 font-medium text-right">年度更新</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Public Art (公共藝術) Details */}
              {selectedFacility.facility_type === 'public_art' && (() => {
                const props = selectedFacility.properties || {};
                const rawType = props.type ? String(props.type).trim() : '';
                const typeMap: Record<string, string> = {
                  'Figurative': '寫實',
                  'Sculpture': '雕塑',
                  'Fountain or water feature': '噴泉/水景',
                  'Memorial or monument': '紀念',
                  'Relief': '浮雕',
                  'Totem pole': '圖騰',
                  'Mosaic': '馬賽克',
                  'Site-integrated work': '場域整合',
                  'Mural': '壁畫',
                  'Two-dimensional artwork': '平面藝術',
                  'Media work': '新媒體藝術',
                  'Gateway': '入口景觀',
                  'Welcome figure': '迎賓雕像',
                  'Other': '其他',
                };
                const translatedType = rawType ? (typeMap[rawType] || Object.entries(typeMap).find(([k]) => k.toLowerCase() === rawType.toLowerCase())?.[1] || rawType || '其他') : null;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 26.1 紫色區塊使用藝術標題 */}
                    <div className="bg-fuchsia-500/10 p-2.5 rounded-lg border border-fuchsia-500/25 flex items-center gap-2">
                      <span className="text-base text-fuchsia-600 font-bold shrink-0">🎨</span>
                      <span className="font-bold text-fuchsia-950 text-xs leading-snug">
                        {props.title_of_work || '公共藝術品'}
                      </span>
                    </div>

                    {/* 26.2 灰底資料（已刪除藝術標題）: 中文藝術種類, 主要材料, 產權所屬, 設置位置 */}
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {translatedType && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span className="shrink-0">藝術種類</span>
                          <span className="text-gray-900 font-medium text-right">
                            {translatedType}
                          </span>
                        </div>
                      )}
                      {props.primarymaterial && (
                        <div className={`flex justify-between items-start text-gray-600 gap-2 ${translatedType ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span className="shrink-0">主要材料</span>
                          <span className="text-gray-800 text-right break-words leading-relaxed">
                            {props.primarymaterial}
                          </span>
                        </div>
                      )}
                      {props.ownership && (
                        <div className={`flex justify-between items-start text-gray-600 gap-2 ${(translatedType || props.primarymaterial) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span className="shrink-0">產權所屬</span>
                          <span className="text-gray-800 text-right break-words">
                            {props.ownership}
                          </span>
                        </div>
                      )}
                      {props.locationonsite && (
                        <div className={`flex justify-between items-start text-gray-600 gap-2 ${(translatedType || props.primarymaterial || props.ownership) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span className="shrink-0">設置位置</span>
                          <span className="text-gray-800 text-right break-words leading-relaxed">
                            {props.locationonsite}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* (新灰色區塊) 創作理念 (artistprojectstatement) */}
                    {props.artistprojectstatement && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1 text-[11px]">
                        <span className="text-gray-600">創作理念</span>
                        <p className="text-gray-800 text-[11px] leading-relaxed max-h-36 overflow-y-auto whitespace-pre-line pr-1 break-words">
                          {props.artistprojectstatement}
                        </p>
                      </div>
                    )}

                    {/* 45.3.4 加入連結按鈕 (url) */}
                    {props.url && (
                      <a
                        href={props.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 active:scale-[0.99] text-white font-medium text-xs shadow-xs transition-colors"
                      >
                        <span>前往溫哥華公共藝術官方檔案</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Traffic Crosswalks (斑馬線) Details */}
              {selectedFacility.facility_type === 'traffic_crosswalks' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 6.1 主題 #FEF3C7；6.3 刪除「道路設施」那行；6.4 禮讓警示標語 */}
                  <div className="bg-[#FEF3C7] p-2.5 rounded-lg border border-amber-300 flex items-center gap-2 text-[11px] text-amber-950 font-medium leading-snug">
                    <Footprints className="w-4 h-4 text-amber-800 shrink-0" />
                    <span>車輛遇行人合法進入穿越道時，必須完全停駛禮讓。</span>
                  </div>
                </div>
              )}

              {/* Litter Containers (垃圾箱) Details */}
              {selectedFacility.facility_type === 'litter_containers' && (() => {
                const props = selectedFacility.properties || {};
                const model = props.model_type;
                const cap = props.capacity;
                const status = props.service_status;

                const formatServiceStatus = (raw?: string) => {
                  if (!raw) return '';
                  if (raw === 'Active - Year round') return '運作中 (全年無休)';
                  if (raw === 'Active - Seasonal Only') return '運作中 (僅限季節性)';
                  if (raw === 'Asset is planned') return '規劃籌建中';
                  return raw;
                };

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/25 flex items-center gap-1.5 text-[11px] font-medium leading-relaxed text-amber-950">
                      <span className="text-base text-amber-600 font-bold shrink-0">🗑️</span>
                      <span>善用公共分類垃圾桶，攜手維護乾淨整潔的街道與市容。</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {model && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>垃圾箱型號</span>
                          <span className="text-gray-900 font-medium text-right">
                            {model}
                          </span>
                        </div>
                      )}
                      {cap && (
                        <div className={`flex justify-between items-center text-gray-600 ${model ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>容量規格</span>
                          <span className="text-gray-900 font-medium text-right">
                            {cap} 公升
                          </span>
                        </div>
                      )}
                      {status && (
                        <div className={`flex justify-between items-center text-gray-600 ${(model || cap) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>服務運作狀態</span>
                          <span className="text-gray-900 font-medium text-right">
                            {formatServiceStatus(status)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

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
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>中心座標</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.lat.toFixed(4)}, {selectedFacility.lon.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>資料更新頻率</span>
                      <span className="text-gray-900 font-medium text-right">年度更新</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Traffic Conditions (即時路況 - TomTom 主要公路與橋樑 / 獅門大橋 ATIS) */}
              {(selectedFacility.facility_type === 'traffic_conditions' || selectedFacility.facility_type === 'traffic_corridor') && (() => {
                const props = selectedFacility.properties || {};
                const isLionsGateATIS = selectedFacility.name?.includes('獅門大橋') && props.speed_kmh == null && props.delay_min == null;

                if (isLionsGateATIS) {
                  return (
                    <div className="flex flex-col gap-2 text-xs">
                      <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-emerald-900 font-medium">
                          DriveBC & ATIS 即時交通延誤、排隊車龍與南向現場監視
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
                          每 1 小時更新
                        </span>
                      </div>

                      {/* 2-Column Compact Grid */}
                      <div className="grid grid-cols-2 gap-2">
                        {/* Left Column (Row span 2): queue_map.gif 車流排隊圖 */}
                        <div className="row-span-2 bg-gray-900 rounded-lg p-1.5 border border-gray-700/60 flex flex-col gap-1 shadow-inner justify-between">
                          <div className="flex items-center justify-between text-[10.5px] font-semibold text-gray-200">
                            <span>🗺️ 車流排隊圖</span>
                            <span className="text-[9px] text-emerald-400 font-mono">Queue</span>
                          </div>
                          <div 
                            onClick={() => setEnlargedCameraImage({
                              src: "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/queue_map.gif",
                              directSrc: "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/queue_map.gif",
                              alt: "車流排隊圖 (Queue Map)",
                              title: "獅門大橋 (Lions Gate Bridge)",
                              direction: "即時車流排隊圖"
                            })}
                            className="w-full flex-1 overflow-hidden rounded bg-black flex items-center justify-center min-h-[170px] max-h-[210px] cursor-zoom-in group/img hover:opacity-95 transition-opacity relative"
                            title="點擊放大檢視"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                              src="https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/queue_map.gif" 
                              alt="Lions Gate Bridge Queue Map" 
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute top-1.5 right-1.5 bg-black/70 backdrop-blur-xs text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center gap-0.5 pointer-events-none">
                              <ZoomIn className="w-2.5 h-2.5 text-cyan-300" />
                              <span>放大</span>
                            </div>
                          </div>
                        </div>

                        {/* Right Column Row 1: atis_delay.gif 預計延誤 */}
                        <div className="bg-gray-900 rounded-lg p-1.5 border border-gray-700/60 flex flex-col gap-1 shadow-inner">
                          <div className="flex items-center justify-between text-[10.5px] font-semibold text-gray-200">
                            <span>⏱️ 預計延誤時間</span>
                            <span className="text-[9px] text-emerald-400 font-mono">LIVE</span>
                          </div>
                          <div 
                            onClick={() => setEnlargedCameraImage({
                              src: "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/atis_delay.gif",
                              directSrc: "https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/atis_delay.gif",
                              alt: "預計延誤時間 (Delay Estimates)",
                              title: "獅門大橋 (Lions Gate Bridge)",
                              direction: "即時預計延誤時間"
                            })}
                            className="w-full overflow-hidden rounded bg-black flex items-center justify-center min-h-[42px] max-h-[55px] cursor-zoom-in group/img hover:opacity-95 transition-opacity relative"
                            title="點擊放大檢視"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                              src="https://www.th.gov.bc.ca/atis/lgcws/images/lions_gate/atis_delay.gif" 
                              alt="Lions Gate Bridge ATIS 預計延誤" 
                              className="w-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <div className="absolute top-1 right-1 bg-black/70 backdrop-blur-xs text-white text-[8px] px-1 py-0.5 rounded opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                              <ZoomIn className="w-2 h-2 text-cyan-300 inline" />
                            </div>
                          </div>
                        </div>

                        {/* Right Column Row 2: Camera 18 南向即時監視 */}
                        <div className="bg-gray-900 rounded-lg p-1.5 border border-gray-700/60 flex flex-col gap-1 shadow-inner">
                          <div className="flex items-center justify-between text-[10.5px] font-semibold text-gray-200">
                            <span>📷 南向即時監視</span>
                            <span className="text-[9px] text-cyan-400">#18</span>
                          </div>
                          <div 
                            onClick={() => setEnlargedCameraImage({
                              src: "https://www.drivebc.ca/images/18.jpg",
                              directSrc: "https://www.drivebc.ca/images/18.jpg",
                              alt: "DriveBC 獅門大橋南向即時監視 (Camera 18)",
                              title: "獅門大橋 (Lions Gate Bridge)",
                              direction: "南向即時監視 (Camera 18)"
                            })}
                            className="w-full overflow-hidden rounded bg-black flex items-center justify-center h-[85px] cursor-zoom-in group/img hover:opacity-95 transition-opacity relative"
                            title="點擊放大檢視"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                              src="https://www.drivebc.ca/images/18.jpg" 
                              alt="DriveBC Lions Gate Bridge Camera 18" 
                              className="w-full h-full object-cover rounded"
                            />
                            <div className="absolute top-1 right-1 bg-black/70 backdrop-blur-xs text-white text-[8px] px-1 py-0.5 rounded opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                              <ZoomIn className="w-2 h-2 text-cyan-300 inline" />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-0.5">
                        <a 
                          href="https://www.th.gov.bc.ca/atis/lgcws/index.html" 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>前往 ATIS 獅門大橋路況官網</span>
                        </a>
                      </div>
                    </div>
                  );
                }

                // TomTom Live Traffic Corridor Card
                const speed = props.speed_kmh || 60;
                const freeflow = props.freeflow_speed_kmh || 80;
                const speedPct = Math.min(100, Math.max(10, Math.round((speed / freeflow) * 100)));
                const delayMin = props.delay_min ?? (props.delay_sec ? Math.round(props.delay_sec / 60) : 0);
                const levelColor = props.color || (props.level >= 3 ? '#dc2626' : props.level === 2 ? '#f97316' : props.level === 1 ? '#eab308' : '#10b981');
                const isFreeFlow = delayMin <= 1 || props.level === 0;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* Delay & Speed Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">⏱️ 通過延誤時間</span>
                        <span className={`font-bold text-sm mt-0.5 ${isFreeFlow ? 'text-emerald-600' : delayMin >= 8 ? 'text-rose-600' : 'text-amber-600'}`}>
                          {delayMin <= 0 ? '+0 分鐘 (順暢)' : `+${delayMin} 分鐘`}
                        </span>
                        <span className="text-[9.5px] text-gray-400 mt-0.5">
                          {props.trend === 'worsening' ? '↗️ 車流回堵加劇中' : props.trend === 'improving' ? '↘️ 車流改善中' : isFreeFlow ? '✅ 全線車流順暢' : '➡️ 車流穩定'}
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">⚡ 當前平均車速</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="font-bold text-sm text-gray-800">{speed}</span>
                          <span className="text-[10px] text-gray-500">km/h</span>
                          <span className="text-[9.5px] text-gray-400 font-normal">/ {freeflow}</span>
                        </div>
                        <div className="w-full bg-gray-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${speedPct}%`, backgroundColor: levelColor }} />
                        </div>
                      </div>
                    </div>

                    {/* 雙向分段車流細節 */}
                    {(() => {
                      const segs = Array.isArray(props.segments) 
                        ? props.segments 
                        : (typeof props.segments === 'string' ? (() => { try { return JSON.parse(props.segments); } catch { return null; } })() : null);
                      if (!segs || segs.length === 0) return null;
                      return (
                        <div className="flex flex-col gap-1.5 pt-1.5 border-t border-gray-100">
                          <span className="text-[10px] font-bold text-gray-500">雙向分段車流狀況</span>
                          <div className="grid grid-cols-2 gap-1.5">
                            {segs.map((seg: any, sIdx: number) => (
                              <div key={sIdx} className="p-1.5 rounded bg-gray-50 border border-gray-200 flex flex-col justify-between">
                                <div className="flex items-center justify-between text-[10px] font-bold text-gray-700">
                                  <span className="truncate">{seg.name}</span>
                                  <span className="text-[9px] px-1 py-0.2 rounded text-white shrink-0" style={{ backgroundColor: seg.color || '#10b981' }}>
                                    {seg.delay_min > 0 ? `+${seg.delay_min}m` : '順暢'}
                                  </span>
                                </div>
                                <div className="flex items-baseline justify-between mt-1 text-[10px] text-gray-600">
                                  <span className="font-mono font-semibold">{seg.speed_kmh} km/h</span>
                                  <span className="text-[9px] text-gray-400">{seg.level === 0 ? '無延誤' : seg.level === 1 ? '輕微' : '壅塞'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Detailed Description */}
                    {props.description && (
                      <div className={`p-2 rounded-lg border text-gray-700 text-[11px] leading-relaxed ${isFreeFlow ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                        <span className={`font-semibold mr-1 ${isFreeFlow ? 'text-emerald-700' : 'text-amber-700'}`}>📌 路況說明:</span>
                        {props.description}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="pt-0.5 flex gap-1.5">
                      <a 
                        href="https://plan.tomtom.com/en/?p=49.24943,-123.12845,11.71z" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="flex-1 py-1.5 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <span>前往 TomTom 即時路況</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Traffic Alerts (TomTom 突發事故與路況圖釘 — 已移除重複顯示之次級標題框) */}
              {(selectedFacility.facility_type === 'traffic_alerts' || selectedFacility.facility_type === 'traffic_incident') && (() => {
                const props = selectedFacility.properties || {};
                const delayMin = props.delay_min ?? props.delay_minutes ?? (props.delay_sec ? Math.round(props.delay_sec / 60) : 5);
                const reportTime = props.report_time_str || props.time_display || 'TomTom 即時偵測';
                const confidenceVal = props.confidence_pct ?? (props.confidence != null ? (props.confidence <= 5 ? props.confidence * 20 : props.confidence) : 96);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">⏱️ 預估車流延誤</span>
                        <span className="font-bold text-sm text-rose-600 mt-0.5">
                          +{delayMin} 分鐘
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">🕒 回報時間</span>
                        <span className="font-bold text-xs text-gray-800 mt-1">
                          {reportTime}
                        </span>
                        {confidenceVal != null && (
                          <span className="text-[9.5px] text-emerald-600 mt-0.5 font-medium">
                            ✓ 資料可信度 {confidenceVal}%
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-0.5">
                      <a 
                        href="https://plan.tomtom.com/en/?p=49.24943,-123.12845,11.71z" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="w-full py-1.5 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <span>前往 TomTom 即時路況</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Road Closures (交通封閉) Details */}
              {selectedFacility.facility_type === 'road_closures' && (() => {
                const getProjectProgress = (compDateStr?: string) => {
                  if (!compDateStr) return null;
                  const targetDate = new Date(compDateStr);
                  if (isNaN(targetDate.getTime())) return null;
                  const now = new Date();
                  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const comp = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
                  const diffTime = comp.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  if (diffDays < 0) {
                    return '已逾預期工期 (待市府更新)';
                  }
                  return `進行中 (剩餘 ${diffDays} 天)`;
                };
                const progressLabel = getProjectProgress(selectedFacility.properties.comp_date);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 13.1 主題 #DC2626；13.2 刪除「道路設施」那行；標語 */}
                    <div className="bg-[#DC2626]/10 p-2.5 rounded-lg border border-[#DC2626]/30 flex items-center gap-2 text-[11px] text-[#DC2626] font-medium leading-snug">
                      <Ban className="w-4 h-4 text-[#DC2626] shrink-0" />
                      <span>受市府工務影響道路封閉，建議改行周邊替代道路。</span>
                    </div>

                    {(progressLabel || selectedFacility.properties.schedule || selectedFacility.properties.comp_date) && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                        {selectedFacility.properties.schedule && (
                          <div className="flex justify-between items-start text-gray-600 gap-2">
                            <span className="shrink-0">預計封閉時程</span>
                            {(() => {
                              const rawSchedule = selectedFacility.properties.schedule;
                              const parts = String(rawSchedule).split(';').map(p => p.trim()).filter(Boolean);
                              if (parts.length > 1) {
                                return (
                                  <div className="flex flex-col text-right leading-tight gap-0.5">
                                    <span className="text-gray-800 font-medium">{parts[0]}</span>
                                    <span className="text-gray-600 text-[10.5px]">{parts.slice(1).join('; ')}</span>
                                  </div>
                                );
                              }
                              return (
                                <span className="text-gray-800 text-right leading-relaxed">
                                  {rawSchedule}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                        {/* 13.4 預計完工日期上方加入工程進度 */}
                        {progressLabel && (
                          <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.schedule ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>工程進度</span>
                            <span className="text-gray-900 font-medium text-right">{progressLabel}</span>
                          </div>
                        )}
                        {selectedFacility.properties.comp_date && (
                          <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.schedule || progressLabel) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>預計完工日期</span>
                            <span className="text-gray-900 font-medium text-right">
                              {selectedFacility.properties.comp_date}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedFacility.properties.url_link && (
                      <a
                        href={selectedFacility.properties.url_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-1.5 px-3 rounded-lg bg-[#DC2626] hover:bg-red-700 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>查看 Road Ahead 封閉詳情</span>
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Road Construction (道路施工) Details */}
              {selectedFacility.facility_type === 'road_construction' && (() => {
                const getProjectProgress = (compDateStr?: string) => {
                  if (!compDateStr) return null;
                  const targetDate = new Date(compDateStr);
                  if (isNaN(targetDate.getTime())) return null;
                  const now = new Date();
                  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const comp = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
                  const diffTime = comp.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  if (diffDays < 0) {
                    return '已逾預期工期 (待市府更新)';
                  }
                  return `進行中 (剩餘 ${diffDays} 天)`;
                };
                const progressLabel = getProjectProgress(selectedFacility.properties.comp_date);

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 14.1 主題 #EA580C；14.2 刪除「道路設施」那行；標語 */}
                    <div className="bg-[#EA580C]/10 p-2.5 rounded-lg border border-[#EA580C]/30 flex items-center gap-2 text-[11px] text-[#EA580C] font-medium leading-snug">
                      <Cone className="w-4 h-4 text-[#EA580C] shrink-0" />
                      <span>工區路段施工中，請減速慢行並隨時注意現場工務人員。</span>
                    </div>

                    {(progressLabel || selectedFacility.properties.schedule || selectedFacility.properties.comp_date) && (
                      <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                        {selectedFacility.properties.schedule && (
                          <div className="flex justify-between items-start text-gray-600 gap-2">
                            <span className="shrink-0">預計施工時程</span>
                            {(() => {
                              const rawSchedule = selectedFacility.properties.schedule;
                              const parts = String(rawSchedule).split(';').map(p => p.trim()).filter(Boolean);
                              if (parts.length > 1) {
                                return (
                                  <div className="flex flex-col text-right leading-tight gap-0.5">
                                    <span className="text-gray-800 font-medium">{parts[0]}</span>
                                    <span className="text-gray-600 text-[10.5px]">{parts.slice(1).join('; ')}</span>
                                  </div>
                                );
                              }
                              return (
                                <span className="text-gray-800 text-right leading-relaxed">
                                  {rawSchedule}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                        {/* 14.3 預計完工日期上方加入工程進度 */}
                        {progressLabel && (
                          <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.schedule ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>工程進度</span>
                            <span className="text-gray-900 font-medium text-right">{progressLabel}</span>
                          </div>
                        )}
                        {selectedFacility.properties.comp_date && (
                          <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.schedule || progressLabel) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                            <span>預計完工日期</span>
                            <span className="text-gray-900 font-medium text-right">
                              {selectedFacility.properties.comp_date}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedFacility.properties.url_link && (
                      <a
                        href={selectedFacility.properties.url_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-1.5 px-3 rounded-lg bg-[#EA580C] hover:bg-orange-700 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Cone className="w-3.5 h-3.5" />
                        <span>查看 Road Ahead 施工詳情</span>
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Street Lighting Poles (路燈燈柱) Details */}
              {selectedFacility.facility_type === 'street_lighting' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-amber-400/10 p-2.5 rounded-lg border border-amber-400/30 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-amber-500 font-bold">💡</span>
                        <span className="truncate max-w-[190px]">{selectedFacility.name}</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white shrink-0">
                        公用路燈
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-900 font-medium">
                      💡 溫哥華市政公用照明路燈柱 (Street Lighting Poles)
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.block_number && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>街區編號 (Block #)</span>
                        <span className="text-gray-900 font-medium text-right">
                          #{selectedFacility.properties.block_number}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.node_number !== undefined && (
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.block_number ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>燈柱節點 (Node #)</span>
                        <span className="text-gray-900 font-medium text-right">
                          #{selectedFacility.properties.node_number}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.local_area && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.block_number || selectedFacility.properties.node_number !== undefined) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>所屬社區分區</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.local_area}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>主管機關</span>
                      <span className="text-gray-900 font-medium text-right">
                        City of Vancouver Engineering Services
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>資料更新頻率</span>
                      <span className="text-gray-900 font-medium text-right">
                        每 3 個月更新 1 次 (Quarterly)
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>坐標位置</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.lat.toFixed(5)}, {selectedFacility.lon.toFixed(5)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Street Lighting Conduits (路燈地下配電管線) Details */}
              {selectedFacility.facility_type === 'street_lighting_conduits' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 6.2 黃區塊:左方是公共事業 */}
                  <div className="bg-amber-400/10 p-2.5 rounded-lg border border-amber-400/30 flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                      <span className="text-base text-amber-500 font-bold">⚡</span>
                      <span>公共事業</span>
                    </span>
                  </div>

                  {/* 6.3 刪除英文Wireset, Underground Conduit & 6.4 刪除資料更新頻率, 點選位置, 主管機關 */}
                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>線組規格</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.wireset_type || '標準規格'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>管線類型</span>
                      <span className="text-gray-900 font-medium text-right">
                        地下供電導管
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Beach Water Quality (海灘水質) Details */}
              {selectedFacility.facility_type === 'beach_water_quality' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-teal-500/10 p-2.5 rounded-lg border border-teal-500/30 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-teal-600 font-bold">🏖️</span>
                        <span className="truncate max-w-[180px]">{selectedFacility.name}</span>
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0 ${
                        selectedFacility.properties.status === 'safe' ? 'bg-emerald-600' :
                        selectedFacility.properties.status === 'advisory' ? 'bg-amber-600' :
                        selectedFacility.properties.status === 'warning' ? 'bg-rose-600' : 'bg-gray-500'
                      }`}>
                        {selectedFacility.properties.status_label || '水質檢測'}
                      </span>
                    </div>
                    <div className="text-[11px] text-teal-900 font-medium">
                      💧 大溫哥華海灘與休閒水質監測 (Metro Vancouver Beach Monitoring)
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>大腸桿菌指標 (E. coli)</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.last_value !== null ? `${selectedFacility.properties.last_value} MPN/100ml` : '未有讀數'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>安全標準參考</span>
                      <span className="text-gray-900 font-medium text-right">
                        ≤200 優良 · 200-400 留意 · &gt;400 警告
                      </span>
                    </div>

                    {selectedFacility.properties.health_authority && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>管轄衛生局</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.health_authority}
                        </span>
                      </div>
                    )}

                    {(selectedFacility.properties.municipality || selectedFacility.properties.area) && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>所屬市鎮 / 水域</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.municipality} {selectedFacility.properties.area ? `· ${selectedFacility.properties.area}` : ''}
                        </span>
                      </div>
                    )}

                    {selectedFacility.properties.last_date && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>最近檢測日期</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.last_date}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>資料更新頻率</span>
                      <span className="text-gray-900 font-medium text-right">
                        每個月更新 1 次 (Monthly)
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>中心座標</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.lat.toFixed(5)}, {selectedFacility.lon.toFixed(5)}
                      </span>
                    </div>
                  </div>

                  {selectedFacility.properties.internet_link && (
                    <a
                      href={selectedFacility.properties.internet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-1.5 px-3 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                    >
                      <span>🌐 開啟衛生局官方水質公告</span>
                    </a>
                  )}
                </div>
              )}

              {/* Fire Hydrants (消防栓) Details */}
              {selectedFacility.facility_type === 'fire_hydrants' && (() => {
                const props = selectedFacility.properties || {};
                const id = props.id || selectedFacility.id;
                const instDate = props.instdate1;
                const fireUseOnly = props.fireuseonly != null
                  ? (props.fireuseonly === 'Y' || props.fireuseonly === 'Yes' || props.fireuseonly === true ? '是' : (props.fireuseonly === 'N' || props.fireuseonly === 'No' || props.fireuseonly === false ? '否' : props.fireuseonly))
                  : null;
                const manufacturer = props.code;
                const model = props.covwaterhydrantunittype;
                const rawColor = props.color;
                const colorMap: Record<string, string> = {
                  'Blue': '藍色',
                  'Green': '綠色',
                  'Yellow': '黃色',
                  'Red': '紅色',
                  'White/Blue': '白/藍色',
                  'White': '白色',
                  'Orange': '橙色',
                };
                const displayColor = rawColor ? (colorMap[rawColor] || rawColor) : null;

                const hasFirstSection = id != null || instDate != null || fireUseOnly != null;
                const hasSecondSection = manufacturer != null || model != null || displayColor != null;

                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* 29.2 刪除「政府設施」列 */}
                    <div className="bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/25 flex items-center gap-2 text-[11px] text-rose-950 font-medium leading-snug">
                      <span className="text-base text-rose-600 font-bold shrink-0">🧯</span>
                      <span>緊急求助撥打 911</span>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                      {id != null && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>識別碼</span>
                          <span className="text-gray-900 font-medium text-right">{id}</span>
                        </div>
                      )}
                      {instDate != null && (
                        <div className={`flex justify-between items-center text-gray-600 ${id != null ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>安裝日期</span>
                          <span className="text-gray-900 font-medium text-right">{instDate}</span>
                        </div>
                      )}
                      {fireUseOnly != null && (
                        <div className={`flex justify-between items-center text-gray-600 ${(id != null || instDate != null) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>僅限消防使用</span>
                          <span className="text-gray-900 font-medium text-right">{fireUseOnly}</span>
                        </div>
                      )}

                      {hasFirstSection && hasSecondSection && (
                        <div className="border-t border-gray-200/80 my-0.5" />
                      )}

                      {manufacturer != null && (
                        <div className="flex justify-between items-center text-gray-600">
                          <span>製造商</span>
                          <span className="text-gray-900 font-medium text-right">{manufacturer}</span>
                        </div>
                      )}
                      {model != null && (
                        <div className={`flex justify-between items-center text-gray-600 ${manufacturer != null ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>型號</span>
                          <span className="text-gray-900 font-medium text-right">{model}</span>
                        </div>
                      )}
                      {displayColor != null && (
                        <div className={`flex justify-between items-center text-gray-600 ${(manufacturer != null || model != null) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                          <span>外觀顏色</span>
                          <span className="text-gray-900 font-medium text-right">{displayColor}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Zoning Districts (土地規劃分區) Details */}
              {selectedFacility.facility_type === 'zoning_districts' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/25 flex items-center gap-1.5 text-[11px] text-purple-950 font-medium leading-snug">
                    <span className="text-base text-purple-600 font-bold shrink-0">📐</span>
                    <span>都市土地規劃與使用分區</span>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.zoning_classification && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>土地規劃類別</span>
                        <span className="text-gray-800 text-right max-w-[200px]">
                          {selectedFacility.properties.zoning_classification}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.cd_1_number && (
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.zoning_classification ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>CD-1 專屬編號</span>
                        <span className="text-gray-900 font-medium text-right">
                          #{selectedFacility.properties.cd_1_number}
                        </span>
                      </div>
                    )}
                    <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.zoning_classification || selectedFacility.properties.cd_1_number) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                      <span>主管機關</span>
                      <span className="text-gray-900 font-medium text-right">
                        City of Vancouver Planning Department
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Public Trees (公有街道樹木) Details */}
              {selectedFacility.facility_type === 'public_trees' && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* 33.4 公園設施標題 */}
                  <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/25 flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                    <span className="text-base text-emerald-600 font-bold">🌳</span>
                    <span>公園設施</span>
                  </div>

                  {/* 7.1 把現在所有資料放到綠區塊下方 */}
                  {/* 7.4 綠區塊下方的資料: 樹木編號, 學名, 胸徑, 所屬街區, 栽種日期 (已刪除英文) */}
                  {/* 7.5 刪除街道地址, 資料更新頻率, 經緯坐標 */}
                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    {selectedFacility.properties.tree_id && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>樹木編號</span>
                        <span className="text-gray-900 font-medium text-right">
                          #{selectedFacility.properties.tree_id}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.genus_name || selectedFacility.properties.species_name) && (
                      <div className={`flex justify-between items-center text-gray-600 ${selectedFacility.properties.tree_id ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>學名</span>
                        <span className="text-gray-800 text-right max-w-[190px] truncate">
                          {[selectedFacility.properties.genus_name, selectedFacility.properties.species_name, selectedFacility.properties.cultivar_name].filter(Boolean).join(' ')}
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.diameter_inches !== undefined && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.tree_id || selectedFacility.properties.genus_name || selectedFacility.properties.species_name) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>胸徑</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.diameter_inches}&quot; ({selectedFacility.properties.diameter_cm || Math.round(Number(selectedFacility.properties.diameter_inches) * 2.54)} cm)
                        </span>
                      </div>
                    )}
                    {selectedFacility.properties.neighbourhood_name && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.tree_id || selectedFacility.properties.genus_name || selectedFacility.properties.species_name || selectedFacility.properties.diameter_inches !== undefined) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>所屬街區</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.neighbourhood_name}
                        </span>
                      </div>
                    )}
                    {(selectedFacility.properties.date_planted || selectedFacility.properties.planted_year) && (
                      <div className={`flex justify-between items-center text-gray-600 ${(selectedFacility.properties.tree_id || selectedFacility.properties.genus_name || selectedFacility.properties.species_name || selectedFacility.properties.diameter_inches !== undefined || selectedFacility.properties.neighbourhood_name) ? 'pt-1.5 border-t border-gray-100' : ''}`}>
                        <span>栽種日期</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.date_planted ? String(selectedFacility.properties.date_planted).slice(0, 10) : `${selectedFacility.properties.planted_year} 年`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Ski Resort (滑雪場) Details */}
              {selectedFacility.facility_type === 'ski_resort' && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/30 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-950 text-xs flex items-center gap-1.5">
                        <span className="text-base text-cyan-600 font-bold">⛷️</span>
                        <span>{selectedFacility.properties.status_zh || '季節休園'}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-cyan-900 font-medium flex items-center justify-between">
                      <span>{selectedFacility.properties.english_name}</span>
                      <span className="text-[10px] text-gray-500">{selectedFacility.properties.area?.match(/\(([^)]+)\)/)?.[1] || selectedFacility.properties.area || 'West Vancouver'}</span>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded border border-gray-100 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>雪道開放情況</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.slopes_label || '--'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>纜車開放數量</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.lifts_label || '--'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>積雪深度 (山底 / 山頂)</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.snow_base || '-'} / {selectedFacility.properties.snow_top || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>雪場海拔 (垂直落差)</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.altitude_base} - {selectedFacility.properties.altitude_top} ({selectedFacility.properties.vertical_drop})
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                      <span>夜間滑雪</span>
                      <span className="text-gray-900 font-medium text-right">
                        {selectedFacility.properties.night_skiing ? '🌙 有提供' : '無'}
                      </span>
                    </div>
                    {selectedFacility.properties.season_range && (
                      <div className="flex justify-between items-center text-gray-600 pt-1.5 border-t border-gray-100">
                        <span>預估營運雪季</span>
                        <span className="text-gray-900 font-medium text-right">
                          {selectedFacility.properties.season_range}
                        </span>
                      </div>
                    )}
                  </div>

                  {selectedFacility.properties.official_url && (
                    <a
                      href={selectedFacility.properties.official_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium text-xs transition-colors shadow-sm"
                    >
                      <span>前往雪場官方網站購票/通行證</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {/* 詳細資料 (Snow Report / SkiResort) 外部連結按鈕 */}
                  {(() => {
                    const detailUrl = selectedFacility.properties.skiresort_url || (
                      selectedFacility.id?.includes('cypress') ? 'https://www.skiresort.com/en/ski-resort/cypress-mountain/snow-report/' :
                      selectedFacility.id?.includes('grouse') ? 'https://www.skiresort.com/en/ski-resort/grouse-mountain/snow-report/' :
                      selectedFacility.id?.includes('seymour') ? 'https://www.skiresort.com/en/ski-resort/mount-seymour/snow-report/' :
                      null
                    );
                    if (!detailUrl) return null;
                    return (
                      <a
                        href={detailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-200 hover:text-white rounded font-medium text-xs border border-cyan-800/40 transition-colors shadow-sm"
                      >
                        <span>查看詳細資料</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    );
                  })()}
                </div>
              )}

              {/* 地表氣象觀測站 (SWOB Weather Station) */}
              {(selectedFacility.facility_type === 'swob_station' || selectedFacility.facility_type === 'weather_station') && (() => {
                const p = selectedFacility.properties || {};
                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Radio className="w-4 h-4 text-emerald-600" />
                        <span className="font-bold text-emerald-950 text-xs">加拿大環境部地表氣象站</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-emerald-600 text-white px-2 py-0.5 rounded">
                        {p.station_id || p.id || 'SWOB'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">🌡️ 即時氣溫</span>
                        <span className="font-bold text-base text-gray-900 font-mono mt-0.5">{p.temp || p.temperature || '--'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">💨 當前風速</span>
                        <span className="font-bold text-xs text-gray-900 font-mono mt-0.5">{p.wind || '--'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">💧 相對濕度</span>
                        <span className="font-bold text-xs text-gray-900 font-mono mt-0.5">{p.hum || p.humidity || '--'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">🧭 大氣氣壓</span>
                        <span className="font-bold text-xs text-gray-900 font-mono mt-0.5">{p.press || p.pressure || '--'}</span>
                      </div>
                    </div>

                    <div className="pt-0.5">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Google Maps 導航至此氣象站</span>
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* 潮汐水位站 (Coastal Tide Station) */}
              {selectedFacility.facility_type === 'tide_stations' && (() => {
                const p = selectedFacility.properties || {};
                const isRising = p.state_trend === 'rising';
                const isFalling = p.state_trend === 'falling';
                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-sky-500/10 p-2.5 rounded-lg border border-sky-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Waves className="w-4 h-4 text-sky-600" />
                        <span className="font-bold text-sky-950 text-xs">DFO/CHS 國家海岸潮汐觀測站</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-sky-600 text-white px-2 py-0.5 rounded">
                        {p.code || 'CHS'}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">當前潮位高程</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-2xl font-extrabold text-sky-600 font-mono">{p.current_water_level_m ?? p.water_level ?? '--'}</span>
                          <span className="text-xs text-gray-500 font-medium">米 (m)</span>
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded font-mono flex items-center gap-1 ${
                        isRising ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                        isFalling ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        <span>{p.state || '正常'}</span>
                        <span>{isRising ? '↗' : isFalling ? '↘' : '→'}</span>
                      </span>
                    </div>

                    {(p.next_high || p.next_low) && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {p.next_high && (
                          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-col">
                            <span className="text-[10px] text-emerald-800 font-bold">▲ 下次滿潮 (High Tide)</span>
                            <span className="font-extrabold text-sm text-emerald-700 font-mono mt-0.5">{p.next_high.value} m</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">{p.next_high.time}</span>
                          </div>
                        )}
                        {p.next_low && (
                          <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-200 flex flex-col">
                            <span className="text-[10px] text-sky-800 font-bold">▼ 下次乾潮 (Low Tide)</span>
                            <span className="font-extrabold text-sm text-sky-700 font-mono mt-0.5">{p.next_low.value} m</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">{p.next_low.time}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-0.5">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Google Maps 導航至此測站</span>
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* 水文觀測站 (Hydrometric Station) */}
              {selectedFacility.facility_type === 'hydrometric_station' && (() => {
                const p = selectedFacility.properties || {};
                return (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Anchor className="w-4 h-4 text-cyan-600" />
                        <span className="font-bold text-cyan-950 text-xs">加拿大國家水文測候站 (NHN)</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-cyan-600 text-white px-2 py-0.5 rounded">
                        {p.id || 'ECCC'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">即時水位高度</span>
                        <span className="font-extrabold text-base text-cyan-700 font-mono mt-0.5">{p.level || '--'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex flex-col">
                        <span className="text-[10px] text-gray-500 font-medium">河川秒流量</span>
                        <span className="font-extrabold text-base text-cyan-700 font-mono mt-0.5">{p.flow || '--'}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-between">
                      <span className="text-gray-500 text-[11px]">水文運作狀況</span>
                      <span className="font-bold text-emerald-600 text-xs">{p.status || '正常流量'}</span>
                    </div>

                    <div className="pt-0.5">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedFacility.lat},${selectedFacility.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Google Maps 導航至此水文站</span>
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* 設施通用坐標與複製按鈕 */}
              <div className="flex items-center justify-between text-[11px] text-gray-500 pt-2.5 mt-2.5 border-t border-gray-100 font-mono">
                <span className="flex items-center gap-1 text-gray-600">
                  <span>📍</span>
                  <span>{selectedFacility.lat.toFixed(6)}, {selectedFacility.lon.toFixed(6)}</span>
                </span>
                <button
                  onClick={() => copyCoordinatesToClipboard(selectedFacility.lat, selectedFacility.lon)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 hover:bg-cyan-50 hover:text-cyan-600 text-gray-700 transition-colors text-[10.5px] font-sans font-medium border border-gray-200/60 shadow-xs"
                  title="複製坐標"
                >
                  <Copy className="w-3 h-3 text-cyan-600" />
                  <span>複製坐標</span>
                </button>
              </div>
            </div>
          </Popup>
        )}

      </Map>

      {/* 大數據圖層載入中提示 Toast (Heavy Layer Loading Toast) */}
      {Object.keys(loadingHeavyLayers).length > 0 && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[65] bg-[#141b26]/95 backdrop-blur-md text-cyan-300 rounded-full px-4 py-2 shadow-[0_10px_35px_rgba(0,0,0,0.6)] border border-cyan-500/50 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-3 duration-200 select-none ring-1 ring-cyan-400/20">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0"></div>
          <span className="text-xs font-semibold tracking-wide">
            正在載入 {Object.values(loadingHeavyLayers).join('、')} 數據...
          </span>
        </div>
      )}

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
              const map = mapRef.current?.getMap();
              if (map) {
                const center = map.getCenter();
                // 補償左側圖層面板展開時的視覺中央偏差（面板寬約 300px，向右補償 140px，無展開則為 0）
                const offsetX = isLayerPanelOpen ? 140 : 0;
                map.flyTo({
                  center: [center.lng, center.lat],
                  zoom: zoomNotification.targetZoom,
                  offset: [-offsetX, 0],
                  pitch: 0,
                  bearing: 0,
                  duration: 800,
                  essential: true
                });
              }
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

      {/* 底部座標與地理資訊列升級 (Bottom Coordinate, Neighbourhood & Zoom Level HUD) */}
      {/* 坐標與地理資訊狀態列 (Fixed Top-Right Coordinate Display HUD) */}
      {cursorCoords && (
        <div
          className="absolute top-2 right-2 z-20 pointer-events-auto select-none flex items-center gap-2 px-2.5 py-1.5 bg-[#10131a]/95 backdrop-blur-md rounded-full border border-[#2a2f3d] shadow-xl text-[11px] font-mono text-gray-200"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>

          {cursorNeighbourhood && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 shrink-0">
              {(() => {
                const paren = cursorNeighbourhood.match(/\((.*?)\)/);
                if (paren) return paren[1].trim();
                const enOnly = cursorNeighbourhood.replace(/[\u4e00-\u9fa5]/g, '').trim();
                return enOnly || 'Vancouver';
              })()}
            </span>
          )}

          <span className="tracking-tight text-gray-200 font-medium">
            {Math.abs(cursorCoords.lat).toFixed(4)}° {cursorCoords.lat >= 0 ? 'N' : 'S'}, {Math.abs(cursorCoords.lng).toFixed(4)}° {cursorCoords.lng >= 0 ? 'E' : 'W'}
          </span>

          <span className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-black/40 border border-white/5 font-sans">
            Zoom {currentZoom.toFixed(1)}
          </span>
        </div>
      )}

      {/* 探索功能橫向平排底欄 (Explore Horizontal Bottom Bar Dock) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none flex items-center gap-1 px-2.5 py-1.5 bg-[#10131a]/95 backdrop-blur-md rounded-full border border-[#2a2f3d] shadow-2xl max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-none ring-1 ring-white/5">
        {[
          { id: 'weather', label: '天氣', icon: CloudRain, color: 'text-sky-400' },
          { id: 'news', label: '新聞', icon: Activity, color: 'text-amber-400' },
          { id: 'events', label: '活動', icon: Compass, color: 'text-purple-400' },
          { id: 'beach', label: '泳灘', icon: Waves, color: 'text-teal-300' },
          { id: 'ski', label: '滑雪', icon: Navigation, color: 'text-cyan-400' },
          { id: 'aurora', label: '極光', icon: Zap, color: 'text-fuchsia-400' },
          { id: 'fuel', label: '加油站', icon: Fuel, color: 'text-amber-500' },
          { id: 'ev', label: '充電', icon: Zap, color: 'text-yellow-400' },
          { id: 'alerts', label: '即時通報', icon: AlertCircle, color: 'text-rose-400' },
          { id: 'traffic', label: '路況', icon: Activity, color: 'text-amber-400' },
          { id: 'border', label: '關口', icon: Compass, color: 'text-blue-400' },
          { id: 'ferry', label: '渡輪', icon: Ship, color: 'text-sky-400' },
          { id: 'cargo', label: '航運', icon: Ship, color: 'text-teal-400' },
        ].map((tab) => {
          const isActive = isExploreOpen && exploreTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (isExploreOpen && exploreTab === tab.id) {
                  setExploreOpen(false);
                } else {
                  openExploreTab(tab.id as any);
                }
              }}
              title={tab.label}
              className={`group flex items-center justify-center h-8 px-2.5 rounded-full text-xs font-medium transition-all duration-300 shrink-0 ${
                isActive
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : 'text-gray-300 hover:text-white hover:bg-white/10 border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${tab.color}`} />
              <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[75px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 whitespace-nowrap text-[11px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

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

      {/* 路況顏色圖例 (Traffic Flow Speed Legend: Fast to Slow) */}
      {layers.trafficConditions && (
        <div 
          className={`absolute ${
            layers.crimeAreas ? 'bottom-[155px]' : 'bottom-6'
          } left-4 z-20 bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl px-3.5 py-2.5 shadow-2xl border border-[#2a2f3d] select-none animate-in fade-in duration-200 flex flex-col gap-1.5`}
        >
          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-gray-200">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>即時路況圖例</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">TomTom Flow</span>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] font-medium text-emerald-400 shrink-0">暢通 (Fast)</span>
            <div className="flex items-center gap-1">
              <span className="w-6 h-2.5 rounded-[2px] bg-[#68bc73] shadow-xs" title="暢通無阻 (自由流速)" />
              <span className="w-6 h-2.5 rounded-[2px] bg-[#f8cb47] shadow-xs" title="順暢微緩" />
              <span className="w-6 h-2.5 rounded-[2px] bg-[#e75344] shadow-xs" title="車多緩行 / 壅塞" />
              <span className="w-6 h-2.5 rounded-[2px] bg-[#822119] shadow-xs" title="嚴重停滯 / 封閉" />
            </div>
            <span className="text-[11px] font-medium text-rose-400 shrink-0">繁忙 (Slow)</span>
          </div>
        </div>
      )}

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

        const seabusOriginName = destName.toLowerCase().includes('waterfront') ? 'Lonsdale Quay 朗斯代爾碼頭' : 'Waterfront Station 濱海站渡輪碼頭';
        const seabusDestName = destName.toLowerCase().includes('waterfront') ? 'Waterfront Station 濱海站渡輪碼頭' : 'Lonsdale Quay 朗斯代爾碼頭';
        const seabusOriginCoords = destName.toLowerCase().includes('waterfront') ? [-123.0815, 49.3105] : [-123.1118, 49.2861];
        const seabusDestCoords = destName.toLowerCase().includes('waterfront') ? [-123.1118, 49.2861] : [-123.0815, 49.3105];

        const seabusStops = selectedBus.is_seabus ? [
          {
            seq: 1,
            stop_id: 'seabus_terminal_origin',
            name: seabusOriginName,
            lon: seabusOriginCoords[0],
            lat: seabusOriginCoords[1],
            status: 'passed'
          },
          {
            seq: 2,
            stop_id: 'seabus_terminal_dest',
            name: seabusDestName,
            lon: seabusDestCoords[0],
            lat: seabusDestCoords[1],
            status: 'next',
            eta_minutes: nextStopMin ?? 5,
            eta_time: nextStopTime || ''
          }
        ] : [];

        const stopList = selectedBus.is_seabus ? seabusStops : (busDetails?.stops || []);

        return (
          <div className="fixed top-[72px] right-4 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
            {/* Header */}
            <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-lg ${
                  selectedBus.is_seabus 
                    ? 'bg-sky-500/20 border border-sky-500/40 text-sky-400' 
                    : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                } flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}>
                  {selectedBus.is_seabus ? (
                    <Ship className="w-4 h-4 text-sky-400" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-[15px] leading-snug tracking-tight truncate">
                    {selectedBus.is_seabus ? `SeaBus 跨海渡輪 去 ${destName}` : `${busNum} 去 ${destName}`}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${
                      selectedBus.is_seabus ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.9)]' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                    } animate-pulse`}></span>
                    <span className={`text-[11px] font-semibold ${
                      selectedBus.is_seabus ? 'text-sky-400' : 'text-emerald-400'
                    }`}>
                      {selectedBus.is_seabus ? '海上渡輪即時航行中' : '即時更新中'}
                    </span>
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
                      : selectedBus.is_seabus
                      ? `全航程 ${stopList.length} 個碼頭`
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
                          fetchSkytrainStationSchedule(String(st.stop_id), st.name, st.lon, st.lat);
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

      {/* 停車收費錶動態篩選器 (Parking Meter Filter Popup) */}
      {layers.parkingMeters && (
        <div className={`fixed z-30 w-[300px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-blue-500/50 select-none animate-in fade-in duration-200 ${getFloatingPanelPos(0)}`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-blue-500/20 text-blue-400">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </span>
              <span className="font-bold text-xs text-white">停車收費錶篩選</span>
            </div>
            <button
              onClick={() => setParkingMeterFilterOpen(!parkingMeterFilterOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
            >
              {parkingMeterFilterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {parkingMeterFilterOpen ? (
            <div className="flex flex-col gap-2.5 text-xs">
              {/* 計費時段切換 */}
              <div className="flex flex-col gap-1 pb-2 border-b border-[#262b38]">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">時段費率計算:</span>
                  <span className="text-[10.5px] text-blue-400 font-medium">
                    {(parkingMeterFilter.timePeriod || 'auto') === 'day' ? '🌞 日間標準' :
                     parkingMeterFilter.timePeriod === 'night' ? '🌙 夜間標準' : '⏰ 依當前時間自動'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {[
                    { id: 'auto', label: '⏰ 自動' },
                    { id: 'day', label: '🌞 日間' },
                    { id: 'night', label: '🌙 夜間' }
                  ].map((p) => {
                    const isSelected = (parkingMeterFilter.timePeriod || 'auto') === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setParkingMeterFilter({ timePeriod: p.id as 'auto' | 'day' | 'night' })}
                        className={`py-1 text-[11px] rounded font-medium transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold shadow-sm'
                            : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-300">每小時最高費率:</span>
                <span className="font-bold text-blue-400 font-mono">
                  {parkingMeterFilter.maxRate >= 20 ? '不限費率' : `≤ $${parkingMeterFilter.maxRate}/hr`}
                </span>
              </div>

              {/* 費率滑桿 */}
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={parkingMeterFilter.maxRate >= 20 ? 10 : parkingMeterFilter.maxRate}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setParkingMeterFilter({ maxRate: val >= 10 ? 20 : val });
                }}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-[#252a38] rounded-lg"
              />

              {/* 快捷標籤 */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: '全部', val: 20 },
                  { label: '≤$2', val: 2 },
                  { label: '≤$3', val: 3 },
                  { label: '≤$5', val: 5 }
                ].map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => setParkingMeterFilter({ maxRate: chip.val })}
                    className={`py-1 text-[11px] rounded font-medium transition-all ${
                      (chip.val === 20 && parkingMeterFilter.maxRate >= 20) || (chip.val === parkingMeterFilter.maxRate)
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* 信用卡篩選 */}
              <label className="flex items-center gap-2 pt-1 border-t border-[#262b38] text-[11px] text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={parkingMeterFilter.creditCardOnly}
                  onChange={(e) => setParkingMeterFilter({ creditCardOnly: e.target.checked })}
                  className="rounded border-gray-600 accent-blue-500"
                />
                <span>只顯示支援信用卡付款</span>
              </label>

              <div className="text-[10px] text-gray-400 flex items-center justify-between">
                <span>溫哥華時區動態計算</span>
                <span className="text-blue-400 font-mono">10pm-9am 免費</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <span>
                目前篩選: <span className="text-blue-400 font-bold">{parkingMeterFilter.maxRate >= 20 ? '不限' : `≤ $${parkingMeterFilter.maxRate}/hr`}</span>
                {parkingMeterFilter.creditCardOnly && <span className="text-blue-300 ml-1">· 信用卡</span>}
                <span className="text-gray-400 ml-1 font-mono text-[10px]">
                  ({(parkingMeterFilter.timePeriod || 'auto') === 'day' ? '日間' : (parkingMeterFilter.timePeriod || 'auto') === 'night' ? '夜間' : '自動'})
                </span>
              </span>
              <button 
                onClick={() => setParkingMeterFilterOpen(true)}
                className="text-[10px] text-blue-400 hover:underline"
              >
                展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 摩托車停車位動態篩選器 (Motorcycle Parking Filter Popup) */}
      {layers.motorcycleParking && (
        <div className={`fixed z-30 w-[300px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-blue-500/50 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos(layers.parkingMeters ? 1 : 0)
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-blue-500/20 text-blue-400">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </span>
              <span className="font-bold text-xs text-white">摩托車停車位篩選</span>
            </div>
            <button
              onClick={() => setMotorcycleFilterOpen(!motorcycleFilterOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
            >
              {motorcycleFilterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {motorcycleFilterOpen ? (
            <div className="flex flex-col gap-2.5 text-xs">
              {/* 計費時段切換 */}
              <div className="flex flex-col gap-1 pb-2 border-b border-[#262b38]">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">時段費率計算:</span>
                  <span className="text-[10.5px] text-blue-400 font-medium">
                    {(motorcycleParkingFilter.timePeriod || 'auto') === 'day' ? '🌞 日間標準' :
                     motorcycleParkingFilter.timePeriod === 'night' ? '🌙 夜間標準' : '⏰ 依當前時間自動'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {[
                    { id: 'auto', label: '⏰ 自動' },
                    { id: 'day', label: '🌞 日間' },
                    { id: 'night', label: '🌙 夜間' }
                  ].map((p) => {
                    const isSelected = (motorcycleParkingFilter.timePeriod || 'auto') === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setMotorcycleParkingFilter({ timePeriod: p.id as 'auto' | 'day' | 'night' })}
                        className={`py-1 text-[11px] rounded font-medium transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold shadow-sm'
                            : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-300">每小時最高費率:</span>
                <span className="font-bold text-blue-400 font-mono">
                  {motorcycleParkingFilter.maxRate >= 20 ? '不限費率' : `≤ $${motorcycleParkingFilter.maxRate}/hr`}
                </span>
              </div>

              {/* 費率滑桿 */}
              <input
                type="range"
                min="1"
                max="4"
                step="0.5"
                value={motorcycleParkingFilter.maxRate >= 20 ? 4 : motorcycleParkingFilter.maxRate}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setMotorcycleParkingFilter({ maxRate: val >= 4 ? 20 : val });
                }}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-[#252a38] rounded-lg"
              />

              {/* 快捷標籤 */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: '全部', val: 20 },
                  { label: '≤$1', val: 1 },
                  { label: '≤$2', val: 2 },
                  { label: '≤$3', val: 3 }
                ].map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => setMotorcycleParkingFilter({ maxRate: chip.val })}
                    className={`py-1 text-[11px] rounded font-medium transition-all ${
                      (chip.val === 20 && motorcycleParkingFilter.maxRate >= 20) || (chip.val === motorcycleParkingFilter.maxRate)
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* 信用卡篩選 */}
              <label className="flex items-center gap-2 pt-1 border-t border-[#262b38] text-[11px] text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={motorcycleParkingFilter.creditCardOnly}
                  onChange={(e) => setMotorcycleParkingFilter({ creditCardOnly: e.target.checked })}
                  className="rounded border-gray-600 accent-blue-500"
                />
                <span>只顯示支援信用卡付款</span>
              </label>

              <div className="text-[10px] text-gray-400 flex items-center justify-between">
                <span>溫哥華時區動態計算</span>
                <span className="text-blue-400 font-mono">10pm-9am 免費</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <span>
                目前篩選: <span className="text-blue-400 font-bold">{motorcycleParkingFilter.maxRate >= 20 ? '不限' : `≤ $${motorcycleParkingFilter.maxRate}/hr`}</span>
                {motorcycleParkingFilter.creditCardOnly && <span className="text-blue-300 ml-1">· 信用卡</span>}
                <span className="text-gray-400 ml-1 font-mono text-[10px]">
                  ({(motorcycleParkingFilter.timePeriod || 'auto') === 'day' ? '日間' : (motorcycleParkingFilter.timePeriod || 'auto') === 'night' ? '夜間' : '自動'})
                </span>
              </span>
              <button 
                onClick={() => setMotorcycleFilterOpen(true)}
                className="text-[10px] text-blue-400 hover:underline"
              >
                展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 加油站品牌動態篩選器 (Gas Station Filter Popup) */}
      {layers.fuel && (
        <div className={`fixed z-30 w-[300px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-amber-500/40 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos((layers.parkingMeters ? 1 : 0) + (layers.motorcycleParking ? 1 : 0))
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-amber-500/20 text-amber-400">
                <Fuel className="w-3.5 h-3.5" />
              </span>
              <span className="font-bold text-xs text-white">加油站品牌篩選</span>
            </div>
            <button
              onClick={() => setFuelFilterOpen(!fuelFilterOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
            >
              {fuelFilterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {fuelFilterOpen ? (
            <div className="flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">選擇連鎖品牌:</span>
                <span className="font-bold text-amber-400 font-mono text-[11px]">
                  {fuelFilter.brands.length === 0 || fuelFilter.brands.includes('all') ? '全部品牌' : `${fuelFilter.brands.length} 個已選`}
                </span>
              </div>

              {/* 品牌快捷選擇標籤 */}
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: '全部', id: 'all' },
                  { label: 'Chevron', id: 'Chevron' },
                  { label: 'Shell', id: 'Shell' },
                  { label: 'Petro-Can', id: 'Petro-Canada' },
                  { label: 'Esso', id: 'Esso' },
                  { label: 'Mobil', id: 'Mobil' },
                ].map((b) => {
                  const isAll = fuelFilter.brands.length === 0 || fuelFilter.brands.includes('all');
                  const isSelected = b.id === 'all' ? isAll : (!isAll && fuelFilter.brands.includes(b.id));
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        if (b.id === 'all') {
                          setFuelFilter({ brands: ['all'] });
                        } else {
                          const current = isAll ? [] : [...fuelFilter.brands];
                          const exists = current.includes(b.id);
                          const next = exists ? current.filter(x => x !== b.id) : [...current, b.id];
                          setFuelFilter({ brands: next.length === 0 ? ['all'] : next });
                        }
                      }}
                      className={`py-1 text-[11px] rounded font-medium transition-all ${
                        isSelected
                          ? 'bg-amber-500 text-gray-950 font-bold shadow-sm'
                          : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                      }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>

              {/* 其他獨立油站 */}
              <label className="flex items-center gap-2 pt-1 border-t border-[#262b38] text-[11px] text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!fuelFilter.brands.includes('all') && fuelFilter.brands.includes('Other')}
                  onChange={(e) => {
                    const isAll = fuelFilter.brands.length === 0 || fuelFilter.brands.includes('all');
                    const current = isAll ? [] : [...fuelFilter.brands];
                    const next = e.target.checked ? [...current, 'Other'] : current.filter(x => x !== 'Other');
                    setFuelFilter({ brands: next.length === 0 ? ['all'] : next });
                  }}
                  className="rounded border-gray-600 accent-amber-500"
                />
                <span>包含獨立油站 (Husky / Super Save 等)</span>
              </label>

              <div className="text-[10px] text-gray-400 flex items-center justify-between">
                <span>地圖即時過濾渲染</span>
                <span className="text-amber-400 font-mono">即時生效</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <span>目前篩選: <span className="text-amber-400 font-bold">{fuelFilter.brands.includes('all') || fuelFilter.brands.length === 0 ? '全部' : fuelFilter.brands.join(', ')}</span></span>
              <button 
                onClick={() => setFuelFilterOpen(true)}
                className="text-[10px] text-amber-400 hover:underline"
              >
                展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 電動車充電站規格篩選器 (EV & Tesla Filter Popup) */}
      {(layers.evCharging || layers.tesla) && (
        <div className={`fixed z-30 w-[310px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-emerald-500/40 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos((layers.parkingMeters ? 1 : 0) + (layers.motorcycleParking ? 1 : 0) + (layers.fuel ? 1 : 0))
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                <Zap className="w-3.5 h-3.5" />
              </span>
              <span className="font-bold text-xs text-white">電動車充電規格篩選</span>
            </div>
            <button
              onClick={() => setEvFilterOpen(!evFilterOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
            >
              {evFilterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {evFilterOpen ? (
            <div className="flex flex-col gap-2.5 text-xs">
              {/* 充電功率/速度 */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>充電速度:</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {evChargingFilter.speed === 'all' ? '全部功率' : evChargingFilter.speed === 'fast' ? '快充 (≥50kW DCFC)' : '慢充 (Level 2 AC)'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: '全部', val: 'all' },
                    { label: '快充 DCFC', val: 'fast' },
                    { label: '慢充 L2', val: 'slow' }
                  ].map((s) => (
                    <button
                      key={s.val}
                      onClick={() => setEvChargingFilter({ speed: s.val as any })}
                      className={`py-1 text-[11px] rounded font-medium transition-all ${
                        evChargingFilter.speed === s.val
                          ? 'bg-emerald-500 text-gray-950 font-bold shadow-sm'
                          : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 接頭規格 */}
              <div className="flex flex-col gap-1 pt-1.5 border-t border-[#262b38]">
                <div className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>接頭規格:</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {evChargingFilter.connector === 'all' ? '通用接頭' : evChargingFilter.connector}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { label: '全部', val: 'all' },
                    { label: 'CCS', val: 'CCS' },
                    { label: 'J1772', val: 'J1772' },
                    { label: 'Tesla', val: 'Tesla' }
                  ].map((c) => (
                    <button
                      key={c.val}
                      onClick={() => setEvChargingFilter({ connector: c.val })}
                      className={`py-1 text-[11px] rounded font-medium transition-all ${
                        evChargingFilter.connector === c.val
                          ? 'bg-emerald-500 text-gray-950 font-bold shadow-sm'
                          : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 免費充電 */}
              <label className="flex items-center gap-2 pt-1.5 border-t border-[#262b38] text-[11px] text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={evChargingFilter.freeOnly}
                  onChange={(e) => setEvChargingFilter({ freeOnly: e.target.checked })}
                  className="rounded border-gray-600 accent-emerald-500"
                />
                <span>只顯示免費充電站點</span>
              </label>

              <div className="text-[10px] text-gray-400 flex items-center justify-between">
                <span>地圖即時過濾渲染</span>
                <span className="text-emerald-400 font-mono">即時生效</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <span>目前篩選: <span className="text-emerald-400 font-bold">{evChargingFilter.speed === 'all' ? '全部' : evChargingFilter.speed === 'fast' ? '快充' : '慢充'}{evChargingFilter.freeOnly ? ' · 免費' : ''}</span></span>
              <button 
                onClick={() => setEvFilterOpen(true)}
                className="text-[10px] text-emerald-400 hover:underline"
              >
                展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 共享汽車營運品牌圖例與篩選 (Car Sharing Legend & Filter Popup) */}
      {layers.carSharing && (
        <div className={`fixed z-30 w-[250px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-cyan-500/40 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos((layers.parkingMeters ? 1 : 0) + (layers.motorcycleParking ? 1 : 0) + (layers.fuel ? 1 : 0) + ((layers.evCharging || layers.tesla) ? 1 : 0))
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-cyan-500/20 text-cyan-400">
                <Car className="w-3.5 h-3.5" />
              </span>
              <div className="flex flex-col">
                <span className="font-bold text-xs text-white">共享汽車篩選</span>
                <span className="text-[9.5px] text-gray-400">點擊項目可開關圖層</span>
              </div>
            </div>
            <button
              onClick={() => setCarSharingLegendOpen(!carSharingLegendOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
              title={carSharingLegendOpen ? "收合" : "展開"}
            >
              {carSharingLegendOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {carSharingLegendOpen ? (
            <div className="flex flex-col gap-2 text-xs">
              {/* Evo Car Share Switch */}
              <button
                type="button"
                onClick={() => setCarSharingFilter(prev => ({ ...prev, evo: !prev.evo }))}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                  carSharingFilter.evo 
                    ? 'bg-cyan-950/40 border-cyan-700/60 shadow-[0_0_8px_rgba(6,182,212,0.15)]' 
                    : 'bg-[#10141e]/50 border-[#262b38] opacity-45 hover:opacity-75'
                }`}
                title={carSharingFilter.evo ? "點擊隱藏 Evo 站點" : "點擊顯示 Evo 站點"}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full shrink-0 transition-all ${
                    carSharingFilter.evo ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.7)]' : 'bg-gray-600'
                  }`} />
                  <span className={`font-bold text-xs ${carSharingFilter.evo ? 'text-white' : 'text-gray-400 line-through'}`}>
                    Evo Car Share
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    carSharingFilter.evo ? 'text-cyan-300 bg-cyan-900/50' : 'text-gray-500 bg-gray-800/40'
                  }`}>
                    自由取還
                  </span>
                  <div className={`w-7 h-4 rounded-full transition-colors p-0.5 flex items-center ${
                    carSharingFilter.evo ? 'bg-cyan-600 justify-end' : 'bg-gray-700 justify-start'
                  }`}>
                    <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                  </div>
                </div>
              </button>

              {/* Modo Co-op Switch */}
              <button
                type="button"
                onClick={() => setCarSharingFilter(prev => ({ ...prev, modo: !prev.modo }))}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                  carSharingFilter.modo 
                    ? 'bg-red-950/40 border-red-700/60 shadow-[0_0_8px_rgba(239,68,68,0.15)]' 
                    : 'bg-[#10141e]/50 border-[#262b38] opacity-45 hover:opacity-75'
                }`}
                title={carSharingFilter.modo ? "點擊隱藏 Modo 站點" : "點擊顯示 Modo 站點"}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full shrink-0 transition-all ${
                    carSharingFilter.modo ? 'bg-red-600 shadow-[0_0_8px_rgba(239,68,68,0.7)]' : 'bg-gray-600'
                  }`} />
                  <span className={`font-bold text-xs ${carSharingFilter.modo ? 'text-white' : 'text-gray-400 line-through'}`}>
                    Modo Co-op
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    carSharingFilter.modo ? 'text-red-300 bg-red-900/50' : 'text-gray-500 bg-gray-800/40'
                  }`}>
                    原站還車
                  </span>
                  <div className={`w-7 h-4 rounded-full transition-colors p-0.5 flex items-center ${
                    carSharingFilter.modo ? 'bg-red-600 justify-end' : 'bg-gray-700 justify-start'
                  }`}>
                    <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                  </div>
                </div>
              </button>

              {(!carSharingFilter.evo || !carSharingFilter.modo) && (
                <div className="flex items-center justify-between pt-1 border-t border-[#262b38] text-[10.5px]">
                  <span className="text-gray-400">已過濾部分品牌</span>
                  <button
                    type="button"
                    onClick={() => setCarSharingFilter({ evo: true, modo: true })}
                    className="text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    重設全部顯示
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full inline-block ${carSharingFilter.evo ? 'bg-cyan-500' : 'bg-gray-600'}`} />
                <span className={`text-[10.5px] font-medium ${carSharingFilter.evo ? 'text-gray-300' : 'text-gray-500 line-through'}`}>Evo</span>
                <span className={`w-2.5 h-2.5 rounded-full inline-block ml-1 ${carSharingFilter.modo ? 'bg-red-600' : 'bg-gray-600'}`} />
                <span className={`text-[10.5px] font-medium ${carSharingFilter.modo ? 'text-gray-300' : 'text-gray-500 line-through'}`}>Modo</span>
              </div>
              <button 
                onClick={() => setCarSharingLegendOpen(true)}
                className="text-[10px] text-cyan-400 hover:underline"
              >
                篩選/展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 單車徑分級圖例與篩選 (Bikeways Legend & Filter Popup) */}
      {layers.bikeways && (
        <div className={`fixed z-30 w-[270px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-emerald-500/40 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos((layers.parkingMeters ? 1 : 0) + (layers.motorcycleParking ? 1 : 0) + (layers.fuel ? 1 : 0) + ((layers.evCharging || layers.tesla) ? 1 : 0) + (layers.carSharing ? 1 : 0))
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                <Bike className="w-3.5 h-3.5" />
              </span>
              <div className="flex flex-col">
                <span className="font-bold text-xs text-white">單車徑路網篩選</span>
                <span className="text-[9.5px] text-gray-400">點擊項目可開關車道</span>
              </div>
            </div>
            <button
              onClick={() => setBikewaysLegendOpen(!bikewaysLegendOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
              title={bikewaysLegendOpen ? "收合" : "展開"}
            >
              {bikewaysLegendOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {bikewaysLegendOpen ? (
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                { key: 'Protected Bike Lanes', label: '受保護獨立單車道', tag: 'Protected', color: '#10b981', borderActive: 'border-emerald-500/50', bgActive: 'bg-emerald-950/30', tagColor: 'text-emerald-400', toggleBg: 'bg-emerald-600' },
                { key: 'Painted Lanes', label: '路面標線單車道', tag: 'Painted', color: '#0ea5e9', borderActive: 'border-sky-500/50', bgActive: 'bg-sky-950/30', tagColor: 'text-sky-400', toggleBg: 'bg-sky-600' },
                { key: 'Local Street', label: '社區慢速單車街', tag: 'Local Street', color: '#f59e0b', borderActive: 'border-amber-500/50', bgActive: 'bg-amber-950/30', tagColor: 'text-amber-400', toggleBg: 'bg-amber-600' },
                { key: 'Shared Lanes', label: '混合共用車道', tag: 'Shared', color: '#a855f7', borderActive: 'border-purple-500/50', bgActive: 'bg-purple-950/30', tagColor: 'text-purple-400', toggleBg: 'bg-purple-600' },
              ].map((item) => {
                const isActive = bikewaysFilter[item.key] !== false;
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => {
                      setBikewaysFilter(prev => ({
                        ...prev,
                        [item.key]: !isActive
                      }));
                    }}
                    className={`w-full flex items-center justify-between p-1.5 rounded border text-left transition-all ${
                      isActive 
                        ? `${item.bgActive} ${item.borderActive} shadow-xs` 
                        : 'bg-[#10141e]/50 border-[#262b38] opacity-45 hover:opacity-75'
                    }`}
                    title={isActive ? `點擊隱藏 ${item.label}` : `點擊顯示 ${item.label}`}
                  >
                    <div className="flex items-center gap-2">
                      <span 
                        className="w-5 h-1.5 rounded-full shrink-0 transition-all" 
                        style={{ 
                          backgroundColor: isActive ? item.color : '#4b5563',
                          boxShadow: isActive ? `0 0 6px ${item.color}B3` : 'none'
                        }} 
                      />
                      <span className={`text-[11px] font-medium transition-colors ${isActive ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                        {item.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9.5px] font-mono ${isActive ? item.tagColor : 'text-gray-600'}`}>
                        {item.tag}
                      </span>
                      <div className={`w-6 h-3.5 rounded-full transition-colors p-0.5 flex items-center ${
                        isActive ? item.toggleBg + ' justify-end' : 'bg-gray-700 justify-start'
                      }`}>
                        <span className="w-2.5 h-2.5 rounded-full bg-white shadow-xs" />
                      </div>
                    </div>
                  </button>
                );
              })}

              {Object.values(bikewaysFilter).some(v => v === false) && (
                <div className="flex items-center justify-between pt-1 border-t border-[#262b38] text-[10.5px]">
                  <span className="text-gray-400">已自訂篩選</span>
                  <button
                    type="button"
                    onClick={() => setBikewaysFilter({
                      'Protected Bike Lanes': true,
                      'Painted Lanes': true,
                      'Local Street': true,
                      'Shared Lanes': true,
                    })}
                    className="text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    重設全部顯示
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <div className="flex items-center gap-1.5">
                {[
                  { key: 'Protected Bike Lanes', color: '#10b981', label: '受保護獨立道' },
                  { key: 'Painted Lanes', color: '#0ea5e9', label: '路面標線' },
                  { key: 'Local Street', color: '#f59e0b', label: '社區慢速街' },
                  { key: 'Shared Lanes', color: '#a855f7', label: '混合共用' },
                ].map(item => (
                  <span 
                    key={item.key}
                    className="w-3 h-1 rounded-full transition-colors"
                    style={{ backgroundColor: bikewaysFilter[item.key] !== false ? item.color : '#4b5563' }}
                    title={`${item.label} (${bikewaysFilter[item.key] !== false ? '已開啟' : '已關閉'})`}
                  />
                ))}
              </div>
              <button 
                onClick={() => setBikewaysLegendOpen(true)}
                className="text-[10px] text-emerald-400 hover:underline"
              >
                篩選/展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 路口安全相機圖例與篩選 (Intersection Safety Cameras Legend & Filter Popup) */}
      {layers.safetyCameras && (
        <div className={`fixed z-30 w-[260px] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3 shadow-2xl border border-rose-500/40 select-none animate-in fade-in duration-200 ${
          getFloatingPanelPos((layers.parkingMeters ? 1 : 0) + (layers.motorcycleParking ? 1 : 0) + (layers.fuel ? 1 : 0) + ((layers.evCharging || layers.tesla) ? 1 : 0) + (layers.carSharing ? 1 : 0) + (layers.bikeways ? 1 : 0))
        }`}>
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#262b38]">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-rose-500/20 text-rose-400">
                <span className="text-xs">🚨</span>
              </span>
              <div className="flex flex-col">
                <span className="font-bold text-xs text-white">安全相機篩選</span>
                <span className="text-[9.5px] text-gray-400">點擊項目可開關篩選</span>
              </div>
            </div>
            <button
              onClick={() => setSafetyCamerasLegendOpen(!safetyCamerasLegendOpen)}
              className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-[#252a38] transition-colors"
              title={safetyCamerasLegendOpen ? "收合" : "展開"}
            >
              {safetyCamerasLegendOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {safetyCamerasLegendOpen ? (
            <div className="flex flex-col gap-2 text-xs">
              {/* 闖紅燈 + 超速 (黑色) */}
              <button
                type="button"
                onClick={() => setSafetyCamerasFilter(prev => ({ ...prev, redLightSpeed: !prev.redLightSpeed }))}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                  safetyCamerasFilter.redLightSpeed
                    ? 'bg-slate-900/90 border-gray-600 shadow-[0_0_8px_rgba(255,255,255,0.08)]'
                    : 'bg-[#10141e]/50 border-[#262b38] opacity-45 hover:opacity-75'
                }`}
                title={safetyCamerasFilter.redLightSpeed ? "點擊隱藏此類型" : "點擊顯示此類型"}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-full shrink-0 border border-white transition-all ${
                    safetyCamerasFilter.redLightSpeed ? 'bg-black shadow-[0_0_6px_rgba(255,255,255,0.5)]' : 'bg-gray-600 border-gray-500'
                  }`} />
                  <span className={`font-bold text-xs ${safetyCamerasFilter.redLightSpeed ? 'text-white' : 'text-gray-400 line-through'}`}>
                    闖紅燈 + 超速
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    safetyCamerasFilter.redLightSpeed ? 'text-gray-200 bg-gray-800' : 'text-gray-500 bg-gray-800/40'
                  }`}>
                    雙向取締
                  </span>
                  <div className={`w-7 h-4 rounded-full transition-colors p-0.5 flex items-center ${
                    safetyCamerasFilter.redLightSpeed ? 'bg-rose-600 justify-end' : 'bg-gray-700 justify-start'
                  }`}>
                    <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                  </div>
                </div>
              </button>

              {/* 闖紅燈 (紅色) */}
              <button
                type="button"
                onClick={() => setSafetyCamerasFilter(prev => ({ ...prev, redLightOnly: !prev.redLightOnly }))}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                  safetyCamerasFilter.redLightOnly
                    ? 'bg-rose-950/40 border-rose-700/60 shadow-[0_0_8px_rgba(225,29,72,0.15)]'
                    : 'bg-[#10141e]/50 border-[#262b38] opacity-45 hover:opacity-75'
                }`}
                title={safetyCamerasFilter.redLightOnly ? "點擊隱藏此類型" : "點擊顯示此類型"}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-full shrink-0 border border-white transition-all ${
                    safetyCamerasFilter.redLightOnly ? 'bg-red-600 shadow-[0_0_8px_rgba(225,29,72,0.7)]' : 'bg-gray-600 border-gray-500'
                  }`} />
                  <span className={`font-bold text-xs ${safetyCamerasFilter.redLightOnly ? 'text-white' : 'text-gray-400 line-through'}`}>
                    闖紅燈
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    safetyCamerasFilter.redLightOnly ? 'text-rose-300 bg-rose-900/50' : 'text-gray-500 bg-gray-800/40'
                  }`}>
                    單項取締
                  </span>
                  <div className={`w-7 h-4 rounded-full transition-colors p-0.5 flex items-center ${
                    safetyCamerasFilter.redLightOnly ? 'bg-rose-600 justify-end' : 'bg-gray-700 justify-start'
                  }`}>
                    <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                  </div>
                </div>
              </button>

              {(!safetyCamerasFilter.redLightSpeed || !safetyCamerasFilter.redLightOnly) && (
                <div className="pt-1 flex justify-end">
                  <button
                    onClick={() => setSafetyCamerasFilter({ redLightSpeed: true, redLightOnly: true })}
                    className="text-[10px] text-rose-400 hover:text-rose-300 underline"
                  >
                    重設全部顯示
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-gray-300">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full border border-white ${safetyCamerasFilter.redLightSpeed ? 'bg-black' : 'bg-gray-600'}`} />
                <span className={`w-2.5 h-2.5 rounded-full border border-white ${safetyCamerasFilter.redLightOnly ? 'bg-red-600' : 'bg-gray-600'}`} />
                <span className="text-gray-400 text-[10px]">
                  {safetyCamerasFilter.redLightSpeed && safetyCamerasFilter.redLightOnly ? '全部顯示' : '已自訂篩選'}
                </span>
              </div>
              <button 
                onClick={() => setSafetyCamerasLegendOpen(true)}
                className="text-[10px] text-rose-400 hover:underline"
              >
                展開
              </button>
            </div>
          )}
        </div>
      )}

      {/* 降水雷達地圖即時狀態 HUD (Floating Radar HUD) */}
      {isRadarActive && radarTilePath && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-30 bg-[#12151e]/90 backdrop-blur-md px-4 py-2 rounded-full border border-cyan-500/50 shadow-2xl flex items-center gap-3 select-none text-xs text-white animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>🌧️ 即時降水雷達回波</span>
          </div>
          {radarFrameTime ? (
            <span className="font-mono text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
              {new Date(radarFrameTime * 1000).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Vancouver' })} PDT
            </span>
          ) : null}
          <button
            onClick={() => {
              const map = mapRef.current?.getMap();
              if (map) {
                map.flyTo({ center: [-123.12, 49.25], zoom: 7, duration: 800, essential: true });
              }
            }}
            className="text-cyan-400 hover:text-white px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40 text-[10.5px] font-medium flex items-center gap-1 hover:bg-cyan-900/60 transition-colors"
            title="自動縮放至雷達全域視角"
          >
            <span>縮放至最佳視野</span>
          </button>
          <button
            onClick={() => setIsRadarActive(false)}
            className="text-gray-400 hover:text-white p-0.5 rounded-full hover:bg-white/10 transition-colors ml-1"
            title="關閉雷達疊加"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 周邊半徑探索面板 (Nearby Radius Exploration Floating Card) */}
      {radiusExploration?.active && (
        <div className="fixed top-[72px] left-4 md:left-[256px] z-30 w-[330px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-cyan-500/50 flex flex-col max-h-[calc(100vh-100px)] animate-in fade-in duration-200 select-none">
          <div className="flex items-start justify-between pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                <Compass className="w-4 h-4 animate-spin-slow" />
              </div>
              <div>
                <h4 className="font-bold text-white text-xs">周邊半徑探索 (Nearby)</h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-gray-400 font-mono truncate max-w-[130px]">
                    {radiusExploration.lat.toFixed(5)}, {radiusExploration.lon.toFixed(5)}
                  </span>
                  <button
                    onClick={() => copyCoordinatesToClipboard(radiusExploration.lat, radiusExploration.lon)}
                    className="p-0.5 rounded text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/20 transition-colors"
                    title="複製中心點坐標"
                  >
                    <Copy className="w-3 h-3 text-cyan-400" />
                  </button>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${radiusExploration.lat},${radiusExploration.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-0.5 rounded text-gray-400 hover:text-white hover:bg-blue-500/20 hover:text-blue-400 transition-colors"
                    title="Google Map 導航至中心點"
                  >
                    <Navigation className="w-3 h-3 text-blue-400" />
                  </a>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setRadiusExploration(null);
                setExplorationSelectedFacility(null);
              }}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#252a38] transition-colors shrink-0"
              title="關閉探索"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 半徑切換器 */}
          <div className="flex items-center gap-1.5 pb-2.5 mb-2.5 border-b border-[#262b38] shrink-0">
            {[
              { label: '300m (步行3分)', radius: 300 },
              { label: '500m (步行5分)', radius: 500 },
              { label: '1000m (步行12分)', radius: 1000 }
            ].map(r => (
              <button
                key={r.radius}
                onClick={() => setRadiusExploration({ ...radiusExploration, radiusM: r.radius })}
                className={`flex-1 py-1 px-1.5 text-[10.5px] rounded font-medium transition-all ${
                  (radiusExploration.radiusM || 500) === r.radius
                    ? 'bg-cyan-500 text-gray-950 font-bold shadow-sm'
                    : 'bg-[#1e2330] text-gray-300 hover:bg-[#282f40]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* 設施清單 Header */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 pb-2 mb-2 shrink-0">
            <span>設施清單</span>
            <span className="text-cyan-400 font-mono font-bold">
              {loadingNearby ? '搜尋中...' : `共 ${nearbyFacilities.length} 筆`}
            </span>
          </div>

          {/* 設施清單內容 */}
          <div className="overflow-y-auto flex-1 flex flex-col gap-1.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
            {loadingNearby ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                <span>搜尋半徑內設施中...</span>
              </div>
            ) : nearbyFacilities.length > 0 ? (
              nearbyFacilities.map((fac, idx) => {
                const distM = fac.distance_meters ?? fac.distance_m ?? 0;
                let mins = fac.walking_minutes ?? fac.walk_minutes;
                if (mins === undefined || mins === null || isNaN(mins)) {
                  mins = distM <= 50 ? 0.5 : Math.max(1, Math.round(distM / 80));
                }
                const isSelected = String(explorationSelectedFacility?.id) === String(fac.id);
                return (
                  <div
                    key={`nearby-${idx}`}
                    onClick={() => {
                      setExplorationSelectedFacility(fac);
                      const map = mapRef.current?.getMap();
                      map?.flyTo({ center: [fac.lon, fac.lat], zoom: 16.5, duration: 400 });
                      if (fac.facility_type === 'skytrain_stations' || fac.facility_type === 'skytrain_station') {
                        setSelectedFacility(null);
                        setSelectedStop(null);
                        fetchSkytrainStationSchedule(String(fac.id), fac.name, fac.lon, fac.lat);
                      } else if (fac.facility_type === 'bus_stops' || fac.facility_type === 'bus_stop') {
                        setSelectedFacility(null);
                        setSelectedSkytrainStation(null);
                        setSelectedStop({
                          id: String(fac.id),
                          name: fac.name,
                          lon: Number(fac.lon),
                          lat: Number(fac.lat)
                        });
                        fetchArrivals(String(fac.id));
                      } else {
                        setSelectedStop(null);
                        setSelectedSkytrainStation(null);
                        setSelectedFacility({
                          id: fac.id,
                          facility_type: fac.facility_type,
                          name: fac.name,
                          local_area: fac.local_area,
                          lon: Number(fac.lon),
                          lat: Number(fac.lat),
                          properties: fac.properties || {}
                        });
                      }
                    }}
                    className={`p-2 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 border ${
                      isSelected
                        ? 'bg-[#182638] border-cyan-400 ring-1 ring-cyan-400/50 shadow-md'
                        : 'bg-[#10131a] hover:bg-[#1c2230] border-[#232836] hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm shrink-0">
                        {fac.icon || (
                         fac.facility_type === 'aed' ? '⚡' :
                         fac.facility_type === 'public_washrooms' ? '🚻' :
                         fac.facility_type === 'bike_racks' ? '🚲' :
                         fac.facility_type === 'shared_bikes' ? '🚲' :
                         fac.facility_type === 'litter_containers' ? '🗑️' :
                         fac.facility_type === 'parking_meters' ? '🅿️' :
                         (fac.facility_type === 'skytrain_stations' || fac.facility_type === 'skytrain_station') ? '🚉' :
                         (fac.facility_type === 'bus_stops' || fac.facility_type === 'bus_stop') ? '🚏' :
                         fac.facility_type === 'food_banks' ? '🥫' :
                         fac.facility_type === 'drinking_fountains' ? '🚰' :
                         fac.facility_type === 'hospitals' ? '🏥' :
                         fac.facility_type === 'schools' ? '🏫' :
                         fac.facility_type === 'libraries' ? '📚' :
                         fac.facility_type === 'fuel' ? '⛽' :
                         fac.facility_type === 'van_wifi' ? '📶' :
                         fac.facility_type === 'tide_stations' ? '🌊' :
                         fac.facility_type === 'traffic_crosswalks' ? '🚶' : '📍')}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-white truncate max-w-[170px]">
                          {fac.name}
                        </div>
                        <div className="text-[10px] text-gray-400 capitalize">
                          {fac.type_label || fac.category || fac.facility_type.replace(/_/g, ' ')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-cyan-400 font-mono">
                        {distM}m
                      </div>
                      <div className="text-[9.5px] text-gray-400">
                        約 {mins} 分鐘
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs text-gray-400 bg-[#10131a] rounded-lg border border-[#232836] p-3 flex flex-col gap-1">
                <span>範圍內未發現設施</span>
                <span className="text-[10.5px] text-gray-500">請嘗試切換上方較大的搜尋半徑 (500m 或 1000m)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 點選天車站點時展示之路線班次與綜合資訊面板 */}
      {selectedSkytrainStation && (
        <div className="fixed top-[72px] right-4 z-40 w-[360px] max-w-[calc(100vw-32px)] bg-[#161922]/95 backdrop-blur-md text-gray-100 rounded-xl p-3.5 shadow-2xl border border-[#2a2f3d] flex flex-col max-h-[calc(100vh-90px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
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
                  <span className="text-[9.5px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    {selectedSkytrainStation.fare_zone?.startsWith('Zone')
                      ? selectedSkytrainStation.fare_zone
                      : `Zone ${selectedSkytrainStation.fare_zone || 1}`}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">#{selectedSkytrainStation.stop_id}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0">
              {/* 複製車站坐標按鈕 */}
              <button
                onClick={() => copyCoordinatesToClipboard(selectedSkytrainStation.lat, selectedSkytrainStation.lon)}
                className="text-gray-400 hover:text-cyan-300 p-1.5 rounded-lg hover:bg-cyan-500/20 transition-colors"
                title="複製車站坐標"
              >
                <Copy className="w-4 h-4 text-cyan-400" />
              </button>

              {/* Google 導航按鈕 (跟隨其他圖層一致) */}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedSkytrainStation.lat},${selectedSkytrainStation.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-blue-500/20 hover:text-blue-400 transition-colors"
                title="Google Map 導航至此"
              >
                <Navigation className="w-4 h-4 text-blue-400" />
              </a>

              <button
                onClick={() => setSelectedSkytrainStation(null)}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#252a38] transition-colors"
                title="關閉"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 導覽頁籤 (Tabs) */}
          <div className="flex border-b border-[#262b38] mb-2.5 shrink-0 text-xs">
            <button
              onClick={() => setSkytrainDetailTab('departures')}
              className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-all ${
                skytrainDetailTab === 'departures'
                  ? 'border-blue-400 text-blue-400 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              即時班次
            </button>
            <button
              onClick={() => setSkytrainDetailTab('schedules')}
              className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-all ${
                skytrainDetailTab === 'schedules'
                  ? 'border-blue-400 text-blue-400 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              首末班與頻率
            </button>
            <button
              onClick={() => setSkytrainDetailTab('facilities')}
              className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-all ${
                skytrainDetailTab === 'facilities'
                  ? 'border-blue-400 text-blue-400 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              設施與地圖
            </button>
          </div>

          {/* Tab 1: 即時推算班次 */}
          {skytrainDetailTab === 'departures' && (
            <>
              <div className="flex items-center justify-between text-[11px] text-gray-400 pb-2 mb-2 border-b border-[#262b38]/60 shrink-0">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                  <span>即時推算時刻</span>
                </span>
                <span className="font-mono text-[10px] text-gray-400">
                  更新於 {formatTimePreference(selectedSkytrainStation.updated_at, timeFormat)}
                </span>
              </div>

              <div className="overflow-y-auto flex-1 flex flex-col gap-2.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
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
            </>
          )}

          {/* Tab 2: 首尾班車與發車頻率 */}
          {skytrainDetailTab === 'schedules' && (
            <div className="overflow-y-auto flex-1 flex flex-col gap-3 pr-1 text-xs [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
              {/* 首末班車時刻卡片 */}
              <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-blue-400 font-bold">
                  <Clock className="w-3.5 h-3.5" />
                  <span>首班車 / 尾班車時刻</span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex flex-col gap-1.5">
                    <span className="text-gray-300 font-semibold border-b border-[#292f3f] pb-1 text-xs">平日</span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>首班車
                      </span>
                      <span className="font-mono text-emerald-300 font-medium text-[10.5px] leading-snug pl-2.5 break-words">
                        {selectedSkytrainStation.first_last?.weekday?.first_train || selectedSkytrainStation.first_last?.weekday?.first || '05:08'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-[#232836]">
                      <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>尾班車
                      </span>
                      <span className="font-mono text-amber-300 font-medium text-[10.5px] leading-snug pl-2.5 break-words">
                        {selectedSkytrainStation.first_last?.weekday?.last_train || selectedSkytrainStation.first_last?.weekday?.last || '01:15'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex flex-col gap-1.5">
                    <span className="text-gray-300 font-semibold border-b border-[#292f3f] pb-1 text-xs">週六</span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>首班車
                      </span>
                      <span className="font-mono text-emerald-300 font-medium text-[10.5px] leading-snug break-words">
                        {selectedSkytrainStation.first_last?.saturday?.first_train || selectedSkytrainStation.first_last?.saturday?.first || '06:08'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-[#232836]">
                      <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>尾班車
                      </span>
                      <span className="font-mono text-amber-300 font-medium text-[10.5px] leading-snug break-words">
                        {selectedSkytrainStation.first_last?.saturday?.last_train || selectedSkytrainStation.first_last?.saturday?.last || '01:15'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex flex-col gap-1.5">
                    <span className="text-gray-300 font-semibold border-b border-[#292f3f] pb-1 text-xs">週日 / 假日</span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>首班車
                      </span>
                      <span className="font-mono text-emerald-300 font-medium text-[10.5px] leading-snug break-words">
                        {selectedSkytrainStation.first_last?.sunday_holiday?.first_train || selectedSkytrainStation.first_last?.sunday_holiday?.first || '07:08'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-[#232836]">
                      <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>尾班車
                      </span>
                      <span className="font-mono text-amber-300 font-medium text-[10.5px] leading-snug break-words">
                        {selectedSkytrainStation.first_last?.sunday_holiday?.last_train || selectedSkytrainStation.first_last?.sunday_holiday?.last || '00:15'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 列車發車頻率 */}
              <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-blue-400 font-bold">
                  <Train className="w-3.5 h-3.5" />
                  <span>列車發車班距頻率</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex items-center justify-between">
                    <span className="text-gray-400">尖峰時段</span>
                    <span className="font-bold text-white font-mono">{selectedSkytrainStation.frequencies?.peak || '2 - 3.5 分鐘'}</span>
                  </div>
                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex items-center justify-between">
                    <span className="text-gray-400">日間離峰</span>
                    <span className="font-bold text-white font-mono">{selectedSkytrainStation.frequencies?.midday || '3 - 6 分鐘'}</span>
                  </div>
                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex items-center justify-between">
                    <span className="text-gray-400">晚間時段</span>
                    <span className="font-bold text-white font-mono">{selectedSkytrainStation.frequencies?.evening || '6 - 8 分鐘'}</span>
                  </div>
                  <div className="bg-[#181d28] p-2 rounded border border-[#292f3f] flex items-center justify-between">
                    <span className="text-gray-400">深夜時段</span>
                    <span className="font-bold text-white font-mono">{selectedSkytrainStation.frequencies?.late_night || '10 - 15 分鐘'}</span>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 text-center">
                  * 實際班距視 TransLink 營運調度與尖峰客流有所變動
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: 車站出入口地圖與設施指引 */}
          {skytrainDetailTab === 'facilities' && (
            <div className="overflow-y-auto flex-1 flex flex-col gap-2.5 pr-1 text-xs [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#2e3446] [&::-webkit-scrollbar-thumb]:rounded-full">
              {/* TransLink 官方車站出入口地圖 */}
              <a
                href={selectedSkytrainStation.station_map_url || selectedSkytrainStation.entrance_map_url || "https://www.translink.ca/schedules-and-maps/skytrain"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-2.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 hover:text-white text-xs font-medium transition-all group shadow-sm"
                title="開啟 TransLink 官方車站出入口與立體平面圖 PDF"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ExternalLink className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-white truncate">TransLink 官方出入口地圖</span>
                    <span className="text-[10px] text-blue-300/80">各出入口街道位置、月台層與轉乘動線</span>
                  </div>
                </div>
                <span className="text-[10px] bg-blue-500/30 text-blue-200 px-2 py-0.5 rounded font-mono shrink-0 ml-1">PDF 官網</span>
              </a>

              {/* TransLink 無障礙電梯地圖 */}
              {selectedSkytrainStation.entrance_map_url && selectedSkytrainStation.entrance_map_url !== selectedSkytrainStation.station_map_url && (
                <a
                  href={selectedSkytrainStation.entrance_map_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-medium transition-all group shadow-sm"
                  title="開啟 TransLink 無障礙電梯與輪椅出入口平面圖 PDF"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ExternalLink className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-white truncate">TransLink 無障礙電梯與出入口地圖</span>
                      <span className="text-[10px] text-emerald-300/80">無障礙電梯位置、無障礙閘門與地面連通道</span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded font-mono shrink-0 ml-1">無障礙 PDF</span>
                </a>
              )}

              {/* 車站設施清單 */}
              <div className="bg-[#10131a] rounded-lg border border-[#232836] p-2.5 flex flex-col gap-2">
                <span className="font-bold text-white text-xs">車站服務與設施</span>

                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex items-center justify-between py-1 border-b border-[#262b38]/60">
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <span>♿</span> 無障礙設施
                    </span>
                    <span className="text-emerald-400 font-medium">全線配置升降電梯 / 盲道</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-[#262b38]/60">
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <Bike className="w-3.5 h-3.5 text-teal-400" /> 單車停放庫
                    </span>
                    <span className={(selectedSkytrainStation.has_bike_parkade ?? selectedSkytrainStation.facilities?.bike_parkade) ? 'text-teal-400 font-medium' : 'text-gray-400'}>
                      {(selectedSkytrainStation.has_bike_parkade ?? selectedSkytrainStation.facilities?.bike_parkade) ? '提供室內單車庫' : '設有室外單車架'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-[#262b38]/60">
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5 text-amber-400" /> 轉乘停車場
                    </span>
                    <span className={(selectedSkytrainStation.has_park_and_ride ?? selectedSkytrainStation.facilities?.park_and_ride) ? 'text-amber-400 font-medium' : 'text-gray-400'}>
                      {(selectedSkytrainStation.has_park_and_ride ?? selectedSkytrainStation.facilities?.park_and_ride) ? '設有轉乘停車場' : '無專用轉乘停車場'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-[#262b38]/60">
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <span>💳</span> 票價與支付方式
                    </span>
                    <span className="text-blue-300">Compass / 信用卡感應</span>
                  </div>
                </div>
              </div>

              {/* 票價分區小知識 */}
              <div className="bg-blue-950/20 border border-blue-500/25 p-2 rounded-lg text-[10.5px] text-blue-200/90 flex flex-col gap-1">
                <span className="font-bold flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  大溫 TransLink 跨區票價提示
                </span>
                <span>
                  本站屬於 <strong className="text-blue-300">Zone {selectedSkytrainStation.fare_zone || 1}</strong>。平日晚上 6:30 之後以及週末假日全天，跨全網各區均統一按 1 區票價收費！
                </span>
              </div>
            </div>
          )}
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

      {/* 自訂地圖右鍵選單 (Custom Map Context Menu) */}
      {contextMenu && (
        <div 
          style={{ 
            left: `${Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250)}px`, 
            top: `${Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 260)}px` 
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 bg-[#11141d]/95 backdrop-blur-md border border-[#2b354a] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] p-1.5 flex flex-col gap-1 text-xs select-none animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header with Coordinates and Neighbourhood */}
          <div className="px-2.5 py-1.5 bg-[#181d2a] rounded-lg border border-[#242d40] flex flex-col gap-0.5">
            <div className="text-[11px] font-bold text-cyan-400 flex items-center gap-1 truncate">
              <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">{getNeighbourhood(contextMenu.lon, contextMenu.lat)}</span>
            </div>
            <div className="font-mono text-[10px] text-gray-400">
              {contextMenu.lat.toFixed(5)}°N, {Math.abs(contextMenu.lon).toFixed(5)}°W
            </div>
          </div>

          <div className="h-px bg-[#202738] my-0.5" />

          {/* Action 1: 導航至此 */}
          <button
            onClick={() => {
              window.open(`https://www.google.com/maps/dir/?api=1&destination=${contextMenu.lat},${contextMenu.lon}`, '_blank', 'noopener,noreferrer');
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-sky-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <Navigation className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-medium">導航至此</span>
          </button>

          {/* Action 2: 探索周邊半徑 */}
          <button
            onClick={() => {
              setRadiusExploration({
                active: true,
                lat: contextMenu.lat,
                lon: contextMenu.lon,
                radiusM: 500
              });
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-emerald-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-medium">探索此處周邊半徑</span>
          </button>

          {/* Action 3: 複製經緯度 */}
          <button
            onClick={() => {
              const text = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lon.toFixed(6)}`;
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(text);
              }
              setCopiedCoordsToast(true);
              setTimeout(() => setCopiedCoordsToast(false), 2200);
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-cyan-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <Copy className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="font-medium">複製經緯度</span>
          </button>

          {/* Action: 設成個人位置 */}
          <button
            onClick={() => {
              const lat = Math.round(contextMenu.lat * 1000000) / 1000000;
              const lon = Math.round(contextMenu.lon * 1000000) / 1000000;
              setUserLocation({
                address: `自訂位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
                displayName: `個人位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
                lat,
                lon,
                confirmed: true
              });
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-emerald-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-medium">設成個人位置</span>
          </button>

          {/* Action 3: 平移置中此處 */}
          <button
            onClick={() => {
              mapRef.current?.flyTo({
                center: [contextMenu.lon, contextMenu.lat],
                duration: 600,
                essential: true
              });
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-sky-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <Crosshair className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-medium">移至此處中心</span>
          </button>

          {/* Action 4: 回復預設縮放比 */}
          <button
            onClick={() => {
              mapRef.current?.flyTo({
                center: [-123.05, 49.25],
                zoom: 11,
                pitch: 0,
                bearing: 0,
                duration: 900,
                essential: true
              });
              setContextMenu(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-gray-200 hover:text-white hover:bg-amber-500/15 flex items-center gap-2 transition-colors text-left"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-medium">回復預設視角與縮放比</span>
          </button>

          {/* Action 5: 關閉周邊探索 (若當前開啟) */}
          {radiusExploration?.active && (
            <>
              <div className="h-px bg-[#202738] my-0.5" />
              <button
                onClick={() => {
                  setRadiusExploration(null);
                  setContextMenu(null);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg text-rose-300 hover:text-rose-100 hover:bg-rose-500/15 flex items-center gap-2 transition-colors text-left"
              >
                <X className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="font-medium">關閉周邊探索</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 複製經緯度成功 Toast 提示 */}
      {copiedCoordsToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#10141f]/95 border border-cyan-500/60 shadow-[0_8px_24px_rgba(6,182,212,0.3)] text-white px-4 py-2 rounded-full flex items-center gap-2 text-xs font-medium animate-in fade-in duration-200">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>已複製經緯度座標至剪貼簿！</span>
        </div>
      )}

      {/* 複製名稱成功 Toast 提示 */}
      {copiedFacilityToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#10141f]/95 border border-cyan-500/60 shadow-[0_8px_24px_rgba(6,182,212,0.3)] text-white px-4 py-2 rounded-full flex items-center gap-2 text-xs font-medium animate-in fade-in duration-200">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>已複製名稱至剪貼簿！</span>
        </div>
      )}

      {/* 交通攝影機圖片放大檢視 Modal (Webcam Image Lightbox) */}
      {enlargedCameraImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 pt-20 sm:pt-24 pb-6 animate-in fade-in duration-200"
          onClick={() => setEnlargedCameraImage(null)}
        >
          <div 
            className="relative max-w-4xl w-full bg-[#161922] border border-cyan-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[82vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1e2330] border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-base text-cyan-400">📷</span>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-bold text-gray-100 truncate">
                    {enlargedCameraImage.title}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-cyan-300 font-semibold">{enlargedCameraImage.direction}</span>
                    <span>·</span>
                    <span>即時路況影像</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={enlargedCameraImage.directSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-300 hover:bg-white/10 transition-colors flex items-center gap-1 text-xs"
                  title="於新分頁開啟原始圖片"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setEnlargedCameraImage(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="關閉 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body / Image */}
            <div className="p-3 sm:p-4 flex items-center justify-center bg-black/95 overflow-hidden flex-1 min-h-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enlargedCameraImage.src}
                alt={enlargedCameraImage.alt}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[58vh] sm:max-h-[60vh] object-contain rounded-lg shadow-2xl border border-white/10"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== enlargedCameraImage.directSrc) {
                    target.src = enlargedCameraImage.directSrc;
                  }
                }}
              />
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 bg-[#1a1e29] border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400 shrink-0">
              <span>點擊背景或右上角 ✕ 關閉</span>
              <span className="text-cyan-400 font-mono text-[10.5px]">HD 即時路況畫面</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
