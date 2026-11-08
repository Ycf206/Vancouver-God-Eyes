import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

// Cache merged flights for 45s
let cachedFlights: any = null;
let lastFetchTime = 0;

const AIRPORT_DURATIONS_HOURS: Record<string, number> = {
  'YYZ': 4.5, 'YUL': 4.75, 'YYC': 1.4, 'YEG': 1.4, 'YOW': 4.5, 'YWG': 2.75,
  'YHZ': 5.75, 'YYJ': 0.5, 'YCD': 0.4, 'YWH': 0.4, 'YQQ': 0.6, 'YLW': 0.8,
  'YKA': 0.75, 'YXS': 1.2, 'YPR': 1.8, 'YXT': 1.6, 'YXY': 2.4, 'YZF': 2.5,
  'SEA': 0.8, 'PDX': 1.1, 'SFO': 2.25, 'OAK': 2.2, 'LAX': 2.75, 'SAN': 3.0,
  'LAS': 2.6, 'PHX': 3.1, 'DEN': 2.75, 'SLC': 2.0, 'DFW': 4.25, 'IAH': 4.4,
  'ORD': 4.0, 'MSP': 3.4, 'ATL': 4.8, 'JFK': 5.25, 'EWR': 5.25, 'HNL': 6.0,
  'OGG': 5.9, 'LHR': 9.5, 'LGW': 9.5, 'CDG': 9.75, 'FRA': 10.0, 'AMS': 9.5,
  'NRT': 10.0, 'HND': 10.0, 'ICN': 11.0, 'TPE': 11.5, 'HKG': 12.5, 'PVG': 12.0,
  'SYD': 14.5, 'AKL': 13.5, 'MEX': 5.25, 'CUN': 5.5, 'PVR': 4.75, 'SJD': 4.5
};

