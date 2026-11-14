/**
 * Resolves the server-side FastAPI backend base URL consistently across Next.js API routes.
 */
export function getServerBackendUrl(): string {
  return (
    process.env.INTERNAL_BACKEND_URL ||
    process.env.BACKEND_INTERNAL_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : 'http://backend:8000')
  );
}
