'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Landmark,
  Search,
  X,
  ExternalLink,
  MapPin,
  Navigation,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Calendar,
  Building2,
  BookOpen,
  Info,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUIStore } from '@/store/useUIStore';
import { getApiUrl } from '@/utils/api';

interface ServiceCatalogItem {
  id: string;
  name: string;
  category: string;
  level: string;
  summary: string;
  url: string;
}

interface ProvinceServiceItem {
  id: string;
  topic: string;
  name: string;
  url: string;
  handledBy: string;
  detail?: string | null;
}

interface ProvinceCityItem {
  name: string;
  url: string;
  population?: number | null;
  places?: number | null;
}

interface ProvinceBodyItem {
  slug: string;
  name: string;
  url: string;
  website?: string | null;
}

interface BenefitPaymentItem {
  id?: string;
  name: string;
  where?: string;
  next?: string | null;
  dates?: string[];
  source?: string | null;
  checked?: string | null;
  note?: string | null;
  url?: string | null;
  service?: string | null;
}

interface ProvinceIndexItem {
  code: string;
  name: string;
  slug: string;
  default_city: string;
  serviceCount: number;
  bodyCount: number;
  lastReviewed?: string;
  url: string;
}

interface ProvinceDetail {
  code: string;
  name: string;
  slug: string;
  default_city: string;
  url: string;
  description: string;
  summary: string;
  lastReviewed?: string;
  bodyCount?: number;
  serviceCount?: number;
  services: ProvinceServiceItem[];
  paymentDates: BenefitPaymentItem[];
  cities: ProvinceCityItem[];
  bodies: ProvinceBodyItem[];
  facts: Array<{ label?: string; value: string }>;
}

interface OverviewPayload {
  status: string;
  source?: string;
  source_url?: string;
  disclaimer?: string;
  licence?: string;
  updated_at?: string;
  last_reviewed?: string;
  total_count?: number;
  categories: Array<{ id: string; name: string }>;
  services: ServiceCatalogItem[];
  provinces_index: ProvinceIndexItem[];
  province: ProvinceDetail | null;
  benefits: BenefitPaymentItem[];
}

interface PlaceResult {
  name: string;
  type?: string;
  address?: string | null;
  postal?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
  km?: number | null;
  website?: string | null;
  directions?: string | null;
  operator?: { id?: string; name?: string; url?: string } | string | null;
}

const PLACE_TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'service-canada-centres', label: 'Service Canada Centres' },
  { key: 'passport-offices', label: 'Passport Offices' },
  { key: 'provincial-service-centres', label: 'Provincial Service Centres' },
  { key: 'driver-and-vehicle-licensing-offices', label: 'Driver & Vehicle Licensing' },
  { key: 'courthouses', label: 'Courthouses' },
  { key: 'police-stations', label: 'Police Stations' },
  { key: 'rcmp-detachments', label: 'RCMP Detachments' },
  { key: 'fire-stations', label: 'Fire Stations' },
  { key: 'hospitals', label: 'Hospitals' },
  { key: 'clinics', label: 'Clinics' },
  { key: 'public-health-offices', label: 'Public Health Offices' },
  { key: 'mental-health-services', label: 'Mental Health Services' },
  { key: 'pharmacies', label: 'Pharmacies' },
  { key: 'labs-and-imaging', label: 'Labs & Imaging' },
  { key: 'libraries', label: 'Libraries' },
  { key: 'community-centres', label: 'Community Centres' },
  { key: 'schools', label: 'Schools' },
  { key: 'colleges', label: 'Colleges' },
  { key: 'universities', label: 'Universities' },
  { key: 'museums', label: 'Museums' },
  { key: 'parks', label: 'Parks' },
  { key: 'pools', label: 'Pools' },
  { key: 'arenas', label: 'Arenas' },
];

const FALLBACK_PROVINCES = [
  { code: 'bc', name: 'British Columbia' },
  { code: 'ab', name: 'Alberta' },
  { code: 'sk', name: 'Saskatchewan' },
  { code: 'mb', name: 'Manitoba' },
  { code: 'on', name: 'Ontario' },
  { code: 'qc', name: 'Quebec' },
  { code: 'nb', name: 'New Brunswick' },
  { code: 'ns', name: 'Nova Scotia' },
  { code: 'pe', name: 'Prince Edward Island' },
  { code: 'nl', name: 'Newfoundland and Labrador' },
  { code: 'yt', name: 'Yukon' },
  { code: 'nt', name: 'Northwest Territories' },
  { code: 'nu', name: 'Nunavut' },
];

/**
 * Safely convert any API value (string, number, array, or structured object like
 * { text, source, population, populationYear, wikidata }) into a safe display string
 * so React never throws "Objects are not valid as a React child".
 */
function toDisplayText(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map(toDisplayText).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const candidate =
      obj.text ??
      obj.value ??
      obj.name ??
      obj.label ??
      obj.title ??
      obj.summary ??
      obj.answer ??
      obj.description ??
      (obj.body && typeof obj.body === 'object' ? (obj.body as Record<string, unknown>).name : undefined);
    if (candidate != null && candidate !== val) {
      return toDisplayText(candidate);
    }
  }
  return '';
}

function extractBodyDescriptionMeta(desc: unknown): {
  text: string;
  population?: number;
  populationYear?: string | number;
  source?: string;
} {
  if (!desc) return { text: '' };
  if (typeof desc === 'string') return { text: desc };
  if (typeof desc === 'object') {
    const obj = desc as Record<string, unknown>;
    const text = toDisplayText(obj.text ?? obj.summary ?? obj.value ?? obj.description);
    const popRaw = obj.population;
    const population =
      typeof popRaw === 'number' && Number.isFinite(popRaw)
        ? popRaw
        : typeof popRaw === 'string' && /^\d+$/.test(popRaw)
          ? Number(popRaw)
          : undefined;
    const populationYear =
      typeof obj.populationYear === 'number' || typeof obj.populationYear === 'string'
        ? obj.populationYear
        : undefined;
    const source = typeof obj.source === 'string' && obj.source.startsWith('http') ? obj.source : undefined;
    return { text, population, populationYear, source };
  }
  return { text: toDisplayText(desc) };
}

