import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const parsed = new URL(targetUrl);
    const allowedHosts = [
      'ccimg.bcferries.com',
      'www.drivebc.ca',
      'drivebc.ca',
      'images.drivebc.ca',
      'apigateway.bcferries.com',
      'orca.bcferries.com'
    ];
    
    // 如果不是白名單 host
    if (!allowedHosts.includes(parsed.hostname)) {
      return new NextResponse('Host not allowed', { status: 403 });
    }

    const referer = parsed.hostname.includes('drivebc')
      ? 'https://www.drivebc.ca/'
      : 'https://www.bcferries.com/';

    // 嘗試抓取主圖片
    try {
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': referer,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        cache: 'no-store'
      });

      if (fetchRes.ok) {
        const arrayBuffer = await fetchRes.arrayBuffer();
        const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
        return new NextResponse(Buffer.from(arrayBuffer), {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // 主圖片抓取失敗，繼續走 fallback 流程
    }

    // 若主 URL 失敗且屬於 Horseshoe Bay 或 1070，嘗試 DriveBC 228
    if (targetUrl.includes('1070') || targetUrl.includes('HSB')) {
      try {
        const fallbackUrl = 'https://www.drivebc.ca/images/228.jpg';
        const fallbackRes = await fetch(fallbackUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://www.drivebc.ca/',
            'Accept': 'image/*;q=0.8'
          },
          cache: 'no-store'
        });
        if (fallbackRes.ok) {
          const arrayBuffer = await fallbackRes.arrayBuffer();
          return new NextResponse(Buffer.from(arrayBuffer), {
            headers: {
              'Content-Type': fallbackRes.headers.get('content-type') || 'image/jpeg',
              'Cache-Control': 'public, max-age=30',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch {
        // Fallback 遠程請求失敗
      }
    }

    // 若遠程網路暫時無法連線，回傳高品質 SVG 替代畫面，保證不破圖
    const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
      <rect width="640" height="400" fill="#131722"/>
      <rect x="2" y="2" width="636" height="396" fill="none" stroke="#262f45" stroke-width="2" rx="10"/>
      <circle cx="320" cy="170" r="32" fill="#1e2638" stroke="#38bdf8" stroke-width="2"/>
      <path d="M308 160h24v20h-24z" fill="#0284c7" rx="3"/>
      <circle cx="320" cy="170" r="4.5" fill="#f8fafc"/>
      <text x="320" y="235" fill="#e2e8f0" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="14" font-weight="600" text-anchor="middle">即時碼頭影像連線中</text>
      <text x="320" y="260" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="12" text-anchor="middle">Live Signal Standby • 影像排程更新中</text>
    </svg>`;

    return new NextResponse(svgFallback, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=15',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch {
    const errorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
      <rect width="640" height="400" fill="#131722"/>
      <text x="320" y="200" fill="#94a3b8" font-family="sans-serif" font-size="13" text-anchor="middle">即時影像維護中</text>
    </svg>`;
    return new NextResponse(errorSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=15',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
