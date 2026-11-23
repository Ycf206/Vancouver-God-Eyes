import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getBackendInternalUrl(): string {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://backend:8000'
  ).replace(/\/+$/, '');
}

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const candidates = Array.from(
    new Set([
      getBackendInternalUrl(),
      'http://127.0.0.1:8000',
      'http://localhost:8000',
    ])
  );

  for (const base of candidates) {
    try {
      const target = `${base}/api/via-rail/live${qs ? `?${qs}` : ''}`;
      const res = await fetch(target, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    } catch {
      // Try next backend candidate
    }
  }

  try {
    const cachePath = path.resolve(process.cwd(), '..', 'backend', 'data', 'vancouver_via_rail_live.json');
    const raw = await fs.readFile(cachePath, 'utf-8');
    return NextResponse.json(JSON.parse(raw), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        error: '目前無法連線至後端 VIA Rail 即時服務',
        updated_at: null,
        total_count: 0,
        in_service_count: 0,
        in_service_gps_count: 0,
        not_in_service_count: 0,
        in_service: [],
        not_in_service: [],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
