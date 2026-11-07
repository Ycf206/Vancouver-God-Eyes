import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
  category?: string;
  imageUrl?: string;
  description?: string;
}

let cachedArticles: NewsArticle[] | null = null;
let lastFetchTime = 0;

export async function GET() {
  const now = Date.now();
  // Cache for 5 minutes
  if (cachedArticles && (now - lastFetchTime < 300000)) {
    return NextResponse.json({ success: true, articles: cachedArticles }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
    });
  }

  const feeds = [
    'https://news.yvr.ca/tagfeed/en-ca/tags/trending',
    'https://news.yvr.ca/tagfeed/en-ca/tags/airmail,import-blog',
    'https://news.yvr.ca/tagfeed/en-ca/tags/project',
    'https://news.yvr.ca/tagfeed/en-ca/tags/values'
  ];

  const headers = [
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '-H', 'Accept: application/rss+xml, application/xml, text/xml, */*'
  ];

  const allArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  for (const feedUrl of feeds) {
    try {
      const { stdout } = await execFileAsync('curl.exe', ['-s', feedUrl, ...headers], { timeout: 6000 });
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
          imageUrl: imageUrl || undefined,
          description: plainDesc ? `${plainDesc}...` : undefined
        });
      }
    } catch (e: any) {
      console.warn(`Failed to fetch feed ${feedUrl}:`, e?.message);
    }
  }

  // Sort by pubDate descending
  allArticles.sort((a, b) => {
    const da = new Date(a.pubDate).getTime() || 0;
    const db = new Date(b.pubDate).getTime() || 0;
    return db - da;
  });

  if (allArticles.length > 0) {
    cachedArticles = allArticles;
    lastFetchTime = now;
  }

  return NextResponse.json({
    success: true,
    articles: cachedArticles || []
  }, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
  });
}
