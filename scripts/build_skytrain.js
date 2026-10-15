const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function build() {
  console.log('Starting SkyTrain network build...');

  // 1. Target trips
  const targetTrips = {
    'expo_kg_outbound': { tid: '15521868', line_id: 'expo', line_name: 'Expo Line', color: '#0033a0', headsign: 'To King George', origin: 'Waterfront', destination: 'King George', direction: 'outbound' },
    'expo_kg_inbound': { tid: '15522369', line_id: 'expo', line_name: 'Expo Line', color: '#0033a0', headsign: 'To Waterfront', origin: 'King George', destination: 'Waterfront', direction: 'inbound' },
    'expo_pwu_outbound': { tid: '15521869', line_id: 'expo', line_name: 'Expo Line', color: '#0033a0', headsign: 'To Production Way-University', origin: 'Waterfront', destination: 'Production Way-University', direction: 'outbound' },
    'expo_pwu_inbound': { tid: '15522370', line_id: 'expo', line_name: 'Expo Line', color: '#0033a0', headsign: 'To Waterfront', origin: 'Production Way-University', destination: 'Waterfront', direction: 'inbound' },
    'millennium_east': { tid: '15521267', line_id: 'millennium', line_name: 'Millennium Line', color: '#ffcd00', headsign: 'To Lafarge Lake-Douglas', origin: 'VCC-Clark', destination: 'Lafarge Lake-Douglas', direction: 'outbound' },
    'millennium_west': { tid: '15521563', line_id: 'millennium', line_name: 'Millennium Line', color: '#ffcd00', headsign: 'To VCC-Clark', origin: 'Lafarge Lake-Douglas', destination: 'VCC-Clark', direction: 'inbound' },
    'canada_rb_outbound': { tid: '15501423', line_id: 'canada', line_name: 'Canada Line', color: '#007c9f', headsign: 'To Richmond-Brighouse', origin: 'Waterfront', destination: 'Richmond-Brighouse', direction: 'outbound' },
    'canada_rb_inbound': { tid: '15501108', line_id: 'canada', line_name: 'Canada Line', color: '#007c9f', headsign: 'To Waterfront', origin: 'Richmond-Brighouse', destination: 'Waterfront', direction: 'inbound' },
    'canada_yvr_outbound': { tid: '15501414', line_id: 'canada', line_name: 'Canada Line', color: '#007c9f', headsign: 'To YVR-Airport', origin: 'Waterfront', destination: 'YVR-Airport', direction: 'outbound' },
    'canada_yvr_inbound': { tid: '15501109', line_id: 'canada', line_name: 'Canada Line', color: '#007c9f', headsign: 'To Waterfront', origin: 'YVR-Airport', destination: 'Waterfront', direction: 'inbound' }
  };

  const tidToPattern = {};
  for (const [key, val] of Object.entries(targetTrips)) {
    tidToPattern[val.tid] = key;
  }

  // 2. Read stops.txt
  console.log('Reading stops.txt...');
  const stops = {};
  const rlStops = readline.createInterface({ input: fs.createReadStream('stops.txt'), crlfDelay: Infinity });
  for await (const line of rlStops) {
    const parts = line.split(',');
    if (parts[0] === 'stop_id') continue;
    const rawName = parts[2] || '';
    const cleanName = rawName.split('@')[0].trim().replace(/\s+Station$/i, '').trim() + ' 站';
    stops[parts[0]] = {
      stop_id: parts[0],
      name: cleanName,
      raw_name: rawName,
      lat: parseFloat(parts[4]),
      lon: parseFloat(parts[5])
    };
  }

  // 3. Read stop_times.txt
  console.log('Reading stop_times.txt...');
  const stopTimesByTrip = {};
  const rlST = readline.createInterface({ input: fs.createReadStream('stop_times.txt'), crlfDelay: Infinity });
  function parseSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':').map(Number);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  for await (const line of rlST) {
    const parts = line.split(',');
    const tid = parts[0];
    if (tidToPattern[tid]) {
      if (!stopTimesByTrip[tid]) stopTimesByTrip[tid] = [];
      stopTimesByTrip[tid].push({
        stop_id: parts[3],
        seq: parseInt(parts[4]),
        arr: parts[1],
        dep: parts[2]
      });
    }
  }

  // 4. Find shapes for target trips
  console.log('Finding shapes for target trips...');
  const rlTrips = readline.createInterface({ input: fs.createReadStream('trips.txt'), crlfDelay: Infinity });
  const shapeIds = new Set();
  const tripToShape = {};
  for await (const line of rlTrips) {
    const parts = line.split(',');
    const tid = parts[2];
    if (tidToPattern[tid]) {
      tripToShape[tid] = parts[7];
      shapeIds.add(parts[7]);
    }
  }

  // 5. Read shapes.txt
  console.log('Reading shapes.txt for needed shape IDs...');
  const shapesData = {};
  for (const s of shapeIds) shapesData[s] = [];
  const rlShapes = readline.createInterface({ input: fs.createReadStream('shapes.txt'), crlfDelay: Infinity });
  for await (const line of rlShapes) {
    const parts = line.split(',');
    const sid = parts[0];
    if (shapesData[sid]) {
      shapesData[sid].push({
        lat: parseFloat(parts[1]),
        lon: parseFloat(parts[2]),
        seq: parseInt(parts[3])
      });
    }
  }
  for (const sid of Object.keys(shapesData)) {
    shapesData[sid].sort((a,b) => a.seq - b.seq);
  }

  // 6. Build patterns
  const patterns = [];
  const stationsDict = {};

  for (const [key, conf] of Object.entries(targetTrips)) {
    const stList = stopTimesByTrip[conf.tid] || [];
    stList.sort((a,b) => a.seq - b.seq);
    if (stList.length === 0) continue;

    const baseSec = parseSeconds(stList[0].dep);
    const stations = [];

    stList.forEach((st, idx) => {
      const stopInfo = stops[st.stop_id];
      if (!stopInfo) return;
      const tSec = Math.max(0, parseSeconds(st.arr) - baseSec);
      stations.push({
        stop_id: st.stop_id,
        name: stopInfo.name,
        raw_name: stopInfo.raw_name,
        lat: stopInfo.lat,
        lon: stopInfo.lon,
        seq: idx + 1,
        time_sec: tSec
      });

      if (!stationsDict[st.stop_id]) {
        stationsDict[st.stop_id] = {
          stop_id: st.stop_id,
          name: stopInfo.name,
          raw_name: stopInfo.raw_name,
          lat: stopInfo.lat,
          lon: stopInfo.lon,
          lines: []
        };
      }
      if (!stationsDict[st.stop_id].lines.includes(conf.line_name)) {
        stationsDict[st.stop_id].lines.push(conf.line_name);
      }
    });

    const shapeId = tripToShape[conf.tid];
    const rawShape = shapesData[shapeId] || [];
    // Convert shape to [lon, lat] array
    const shape = rawShape.map(p => [p.lon, p.lat]);

    const totalDurationSec = stations[stations.length - 1].time_sec;

    patterns.push({
      pattern_id: key,
      trip_id: conf.tid,
      line_id: conf.line_id,
      line_name: conf.line_name,
      color: conf.color,
      headsign: conf.headsign,
      origin: conf.origin + ' 站',
      destination: conf.destination + ' 站',
      direction: conf.direction,
      duration_sec: totalDurationSec,
      stations: stations,
      shape: shape
    });
  }

  const output = {
    lines: {
      expo: {
        id: 'expo',
        name: 'Expo Line',
        color: '#0033a0',
        operator: 'TransLink (BC Rapid Transit Company)'
      },
      millennium: {
        id: 'millennium',
        name: 'Millennium Line',
        color: '#ffcd00',
        operator: 'TransLink (BC Rapid Transit Company)'
      },
      canada: {
        id: 'canada',
        name: 'Canada Line',
        color: '#007c9f',
        operator: 'TransLink (ProTrans BC)'
      }
    },
    patterns: patterns,
    stations: stationsDict
  };

  const outPath = path.join(__dirname, '..', 'backend', 'data', 'skytrain_network.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log('Successfully wrote', outPath, 'patterns:', patterns.length, 'stations:', Object.keys(stationsDict).length);
}

build().catch(err => { console.error(err); process.exit(1); });
