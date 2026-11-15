import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface NearbyItem {
  id: string;
  name: string;
  facility_type: string;
  type_label: string;
  icon: string;
  layer_key: string;
  local_area: string;
  lat: number;
  lon: number;
  distance_m: number;
  distance_meters: number;
  walk_minutes: number;
  walking_minutes: number;
  properties: Record<string, any>;
}

interface IndexedFacility {
  id: string;
  name: string;
  facility_type: string;
  type_label: string;
  icon: string;
  layer_key: string;
  local_area: string;
  lat: number;
  lon: number;
  properties: Record<string, any>;
  search_text: string;
}

interface LayerSpec {
  file: string;
  facility_type: string;
  type_label: string;
  icon: string;
  layer_key: string;
  fallbackName: string;
}

const LAYER_SPECS: LayerSpec[] = [
  { file: 'vancouver_aed.geojson', facility_type: 'aed', type_label: 'AED 去顫器', icon: '❤️', layer_key: 'aed', fallbackName: 'AED 去顫器' },
  { file: 'vancouver_public_washrooms.geojson', facility_type: 'public_washrooms', type_label: '公共洗手間', icon: '🚻', layer_key: 'publicWashrooms', fallbackName: '公共洗手間' },
  { file: 'vancouver_drinking_fountains.geojson', facility_type: 'drinking_fountains', type_label: '飲水機', icon: '💧', layer_key: 'drinkingFountains', fallbackName: '飲水機' },
  { file: 'vancouver_shared_bikes.geojson', facility_type: 'shared_bikes', type_label: '共享單車', icon: '🚲', layer_key: 'sharedBikes', fallbackName: 'Mobi 共享單車站' },
  { file: 'vancouver_bike_racks.geojson', facility_type: 'bike_racks', type_label: '單車架', icon: '🚲', layer_key: 'bikeRacks', fallbackName: '公共單車架' },
  { file: 'vancouver_parking_meters.geojson', facility_type: 'parking_meters', type_label: '停車收費錶', icon: '🅿️', layer_key: 'parkingMeters', fallbackName: '路邊停車收費錶' },
  { file: 'vancouver_accessible_parking.geojson', facility_type: 'accessible_parking', type_label: '無障礙車位', icon: '♿', layer_key: 'accessibleParking', fallbackName: '無障礙車位' },
  { file: 'vancouver_motorcycle_parking.geojson', facility_type: 'motorcycle_parking', type_label: '摩托車位', icon: '🏍️', layer_key: 'motorcycleParking', fallbackName: '摩托車專用位' },
  { file: 'vancouver_impark.geojson', facility_type: 'impark', type_label: '私人停車場', icon: '🅿️', layer_key: 'impark', fallbackName: '私人停車場' },
  { file: 'vancouver_ev_charging.geojson', facility_type: 'ev_charging', type_label: 'EV 充電站', icon: '⚡', layer_key: 'evCharging', fallbackName: 'EV 充電站' },
  { file: 'vancouver_tesla.geojson', facility_type: 'ev_charging', type_label: 'EV 充電站', icon: '⚡', layer_key: 'evCharging', fallbackName: 'Tesla 充電站' },
  { file: 'vancouver_fuel.geojson', facility_type: 'fuel', type_label: '油站', icon: '⛽', layer_key: 'fuel', fallbackName: '加油站' },
  { file: 'vancouver_car_sharing.geojson', facility_type: 'car_sharing', type_label: '共享汽車', icon: '🚗', layer_key: 'carSharing', fallbackName: '共享汽車據點' },
  { file: 'vancouver_community_centres.geojson', facility_type: 'community_centres', type_label: '社區中心', icon: '🏢', layer_key: 'communityCentres', fallbackName: '社區中心' },
  { file: 'vancouver_libraries.geojson', facility_type: 'libraries', type_label: '圖書館', icon: '📚', layer_key: 'libraries', fallbackName: '公共圖書館' },
  { file: 'vancouver_schools.geojson', facility_type: 'schools', type_label: '學校', icon: '🏫', layer_key: 'schools', fallbackName: '學校' },
  { file: 'vancouver_food_banks.geojson', facility_type: 'food_banks', type_label: '食物銀行', icon: '🥫', layer_key: 'foodBanks', fallbackName: '食物銀行' },
  { file: 'vancouver_food_vendors.geojson', facility_type: 'food_vendors', type_label: '街頭餐飲', icon: '🍔', layer_key: 'foodVendors', fallbackName: '街頭餐飲攤位' },
  { file: 'vancouver_recycling.geojson', facility_type: 'recycling', type_label: '環保回收站', icon: '♻️', layer_key: 'recycling', fallbackName: '環保回收站' },
  { file: 'vancouver_homeless_shelters.geojson', facility_type: 'homeless_shelters', type_label: '無家者庇護所', icon: '🏠', layer_key: 'homelessShelters', fallbackName: '無家者庇護所' },
  { file: 'vancouver_parks.geojson', facility_type: 'parks', type_label: '公園綠地', icon: '🌳', layer_key: 'parks', fallbackName: '公園綠地' },
  { file: 'vancouver_hospitals.geojson', facility_type: 'hospitals', type_label: '醫療院所', icon: '🏥', layer_key: 'hospitals', fallbackName: '醫療院所' },
  { file: 'vancouver_police.geojson', facility_type: 'police', type_label: '警局', icon: '🚓', layer_key: 'police', fallbackName: '警察局' },
  { file: 'vancouver_fire_halls.geojson', facility_type: 'fire_halls', type_label: '消防局', icon: '🚒', layer_key: 'fireHalls', fallbackName: '消防局' },
  { file: 'vancouver_van_wifi.geojson', facility_type: 'van_wifi', type_label: 'VanWiFi 免費無線網路', icon: '📶', layer_key: 'vanWifi', fallbackName: 'VanWiFi 熱點' },
  { file: 'vancouver_beach_water.geojson', facility_type: 'beach_water_quality', type_label: '海灘水質', icon: '🏖️', layer_key: 'beachWaterQuality', fallbackName: '海灘監測點' },
  { file: 'vancouver_wildfire.geojson', facility_type: 'wildfire', type_label: '山火', icon: '🔥', layer_key: 'wildfire', fallbackName: '山火事件' },
  { file: 'vancouver_banks.geojson', facility_type: 'banks', type_label: '銀行', icon: '🏦', layer_key: 'banks', fallbackName: '銀行分行' },
  { file: 'vancouver_canada_post.geojson', facility_type: 'canada_post', type_label: '加拿大郵政', icon: '📮', layer_key: 'canadaPost', fallbackName: '郵政信箱 / 郵局' },
  { file: 'vancouver_museums.geojson', facility_type: 'museums', type_label: '博物館', icon: '🏛️', layer_key: 'museums', fallbackName: '博物館 / 藝文場所' },
  { file: 'vancouver_road_closures.geojson', facility_type: 'road_closures', type_label: '交通封閉', icon: '🚫', layer_key: 'roadClosures', fallbackName: '道路封閉' },
  { file: 'vancouver_road_construction.geojson', facility_type: 'road_construction', type_label: '道路施工', icon: '🚧', layer_key: 'roadConstruction', fallbackName: '道路施工' },
];

