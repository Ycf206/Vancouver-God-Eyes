import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getVancouverSeason(): string {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  const m = pctNow.getUTCMonth() + 1;
  const d = pctNow.getUTCDate();
  const y = pctNow.getUTCFullYear();
  if (m > 4 || (m === 4 && d >= 25)) {
    return `${y}${y + 1}`;
  }
  return `${y - 1}${y}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get('season')?.trim() || getVancouverSeason();
  const isRefresh = searchParams.get('refresh') === 'true' || searchParams.get('force') === 'true';

  // 1. 嘗試後端代理 (Docker 內部網路 / 本地開發)
  const backendCandidates = [
    process.env.INTERNAL_BACKEND_URL,
    process.env.NODE_ENV === 'production' ? 'http://backend:8000' : 'http://127.0.0.1:8000',
    'http://127.0.0.1:8000'
  ].filter(Boolean) as string[];

  for (const bUrl of backendCandidates) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(`${bUrl}/api/sports/canucks-schedule?season=${season}${isRefresh ? '&refresh=true' : ''}`, {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(tid);
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.games) && json.games.length > 0) {
          return NextResponse.json(json, {
            headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
          });
        }
      }
    } catch {}
  }

  // 2. 嘗試讀取本地磁碟快取
  const diskCandidates = [
    path.join(process.cwd(), 'backend', 'data', `vancouver_canucks_schedule_${season}.json`),
    path.join(process.cwd(), '..', 'backend', 'data', `vancouver_canucks_schedule_${season}.json`),
    path.join(process.cwd(), 'frontend', 'public', `vancouver_canucks_schedule_${season}.json`),
    path.join(process.cwd(), 'public', `vancouver_canucks_schedule_${season}.json`)
  ];

  for (const p of diskCandidates) {
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (d && Array.isArray(d.games) && d.games.length > 0) {
          return NextResponse.json(d, {
            headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
          });
        }
      } catch {}
    }
  }

  // 3. Fallback: 直接向 NHL 官方 API 請求
  try {
    const nhlRes = await fetch(`https://api-web.nhle.com/v1/club-schedule-season/VAN/${season}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      cache: 'no-store'
    });
    if (nhlRes.ok) {
      const nhlJson = await nhlRes.json();
      if (nhlJson && Array.isArray(nhlJson.games)) {
        const formatted = {
          success: true,
          season,
          updated_at: new Date().toISOString(),
          clubTimezone: nhlJson.clubTimezone || 'America/Vancouver',
          totalGames: nhlJson.games.length,
          games: nhlJson.games
        };
        return NextResponse.json(formatted, {
          headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
        });
      }
    }
  } catch (e: any) {
    console.warn('Direct NHL fetch warning:', e?.message);
  }

  return NextResponse.json(
    { success: false, season, games: [], totalGames: 0, error: '暫時無法取得賽事排程' },
    { status: 502 }
  );
}
