// YVR 機場內部地圖 (LocusLabs POIs) 69 類設施對應 Lucide 圖示、色彩與中文分類工具

export interface YvrIconSpec {
  iconKey: string;
  color: string;
  group: string;
  groupZh: string;
  svgPaths: string;
}

const ICON_SVG_PATHS: Record<string, string> = {
  eat: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  bar: '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  gate: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  baggage: '<path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/><path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
  security: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  restroom: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  accessible: '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>',
  lounge: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0Z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  hotel: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  parking: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  elevator: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  stairs: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  bus: '<path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/>',
  train: '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  money: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  aed: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  water: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  art: '<circle cx="13.5" cy="6.5" r=".5" fill="#ffffff"/><circle cx="17.5" cy="10.5" r=".5" fill="#ffffff"/><circle cx="8.5" cy="7.5" r=".5" fill="#ffffff"/><circle cx="6.5" cy="12.5" r=".5" fill="#ffffff"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>',
  pet: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  baby: '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
  service: '<path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/><path d="M20 16a8 8 0 1 0-16 0"/><path d="M12 4v4"/><path d="M10 4h4"/>',
};

export const YVR_CATEGORY_GROUPS: Array<{ id: string; label: string; color: string }> = [
  { id: 'all', label: '全部', color: '#38bdf8' },
  { id: 'gate', label: '登機與報到', color: '#6366f1' },
  { id: 'eat', label: '餐飲美食', color: '#f97316' },
  { id: 'shop', label: '免稅與商店', color: '#d946ef' },
  { id: 'restroom', label: '洗手間', color: '#06b6d4' },
  { id: 'security', label: '安檢/海關', color: '#f43f5e' },
  { id: 'baggage', label: '行李設施', color: '#0ea5e9' },
  { id: 'services', label: '旅客服務', color: '#10b981' },
  { id: 'relax', label: '貴賓室/休憩', color: '#ec4899' },
  { id: 'transport', label: '接駁與停車', color: '#14b8a6' },
  { id: 'portal', label: '電梯與通道', color: '#64748b' },
];

