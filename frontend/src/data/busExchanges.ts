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
    lat: 49.265194,
    lon: -123.215573,
    image: '/bus_exchanges/Blanca Loop.png',
    routes: ['4'],
    bays: [
      { bay: '月台 1', stop_id: '50273', lat: 49.26524402175971, lon: -123.21585299657143, routes: ['4'], description: '4 Powell (特別班次)' },
      { bay: '月台 2', stop_id: '50600', lat: 49.26514464323344, lon: -123.21529362175006, routes: ['4'], description: '4 UBC' }
    ]
  },
  {
    id: 'dunbar_loop',
    name: '鄧巴巴士轉乘站',
    name_en: 'Dunbar Loop',
    location: 'Dunbar St and 41st Ave',
    lat: 49.23475,
    lon: -123.18588,
    image: '/bus_exchanges/Dunbar Loop.png',
    routes: ['2', '7', '41', '49', 'N22', 'R4'],
    bays: [
      { bay: '月台 1', stop_id: '50737', lat: 49.23445621049669, lon: -123.18545872138219, routes: ['49'], description: '49 Metrotown Station / 落客: 7' },
      { bay: '月台 2', stop_id: '50640', lat: 49.23458672676594, lon: -123.18576062751463, routes: ['2', 'N22'], description: '2 Downtown / N22 Downtown NightBus' },
      { bay: '月台 3', stop_id: '60745', lat: 49.23468733282143, lon: -123.18627699110664, routes: ['41'], description: '41 Joyce Station' },
      { bay: '月台 4', stop_id: '60394', lat: 49.234835522448904, lon: -123.18664968902186, routes: ['49'], description: '49 UBC' },
      { bay: '月台 5', stop_id: '51893', lat: 49.23483008430529, lon: -123.18596467441793, routes: ['R4', '41'], description: 'R4 41st Ave to UBC RapidBus / 41 Crown' },
      { bay: '月台 6', stop_id: '50298', lat: 49.2351332599053, lon: -123.1852380175894, routes: ['7', 'R4'], description: '7 Nanaimo Station / R4 Joyce Station RapidBus' }
    ]
  },
  {
    id: 'kootenay_loop',
    name: '庫特尼巴士轉乘站',
    name_en: 'Kootenay Loop',
    location: 'Hastings St and Kootenay St, Vancouver',
    lat: 49.2813,
    lon: -123.0260,
    image: '/bus_exchanges/Kootenay Loop.png',
    routes: ['14', '27', '28', '130', '131', '160', 'N35', 'R2', 'R5'],
    bays: [
      { bay: '月台 1', stop_id: '58041', lat: 49.28154384759501, lon: -123.02641060933895, routes: ['160'], description: '160 僅供落客' },
      { bay: '月台 2', stop_id: '58042', lat: 49.28150212049144, lon: -123.0260556076604, routes: ['160'], description: '160 Port Coquitlam Station' },
      { bay: '月台 3', stop_id: '51695', lat: 49.281419922251246, lon: -123.02620705538247, routes: ['27'], description: '27 Joyce Station' },
      { bay: '月台 4', stop_id: '58043', lat: 49.28137961344745, lon: -123.02600956755295, routes: ['130'], description: '130 僅供落客' },
      { bay: '月台 5', stop_id: '50955', lat: 49.2813906786122, lon: -123.02635365677752, routes: ['14'], description: '14 UBC Exchange' },
      { bay: '月台 6', stop_id: '51470', lat: 49.28122470087682, lon: -123.02640090846658, routes: ['28', '130'], description: '28 Phibbs Exchange / 130 Phibbs Exchange' },
      { bay: '月台 7', stop_id: '52717', lat: 49.281205919567384, lon: -123.02537588026955, routes: ['R2', 'R5', 'N35'], description: 'R2 Park Royal / R5 Burrard / N35 Downtown' },
      { bay: '月台 8', stop_id: '58143', lat: 49.28104745441883, lon: -123.0249429199722, routes: ['R2', '28', '130', 'N35'], description: 'R2 Metrotown / 28 Joyce / 130 Metrotown / N35 SFU' },
      { bay: '月台 9', stop_id: '60600', lat: 49.281034621512426, lon: -123.02613244399103, routes: ['R5'], description: 'R5 Hastings St to SFU Exchange RapidBus' },
      { bay: '月台 10', stop_id: '59889', lat: 49.281409127071086, lon: -123.02562451093524, routes: ['131'], description: '131 Hastings at Gilmore' }
    ]
  },
  {
    id: 'marpole_loop',
    name: '馬寶巴士轉乘站',
    name_en: 'Marpole Loop',
    location: 'Marine Dr and Hudson St, Vancouver',
    lat: 49.20325,
    lon: -123.13388,
    image: '/bus_exchanges/Marpole Loop.png',
    routes: ['10', '100'],
    bays: [
      { bay: '月台 1', stop_id: '50738', lat: 49.20282179208302, lon: -123.13377354376344, routes: [], description: '僅供落客' },
      { bay: '月台 2', stop_id: '51120', lat: 49.203284452717405, lon: -123.13280794851718, routes: ['10'], description: '10 Granville to Marine Drive Station' },
      { bay: '月台 4', stop_id: '54824', lat: 49.20374009912453, lon: -123.13584420912301, routes: ['10', '100'], description: '10 Downtown / 100 Marpole Loop' },
      { bay: '月台 5', stop_id: '52123', lat: 49.20314074799083, lon: -123.13317272894285, routes: ['100'], description: '100 22nd Street Station' }
    ]
  },
  {
    id: 'stanley_park_loop',
    name: '史丹利公園巴士總站',
    name_en: 'Stanley Park Loop',
    location: 'Pipeline Rd / Rose Garden Lane',
    lat: 49.3006,
    lon: -123.13386,
    image: '/bus_exchanges/Stanley Park Loop.png',
    routes: ['19'],
    bays: [
      { bay: '月台 1', stop_id: '58727', lat: 49.30051015436348, lon: -123.13370216399976, routes: [], description: '僅供落客' },
      { bay: '月台 2', stop_id: '58728', lat: 49.30068943054666, lon: -123.13402910222983, routes: ['19'], description: '19 Metrotown Station' }
    ]
  },
  {
    id: 'ubc_exchange',
    name: 'UBC 卑詩大學巴士轉乘站',
    name_en: 'UBC Exchange',
    location: 'Wesbrook Mall and University Blvd',
    lat: 49.26675,
    lon: -123.2475,
    image: '/bus_exchanges/UBC Exchange.png',
    routes: ['4', '9', '14', '25', '33', '44', '49', '68', '84', '99', 'N17', 'R4'],
    bays: [
      { bay: '月台 1', stop_id: '60158', lat: 49.26742825478665, lon: -123.24796946835116, routes: ['33', '68'], description: '33 29th Ave Station / 68 Wesbrook Village' },
      { bay: '月台 2', stop_id: '60159', lat: 49.267317990809815, lon: -123.24828596901519, routes: ['84'], description: '84 VCC-Clark Station' },
      { bay: '月台 3', stop_id: '60160', lat: 49.26722872931383, lon: -123.24858369421602, routes: ['44', 'N17'], description: '44 Downtown, Dundarave / N17 Downtown NightBus' },
      { bay: '月台 4', stop_id: '60162', lat: 49.26706595793609, lon: -123.24792655300674, routes: ['R4'], description: 'R4 41st Ave to Joyce Station RapidBus' },
      { bay: '月台 5', stop_id: '60163', lat: 49.26716047041546, lon: -123.24750544619151, routes: ['49'], description: '49 Metrotown Station' },
      { bay: '月台 6', stop_id: '60164', lat: 49.26731799080984, lon: -123.24720235657257, routes: ['25'], description: '25 Brentwood Station' },
      { bay: '月台 7', stop_id: '61935', lat: 49.2674317552274, lon: -123.24683221172877, routes: ['99'], description: '99 B-Line Commercial-Broadway Station' },
      { bay: '月台 9', stop_id: '58895', lat: 49.2658053282, lon: -123.24872379635083, routes: ['9'], description: '9 Boundary (特別班次)' },
      { bay: '月台 10', stop_id: '61701', lat: 49.265856568143974, lon: -123.24816852950111, routes: ['14'], description: '14 Hastings' },
      { bay: '月台 11', stop_id: '61702', lat: 49.26594806791158, lon: -123.24740012992045, routes: ['4'], description: '4 Powell' },
      { bay: '月台 12', stop_id: '60428', lat: 49.266112767069224, lon: -123.24715334465523, routes: [], description: 'HandyDART 復康專車' },
      { bay: '月台 13', stop_id: '58292', lat: 49.266164006693906, lon: -123.2465756427807, routes: [], description: '備用月台' }
    ]
  }
];
