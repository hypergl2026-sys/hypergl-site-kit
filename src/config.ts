/**
 * Where the kit sends things, and which kit it is.
 *
 * `endpoint` is the base the HyperGL API answers on: by default HyperGL's own
 * address, or the agency's domain / the ingestion hostname when HyperGL sets
 * it. The kit only ever calls the versioned `/api/public/v1/...` paths under it.
 */
export const KIT_VERSION = '1.0.0';
export const DEFAULT_ENDPOINT = 'https://app.hypergl.com';

let endpoint = DEFAULT_ENDPOINT;

/** Set the endpoint once for the whole site (each component can also take its own). */
export function configure(options: { endpoint?: string }): void {
  if (options.endpoint) endpoint = cleanEndpoint(options.endpoint);
}

export function cleanEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/api(\/public(\/v1)?)?$/, '');
}

export function getEndpoint(override?: string): string {
  return override ? cleanEndpoint(override) : endpoint;
}

/** `<endpoint>/api/public/v1/<path>?kv=<version>[&test=1&tt=…]` */
export function kitUrl(path: string, override?: string, query: Record<string, string> = {}): string {
  const u = new URL(`${getEndpoint(override)}/api/public/v1/${path.replace(/^\/+/, '')}`);
  u.searchParams.set('kv', KIT_VERSION);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const test = testToken();
  if (test) { u.searchParams.set('test', '1'); u.searchParams.set('tt', test); }
  return u.toString();
}

declare global {
  interface Window { __HG_TEST_TOKEN__?: string }
}

/**
 * Smoke tests set `window.__HG_TEST_TOKEN__` (the site's checkpoint token) before
 * the page loads. Every form and booking then goes out in test mode: checked by
 * HyperGL, never a lead.
 */
export function testToken(): string | null {
  if (typeof window === 'undefined') return null;
  const t = window.__HG_TEST_TOKEN__;
  return typeof t === 'string' && t ? t : null;
}

export const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
