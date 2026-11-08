import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};

let cachedFlights: any = null;
let lastFetchTime = 0;

const AIRPORT_DURATIONS_HOURS: Record<string, number> = {
  YYZ: 4.5, YUL: 4.75, YYC: 1.4, YEG: 1.4, YOW: 4.5, YWG: 2.75,
  YHZ: 5.75, YYJ: 0.5, YCD: 0.4, YWH: 0.4, YQQ: 0.6, YLW: 0.8,
  YKA: 0.75, YXS: 1.2, YPR: 1.8, YXT: 1.6, YXY: 2.4, YZF: 2.5,
  YQR: 2.1, YXE: 2.1, YXX: 0.4, YCG: 1.0, YXC: 1.2,
  SEA: 0.8, PDX: 1.1, SFO: 2.25, OAK: 2.2, SJC: 2.3, LAX: 2.75,
  SAN: 3.0, LAS: 2.6, PHX: 3.1, DEN: 2.75, SLC: 2.0, DFW: 4.25,
  IAH: 4.4, ORD: 4.0, MSP: 3.4, ATL: 4.8, JFK: 5.25, EWR: 5.25,
  BOS: 5.25, IAD: 5.1, MCO: 5.5, MIA: 5.75, HNL: 6.0, OGG: 5.9,
  KOA: 6.1, LIH: 6.2, ANC: 3.5,
  LHR: 9.5, LGW: 9.5, CDG: 9.75, FRA: 10.0, AMS: 9.5, DUB: 9.0,
  ZRH: 10.25, KEF: 7.5, NRT: 10.0, HND: 10.0, KIX: 10.75, ICN: 11.0,
  TPE: 11.5, HKG: 12.5, PVG: 12.0, PEK: 11.5, CAN: 13.0, XMN: 12.5,
  BKK: 15.5, SIN: 16.0, MNL: 13.5, SYD: 14.5, BNE: 14.0, AKL: 13.5,
  NAN: 11.5, MEX: 5.25, CUN: 5.5, PVR: 4.75, SJD: 4.5,
};

// BC Permanent Pacific Time (PCT = UTC-7 year-round)
function getVancouverDates() {
  const pctMs = Date.now() - 7 * 3600 * 1000;
  const pctNow = new Date(pctMs);
  const yyyy = pctNow.getUTCFullYear();
  const mm = String(pctNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(pctNow.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const pctTom = new Date(pctMs + 86400 * 1000);
  const tomYyyy = pctTom.getUTCFullYear();
  const tomMm = String(pctTom.getUTCMonth() + 1).padStart(2, '0');
  const tomDd = String(pctTom.getUTCDate()).padStart(2, '0');
  const tomorrowStr = `${tomYyyy}-${tomMm}-${tomDd}`;

  return { todayStr, tomorrowStr };
}

function isFlightForToday(f: any, todayStr: string): boolean {
  if (!f || typeof f !== 'object') return false;
  const schedD = String(f.scheduled_time || '').slice(0, 10);
  const estD = String(f.estimated_time || '').slice(0, 10);
  return (schedD.length === 10 && schedD >= todayStr) || (estD.length === 10 && estD >= todayStr);
}

function sanitizeAndSortFlights(list: any[], todayStr: string): any[] {
  const map = new Map<string, any>();
  for (const f of list || []) {
    if (!isFlightForToday(f, todayStr)) continue;
    const key = String(f.id || `${f.flight_number || ''}_${f.scheduled_time || ''}`);
    map.set(key, f);
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    const ta = String(a.scheduled_time || a.estimated_time || '');
    const tb = String(b.scheduled_time || b.estimated_time || '');
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.flight_number || '').localeCompare(String(b.flight_number || ''));
  });
  return arr;
}

function loadValidDiskCache(todayStr: string): { data: any; ageMs: number } | null {
  const candidates = [
    path.join(process.cwd(), 'backend', 'data', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), 'frontend', 'public', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), 'public', 'vancouver_yvr_flights.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const arr = sanitizeAndSortFlights(raw?.arrivals || [], todayStr);
      const dep = sanitizeAndSortFlights(raw?.departures || [], todayStr);
      if (arr.length === 0 && dep.length === 0) continue;
      const updatedMs = raw?.updated_at ? new Date(raw.updated_at).getTime() : 0;
      const ageMs = updatedMs > 0 ? Math.max(0, Date.now() - updatedMs) : 1e12;
      return {
        data: {
          success: true,
          query_date: todayStr,
          updated_at: raw?.updated_at || '',
          counts: { arrivals: arr.length, departures: dep.length },
          arrivals: arr,
          departures: dep,
        },
        ageMs,
      };
    } catch {}
  }
  return null;
}

