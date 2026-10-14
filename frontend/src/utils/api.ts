export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    // If accessed through domain or reverse proxy (standard ports 80/443 or empty port, e.g. vangodseye.fyi)
    if (!window.location.port || window.location.port === '80' || window.location.port === '443') {
      return window.location.origin;
    }
    // If accessed from a remote IP via port 3000 directly (development/legacy fallback)
    if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

export function getWsUrl(): string {
  if (typeof window !== 'undefined') {
    // If accessed through domain or reverse proxy (standard ports 80/443 or empty port, e.g. vangodseye.fyi)
    if (!window.location.port || window.location.port === '80' || window.location.port === '443') {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${window.location.host}/ws`;
    }
    if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return `ws://${window.location.hostname}:8000/ws`;
    }
  }
  const apiUrl = getApiUrl();
  return apiUrl.replace(/^http/, 'ws') + '/ws';
}
