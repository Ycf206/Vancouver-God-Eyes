/**
 * Time formatting utilities supporting 12-hour and 24-hour preferences.
 */

export function formatTimePreference(
  timeStr: string | null | undefined,
  format: '12h' | '24h' = '24h'
): string {
  if (!timeStr) return '';
  const s = String(timeStr).trim();
  if (!s || s === '--') return s;

  // Handle ISO string or full datetime
  if (s.includes('T') || (s.includes('-') && s.length > 10)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return format === '12h'
        ? d.toLocaleTimeString('zh-TW', { hour12: true, hour: 'numeric', minute: '2-digit' })
        : d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }
  }

  // Handle strings like "14:30", "07:00", "7:00 am", "7:00 PM", "14:30:00"
  const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!match) return s;

  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3] ? match[3].toLowerCase().replace(/\./g, '') : null;

  if (ampm) {
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  }

  if (format === '12h') {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${min} ${period}`;
  } else {
    const displayHour = String(hour).padStart(2, '0');
    return `${displayHour}:${min}`;
  }
}

/**
 * Format time range strings respecting 12h / 24h user preference.
 * Supports:
 *   formatTimeRange("07:00 - 09:30", '12h') -> "07:00 AM - 09:30 AM"
 *   formatTimeRange("07:00", "09:30", '12h') -> "07:00 AM - 09:30 AM"
 *   formatTimeRange("9am-6pm", '12h') -> "09:00 AM - 06:00 PM"
 *   formatTimeRange("8a.m. - 5p.m. Mon-Fri", '12h') -> "08:00 AM - 05:00 PM Mon-Fri"
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

  if (!rawRange || rawRange === '--' || rawRange === '24/7' || rawRange.toLowerCase() === '24 hours') return rawRange;

  // Regex matching time tokens: "07:00", "7:00am", "9am", "18:00", "6pm", "8a.m.", "5p.m."
  const timeTokenRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/gi;

  return rawRange.replace(timeTokenRegex, (match, hStr, mStr, ampmStr) => {
    // If it's just a lonely single/double digit without min or am/pm, don't confuse with dates or plain numbers
    // But in ranges like "9am-6pm", ampmStr is present. If no mStr and no ampmStr, check if colon was present.
    if (!mStr && !ampmStr) {
      return match;
    }

    let hour = parseInt(hStr, 10);
    const min = mStr || '00';
    const ampm = ampmStr ? ampmStr.toLowerCase().replace(/\./g, '') : null;

    if (ampm) {
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
    }

    if (format === '12h') {
      const period = hour >= 12 ? 'PM' : 'AM';
      let h12 = hour % 12;
      if (h12 === 0) h12 = 12;
      return `${String(h12).padStart(2, '0')}:${min} ${period}`;
    } else {
      return `${String(hour).padStart(2, '0')}:${min}`;
    }
  });
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
  return `${year}年${month}月${day}日 ${tzName}`;
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

