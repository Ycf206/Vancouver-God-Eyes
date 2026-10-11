export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    // If accessed from a remote IP or domain (not localhost), dynamically use window.location.hostname:8000
    if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace(/^http/, 'ws') + '/ws';
}
