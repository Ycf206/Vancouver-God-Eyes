import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getServerBackendUrl } from '@/utils/serverBackend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isRefresh = searchParams.get('refresh') === 'true' || searchParams.get('force') === 'true';

  // 1. 若使用者要求強制手動刷新，優先向後端 OCI FastAPI 請求即時抓取最新特惠
  if (isRefresh) {
    try {
      const backendUrl = `${getServerBackendUrl()}/api/shopping/flyers?force=true`;
      const res = await fetch(backendUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
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
    path.join(process.cwd(), 'public', 'vancouver_flipp_flyers.json'),
    path.join(process.cwd(), 'frontend', 'public', 'vancouver_flipp_flyers.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'vancouver_flipp_flyers.json'),
    path.join(process.cwd(), 'backend', 'data', 'vancouver_flipp_flyers.json')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.merchants) && data.merchants.length > 0) {
          return NextResponse.json(data, {
            headers: {
              'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600'
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
    const backendUrl = `${getServerBackendUrl()}/api/shopping/flyers`;
    const res = await fetch(backendUrl, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    success: false,
    merchants: [],
    error: '暫無可用的超市特惠傳單資料'
  }, { status: 503 });
}
