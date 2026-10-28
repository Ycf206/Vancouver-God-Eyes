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