let cachedFacilities: IndexedFacility[] | null = null;

function extractPointCoords(geometry: any): [number, number] | null {
  if (!geometry || !geometry.coordinates) return null;
  const { type, coordinates } = geometry;
  if (type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2) {
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }
  if (type === 'MultiPoint' && Array.isArray(coordinates) && coordinates.length > 0) {
    const pt = coordinates[0];
    if (Array.isArray(pt) && pt.length >= 2) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    }
  }
  if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length > 0) {
    const mid = coordinates[Math.floor(coordinates.length / 2)];
    if (Array.isArray(mid) && mid.length >= 2) {
      const lon = Number(mid[0]);
      const lat = Number(mid[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    }
  }
  if (type === 'Polygon' && Array.isArray(coordinates) && Array.isArray(coordinates[0]) && coordinates[0].length > 0) {
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;
    for (const pt of coordinates[0]) {
      if (Array.isArray(pt) && pt.length >= 2) {
        sumLon += Number(pt[0]);
        sumLat += Number(pt[1]);
        count += 1;
      }
    }
    if (count > 0) {
      const lat = sumLat / count;
      const lon = sumLon / count;
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    }
  }
  if (
    type === 'MultiPolygon' &&
    Array.isArray(coordinates) &&
    Array.isArray(coordinates[0]) &&
    Array.isArray(coordinates[0][0]) &&
    coordinates[0][0].length > 0
  ) {
    const pt = coordinates[0][0][0];
    if (Array.isArray(pt) && pt.length >= 2) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    }
  }
  return null;
}

