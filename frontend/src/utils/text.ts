/**
 * Text formatting utilities.
 */

const PRESERVE_UPPERCASE = new Set([
  'BC', 'NW', 'SW', 'NE', 'SE', 'USA', 'CAN', 'VIP', 'ATM', 'AED', 'EV', 'GPS', 'ID', 'LED', 'TTC', 'WCE', 'UBC', 'SFU', 'YVR'
]);

/**
 * Convert English words in text to Title Case (e.g. "Heather Street", "13th Ave", "W 41st Ave").
 * Preserves Chinese characters, ordinals (1st, 2nd, 3rd, 13th), and acronyms.
 */
export function formatTitleCase(str: string | null | undefined): string {
  if (!str) return '';
  let s = String(str);
  
  // Normalize leading zeros in ordinals e.g. 07th -> 7th, 01st -> 1st
  s = s.replace(/\b0(\d+(?:st|nd|rd|th))\b/gi, (_m, g1) => g1);

  s = s.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) => {
    const upper = word.toUpperCase();
    if (PRESERVE_UPPERCASE.has(upper)) {
      return upper;
    }
    if (upper === 'AV') return 'Ave';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return s.replace(/(\d+)(st|nd|rd|th)\b/gi, (_m, num, suf) => `${num}${suf.toLowerCase()}`);
}

/**
 * 統一格式化北美電話號碼為 (XXX) XXX-XXXX
 */
export function formatPhoneNumber(phone: string | number | null | undefined): string {
  if (!phone) return '';
  const str = String(phone).trim();
  if (!str) return '';
  
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 7) {
    return `(604) ${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  if (digits.length > 10) {
    const main10 = digits.startsWith('1') ? digits.slice(1, 11) : digits.slice(0, 10);
    const ext = digits.startsWith('1') ? digits.slice(11) : digits.slice(10);
    return `(${main10.slice(0, 3)}) ${main10.slice(3, 6)}-${main10.slice(6)}${ext ? ` ext. ${ext}` : ''}`;
  }
  return str;
}