export function getYvrCategorySpec(category?: string | null): YvrIconSpec {
  const c = String(category || 'services').toLowerCase().trim();

  if (c === 'eat.coffee') {
    return { iconKey: 'yvr-cat-coffee', color: '#d97706', group: 'eat', groupZh: '咖啡茶飲', svgPaths: ICON_SVG_PATHS.coffee };
  }
  if (c === 'eat.bar') {
    return { iconKey: 'yvr-cat-bar', color: '#ea580c', group: 'eat', groupZh: '酒吧餐酒', svgPaths: ICON_SVG_PATHS.bar };
  }
  if (c === 'eat' || c.startsWith('eat.')) {
    return { iconKey: 'yvr-cat-eat', color: '#f97316', group: 'eat', groupZh: '餐飲美食', svgPaths: ICON_SVG_PATHS.eat };
  }
  if (c === 'shop' || c.startsWith('shop.')) {
    return { iconKey: 'yvr-cat-shop', color: '#d946ef', group: 'shop', groupZh: '免稅與商店', svgPaths: ICON_SVG_PATHS.shop };
  }
  if (c === 'gate') {
    return { iconKey: 'yvr-cat-gate', color: '#6366f1', group: 'gate', groupZh: '登機門', svgPaths: ICON_SVG_PATHS.gate };
  }
  if (c === 'checkin' || c === 'ticketing') {
    return { iconKey: 'yvr-cat-ticket', color: '#3b82f6', group: 'gate', groupZh: '報到/票務', svgPaths: ICON_SVG_PATHS.ticket };
  }
  if (c.startsWith('baggage')) {
    return { iconKey: 'yvr-cat-baggage', color: '#0ea5e9', group: 'baggage', groupZh: '行李設施', svgPaths: ICON_SVG_PATHS.baggage };
  }
  if (c.startsWith('security')) {
    return { iconKey: 'yvr-cat-security', color: '#f43f5e', group: 'security', groupZh: '安檢與海關', svgPaths: ICON_SVG_PATHS.security };
  }
  if (c === 'restroom.accessible' || c === 'parking.accessible') {
    return {
      iconKey: 'yvr-cat-accessible',
      color: c.startsWith('parking') ? '#2563eb' : '#0891b2',
      group: c.startsWith('parking') ? 'transport' : 'restroom',
      groupZh: c.startsWith('parking') ? '無障礙車位' : '無障礙洗手間',
      svgPaths: ICON_SVG_PATHS.accessible,
    };
  }
  if (c.startsWith('restroom')) {
    return { iconKey: 'yvr-cat-restroom', color: '#06b6d4', group: 'restroom', groupZh: '洗手間', svgPaths: ICON_SVG_PATHS.restroom };
  }
  if (c === 'hotel') {
    return { iconKey: 'yvr-cat-hotel', color: '#8b5cf6', group: 'relax', groupZh: '機場飯店', svgPaths: ICON_SVG_PATHS.hotel };
  }
  if (c === 'relax.childrensplayarea' || c === 'services.mothersroom') {
    return {
      iconKey: 'yvr-cat-baby',
      color: '#ec4899',
      group: c.startsWith('services') ? 'services' : 'relax',
      groupZh: c === 'services.mothersroom' ? '育嬰哺乳室' : '兒童遊戲區',
      svgPaths: ICON_SVG_PATHS.baby,
    };
  }
  if (c.startsWith('relax')) {
    return { iconKey: 'yvr-cat-lounge', color: '#ec4899', group: 'relax', groupZh: '貴賓室與休憩', svgPaths: ICON_SVG_PATHS.lounge };
  }
  if (c.startsWith('parking')) {
    return { iconKey: 'yvr-cat-parking', color: '#2563eb', group: 'transport', groupZh: '機場停車場', svgPaths: ICON_SVG_PATHS.parking };
  }
  if (c === 'portal.elevator') {
    return { iconKey: 'yvr-cat-elevator', color: '#0d9488', group: 'portal', groupZh: '電梯', svgPaths: ICON_SVG_PATHS.elevator };
  }
  if (c === 'portal.escalator' || c === 'portal.stairs' || c === 'portal.ramp') {
    return { iconKey: 'yvr-cat-stairs', color: '#64748b', group: 'portal', groupZh: '手扶梯/階梯', svgPaths: ICON_SVG_PATHS.stairs };
  }
  if (c === 'portal.bus' || c === 'transport.shuttle' || c === 'transport.shuttle.public') {
    return { iconKey: 'yvr-cat-bus', color: '#14b8a6', group: 'transport', groupZh: '接駁巴士', svgPaths: ICON_SVG_PATHS.bus };
  }
  if (c === 'transport.train') {
    return { iconKey: 'yvr-cat-train', color: '#0284c7', group: 'transport', groupZh: '天車加拿大線', svgPaths: ICON_SVG_PATHS.train };
  }
  if (c.startsWith('transport') || c === 'services.rentalcar') {
    return { iconKey: 'yvr-cat-car', color: '#0d9488', group: 'transport', groupZh: '乘車與租車', svgPaths: ICON_SVG_PATHS.car };
  }
  if (c === 'services.aed' || c === 'services.firstaid') {
    return { iconKey: 'yvr-cat-aed', color: '#ef4444', group: 'services', groupZh: '急救與 AED', svgPaths: ICON_SVG_PATHS.aed };
  }
  if (c === 'services.atm' || c === 'services.bank' || c.startsWith('services.currencyexchange')) {
    return { iconKey: 'yvr-cat-money', color: '#10b981', group: 'services', groupZh: '金融/外幣兌換', svgPaths: ICON_SVG_PATHS.money };
  }
  if (c === 'services.waterrefill') {
    return { iconKey: 'yvr-cat-water', color: '#0ea5e9', group: 'services', groupZh: '飲水補充站', svgPaths: ICON_SVG_PATHS.water };
  }
  if (c === 'services.mailbox') {
    return { iconKey: 'yvr-cat-mail', color: '#dc2626', group: 'services', groupZh: '郵筒寄件', svgPaths: ICON_SVG_PATHS.mail };
  }
  if (c === 'services.animalreliefarea') {
    return { iconKey: 'yvr-cat-pet', color: '#16a34a', group: 'services', groupZh: '寵物休憩區', svgPaths: ICON_SVG_PATHS.pet };
  }
  if (c === 'services.information' || c === 'services.lostproperty') {
    return { iconKey: 'yvr-cat-info', color: '#0284c7', group: 'services', groupZh: '諮詢與失物招領', svgPaths: ICON_SVG_PATHS.info };
  }
  if (c === 'art') {
    return { iconKey: 'yvr-cat-art', color: '#a855f7', group: 'relax', groupZh: '機場藝術裝置', svgPaths: ICON_SVG_PATHS.art };
  }
  if (c === 'element.door') {
    return { iconKey: 'yvr-cat-door', color: '#475569', group: 'portal', groupZh: '航廈出入口', svgPaths: ICON_SVG_PATHS.door };
  }
  if (c === 'inactive' || c === 'label') {
    return { iconKey: 'yvr-cat-info', color: '#64748b', group: 'services', groupZh: '航廈區域', svgPaths: ICON_SVG_PATHS.info };
  }

  return { iconKey: 'yvr-cat-service', color: '#10b981', group: 'services', groupZh: '旅客服務', svgPaths: ICON_SVG_PATHS.service };
}

