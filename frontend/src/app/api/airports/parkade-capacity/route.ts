import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Cache for ParkadeCapacity to prevent spamming
let cachedData: any = null;
let lastFetchTime = 0;

export async function GET() {
  const now = Date.now();
  // Return cached result if within 15 seconds
  if (cachedData && (now - lastFetchTime < 15000)) {
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' }
    });
  }

  const url = 'https://www.yvr.ca/_api/ParkadeCapacity';
  const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const headers = [
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '-H', 'Referer: https://www.yvr.ca/en/passengers/parking-yvr',
    '-H', 'Accept: application/json, text/plain, */*'
  ];

  try {
    let stdout = '';
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Referer': 'https://www.yvr.ca/en/passengers/parking-yvr',
          'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        stdout = await res.text();
      }
    } catch {
      // fallback to curl subprocess
    }

    if (!stdout || !stdout.trim().startsWith('{')) {
      const resExec = await execFileAsync(curlBin, ['-s', url, ...headers], { timeout: 7000 });
      stdout = resExec.stdout;
    }

    const json = JSON.parse(stdout);
    const values = json.value || [];
    const zones: Record<string, number> = {};
    let timestamp = new Date().toISOString();

    for (const item of values) {
      if (item.zone) {
        zones[item.zone] = parseInt(item.available || '0', 10);
      }
      if (item.timestamp) {
        timestamp = item.timestamp;
      }
    }

    cachedData = {
      success: true,
      timestamp,
      zones,
      raw: values
    };
    lastFetchTime = now;

    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' }
    });
  } catch (err: any) {
    console.error('Error fetching ParkadeCapacity:', err?.message);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }
    // 嚴禁虛構/預設假資料，失敗時回傳真實狀態
    return NextResponse.json({
      success: false,
      timestamp: new Date().toISOString(),
      zones: {},
      error: err?.message
    });
  }
}
