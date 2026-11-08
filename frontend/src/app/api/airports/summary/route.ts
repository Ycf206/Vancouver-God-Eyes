import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

let inMemoryCache: any = null;
let lastCacheTime = 0;

function resolvePublicDataPath(filename: string) {
  const cwd = process.cwd();
  if (cwd.endsWith('frontend')) {
    return path.join(cwd, 'public', 'data', filename);
  }
  return path.join(cwd, 'frontend', 'public', 'data', filename);
}

function normalizeSummaryData(data: any, airportId = 'CYVR') {
  if (!data || typeof data !== 'object') {
    return { success: false, cameras: [], metars: [] };
  }

  const payload = data.payload || {};
  const siteContainer = payload.site || data.site || {};
  const siteInner = siteContainer.site || siteContainer;

  const siteId = siteInner.siteIdentifier || data.siteIdentifier || (airportId.startsWith('C') ? airportId.replace(/^C/, '') : airportId);
  const icaoCode = siteInner.icao || data.icao || airportId;

  return {
    ...data,
    success: true,
    siteIdentifier: siteId,
    icao: icaoCode,
    name: data.name || siteInner.siteName || 'Vancouver International Airport',
    address: data.address || '3211 Grant McConachie Wy, Richmond, BC V7B 0A4',
    timeZone: siteInner.timeZone || data.timeZone || 'America/Vancouver',
    operatedBy: siteInner.operatedBy || data.operatedBy || 'NAV CANADA',
    sunrise: siteInner.sunrise || payload.sunrise || data.sunrise || null,
    sunset: siteInner.sunset || payload.sunset || data.sunset || null,
    latitude: siteInner.latitude !== undefined ? siteInner.latitude : (data.latitude || 49.195),
    longitude: siteInner.longitude !== undefined ? siteInner.longitude : (data.longitude || -123.17824),
    elevation: siteInner.elevation || data.elevation || 13,
    cameras: siteContainer.cameras || payload.cameras || data.cameras || [],
    metars: payload.metars || data.metars || [],
  };
}

function loadDiskCache(airportId = 'CYVR') {
  const candidates = [
    resolvePublicDataPath('yvr_weathercams_summary.json'),
    path.join(process.cwd(), 'public', 'data', 'yvr_weathercams_summary.json'),
    path.join(process.cwd(), 'backend', 'data', 'yvr_weathercams_summary.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'yvr_weathercams_summary.json'),
    path.join(process.cwd(), '..', 'frontend', 'public', 'data', 'yvr_weathercams_summary.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(raw);
        return normalizeSummaryData(json, airportId);
      } catch {}
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const airportId = request.nextUrl.searchParams.get('airportId') || request.nextUrl.searchParams.get('airport_id') || 'CYVR';
  const now = Date.now();

  // 1. In-memory cache valid for 50s
  if (inMemoryCache && (now - lastCacheTime < 50000)) {
    return NextResponse.json(inMemoryCache, {
      headers: { 'Cache-Control': 'public, max-age=50, stale-while-revalidate=120' }
    });
  }

  // 2. Attempt real live fetch from FAA WeatherCams
  const url = `https://weathercams.faa.gov/api/summary?airportId=${airportId}`;
  const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const headers = [
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '-H', 'Referer: https://weathercams.faa.gov/',
    '-H', 'Accept: application/json, text/plain, */*'
  ];

  try {
    const { stdout } = await execFileAsync(curlBin, ['-s', url, ...headers], { timeout: 12000 });
    if (stdout && stdout.trim().startsWith('{') && stdout.trim().endsWith('}')) {
      const parsed = JSON.parse(stdout.trim());
      const normalized = normalizeSummaryData(parsed, airportId);

      inMemoryCache = normalized;
      lastCacheTime = now;

      // Update disk cache asynchronously
      const savePath = resolvePublicDataPath('yvr_weathercams_summary.json');
      try {
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        fs.writeFileSync(savePath, JSON.stringify(normalized, null, 2), 'utf-8');
      } catch {}

      return NextResponse.json(normalized, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' }
      });
    }
  } catch (err) {
    console.warn(`[Next API /api/airports/summary] Live fetch failed, trying disk cache:`, err);
  }

  // 3. Fallback to Disk Cache
  const diskData = loadDiskCache(airportId);
  if (diskData) {
    inMemoryCache = diskData;
    lastCacheTime = now;
    return NextResponse.json(diskData, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' }
    });
  }

  // 4. Return authentic empty state (never fake data)
  return NextResponse.json({
    success: false,
    siteIdentifier: airportId.startsWith('C') ? airportId.replace(/^C/, '') : airportId,
    icao: airportId,
    name: 'Vancouver International Airport',
    cameras: [],
    metars: [],
    error: '目前無法連線至 FAA WeatherCams 氣象即時系統'
  });
}
