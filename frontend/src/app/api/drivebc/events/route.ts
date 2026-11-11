import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isRefresh = searchParams.get('refresh') === 'true' || searchParams.get('force') === 'true';

  // 1. 若使用者要求強制手動刷新，優先向後端 OCI FastAPI 請求即時抓取最新 Drive BC 事件
  if (isRefresh) {
    try {
      const backendUrl = `${getApiUrl()}/api/drivebc/events?force=true`;
      const res = await fetch(backendUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // 後端若連線暫時不可達，降級使用磁碟原子快取
    }
  }

  // 2. 本地磁碟原子快取 (0ms 極速無卡頓)
  const candidatePaths = [
    path.join(process.cwd(), 'public', 'vancouver_drivebc_events.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'vancouver_drivebc_events.json'),
    path.join(process.cwd(), 'backend', 'data', 'vancouver_drivebc_events.json')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        if (data && ((Array.isArray(data.events) && data.events.length > 0) || (Array.isArray(data) && data.length > 0))) {
          return NextResponse.json(data, {
            headers: {
              'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
            }
          });
        }
      } catch {
        // continue to next path
      }
    }
  }

  // 3. 嘗試一般代理後端 OCI
  try {
    const backendUrl = `${getApiUrl()}/api/drivebc/events`;
    const res = await fetch(backendUrl, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    success: false,
    events: [],
    error: '暫無可用的 Drive BC 事件資料'
  }, { status: 503 });
}
