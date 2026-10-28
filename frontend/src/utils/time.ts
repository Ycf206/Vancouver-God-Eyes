/**
 * Time formatting utilities supporting 12-hour and 24-hour preferences.
 */

/**
 * Format opening hours, business hours, and time ranges across all map layers.
 * Supports:
 *   "11 AM – 11 PM" -> "11:00 AM – 11:00 PM" (12h) or "11:00 – 23:00" (24h)
 *   "9:30 am – 6:00 pm" -> "09:30 AM – 06:00 PM" (12h) or "09:30 – 18:00" (24h)
 *   "10:00AM - 5:00PM" -> "10:00 AM – 05:00 PM" (12h) or "10:00 – 17:00" (24h)
 *   "9:00 - 18:00" -> "09:00 AM – 06:00 PM" (12h) or "09:00 – 18:00" (24h)
 *   "06:00 - 22:00" -> "06:00 AM – 10:00 PM" (12h) or "06:00 – 22:00" (24h)
 *   "24/7" | "24 Hours" -> "24 小時營業"
 *   "Closed" -> "休館"
 *   Objects: { Monday: "9:30 am – 8:00 pm", ... } -> maps each day's value
 */
export function formatOpeningHours(
  val: string | Record<string, string> | null | undefined,
  format: '12h' | '24h' = '24h'
): any {
  if (!val) return '';
  if (typeof val === 'object' && !Array.isArray(val)) {
    const formattedObj: Record<string, string> = {};
    for (const [day, hours] of Object.entries(val)) {
      formattedObj[day] = formatOpeningHours(hours, format);
    }
    return formattedObj;
  }

  let s = String(val).trim();
  if (!s || s === '--') return s;
  if (/^(?:24\/7|24\s*hours?|24\s*小時(?:營業)?)$/i.test(s)) {
    return '24 小時營業';
  }
  if (/^closed$/i.test(s)) {
    return '休館';
  }

  // Common OSM day token translations
  s = s.replace(/\b(?:mon|monday)\s*(?:to|-|–|—)\s*(?:fri|friday)\b/gi, '週一至週五');
  s = s.replace(/\b(?:mon|monday)\s*(?:to|-|–|—)\s*(?:thu|thursday)\b/gi, '週一至週四');
  s = s.replace(/\b(?:mon|monday)\s*(?:to|-|–|—)\s*(?:sat|saturday)\b/gi, '週一至週六');
  s = s.replace(/\b(?:mon|monday)\s*(?:to|-|–|—)\s*(?:sun|sunday)\b/gi, '週一至週日');
  s = s.replace(/\btuesdays?\s*and\s*thursdays?\b/gi, '週二及週四');
  s = s.replace(/\bmondays?\b/gi, '週一');
  s = s.replace(/\btuesdays?\b/gi, '週二');
  s = s.replace(/\bwednesdays?\b/gi, '週三');
  s = s.replace(/\bthursdays?\b/gi, '週四');
  s = s.replace(/\bfridays?\b/gi, '週五');
  s = s.replace(/\bsaturdays?\b/gi, '週六');
  s = s.replace(/\bsundays?\b/gi, '週日');
  s = s.replace(/\bMo-Su\b/gi, '週一至週日');
  s = s.replace(/\bMo-Fr\b/gi, '週一至週五');
  s = s.replace(/\bSa-Su\b/gi, '週六至週日');
  s = s.replace(/\bMo,Fr\b/gi, '週一、週五');
  s = s.replace(/\bTu,We,Th\b/gi, '週二至週四');
  s = s.replace(/\bPH\s*off\b/gi, '公眾假期休息');
  s = s.replace(/\bPH\s*closed\b/gi, '公眾假期公休');

  // Regex matching time ranges: (Time 1) [separator] (Time 2)
  const rangeRegex = /(\d{1,2}(?::\d{2})?(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:[-–—~至]+|\bto\b)\s*(\d{1,2}(?::\d{2})?(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/gi;

  function parseSingleTimeToken(token: string, inferredAmpm: string | null = null): string | null {
    const m = token.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const min = m[2] || '00';
    let ampm = m[3] ? m[3].toLowerCase().replace(/\./g, '') : inferredAmpm;

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    if (format === '12h') {
      const period = hour >= 12 ? 'PM' : 'AM';
      let h12 = hour % 12;
      if (h12 === 0) h12 = 12;
      return `${String(h12).padStart(2, '0')}:${min} ${period}`;
    } else {
      return `${String(hour).padStart(2, '0')}:${min}`;
    }
  }

  // Replace ranges
  let result = s.replace(rangeRegex, (match, t1, t2) => {
    const ampm1 = (t1.match(/[ap]\.?m\.?/i) || [])[0];
    const ampm2 = (t2.match(/[ap]\.?m\.?/i) || [])[0];
    let defAmpm1: string | null = null;
    if (!ampm1 && ampm2) {
      const h1 = parseInt(t1, 10);
      const h2 = parseInt(t2, 10);
      if (ampm2.toLowerCase().startsWith('p') && h1 < 12 && h1 > h2) {
        defAmpm1 = 'am';
      } else if (ampm2.toLowerCase().startsWith('p') && h1 >= 7 && h1 <= 11) {
        defAmpm1 = 'am';
      } else {
        defAmpm1 = ampm2.toLowerCase();
      }
    }
    const p1 = parseSingleTimeToken(t1, defAmpm1);
    const p2 = parseSingleTimeToken(t2);
    if (p1 && p2) {
      return `${p1} – ${p2}`;
    }
    return match;
  });

  if (result === s) {
    const single = parseSingleTimeToken(s);
    if (single) return single;
  }

  return result;
}

export function formatTimePreference(
  timeStr: string | null | undefined,
  format: '12h' | '24h' = '24h',
  timeZone?: string
): string {
  if (!timeStr) return '';
  const s = String(timeStr).trim();
  if (!s || s === '--') return s;

  // Handle ISO string or full datetime
  if (s.includes('T') || (s.includes('-') && s.length > 10 && /\d{4}-\d{2}-\d{2}/.test(s)) || s.endsWith('Z')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const effectiveTimeZone = timeZone === 'America/Vancouver' ? 'Etc/GMT+7' : timeZone;
      const options: Intl.DateTimeFormatOptions = {
        hour12: format === '12h',
        hour: '2-digit',
        minute: '2-digit'
      };
      if (effectiveTimeZone && effectiveTimeZone !== 'auto') {
        options.timeZone = effectiveTimeZone;
      }
      return d.toLocaleTimeString('zh-TW', options);
    }
  }

  return formatOpeningHours(s, format);
}

/**
 * Format time range strings respecting 12h / 24h user preference.
 */
export function formatTimeRange(
  startOrRange: string | null | undefined,
  endOrFormat?: string | '12h' | '24h',
  maybeFormat?: '12h' | '24h'
): string {
  if (!startOrRange) return '';
  
  let rawRange = String(startOrRange).trim();
  let format: '12h' | '24h' = '24h';

  if (maybeFormat === '12h' || maybeFormat === '24h') {
    format = maybeFormat;
    if (endOrFormat) {
      rawRange = `${rawRange} - ${String(endOrFormat).trim()}`;
    }
  } else if (endOrFormat === '12h' || endOrFormat === '24h') {
    format = endOrFormat;
  } else if (endOrFormat) {
    rawRange = `${rawRange} - ${String(endOrFormat).trim()}`;
  }

  return formatOpeningHours(rawRange, format);
}

/**
 * Format road construction / closures schedule text into standardized YYYY-MM-DD and hh:mm.
 */
export function formatConstructionSchedule(
  rawSchedule: string | null | undefined,
  format: '12h' | '24h' = '24h'
): string[] {
  if (!rawSchedule) return [];
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  return String(rawSchedule).split(';').map((part) => {
    let p = part.trim();
    // Match date range: "Jul 27, 2026 - Oct 19, 2026"
    p = p.replace(/([a-zA-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s*[-–—~至to]+\s*([a-zA-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/gi, (_, m1, d1, y1, m2, d2, y2) => {
      const mo1 = months[m1.toLowerCase().slice(0, 3)] || '01';
      const mo2 = months[m2.toLowerCase().slice(0, 3)] || '01';
      const da1 = String(d1).padStart(2, '0');
      const da2 = String(d2).padStart(2, '0');
      return `${y1}-${mo1}-${da1} 至 ${y2}-${mo2}-${da2}`;
    });
    // Match single date: "Oct 19, 2026"
    p = p.replace(/([a-zA-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/gi, (_, m1, d1, y1) => {
      const mo1 = months[m1.toLowerCase().slice(0, 3)] || '01';
      const da1 = String(d1).padStart(2, '0');
      return `${y1}-${mo1}-${da1}`;
    });
    // Weekdays & common words
    p = p.replace(/\bweekdays\b/gi, '平日 (週一至週五)');
    p = p.replace(/\bweekends\b/gi, '週末 (週六至週日)');
    p = p.replace(/\bdaily\b/gi, '每日');
    // Format any time component in this part
    p = formatOpeningHours(p, format);
    return p;
  }).filter(Boolean);
}

export function formatClock(
  date: Date, 
  format: '12h' | '24h' = '24h',
  timeZone?: string
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour12: format === '12h',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };
  // 溫哥華自 2026 年起實施永久單一時間制 (常年單一時間 UTC-7)，不再回撥至冬令 GMT-8
  const effectiveTimeZone = timeZone === 'America/Vancouver' ? 'Etc/GMT+7' : timeZone;
  if (effectiveTimeZone && effectiveTimeZone !== 'auto') {
    options.timeZone = effectiveTimeZone;
  }
  return date.toLocaleTimeString('zh-TW', options);
}

export function formatDateWithTimezone(date: Date, timeZone?: string): string {
  const effectiveTimeZone = timeZone === 'America/Vancouver' ? 'Etc/GMT+7' : timeZone;
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'shortOffset',
  };
  if (effectiveTimeZone && effectiveTimeZone !== 'auto') {
    options.timeZone = effectiveTimeZone;
  }
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
  return `${year}年${month}月${day}日`;
}

/**
 * Format shipping ETA with date as dd/MM/yyyy and time based on 12h/24h user preference.
 * E.g. "10-15 14:30" -> 24h: "15/10/2026 14:30"
 *                     -> 12h: "15/10/2026 02:30 PM"
 */
export function formatShipEta(
  etaStr: string | null | undefined,
  format: '12h' | '24h' = '24h'
): string {
  if (!etaStr) return '';
  const s = String(etaStr).trim();
  if (!s || s === '--') return '';

  let year = new Date().getFullYear();
  let month = 0;
  let day = 0;
  let hour = 0;
  let min = 0;
  let parsed = false;

  // 1. ISO or YYYY-MM-DD HH:mm(:ss)
  const fullMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{1,2})/);
  if (fullMatch) {
    year = parseInt(fullMatch[1], 10);
    month = parseInt(fullMatch[2], 10);
    day = parseInt(fullMatch[3], 10);
    hour = parseInt(fullMatch[4], 10);
    min = parseInt(fullMatch[5], 10);
    parsed = true;
  }

  // 2. AIS standard: MM-DD HH:mm or MM/DD HH:mm
  if (!parsed) {
    const mmddMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{1,2})/);
    if (mmddMatch) {
      month = parseInt(mmddMatch[1], 10);
      day = parseInt(mmddMatch[2], 10);
      hour = parseInt(mmddMatch[3], 10);
      min = parseInt(mmddMatch[4], 10);
      parsed = true;
    }
  }

  // 3. Fallback date parse
  if (!parsed) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
      hour = d.getHours();
      min = d.getMinutes();
      parsed = true;
    }
  }

  if (!parsed || month < 1 || month > 12 || day < 1 || day > 31) {
    return s;
  }

  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);
  const dateStr = `${dd}/${mm}/${yyyy}`;

  if (format === '12h') {
    const period = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 || 12;
    const timeStr = `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${period}`;
    return `${dateStr} ${timeStr}`;
  } else {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    return `${dateStr} ${timeStr}`;
  }
}

