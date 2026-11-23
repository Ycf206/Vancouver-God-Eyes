import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const UPSTREAM_BASE = 'https://canadaservicemap.ca';

function stripFrenchFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripFrenchFields);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'nameFr' || k.endsWith('Fr')) continue;
      out[k] = stripFrenchFields(v);
    }
    return out;
  }
  return value;
}

function getBackendInternalUrl(): string {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://backend:8000'
  ).replace(/\/+$/, '');
}

async function fetchDirectFallback(subpath: string, searchParams: URLSearchParams) {
  if (subpath === 'overview') {
    const prov = (searchParams.get('province') || 'bc').toLowerCase();
    const candidates = [
      path.resolve(process.cwd(), 'public', 'canada_public_services.json'),
      path.resolve(process.cwd(), '..', 'backend', 'data', 'canada_public_services.json'),
    ];
    for (const fpath of candidates) {
      try {
        const raw = await fs.readFile(fpath, 'utf-8');
        const full = JSON.parse(raw);
        const provObj = full.provinces?.[prov] || full.provinces?.bc || null;
        const provName = (provObj?.name || '').toLowerCase();
        const matchingBenefits = (full.benefits || []).filter((b: any) => {
          const w = String(b.where || '').toLowerCase();
          return w === 'canada' || (provName && w === provName);
        });
        return NextResponse.json({
          status: 'ok',
          source: full.source,
          source_url: full.source_url,
          disclaimer: full.disclaimer,
          licence: full.licence,
          updated_at: full.updated_at,
          last_reviewed: full.last_reviewed,
          total_count: full.total_count,
          categories: full.categories || [],
          services: full.services || [],
          provinces_index: full.provinces_index || [],
          province: provObj,
          benefits: matchingBenefits,
        });
      } catch {
        // try next file
      }
    }
  }

  let upstreamUrl: string | null = null;
  if (subpath === 'find') {
    const q = searchParams.get('q') || '';
    const near = searchParams.get('near') || '';
    upstreamUrl = `${UPSTREAM_BASE}/api/find?q=${encodeURIComponent(q)}${near ? `&near=${encodeURIComponent(near)}` : ''}`;
  } else if (subpath.startsWith('service/')) {
    const id = subpath.slice('service/'.length);
    const prov = searchParams.get('province') || '';
    upstreamUrl = `${UPSTREAM_BASE}/api/services/${encodeURIComponent(id)}${prov ? `?province=${encodeURIComponent(prov)}` : ''}`;
  } else if (subpath === 'places') {
    const near = searchParams.get('near') || 'Vancouver';
    const type = searchParams.get('type') || 'service-canada-centres';
    upstreamUrl = `${UPSTREAM_BASE}/api/places?near=${encodeURIComponent(near)}&type=${encodeURIComponent(type)}`;
  } else if (subpath === 'bodies') {
    const q = searchParams.get('q') || '';
    const prov = searchParams.get('province') || '';
    upstreamUrl = `${UPSTREAM_BASE}/api/bodies/search?q=${encodeURIComponent(q)}${prov ? `&province=${encodeURIComponent(prov)}` : ''}`;
  } else if (subpath.startsWith('body/')) {
    const id = subpath.slice('body/'.length);
    upstreamUrl = `${UPSTREAM_BASE}/api/bodies/${encodeURIComponent(id)}`;
  }

  if (upstreamUrl) {
    const up = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'VancouverGodsEye/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (up.ok) {
      const json = await up.json();
      return NextResponse.json(stripFrenchFields(json));
    }
  }

  return NextResponse.json(
    { status: 'error', error: 'Unable to reach Public Services backend or Canada Service Map API.' },
    { status: 502 }
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await context.params;
  const subpath = (pathSegments || []).join('/');
  const qs = request.nextUrl.searchParams.toString();

  const candidates = Array.from(
    new Set([getBackendInternalUrl(), 'http://127.0.0.1:8000', 'http://localhost:8000'])
  );

  for (const base of candidates) {
    try {
      const target = `${base}/api/public-services/${subpath}${qs ? `?${qs}` : ''}`;
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
      // try next backend candidate
    }
  }

  try {
    return await fetchDirectFallback(subpath, request.nextUrl.searchParams);
  } catch {
    return NextResponse.json(
      { status: 'error', error: 'Public services data is temporarily unavailable.' },
      { status: 502 }
    );
  }
}
