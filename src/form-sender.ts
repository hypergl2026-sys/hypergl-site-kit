/**
 * Sending a form so that no entry is ever lost (dev plan part 02 §2, review G4).
 *
 *  1. The entry goes into a queue in the browser **before** it is sent, so a
 *     closed tab or a dead network still has it.
 *  2. It is sent to the hosted-form endpoint. A network error, a timeout, a 5xx
 *     or a 429 means "try again": it is retried with growing waits.
 *  3. If it still hasn't gone after a few seconds (`fallbackAfterMs`), the form
 *     shows "Couldn't send. Email us at …" with the entry ready to send by
 *     email — and keeps retrying in the background.
 *  4. Anything still queued is sent again the next time any page with the kit
 *     loads (`flushQueue`). Old entries (7 days) are dropped.
 *
 * A 4xx with a message is the person's to fix ("Please check the email
 * address") and is not retried. The one exception is the robot check
 * (Cloudflare Turnstile, `code: 'BOT_CHECK'`): the person can't fix that — the
 * widget may not run on this domain at all — so the entry is never dropped for
 * it. The email fallback shows at once and the entry stays queued for the next
 * page load. The hosted-form endpoint wants a time ticket
 * that is at least 2 s old: the sender waits for that, and fetches a fresh one
 * when the old one has expired or the entry comes from the queue.
 */
import { kitUrl } from './config.js';
import { readJson, write } from './storage.js';

export interface FormEntry {
  id: string;
  token: string;
  endpoint?: string;
  values: Record<string, unknown>;
  page: string | null;
  a: unknown;
  hp?: string;
  turnstile?: string | null;
  createdAt: number;
}

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'rejected'; error: string }
  | { status: 'unsent' };

export interface SendOptions {
  fetchImpl?: typeof fetch;
  /** Waits between tries, in ms. */
  retryDelays?: number[];
  /** When to show the email fallback while retries go on. */
  fallbackAfterMs?: number;
  onFallback?: (entry: FormEntry) => void;
  /** A ticket the page already has, and when it arrived (ms). */
  ticket?: { value: string; receivedAt: number } | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const QUEUE_KEY = 'hg_form_queue';
export const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
export const DEFAULT_FALLBACK_AFTER_MS = 6000;
const MIN_TICKET_AGE_MS = 2100;
const MAX_QUEUE = 20;
const MAX_AGE_MS = 7 * 24 * 3600_000;
const REQUEST_TIMEOUT_MS = 10_000;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Entries this page is sending right now (so a queue flush never sends one twice). */
const inFlight = new Set<string>();

export function newEntryId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ─── The queue ───────────────────────────────────────────────────────────────

export function queued(): FormEntry[] {
  const list = readJson<FormEntry[]>(QUEUE_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : [];
}
function saveQueue(list: FormEntry[]): void {
  write(QUEUE_KEY, list.length ? JSON.stringify(list.slice(-MAX_QUEUE)) : null);
}
export function enqueue(entry: FormEntry): void {
  saveQueue([...queued().filter((e) => e.id !== entry.id), entry]);
}
export function dequeue(id: string): void {
  saveQueue(queued().filter((e) => e.id !== id));
}

// ─── One try ─────────────────────────────────────────────────────────────────

type Try = { kind: 'sent' } | { kind: 'retry' } | { kind: 'rejected'; error: string } | { kind: 'stale-ticket' } | { kind: 'bot-check' };

/** HyperGL's "you're not a robot" refusal: by its code, or (older APIs) its words. */
export function isBotCheckRefusal(status: number, body: { error?: unknown; code?: unknown } | null): boolean {
  if (status !== 400 || !body) return false;
  return body.code === 'BOT_CHECK' || /robot/i.test(String(body.error ?? ''));
}

async function withTimeout(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
  try { return await f(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) }); } finally { if (t) clearTimeout(t); }
}

async function fetchTicket(f: typeof fetch, entry: FormEntry, now: () => number): Promise<{ value: string; receivedAt: number } | null> {
  try {
    const r = await withTimeout(f, kitUrl(`f/${encodeURIComponent(entry.token)}`, entry.endpoint), { method: 'GET', credentials: 'omit', mode: 'cors' });
    if (!r.ok) return null;
    const j = await r.json() as { ticket?: unknown };
    return typeof j.ticket === 'string' ? { value: j.ticket, receivedAt: now() } : null;
  } catch { return null; }
}

