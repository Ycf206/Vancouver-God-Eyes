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

    const res = await fetch('https://workbc-jb.a55eb5-prod.stratus.cloud.gov.bc.ca/api/Search/JobSearch', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': 'https://www.workbc.ca',
        'Referer': 'https://www.workbc.ca/',
        'sec-ch-ua': '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `WorkBC API error (${res.status})` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('WorkBC Search Proxy Error:', error);
    return NextResponse.json(
      { error: 'WorkBC 伺服器無回應，請稍後再試。' },
      { status: 504 }
    );
  }
}
