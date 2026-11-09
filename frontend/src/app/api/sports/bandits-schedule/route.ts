import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getVancouverBanditsSeason(): number {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  return pctNow.getUTCFullYear();
}

const CEBL_API_KEY = '800chyzv2hvur3z0ogh39cve2zok0c';
const CEBL_REFERER = 'https://cebl-stats-hub.web.app/';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get('year') || searchParams.get('season');
  const targetYear = yearParam ? parseInt(yearParam, 10) : getVancouverBanditsSeason();
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
      const res = await fetch(`${bUrl}/api/sports/bandits-schedule?year=${targetYear}${isRefresh ? '&refresh=true' : ''}`, {
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
    path.join(process.cwd(), '..', 'backend', 'data', `vancouver_bandits_schedule_${targetYear}.json`),
    path.join(process.cwd(), 'public', `vancouver_bandits_schedule_${targetYear}.json`),
    path.join(process.cwd(), 'backend', 'data', `vancouver_bandits_schedule_${targetYear}.json`)
  ];

  for (const p of diskCandidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(content);
        if (json && Array.isArray(json.games) && json.games.length > 0) {
          return NextResponse.json(json, {
            headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
          });
        }
      }
    } catch {}
  }

  // 3. 連線官方真實 CEBL API
  try {
    const apiUrl = `https://api.data.cebl.ca/games/${targetYear}/?team_id=16`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'x-api-key': CEBL_API_KEY,
        'Referer': CEBL_REFERER,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 86400 }
    });
    clearTimeout(tid);
    if (res.ok) {
      const games = await res.json();
      const payload = {
        success: true,
        season: targetYear,
        team_id: 16,
        source_url: apiUrl,
        updated_at: new Date().toISOString(),
        totalGames: Array.isArray(games) ? games.length : 0,
        games: Array.isArray(games) ? games : []
      };
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
      });
    }
  } catch {}

  return NextResponse.json({
    success: false,
    season: targetYear,
    totalGames: 0,
    games: [],
    error: '暫時無法取得 Bandits 籃球賽程資料'
  }, { status: 500 });
}
