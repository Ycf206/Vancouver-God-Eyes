import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getVancouverWhitecapsSeason(): number {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  return pctNow.getUTCFullYear();
}

const MLS_SEASON_IDS: Record<number, string> = {
  2027: 'MLS-SEA-0002KB',
  2026: 'MLS-SEA-0001KA',
  2025: 'MLS-SEA-0001K9',
  2024: 'MLS-SEA-0001K8',
  2023: 'MLS-SEA-0001K7',
  2022: 'MLS-SEA-0001K6',
  2021: 'MLS-SEA-0001K5',
  2020: 'MLS-SEA-0001K4',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get('year') || searchParams.get('season');
  const targetYear = yearParam ? parseInt(yearParam, 10) : getVancouverWhitecapsSeason();
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
      const res = await fetch(`${bUrl}/api/sports/whitecaps-schedule?year=${targetYear}${isRefresh ? '&refresh=true' : ''}`, {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(tid);
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.matches) && json.matches.length > 0) {
          return NextResponse.json(json, {
            headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
          });
        }
      }
    } catch {}
  }

  // 2. 嘗試讀取本地磁碟快取
  const diskCandidates = [
    path.join(process.cwd(), '..', 'backend', 'data', `vancouver_whitecaps_schedule_${targetYear}.json`),
    path.join(process.cwd(), 'public', `vancouver_whitecaps_schedule_${targetYear}.json`),
    path.join(process.cwd(), 'backend', 'data', `vancouver_whitecaps_schedule_${targetYear}.json`)
  ];

  for (const p of diskCandidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(content);
        if (json && Array.isArray(json.matches) && json.matches.length > 0) {
          return NextResponse.json(json, {
            headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
          });
        }
      }
    } catch {}
  }

  // 3. 連線官方真實 MLS stats API
  try {
    const seasonId = MLS_SEASON_IDS[targetYear] || 'MLS-SEA-0001KA';
    const apiUrl = `https://stats-api.mlssoccer.com/matches/seasons/${seasonId}?match_date[gte]=${targetYear}-01-01&match_date[lte]=${targetYear}-12-31&team_id=MLS-CLU-00000C&per_page=120&sort=planned_kickoff_time:asc,home_team_name:asc`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      next: { revalidate: 86400 }
    });
    clearTimeout(tid);
    if (res.ok) {
      const data = await res.json();
      const matches = data.schedule || [];
      const payload = {
        success: true,
        season: targetYear,
        season_id: seasonId,
        source_url: apiUrl,
        updated_at: new Date().toISOString(),
        totalMatches: matches.length,
        matches
      };
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
      });
    }
  } catch {}

  return NextResponse.json({
    success: false,
    season: targetYear,
    totalMatches: 0,
    matches: [],
    error: '暫時無法取得 Whitecaps 足球賽程資料'
  }, { status: 500 });
}
