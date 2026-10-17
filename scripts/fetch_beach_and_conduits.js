const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`JSON parse error from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function downloadStream(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadStream(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

function computeCentroid(rings) {
  if (!rings || !rings.length || !rings[0].length) return [0, 0];
  const ring = rings[0];
  let sumLon = 0;
  let sumLat = 0;
  let count = 0;
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (Array.isArray(pt) && pt.length >= 2) {
      sumLon += pt[0];
      sumLat += pt[1];
      count++;
    }
  }
  return count > 0 ? [sumLon / count, sumLat / count] : [0, 0];
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'backend', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Fetch Beach Water Quality
  console.log('🏖️ 正在拉取 Metro Vancouver 沙灘水質 ArcGIS 數據...');
  const beachUrl = 'https://gis.metrovancouver.org/arcgis/rest/services/Beach_Site_Area/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=json';
  try {
    const beachArcGis = await fetchJson(beachUrl);
    const rawFeatures = beachArcGis.features || [];
    console.log(`✅ 成功獲取 ${rawFeatures.length} 個沙灘水質監測站`);

    const geoFeatures = [];
    const cacheList = [];

    for (const f of rawFeatures) {
      const a = f.attributes || {};
      const g = f.geometry || {};
      const rings = g.rings || [];
      const [centerLon, centerLat] = computeCentroid(rings);

      const val = typeof a.LastValue === 'number' ? Math.round(a.LastValue * 10) / 10 : null;
      let status = 'unknown';
      let statusLabel = '未有數據';
      let statusColor = '#94a3b8';

      if (val !== null) {
        if (val <= 200) {
          status = 'safe';
          statusLabel = '適合游泳 (優良)';
          statusColor = '#10b981';
        } else if (val <= 400) {
          status = 'advisory';
          statusLabel = '需留意 (接近上限)';
          statusColor = '#f59e0b';
        } else {
          status = 'warning';
          statusLabel = '超標警告 (不建議下水)';
          statusColor = '#ef4444';
        }
      }

      let dateFormatted = '';
      if (a.LastTimeStamp) {
        const d = new Date(a.LastTimeStamp);
        dateFormatted = d.toISOString().split('T')[0];
      }

      const itemProps = {
        id: `beach_${a.OBJECTID}`,
        object_id: a.OBJECTID,
        facility_type: 'beach_water_quality',
        name: a.BeachName || '未知海灘',
        area: a.BeachArea || '',
        municipality: a.Municipality || '',
        health_authority: a.HealthAuthority || '',
        last_value: val,
        last_timestamp: a.LastTimeStamp || null,
        last_date: dateFormatted,
        status: status,
        status_label: statusLabel,
        status_color: statusColor,
        internet_link: a.InternetLink || '',
        photo_link: a.PhotoLink || '',
        data_tag: a.DataTag || '',
        center_lon: centerLon,
        center_lat: centerLat,
        update_frequency: '每個月更新 1 次 (Monthly)'
      };

      cacheList.push(itemProps);

      // GeoJSON Polygon Feature
      geoFeatures.push({
        type: 'Feature',
        id: itemProps.id,
        geometry: {
          type: 'Polygon',
          coordinates: rings
        },
        properties: itemProps
      });
    }

    // Sort cacheList by name
    cacheList.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    const cachePayload = {
      source: 'Metro Vancouver ArcGIS Beach_Site_Area',
      source_url: beachUrl,
      update_frequency: '每個月更新 1 次 (Monthly)',
      last_updated: new Date().toISOString(),
      total_count: cacheList.length,
      beaches: cacheList
    };

    const geojsonPayload = {
      type: 'FeatureCollection',
      generator: 'VancouverGodsEye',
      total_count: geoFeatures.length,
      updated_at: new Date().toISOString(),
      update_frequency: '每個月更新 1 次 (Monthly)',
      features: geoFeatures
    };

    fs.writeFileSync(path.join(dataDir, 'vancouver_beach_water_cache.json'), JSON.stringify(cachePayload, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'vancouver_beach_water.geojson'), JSON.stringify(geojsonPayload, null, 2), 'utf8');
    console.log('✅ 已保存海灘水質 GeoJSON 與快取檔案！');
  } catch (err) {
    console.error('❌ 拉取海灘水質失敗:', err.message);
  }

  // 2. Fetch Street Lighting Conduits GeoJSON
  console.log('💡 正在拉取 Open Data Vancouver 路燈配電管線 (street-lighting-conduits)...');
  const conduitsUrl = 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/street-lighting-conduits/exports/geojson';
  const conduitsDest = path.join(dataDir, 'vancouver_street_lighting.geojson');
  try {
    await downloadStream(conduitsUrl, conduitsDest);
    const stats = fs.statSync(conduitsDest);
    console.log(`✅ 成功下載路燈配電管線 GeoJSON！大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ 下載路燈管線失敗:', err.message);
  }

  console.log('🎉 數據拉取與預編譯全部完成！');
}

main().catch(console.error);
