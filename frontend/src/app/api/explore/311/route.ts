import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const backendBase = process.env.INTERNAL_BACKEND_URL || 'http://127.0.0.1:8000';

  // 1. 若有指定日期，優先檢查本地快取檔
  if (date) {
    const localDateFile = path.join(process.cwd(), '..', 'backend', 'data', '311_dates', `311_${date}.json`);
    const feDateFile = path.join(process.cwd(), 'public', 'data', '311_dates', `311_${date}.json`);
    for (const fpath of [localDateFile, feDateFile]) {
      if (fs.existsSync(fpath)) {
        try {
          const content = fs.readFileSync(fpath, 'utf8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return NextResponse.json({ total_count: parsed.length, results: parsed });
          }
        } catch {}
      }
    }

    // 2. 嘗試向後端 FastAPI 查詢
    try {
      const beResp = await fetch(`${backendBase}/api/explore/311?date=${encodeURIComponent(date)}`, {
        cache: 'no-store',
        headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (beResp.ok) {
        const json = await beResp.json();
        return NextResponse.json(json);
      }
    } catch {
      // Backend unavailable, fallback to direct Open Data API
    }

    // 2. 後端未連線時，前端直接查詢溫哥華 OpenData API 抓取該日工單
    try {
      // 容納跨時區 UTC 偏移 (冬令時 PST -8, 夏令時 PDT -7)
      const startUtc = `${date}T06:00:00Z`;
      const nextDay = new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10);
      const endUtc = `${nextDay}T09:00:00Z`;
      const where = `service_request_open_timestamp >= '${startUtc}' and service_request_open_timestamp <= '${endUtc}'`;
      const openDataUrl = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/3-1-1-service-requests/records?where=${encodeURIComponent(where)}&order_by=service_request_open_timestamp%20desc&limit=100`;

      const odResp = await fetch(openDataUrl, {
        headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (odResp.ok) {
        const odData = await odResp.json();
        const results = odData.results || [];
        const matched = results.filter((r: any) => {
          const raw = r.service_request_open_timestamp;
          if (!raw) return false;
          try {
            const vanDate = new Date(raw).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
            return vanDate === date || raw.slice(0, 10) === date;
          } catch {
            return raw.slice(0, 10) === date;
          }
        });
        return NextResponse.json({ total_count: matched.length, results: matched });
      }
    } catch (e: any) {
      console.warn('Next.js API route 311 date fetch error:', e);
    }
    return NextResponse.json({ total_count: 0, results: [] });
  }

  // 3. 無指定日期時，優先由後端提供最新快取，或讀取 public/vancouver_311.json
  try {
    const beResp = await fetch(`${backendBase}/api/explore/311`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (beResp.ok) {
      const json = await beResp.json();
      return NextResponse.json(json);
    }
  } catch {}

  const localFile = path.join(process.cwd(), 'public', 'vancouver_311.json');
  if (fs.existsSync(localFile)) {
    try {
      const content = fs.readFileSync(localFile, 'utf8');
      return NextResponse.json(JSON.parse(content));
    } catch {}
  }

  return NextResponse.json({ total_count: 0, results: [] });
}
