/**
 * Text formatting utilities.
 */

/**
 * Convert English words in text to Title Case (e.g. "Heather Street", "13th Ave", "W 41st Ave").
 * Preserves Chinese characters, ordinals (1st, 2nd, 3rd, 13th), and acronyms.
 */
export function formatTitleCase(str: string | null | undefined): string {
  if (!str) return '';
  const s = String(str);
  
  return s
    .replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) => {
      // Don't modify specific uppercase short acronyms if already uppercase and <= 3 chars (like BC, NW, SE, VIP)
      if (word.length <= 3 && word === word.toUpperCase() && !/^(AND|THE|FOR|VIA|AVE|ST|RD)$/i.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .replace(/(\d+)(st|nd|rd|th)\b/gi, (_m, num, suf) => `${num}${suf.toLowerCase()}`);
}
