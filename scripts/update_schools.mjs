import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function updateSchools() {
  console.log('[UpdateSchools] Fetching VSB schools API...');
  const resp = await fetch('https://cicmsapi.azurewebsites.net/vsb/_ci/15/ci/vsb/webservice.ashx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'ansp=' + encodeURIComponent(JSON.stringify({
      CategoryName: 'FindASchoolGeoJsons',
      MethodName: 'GetSchoolListView',
      Parameters: { schools: '' }
    }))
  });

  const rawData = await resp.json();
  const vsbList = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  console.log(`[UpdateSchools] Retrieved ${vsbList.length} schools from VSB API.`);

  const schoolsPath = path.resolve(__dirname, '../backend/data/vancouver_schools.geojson');
  const publicPath = path.resolve(__dirname, '../frontend/public/vancouver_schools.geojson');

  const currentSchools = JSON.parse(fs.readFileSync(schoolsPath, 'utf8'));

  const getNum = (s) => (s || '').match(/\d+/)?.[0] || '';
  const cleanStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

  let matchedCount = 0;
  for (const feat of currentSchools.features) {
    const p = feat.properties;
    const pNum = getNum(p.address);
    const pAddr = cleanStr(p.address);
    const pName = cleanStr(p.name);

    let match = null;
    // 1. Street number match
    if (pNum) {
      match = vsbList.find(v => {
        const vNum = getNum(v.Address1 || v.Address);
        if (vNum !== pNum) return false;
        const vAddr = cleanStr(v.Address1 || v.Address);
        const pStreetWords = pAddr.split(' ').filter(w => w !== pNum && w.length > 2);
        const vStreetWords = vAddr.split(' ').filter(w => w !== vNum && w.length > 2);
        return pStreetWords.some(w => vStreetWords.includes(w));
      });
    }

    // 2. Name similarity fallback
    if (!match) {
      match = vsbList.find(v => {
        const vName = cleanStr(v.Name);
        return pName === vName || pName.includes(vName) || vName.includes(pName);
      });
    }

    if (match) {
      matchedCount++;
      p.phone = (match.Phone || '').trim() || null;
      p.url = (match.Url || '').trim() || null;
      p.email = (match.Email || '').trim() || null;
      p.vsb_name = (match.Name || '').trim() || null;
    }
  }

  console.log(`[UpdateSchools] Matched ${matchedCount} / ${currentSchools.features.length} schools.`);

  fs.writeFileSync(schoolsPath, JSON.stringify(currentSchools, null, 2), 'utf8');
  if (fs.existsSync(path.dirname(publicPath))) {
    fs.writeFileSync(publicPath, JSON.stringify(currentSchools, null, 2), 'utf8');
  }
  console.log('[UpdateSchools] Successfully updated school GeoJSON files.');
}

updateSchools().catch(err => {
  console.error('[UpdateSchools] Error:', err);
  process.exit(1);
});
