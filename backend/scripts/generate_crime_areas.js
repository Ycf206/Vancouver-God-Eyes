const fs = require('fs');
const path = require('path');

function getPolygonArea(coords) {
  let total = 0;
  for (let ring of coords) {
    let area = 0;
    const len = ring.length;
    for (let i = 0; i < len; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % len];
      const rad = Math.PI / 180;
      area += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
    }
    area = area * 6378137 * 6378137 / 2;
    total += Math.abs(area);
  }
  return total / 1000000;
}

const nameZhMap = {
  'Downtown': '市中心 (Downtown)',
  'West End': '西端區 (West End)',
  'Strathcona': '士達孔拿 (Strathcona)',
  'Mount Pleasant': '快樂山 (Mount Pleasant)',
  'Fairview': '錦繡區 (Fairview)',
  'Grandview-Woodland': '大景區 (Grandview-Woodland)',
  'Renfrew-Collingwood': '倫弗魯-哥靈活 (Renfrew-Collingwood)',
  'Kensington-Cedar Cottage': '肯辛頓-香柏平原 (Kensington-Cedar Cottage)',
  'Kitsilano': '基斯蘭奴 (Kitsilano)',
  'Sunset': '日落區 (Sunset)',
  'South Cambie': '南甘比 (South Cambie)',
  'Marpole': '馬寶 (Marpole)',
  'Riley Park': '萊利公園 (Riley Park)',
  'Hastings-Sunrise': '喜士定-日出 (Hastings-Sunrise)',
  'Victoria-Fraserview': '維多利亞-菲沙景 (Victoria-Fraserview)',
  'Oakridge': '橡樹嶺 (Oakridge)',
  'Arbutus Ridge': '楊梅嶺 (Arbutus Ridge)',
  'Killarney': '基拉尼 (Killarney)',
  'Shaughnessy': '肖內西 (Shaughnessy)',
  'West Point Grey': '西格雷角 (West Point Grey)',
  'Kerrisdale': '克里斯戴爾 (Kerrisdale)',
  'Dunbar-Southlands': '登巴-南地 (Dunbar-Southlands)'
};

const csvPath = path.join(__dirname, '../data/crimedata_csv_AllNeighbourhoods_2026.csv');
const boundaryPath = path.join(__dirname, '../data/vancouver_local_area_boundary.geojson');

const csv = fs.readFileSync(csvPath, 'utf8');
const counts = {};
for (let line of csv.split('\n').slice(1)) {
  const parts = line.split(',');
  const n = parts[7]?.trim();
  if (n) {
    counts[n] = (counts[n] || 0) + 1;
  }
}

const boundaryData = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));

const outFeatures = [];
for (let f of boundaryData.features) {
  const name = f.properties.name;
  const csvName = name === 'Downtown' ? 'Central Business District' : name;
  const count = counts[csvName] || 0;
  
  let areaKm2 = 0;
  if (f.geometry.type === 'Polygon') {
    areaKm2 = getPolygonArea(f.geometry.coordinates);
  } else if (f.geometry.type === 'MultiPolygon') {
    for (let poly of f.geometry.coordinates) {
      areaKm2 += getPolygonArea(poly);
    }
  }
  areaKm2 = Math.round(areaKm2 * 100) / 100;
  const density = areaKm2 > 0 ? Math.round(count / areaKm2) : 0;

  // Bracket & Color matching user image:
  // 少過10: #94a3b8
  // 10-50: #2e7d32
  // 50-150: #6ee7b7
  // 150-400: #f59e0b
  // 400+: #dc2626
  let bracket = '少過10';
  let color = '#94a3b8';
  let severity = '輕微';

  if (density >= 400) {
    bracket = '400+';
    color = '#dc2626';
    severity = '嚴重';
  } else if (density >= 150) {
    bracket = '150-400';
    color = '#f59e0b';
    severity = '中高';
  } else if (density >= 50) {
    bracket = '50-150';
    color = '#6ee7b7';
    severity = '中等';
  } else if (density >= 10) {
    bracket = '10-50';
    color = '#2e7d32';
    severity = '偏低';
  }

  const feat = {
    type: 'Feature',
    id: 'crime_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    properties: {
      id: 'crime_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: name,
      name_zh: nameZhMap[name] || name,
      crime_count: count,
      area_km2: areaKm2,
      density: density,
      density_label: density + ' 件/km²',
      bracket: bracket,
      severity: severity,
      color: color,
      geo_point_2d: f.properties.geo_point_2d || null
    },
    geometry: f.geometry
  };
  outFeatures.push(feat);
}

const geojson = {
  type: 'FeatureCollection',
  name: 'Vancouver Crime Rate by Neighbourhood 2026',
  features: outFeatures
};

const outBackend = path.join(__dirname, '../data/vancouver_crime_areas.geojson');
const outFrontend = path.join(__dirname, '../../frontend/public/vancouver_crime_areas.geojson');

fs.writeFileSync(outBackend, JSON.stringify(geojson, null, 2), 'utf8');
fs.writeFileSync(outFrontend, JSON.stringify(geojson, null, 2), 'utf8');
console.log('Successfully generated vancouver_crime_areas.geojson with ' + outFeatures.length + ' features.');
