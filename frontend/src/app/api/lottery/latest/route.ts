import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 600;

export async function GET() {
  const publicPath = path.join(process.cwd(), 'public', 'vancouver_lottery_cache.json');
  const backendPath = path.join(process.cwd(), '..', 'backend', 'data', 'vancouver_lottery_cache.json');

  // 1. 優先嘗試讀取本機原子快取 (0ms 極速無卡頓)
  for (const p of [publicPath, backendPath]) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(raw);
        if (json && json.draws && Object.keys(json.draws).length > 0) {
          return NextResponse.json(json, {
            headers: {
              'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
            },
          });
        }
      } catch (err) {
        console.warn(`Error reading lottery cache from ${p}:`, err);
      }
    }
  }

  // 2. 次選連線 PlayNow 官方最新開彩 API
  try {
    const res = await fetch('https://www.playnow.com/services2/lotto/draw/latest/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.playnow.com/lottery/',
      },
      next: { revalidate: 3600 },
    });

    if (res.ok) {
      const raw = await res.json();
      return NextResponse.json({
        success: true,
        updated_at: new Date().toISOString(),
        draws: raw,
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        },
      });
    }
  } catch (err) {
    console.error('Failed to fetch live lottery from PlayNow:', err);
  }

  return NextResponse.json(
    { success: false, draws: {}, error: '暫時無法取得最新開彩號碼' },
    { status: 500 }
  );
}
