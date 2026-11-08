import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const backendUrl = process.env.INTERNAL_BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : 'http://backend:8000');
  const t = request.nextUrl.searchParams.get('t') || Date.now().toString();

  // Try proxying to backend first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${backendUrl}/api/traffic/jams?t=${t}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data && data.features) {
        return NextResponse.json(data, {
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=120'
          }
        });
      }
    }
  } catch {
    // Backend offline or error
  }

  // 無資料或無 API Key 時嚴格回傳空白，絕不使用任何假自由流或 Rollback 靜態快取
  return NextResponse.json({ type: 'FeatureCollection', features: [] });
}
