/**
 * Backend endpoint configuration. The base URL comes from VITE_API_URL at build
 * time and defaults to the local dev server. Everything that talks to the
 * backend (HTTP API + WebSocket) derives its URL from here.
 */

// VITE_API_URL targets a specific backend host. When empty (the default), the
// client uses SAME-ORIGIN URLs: API calls are relative (`/v1/...`) and the
// WebSocket is derived from window.location. In dev that resolves through the
// Vite proxy to ringd; in production it resolves through whatever reverse proxy
// serves the app, so one public URL is all that's needed.
const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Base URL for HTTP API calls, e.g. `${apiBaseUrl()}/v1/register`. Empty =
 *  same-origin (relative). */
export function apiBaseUrl(): string {
  return API_URL;
}

/** WebSocket URL for the relay, with the auth token as a query param (browsers
 *  can't set headers on a WebSocket). */
export function wsUrl(token: string): string {
  const q = `token=${encodeURIComponent(token)}`;
  if (API_URL) {
    const u = new URL(API_URL);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/v1/ws';
    u.search = q;
    return u.toString();
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/v1/ws?${q}`;
}
