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

export function formatClock(date: Date, format: '12h' | '24h' = '24h'): string {
  return date.toLocaleTimeString('zh-TW', {
    hour12: format === '12h',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

