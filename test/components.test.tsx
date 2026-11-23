import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HyperGLForm } from '../src/form';
import { HyperGLBooking } from '../src/booking';
import { ConsentBanner, ConsentGate } from '../src/consent-banner';
import { HyperGLTracking } from '../src/tracking';
import { getConsent } from '../src/consent';
import { queued } from '../src/form-sender';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
const realFetch = globalThis.fetch;
beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); globalThis.fetch = realFetch; vi.restoreAllMocks(); });

const until = async (check: () => boolean, ms = 12_000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await act(async () => { await new Promise((r) => setTimeout(r, 25)); }); }
};

const CONFIG = {
  title: 'Free trial class', fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'email', type: 'email', label: 'Email', required: true },
    { key: 'src', type: 'hidden', label: 'Source', required: false, hiddenSource: 'utm_source' },
  ],
  afterSend: { mode: 'message' as const, message: 'See you at the gym!', redirectUrl: null },
  ticket: '1.t',
};

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('<HyperGLForm>', () => {
  it('a failed send is retried, then the email fallback shows with the entry; the entry is kept', async () => {
    let posts = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts++; throw new TypeError('Failed to fetch'); }
      return new Response(JSON.stringify(CONFIG), { status: 200 });
    }) as unknown as typeof fetch;
    await act(async () => { root.render(<HyperGLForm token="hf_abcdefghijklmnopqrstuvwx" fallbackEmail="hello@pulsefitness.example" retryDelays={[50, 50, 50, 50, 50, 50, 50, 50]} fallbackAfterMs={200} />); });
    await until(() => !!host.querySelector('form'));
    type(host.querySelector('input[name="name"]')!, 'Ann Lee');
    type(host.querySelector('input[name="email"]')!, 'ann@lee.test');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await until(() => !!host.querySelector('.hg-fallback'));
    const fb = host.querySelector('.hg-fallback')!;
    expect(fb.textContent).toContain('Couldn’t send. Email us at hello@pulsefitness.example');
    const mail = fb.querySelector<HTMLAnchorElement>('a.hg-fallback-send')!.href;
    expect(decodeURIComponent(mail)).toContain('Name: Ann Lee');
    expect(decodeURIComponent(mail)).toContain('Email: ann@lee.test');
    await until(() => posts > 2);            // and it keeps retrying in the background
    expect(queued().length).toBe(1);
    expect(host.querySelector('form')!.hasAttribute('data-hgl-ignore')).toBe(true);
  }, 20_000);

  it('a send that works shows the thank-you message', async () => {
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { bodies.push(String(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return new Response(JSON.stringify(CONFIG), { status: 200 });
    }) as unknown as typeof fetch;
    await act(async () => { root.render(<HyperGLForm token="hf_abcdefghijklmnopqrstuvwx" />); });
    await until(() => !!host.querySelector('form'));
    type(host.querySelector('input[name="name"]')!, 'Ann Lee');
    type(host.querySelector('input[name="email"]')!, 'ann@lee.test');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await until(() => !!host.querySelector('.hg-sent'));
    expect(host.querySelector('.hg-sent')!.textContent).toBe('See you at the gym!');
    expect(JSON.parse(bodies[0])).toMatchObject({ values: { name: 'Ann Lee', email: 'ann@lee.test' }, ticket: '1.t', hp: '' });
    expect(queued()).toEqual([]);
  }, 20_000);

  it('Turnstile that errors on this domain: the form still sends; a robot-check refusal shows the email fallback and keeps the entry', async () => {
    let rendered: Record<string, unknown> | null = null;
    window.turnstile = { render: (_el, o) => { rendered = o; (o['error-callback'] as () => boolean)(); return 'w1'; }, reset: () => { throw new Error('no widget'); } };
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { bodies.push(String(init.body)); return new Response(JSON.stringify({ error: 'The check that you’re not a robot didn’t pass. Try again.', code: 'BOT_CHECK' }), { status: 400 }); }
      return new Response(JSON.stringify({ ...CONFIG, turnstileSiteKey: '0x4AAAAAAA-test' }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await act(async () => { root.render(<HyperGLForm token="hf_abcdefghijklmnopqrstuvwx" fallbackEmail="hello@pulsefitness.example" />); });
      await until(() => !!host.querySelector('form') && !!rendered);
      type(host.querySelector('input[name="name"]')!, 'Ann Lee');
      type(host.querySelector('input[name="email"]')!, 'ann@lee.test');
      await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await until(() => !!host.querySelector('.hg-fallback'));
      expect(host.querySelector('.hg-fallback')!.textContent).toContain('Email us at hello@pulsefitness.example');
      expect(host.querySelector('.hg-error')).toBeNull();
      expect(JSON.parse(bodies[0]).turnstile).toBeNull();
      expect(queued().length).toBe(1);
    } finally { delete window.turnstile; }
  }, 20_000);

  it('when the form can’t even load, it shows the email address', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await act(async () => { root.render(<HyperGLForm token="hf_abcdefghijklmnopqrstuvwx" fallbackEmail="hello@pulsefitness.example" />); });
    await until(() => !!host.querySelector('.hg-fallback'));
    expect(host.textContent).toContain('Email us at hello@pulsefitness.example');
  });
});

