import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getVancouverSeason(): string {
  const pctNow = new Date(Date.now() - 7 * 3600 * 1000);
  const m = pctNow.getUTCMonth() + 1;
  const y = pctNow.getUTCFullYear();
  if (m >= 5) {
    return `${y}${y + 1}`;
  }
  return `${y - 1}${y}`;
}

export async function GET() {
  const currentSeason = getVancouverSeason();
  const curStartYear = parseInt(currentSeason.slice(0, 4), 10);
  const seasons = [];
  for (let y = curStartYear; y >= 2020; y--) {
    seasons.push({
      code: `${y}${y + 1}`,
      label: `${y} - ${y + 1}`
    });
  }
  return NextResponse.json({
    currentSeason,
    seasons
  }, {
    headers: { 'Cache-Control': 'public, max-age=86400' }
  });
}
