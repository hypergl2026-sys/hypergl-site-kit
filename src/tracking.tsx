'use client';
/**
 * <HyperGLTracking source="ls_…" />   — put it once in the root layout.
 *
 * Cookie-free page views and where visitors came from, sent to the site's
 * Leads source (HyperGL's universal script endpoint). The first view of a visit
 * asks HyperGL whether this site needs consent; later views (client-side
 * navigation included) go out with `navigator.sendBeacon`. Nothing is stored on
 * the device until there is consent (the banner, Google Consent Mode, or a site
 * HyperGL marks "no banner needed").
 *
 * This does not capture forms: use <HyperGLForm> for those.
 */
import { useEffect } from 'react';
import { kitUrl } from './config.js';
import { cleanPath, rememberVisit, visitorId } from './attribution.js';
import { consentSignals, getConsent, onConsentChange } from './consent.js';
import { flushQueue } from './form-sender.js';

export interface HyperGLTrackingProps {
  /** The site's Leads script source token (`ls_…`). */
  source: string;
  endpoint?: string;
}

const SOURCE_RE = /^ls_[A-Za-z0-9]{24}$/;
let siteMode: 'assume_granted' | 'require_banner' | null = null;

/** May the kit remember this visitor (attribution + visitor id)? */
export function storageAllowed(mode = siteMode): boolean {
  const c = getConsent();
  if (c) return c === 'granted';
  const g = consentSignals().g;
  if (g === 'denied') return false;
  if (g === 'granted') return true;
  return mode === 'assume_granted';
}

function send(url: string, body: object, beacon: boolean): Promise<Response> | null {
  const s = JSON.stringify(body);
  if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try { if (navigator.sendBeacon(url, new Blob([s], { type: 'text/plain' }))) return null; } catch { /* fall through to fetch */ }
  }
  return fetch(url, { method: 'POST', keepalive: true, mode: 'cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: s });
}

export function HyperGLTracking({ source, endpoint }: HyperGLTrackingProps) {
  useEffect(() => {
    if (!SOURCE_RE.test(source)) return;
    const url = kitUrl('c/e', endpoint, { s: source });
    let last = '';
    let first = true;

    const view = () => {
      const here = cleanPath();
      if (here === last) return;
      last = here;
      const body = { t: 'view', v: storageAllowed() ? visitorId() : null, p: window.location.href, c: consentSignals() };
      const p = send(url, body, !first);
      if (first && p) {
        p.then((r) => (r.ok ? r.json() : null))
          .then((j: { m?: 'assume_granted' | 'require_banner' } | null) => {
            if (j?.m) siteMode = j.m;
            if (storageAllowed()) rememberVisit();
          })
          .catch(() => undefined);
      }
      first = false;
    };

    view();
    // Client-side navigation (Next.js links) changes the address without a page load.
    const h = window.history;
    const push = h.pushState; const replace = h.replaceState;
    h.pushState = function (...a: Parameters<History['pushState']>) { const r = push.apply(this, a); setTimeout(view, 0); return r; };
    h.replaceState = function (...a: Parameters<History['replaceState']>) { const r = replace.apply(this, a); setTimeout(view, 0); return r; };
    window.addEventListener('popstate', view);
    const off = onConsentChange((c) => { if (c === 'granted') rememberVisit(); });
    void flushQueue();
    return () => {
      h.pushState = push; h.replaceState = replace;
      window.removeEventListener('popstate', view);
      off();
    };
  }, [source, endpoint]);
  return null;
}
