import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const URL_MAP: Record<string, string> = {
  current: 'https://www.bchydro.com/power-outages/app/outages-list-data-current.json',
  restored: 'https://www.bchydro.com/power-outages/app/outages-list-data-restored_14_days.json',
  planned: 'https://www.bchydro.com/power-outages/app/outages-list-data-planned.json',
};

const FILE_MAP: Record<string, string> = {
  current: 'bchydro_outages_current.json',
  restored: 'bchydro_outages_restored.json',
  planned: 'bchydro_outages_planned.json',
  map: 'bchydro_outages_map.geojson',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'current';

  const fileName = FILE_MAP[type] || FILE_MAP.current;
  const refresh = searchParams.get('refresh') === 'true' ? '&refresh=true' : '';

  // 0. 優先代理至後端 FastAPI 取得 OCI 即時快取
  const backendBases = Array.from(
    new Set([
      (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000').replace(/\/+$/, ''),
      'http://127.0.0.1:8000',
      'http://localhost:8000',
    ])
  );
  for (const base of backendBases) {
    try {
      const bRes = await fetch(`${base}/api/bchydro/outages?type=${encodeURIComponent(type)}${refresh}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (bRes.ok) {
        const bJson = await bRes.json();
        return NextResponse.json(bJson, {
          headers: { 'Cache-Control': 'no-cache, max-age=60' },
        });
      }
    } catch {
      // try next backend
    }
  }

  // 1. 次優先嘗試讀取本機快取檔案（優先 backend/data 再到 frontend/public）
  try {
    const candidatePaths = [
      path.join(process.cwd(), '..', 'backend', 'data', fileName),
      path.join(process.cwd(), 'backend', 'data', fileName),
      path.join(process.cwd(), 'public', fileName),
      path.join(process.cwd(), 'frontend', 'public', fileName),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(content);
        return NextResponse.json(json, {
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          },
        });
      }
    }
  } catch (e) {
    console.warn(`[BC Hydro Outages API] 讀取本機快取失敗:`, e);
  }

  // 2. 若快取不存在，即時向 BC Hydro 官方拉取並回傳
  if (type === 'map') {
    return NextResponse.json(
      { type: 'FeatureCollection', features: [] },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
    );
  }
  const remoteUrl = URL_MAP[type] || URL_MAP.current;
  try {
    const res = await fetch(remoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://www.bchydro.com/power-outages/app/outage-map.html',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `BC Hydro API 回傳狀態 ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '無法連線至 BC Hydro 停電服務' }, { status: 502 });
  }
}
