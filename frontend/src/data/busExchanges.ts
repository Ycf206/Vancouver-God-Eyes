export interface BusExchangeBay {
  bay: string;
  stop_id?: string;
  lat: number;
  lon: number;
  routes: string[];
  description?: string;
}

export interface BusExchange {
  id: string;
  name: string;
  name_en: string;
  location: string;
  lat: number;
  lon: number;
  image: string;
  routes: string[];
  bays: BusExchangeBay[];
}

export const BUS_EXCHANGES: BusExchange[] = [
  {
    id: 'blanca_loop',
    name: '布蘭卡巴士轉乘站',
    name_en: 'Blanca Loop',
    location: 'Blanca St and Chancellor Blvd',
    lat: 49.2651865,
    lon: -123.2158784,
    image: '/bus_exchanges/Blanca Loop.png',
    routes: ['4'],
    bays: [
      { bay: 'Bay 1', stop_id: '50273', lat: 49.2651872, lon: -123.2158325, routes: ['4'], description: '4 Powell (Limited Service)' },
      { bay: 'Bay 2', stop_id: '50600', lat: 49.2651858, lon: -123.2159243, routes: ['4'], description: '4 UBC' }
    ]
  },
  {
    id: 'dunbar_loop',
    name: '鄧巴巴士轉乘站',
    name_en: 'Dunbar Loop',
    location: 'Dunbar St and 41st Ave',
    lat: 49.23465,
    lon: -123.1864,
    image: '/bus_exchanges/Dunbar Loop.png',
    routes: ['2', '7', '41', '49', 'N22', 'R4'],
    bays: [
      { bay: 'Bay 1', stop_id: '50737', lat: 49.2344275, lon: -123.1880439, routes: ['49'], description: '49 Metrotown Station / Unloading: 7' },
      { bay: 'Bay 2', stop_id: '50640', lat: 49.2345997, lon: -123.1860053, routes: ['2', 'N22'], description: '2 Downtown / N22 Downtown NightBus' },
      { bay: 'Bay 3', stop_id: '60745', lat: 49.2347370, lon: -123.1862058, routes: ['41'], description: '41 Joyce Station' },
      { bay: 'Bay 4', stop_id: '60394', lat: 49.2347721, lon: -123.1864523, routes: ['49'], description: '49 UBC' },
      { bay: 'Bay 5', stop_id: '51893', lat: 49.2347493, lon: -123.1863795, routes: ['R4', '41'], description: 'R4 41st Ave to UBC RapidBus / 41 Crown' },
      { bay: 'Bay 6', stop_id: '50298', lat: 49.2349809, lon: -123.1855222, routes: ['7'], description: '7 Nanaimo Station' },
      { bay: 'Bay 7', stop_id: '60393', lat: 49.2345500, lon: -123.1858000, routes: ['R4'], description: 'R4 41st Ave to Joyce Station RapidBus' }
    ]
  },
  {
    id: 'kootenay_loop',
    name: '庫特尼巴士轉乘站',
    name_en: 'Kootenay Loop',
    location: 'Hastings St and Kootenay St, Vancouver',
    lat: 49.2813,
    lon: -123.0264,
    image: '/bus_exchanges/Kootenay Loop.png',
    routes: ['14', '27', '28', '130', '131', '160', 'N35', 'R2', 'R5'],
    bays: [
      { bay: 'Bay 1', stop_id: '58041', lat: 49.2815004, lon: -123.0266339, routes: ['160'], description: '160 Unloading only' },
      { bay: 'Bay 2', stop_id: '58042', lat: 49.2814627, lon: -123.0263693, routes: ['160'], description: '160 Port Coquitlam Station' },
      { bay: 'Bay 3', stop_id: '51695', lat: 49.2813998, lon: -123.0266885, routes: ['27'], description: '27 Joyce Station' },
      { bay: 'Bay 4', stop_id: '58043', lat: 49.2812158, lon: -123.0267774, routes: ['130'], description: '130 Unloading only' },
      { bay: 'Bay 5', stop_id: '50955', lat: 49.2813434, lon: -123.0264834, routes: ['14'], description: '14 UBC Exchange' },
      { bay: 'Bay 6', stop_id: '51470', lat: 49.2812344, lon: -123.0265910, routes: ['28', '130'], description: '28 Phibbs Exchange / 130 Phibbs Exchange' },
      { bay: 'Bay 7', stop_id: '52717', lat: 49.2812007, lon: -123.0259671, routes: ['R2', 'R5', 'N35'], description: 'R2 Park Royal / R5 Burrard / N35 Downtown' },
      { bay: 'Bay 8', stop_id: '58143', lat: 49.2810384, lon: -123.0258124, routes: ['R2', '28', '130', 'N35'], description: 'R2 Metrotown / 28 Joyce / 130 Metrotown / N35 SFU' },
      { bay: 'Bay 9', stop_id: '60600', lat: 49.2810346, lon: -123.0261324, routes: ['R5'], description: 'R5 Hastings St to SFU Exchange RapidBus' },
      { bay: 'Bay 10', stop_id: '59889', lat: 49.2813757, lon: -123.0260442, routes: ['131'], description: '131 Hastings at Gilmore' }
    ]
  },
  {
    id: 'marpole_loop',
    name: '馬寶巴士轉乘站',
    name_en: 'Marpole Loop',
    location: 'Marine Dr and Hudson St, Vancouver',
    lat: 49.2033,
    lon: -123.1363,
    image: '/bus_exchanges/Marpole Loop.png',
    routes: ['10', '100'],
    bays: [
      { bay: 'Bay 1', stop_id: '50738', lat: 49.2032441, lon: -123.1356404, routes: [], description: 'Unloading Only' },
      { bay: 'Bay 2', stop_id: '51120', lat: 49.2032441, lon: -123.1356404, routes: ['10'], description: '10 Granville to Marine Drive Station' },
      { bay: 'Bay 4', stop_id: '54824', lat: 49.2036949, lon: -123.1382163, routes: ['10', '100'], description: '10 Downtown / 100 Marpole Loop' },
      { bay: 'Bay 5', stop_id: '52123', lat: 49.2031341, lon: -123.1360383, routes: ['100'], description: '100 22nd Street Station' }
    ]
  },
  {
    id: 'stanley_park_loop',
    name: '史丹利公園巴士總站',
    name_en: 'Stanley Park Loop',
    location: 'Pipeline Rd / Rose Garden Lane',
    lat: 49.3006,
    lon: -123.1368,
    image: '/bus_exchanges/Stanley Park Loop.png',
    routes: ['19'],
    bays: [
      { bay: 'Bay 1', stop_id: '58727', lat: 49.3004777, lon: -123.1387304, routes: [], description: 'Unloading Only' },
      { bay: 'Bay 2', stop_id: '58728', lat: 49.3006921, lon: -123.1349289, routes: ['19'], description: '19 Metrotown Station' }
    ]
  },
  {
    id: 'ubc_exchange',
    name: 'UBC 卑詩大學巴士轉乘站',
    name_en: 'UBC Exchange',
    location: 'Wesbrook Mall and University Blvd',
    lat: 49.2667,
    lon: -123.2488,
    image: '/bus_exchanges/UBC Exchange.png',
    routes: ['4', '9', '14', '25', '33', '44', '49', '68', '84', '99', 'N17', 'R4'],
    bays: [
      { bay: 'Bay 1', stop_id: '60158', lat: 49.2676502, lon: -123.2486705, routes: ['33', '68'], description: '33 29th Ave Station / 68 Wesbrook Village' },
      { bay: 'Bay 2', stop_id: '60159', lat: 49.2674656, lon: -123.2491503, routes: ['84'], description: '84 VCC-Clark Station' },
      { bay: 'Bay 3', stop_id: '60160', lat: 49.2672155, lon: -123.2491234, routes: ['44', 'N17'], description: '44 Downtown, Dundarave / N17 Downtown NightBus' },
      { bay: 'Bay 4', stop_id: '60162', lat: 49.2671489, lon: -123.2490339, routes: ['R4'], description: 'R4 41st Ave to Joyce Station RapidBus' },
      { bay: 'Bay 5', stop_id: '60163', lat: 49.2670987, lon: -123.2486294, routes: ['49'], description: '49 Metrotown Station' },
      { bay: 'Bay 6', stop_id: '60164', lat: 49.2671302, lon: -123.2482570, routes: ['25'], description: '25 Brentwood Station' },
      { bay: 'Bay 7', stop_id: '61935', lat: 49.2672669, lon: -123.2476752, routes: ['99'], description: '99 B-Line Commercial-Broadway Station' },
      { bay: 'Bay 9', stop_id: '58895', lat: 49.2657200, lon: -123.2503103, routes: ['9'], description: '9 Boundary (Limited Service)' },
      { bay: 'Bay 10', stop_id: '61701', lat: 49.2658101, lon: -123.2491306, routes: ['14'], description: '14 Hastings' },
      { bay: 'Bay 11', stop_id: '61702', lat: 49.2659143, lon: -123.2487823, routes: ['4'], description: '4 Powell' },
      { bay: 'Bay 12', stop_id: '60428', lat: 49.2660216, lon: -123.2476712, routes: [], description: 'HandyDART' },
      { bay: 'Bay 13', stop_id: '58292', lat: 49.2658490, lon: -123.2479544, routes: [], description: 'Spare' }
    ]
  }
];
