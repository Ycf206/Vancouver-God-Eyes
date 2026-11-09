import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getVancouverWhitecapsSeason(): number {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  return pctNow.getUTCFullYear();
}

export async function GET() {
  const currentSeason = getVancouverWhitecapsSeason();
  const maxYear = Math.max(currentSeason + 1, 2027);
  const seasons = [];
  for (let y = maxYear; y >= 2020; y--) {
    seasons.push({
      year: y,
      label: `${y}`
    });
  }
  return NextResponse.json({
    currentSeason,
    seasons
  }, {
    headers: { 'Cache-Control': 'public, max-age=86400' }
  });
}
