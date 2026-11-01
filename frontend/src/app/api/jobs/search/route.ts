import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
    }

    const body: Record<string, any> = { ...rawBody };
    if (typeof body.SearchKeywords === 'string') {
      body.SearchKeywords = body.SearchKeywords.slice(0, 150);
    }
    if (typeof body.Keywords === 'string') {
      body.Keywords = body.Keywords.slice(0, 150);
    }
    if (body.PageSize !== undefined) {
      const parsedSize = Number(body.PageSize);
      body.PageSize = Number.isFinite(parsedSize) ? Math.min(Math.max(Math.trunc(parsedSize), 1), 50) : 20;
    }
    if (body.Page !== undefined) {
      const parsedPage = Number(body.Page);
      body.Page = Number.isFinite(parsedPage) ? Math.min(Math.max(Math.trunc(parsedPage), 1), 500) : 1;
    }

    if (!body.SearchLocations || (Array.isArray(body.SearchLocations) && body.SearchLocations.length === 0)) {
      body.SearchLocations = [{ City: "Vancouver", Postal: "", Region: "" }];
    }
    if (body.SearchLocationDistance === undefined || body.SearchLocationDistance === null) {
      body.SearchLocationDistance = -1;
    }

    const res = await fetch('https://dev-api-jobboard.workbc.ca/api/Search/JobSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `WorkBC API error (${res.status})` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Job search proxy error:', err);
    return NextResponse.json({ error: 'Job search service temporarily unavailable' }, { status: 502 });
  }
}
