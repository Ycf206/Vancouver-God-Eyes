import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase();
  const pathname = request.nextUrl.pathname;
  const isLocalDev = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const isAdminHost = host.startsWith('admin.') || host.includes('admin.localhost');

  // 1. 如果從獨立子網域 admin.vangodseye.fyi 訪問
  if (isAdminHost) {
    const response =
      pathname === '/'
        ? NextResponse.rewrite(new URL('/admin', request.url))
        : NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  }

  // 2. 如果在公開主站 (vangodseye.fyi) 試圖直接探測 /admin，直接回傳 404 隱藏後台子網域，防範掃描器偵測
  if (pathname.startsWith('/admin') && !isLocalDev) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/admin/:path*', '/admin']
};
