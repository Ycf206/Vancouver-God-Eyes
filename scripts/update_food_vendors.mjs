import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function scrapeFoodVendors() {
  console.log('[UpdateFoodVendors] Fetching streetfoodapp.com/vancouver...');
  const resp = await fetch('https://streetfoodapp.com/vancouver', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }

  const html = await resp.text();

  // Parse each vendor card
  const cardRegex = /<a\s+[^>]*class="[^"]*__vendor-card[^"]*"[^>]*data-latitude="([^"]+)"[^>]*data-longitude="([^"]+)"[^>]*data-vendor-name="([^"]+)"[\s\S]*?<\/a>/g;
  let match;
  const features = [];
  let index = 1;

  while ((match = cardRegex.exec(html)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const name = match[3].replace(/&amp;/g, '&').trim();
    const cardHtml = match[0];

    // Address
    const addrMatch = cardHtml.match(/<h6 class="card-subtitle mb-2">([^<]+)<\/h6>/);
    const address = addrMatch ? addrMatch[1].replace(/&amp;/g, '&').trim() : '';

    // Hours
    const hoursMatch = cardHtml.match(/<h6 class="card-subtitle d-none d-lg-block">([^<]+)<\/h6>/) || cardHtml.match(/data-time="([^"]+)"/);
    const hours = hoursMatch ? hoursMatch[1].replace(/&amp;/g, '&').trim() : '';

    // Credit card
    const hasCard = cardHtml.includes('fa-credit-card');

    // Filter Vancouver strictly:
    // 1. Address contains Vancouver (and not North Vancouver / West Vancouver)
    // 2. Or coordinate within Vancouver proper if address doesn't name another municipality
    const addrLower = address.toLowerCase();
    const otherCities = ['port moody', 'burnaby', 'richmond', 'surrey', 'coquitlam', 'north vancouver', 'west vancouver', 'new westminster', 'delta', 'langley'];
    const isOtherCity = otherCities.some(c => addrLower.includes(c));

    const isVancouverAddr = addrLower.includes('vancouver') && !isOtherCity;
    const isVancouverCoords = lat >= 49.195 && lat <= 49.315 && lon >= -123.275 && lon <= -123.023 && !isOtherCity;

    if (isVancouverAddr || isVancouverCoords) {
      features.push({
        type: 'Feature',
        id: `food_vendor_${index++}`,
        properties: {
          id: `food_vendor_${index}`,
          facility_type: 'food_vendors',
          name,
          address,
          business_name: name,
          hours,
          operating_hours: hours,
          credit_card: hasCard ? '支援' : '不支援',
          payment_methods: hasCard ? '支援信用卡' : '現金 / 其他',
          city: 'Vancouver'
        },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      });
    }
  }

  console.log(`[UpdateFoodVendors] Found ${features.length} Vancouver food vendors.`);

  const geojson = {
    type: 'FeatureCollection',
    features
  };

  const backendPath = path.resolve(__dirname, '../backend/data/vancouver_food_vendors.geojson');
  const frontendPath = path.resolve(__dirname, '../frontend/public/vancouver_food_vendors.geojson');

  fs.writeFileSync(backendPath, JSON.stringify(geojson, null, 2), 'utf8');
  if (fs.existsSync(path.dirname(frontendPath))) {
    fs.writeFileSync(frontendPath, JSON.stringify(geojson, null, 2), 'utf8');
  }
  console.log('[UpdateFoodVendors] Successfully saved vancouver_food_vendors.geojson.');
}

scrapeFoodVendors().catch(err => {
  console.error('[UpdateFoodVendors] Error:', err);
  process.exit(1);
});
