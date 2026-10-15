const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'backend', 'data');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && (f.includes('Destination') || f.includes('Tesla') || f.includes('Mobile')));

const features = [];

for (const file of files) {
  // Deduplicate Raymur mobile service since it's co-located with Raymur Center at 908 Raymur Ave
  if (file === 'Mobile Service Vancouver.json') {
    continue;
  }

  const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const d = content.data || {};
  const m = d.marketing || {};
  const k = d.key_data || {};
  const address = (k.address || (d.functions && d.functions[0] && d.functions[0].address) || {});
  const geo = k.geo_point || {};
  const lat = geo.lat || parseFloat(m.gmaps_override_latitude) || address.latitude;
  const lon = geo.lon || parseFloat(m.gmaps_override_longitude) || address.longitude;

  if (!lat || !lon) {
    console.warn('Skipping file with missing coordinates:', file);
    continue;
  }

  let subType = 'unknown';
  let name = m.display_name || 'Tesla 設施';
  let power = 0;
  let stalls = 0;
  let speed = '';
  let access = 'Tesla 專用';
  let notes = '';
  let phone = m.service_center_phone || m.roadside_assistance_number || '';
  let services = [];
  let hours = '24/7 全天候開放';

  if (file.includes('Supercharger')) {
    subType = 'supercharger';
    const sc = d.supercharger_function || {};
    power = parseInt(sc.installed_full_power || '250', 10);
    stalls = parseInt(sc.num_charger_stalls || '8', 10);
    speed = power >= 250 ? '250 kW V3 極速充電' : `${power} kW 超級充電`;
    const nPartner = (sc.charging_accessibility || '').includes('NACS Partner') || sc.open_to_non_tesla;
    access = nPartner ? '支援 NACS 合作車款及 Tesla' : 'Tesla 專用 (Tesla Only)';
    services = [power >= 250 ? '超級充電站 (Supercharger - V3 250kW)' : `超級充電站 (Supercharger - ${stalls} 個充電樁)`];
    const cleanName = m.display_name.replace('Vancouver, BC - ', '').replace('Supercharger', '').trim() || address.address_1;
    name = `Tesla 超級充電站 (${cleanName})`;
  } else if (file.includes('Destination')) {
    subType = 'destination_charger';
    const dc = d.destination_charger_function || {};
    power = parseInt(dc.installed_full_power || '16', 10);
    stalls = parseInt(dc.num_charger_stalls || '1', 10);
    speed = `${power} kW 目的地充電 (Level 2 AC)`;
    access = dc.open_to_non_tesla ? '支援所有相容電動車' : 'Tesla 專用';
    notes = [dc.restrictions, dc.access_instructions].filter(Boolean).join(' · ');
    phone = dc.phone_number || '';
    services = ['目的地充電樁 (Destination Charger)'];
    name = `Tesla 目的地充電站 (${m.display_name})`;
  } else if (file.includes('Raymur')) {
    subType = 'center';
    name = 'Tesla 溫哥華服務與體驗中心 (Vancouver-Raymur)';
    power = 250;
    stalls = 8;
    speed = '超級充電站';
    access = 'Tesla 專用';
    phone = '(778) 357-4185';
    hours = '服務部 週一至週六 08:00 - 18:00 · 充電 24/7';
    services = [
      'Tesla 原廠售後維修與保養 (Service Center)',
      '車輛展示與銷售體驗 (Sales Gallery)',
      '新車交付中心 (Delivery Hub)',
      '超級充電站 (Supercharger)'
    ];
    notes = '車輛維修請由 Raymur Ave 入口駛入標示 Service 之接待門口。';
  } else if (file.includes('Mobile')) {
    subType = 'mobile_service';
    name = `Tesla 移動服務支援中心 (Powell Hub)`;
    phone = m.service_center_phone || '(604) 255-4427';
    hours = '預約式上門維修支援 (Mobile Service)';
    services = ['Tesla 移動維修服務 (Mobile Fleet Service Hub)'];
    notes = '專屬 Tesla 行動服務車隊調配基地，提供大溫哥華地區上門到府檢修。';
  }

  const id = 'tesla_' + file.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  features.push({
    type: 'Feature',
    id,
    geometry: {
      type: 'Point',
      coordinates: [Number(lon), Number(lat)]
    },
    properties: {
      id,
      facility_type: 'tesla',
      sub_type: subType,
      name,
      display_name: m.display_name,
      address: [address.address_1, address.city, address.state_province, address.postal_code].filter(Boolean).join(', '),
      city: address.city || 'Vancouver',
      postal_code: address.postal_code || '',
      phone,
      stalls,
      power_kw: power,
      charging_speed: speed,
      charging_access: access,
      access_type: subType === 'supercharger' ? '公眾開放' : (subType === 'destination_charger' ? '飯店/商場顧客及公眾' : '原廠預約服務'),
      status: '營運中 (Open)',
      hours,
      services,
      notes
    }
  });
}

const geojson = {
  type: 'FeatureCollection',
  features
};

const outBackend = path.join(__dirname, '..', 'backend', 'data', 'vancouver_tesla.geojson');
const outFrontend = path.join(__dirname, '..', 'frontend', 'public', 'vancouver_tesla.geojson');

fs.writeFileSync(outBackend, JSON.stringify(geojson, null, 2), 'utf8');
fs.writeFileSync(outFrontend, JSON.stringify(geojson, null, 2), 'utf8');

console.log(`Generated ${features.length} Tesla features successfully!`);
