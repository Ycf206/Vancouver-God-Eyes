import stationMapData from '@/data/SkytrainStationMap.json';

interface StationMapEntry {
  Entrance?: string;
  Station?: string;
}

function normalizeStationName(name: string): string {
  let s = (name || '').toLowerCase();
  s = s.replace(/\s*站\s*$/, '').replace(/\s*station\s*/g, ' ');
  // Replace en-dash, em-dash, hyphens with space
  s = s.replace(/[\u2013\u2014\-]/g, ' ');
  s = s.replace(/[\u2019']/g, '');
  return s.split(/\s+/).filter(Boolean).join(' ').trim();
}

// Pre-indexed lookup map for fast O(1) matching
const stationMapLookup: Map<string, StationMapEntry> = new Map();

try {
  const data = stationMapData as Record<string, Record<string, StationMapEntry>>;
  for (const line of Object.values(data)) {
    for (const [stName, urls] of Object.entries(line)) {
      const norm = normalizeStationName(stName);
      if (norm) {
        stationMapLookup.set(norm, urls);
      }
    }
  }
} catch (e) {
  console.warn('Error indexing SkytrainStationMap:', e);
}

/**
 * Given a station name (e.g. "Waterfront 站", "Vancouver City Centre", "Joyce–Collingwood"),
 * returns official Station Map and Accessible Entrance Map PDF links.
 */
export function getSkytrainStationMapUrls(stationName: string): StationMapEntry | null {
  if (!stationName) return null;
  const norm = normalizeStationName(stationName);
  if (stationMapLookup.has(norm)) {
    return stationMapLookup.get(norm)!;
  }
  // Fallback to substring matching
  for (const [key, urls] of stationMapLookup.entries()) {
    if (key && (key.includes(norm) || norm.includes(key))) {
      return urls;
    }
  }
  return null;
}
