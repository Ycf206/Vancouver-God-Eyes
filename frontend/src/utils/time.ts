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
