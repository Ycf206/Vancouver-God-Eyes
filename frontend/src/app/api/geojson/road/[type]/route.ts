import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 根據溫哥華當地時間計算時段與費率
function getVancouverHour(): number {
  try {
    const vancouverDateStr = new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' });
    return new Date(vancouverDateStr).getHours();
  } catch {
    const nowUtc = new Date();
    // 溫哥華夏令/冬令大致 UTC-7 / UTC-8
    return (nowUtc.getUTCHours() - 7 + 24) % 24;
  }
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ type: string }> }
) {
  const resolvedParams = props?.params ? await props.params : null;
  const pathParts = request.nextUrl.pathname.split('?')[0].split('/').filter(Boolean);
  const facilityType = resolvedParams?.type || pathParts[pathParts.length - 1];

  // 僅處理 road 下的 parking_meters 和 motorcycle_parking (其他可直接靜態讀取)
  const allowed = ['parking_meters', 'motorcycle_parking', 'accessible_parking'];
  if (!allowed.includes(facilityType)) {
    return NextResponse.json({ type: 'FeatureCollection', features: [] });
  }

  const candidates = [
    path.join(process.cwd(), 'public', `vancouver_${facilityType}.geojson`),
    path.join(process.cwd(), 'frontend', 'public', `vancouver_${facilityType}.geojson`),
    path.join(process.cwd(), 'backend', 'data', `vancouver_${facilityType}.geojson`),
    path.join(process.cwd(), '..', 'public', `vancouver_${facilityType}.geojson`),
    path.join(process.cwd(), '..', 'frontend', 'public', `vancouver_${facilityType}.geojson`),
    path.join(process.cwd(), '..', 'backend', 'data', `vancouver_${facilityType}.geojson`),
  ];
  let filePath = candidates.find(p => fs.existsSync(p));
  let rawData = '';
  if (filePath) {
    rawData = fs.readFileSync(filePath, 'utf-8');
  } else {
    // Fallback to fetch from static server
    try {
      const origin = request.nextUrl.origin || 'http://localhost:3000';
      const staticRes = await fetch(`${origin}/vancouver_${facilityType}.geojson`);
      if (staticRes.ok) {
        rawData = await staticRes.text();
      }
    } catch {}
  }

  if (!rawData) {
    return NextResponse.json({ type: 'FeatureCollection', features: [] });
  }

  try {
    const geojson = JSON.parse(rawData);
    const features = geojson.features || [];

    const searchParams = request.nextUrl.searchParams;
    const timePeriodParam = (searchParams.get('time_period') || 'auto').toLowerCase();
    const maxRateParam = searchParams.get('max_rate') ? parseFloat(searchParams.get('max_rate')!) : null;
    const creditCardOnly = searchParams.get('credit_card_only') === 'true';

    const currentHour = getVancouverHour();
    let activePeriod = 'day';
    if (timePeriodParam === 'night') {
      activePeriod = 'night';
    } else if (timePeriodParam === 'day') {
      activePeriod = 'day';
    } else {
      // auto
      if (currentHour >= 9 && currentHour < 18) {
        activePeriod = 'day';
      } else if (currentHour >= 18 && currentHour < 22) {
        activePeriod = 'night';
      } else {
        activePeriod = 'free'; // 22:00 - 09:00 免費
      }
    }

    const filteredFeatures = [];

    for (const feat of features) {
      const props = { ...(feat.properties || {}) };
      props.active_period = activePeriod;

      // 提取費率
      let rawRate = '';
      if (activePeriod === 'night') {
        rawRate = props.rate_6pm_10pm || props.rate_9am_6pm || props.rate || '';
      } else if (activePeriod === 'free') {
        rawRate = '0';
      } else {
        rawRate = props.rate_9am_6pm || props.r_mf_9a_6p || props.rate || '';
      }

      let rateNum: number | null = null;
      if (activePeriod === 'free') {
        rateNum = 0.0;
      } else {
        const match = String(rawRate).match(/(\d+(?:\.\d+)?)/);
        if (match) {
          rateNum = parseFloat(match[1]);
        }
      }

      props.rate_numeric = rateNum;
      props.effective_rate = activePeriod === 'free' ? '免費' : (rateNum !== null ? `$${rateNum.toFixed(2)}` : '未提供');

      // 篩選 max_rate (當 maxRateParam 在 1~19 範圍時進行過濾，20 或以上代表不限費率)
      if (maxRateParam !== null && maxRateParam > 0 && maxRateParam < 20) {
        if (rateNum !== null && rateNum > maxRateParam) {
          continue;
        }
      }

      // 篩選 credit_card_only
      if (creditCardOnly) {
        const cc = String(props.credit_card || props.creditcard || '').toLowerCase();
        if (!['yes', 'true', '1'].includes(cc)) {
          continue;
        }
      }

      filteredFeatures.push({
        ...feat,
        properties: props
      });
    }

    return NextResponse.json(
      { type: 'FeatureCollection', features: filteredFeatures },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
        }
      }
    );
  } catch (error) {
    console.error(`Error loading ${facilityType} geojson:`, error);
    return NextResponse.json({ type: 'FeatureCollection', features: [] }, { status: 500 });
  }
}
