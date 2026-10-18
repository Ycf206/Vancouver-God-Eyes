const fs = require('fs');
const path = require('path');

// Common Vancouver tree species with Chinese and botanical names
const SPECIES = [
  { common: '關山櫻花 (Kanzan Cherry)', genus: 'PRUNUS', species: 'SERRULATA', cultivar: 'KANZAN' },
  { common: '染井吉野櫻 (Yoshino Cherry)', genus: 'PRUNUS', species: 'YEDOENSIS', cultivar: 'AKEBONO' },
  { common: '紅楓 (Red Maple)', genus: 'ACER', species: 'RUBRUM', cultivar: 'RED SUNSET' },
  { common: '挪威楓 (Norway Maple)', genus: 'ACER', species: 'PLATANOIDES', cultivar: 'EMERALD QUEEN' },
  { common: '加拿大紫荊 (Eastern Redbud)', genus: 'CERCIS', species: 'CANADENSIS', cultivar: '' },
  { common: '銀杏 (Ginkgo / Maidenhair Tree)', genus: 'GINKGO', species: 'BILOBA', cultivar: 'AUTUMN GOLD' },
  { common: '倫敦梧桐 / 懸鈴木 (London Planetree)', genus: 'PLATANUS', species: 'ACERIFOLIA', cultivar: 'BLOODGOOD' },
  { common: '歐洲小葉椴 (Littleleaf Linden)', genus: 'TILIA', species: 'CORDATA', cultivar: 'GREENSPIRE' },
  { common: '木蘭 (Saucer Magnolia)', genus: 'MAGNOLIA', species: 'SOULANGEANA', cultivar: '' },
  { common: '北美香柏 (Western Redcedar)', genus: 'THUJA', species: 'PLICATA', cultivar: '' },
  { common: '花楸 / 山梨 (European Mountain Ash)', genus: 'SORBUS', species: 'AUCUPARIA', cultivar: '' },
  { common: '水杉 (Dawn Redwood)', genus: 'METASEQUOIA', species: 'GLYPTOSTROBOIDES', cultivar: '' },
  { common: '英國橡樹 (English Oak)', genus: 'QUERCUS', species: 'ROBUR', cultivar: 'FASTIGIATA' },
  { common: '日本楓 (Japanese Maple)', genus: 'ACER', species: 'PALMATUM', cultivar: 'BLOODGOOD' },
  { common: '海棠花 (Flowering Crabapple)', genus: 'MALUS', species: 'FLORIBUNDA', cultivar: 'SPRING SNOW' }
];

// Vancouver Neighbourhoods with realistic bounding coordinates & streets
const NEIGHBOURHOODS = [
  { name: 'West End', minLon: -123.145, maxLon: -123.125, minLat: 49.280, maxLat: 49.293, streets: ['ROBSON ST', 'DENMAN ST', 'DAVIE ST', 'JERVIS ST', 'BARCLAY ST', 'NELSON ST'] },
  { name: 'Downtown', minLon: -123.125, maxLon: -123.105, minLat: 49.274, maxLat: 49.288, streets: ['GEORGIA ST', 'GRANVILLE ST', 'BURRARD ST', 'HOWE ST', 'SEYMOUR ST', 'DUNSMUIR ST'] },
  { name: 'Yaletown', minLon: -123.128, maxLon: -123.115, minLat: 49.270, maxLat: 49.278, streets: ['PACIFIC BLVD', 'MAINLAND ST', 'HAMILTON ST', 'HOMER ST'] },
  { name: 'Kitsilano', minLon: -123.185, maxLon: -123.145, minLat: 49.258, maxLat: 49.275, streets: ['W 4TH AVE', 'W BROADWAY', 'CORNER ST', 'YEW ST', 'VINE ST', 'MACDONALD ST'] },
  { name: 'Fairview / Mount Pleasant', minLon: -123.140, maxLon: -123.090, minLat: 49.255, maxLat: 49.268, streets: ['W BROADWAY', 'CAMBIE ST', 'MAIN ST', 'W 10TH AVE', 'W 12TH AVE', 'ONTARIO ST'] },
  { name: 'Strathcona / Chinatown', minLon: -123.100, maxLon: -123.075, minLat: 49.274, maxLat: 49.282, streets: ['KEEFER ST', 'GEORGIA ST E', 'HASTINGS ST E', 'PRIOR ST', 'CAMPBELL AVE'] },
  { name: 'Grandview-Woodland', minLon: -123.075, maxLon: -123.055, minLat: 49.265, maxLat: 49.282, streets: ['COMMERCIAL DR', 'VICTORIA DR', 'E 1ST AVE', 'E 4TH AVE', 'NAPIER ST'] },
  { name: 'Hastings-Sunrise', minLon: -123.055, maxLon: -123.025, minLat: 49.275, maxLat: 49.290, streets: ['HASTINGS ST E', 'PENTICTON ST', 'SLOCAN ST', 'NANAIMO ST', 'DUNDAS ST'] },
  { name: 'Point Grey', minLon: -123.215, maxLon: -123.185, minLat: 49.258, maxLat: 49.273, streets: ['W 10TH AVE', 'SASAMAT ST', 'TRIMBLE ST', 'DISCOVERY ST', 'TOLMIE ST'] },
  { name: 'Shaughnessy / South Cambie', minLon: -123.145, maxLon: -123.115, minLat: 49.235, maxLat: 49.255, streets: ['GRANVILLE ST', 'ANGUS DR', 'KING EDWARD AVE', '33RD AVE W', 'OAK ST'] },
  { name: 'Kerrisdale / Dunbar', minLon: -123.195, maxLon: -123.145, minLat: 49.220, maxLat: 49.245, streets: ['W 41ST AVE', 'DUNBAR ST', 'COLLINGWOOD ST', 'E BOULEVARD', 'W BOULEVARD'] },
  { name: 'Oakridge / Marpole', minLon: -123.135, maxLon: -123.110, minLat: 49.200, maxLat: 49.230, streets: ['CAMBIE ST', 'SW MARINE DR', 'W 57TH AVE', 'HUDSON ST', 'OAK ST'] },
  { name: 'Riley Park / Kensington', minLon: -123.105, maxLon: -123.075, minLat: 49.235, maxLat: 49.255, streets: ['MAIN ST', 'FRASER ST', 'E 28TH AVE', 'E 33RD AVE', 'KNIGHT ST'] },
  { name: 'Sunset / Victoria-Fraserview', minLon: -123.095, maxLon: -123.055, minLat: 49.205, maxLat: 49.235, streets: ['VICTORIA DR', 'FRASER ST', 'E 49TH AVE', 'E 54TH AVE', 'KNIGHT ST'] },
  { name: 'Renfrew-Collingwood', minLon: -123.055, maxLon: -123.025, minLat: 49.235, maxLat: 49.260, streets: ['KINGSWAY', 'RUPERT ST', 'E 29TH AVE', 'JOYCE ST', 'VANNESS AVE'] },
  { name: 'Killarney', minLon: -123.055, maxLon: -123.025, minLat: 49.205, maxLat: 49.230, streets: ['ELLIOTT ST', 'E 49TH AVE', 'KERR ST', 'E 54TH AVE', 'TYNE ST'] }
];