async function tryOnce(f: typeof fetch, entry: FormEntry, ticket: string): Promise<Try> {
  let r: Response;
  try {
    r = await withTimeout(f, kitUrl(`f/${encodeURIComponent(entry.token)}`, entry.endpoint), {
      method: 'POST', credentials: 'omit', mode: 'cors', keepalive: true,
      // text/plain: a "simple" request, so the browser sends no preflight.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ values: entry.values, hp: entry.hp ?? '', ticket, turnstile: entry.turnstile ?? null, page: entry.page, a: entry.a }),
    });
  } catch { return { kind: 'retry' }; }
  if (r.ok) return { kind: 'sent' };
  if (r.status >= 500 || r.status === 429 || r.status === 408) return { kind: 'retry' };
  let body: { error?: unknown; code?: unknown } | null = null;
  try { body = (await r.json()) as { error?: unknown; code?: unknown }; } catch { /* no body */ }
  const error = String(body?.error ?? '');
  if (isBotCheckRefusal(r.status, body)) return { kind: 'bot-check' };
  if (r.status === 400 && /open a long time|reload/i.test(error)) return { kind: 'stale-ticket' };
  return { kind: 'rejected', error: error || 'That didn’t send. Please check the form and try again.' };
}

// ─── Send with retries ───────────────────────────────────────────────────────

/**
 * Send one entry. Resolves when it is sent, rejected (the person must fix
 * something), or out of retries (still queued for the next page load).
 */
export async function sendEntry(entry: FormEntry, opts: SendOptions = {}): Promise<SendOutcome> {
  inFlight.add(entry.id);
  try { return await sendWithRetries(entry, opts); } finally { inFlight.delete(entry.id); }
}

async function sendWithRetries(entry: FormEntry, opts: SendOptions): Promise<SendOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const delays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS;
  const fallbackAfter = opts.fallbackAfterMs ?? DEFAULT_FALLBACK_AFTER_MS;
  const started = now();
  let fellBack = false;
  const maybeFallback = () => {
    if (!fellBack && now() - started >= fallbackAfter) { fellBack = true; opts.onFallback?.(entry); }
  };

  enqueue(entry);
  let ticket = opts.ticket ?? null;
  let freshTicketTried = false;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      // Wait in small steps so the fallback shows on time even during a long wait.
      let left = delays[attempt - 1];
      while (left > 0) { const step = Math.min(left, 500); await sleep(step); left -= step; maybeFallback(); }
    }
    if (!ticket) ticket = await fetchTicket(f, entry, now);
    if (!ticket) { maybeFallback(); continue; }
    const age = now() - ticket.receivedAt;
    if (age < MIN_TICKET_AGE_MS) await sleep(MIN_TICKET_AGE_MS - age);
    const r = await tryOnce(f, entry, ticket.value);
    if (r.kind === 'sent') { dequeue(entry.id); return { status: 'sent' }; }
    if (r.kind === 'rejected') { dequeue(entry.id); return { status: 'rejected', error: r.error }; }
    // The robot check: retrying now won't help. Keep the entry and show the email fallback.
    if (r.kind === 'bot-check') { if (!fellBack) { fellBack = true; opts.onFallback?.(entry); } return { status: 'unsent' }; }
    if (r.kind === 'stale-ticket') {
      ticket = null;
      if (!freshTicketTried) { freshTicketTried = true; attempt--; continue; }
      dequeue(entry.id);
      return { status: 'rejected', error: 'This page was open a long time. Reload it and send again.' };
    }
    maybeFallback();
  }
  if (!fellBack) { fellBack = true; opts.onFallback?.(entry); }
  return { status: 'unsent' };
}

let flushing = false;

/** Send whatever an earlier page left in the queue. Quiet: no UI. */
export async function flushQueue(opts: SendOptions = {}): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const now = (opts.now ?? Date.now)();
    for (const e of queued()) {
      if (inFlight.has(e.id)) continue;
      if (now - e.createdAt > MAX_AGE_MS) { dequeue(e.id); continue; }
      const r = await sendEntry(e, { ...opts, ticket: null, retryDelays: opts.retryDelays ?? [2000], onFallback: undefined });
      if (r.status === 'sent') sent++;
    }
  } finally { flushing = false; }
  return sent;
}

/** A mailto: link with the entry written out, for the fallback. */
export function fallbackMailto(email: string, subject: string, lines: Array<[string, string]>): string {
  const body = lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