async function fetchYvrDirectLeg(url: string, referer: string): Promise<any[]> {
  const reqHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8',
    'Referer': referer,
    'Origin': 'https://www.yvr.ca',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  // 1. Native fetch
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 18000);
    const res = await fetch(url, { headers: reqHeaders, cache: 'no-store', signal: controller.signal });
    clearTimeout(tid);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.value) && json.value.length > 0) {
        return json.value;
      }
    }
  } catch {}

  // 2. Cross-platform curl fallback
  try {
    const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const curlArgs = ['-L', '-s', url];
    for (const [k, v] of Object.entries(reqHeaders)) {
      curlArgs.push('-H', `${k}: ${v}`);
    }
    const res = await execFileAsync(curlBin, curlArgs, { timeout: 20000, maxBuffer: 10 * 1024 * 1024 });
    const out = (res.stdout || '').trim();
    if (out.startsWith('{') && out.endsWith('}')) {
      const json = JSON.parse(out);
      if (Array.isArray(json?.value) && json.value.length > 0) {
        return json.value;
      }
    }
  } catch (err) {
    console.warn('YVR direct curl fallback warning:', err);
  }

  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const isRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('force') === 'true';
  const now = Date.now();
  const { todayStr, tomorrowStr } = getVancouverDates();
  const maxMemAgeMs = isRefresh ? 15000 : 50000;

  if (
    cachedFlights &&
    cachedFlights.query_date === todayStr &&
    now - lastFetchTime < maxMemAgeMs &&
    (cachedFlights.arrivals?.length || cachedFlights.departures?.length)
  ) {
    return NextResponse.json(cachedFlights, { headers: NO_CACHE_HEADERS });
  }

  // 1. Proxy to backend service (supports both Docker internal network & local dev)
  const backendCandidates = Array.from(
    new Set(
      [
        process.env.INTERNAL_BACKEND_URL,
        process.env.NODE_ENV === 'production' ? 'http://backend:8000' : 'http://127.0.0.1:8000',
        'http://127.0.0.1:8000',
      ].filter(Boolean) as string[]
    )
  );

  for (const backendUrl of backendCandidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const backendEndpoint = isRefresh
        ? `${backendUrl}/api/airports/flights?refresh=true&_t=${now}`
        : `${backendUrl}/api/airports/flights?_t=${now}`;
      const bRes = await fetch(backendEndpoint, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      if (bRes.ok) {
        const bJson = await bRes.json();
        const arr = sanitizeAndSortFlights(bJson?.arrivals || [], todayStr);
        const dep = sanitizeAndSortFlights(bJson?.departures || [], todayStr);
        if (arr.length > 0 || dep.length > 0) {
          cachedFlights = {
            success: true,
            query_date: todayStr,
            updated_at: bJson?.updated_at || new Date(now - 7 * 3600 * 1000).toISOString().replace('Z', '-07:00'),
            counts: { arrivals: arr.length, departures: dep.length },
            arrivals: arr,
            departures: dep,
          };
          lastFetchTime = now;
          return NextResponse.json(cachedFlights, { headers: NO_CACHE_HEADERS });
        }
      }
    } catch {}
  }

  // 2. Check fresh same-day disk cache if not forced refresh
  const diskEntry = loadValidDiskCache(todayStr);
  if (!isRefresh && diskEntry && diskEntry.ageMs < 55000) {
    cachedFlights = diskEntry.data;
    lastFetchTime = now - diskEntry.ageMs;
    return NextResponse.json(cachedFlights, { headers: NO_CACHE_HEADERS });
  }

  // 3. Direct live query to official YVR API
  const arrivalsUrl = `https://www.yvr.ca/en/_api/Flights?%24filter=((FlightScheduledTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightScheduledTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27A%27)%20or%20(FlightEstimatedTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightEstimatedTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27A%27))&%24orderby=FlightScheduledTime%20asc`;
  const departuresUrl = `https://www.yvr.ca/en/_api/Flights?%24filter=((FlightScheduledTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightScheduledTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27D%27)%20or%20(FlightEstimatedTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightEstimatedTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27D%27))&%24orderby=FlightScheduledTime%20asc`;

  try {
    const yvrArrivals = await fetchYvrDirectLeg(arrivalsUrl, 'https://www.yvr.ca/en/passengers/flights/arriving-flights');
    await new Promise((r) => setTimeout(r, 1000));
    const yvrDepartures = await fetchYvrDirectLeg(departuresUrl, 'https://www.yvr.ca/en/passengers/flights/departing-flights');

    const processFlight = (item: any, type: 'A' | 'D') => {
      const fn = String(item.FlightNumber || '').replace(/\s+/g, '').toUpperCase();
      const code = String(item.FlightAirportCode || '').trim().toUpperCase();
      const durHours = AIRPORT_DURATIONS_HOURS[code] || 2.5;
      const durMs = durHours * 3600 * 1000;

      const primaryTime = String(item.FlightEstimatedTime || item.FlightScheduledTime || '').trim();
      const naiveIso = primaryTime.replace(/Z$/, '').replace(/[+-]\d\d:\d\d$/, '');
      let originDepartureTime = '';
      let destArrivalTime = '';

      if (type === 'A') {
        destArrivalTime = naiveIso;
        if (naiveIso) {
          const dt = new Date(`${naiveIso}Z`);
          if (!isNaN(dt.getTime())) {
            originDepartureTime = new Date(dt.getTime() - durMs).toISOString().slice(0, 19);
          }
        }
      } else {
        originDepartureTime = naiveIso;
        if (naiveIso) {
          const dt = new Date(`${naiveIso}Z`);
          if (!isNaN(dt.getTime())) {
            destArrivalTime = new Date(dt.getTime() + durMs).toISOString().slice(0, 19);
          }
        }
      }

      return {
        id: String(item.FlightID || `${fn}_${item.FlightScheduledTime}`),
        flight_number: String(item.FlightNumber || '').trim().toUpperCase(),
        airline: item.FlightAirlineName || item.FlightCarrier || '',
        carrier: String(item.FlightCarrier || '').trim().toUpperCase(),
        type,
        range: item.FlightRange || 'D',
        city: item.FlightCity || '',
        airport_code: code,
        scheduled_time: item.FlightScheduledTime || '',
        estimated_time: item.FlightEstimatedTime || '',
        origin_departure_time: originDepartureTime,
        dest_arrival_time: destArrivalTime,
        desk_from: item.FlightDeskFrom || '',
        desk_to: item.FlightDeskTo || '',
        gate: item.FlightGate || '',
        carousel: item.FlightCarousel || '',
        status: item.FlightStatus || item.FlightRemarks || 'On Time',
        aircraft_type: item.FlightAircraftType || '',
        yvr_coords: [-123.184444, 49.193889],
      };
    };

    const newArrivals = sanitizeAndSortFlights(yvrArrivals.map((it: any) => processFlight(it, 'A')), todayStr);
    const newDepartures = sanitizeAndSortFlights(yvrDepartures.map((it: any) => processFlight(it, 'D')), todayStr);

    const sameDayFallbackArr = diskEntry?.data?.arrivals || [];
    const sameDayFallbackDep = diskEntry?.data?.departures || [];

    const finalArrivals = newArrivals.length > 0 ? newArrivals : sameDayFallbackArr;
    const finalDepartures = newDepartures.length > 0 ? newDepartures : sameDayFallbackDep;

    if (finalArrivals.length > 0 || finalDepartures.length > 0) {
      cachedFlights = {
        success: true,
        query_date: todayStr,
        updated_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString().replace('Z', '-07:00'),
        counts: { arrivals: finalArrivals.length, departures: finalDepartures.length },
        arrivals: finalArrivals,
        departures: finalDepartures,
      };
      lastFetchTime = now;
      return NextResponse.json(cachedFlights, { headers: NO_CACHE_HEADERS });
    }
  } catch (e: any) {
    console.warn('YVR API direct query warning:', e?.message);
  }

  if (diskEntry) {
    return NextResponse.json(diskEntry.data, { headers: NO_CACHE_HEADERS });
  }

  return NextResponse.json(
    { success: false, query_date: todayStr, arrivals: [], departures: [] },
    { headers: NO_CACHE_HEADERS }
  );
}
