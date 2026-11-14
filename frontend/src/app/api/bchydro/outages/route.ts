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

  // 1. 優先嘗試讀取本機快取檔案
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'public', fileName),
      path.join(process.cwd(), 'frontend', 'public', fileName),
      path.join(process.cwd(), '..', 'backend', 'data', fileName),
      path.join(process.cwd(), 'backend', 'data', fileName),
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
