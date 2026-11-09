import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getVancouverBanditsSeason(): number {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  return pctNow.getUTCFullYear();
}

export async function GET() {
  const currentSeason = getVancouverBanditsSeason();
  const maxYear = Math.max(currentSeason + 1, 2026);
  const seasons = [];
  for (let y = maxYear; y >= 2020; y--) {
    seasons.push({
      year: y,
      label: `${y} 賽季`
    });
  }
  return NextResponse.json({
    currentSeason,
    seasons
  }, {
    headers: { 'Cache-Control': 'public, max-age=86400' }
  });
}