async function fetchPublicServicesApi(pathWithQuery: string): Promise<any> {
  const apiUrl = getApiUrl();
  let res: Response | null = null;
  try {
    res = await fetch(`${apiUrl}/api/public-services/${pathWithQuery}`, { cache: 'no-store' });
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    res = await fetch(`/api/public-services/${pathWithQuery}`, { cache: 'no-store' });
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

const SERVICE_LEVEL_ZH: Record<string, string> = {
  federal: '聯邦',
  provincial: '省級',
  municipal: '市級',
  health: '醫療',
  school: '學區',
};

function formatServiceLevelZh(level?: string): string {
  const key = String(level || '').trim().toLowerCase();
  return SERVICE_LEVEL_ZH[key] || '公共';
}

export function PublicServicesTab() {
  const { setSearchTarget, adminSourceIntervals } = useUIStore();

  const [subTab, setSubTab] = useState<'services' | 'places' | 'benefits'>('services');
  const [provinceCode, setProvinceCode] = useState<string>('bc');
  const [nearCity, setNearCity] = useState<string>('Vancouver');

  // Overview monthly directory
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Sub-tab 1: Services
  const [serviceQuery, setServiceQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [servicePage, setServicePage] = useState<number>(1);
  const [servicePageInput, setServicePageInput] = useState<string>('1');
  const SERVICE_PAGE_SIZE = 15;

  const [findResult, setFindResult] = useState<any | null>(null);
  const [loadingFind, setLoadingFind] = useState<boolean>(false);
  const [findError, setFindError] = useState<string | null>(null);
  const findReqIdRef = useRef<number>(0);
  const servicesListRef = useRef<HTMLDivElement | null>(null);

  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [serviceDetailsCache, setServiceDetailsCache] = useState<Record<string, any>>({});
  const [loadingServiceDetailId, setLoadingServiceDetailId] = useState<string | null>(null);

  // Sub-tab 2: Nearby Places
  const [placeType, setPlaceType] = useState<string>('service-canada-centres');
  const [placesData, setPlacesData] = useState<{
    near?: any;
    type?: { key?: string; name?: string; plural?: string };
    count?: number;
    results: PlaceResult[];
    widenedToKm?: number | null;
    url?: string;
  } | null>(null);
  const [loadingPlaces, setLoadingPlaces] = useState<boolean>(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const placesReqIdRef = useRef<number>(0);

  // Sub-tab 3: Benefits & Bodies
  const [expandedBenefitIds, setExpandedBenefitIds] = useState<Record<string, boolean>>({});
  const [bodyQuery, setBodyQuery] = useState<string>('');
  const [bodySearchResults, setBodySearchResults] = useState<any[] | null>(null);
  const [loadingBodies, setLoadingBodies] = useState<boolean>(false);
  const bodyReqIdRef = useRef<number>(0);
  const [expandedBodyKey, setExpandedBodyKey] = useState<string | null>(null);
  const [bodyDetailsCache, setBodyDetailsCache] = useState<Record<string, any>>({});
  const [loadingBodyDetailKey, setLoadingBodyDetailKey] = useState<string | null>(null);

  // Load overview for selected province
  const loadOverview = useCallback(async (prov: string) => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data: OverviewPayload = await fetchPublicServicesApi(`overview?province=${encodeURIComponent(prov)}`);
      setOverview(data);
    } catch {
      try {
        const res = await fetch('/canada_public_services.json');
        if (res.ok) {
          const full = await res.json();
          const provObj = full.provinces?.[prov] || full.provinces?.bc || null;
          const provName = String(provObj?.name || '').toLowerCase();
          const matchingBenefits = (full.benefits || []).filter((b: any) => {
            const w = String(b.where || '').toLowerCase();
            return w === 'canada' || (provName && w === provName);
          });
          setOverview({
            status: 'ok',
            source: full.source,
            source_url: full.source_url,
            disclaimer: full.disclaimer,
            licence: full.licence,
            updated_at: full.updated_at,
            last_reviewed: full.last_reviewed,
            total_count: full.total_count,
            categories: full.categories || [],
            services: full.services || [],
            provinces_index: full.provinces_index || [],
            province: provObj,
            benefits: matchingBenefits,
          });
        } else {
          setOverviewError('無法載入加拿大公共服務目錄，請稍後重試。');
        }
      } catch {
        setOverviewError('無法載入加拿大公共服務目錄，請稍後重試。');
      }
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(provinceCode);
  }, [provinceCode, loadOverview]);

  const handleProvinceChange = (nextCode: string) => {
    setProvinceCode(nextCode);
    setExpandedServiceId(null);
    setFindResult(null);
    setFindError(null);
    setBodySearchResults(null);
    setExpandedBodyKey(null);
    setServicePage(1);
    setServicePageInput('1');
    const match = overview?.provinces_index?.find((p) => p.code === nextCode);
    if (match?.default_city) {
      setNearCity(match.default_city);
    }
  };

  // Merge provincial services (with handledBy) + full 140 service catalog
  const mergedServices = useMemo(() => {
    const provServices = overview?.province?.services || [];
    const catalog = overview?.services || [];
    const provById = new Map<string, ProvinceServiceItem>();
    for (const ps of provServices) {
      if (ps.id) provById.set(ps.id, ps);
    }
    const catNameById = new Map<string, string>();
    for (const c of overview?.categories || []) {
      catNameById.set(c.id, c.name);
    }
    const merged: Array<{
      id: string;
      name: string;
      categoryId: string;
      categoryName: string;
      level: string;
      summary: string;
      handledBy?: string;
      url: string;
      hasProvincePage: boolean;
    }> = [];
    const seen = new Set<string>();

    for (const item of catalog) {
      seen.add(item.id);
      const provMatch = provById.get(item.id);
      merged.push({
        id: item.id,
        name: toDisplayText(provMatch?.name || item.name),
        categoryId: item.category,
        categoryName: toDisplayText(provMatch?.topic || catNameById.get(item.category) || item.category),
        level: toDisplayText(item.level || (provMatch ? 'provincial' : 'federal')),
        summary: toDisplayText(item.summary),
        handledBy: provMatch?.handledBy ? toDisplayText(provMatch.handledBy) : undefined,
        url: provMatch?.url || item.url,
        hasProvincePage: Boolean(provMatch),
      });
    }
    for (const ps of provServices) {
      if (!ps.id || seen.has(ps.id)) continue;
      const topicStr = toDisplayText(ps.topic);
      const catEntry = (overview?.categories || []).find(
        (c) => c.name.toLowerCase() === topicStr.toLowerCase()
      );
      merged.push({
        id: ps.id,
        name: toDisplayText(ps.name),
        categoryId: catEntry?.id || topicStr.toLowerCase().replace(/\s+/g, '-'),
        categoryName: topicStr || 'General',
        level: 'provincial',
        summary: toDisplayText(ps.detail),
        handledBy: ps.handledBy ? toDisplayText(ps.handledBy) : undefined,
        url: ps.url,
        hasProvincePage: true,
      });
    }
    merged.sort((a, b) => {
      if (a.hasProvincePage !== b.hasProvincePage) return a.hasProvincePage ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return merged;
  }, [overview]);

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return mergedServices.filter((s) => {
      if (selectedCategory !== 'all' && s.categoryId !== selectedCategory && s.categoryName.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      if (selectedLevel !== 'all' && s.level.toLowerCase() !== selectedLevel) {
        return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        (s.handledBy || '').toLowerCase().includes(q) ||
        s.categoryName.toLowerCase().includes(q)
      );
    });
  }, [mergedServices, selectedCategory, selectedLevel, serviceQuery]);

  const totalServicePages = Math.max(1, Math.ceil(filteredServices.length / SERVICE_PAGE_SIZE));
  const paginatedServices = useMemo(() => {
    const start = (servicePage - 1) * SERVICE_PAGE_SIZE;
    return filteredServices.slice(start, start + SERVICE_PAGE_SIZE);
  }, [filteredServices, servicePage]);

  useEffect(() => {
    setServicePage(1);
    setServicePageInput('1');
  }, [selectedCategory, selectedLevel, serviceQuery, provinceCode]);

  const commitServicePage = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setServicePage(1);
      setServicePageInput('1');
      return;
    }
    const clamped = Math.min(totalServicePages, parsed);
    setServicePage(clamped);
    setServicePageInput(String(clamped));
  };

  // Smart /api/find live search (triggered automatically on typing via debounce)
  const runSmartFind = useCallback(async (qStr: string, cityStr: string) => {
    const qClean = qStr.trim();
    const reqId = ++findReqIdRef.current;
    if (qClean.length < 2) {
      setFindResult(null);
      setFindError(null);
      setLoadingFind(false);
      return;
    }
    setLoadingFind(true);
    setFindError(null);
    try {
      const data = await fetchPublicServicesApi(
        `find?q=${encodeURIComponent(qClean)}&near=${encodeURIComponent(cityStr.trim() || 'Vancouver')}`
      );
      if (reqId !== findReqIdRef.current) return;
      setFindResult(data);
    } catch {
      if (reqId !== findReqIdRef.current) return;
      setFindError('即時查詢暫時無法使用，以下仍顯示本地目錄篩選結果。');
    } finally {
      if (reqId === findReqIdRef.current) {
        setLoadingFind(false);
      }
    }
  }, []);

  // Auto-search Services via debounced /api/find as user types
  useEffect(() => {
    if (subTab !== 'services') return;
    const trimmed = serviceQuery.trim();
    if (trimmed.length < 2) {
      findReqIdRef.current++;
      setFindResult(null);
      setFindError(null);
      setLoadingFind(false);
      return;
    }
    const timer = setTimeout(() => {
      runSmartFind(trimmed, nearCity);
    }, 450);
    return () => clearTimeout(timer);
  }, [serviceQuery, nearCity, subTab, runSmartFind]);

  // Expand & lazy-load service details
  const toggleServiceDetail = async (serviceId: string) => {
    if (expandedServiceId === serviceId) {
      setExpandedServiceId(null);
      return;
    }
    setExpandedServiceId(serviceId);
    const cacheKey = `${serviceId}::${provinceCode}`;
    if (serviceDetailsCache[cacheKey]) return;
    setLoadingServiceDetailId(serviceId);
    try {
      const detail = await fetchPublicServicesApi(
        `service/${encodeURIComponent(serviceId)}?province=${encodeURIComponent(provinceCode)}`
      );
      setServiceDetailsCache((prev) => ({ ...prev, [cacheKey]: detail }));
    } catch {
      // Keep card summary visible even if detail fetch fails
    } finally {
      setLoadingServiceDetailId(null);
    }
  };

  // Load Nearby Places when places tab is active or city/type changes
  const loadPlaces = useCallback(async (city: string, typeKey: string) => {
    const reqId = ++placesReqIdRef.current;
    setLoadingPlaces(true);
    setPlacesError(null);
    try {
      const data = await fetchPublicServicesApi(
        `places?near=${encodeURIComponent(city.trim() || 'Vancouver')}&type=${encodeURIComponent(typeKey)}`
      );
      if (reqId !== placesReqIdRef.current) return;
      setPlacesData({
        near: data?.near,
        type: data?.type,
        count: data?.count,
        results: Array.isArray(data?.results) ? data.results : [],
        widenedToKm: data?.widenedToKm,
        url: data?.url,
      });
    } catch {
      if (reqId !== placesReqIdRef.current) return;
      setPlacesError('無法載入附近據點資料，請稍後重試。');
    } finally {
      if (reqId === placesReqIdRef.current) {
        setLoadingPlaces(false);
      }
    }
  }, []);

  const provinceCityOptions = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const c of overview?.province?.cities || []) {
      const n = toDisplayText(c.name).trim();
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        names.push(n);
      }
    }
    const defCity = toDisplayText(overview?.province?.default_city).trim();
    if (defCity && !seen.has(defCity.toLowerCase())) {
      seen.add(defCity.toLowerCase());
      names.unshift(defCity);
    }
    if (nearCity && !seen.has(nearCity.toLowerCase())) {
      names.unshift(nearCity);
    }
    return names.length > 0 ? names : ['Vancouver'];
  }, [overview, nearCity]);

  useEffect(() => {
    if (subTab === 'places') {
      loadPlaces(nearCity, placeType);
    }
  }, [subTab, nearCity, placeType, loadPlaces]);

  // Search public bodies (auto-search via debounce)
  const runBodySearch = useCallback(async (qStr: string, prov: string) => {
    const qClean = qStr.trim();
    const reqId = ++bodyReqIdRef.current;
    if (qClean.length < 2) {
      setBodySearchResults(null);
      setLoadingBodies(false);
      return;
    }
    setLoadingBodies(true);
    try {
      const data = await fetchPublicServicesApi(
        `bodies?q=${encodeURIComponent(qClean)}&province=${encodeURIComponent(prov)}`
      );
      if (reqId !== bodyReqIdRef.current) return;
      setBodySearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch {
      if (reqId !== bodyReqIdRef.current) return;
      setBodySearchResults(null);
    } finally {
      if (reqId === bodyReqIdRef.current) {
        setLoadingBodies(false);
      }
    }
  }, []);

  useEffect(() => {
    if (subTab !== 'benefits') return;
    const trimmed = bodyQuery.trim();
    if (trimmed.length < 2) {
      bodyReqIdRef.current++;
      setBodySearchResults(null);
      setLoadingBodies(false);
      return;
    }
    const timer = setTimeout(() => {
      runBodySearch(trimmed, provinceCode);
    }, 450);
    return () => clearTimeout(timer);
  }, [bodyQuery, provinceCode, subTab, runBodySearch]);

  const toggleBodyDetail = async (slugOrId: string) => {
    if (!slugOrId) return;
    if (expandedBodyKey === slugOrId) {
      setExpandedBodyKey(null);
      return;
    }
    setExpandedBodyKey(slugOrId);
    if (bodyDetailsCache[slugOrId]) return;
    setLoadingBodyDetailKey(slugOrId);
    try {
      const data = await fetchPublicServicesApi(`body/${encodeURIComponent(slugOrId)}`);
      setBodyDetailsCache((prev) => ({ ...prev, [slugOrId]: data }));
    } catch {
      // ignore transient error
    } finally {
      setLoadingBodyDetailKey(null);
    }
  };

  // Fly map to a place
  const handleLocatePlace = (place: PlaceResult) => {
    if (place.lat == null || place.lon == null || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
      return;
    }
    const operatorName = toDisplayText(place.operator);
    const placeName = toDisplayText(place.name);
    const placeTypeStr = toDisplayText(place.type) || 'Public Service';
    const addressStr = toDisplayText(place.address);
    const cityStr = toDisplayText(place.city) || nearCity;
    const postalStr = toDisplayText(place.postal);
    setSearchTarget({
      id: `pubsvc_${placeName}_${place.lat}_${place.lon}`,
      title: placeName,
      subtitle: [addressStr, cityStr, postalStr].filter(Boolean).join(', '),
      category: 'public_service_place',
      badge: placeTypeStr,
      icon: '🏛️',
      lon: place.lon,
      lat: place.lat,
      zoom: 15,
      meta: {
        facility_type: 'public_service_place',
        name: placeName,
        type: placeTypeStr,
        address: addressStr,
        postal: postalStr,
        city: cityStr,
        km: place.km,
        operator: operatorName,
        website: place.website || '',
        directions: place.directions || '',
        source_url: placesData?.url || overview?.province?.url || 'https://canadaservicemap.ca',
      },
    });
  };

  const activeSourceUrl =
    (subTab === 'places' && typeof placesData?.url === 'string' && placesData.url) ||
    (subTab === 'services' && typeof findResult?.url === 'string' && findResult.url) ||
    (typeof overview?.province?.url === 'string' && overview.province.url) ||
    (typeof overview?.source_url === 'string' && overview.source_url) ||
    'https://canadaservicemap.ca/provinces';

  const activeCheckedDate = toDisplayText(
    overview?.province?.lastReviewed || overview?.last_reviewed || ''
  );

  const combinedBenefits = useMemo(() => {
    const items: BenefitPaymentItem[] = [];
    const seen = new Set<string>();
    for (const b of overview?.benefits || []) {
      const nameStr = toDisplayText(b.name);
      const k = nameStr.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({
        ...b,
        name: nameStr,
        where: toDisplayText(b.where) || 'Canada',
        next: b.next ? toDisplayText(b.next) : null,
        note: b.note ? toDisplayText(b.note) : null,
      });
    }
    for (const p of overview?.province?.paymentDates || []) {
      const nameStr = toDisplayText(p.name);
      const k = nameStr.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({
        ...p,
        name: nameStr,
        where: toDisplayText(overview?.province?.name) || 'Provincial',
        next: p.next ? toDisplayText(p.next) : null,
        note: p.note ? toDisplayText(p.note) : null,
      });
    }
    items.sort((a, b) => (a.next || '9999-99-99').localeCompare(b.next || '9999-99-99'));
    return items;
  }, [overview]);

  const displayedBodies = useMemo(() => {
    const q = bodyQuery.trim().toLowerCase();
    if (bodySearchResults !== null && q.length >= 2) {
      return bodySearchResults.map((b: any) => ({
        slug: toDisplayText(b.slug || b.id),
        name: toDisplayText(b.name),
        url: typeof b.url === 'string' ? b.url : '',
        website: typeof b.website === 'string' ? b.website : null,
        kind: toDisplayText(b.kind || b.type),
      }));
    }
    const base = (overview?.province?.bodies || []).map((b) => ({
      slug: toDisplayText(b.slug),
      name: toDisplayText(b.name),
      url: typeof b.url === 'string' ? b.url : '',
      website: typeof b.website === 'string' ? b.website : null,
      kind: '',
    }));
    if (!q) return base;
    return base.filter((b) => b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
  }, [bodySearchResults, overview, bodyQuery]);

  const syncIntervalLabel = useMemo(() => {
    const raw = adminSourceIntervals?.['public_services'];
    if (!raw) return '每月更新 1 次';
    if (raw.includes('更新')) return raw;
    if (raw.includes('1 個月') || raw.includes('1個月')) return '每月更新 1 次';
    return `${raw}更新`;
  }, [adminSourceIntervals]);

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-2.5 overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-1.5 shrink-0 pt-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 inline-block" />
            <span className="truncate">加拿大公共服務</span>
          </span>
          {overview?.total_count ? (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
              {overview.total_count}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-sky-300 bg-sky-950/70 border border-sky-700/60 px-1.5 py-0.5 rounded font-mono font-medium">
            {syncIntervalLabel}
          </span>
          <a
            href={activeSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-sky-300 rounded transition-colors"
            title="前往 Canada Service Map 網站"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            type="button"
            onClick={() => {
              loadOverview(provinceCode);
              if (subTab === 'places') loadPlaces(nearCity, placeType);
            }}
            disabled={loadingOverview || loadingPlaces}
            className="p-1 hover:bg-[#252a38] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50 cursor-pointer"
            title="重新整理"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview || loadingPlaces ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Province Selector (Left of Service Sub-Tab) + 3 Sub-Tabs */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
        <select
          value={provinceCode}
          onChange={(e) => handleProvinceChange(e.target.value)}
          className="w-full sm:w-[136px] shrink-0 bg-[#10131c] border border-[#262c3d] focus:border-sky-500/60 rounded-lg px-2 py-1.5 text-xs text-gray-100 outline-none cursor-pointer"
          aria-label="選擇加拿大省份或地區"
          title="選擇省份或地區 (全加 13 省區)"
        >
          {(overview?.provinces_index?.length ? overview.provinces_index : FALLBACK_PROVINCES).map((p) => (
            <option key={p.code} value={p.code} className="bg-[#10131c]">
              {p.name}
            </option>
          ))}
        </select>

        <div className="flex-1 grid grid-cols-3 gap-1 min-w-0 text-[11px]">
          <button
            type="button"
            onClick={() => setSubTab('services')}
            className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg border font-semibold transition-all cursor-pointer ${
              subTab === 'services'
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-xs'
                : 'bg-[#141824] border-[#242a3a] text-gray-400 hover:text-white hover:bg-[#1c2230]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">服務指南</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('places')}
            className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg border font-semibold transition-all cursor-pointer ${
              subTab === 'places'
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-xs'
                : 'bg-[#141824] border-[#242a3a] text-gray-400 hover:text-white hover:bg-[#1c2230]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">附近據點</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('benefits')}
            className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg border font-semibold transition-all cursor-pointer ${
              subTab === 'benefits'
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-xs'
                : 'bg-[#141824] border-[#242a3a] text-gray-400 hover:text-white hover:bg-[#1c2230]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">津貼與機構</span>
          </button>
        </div>
      </div>

      {/* ==================== SUB-TAB 1: 服務指南 (SERVICES) ==================== */}
      {subTab === 'services' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2 overflow-hidden">
          {/* Auto-Search Input + Level Filter */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
                placeholder="輸入關鍵字自動搜尋..."
                className="w-full bg-[#10131c] border border-[#262c3d] focus:border-sky-500/60 rounded-lg pl-8 pr-7 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none"
              />
              {loadingFind ? (
                <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              ) : serviceQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setServiceQuery('');
                    setFindResult(null);
                    setFindError(null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                  title="清除搜尋"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="bg-[#10131c] border border-[#262c3d] rounded-lg px-2 py-1.5 text-[11px] text-gray-200 outline-none shrink-0 cursor-pointer"
              aria-label="篩選政府層級"
            >
              <option value="all" className="bg-[#10131c]">全部層級</option>
              <option value="federal" className="bg-[#10131c]">聯邦</option>
              <option value="provincial" className="bg-[#10131c]">省級</option>
              <option value="municipal" className="bg-[#10131c]">市級</option>
              <option value="health" className="bg-[#10131c]">醫療</option>
              <option value="school" className="bg-[#10131c]">學區</option>
            </select>
          </div>

          {/* 15 Category Filter Pills (English category names preserved) */}
          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-2 py-1 rounded-md text-[10.5px] font-medium whitespace-nowrap border transition-colors cursor-pointer shrink-0 ${
                selectedCategory === 'all'
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                  : 'bg-[#121622] border-[#242b3c] text-gray-400 hover:text-white'
              }`}
            >
              全部 ({mergedServices.length})
            </button>
            {(overview?.categories || []).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2 py-1 rounded-md text-[10.5px] font-medium whitespace-nowrap border transition-colors cursor-pointer shrink-0 ${
                  selectedCategory === cat.id
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                    : 'bg-[#121622] border-[#242b3c] text-gray-400 hover:text-white'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Scrollable Services List */}
          <div ref={servicesListRef} className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 min-h-0">
            {findError && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-[11px] text-rose-300">
                {findError}
              </div>
            )}

            {/* Live /api/find Smart Answer Card */}
            {findResult && (findResult.need || findResult.summary) && (() => {
              const matchedTitle = toDisplayText(findResult.need?.name || findResult.query);
              const matchedSummary = toDisplayText(findResult.summary);
              const matchedHandledBy = toDisplayText(findResult.handledBy);
              const matchedLoc = toDisplayText(findResult.location?.label) || nearCity;
              return (
                <div className="rounded-xl p-3 bg-sky-950/35 border border-sky-500/50 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold tracking-wide text-sky-300">
                        即時配對結果 · {matchedLoc}
                      </span>
                      <h4 className="text-xs font-bold text-white mt-0.5">{matchedTitle}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFindResult(null)}
                      className="p-0.5 text-gray-400 hover:text-white cursor-pointer"
                      title="關閉配對卡片"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {matchedSummary && (
                    <p className="text-[11px] text-gray-200 leading-relaxed">{matchedSummary}</p>
                  )}
                  {matchedHandledBy && (
                    <div className="text-[10.5px] text-sky-200/90 flex items-center gap-1.5 flex-wrap">
                      <Building2 className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="text-gray-400">承辦單位：</span>
                      <span className="font-semibold">{matchedHandledBy}</span>
                    </div>
                  )}
                  {Array.isArray(findResult.online) && findResult.online.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {findResult.online.slice(0, 4).map((lnk: any, i: number) => (
                        <a
                          key={i}
                          href={lnk.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sky-600/25 hover:bg-sky-600/40 border border-sky-500/40 text-[10.5px] text-sky-200 font-medium transition-colors"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[220px]">
                            {toDisplayText(lnk.label || lnk.title) || '官方連結'}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  {Array.isArray(findResult.places) && findResult.places.length > 0 && (
                    <div className="pt-1.5 border-t border-sky-500/25 space-y-1">
                      <div className="text-[10px] font-semibold text-sky-300">
                        鄰近辦理據點 ({findResult.places.length})
                      </div>
                      {findResult.places.slice(0, 4).map((pl: PlaceResult, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[#0f1522] border border-[#223047] text-[10.5px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-white truncate">{toDisplayText(pl.name)}</div>
                            <div className="text-[10px] text-gray-400 truncate">
                              {[toDisplayText(pl.address), toDisplayText(pl.city), pl.km != null ? `${pl.km} km` : '']
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </div>
                          {pl.lat != null && pl.lon != null && (
                            <button
                              type="button"
                              onClick={() => handleLocatePlace(pl)}
                              className="p-1.5 rounded-md bg-sky-500/20 hover:bg-sky-500/35 text-sky-300 border border-sky-500/40 cursor-pointer shrink-0"
                              title="在地圖上定位"
                            >
                              <MapPin className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {overviewError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300">
                {overviewError}
              </div>
            )}

            {loadingOverview && !overview ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-sky-400" />
                <span className="text-xs">正在載入加拿大公共服務目錄...</span>
              </div>
            ) : paginatedServices.length === 0 ? (
              <div className="rounded-xl border border-[#23293a] bg-[#121622] py-8 px-4 text-center text-gray-400 space-y-1.5">
                <Landmark className="w-6 h-6 text-gray-600 mx-auto" />
                <div className="text-xs text-gray-300">目前篩選條件下找不到相符的公共服務項目。</div>
                {loadingFind && (
                  <div className="text-[11px] text-sky-300">正在透過即時 API 自動查詢中...</div>
                )}
              </div>
            ) : (
              paginatedServices.map((svc) => {
                const isExpanded = expandedServiceId === svc.id;
                const detail = serviceDetailsCache[`${svc.id}::${provinceCode}`];
                const isLoadingDetail = loadingServiceDetailId === svc.id;
                const detailBodyText = toDisplayText(detail?.answer || detail?.description || svc.summary);
                const detailHandledBy = toDisplayText(detail?.handledBy) || svc.handledBy || '';
                return (
                  <div
                    key={svc.id}
                    className={`rounded-xl border transition-all overflow-hidden ${
                      isExpanded
                        ? 'bg-[#161c2b] border-sky-500/50'
                        : 'bg-[#131722] border-[#242b3c] hover:border-sky-500/35'
                    }`}
                  >
                    <div className="w-full p-2.5 flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleServiceDetail(svc.id)}
                        className="min-w-0 flex-1 space-y-1 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9.5px] font-semibold px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            {formatServiceLevelZh(svc.level)}
                          </span>
                          <span className="text-[10px] text-gray-400 truncate">{svc.categoryName}</span>
                        </div>
                        <h4 className="text-xs font-bold text-white leading-snug">{svc.name}</h4>
                        {detailHandledBy && (
                          <div className="bg-[#151b2a] border border-[#253048] rounded-lg px-2 py-1 flex items-start gap-1.5 text-[10.5px]">
                            <Building2 className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 leading-snug">
                              <span className="text-[10px] text-gray-400 mr-1">承辦機構：</span>
                              <span className="font-medium text-gray-100 break-words">{detailHandledBy}</span>
                            </div>
                          </div>
                        )}
                        {!isExpanded && svc.summary && (
                          <p className="text-[10.5px] text-gray-400 line-clamp-2 leading-relaxed">
                            {svc.summary}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setServiceQuery(svc.name);
                            runSmartFind(svc.id, nearCity);
                            servicesListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="p-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-300 transition-colors cursor-pointer"
                          title="查詢鄰近辦理據點"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleServiceDetail(svc.id)}
                          className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#1e2433] transition-colors cursor-pointer"
                          title={isExpanded ? '收合詳情' : '展開詳情'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1.5 border-t border-[#222a3d] space-y-2.5 text-[11px] bg-[#0f131d]">
                        {isLoadingDetail ? (
                          <div className="flex items-center gap-2 py-3 text-gray-400 text-xs">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                            <span>
                              正在載入 {overview?.province?.name || provinceCode.toUpperCase()} 官方連結與詳情...
                            </span>
                          </div>
                        ) : (
                          <>
                            {detailBodyText && (
                              <p className="text-gray-200 leading-relaxed">{detailBodyText}</p>
                            )}

                            {Array.isArray(detail?.officialLinks) && detail.officialLinks.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[10px] font-semibold text-sky-300 tracking-wide">
                                  官方政府連結
                                </div>
                                <div className="flex flex-col gap-1">
                                  {detail.officialLinks.map((lnk: any, i: number) => (
                                    <a
                                      key={i}
                                      href={lnk.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-sky-600/15 hover:bg-sky-600/30 border border-sky-500/35 text-sky-200 transition-colors"
                                    >
                                      <span className="font-medium truncate">
                                        {toDisplayText(lnk.label || lnk.title) || lnk.url}
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {lnk.checked && (
                                          <span className="text-[9.5px] font-mono text-gray-400">
                                            {toDisplayText(lnk.checked)}
                                          </span>
                                        )}
                                        <ExternalLink className="w-3 h-3 text-sky-300" />
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {Array.isArray(detail?.facts) && detail.facts.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[10px] font-semibold text-emerald-300 tracking-wide">
                                  重點資訊
                                </div>
                                <div className="bg-[#141925] border border-[#232b3e] rounded-lg p-2 space-y-1">
                                  {detail.facts.slice(0, 8).map((ft: any, i: number) => {
                                    const labelStr = typeof ft === 'object' && ft?.label ? toDisplayText(ft.label) : '';
                                    const valStr = typeof ft === 'string' ? ft : toDisplayText(ft?.value ?? ft?.text ?? ft);
                                    const lineText = labelStr && valStr ? `${labelStr}: ${valStr}` : (valStr || labelStr);
                                    if (!lineText) return null;
                                    return (
                                      <div key={i} className="flex items-start gap-1.5 text-[10.5px] text-gray-200">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>{lineText}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {Array.isArray(detail?.faqs) && detail.faqs.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[10px] font-semibold text-amber-300 tracking-wide">
                                  常見問題
                                </div>
                                <div className="space-y-1.5">
                                  {detail.faqs.slice(0, 4).map((faq: any, i: number) => (
                                    <div key={i} className="bg-[#141925] border border-[#232b3e] rounded-lg p-2 space-y-0.5">
                                      <div className="font-semibold text-gray-100 text-[10.5px]">
                                        {toDisplayText(faq.q || faq.question)}
                                      </div>
                                      <div className="text-gray-400 text-[10.5px] leading-relaxed">
                                        {toDisplayText(faq.a || faq.answer)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination Bar (Traditional Chinese, matching VIA Explore tab) */}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#23293a] shrink-0 text-[11px]">
            <span className="text-[10.5px] text-gray-400 whitespace-nowrap">
              共 {filteredServices.length} 項服務
            </span>
            {totalServicePages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={servicePage <= 1}
                  onClick={() => {
                    const next = Math.max(1, servicePage - 1);
                    setServicePage(next);
                    setServicePageInput(String(next));
                  }}
                  className="px-2 py-1 rounded-md bg-[#181d2b] hover:bg-[#232a3e] disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 border border-[#2a3247] flex items-center gap-0.5 transition-colors cursor-pointer"
                  title="上一頁"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>上一頁</span>
                </button>
                <div className="flex items-center gap-1 font-mono text-gray-300 px-0.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={servicePageInput}
                    onChange={(e) => setServicePageInput(e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={() => commitServicePage(servicePageInput)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitServicePage(servicePageInput);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-9 text-center bg-[#10131c] border border-[#2a3247] focus:border-sky-500/70 rounded px-1 py-0.5 text-xs text-white outline-none"
                    aria-label="輸入頁碼"
                  />
                  <span className="text-gray-500">/ {totalServicePages} 頁</span>
                </div>
                <button
                  type="button"
                  disabled={servicePage >= totalServicePages}
                  onClick={() => {
                    const next = Math.min(totalServicePages, servicePage + 1);
                    setServicePage(next);
                    setServicePageInput(String(next));
                  }}
                  className="px-2 py-1 rounded-md bg-[#181d2b] hover:bg-[#232a3e] disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 border border-[#2a3247] flex items-center gap-0.5 transition-colors cursor-pointer"
                  title="下一頁"
                >
                  <span>下一頁</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 2: 附近據點 (NEARBY PLACES) ==================== */}
      {subTab === 'places' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-2 overflow-hidden">
          {/* City Dropdown (LEFT of Place Type Selector) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative w-[155px] sm:w-[175px] shrink-0">
              <MapPin className="w-3.5 h-3.5 text-sky-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={nearCity}
                onChange={(e) => setNearCity(e.target.value)}
                className="w-full bg-[#10131c] border border-[#262c3d] focus:border-sky-500/60 rounded-lg pl-7 pr-2 py-1.5 text-xs text-gray-100 outline-none cursor-pointer"
                aria-label="選擇城市"
                title="選擇查詢城市"
              >
                {provinceCityOptions.map((cityName) => (
                  <option key={cityName} value={cityName} className="bg-[#10131c]">
                    {cityName}
                  </option>
                ))}
              </select>
            </div>

            <select
              value={placeType}
              onChange={(e) => setPlaceType(e.target.value)}
              className="flex-1 min-w-0 bg-[#10131c] border border-[#262c3d] focus:border-sky-500/60 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 outline-none cursor-pointer"
              aria-label="選擇據點類別"
            >
              {PLACE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key} className="bg-[#10131c]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 min-h-0">
            {placesError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300">
                {placesError}
              </div>
            )}
            {loadingPlaces ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-sky-400" />
                <span className="text-xs">正在搜尋 {nearCity} 附近據點...</span>
              </div>
            ) : !placesData || placesData.results.length === 0 ? (
              <div className="rounded-xl border border-[#23293a] bg-[#121622] py-10 px-4 text-center text-gray-400 text-xs">
                在 {nearCity} 附近找不到「{PLACE_TYPE_OPTIONS.find((o) => o.key === placeType)?.label || placeType}」據點。
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[10.5px] text-gray-400 px-0.5">
                  <span className="truncate">
                    {toDisplayText(placesData.type?.plural) || placeType} ·{' '}
                    <strong className="text-gray-200">{toDisplayText(placesData.near?.label) || nearCity}</strong>
                  </span>
                  <span className="font-mono text-sky-300 shrink-0 ml-2">共 {placesData.results.length} 處據點</span>
                </div>
                {placesData.results.map((pl, idx) => {
                  const opName = toDisplayText(pl.operator);
                  const plName = toDisplayText(pl.name);
                  const plType = toDisplayText(pl.type || placesData.type?.name) || 'Public Service';
                  const plAddr = [toDisplayText(pl.address), toDisplayText(pl.city), toDisplayText(pl.postal)]
                    .filter(Boolean)
                    .join(', ');
                  const hasCoords = pl.lat != null && pl.lon != null && Number.isFinite(pl.lat) && Number.isFinite(pl.lon);
                  return (
                    <div
                      key={`${plName}_${idx}`}
                      className="rounded-xl p-3 bg-[#131722] border border-[#242b3c] hover:border-sky-500/40 transition-colors space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                              {plType}
                            </span>
                            {pl.km != null && (
                              <span className="text-[10px] font-mono text-emerald-300">{pl.km} km</span>
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-white mt-1 leading-snug">{plName}</h4>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {hasCoords && (
                            <button
                              type="button"
                              onClick={() => handleLocatePlace(pl)}
                              className="p-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 transition-colors cursor-pointer"
                              title="在地圖上定位"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {pl.directions && (
                            <a
                              href={pl.directions}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-[#191f2e] hover:bg-emerald-500/20 text-gray-300 hover:text-emerald-300 border border-[#2a3347] transition-colors"
                              title="Google Maps 路線導航"
                            >
                              <Navigation className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {pl.website && (
                            <a
                              href={pl.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-[#191f2e] hover:bg-sky-500/20 text-gray-300 hover:text-sky-300 border border-[#2a3347] transition-colors"
                              title="前往官方網站"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-300">
                        {plAddr || '地址請參閱官方網站'}
                      </div>
                      {opName && (
                        <div className="text-[10.5px] text-gray-400 flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-gray-500 shrink-0" />
                          <span className="truncate">{opName}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 3: 津貼與機構 (BENEFITS & BODIES) ==================== */}
      {subTab === 'benefits' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-0">
          {/* Section A: Benefit Payment Dates */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] px-0.5">
              <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>福利津貼發放日期 ({combinedBenefits.length})</span>
              </span>
              <span className="text-[10px] text-gray-400 truncate ml-2">
                聯邦 + {overview?.province?.name || provinceCode.toUpperCase()}
              </span>
            </div>

            {combinedBenefits.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#121622] border border-[#23293a] text-center text-xs text-gray-400">
                暫無福利津貼發放日期資料。
              </div>
            ) : (
              combinedBenefits.map((b, idx) => {
                const bKey = b.id || `${b.name}_${idx}`;
                const isOpen = Boolean(expandedBenefitIds[bKey]);
                return (
                  <div
                    key={bKey}
                    className="rounded-xl bg-[#131722] border border-[#242b3c] p-2.5 space-y-1.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9.5px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            {b.where || 'Canada'}
                          </span>
                          {b.next && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              下次發放：{b.next}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-white text-xs mt-1">{b.name}</h4>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {b.dates && b.dates.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBenefitIds((prev) => ({ ...prev, [bKey]: !prev[bKey] }))
                            }
                            className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#1e2433] cursor-pointer"
                            title={isOpen ? '收合發放日期' : '展開全部發放日期'}
                          >
                            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    {b.note && <p className="text-[10.5px] text-gray-400 leading-relaxed">{b.note}</p>}
                    {isOpen && b.dates && b.dates.length > 0 && (
                      <div className="pt-1.5 border-t border-[#1e2536] flex flex-wrap gap-1">
                        {b.dates.map((dt) => {
                          const dtStr = toDisplayText(dt);
                          return (
                            <span
                              key={dtStr}
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                dtStr === b.next
                                  ? 'bg-amber-500/25 border-amber-400/60 text-amber-200 font-bold'
                                  : 'bg-[#0e121b] border-[#222a3c] text-gray-300'
                              }`}
                            >
                              {dtStr}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Section B: Public Bodies Directory & Auto-Search */}
          <div className="space-y-1.5 pt-2 border-t border-[#23293a]">
            <div className="flex items-center justify-between text-[11px] px-0.5">
              <span className="font-bold text-sky-300 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>公共機構名錄 ({bodyQuery.trim() ? displayedBodies.length : overview?.province?.bodyCount || displayedBodies.length})</span>
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={bodyQuery}
                onChange={(e) => setBodyQuery(e.target.value)}
                placeholder={`輸入關鍵字自動搜尋 ${overview?.province?.name || provinceCode.toUpperCase()} 公共機構...`}
                className="w-full bg-[#10131c] border border-[#262c3d] focus:border-sky-500/60 rounded-lg pl-8 pr-7 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none"
              />
              {loadingBodies ? (
                <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              ) : bodyQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setBodyQuery('');
                    setBodySearchResults(null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                  title="清除搜尋"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {displayedBodies.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#121622] border border-[#23293a] text-center text-xs text-gray-400">
                找不到符合條件的公共機構。
              </div>
            ) : (
              displayedBodies.map((b, idx) => {
                const key = b.slug || `${b.name}_${idx}`;
                const isOpen = expandedBodyKey === key;
                const bDetail = bodyDetailsCache[key];
                const isLoadingB = loadingBodyDetailKey === key;
                const descMeta = extractBodyDescriptionMeta(bDetail?.description ?? bDetail?.summary ?? bDetail?.about);
                return (
                  <div
                    key={key}
                    className="rounded-xl bg-[#131722] border border-[#242b3c] overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleBodyDetail(b.slug)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="text-xs font-semibold text-white truncate">{b.name}</div>
                        {b.kind && <div className="text-[10px] text-gray-400">{b.kind}</div>}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {b.website && (
                          <a
                            href={b.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-gray-400 hover:text-sky-300 rounded hover:bg-[#1e2433]"
                            title="前往官方網站"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {b.slug && (
                          <button
                            type="button"
                            onClick={() => toggleBodyDetail(b.slug)}
                            className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#1e2433] cursor-pointer"
                            title={isOpen ? '收合機構詳情' : '展開機構詳情'}
                          >
                            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="px-3 pb-2.5 pt-1.5 border-t border-[#1e2536] bg-[#0f131d] text-[10.5px] space-y-1.5">
                        {isLoadingB ? (
                          <div className="text-gray-400 flex items-center gap-1.5 py-1">
                            <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                            <span>正在載入機構詳情...</span>
                          </div>
                        ) : bDetail ? (
                          <>
                            {descMeta.text && (
                              <p className="text-gray-300 leading-relaxed">{descMeta.text}</p>
                            )}
                            {descMeta.population != null && (
                              <div className="text-[10px] text-gray-400 font-mono">
                                人口：{descMeta.population.toLocaleString()}
                                {descMeta.populationYear ? ` (${descMeta.populationYear})` : ''}
                              </div>
                            )}
                            {Array.isArray(bDetail.services) && bDetail.services.length > 0 && (
                              <div className="space-y-1 pt-0.5">
                                <div className="text-[10px] text-gray-400">相關服務</div>
                                <div className="flex flex-wrap gap-1">
                                  {bDetail.services.slice(0, 8).map((sv: any, i: number) => {
                                    const svLabel = toDisplayText(sv);
                                    if (!svLabel) return null;
                                    return (
                                      <span
                                        key={i}
                                        className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-200 text-[10px]"
                                      >
                                        {svLabel}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-3 pt-0.5 flex-wrap">
                              {bDetail.url && (
                                <a
                                  href={bDetail.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sky-300 hover:underline"
                                >
                                  <span>在 Canada Service Map 查看</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              {descMeta.source && (
                                <a
                                  href={descMeta.source}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-gray-400 hover:text-sky-300 hover:underline"
                                >
                                  <span>資料參考來源</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="text-gray-500">更多詳細資訊請參閱官方網站。</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Mandatory Source Attribution & Disclaimer Footer (Traditional Chinese) */}
      <div className="pt-2 border-t border-[#23293a] shrink-0 text-[10px] text-gray-400 space-y-0.5 leading-snug">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3 text-sky-400 shrink-0" />
            <span>資料來源：</span>
            <a
              href={activeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-300 hover:underline font-medium"
            >
              Canada Service Map
            </a>
          </span>
          {activeCheckedDate && (
            <span className="font-mono text-gray-500">核對日期：{activeCheckedDate}</span>
          )}
        </div>
        <div className="text-[9.5px] text-gray-500">
          本系統非政府官方網站，一切資訊與最終解釋請以政府官方網頁為準。
        </div>
      </div>
    </div>
  );
}