function getVancouverDates() {
  const vancouverNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  const yyyy = vancouverNow.getFullYear();
  const mm = String(vancouverNow.getMonth() + 1).padStart(2, '0');
  const dd = String(vancouverNow.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const tomorrow = new Date(vancouverNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomYyyy = tomorrow.getFullYear();
  const tomMm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const tomDd = String(tomorrow.getDate()).padStart(2, '0');
  const tomorrowStr = `${tomYyyy}-${tomMm}-${tomDd}`;

  return { todayStr, tomorrowStr };
}

function loadDiskCache() {
  const candidates = [
    path.join(process.cwd(), 'frontend', 'public', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), 'public', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), 'backend', 'data', 'vancouver_yvr_flights.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'vancouver_yvr_flights.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (d && (d.arrivals?.length || d.departures?.length)) {
          return d;
        }
      } catch {}
    }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const isRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('force') === 'true';
  const now = Date.now();
  if (!isRefresh && cachedFlights && (now - lastFetchTime < 45000)) {
    return NextResponse.json(cachedFlights, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' }
    });
  }

  // 1. Try backend API proxy if available
  try {
    const backendUrl = process.env.INTERNAL_BACKEND_URL || 'http://127.0.0.1:8000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const backendEndpoint = isRefresh ? `${backendUrl}/api/airports/flights?refresh=true` : `${backendUrl}/api/airports/flights`;
    const bRes = await fetch(backendEndpoint, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (bRes.ok) {
      const bJson = await bRes.json();
      if (bJson && (bJson.arrivals?.length || bJson.departures?.length)) {
        cachedFlights = bJson;
        lastFetchTime = now;
        console.log(`✅ [YVR Flights Service] 航班排程同步成功: 抵達 ${bJson.arrivals?.length || 0} 班, 出發 ${bJson.departures?.length || 0} 班`);
        return NextResponse.json(cachedFlights, {
          headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' }
        });
      }
    }
  } catch {}

  // 2. Load disk cache
  const diskData = loadDiskCache();
  if (diskData) {
    cachedFlights = diskData;
    lastFetchTime = now;
  }

  // 3. Fallback: Sequential query to YVR official API if disk cache is absent
  if (!cachedFlights || (!cachedFlights.arrivals?.length && !cachedFlights.departures?.length)) {
    const { todayStr, tomorrowStr } = getVancouverDates();
    const headers = [
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      '-H', 'Accept: application/json, text/plain, */*'
    ];

    const arrivalsUrl = `https://www.yvr.ca/en/_api/Flights?%24filter=((FlightScheduledTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightScheduledTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27A%27)%20or%20(FlightEstimatedTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightEstimatedTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27A%27))&%24orderby=FlightScheduledTime%20asc`;
    const departuresUrl = `https://www.yvr.ca/en/_api/Flights?%24filter=((FlightScheduledTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightScheduledTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27D%27)%20or%20(FlightEstimatedTime%20gt%20DateTime%27${todayStr}T00%3A00%3A00%27%20and%20FlightEstimatedTime%20lt%20DateTime%27${tomorrowStr}T00%3A00%3A00%27%20and%20FlightType%20eq%20%27D%27))&%24orderby=FlightScheduledTime%20asc`;

    try {
      // Sequential to prevent Cloudflare challenge rate limit
      let arrJson: any = null;
      let depJson: any = null;

      try {
        const arrRes = await execFileAsync('curl.exe', ['-s', arrivalsUrl, ...headers, '-H', 'Referer: https://www.yvr.ca/en/passengers/flights/arriving-flights'], { timeout: 15000 });
        const arrOut = (arrRes.stdout || '').trim();
        if (arrOut.startsWith('{') && arrOut.endsWith('}')) {
          arrJson = JSON.parse(arrOut);
        }
      } catch (err) {
        console.warn('Arrivals fetch warning:', err);
      }

      await new Promise(r => setTimeout(r, 1200));

      try {
        const depRes = await execFileAsync('curl.exe', ['-s', departuresUrl, ...headers, '-H', 'Referer: https://www.yvr.ca/en/passengers/flights/departing-flights'], { timeout: 15000 });
        const depOut = (depRes.stdout || '').trim();
        if (depOut.startsWith('{') && depOut.endsWith('}')) {
          depJson = JSON.parse(depOut);
        }
      } catch (err) {
        console.warn('Departures fetch warning:', err);
      }

      const processFlight = (item: any, type: 'A' | 'D') => {
        const fn = (item.FlightNumber || '').replace(/\s+/g, '').toUpperCase();
        const code = item.FlightAirportCode || '';
        const durHours = AIRPORT_DURATIONS_HOURS[code] || 2.5;
        const durMs = durHours * 3600 * 1000;

        const primaryTime = item.FlightEstimatedTime || item.FlightScheduledTime || '';
        let originDepartureTime = '';
        let destArrivalTime = '';

        if (type === 'A') {
          destArrivalTime = primaryTime;
          if (primaryTime) {
            const dt = new Date(primaryTime);
            if (!isNaN(dt.getTime())) {
              originDepartureTime = new Date(dt.getTime() - durMs).toISOString().slice(0, 19);
            }
          }
        } else {
          originDepartureTime = primaryTime;
          if (primaryTime) {
            const dt = new Date(primaryTime);
            if (!isNaN(dt.getTime())) {
              destArrivalTime = new Date(dt.getTime() + durMs).toISOString().slice(0, 19);
            }
          }
        }

        return {
          id: item.FlightID || `${fn}_${item.FlightScheduledTime}`,
          flight_number: item.FlightNumber,
          airline: item.FlightAirlineName,
          carrier: item.FlightCarrier || '',
          type,
          range: item.FlightRange || 'D',
          city: item.FlightCity || '',
          airport_code: code,
          scheduled_time: item.FlightScheduledTime,
          estimated_time: item.FlightEstimatedTime,
          origin_departure_time: originDepartureTime,
          dest_arrival_time: destArrivalTime,
          desk_from: item.FlightDeskFrom || '',
          desk_to: item.FlightDeskTo || '',
          gate: item.FlightGate || '',
          carousel: item.FlightCarousel || '',
          status: item.FlightStatus || item.FlightRemarks || 'On Time',
          aircraft_type: item.FlightAircraftType || '',
          yvr_coords: [-123.184444, 49.193889]
        };
      };

      const yvrArrivals = arrJson?.value || [];
      const yvrDepartures = depJson?.value || [];

      const newArrivals = yvrArrivals.map((it: any) => processFlight(it, 'A'));
      const newDepartures = yvrDepartures.map((it: any) => processFlight(it, 'D'));

      const fallbackArrivals = cachedFlights?.arrivals?.length ? cachedFlights.arrivals : (diskData?.arrivals || []);
      const fallbackDepartures = cachedFlights?.departures?.length ? cachedFlights.departures : (diskData?.departures || []);

      const finalArrivals = newArrivals.length > 0 ? newArrivals : fallbackArrivals;
      const finalDepartures = newDepartures.length > 0 ? newDepartures : fallbackDepartures;

      if (finalArrivals.length > 0 || finalDepartures.length > 0) {
        cachedFlights = {
          success: true,
          updated_at: new Date().toISOString(),
          counts: { arrivals: finalArrivals.length, departures: finalDepartures.length },
          arrivals: finalArrivals,
          departures: finalDepartures
        };
        lastFetchTime = now;
      }
    } catch (e: any) {
      console.warn('YVR API query warning (fallback active):', e?.message);
    }
  }

  return NextResponse.json(cachedFlights || { success: false, arrivals: [], departures: [] }, {
    headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' }
  });
}
