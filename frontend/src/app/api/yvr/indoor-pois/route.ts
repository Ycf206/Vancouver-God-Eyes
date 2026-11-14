import { NextResponse } from 'next/server';
import { getServerBackendUrl } from '@/utils/serverBackend';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const YVR_CONFIG_URL = 'https://map.yvr.ca/config.json';

function normalizeUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const u = String(raw).trim();
  if (!u) return null;
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('mailto:') || u.startsWith('tel:')) {
    return u;
  }
  if (u.startsWith('//')) return `https:${u}`;
  return `https://${u}`;
}

function formatFloorId(floorId: string, lookup: Record<string, string>): string {
  if (lookup[floorId]) return lookup[floorId];
  const parts = floorId.split('-');
  if (parts.length >= 3 && parts[0].toLowerCase() === 'yvr') {
    const termRaw = parts[1].toLowerCase();
    const term =
      termRaw === 'mainterminal'
        ? 'Main Terminal'
        : termRaw === 'southterminal'
        ? 'South Terminal'
        : parts[1];
    const lvlRaw = parts.slice(2).join('-');
    const m = lvlRaw.match(/^level(\d+)$/i);
    const lvl = m ? `Level ${m[1]}` : lvlRaw;
    return `${term} - ${lvl}`;
  }
  return floorId;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

  // 1. 優先讀取本機 / OCI 快取檔案 (非強制刷新)
  if (!refresh) {
    try {
      const candidatePaths = [
        path.join(process.cwd(), 'public', 'yvr_indoor_pois.json'),
        path.join(process.cwd(), 'frontend', 'public', 'yvr_indoor_pois.json'),
        path.join(process.cwd(), '..', 'backend', 'data', 'yvr_indoor_pois.json'),
        path.join(process.cwd(), 'backend', 'data', 'yvr_indoor_pois.json'),
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed && Array.isArray(parsed.pois) && parsed.pois.length > 0) {
            return NextResponse.json(parsed, {
              headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
            });
          }
        }
      }
    } catch (e) {
      console.warn('[YVR Indoor API] 讀取本機快取失敗:', e);
    }
  }

  // 2. 嘗試由 OCI Backend 取得或即時解析 map.yvr.ca
  const backendBase = getServerBackendUrl();
  try {
    const res = await fetch(`${backendBase}/api/yvr/indoor-pois${refresh ? '?refresh=true' : ''}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.pois) && data.pois.length > 0) {
        return NextResponse.json(data, {
          headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
        });
      }
    }
  } catch {
    // Fallback to direct live fetch
  }

  // 3. 最後回退方案：直接經 map.yvr.ca/config.json 動態解析最新 pois-3.0-yvr.json
  try {
    let accountId = 'A1BUZ3C41188B8';
    let venueId = 'yvr';
    try {
      const cfgRes = await fetch(YVR_CONFIG_URL, { signal: AbortSignal.timeout(8000) });
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        const loader = cfg?.plugins?.venueDataLoader;
        if (loader?.accountId) accountId = loader.accountId;
        if (loader?.venueId) venueId = loader.venueId;
      }
    } catch {
      // Use defaults
    }

    const manRes = await fetch(`https://a.locuslabs.com/accounts/${accountId}/v5.json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!manRes.ok) {
      return NextResponse.json({ error: `YVR LocusLabs manifest 回傳狀態 ${manRes.status}` }, { status: manRes.status });
    }
    const manifest = await manRes.json();
    const files = manifest?.[venueId]?.files || manifest?.yvr?.files || {};
    if (!files.pois) {
      return NextResponse.json({ error: '無法解析 pois-3.0-yvr.json URL' }, { status: 502 });
    }

    const [poisRes, vdRes] = await Promise.all([
      fetch(files.pois, { signal: AbortSignal.timeout(15000) }),
      files.venueData ? fetch(files.venueData, { signal: AbortSignal.timeout(12000) }) : Promise.resolve(null),
    ]);
    if (!poisRes.ok) {
      return NextResponse.json({ error: `pois-3.0-yvr.json 回傳狀態 ${poisRes.status}` }, { status: poisRes.status });
    }
    const rawPoisObj = await poisRes.json();
    const rawPois = Array.isArray(rawPoisObj) ? rawPoisObj : Object.values(rawPoisObj || {});

    let rawStructures: Record<string, any> = {};
    if (vdRes && vdRes.ok) {
      const vdJson = await vdRes.json();
      rawStructures = vdJson?.yvr?.structures || vdJson?.structures || {};
    }

    const floorLookup: Record<string, string> = {};
    const termByFloor: Record<string, string> = {};
    for (const [sid, sval] of Object.entries(rawStructures)) {
      const sName = sval?.name || sid;
      for (const [lid, lval] of Object.entries<any>(sval?.levels || {})) {
        floorLookup[lid] = `${sName} - ${lval?.name || lid}`;
        termByFloor[lid] = sid;
      }
    }

    const counts: Record<string, number> = {};
    const pois = (rawPois as any[])
      .map((p, idx) => {
        const lat = Number(p?.position?.latitude);
        const lon = Number(p?.position?.longitude);
        const floorId = String(p?.position?.floorId || '').trim();
        const name = String(p?.name || '').trim();
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !floorId || !name) return null;
        counts[floorId] = (counts[floorId] || 0) + 1;
        const termId = termByFloor[floorId] || floorId.split('-').slice(0, 2).join('-');
        const links = Array.isArray(p?.links)
          ? p.links
              .map((l: any) => {
                const u = normalizeUrl(typeof l === 'string' ? l : l?.url);
                return u ? { url: u, type: l?.type || 'website', displayName: l?.displayName || '' } : null;
              })
              .filter(Boolean)
          : [];
        return {
          poiId: String(p?.poiId || idx),
          name,
          category: String(p?.category || 'services'),
          terminalId: termId,
          floorId,
          floorLabel: formatFloorId(floorId, floorLookup),
          latitude: lat,
          longitude: lon,
          operationHours: p?.operationHours || null,
          phone: p?.phone || null,
          isAfterSecurity: typeof p?.isAfterSecurity === 'boolean' ? p.isAfterSecurity : null,
          description: p?.description || null,
          nearbyLandmark: p?.nearbyLandmark || null,
          gate: p?.gate || null,
          isNavigable: p?.isNavigable !== false,
          links,
          keywords: [],
        };
      })
      .filter(Boolean);

    const terminals = Object.entries(rawStructures)
      .map(([sid, sval]) => {
        const levels = Object.entries<any>(sval?.levels || {})
          .map(([lid, lval]) => ({
            id: lid,
            name: lval?.name || lid,
            details: lval?.details || '',
            ordinal: Number(lval?.ordinal || 0),
            poiCount: counts[lid] || 0,
            boundsPolygon: Array.isArray(lval?.boundsPolygon)
              ? lval.boundsPolygon
                  .map((pt: any) =>
                    Array.isArray(pt) && pt.length >= 2
                      ? [Number(pt[1]), Number(pt[0])]
                      : pt?.lat != null && pt?.lng != null
                      ? [Number(pt.lng), Number(pt.lat)]
                      : null
                  )
                  .filter(Boolean)
              : [],
          }))
          .sort((a, b) => a.ordinal - b.ordinal);
        if (!levels.some((l) => l.poiCount > 0 || l.boundsPolygon.length > 0)) return null;
        return {
          id: sid,
          name: sval?.name || sid,
          nameZh: sid.includes('main') ? '主客運大樓 (Main Terminal)' : sid.includes('south') ? '南客運大樓 (South Terminal)' : sval?.name || sid,
          defaultLevelId: sval?.defaultLevelId || levels[0]?.id || '',
          levels,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ updated_at: new Date().toISOString(), total_count: pois.length, terminals, pois });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '無法取得 YVR 機場內部地圖資料' }, { status: 502 });
  }
}