function resolveFeatureName(props: Record<string, any>, spec: LayerSpec): string {
  const candidates = [
    props.name,
    props.facility_name,
    props.site_name,
    props.station_name,
    props.park_name,
    props.address,
    props.address1,
    props.location,
    props.street,
    props.meterid ? `停車錶 #${props.meterid}` : null,
    props.meter_id ? `停車錶 #${props.meter_id}` : null,
    props.lot_number ? `${props.company === 'easypark' ? 'EasyPark' : 'ImPark'} #${props.lot_number}` : null,
    props.title,
    props.brand,
  ];
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim()) {
      return cand.trim();
    }
  }
  return spec.fallbackName;
}

function buildSearchText(parts: Array<unknown>): string {
  return parts
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((v) => String(v).trim().toLowerCase())
    .join(' ');
}

function buildLocalIndex(): IndexedFacility[] {
  if (cachedFacilities) return cachedFacilities;

  const items: IndexedFacility[] = [];
  const publicDir = path.join(process.cwd(), 'public');
  const backendDataDir = path.join(process.cwd(), '..', 'backend', 'data');

  for (const spec of LAYER_SPECS) {
    const candidatePaths = [path.join(publicDir, spec.file), path.join(backendDataDir, spec.file)];
    const targetPath = candidatePaths.find((p) => fs.existsSync(p));
    if (!targetPath) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      const features = Array.isArray(raw?.features) ? raw.features : [];
      features.forEach((feat: any, idx: number) => {
        const coords = extractPointCoords(feat?.geometry);
        if (!coords) return;
        const props = (feat?.properties && typeof feat.properties === 'object' ? feat.properties : {}) as Record<string, any>;
        const fid = String(props.id ?? feat.id ?? `${spec.facility_type}_${idx}`);
        const localArea = String(props.local_area || props.geo_local_area || props.localarea || props.city || '');
        const resolvedName = resolveFeatureName(props, spec);
        items.push({
          id: fid,
          name: resolvedName,
          facility_type: spec.facility_type,
          type_label: spec.type_label,
          icon: spec.icon,
          layer_key: spec.layer_key,
          local_area: localArea,
          lat: coords[0],
          lon: coords[1],
          properties: props,
          search_text: buildSearchText([
            resolvedName,
            spec.type_label,
            spec.facility_type.replace(/_/g, ' '),
            localArea,
            props.address,
            props.address1,
            props.street,
            props.location,
            props.operator,
            props.brand,
            props.lot_number,
          ]),
        });
      });
    } catch {
      // Skip malformed local dataset cleanly
    }
  }

  // Include SkyTrain stations from src/data/skytrainStations.json
  const skytrainCandidates = [
    path.join(process.cwd(), 'src', 'data', 'skytrainStations.json'),
    path.join(backendDataDir, 'skytrain_network.json'),
  ];
  const stPath = skytrainCandidates.find((p) => fs.existsSync(p));
  if (stPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(stPath, 'utf8'));
      const stationsObj = raw?.stations && typeof raw.stations === 'object' ? raw.stations : raw;
      if (stationsObj && typeof stationsObj === 'object') {
        for (const [key, val] of Object.entries<any>(stationsObj)) {
          const lat = Number(val?.lat);
          const lon = Number(val?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const stName = String(val?.displayName || val?.name || key);
          items.push({
            id: String(val?.stop_id || key),
            name: stName,
            facility_type: 'skytrain_stations',
            type_label: '天車站',
            icon: '🚉',
            layer_key: 'skytrainStops',
            local_area: '',
            lat,
            lon,
            properties: { stop_id: String(val?.stop_id || key), lines: val?.lines || [] },
            search_text: buildSearchText([stName, '天車站', 'skytrain', key, ...(Array.isArray(val?.lines) ? val.lines : [])]),
          });
        }
      }
    } catch {
      // Skip cleanly
    }
  }

  cachedFacilities = items;
  return items;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calcWalkMinutes(distM: number): number {
  const mins = distM / 80.0;
  if (mins <= 0.6) return 0.5;
  if (mins <= 1.2) return 1.0;
  return Math.round(mins * 2) / 2;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const rawRadius = Number(searchParams.get('radius') ?? 500);
  const pageParam = searchParams.get('page');
  const pageSizeParam = searchParams.get('page_size');
  const limitParam = searchParams.get('limit');
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const layers = searchParams.get('layers');

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Invalid lat/lon parameters', center: { lat: 0, lon: 0 }, radius_m: 500, total: 0, page: 1, page_size: 50, total_pages: 1, items: [] }, { status: 400 });
  }

  const radius = Math.min(5000, Math.max(50, Number.isFinite(rawRadius) ? rawRadius : 500));
  const backendBase = process.env.INTERNAL_BACKEND_URL || 'http://127.0.0.1:8000';

  // Try FastAPI backend first when reachable (includes full TransitStop SQLite DB + Live RoadFacility DB)
  try {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: String(radius),
      ...(pageParam !== null ? { page: pageParam } : {}),
      ...(pageSizeParam !== null ? { page_size: pageSizeParam } : {}),
      ...(limitParam !== null ? { limit: limitParam } : {}),
      ...(q ? { q: q.slice(0, 120) } : {}),
      ...(layers ? { layers: layers.slice(0, 2000) } : {}),
    });
    const beResp = await fetch(`${backendBase}/api/explore/nearby?${qs.toString()}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
      signal: AbortSignal.timeout(2500),
    });
    if (beResp.ok) {
      const json = await beResp.json();
      return NextResponse.json(json);
    }
  } catch {
    // Backend unavailable; fall back to local cached GeoJSON datasets
  }

  const selectedLayerKeys = layers ? new Set(layers.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const degDelta = (radius + 150) / 111000.0;
  const minLat = lat - degDelta;
  const maxLat = lat + degDelta;
  const minLon = lon - degDelta * 1.5;
  const maxLon = lon + degDelta * 1.5;

  const index = buildLocalIndex();
  const matched: NearbyItem[] = [];

  for (const item of index) {
    if (item.lat < minLat || item.lat > maxLat || item.lon < minLon || item.lon > maxLon) continue;
    if (selectedLayerKeys && !selectedLayerKeys.has(item.layer_key)) continue;
    if (q && !item.search_text.includes(q)) continue;
    const dist = haversineM(lat, lon, item.lat, item.lon);
    if (dist <= radius) {
      const walkMin = calcWalkMinutes(dist);
      const { search_text: _ignored, ...rest } = item;
      matched.push({
        ...rest,
        distance_m: dist,
        distance_meters: dist,
        walk_minutes: walkMin,
        walking_minutes: walkMin,
      });
    }
  }

  matched.sort((a, b) => a.distance_m - b.distance_m);

  const total = matched.length;
  let page = 1;
  let pageSize = total > 0 ? total : 50;
  let totalPages = 1;
  let pagedItems: NearbyItem[];

  if (pageParam !== null || pageSizeParam !== null) {
    const reqPage = Number(pageParam ?? 1);
    const reqSize = Number(pageSizeParam ?? 50);
    pageSize = Math.min(500, Math.max(10, Number.isFinite(reqSize) ? Math.round(reqSize) : 50));
    totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(totalPages, Math.max(1, Number.isFinite(reqPage) ? Math.round(reqPage) : 1));
    const start = (page - 1) * pageSize;
    pagedItems = matched.slice(start, start + pageSize);
  } else if (limitParam !== null) {
    const reqLimit = Number(limitParam);
    pageSize = Math.min(10000, Math.max(50, Number.isFinite(reqLimit) ? Math.round(reqLimit) : 1500));
    totalPages = Math.max(1, Math.ceil(total / pageSize));
    pagedItems = matched.slice(0, pageSize);
  } else {
    pagedItems = matched;
  }

  return NextResponse.json({
    center: { lat, lon },
    radius_m: radius,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    items: pagedItems,
  });
}
