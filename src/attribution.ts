/**
 * Where the visitor came from (utm tags, ad click ids, referrer), the same way
 * HyperGL's universal script reads it. Kept on the device only with consent;
 * without it, a form still sends where *this* visit came from.
 */
import { read, readJson, write } from './storage.js';

export interface Touch {
  at: string;
  landingPage: string;
  referrer: string | null;
  utm: Record<string, string>;
  clickIds: Record<string, string>;
}
export interface Attribution { first?: Touch; last?: Touch }

const UTM = ['source', 'medium', 'campaign', 'term', 'content', 'id'];
const CLICKS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'li_fat_id'];
const PERSONAL = /mail|phone|tel|name|addr|zip|post|pass|token/i;

/** The page address without query values that may carry personal data. */
export function cleanPath(loc: Location = window.location): string {
  const keep = new URLSearchParams();
  new URLSearchParams(loc.search).forEach((v, k) => { if (!PERSONAL.test(k)) keep.append(k, v.slice(0, 300)); });
  const q = keep.toString();
  return loc.pathname + (q ? `?${q}` : '');
}

/** This visit's touch, or null when it carries nothing (a direct visit). */
export function currentTouch(loc: Location = window.location, referrer: string = document.referrer): Touch | null {
  const q = new URLSearchParams(loc.search);
  const utm: Record<string, string> = {}; const clickIds: Record<string, string> = {};
  let any = false;
  for (const k of UTM) { const v = q.get(`utm_${k}`); if (v) { utm[k] = v.slice(0, 300); any = true; } }
  for (const k of CLICKS) { const v = q.get(k); if (v) { clickIds[k] = v.slice(0, 500); any = true; } }
  let ref: string | null = null;
  if (referrer) {
    try { const r = new URL(referrer); if (r.host !== loc.host) { ref = r.origin + r.pathname; any = true; } } catch { /* bad referrer */ }
  }
  return any ? { at: new Date().toISOString(), landingPage: cleanPath(loc), referrer: ref, utm, clickIds } : null;
}

/** Remember first and last touch + a visitor id. Only call with consent. */
export function rememberVisit(): void {
  const t = currentTouch();
  const a = readJson<Attribution>('hgl_t', {});
  if (t) { if (!a.first) a.first = t; a.last = t; write('hgl_t', JSON.stringify(a)); }
  if (!read('hgl_vid')) write('hgl_vid', Math.random().toString(36).slice(2) + Date.now().toString(36));
}

export function visitorId(): string | null { return read('hgl_vid'); }

/** What a form sends: what's remembered (with consent), else this visit's touch. */
export function attributionForForm(withConsent: boolean): Attribution | null {
  if (withConsent) {
    const a = readJson<Attribution>('hgl_t', {});
    if (a.first || a.last) return a;
  }
  const t = typeof window === 'undefined' ? null : currentTouch();
  return t ? { first: t, last: t } : null;
}