describe('<HyperGLBooking>', () => {
  it('a robot-check refusal shows the email fallback, not an error the person can’t fix', async () => {
    const start = '2026-12-01T15:00:00.000Z';
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ error: 'The check that you’re not a robot didn’t pass. Try again.', code: 'BOT_CHECK' }), { status: 400 });
      if (String(url).includes('/slots')) return new Response(JSON.stringify({ tz: 'UTC', from: '2026-12-01', days: [{ date: '2026-12-01', slots: [start] }] }));
      return new Response(JSON.stringify({ title: 'Book', tz: 'UTC', ticket: '1.t', turnstileSiteKey: null, types: [{ id: 't1', name: 'Checkup', durationMin: 30, questions: [], people: [{ id: 'p1', name: 'Dr. Reed' }] }] }));
    }) as unknown as typeof fetch;
    await act(async () => { root.render(<HyperGLBooking code="bk_abcdefghjkmn" fallbackEmail="hello@harbordental.example" />); });
    await until(() => !!host.querySelector('.hg-time'));
    await act(async () => { host.querySelector<HTMLButtonElement>('.hg-time')!.click(); });
    await until(() => !!host.querySelector('input[type="email"]'));
    type(host.querySelector('input[autocomplete="name"]')!, 'Ann Lee');
    type(host.querySelector('input[type="email"]')!, 'ann@lee.test');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await until(() => !!host.querySelector('.hg-fallback'));
    expect(host.querySelector('.hg-fallback')!.textContent).toContain('Email us at hello@harbordental.example');
    expect(host.querySelector('.hg-error')).toBeNull();
  }, 20_000);
});

describe('<ConsentBanner> and <ConsentGate>', () => {
  it('nothing behind the gate loads until Accept; Reject keeps it out', async () => {
    await act(async () => { root.render(<><ConsentBanner show="always" /><ConsentGate show="always"><span id="tag">tag</span></ConsentGate></>); });
    expect(host.querySelector('#tag')).toBeNull();
    expect(host.querySelector('.hg-consent-banner')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.hg-consent-accept')!.click(); });
    expect(getConsent()).toBe('granted');
    expect(host.querySelector('#tag')).not.toBeNull();
    expect(host.querySelector('.hg-consent-banner')).toBeNull();
    const dl = (window as unknown as { dataLayer: unknown[][] }).dataLayer;
    expect(dl.at(-1)).toEqual(['consent', 'update', expect.objectContaining({ ad_storage: 'granted' })]);
  });

  it('Reject: no tags, and the choice is remembered', async () => {
    await act(async () => { root.render(<><ConsentBanner show="always" /><ConsentGate show="always"><span id="tag">tag</span></ConsentGate></>); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.hg-consent-reject')!.click(); });
    expect(getConsent()).toBe('denied');
    expect(host.querySelector('#tag')).toBeNull();
    expect(host.querySelector('.hg-consent-banner')).toBeNull();
  });
});

describe('<HyperGLTracking>', () => {
  it('sends a view with the kit version, and nothing is stored when the site needs consent', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: String(init?.body) }); return new Response(JSON.stringify({ m: 'require_banner' }), { status: 200 }); }) as unknown as typeof fetch;
    await act(async () => { root.render(<HyperGLTracking source="ls_abcdefghijklmnopqrstuvwx" endpoint="https://in.agency.example" />); });
    await until(() => calls.length > 0);
    expect(calls[0].url).toBe('https://in.agency.example/api/public/v1/c/e?kv=1.0.1&s=ls_abcdefghijklmnopqrstuvwx');
    expect(JSON.parse(calls[0].body)).toMatchObject({ t: 'view', v: null });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(window.localStorage.getItem('hgl_vid')).toBeNull();
  });
});
