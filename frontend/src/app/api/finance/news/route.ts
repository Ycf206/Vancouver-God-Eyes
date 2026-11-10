import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export interface FinanceNewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishTime: number; // unix timestamp in seconds
  thumbnail?: string;
  summary?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() || 'market';

  const newsItems: FinanceNewsItem[] = [];

  // 1. Yahoo Finance Search News API
  try {
    const yfUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=25`;
    const yfRes = await fetch(yfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (yfRes.ok) {
      const data = await yfRes.json();
      const articles = data?.news || [];
      for (const item of articles) {
        if (!item.title || !item.link) continue;
        let thumb = '';
        if (item.thumbnail?.resolutions && item.thumbnail.resolutions.length > 0) {
          thumb = item.thumbnail.resolutions[item.thumbnail.resolutions.length - 1].url || '';
        }
        newsItems.push({
          id: item.uuid || item.link,
          title: item.title,
          publisher: item.publisher || 'Yahoo Finance',
          link: item.link,
          publishTime: item.providerPublishTime || Math.floor(Date.now() / 1000),
          thumbnail: thumb,
          summary: item.summary || ''
        });
      }
    }
  } catch (e) {
    console.warn('[Finance News] Yahoo API fetch failed, falling back to RSS:', e);
  }

  // 2. CBC Business RSS (Canada Focus)
  try {
    const cbcRes = await fetch('https://www.cbc.ca/cmlink/rss-business', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (cbcRes.ok) {
      const xml = await cbcRes.text();
      const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
      for (const itemXml of itemMatches.slice(0, 15)) {
        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
        const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
        const descMatch = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i) || itemXml.match(/<description>(.*?)<\/description>/i);

        if (titleMatch && linkMatch) {
          const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
          const link = linkMatch[1].trim();
          const pubDate = pubDateMatch ? Math.floor(new Date(pubDateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000);
          const rawDesc = descMatch ? descMatch[1] : '';
          const cleanDesc = rawDesc.replace(/<[^>]+>/g, '').trim();

          // 擷取圖片 (若有 img src)
          const imgMatch = rawDesc.match(/src=["'](.*?)["']/i);
          const thumb = imgMatch ? imgMatch[1] : '';

          newsItems.push({
            id: link,
            title,
            publisher: 'CBC Business (Canada)',
            link,
            publishTime: isNaN(pubDate) ? Math.floor(Date.now() / 1000) : pubDate,
            thumbnail: thumb,
            summary: cleanDesc.slice(0, 200)
          });
        }
      }
    }
  } catch (e) {
    console.warn('[Finance News] CBC RSS fetch failed:', e);
  }

  // 3. 去重與依時間由新至舊排序
  const seenUrls = new Set<string>();
  const uniqueItems = newsItems.filter(item => {
    if (seenUrls.has(item.link)) return false;
    seenUrls.add(item.link);
    return true;
  }).sort((a, b) => b.publishTime - a.publishTime);

  return NextResponse.json({
    success: true,
    total: uniqueItems.length,
    news: uniqueItems
  }, {
    headers: {
      'Cache-Control': 'public, max-age=180, stale-while-revalidate=300'
    }
  });
}
