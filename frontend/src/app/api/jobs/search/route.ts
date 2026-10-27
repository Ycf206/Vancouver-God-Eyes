import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
    });

    if (!res.ok) {
      return NextResponse.json({ error: `WorkBC API error: ${res.statusText}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Job search proxy error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
