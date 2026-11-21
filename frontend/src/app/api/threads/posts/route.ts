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
      const target = `${base}/api/threads/posts${qs ? `?${qs}` : ''}`;
      const res = await fetch(target, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
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

  // Fallback to local backend cache file if FastAPI isn't reachable
  try {
    const cachePath = path.resolve(process.cwd(), '..', 'backend', 'data', 'vancouver_threads_posts.json');
    const raw = await fs.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return NextResponse.json(parsed, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      {
        configured: false,
        status: 'unconfigured',
        error: '目前無法連線至後端 Threads 帖文服務，請確認後端服務與 THREADS_ACCESS_TOKEN 設定。',
        updated_at: null,
        profile: null,
        total_all: 0,
        total_count: 0,
        posts: [],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
