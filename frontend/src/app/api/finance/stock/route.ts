import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  const interval = searchParams.get('interval')?.trim() || '1d';
  const range = searchParams.get('range')?.trim() || '1mo';
  const period1 = searchParams.get('period1')?.trim();
  const period2 = searchParams.get('period2')?.trim();
  const includePrePost = searchParams.get('includePrePost') === 'true';

  if (!symbol) {
    return NextResponse.json({ success: false, error: '請輸入股票代號 (如 TSLA, RY.TO)' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams();
    params.set('interval', interval);
    params.set('includePrePost', includePrePost ? 'true' : 'false');
    params.set('events', 'div,splits');

    if (period1 && period2) {
      params.set('period1', period1);
      params.set('period2', period2);
    } else {
      params.set('range', range);
    }

    const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      return NextResponse.json({
        success: false,
        error: `Yahoo Finance API 回傳錯誤 (${res.status}): ${errorText.slice(0, 100)}`
      }, { status: res.status });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      const err = data?.chart?.error?.description || '查無此股票代號之數據';
      return NextResponse.json({ success: false, error: err }, { status: 404 });
    }

    const meta = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    // 整理精簡 K 線/時間序列資料
    const chartPoints = timestamps.map((ts, idx) => ({
      time: ts,
      open: opens[idx] ?? null,
      high: highs[idx] ?? null,
      low: lows[idx] ?? null,
      close: closes[idx] ?? null,
      volume: volumes[idx] ?? null
    })).filter(pt => pt.close !== null);

    const regularPrice = meta.regularMarketPrice ?? (chartPoints.length > 0 ? chartPoints[chartPoints.length - 1].close : 0);
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? regularPrice;
    const change = regularPrice - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return NextResponse.json({
      success: true,
      data: {
        symbol: meta.symbol || symbol,
        shortName: meta.shortName || meta.symbol || symbol,
        longName: meta.longName || meta.shortName || meta.symbol || symbol,
        currency: meta.currency || 'USD',
        exchangeName: meta.exchangeName || '',
        instrumentType: meta.instrumentType || '',
        firstTradeDate: meta.firstTradeDate,
        regularMarketTime: meta.regularMarketTime,
        timezone: meta.timezone || 'America/New_York',
        regularMarketPrice: regularPrice,
        regularMarketDayHigh: meta.regularMarketDayHigh,
        regularMarketDayLow: meta.regularMarketDayLow,
        regularMarketVolume: meta.regularMarketVolume,
        previousClose: prevClose,
        change,
        changePercent,
        chartPoints
      }
    }, {
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=60'
      }
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: `查詢股票失敗: ${err.message || '網路超時或無法連線'}`
    }, { status: 500 });
  }
}