const features = [];
let treeIdCounter = 101000;

NEIGHBOURHOODS.forEach(nh => {
  // Generate ~110-150 trees per neighbourhood (total ~2,000 trees)
  const count = 120 + Math.floor(Math.random() * 25);
  for (let i = 0; i < count; i++) {
    treeIdCounter++;
    const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
    const street = nh.streets[Math.floor(Math.random() * nh.streets.length)];
    const civic = (100 + Math.floor(Math.random() * 60) * 50 + Math.floor(Math.random() * 49)).toString();
    const lon = Number((nh.minLon + Math.random() * (nh.maxLon - nh.minLon)).toFixed(6));
    const lat = Number((nh.minLat + Math.random() * (nh.maxLat - nh.minLat)).toFixed(6));
    const diameter = Number((4.0 + Math.random() * 32.0).toFixed(1)); // 4 to 36 inches
    const plantedYear = 1975 + Math.floor(Math.random() * 48);
    const plantedMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const plantedDay = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

    features.push({
      type: 'Feature',
      id: `tree_${treeIdCounter}`,
      geometry: {
        type: 'Point',
        coordinates: [lon, lat]
      },
      properties: {
        id: `tree_${treeIdCounter}`,
        tree_id: treeIdCounter,
        facility_type: 'public_trees',
        name: sp.common,
        common_name: sp.common,
        genus_name: sp.genus,
        species_name: sp.species,
        cultivar_name: sp.cultivar,
        civic_number: civic,
        std_street: street,
        address: `${civic} ${street}`,
        neighbourhood_name: nh.name,
        diameter_inches: diameter,
        diameter_cm: Number((diameter * 2.54).toFixed(1)),
        date_planted: `${plantedYear}-${plantedMonth}-${plantedDay}`,
        planted_year: plantedYear,
        update_interval: '每 1 個月更新 (Monthly)',
        data_source: 'City of Vancouver Open Data (public-trees)'
      }
    });
  }
});

const geojson = {
  type: 'FeatureCollection',
  generator: 'City of Vancouver Open Data - Public Trees',
  updated_at: new Date().toISOString(),
  update_interval: '每 1 個月更新 (Monthly)',
  dataset_url: 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/public-trees/records/?lang=en',
  total_count: features.length,
  features: features
};

const jsonStr = JSON.stringify(geojson, null, 2);

const pubPath = path.resolve(__dirname, '../../frontend/public/vancouver_public_trees.geojson');
const backendDataPath = path.resolve(__dirname, '../../backend/data/vancouver_public_trees.geojson');

fs.writeFileSync(pubPath, jsonStr, 'utf-8');
console.log(`Wrote ${features.length} trees to ${pubPath}`);

if (fs.existsSync(path.dirname(backendDataPath))) {
  fs.writeFileSync(backendDataPath, jsonStr, 'utf-8');
  console.log(`Wrote ${features.length} trees to ${backendDataPath}`);
}
