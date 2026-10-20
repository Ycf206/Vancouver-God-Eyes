import fs from 'fs';

async function fetchAllPublicArt() {
  const limit = 100;
  let offset = 0;
  const features = [];
  const types = new Set();
  const ownerships = new Set();
  const statuses = new Set();

  while (true) {
    const url = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/public-art/records?limit=${limit}&offset=${offset}`;
    console.log(`Fetching offset ${offset}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Fetch error:', res.status, res.statusText);
      break;
    }
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) break;

    for (const r of results) {
      statuses.add(r.status);
      if (r.status !== 'In place') continue;
      const coords = r.geo_point_2d ? [r.geo_point_2d.lon, r.geo_point_2d.lat] : (r.geom?.geometry?.coordinates || null);
      if (!coords || isNaN(coords[0]) || isNaN(coords[1])) continue;

      if (r.type) types.add(r.type);
      if (r.ownership) ownerships.add(r.ownership);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coords
        },
        properties: {
          id: `art_${r.registryid}`,
          facility_type: 'public_art',
          name: r.sitename || r.title_of_work || '公共藝術',
          registryid: r.registryid,
          sitename: r.sitename,
          siteaddress: r.siteaddress,
          title_of_work: r.title_of_work,
          type: r.type,
          status: r.status,
          primarymaterial: r.primarymaterial,
          ownership: r.ownership,
          locationonsite: r.locationonsite,
          artistprojectstatement: r.artistprojectstatement,
          descriptionofwork: r.descriptionofwork,
          url: r.url,
          photourl: r.photourl,
          yearofinstallation: r.yearofinstallation,
          geo_local_area: r.geo_local_area,
          local_area: r.geo_local_area,
          photocredits: r.photocredits
        }
      });
    }

    offset += results.length;
    if (offset >= data.total_count) break;
  }

  console.log(`Finished fetching. All statuses:`, Array.from(statuses));
  console.log(`Total "In place" features: ${features.length}`);
  console.log('Unique types:', Array.from(types));
  console.log('Unique ownerships:', Array.from(ownerships));

  const geojson = {
    type: 'FeatureCollection',
    features
  };

  const frontendPath = 'C:/Users/yeung/.gemini/antigravity/scratch/vancouver-gods-eye/frontend/public/vancouver_public_art.geojson';
  const backendPath = 'C:/Users/yeung/.gemini/antigravity/scratch/vancouver-gods-eye/backend/data/vancouver_public_art.geojson';

  fs.writeFileSync(frontendPath, JSON.stringify(geojson, null, 2), 'utf-8');
  fs.writeFileSync(backendPath, JSON.stringify(geojson, null, 2), 'utf-8');
  console.log('Written successfully to frontend and backend.');
}

fetchAllPublicArt();
