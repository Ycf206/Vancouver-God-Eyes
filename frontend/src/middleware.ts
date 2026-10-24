import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // 1. 如果從獨立子網域 admin.vangodseye.fyi 訪問
  if (host.startsWith('admin.') || host.includes('admin.localhost')) {
    // 根目錄自動轉發至後台頁面 /admin
    if (pathname === '/') {
      return NextResponse.rewrite(new URL('/admin', request.url));
    }
    return NextResponse.next();
  }

  // 2. 如果在主站 (vangodseye.fyi) 試圖直接訪問 /admin，安全重導向至獨立子網域
  if (pathname.startsWith('/admin') && !host.startsWith('admin.')) {
    const protocol = request.nextUrl.protocol || 'https:';
    const redirectUrl = `${protocol}//admin.vangodseye.fyi${pathname === '/admin' ? '/' : pathname}`;
    return NextResponse.redirect(redirectUrl, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/admin/:path*', '/admin']
};
