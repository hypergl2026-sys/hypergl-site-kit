/**
 * The visitor's consent choice, shared by every kit piece.
 *
 * `granted` / `denied` once the visitor answers the banner, `null` before. The
 * choice itself is kept on the device (that's needed to not ask again); nothing
 * else is stored until it is `granted`, or until HyperGL says this site doesn't
 * need a banner.
 */
import { read, write } from './storage.js';

export type ConsentChoice = 'granted' | 'denied';
const KEY = 'hg_consent';
type Listener = (c: ConsentChoice | null) => void;
const listeners = new Set<Listener>();

export function getConsent(): ConsentChoice | null {
  const v = read(KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

export function setConsent(choice: ConsentChoice): void {
  write(KEY, choice);
  // Google Consent Mode, for any Google tags the site loads after consent.
  try {
    const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    const state = { ad_storage: choice, ad_user_data: choice, ad_personalization: choice, analytics_storage: choice };
    if (typeof w.gtag === 'function') w.gtag('consent', 'update', state);
    else w.dataLayer.push(['consent', 'update', state]);
  } catch { /* no window */ }
  for (const l of listeners) l(choice);
}

export function onConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Google Consent Mode's latest ad_storage on the page, if the site uses it. */
export function googleAdStorage(): string | null {
  try {
    const d = ((window as unknown as { dataLayer?: unknown[] }).dataLayer) ?? [];
    let s: string | null = null;
    for (const e of d) {
      const x = e as unknown[] | null;
      if (x && x[0] === 'consent' && x[2] && typeof (x[2] as { ad_storage?: unknown }).ad_storage === 'string') s = (x[2] as { ad_storage: string }).ad_storage;
    }
    return s;
  } catch { return null; }
}

/** What the page tells HyperGL about consent (same shape as the universal script). */
export function consentSignals(): { g: string | null } {
  const c = getConsent();
  return { g: c ?? googleAdStorage() };
}

/** Is this visitor probably in the EU, the EEA, the UK or Switzerland? (time zone, no lookup) */
export function likelyNeedsBanner(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return /^Europe\//.test(tz) || /^Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe)$/.test(tz);
  } catch { return true; }
}
