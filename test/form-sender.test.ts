import { describe, it, expect, beforeEach } from 'vitest';
import { flushQueue, isBotCheckRefusal, queued, sendEntry, fallbackMailto, QUEUE_KEY, type FormEntry } from '../src/form-sender';

/** A virtual clock: sleeping moves time forward instantly. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

type Reply = Response | 'network';
function fakeFetch(posts: Reply[], ticket = '123.abc') {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body as string | undefined });
    if (method === 'GET') return new Response(JSON.stringify({ ticket }), { status: 200 });
    const next = posts.length > 1 ? posts.shift()! : posts[0];
    if (next === 'network') throw new TypeError('Failed to fetch');
    return next.clone();
  }) as unknown as typeof fetch;
  return { f, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

const entry = (over: Partial<FormEntry> = {}): FormEntry => ({
  id: `e${Math.random().toString(36).slice(2)}`, token: 'hf_abcdefghijklmnopqrstuvwx', values: { name: 'Ann Lee', email: 'ann@lee.test' },
  page: 'https://pulsefitness.example/contact', a: null, createdAt: Date.now(), ...over,
});
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const err500 = () => new Response('', { status: 503 });

beforeEach(() => { window.localStorage.clear(); delete window.__HG_TEST_TOKEN__; });

describe('sendEntry', () => {
  it('retries a failed send, then shows the email fallback after a few seconds, keeping the entry', async () => {
    const c = clock();
    const net = fakeFetch(['network']);
    let fellBackAt: number | null = null;
    const e = entry();
    const r = await sendEntry(e, { fetchImpl: net.f, now: c.now, sleep: c.sleep, retryDelays: [1000, 2000, 4000], fallbackAfterMs: 6000, onFallback: () => { fellBackAt ??= c.now(); } });
    expect(r).toEqual({ status: 'unsent' });
    expect(net.posts().length).toBe(4);          // the first try + 3 retries
    expect(fellBackAt).not.toBeNull();
    expect(fellBackAt! - 1_000_000).toBeGreaterThanOrEqual(6000);
    expect(fellBackAt! - 1_000_000).toBeLessThan(9000);
    expect(queued().map((q) => q.id)).toEqual([e.id]);   // never lost
  });

  it('a retry that gets through: sent, no fallback, queue empty', async () => {
    const c = clock();
    const net = fakeFetch([err500(), 'network', ok()]);
    let fell = false;
    const r = await sendEntry(entry(), { fetchImpl: net.f, now: c.now, sleep: c.sleep, retryDelays: [500, 500, 500], fallbackAfterMs: 60_000, onFallback: () => { fell = true; } });
    expect(r).toEqual({ status: 'sent' });
    expect(net.posts().length).toBe(3);
    expect(fell).toBe(false);
    expect(queued()).toEqual([]);
  });

  it('a problem the person must fix is not retried and not kept', async () => {
    const c = clock();
    const net = fakeFetch([new Response(JSON.stringify({ error: 'Please check the email address.' }), { status: 400 })]);
    const r = await sendEntry(entry(), { fetchImpl: net.f, now: c.now, sleep: c.sleep });
    expect(r).toEqual({ status: 'rejected', error: 'Please check the email address.' });
    expect(net.posts().length).toBe(1);
    expect(queued()).toEqual([]);
  });

  it('a robot-check refusal is never "rejected": the fallback shows at once and the entry is kept', async () => {
    for (const body of [{ error: 'The check that you’re not a robot didn’t pass. Try again.', code: 'BOT_CHECK' }, { error: 'The check that you’re not a robot didn’t pass. Try again.' }]) {
      window.localStorage.clear();
      const c = clock();
      const net = fakeFetch([new Response(JSON.stringify(body), { status: 400 })]);
      let fellBackAt: number | null = null;
      const e = entry();
      const r = await sendEntry(e, { fetchImpl: net.f, now: c.now, sleep: c.sleep, fallbackAfterMs: 60_000, onFallback: () => { fellBackAt ??= c.now(); } });
      expect(r).toEqual({ status: 'unsent' });
      expect(net.posts().length).toBe(1);            // retrying now won't help
      expect(fellBackAt).not.toBeNull();
      expect(fellBackAt! - 1_000_000).toBeLessThan(6000);   // at once, not after the usual wait
      expect(queued().map((q) => q.id)).toEqual([e.id]);    // never lost
    }
  });

  it('isBotCheckRefusal: only a 400 with the code or the robot wording', () => {
    expect(isBotCheckRefusal(400, { code: 'BOT_CHECK' })).toBe(true);
    expect(isBotCheckRefusal(400, { error: 'The check that you’re not a robot didn’t pass.' })).toBe(true);
    expect(isBotCheckRefusal(400, { error: 'Please check the email address.' })).toBe(false);
    expect(isBotCheckRefusal(404, { code: 'BOT_CHECK' })).toBe(false);
    expect(isBotCheckRefusal(400, null)).toBe(false);
  });

  it('waits until the ticket is 2 s old, and fetches a fresh one when it has expired', async () => {
    const c = clock();
    const net = fakeFetch([new Response(JSON.stringify({ error: 'This page was open a long time — reload it and send again.' }), { status: 400 }), ok()], 'fresh.ticket');
    const r = await sendEntry(entry(), { fetchImpl: net.f, now: c.now, sleep: c.sleep, ticket: { value: 'old.ticket', receivedAt: c.now() } });
    expect(r.status).toBe('sent');
    expect(c.now() - 1_000_000).toBeGreaterThanOrEqual(2100);
    const bodies = net.posts().map((p) => JSON.parse(p.body!).ticket);
    expect(bodies).toEqual(['old.ticket', 'fresh.ticket']);
  });

  it('posts text/plain JSON to the v1 path with the kit version (no preflight)', async () => {
    const c = clock();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return init.method === 'POST' ? ok() : new Response(JSON.stringify({ ticket: 't.1' }));
    }) as unknown as typeof fetch;
    await sendEntry(entry({ endpoint: 'https://in.agency.example/' }), { fetchImpl: f, now: c.now, sleep: c.sleep });
    const post = calls.find((x) => x.init.method === 'POST')!;
    expect(post.url).toMatch(/^https:\/\/in\.agency\.example\/api\/public\/v1\/f\/hf_abcdefghijklmnopqrstuvwx\?kv=1\.0\.1$/);
    expect((post.init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/);
    expect(post.init.credentials).toBe('omit');
  });

  it('test mode: the checkpoint token goes on the URL', async () => {
    window.__HG_TEST_TOKEN__ = 'hgt1.a.b.c.d';
    const c = clock();
    const net = fakeFetch([new Response(null, { status: 204 })]);
    expect((await sendEntry(entry(), { fetchImpl: net.f, now: c.now, sleep: c.sleep })).status).toBe('sent');
    expect(net.posts()[0].url).toContain('test=1&tt=hgt1.a.b.c.d');
  });
});

describe('the queue', () => {
  it('an entry left by an earlier page is sent on the next load; old ones are dropped', async () => {
    const c = clock(Date.now());
    const fresh = entry({ createdAt: Date.now() - 60_000 });
    const stale = entry({ createdAt: Date.now() - 8 * 24 * 3600_000 });
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify([fresh, stale]));
    const net = fakeFetch([ok()]);
    expect(await flushQueue({ fetchImpl: net.f, now: c.now, sleep: c.sleep })).toBe(1);
    expect(net.posts().length).toBe(1);
    expect(queued()).toEqual([]);
  });

  it('an entry kept after a robot-check refusal goes out on a later page load', async () => {
    const c = clock(Date.now());
    const e = entry({ createdAt: Date.now() - 60_000, turnstile: null });
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify([e]));
    const net = fakeFetch([ok()]);
    expect(await flushQueue({ fetchImpl: net.f, now: c.now, sleep: c.sleep })).toBe(1);
    expect(queued()).toEqual([]);
  });

  it('the fallback email has the entry written out', () => {
    const m = fallbackMailto('hello@pulsefitness.example', 'Free trial', [['Name', 'Ann Lee'], ['Phone', ''], ['Message', 'Mornings?']]);
    expect(m.startsWith('mailto:hello@pulsefitness.example?subject=Free%20trial&body=')).toBe(true);
    expect(decodeURIComponent(m.split('body=')[1])).toBe('Name: Ann Lee\nMessage: Mornings?');
  });
});
