import fs from 'fs';
import path from 'path';

// 1. Fetch Mobi Shared Bikes
export async function fetchMobiBikes() {
  console.log('🚲 Fetching Mobi Bikes from https://www.mobibikes.ca/api/client/entities ...');
  const res = await fetch('https://www.mobibikes.ca/api/client/entities', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) throw new Error(`Mobi entities failed: ${res.status}`);
  const json = await res.json();
  const rawStations = json?.data?.stations || [];
  console.log(`Found ${rawStations.length} Mobi stations in entities list.`);

  const features = [];
  const BATCH_SIZE = 15;
  for (let i = 0; i < rawStations.length; i += BATCH_SIZE) {
    const chunk = rawStations.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map(async (st) => {
      let bikes = st.availableBikes ?? 0;
      let slots = st.availableSlots ?? 0;
      try {
        const detailRes = await fetch(`https://www.mobibikes.ca/api/client/entities/stations/${st.id}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000)
        });
        if (detailRes.ok) {
          const detailJson = await detailRes.json();
          const dStation = detailJson?.data?.station;
          if (dStation) {
            bikes = dStation.availableBikes ?? bikes;
            slots = dStation.availableSlots ?? slots;
          }
        }
      } catch (err) {
        // fallback
      }

      const totalCap = bikes + slots;
      const coords = st.coordinates || [0, 0];
      const lon = coords[0];
      const lat = coords[1];

      return {
        type: 'Feature',
        id: st.id,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties: {
          id: st.id,
          name: st.label,
          station_id: st.id.replace(/^st_/, '').slice(0, 6).toUpperCase(),
          full_id: st.id,
          available_bikes: bikes,
          available_slots: slots,
          capacity: totalCap > 0 ? totalCap : (bikes + slots || 10),
          is_closed: Boolean(st.isClosed),
          operator: 'Mobi by Rogers',
          facility_type: 'shared_bikes'
        }
      };
    }));
    features.push(...results);
  }
  console.log(`✅ Completed Mobi Bikes: ${features.length} stations.`);

  const geojson = {
    type: 'FeatureCollection',
    features
  };

  fs.writeFileSync('backend/data/vancouver_shared_bikes.geojson', JSON.stringify(geojson, null, 2), 'utf8');
  fs.writeFileSync('frontend/public/vancouver_shared_bikes.geojson', JSON.stringify(geojson, null, 2), 'utf8');
}

// 2. Fetch Lime E-Scooters
export async function fetchLimeScooters() {
  console.log('🛴 Fetching Lime E-Scooters GBFS...');
  let infoData = null;
  let statusData = null;

  try {
    const infoRes = await fetch('https://data.lime.bike/api/partners/v1/gbfs/vancouver_bc/station_information.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (infoRes.ok) infoData = await infoRes.json();
  } catch (e) {
    console.warn('Direct Lime info endpoint failed, trying proxy...', e.message);
  }

  if (!infoData) {
    const proxyUrl = 'https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv1%2Fgbfs%2Fvancouver_bc%2Fstation_information.json';
    const proxyRes = await fetch(proxyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    infoData = await proxyRes.json();
  }

  try {
    const statusRes = await fetch('https://data.lime.bike/api/partners/v2/gbfs/vancouver_bc/station_status.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (statusRes.ok) statusData = await statusRes.json();
  } catch (e) {
    console.warn('Direct Lime status endpoint failed, trying proxy...', e.message);
  }

  if (!statusData) {
    const proxyUrl = 'https://www.li.me/externalBikesQuery.php?bikeDataUrl=https%3A%2F%2Fdata.lime.bike%2Fapi%2Fpartners%2Fv2%2Fgbfs%2Fvancouver_bc%2Fstation_status.json';
    const proxyRes = await fetch(proxyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    statusData = await proxyRes.json();
  }

  const rawStations = infoData?.data?.stations || [];
  const rawStatus = statusData?.data?.stations || [];
  console.log(`Found ${rawStations.length} Lime stations, ${rawStatus.length} status records.`);

  const statusMap = new Map();
  for (const s of rawStatus) {
    statusMap.set(s.station_id, s);
  }

  const features = [];
  for (const st of rawStations) {
    const stStatus = statusMap.get(st.station_id) || {};
    const availVehicles = stStatus.num_vehicles_available ?? 0;
    const availDocks = stStatus.num_docks_available ?? 0;
    const capacity = availVehicles + availDocks;

    let stationNumber = '';
    let stationTitle = st.name || 'Lime 共享滑板車站';
    const m = st.name?.match(/^(#\d+)\s*[-–—:]\s*(.+)$/i);
    if (m) {
      stationNumber = m[1];
      stationTitle = m[2].trim();
    } else {
      const m2 = st.name?.match(/^(#\d+)/i);
      if (m2) stationNumber = m2[1];
    }

    features.push({
      type: 'Feature',
      id: st.station_id,
      geometry: {
        type: 'Point',
        coordinates: [st.lon, st.lat]
      },
      properties: {
        station_id: st.station_id,
        station_number: stationNumber,
        name: stationTitle,
        full_name: st.name,
        available_vehicles: availVehicles,
        available_docks: availDocks,
        capacity: capacity > 0 ? capacity : 8,
        is_renting: Boolean(stStatus.is_renting ?? true),
        is_returning: Boolean(stStatus.is_returning ?? true),
        operator: 'Lime',
        facility_type: 'escooter'
      }
    });
  }

  console.log(`✅ Completed Lime E-Scooters: ${features.length} stations.`);
  const geojson = {
    type: 'FeatureCollection',
    features
  };

  fs.writeFileSync('backend/data/vancouver_escooter.geojson', JSON.stringify(geojson, null, 2), 'utf8');
  fs.writeFileSync('frontend/public/vancouver_escooter.geojson', JSON.stringify(geojson, null, 2), 'utf8');
}

async function run() {
  const mode = process.argv[2] || 'all';
  try {
    if (mode === 'all' || mode === 'mobi') {
      await fetchMobiBikes();
    }
    if (mode === 'all' || mode === 'lime') {
      await fetchLimeScooters();
    }
    console.log('🎉 Micromobility sync finished successfully!');
  } catch (err) {
    console.error('Fatal error syncing micromobility data:', err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('fetch_shared_micromobility.mjs')) {
  run();
}
