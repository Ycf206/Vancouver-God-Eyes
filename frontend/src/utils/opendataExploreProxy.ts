import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface OpenDataExploreConfig {
  backendPath: string;
  datasetSlug: string;
  cacheFilename: string;
  defaultSort: string;
  sortMap: Record<string, string>;
  filterFields: string[];
  dateField: string;
  dateIsDatetime: boolean;
}

function escapeOdsql(val: string): string {
  return val.replace(/[\x00-\x1f\x7f]/g, ' ').trim().replace(/\\/g, '').replace(/'/g, "''");
}

async function fetchYesterdayCount(datasetSlug: string): Promise<number | null> {
  try {
    // 卑詩省永久太平洋時間 (PCT = UTC-7)
    const pctYesterdayMs = Date.now() - 7 * 3600 * 1000 - 86400 * 1000;
    const yStr = new Date(pctYesterdayMs).toISOString().slice(0, 10);

    let whereExpr = '';
    if (datasetSlug === 'business-licences') {
      const nextDay = new Date(pctYesterdayMs + 86400 * 1000).toISOString().slice(0, 10);
      whereExpr = `extractdate >= '${yStr}T07:00:00Z' and extractdate <= '${nextDay}T06:59:59Z'`;
    } else {
      whereExpr = `issuedate = date'${yStr}'`;
    }
    const odUrl = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/${datasetSlug}/records?lang=en&limit=0&where=${encodeURIComponent(whereExpr)}`;
    const r = await fetch(odUrl, {
      headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.total_count === 'number' ? j.total_count : null;
  } catch {
    return null;
  }
}

interface CachedExplorePayload {
  api_total_count?: number;
  yesterday_count?: number | null;
  latest_recency_date?: string | null;
  facets?: Record<string, unknown>;
  results?: Record<string, unknown>[];
  updated_at?: string | null;
}

function readLocalCache(cacheFilename: string): CachedExplorePayload | null {
  const candidates = [
    path.join(process.cwd(), '..', 'backend', 'data', cacheFilename),
    path.join(process.cwd(), 'public', cacheFilename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as CachedExplorePayload;
      } catch {
        // try next
      }
    }
  }
  return null;
}

function extractCoords(row: Record<string, unknown>): { lat: number | null; lon: number | null } {
  const gp = row?.geo_point_2d as { lat?: unknown; lon?: unknown } | undefined;
  if (gp && typeof gp.lat === 'number' && typeof gp.lon === 'number') {
    return { lat: gp.lat, lon: gp.lon };
  }
  const rawGeom = row?.geom as { geometry?: { type?: unknown; coordinates?: unknown }; type?: unknown; coordinates?: unknown } | undefined;
  const geom = rawGeom?.geometry || rawGeom;
  if (geom?.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    return { lat: Number(geom.coordinates[1]), lon: Number(geom.coordinates[0]) };
  }
  return { lat: null, lon: null };
}

function normalizeRecord(datasetSlug: string, row: Record<string, unknown>) {
  const { lat, lon } = extractCoords(row);
  if (datasetSlug === 'business-licences') {
    return {
      licencenumber: row.licencenumber ?? null,
      businesstype: row.businesstype ?? null,
      businesstradename: row.businesstradename ?? null,
      issueddate: row.issueddate ?? null,
      expireddate: row.expireddate ?? null,
      numberofemployees: row.numberofemployees != null ? Math.round(Number(row.numberofemployees)) : null,
      localarea: row.localarea ?? null,
      status: row.status ?? null,
      extractdate: row.extractdate ?? null,
      lat,
      lon,
    };
  }
  return {
    permitnumber: row.permitnumber ?? null,
    typeofwork: row.typeofwork ?? null,
    permitcategory: row.permitcategory ?? null,
    address: row.address ?? null,
    issuedate: row.issuedate ?? null,
    projectvalue: row.projectvalue != null ? Number(row.projectvalue) : null,
    buildingcontractor: row.buildingcontractor ?? null,
    geolocalarea: row.geolocalarea ?? null,
    projectdescription: row.projectdescription ?? null,
    lat,
    lon,
  };
}

export async function handleExploreOpenDataRequest(request: NextRequest, config: OpenDataExploreConfig) {
  const { searchParams } = new URL(request.url);
  const backendBase = process.env.INTERNAL_BACKEND_URL || 'http://127.0.0.1:8000';

  // 1. Prefer FastAPI backend endpoint (handles OCI disk cache + live ODSQL + facet cache)
  try {
    const qs = searchParams.toString();
    const beUrl = `${backendBase}${config.backendPath}${qs ? `?${qs}` : ''}`;
    const beResp = await fetch(beUrl, {
      cache: 'no-store',
      headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (beResp.ok) {
      return NextResponse.json(await beResp.json(), {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }
  } catch {
    // Fallback to Next.js direct OpenData query / local cache
  }

  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('page_size') || '20', 10) || 20));
  const q = (searchParams.get('q') || '').trim();
  const date = (searchParams.get('date') || '').trim();
  const sortRaw = (searchParams.get('sort') || config.defaultSort).trim();
  const sortKey = config.sortMap[sortRaw] ? sortRaw : config.defaultSort;

  const activeFilters: Record<string, string> = {};
  for (const field of config.filterFields) {
    const val = (searchParams.get(field) || '').trim();
    if (val && val !== 'all') activeFilters[field] = val;
  }

  const cached = readLocalCache(config.cacheFilename);
  const isDefaultFirstPage =
    page === 1 &&
    pageSize <= 20 &&
    !q &&
    !date &&
    Object.keys(activeFilters).length === 0 &&
    sortKey === config.defaultSort;

  if (isDefaultFirstPage && cached?.results?.length) {
    const yesterdayCount = (await fetchYesterdayCount(config.datasetSlug)) ?? cached.yesterday_count ?? null;
    return NextResponse.json({
      total_count: cached.api_total_count || cached.results.length,
      yesterday_count: yesterdayCount,
      page: 1,
      page_size: pageSize,
      latest_recency_date: cached.latest_recency_date || null,
      facets: cached.facets || {},
      results: cached.results.slice(0, pageSize),
      updated_at: cached.updated_at || null,
      source: 'local_cache',
    });
  }

  // 2. Direct Vancouver OpenData v2.1 fallback
  try {
    const whereParts: string[] = [];
    for (const [k, v] of Object.entries(activeFilters)) {
      whereParts.push(`${k} = '${escapeOdsql(v)}'`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (config.dateIsDatetime) {
        const nextDay = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
        whereParts.push(`${config.dateField} >= '${date}T07:00:00Z' and ${config.dateField} <= '${nextDay}T06:59:59Z'`);
      } else {
        whereParts.push(`${config.dateField} = date'${date}'`);
      }
    }
    if (q) {
      const eq = escapeOdsql(q);
      whereParts.push(`search('${eq}')`);
    }

    const offset = Math.min(9900, (page - 1) * pageSize);
    const odParams = new URLSearchParams({
      lang: 'en',
      limit: String(pageSize),
      offset: String(offset),
      order_by: config.sortMap[sortKey],
    });
    if (whereParts.length > 0) odParams.set('where', whereParts.join(' and '));

    const odUrl = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/${config.datasetSlug}/records?${odParams.toString()}`;
    const [odResp, yesterdayCount] = await Promise.all([
      fetch(odUrl, {
        headers: { 'User-Agent': 'VancouverGodsEye/1.0' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }),
      fetchYesterdayCount(config.datasetSlug),
    ]);
    if (odResp.ok) {
      const odData = await odResp.json();
      const results = ((odData.results || []) as Record<string, unknown>[]).map((r) => normalizeRecord(config.datasetSlug, r));
      const firstRow = results[0] as Record<string, unknown> | undefined;
      const latestRecency =
        cached?.latest_recency_date ||
        (firstRow ? (config.datasetSlug === 'business-licences' ? firstRow.extractdate : firstRow.issuedate) : null);

      return NextResponse.json({
        total_count: odData.total_count ?? results.length,
        yesterday_count: yesterdayCount ?? cached?.yesterday_count ?? null,
        page,
        page_size: pageSize,
        latest_recency_date: latestRecency,
        facets: cached?.facets || {},
        results,
        source: 'opendata_direct',
      });
    }
  } catch {
    // Fallback below
  }

  return NextResponse.json({
    total_count: cached?.results?.length || 0,
    yesterday_count: cached?.yesterday_count ?? null,
    page: 1,
    page_size: pageSize,
    latest_recency_date: cached?.latest_recency_date || null,
    facets: cached?.facets || {},
    results: cached?.results?.slice((page - 1) * pageSize, page * pageSize) || [],
    source: 'fallback_cache',
  });
}
