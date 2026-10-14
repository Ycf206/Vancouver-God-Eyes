const fs = require('fs');
const readline = require('readline');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '../../temp_gtfs');
const OUTPUT_PATH = path.join(__dirname, '../data/translink_gtfs_metadata.json');

function cleanRouteNumber(shortName, longName) {
  const sn = (shortName || '').trim();
  const ln = (longName || '').trim();
  const lnLower = ln.toLowerCase();
  if (lnLower.includes('canada line')) return 'Canada Line';
  if (lnLower.includes('expo line')) return 'Expo Line';
  if (lnLower.includes('millennium line')) return 'Millennium Line';
  if (lnLower.includes('seabus')) return 'SeaBus';
  if (lnLower.includes('west coast express')) return 'WCE';
  if (/^\d+$/.test(sn)) return String(parseInt(sn, 10));
  return sn || ln;
}

function cleanStopTerminalName(stopName) {
  if (!stopName) return '';
  let s = stopName.trim();
  if (s.includes(' @ ')) {
    const [base, after] = s.split(' @ ');
    if (/bay|layover|unload/i.test(after)) {
      return base.trim();
    }
  }
  const prefixes = ['Northbound ', 'Southbound ', 'Eastbound ', 'Westbound ', 'NB ', 'SB ', 'EB ', 'WB '];
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  return s;
}

function extractDestFromHeadsign(headsign, fallbackDest) {
  if (!headsign) return cleanStopTerminalName(fallbackDest);
  let hs = headsign.trim();
  if (hs.includes('/To ')) return hs.split('/To ')[1].trim();
  if (hs.includes(' To ')) return hs.split(' To ')[1].trim();
  const parts = hs.split(' ');
  if (parts.length >= 2 && (/^R\d+$/i.test(parts[0]) || /^\d+$/.test(parts[0]))) {
    return parts.slice(1).join(' ').trim();
  }
  return hs;
}

async function parseCSV(filePath, onRow) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let headers = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    // Simple CSV parser handling standard comma-separated values
    const cols = [];
    let inQuotes = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cols.push(cur.trim());

    if (!headers) {
      headers = cols.map(h => h.replace(/^\uFEFF/, '').trim()); // Strip BOM
    } else {
      const row = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = cols[i] !== undefined ? cols[i] : '';
      }
      onRow(row);
    }
  }
}

