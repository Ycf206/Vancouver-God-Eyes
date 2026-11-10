import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getFriendlyErrorMessage(status: number, rawText: string, interval: string, range: string): string {
  try {
    const json = JSON.parse(rawText);
    const desc = json?.chart?.error?.description || '';
    if (desc) {
      if (desc.includes('data not available for range')) {
        return `「${interval}」K線週期不支援目前選取的「${range}」時間範圍（分鐘級數據如 1m 僅支援 7 天以內範圍）。請縮小時間範圍或將週期改為「1d」。`;
      }
      return `Yahoo Finance: ${desc}`;
    }
  } catch {}

  if (status === 422) {
    return `K線週期「${interval}」與時間範圍「${range}」不相容。請縮小時間範圍或選擇較大週期（如 1d）。`;
  }
  if (status === 404) {
    return '查無此股票代號之報價數據，請確認代號是否正確。';
  }
  return `Yahoo Finance API 回傳錯誤 (${status})`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  let interval = searchParams.get('interval')?.trim() || '1d';
  let range = searchParams.get('range')?.trim() || '1mo';
  const period1 = searchParams.get('period1')?.trim();
  const period2 = searchParams.get('period2')?.trim();
  const includePrePost = searchParams.get('includePrePost') === 'true';

  if (!symbol) {
    return NextResponse.json({ success: false, error: '請輸入股票代號 (如 TSLA, RY.TO)' }, { status: 400 });
  }

  // 預防性檢查：避免 Yahoo Finance 422 Unprocessable Entity
  if (interval === '1m' && !period1 && ['1mo', '3mo', '6mo', '1y', '5y', 'max'].includes(range)) {
    range = '5d';
  } else if (['2m', '5m', '15m', '30m'].includes(interval) && !period1 && ['3mo', '6mo', '1y', '5y', 'max'].includes(range)) {
    range = '1mo';
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

    let res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      const friendlyMsg = getFriendlyErrorMessage(res.status, errorText, interval, range);
      return NextResponse.json({
        success: false,
        error: friendlyMsg
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
