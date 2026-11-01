import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = (searchParams.get('jobId') || '').trim();

    if (!jobId || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
      return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
    }

    const res = await fetch(`https://workbc-jb.a55eb5-prod.stratus.cloud.gov.bc.ca/api/Search/GetJobDetail?jobId=${encodeURIComponent(jobId)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `WorkBC Detail API error (${res.status})` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Job detail proxy error:', err);
    return NextResponse.json({ error: 'Job detail service temporarily unavailable' }, { status: 502 });
  }
}