async function run() {
  console.log('1. Loading routes...');
  const routesMap = {};
  await parseCSV(path.join(GTFS_DIR, 'routes.txt'), (row) => {
    const rid = row.route_id.trim();
    const rawSn = (row.route_short_name || '').trim();
    const ln = (row.route_long_name || '').trim();
    const cleanSn = cleanRouteNumber(rawSn, ln);

    let color = '#10b981';
    if (cleanSn === '99') color = '#f58220';
    else if (/^R\d$/i.test(cleanSn)) color = '#22c55e';
    else if (cleanSn === 'Canada Line') color = '#00a4e4';
    else if (cleanSn === 'Expo Line') color = '#1d2c59';
    else if (cleanSn === 'Millennium Line') color = '#ffcd00';
    else if (cleanSn === 'SeaBus') color = '#8b786d';

    routesMap[rid] = {
      route_id: rid,
      route_number: cleanSn,
      raw_short_name: rawSn,
      long_name: ln,
      color: color,
    };
  });
  console.log(`Loaded ${Object.keys(routesMap).length} routes.`);

  console.log('2. Loading stops...');
  const stopsDict = {};
  await parseCSV(path.join(GTFS_DIR, 'stops.txt'), (row) => {
    const sid = row.stop_id.trim();
    stopsDict[sid] = {
      stop_id: sid,
      stop_code: (row.stop_code || '').trim() || sid,
      name: (row.stop_name || '').trim(),
      lat: Math.round(parseFloat(row.stop_lat) * 100000) / 100000,
      lon: Math.round(parseFloat(row.stop_lon) * 100000) / 100000,
    };
  });
  console.log(`Loaded ${Object.keys(stopsDict).length} stops.`);

  console.log('3. Loading trips...');
  const tripsInfo = {};
  await parseCSV(path.join(GTFS_DIR, 'trips.txt'), (row) => {
    const rid = row.route_id.trim();
    if (routesMap[rid]) {
      const tid = row.trip_id.trim();
      tripsInfo[tid] = {
        trip_id: tid,
        route_id: rid,
        direction_id: (row.direction_id || '0').trim(),
        headsign: (row.trip_headsign || '').trim(),
        shape_id: (row.shape_id || '').trim(),
      };
    }
  });
  console.log(`Loaded ${Object.keys(tripsInfo).length} trips.`);

  console.log('4. Loading stop_times (representative trips selection)...');
  // Group trips by variant key: route_id_direction_id_headsign
  const variantTrips = new Map();
  for (const tid in tripsInfo) {
    const t = tripsInfo[tid];
    const vkey = `${t.route_id}_${t.direction_id}_${t.headsign}`;
    if (!variantTrips.has(vkey)) {
      variantTrips.set(vkey, t);
    }
  }
  console.log(`Found ${variantTrips.size} total variants across all routes.`);

  // To keep stop_times streaming fast, collect stop sequences for all representative trips
  // and map all trips to variant
  const repTripIds = new Set([...variantTrips.values()].map(t => t.trip_id));
  const tripStopLists = new Map();

  await parseCSV(path.join(GTFS_DIR, 'stop_times.txt'), (row) => {
    const tid = row.trip_id.trim();
    if (repTripIds.has(tid)) {
      const seq = parseInt(row.stop_sequence, 10);
      const sid = row.stop_id.trim();
      if (!tripStopLists.has(tid)) tripStopLists.set(tid, []);
      tripStopLists.get(tid).push([seq, sid]);
    }
  });
  console.log(`Loaded stop sequences for representative trips.`);

  // Find needed shape_ids
  const neededShapeIds = new Set();
  for (const t of variantTrips.values()) {
    if (t.shape_id) neededShapeIds.add(t.shape_id);
  }
  console.log(`5. Loading shape points for ${neededShapeIds.size} representative shapes...`);

  const shapePoints = new Map();
  await parseCSV(path.join(GTFS_DIR, 'shapes.txt'), (row) => {
    const shid = row.shape_id.trim();
    if (neededShapeIds.has(shid)) {
      if (!shapePoints.has(shid)) shapePoints.set(shid, []);
      shapePoints.get(shid).push([
        parseInt(row.shape_pt_sequence, 10),
        Math.round(parseFloat(row.shape_pt_lon) * 100000) / 100000,
        Math.round(parseFloat(row.shape_pt_lat) * 100000) / 100000,
      ]);
    }
  });

  for (const [shid, pts] of shapePoints.entries()) {
    pts.sort((a, b) => a[0] - b[0]);
  }
  console.log(`Loaded and sorted shape points.`);

  console.log('6. Building variants object...');
  const variants = {};
  const routeDefaultVariants = {};

  for (const [vkey, tinfo] of variantTrips.entries()) {
    const rid = tinfo.route_id;
    const dirId = tinfo.direction_id;
    const headsign = tinfo.headsign;
    const shid = tinfo.shape_id;
    const rmeta = routesMap[rid] || {};
    const rnum = rmeta.route_number || rid;
    const rlong = rmeta.long_name || '';

    const stList = tripStopLists.get(tinfo.trip_id) || [];
    stList.sort((a, b) => a[0] - b[0]);

    const orderedStops = [];
    for (let idx = 0; idx < stList.length; idx++) {
      const sid = stList[idx][1];
      const sdata = stopsDict[sid];
      if (sdata) {
        orderedStops.push({
          seq: idx + 1,
          stop_id: sid,
          stop_code: sdata.stop_code,
          name: sdata.name,
          lat: sdata.lat,
          lon: sdata.lon,
        });
      }
    }

    const firstStopName = orderedStops.length > 0 ? orderedStops[0].name : '';
    const lastStopName = orderedStops.length > 0 ? orderedStops[orderedStops.length - 1].name : '';
    const originShort = cleanStopTerminalName(firstStopName);
    const destShort = extractDestFromHeadsign(headsign, lastStopName);

    const pts = shapePoints.get(shid) || [];
    const coords = pts.map(p => [p[1], p[2]]);

    const isSeaBus = rnum === 'SeaBus';
    const operator = isSeaBus ? 'TransLink (SeaBus 海上巴士)' : 'TransLink (CMBC 岸山巴士)';

    const variantObj = {
      variant_id: vkey,
      route_id: rid,
      route_number: rnum,
      route_name: rnum && !rlong.includes(rnum) ? `${rnum} ${rlong}`.trim() : rlong,
      color: rmeta.color || '#10b981',
      direction_id: dirId,
      headsign: headsign,
      operator: operator,
      origin: originShort,
      destination: destShort,
      origin_stop: firstStopName,
      dest_stop: lastStopName,
      stops: orderedStops,
      shape_coords: coords,
    };
    variants[vkey] = variantObj;

    const defKey = `${rid}_${dirId}`;
    if (!routeDefaultVariants[defKey] || orderedStops.length > (variants[routeDefaultVariants[defKey]]?.stops?.length || 0)) {
      routeDefaultVariants[defKey] = vkey;
    }
  }

  // Trip to variant mapping
  const tripToVariant = {};
  for (const tid in tripsInfo) {
    const t = tripsInfo[tid];
    const vkey = `${t.route_id}_${t.direction_id}_${t.headsign}`;
    if (variants[vkey]) {
      tripToVariant[tid] = vkey;
    }
  }

  console.log(`Writing output to ${OUTPUT_PATH}...`);
  const outputData = {
    routes: routesMap,
    variants: variants,
    route_default_variants: routeDefaultVariants,
    trip_to_variant: tripToVariant,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData), 'utf-8');
  const sizeMB = (fs.statSync(OUTPUT_PATH).size / (1024 * 1024)).toFixed(2);
  console.log(`[SUCCESS] Generated ${OUTPUT_PATH} (${sizeMB} MB)`);
  console.log(`Routes: ${Object.keys(routesMap).length}, Variants: ${Object.keys(variants).length}, Trips: ${Object.keys(tripToVariant).length}`);
}

run().catch(console.error);
