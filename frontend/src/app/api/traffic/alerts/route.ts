import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const backendUrl = process.env.INTERNAL_BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : 'http://backend:8000');
  const t = request.nextUrl.searchParams.get('t') || Date.now().toString();

  // Try proxying to backend first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(`${backendUrl}/api/traffic/alerts?t=${t}`, {
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
    // Fall back to static file
  }

  // Fallback to static cache
  try {
    let filePath = path.join(process.cwd(), 'public', 'vancouver_traffic_alerts.geojson');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'frontend', 'public', 'vancouver_traffic_alerts.geojson');
    }
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
        }
      });
    }
  } catch {
    // Ignore
  }

  return NextResponse.json({ type: 'FeatureCollection', features: [] });
}
