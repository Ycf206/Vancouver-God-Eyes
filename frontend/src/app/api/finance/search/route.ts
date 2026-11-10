import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export interface StockSuggestionItem {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ success: true, suggestions: [] });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, suggestions: [] }, { status: res.status });
    }

    const data = await res.json();
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];

    const suggestions: StockSuggestionItem[] = quotes
      .filter((item: any) => item.symbol)
      .slice(0, 8)
      .map((item: any) => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || item.symbol,
        exchange: item.exchDisp || item.exchange || '',
        type: item.quoteType || 'EQUITY'
      }));

    return NextResponse.json({
      success: true,
      suggestions
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120'
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      suggestions: []
    });
  }
}
