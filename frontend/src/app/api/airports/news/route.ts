import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
  category: string;
  imageUrl?: string;
  description?: string;
}

let cachedArticles: NewsArticle[] | null = null;
let lastFetchTime = 0;

function loadDiskCache(): NewsArticle[] {
  const candidates = [
    path.join(process.cwd(), 'frontend', 'public', 'data', 'yvr_news.json'),
    path.join(process.cwd(), 'public', 'data', 'yvr_news.json'),
    path.join(process.cwd(), 'backend', 'data', 'yvr_news_rss.json'),
    path.join(process.cwd(), '..', 'frontend', 'public', 'data', 'yvr_news.json'),
    path.join(process.cwd(), '..', 'backend', 'data', 'yvr_news_rss.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          return list.map(item => ({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || item.pub_date || '',
            category: item.category ? (item.category.includes('Airmail') || item.category.includes('航空') ? '航空專欄' : item.category.includes('Trending') || item.category.includes('趨勢') ? '焦點趨勢' : item.category.includes('project') || item.category.includes('專案') ? '機場工程' : item.category) : '官方公告',
            imageUrl: item.image || item.imageUrl || undefined,
            description: item.description || item.summary || ''
          }));
        }
      } catch {}
    }
  }
  return [];
}

export async function GET() {
  const now = Date.now();
  // Cache for 10 minutes
  if (cachedArticles && (now - lastFetchTime < 600000)) {
    return NextResponse.json(cachedArticles, {
      headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=1200' }
    });
  }

  const feeds = [
    { url: 'https://news.yvr.ca/tagfeed/en-ca/tags/airmail,import-blog', category: '航空專欄' },
    { url: 'https://news.yvr.ca/tagfeed/en-ca/tags/trending', category: '焦點趨勢' },
    { url: 'https://news.yvr.ca/tagfeed/en-ca/tags/project', category: '機場專案' },
    { url: 'https://news.yvr.ca/tagfeed/en-ca/tags/values', category: '社區發展' }
  ];

  const headers = [
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '-H', 'Accept: application/rss+xml, application/xml, text/xml, */*'
  ];

  const allArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  for (const feed of feeds) {
    try {
      const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
      const { stdout } = await execFileAsync(curlBin, ['-s', feed.url, ...headers], { timeout: 6000 });
      if (!stdout || !stdout.includes('<item>')) continue;

      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(stdout)) !== null) {
        const itemBlock = match[1];

        const titleMatch = itemBlock.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const linkMatch = itemBlock.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
        const pubDateMatch = itemBlock.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const descMatch = itemBlock.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        const imgMatch = itemBlock.match(/<enclosure\s+url="([^"]+)"|<pp:image>([^<]+)<\/pp:image>/);

        const title = titleMatch ? titleMatch[1].trim() : '';
        const link = linkMatch ? linkMatch[1].trim() : '';
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
        const rawDesc = descMatch ? descMatch[1] : '';
        const plainDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 180);
        const imageUrl = imgMatch ? (imgMatch[1] || imgMatch[2] || '').trim() : '';

        if (!title || !link || seenUrls.has(link)) continue;
        seenUrls.add(link);

        allArticles.push({
          title,
          link,
          pubDate,
          category: feed.category,
          imageUrl: imageUrl || undefined,
          description: plainDesc ? `${plainDesc}...` : undefined
        });
      }
    } catch {}
  }

  if (allArticles.length === 0) {
    const diskFallback = loadDiskCache();
    if (diskFallback.length > 0) {
      cachedArticles = diskFallback;
      lastFetchTime = now;
      return NextResponse.json(cachedArticles, {
        headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=1200' }
      });
    }
  } else {
    // Sort descending by date
    allArticles.sort((a, b) => {
      const da = new Date(a.pubDate).getTime() || 0;
      const db = new Date(b.pubDate).getTime() || 0;
      return db - da;
    });

    cachedArticles = allArticles;
    lastFetchTime = now;
  }

  return NextResponse.json(cachedArticles || [], {
    headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=1200' }
  });
}
