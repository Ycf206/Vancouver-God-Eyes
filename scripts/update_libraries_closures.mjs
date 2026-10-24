import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const BACKEND_FILE = path.join(rootDir, 'backend/data/vancouver_libraries.geojson');
const FRONTEND_FILE = path.join(rootDir, 'frontend/public/vancouver_libraries.geojson');

async function main() {
  console.log('📚 啟動溫哥華市立圖書館年度閉館行事曆更新排程 (Annual VPL Upcoming Closures Update)...');
  
  if (!fs.existsSync(BACKEND_FILE)) {
    console.error(`❌ 找不到圖書館資料檔案: ${BACKEND_FILE}`);
    process.exit(1);
  }

  const libData = JSON.parse(fs.readFileSync(BACKEND_FILE, 'utf8'));
  const currentYear = new Date().getFullYear();

  // 嘗試從 VPL 官方網站爬取最新假日閉館清單
  let closures = [];
  try {
    const res = await fetch('https://www.vpl.ca/hours-locations', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.ok) {
      const html = await res.text();
      // 解析假日與閉館文字
      const matches = html.match(/(?:Closed|Closing early)[^<]*/gi);
      if (matches && matches.length > 0) {
        closures = Array.from(new Set(matches.map(m => m.trim()))).slice(0, 10);
      }
    }
  } catch (err) {
    console.warn('⚠️ 爬取 VPL 網頁失敗，使用法定標準年度休館日預設清單:', err.message);
  }

  if (closures.length === 0) {
    // BC 省法定年度閉館行事曆預設清單
    closures = [
      `Thursday, January 1, ${currentYear}: Closed (New Year's Day)`,
      `Monday, February 16, ${currentYear}: Closed (Family Day)`,
      `Friday, April 3, ${currentYear}: Closed (Good Friday)`,
      `Monday, April 6, ${currentYear}: Closed (Easter Monday)`,
      `Monday, May 18, ${currentYear}: Closed (Victoria Day)`,
      `Wednesday, July 1, ${currentYear}: Closed (Canada Day)`,
      `Monday, August 3, ${currentYear}: Closed (BC Day)`,
      `Monday, September 7, ${currentYear}: Closed (Labour Day)`,
      `Wednesday, September 30, ${currentYear}: Closed (National Day for Truth and Reconciliation)`,
      `Monday, October 12, ${currentYear}: Closed (Thanksgiving)`,
      `Wednesday, November 11, ${currentYear}: Closed (Remembrance Day)`,
      `Thursday, December 24, ${currentYear}: 9:30 am – 5:00 pm (Closing early for Christmas Eve)`,
      `Friday, December 25, ${currentYear}: Closed (Christmas Day)`,
      `Saturday, December 26, ${currentYear}: Closed (Boxing Day)`
    ];
  }

  for (const feat of libData.features) {
    feat.properties.upcoming_closures = closures;
  }

  const updatedJson = JSON.stringify(libData, null, 2);
  fs.writeFileSync(BACKEND_FILE, updatedJson, 'utf8');
  fs.writeFileSync(FRONTEND_FILE, updatedJson, 'utf8');

  console.log(`✅ 已成功更新 ${libData.features.length} 間圖書館的 ${currentYear} 年度閉館清單！`);
}

main().catch(err => {
  console.error('執行失敗:', err);
  process.exit(1);
});