export function formatYvrFloorId(floorId?: string | null): string {
  if (!floorId) return '';
  const raw = String(floorId).trim();
  const parts = raw.split('-');
  if (parts.length >= 3 && parts[0].toLowerCase() === 'yvr') {
    const termRaw = parts[1].toLowerCase();
    const term =
      termRaw === 'mainterminal'
        ? 'Main Terminal'
        : termRaw === 'southterminal'
        ? 'South Terminal'
        : termRaw === 'northconcourse'
        ? 'North Concourse'
        : parts[1].replace(/terminal$/i, ' Terminal');
    const lvlRaw = parts.slice(2).join('-');
    const m = lvlRaw.match(/^level(\d+)$/i);
    const lvl = m ? `Level ${m[1]}` : lvlRaw;
    return `${term} - ${lvl}`;
  }
  return raw;
}

export function formatYvrTerminalZh(term?: { id?: string; name?: string; nameZh?: string } | null): string {
  if (!term) return '';
  const idLow = String(term.id || '').toLowerCase();
  if (idLow === 'yvr-mainterminal' || idLow.includes('main')) return '主客運大樓';
  if (idLow === 'yvr-southterminal' || idLow.includes('south')) return '南客運大樓';
  if (term.nameZh) {
    return String(term.nameZh).replace(/\s*\([^)]*\)\s*/g, '').trim();
  }
  const rawName = String(term.name || term.id || '').trim();
  if (/main\s*terminal/i.test(rawName)) return '主客運大樓';
  if (/south\s*terminal/i.test(rawName)) return '南客運大樓';
  return rawName;
}

export function formatYvrLevelNameZh(levelName?: string | null): string {
  if (!levelName) return '';
  const raw = String(levelName).trim();
  const m = raw.match(/^(?:level|lvl)\s*(\d+)$/i);
  if (m) return `${m[1]}樓`;
  const mId = raw.match(/-level(\d+)$/i);
  if (mId) return `${mId[1]}樓`;
  return raw;
}

export function formatYvrLevelDetailsZh(details?: string | null): string {
  if (!details) return '';
  const raw = String(details).trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  if (low === 'services plaza') return '服務廣場';
  if (low === 'baggage claim') return '行李提取';
  if (low === 'departures') return '離境層';
  if (low === 'international arrivals') return '國際入境層';
  if (low === 'domestic arrivals') return '國內入境層';
  if (low === 'arrivals') return '入境層';
  return raw
    .replace(/Services Plaza/gi, '服務廣場')
    .replace(/Baggage Claim/gi, '行李提取')
    .replace(/International Arrivals/gi, '國際入境層')
    .replace(/Domestic Arrivals/gi, '國內入境層')
    .replace(/Departures/gi, '離境層')
    .replace(/Arrivals/gi, '入境層');
}

/** Register crisp white Lucide SVG sprites for all YVR indoor iconKeys onto MapLibre. */
export function registerYvrIndoorIcons(mapInstance: any): void {
  if (!mapInstance) return;
  const targetMap = mapInstance.getMap ? mapInstance.getMap() : mapInstance;
  if (!targetMap || typeof targetMap.hasImage !== 'function' || typeof targetMap.addImage !== 'function') return;

  for (const [shortName, paths] of Object.entries(ICON_SVG_PATHS)) {
    const imageId = `yvr-cat-${shortName}`;
    if (targetMap.hasImage(imageId)) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    const img = new Image(28, 28);
    img.onload = () => {
      try {
        if (!targetMap.hasImage(imageId)) {
          targetMap.addImage(imageId, img);
        }
      } catch {
        // ignore if map disposed or duplicate load
      }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
}
