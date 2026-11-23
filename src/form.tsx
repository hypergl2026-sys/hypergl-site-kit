'use client';
/**
 * <HyperGLForm token="hf_…" fallbackEmail="hello@pulsefitness.example" />
 *
 * Draws a HyperGL hosted form as plain HTML on the site (no iframe) and sends it
 * to Leads. If sending fails it keeps the entry, retries, and after a few
 * seconds shows "Couldn't send. Email us at …" with the entry ready to send.
 *
 * Styling: plain class names (`hg-form`, `hg-field`, `hg-label`, `hg-input`,
 * `hg-error`, `hg-fallback`, `hg-sent`, `hg-submit`); the site styles them.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { kitUrl } from './config.js';
import { attributionForForm } from './attribution.js';
import { getConsent } from './consent.js';
import { fallbackMailto, flushQueue, newEntryId, sendEntry, type FormEntry } from './form-sender.js';

export interface FormField {
  key: string;
  type: 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date' | 'select' | 'radio' | 'checkboxes' | 'hidden' | 'consent' | string;
  label: string;
  required: boolean;
  width?: 'full' | 'half' | string;
  placeholder?: string | null;
  help?: string | null;
  options?: string[];
  privacyUrl?: string | null;
  hiddenSource?: string | null;
}

export interface FormConfig {
  title: string;
  intro?: string;
  fields: FormField[];
  afterSend?: { mode: 'message' | 'redirect'; message: string; redirectUrl: string | null };
  turnstileSiteKey?: string | null;
  paused?: boolean;
  ticket?: string;
}

export interface HyperGLFormProps {
  /** The hosted form's public token (from HyperGL → Leads → Forms). */
  token: string;
  /** Where the entry can be emailed if sending fails. */
  fallbackEmail?: string;
  /** The form's fields, baked in at build time. The form still asks HyperGL for a fresh ticket. */
  config?: FormConfig;
  endpoint?: string;
  className?: string;
  submitLabel?: string;
  /** Shown while the form loads (no baked config). */
  loading?: ReactNode;
  onSent?: () => void;
  /** For tests: waits between tries, and when the fallback shows. */
  retryDelays?: number[];
  fallbackAfterMs?: number;
}

type Values = Record<string, string | string[] | boolean>;
type Status = 'idle' | 'sending' | 'sent' | 'fallback';

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } }
}

function hiddenValue(source: string | null | undefined): string {
  if (!source || typeof window === 'undefined') return '';
  if (source.startsWith('utm_')) return new URLSearchParams(window.location.search).get(source) ?? '';
  if (source === 'landing_page') return window.location.href.split('#')[0];
  if (source === 'referrer') return document.referrer;
  return '';
}

export function HyperGLForm(props: HyperGLFormProps) {
  const { token, endpoint, fallbackEmail } = props;
  const uid = useId();
  const [cfg, setCfg] = useState<FormConfig | null>(props.config ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const ticket = useRef<{ value: string; receivedAt: number } | null>(null);
  const [values, setValues] = useState<Values>({});
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<FormEntry | null>(null);
  const hp = useRef<HTMLInputElement>(null);
  const turnstileEl = useRef<HTMLDivElement>(null);
  const turnstileToken = useRef<string | null>(null);

  // The fields (unless baked in) and a fresh time ticket; then send anything an earlier page left.
  useEffect(() => {
    let live = true;
    fetch(kitUrl(`f/${encodeURIComponent(token)}`, endpoint), { credentials: 'omit', mode: 'cors' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: FormConfig) => {
        if (!live) return;
        if (typeof j.ticket === 'string') ticket.current = { value: j.ticket, receivedAt: Date.now() };
        setCfg((c) => c ?? j);
      })
      .catch(() => { if (live) setLoadFailed(true); });
    void flushQueue();
    return () => { live = false; };
  }, [token, endpoint]);

  // Hidden fields fill themselves from the page.
  useEffect(() => {
    if (!cfg) return;
    const auto: Values = {};
    for (const f of cfg.fields) if (f.type === 'hidden') auto[f.key] = hiddenValue(f.hiddenSource);
    setValues((v) => ({ ...auto, ...v }));
  }, [cfg]);

  // Cloudflare Turnstile, only when HyperGL has it on. If the widget can't load or
  // errors (e.g. this domain isn't allowed), the form still sends without a token;
  // a robot-check refusal then shows the email fallback and keeps the entry.
  const siteKey = cfg?.turnstileSiteKey ?? null;
  useEffect(() => {
    if (!siteKey || !turnstileEl.current) return;
    const draw = () => {
      if (window.turnstile && turnstileEl.current && !turnstileEl.current.childElementCount) {
        try {
          window.turnstile.render(turnstileEl.current, {
            sitekey: siteKey,
            callback: (t: string) => { turnstileToken.current = t; },
            'expired-callback': () => { turnstileToken.current = null; },
            'timeout-callback': () => { turnstileToken.current = null; },
            // Handled: no token; the send still goes out (see above).
            'error-callback': () => { turnstileToken.current = null; return true; },
          });
        } catch { turnstileToken.current = null; }
      }
    };
    if (window.turnstile) { draw(); return; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = draw;
    s.onerror = () => { turnstileToken.current = null; };
    document.head.appendChild(s);
  }, [siteKey]);

  const set = (key: string, v: string | string[] | boolean) => setValues((cur) => ({ ...cur, [key]: v }));

  const mailto = useMemo(() => {
    if (!fallback || !fallbackEmail || !cfg) return null;
    const lines = cfg.fields.filter((f) => f.type !== 'hidden' && f.type !== 'consent').map((f): [string, string] => {
      const v = fallback.values[f.key];
      return [f.label, Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)];
    });
    return fallbackMailto(fallbackEmail, cfg.title || 'Website inquiry', lines);
  }, [fallback, fallbackEmail, cfg]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cfg || status === 'sending') return;
    setError(null);
    setStatus('sending');
    const entry: FormEntry = {
      id: newEntryId(), token, endpoint, values,
      page: typeof window === 'undefined' ? null : window.location.href,
      a: attributionForForm(getConsent() === 'granted'),
      hp: hp.current?.value ?? '', turnstile: turnstileToken.current, createdAt: Date.now(),
    };
    const r = await sendEntry(entry, {
      ticket: ticket.current,
      retryDelays: props.retryDelays,
      fallbackAfterMs: props.fallbackAfterMs,
      onFallback: (en) => { setFallback(en); setStatus('fallback'); },
    });
    ticket.current = null; // used: a new one is fetched for the next send
    if (r.status === 'sent') {
      setFallback(null);
      setStatus('sent');
      props.onSent?.();
      const after = cfg.afterSend;
      if (after?.mode === 'redirect' && after.redirectUrl) window.location.assign(after.redirectUrl);
    } else if (r.status === 'rejected') {
      setStatus('idle');
      setError(r.error);
      try { window.turnstile?.reset(); } catch { /* no widget */ }
    }
    // 'unsent': the fallback is already showing, and the entry stays queued.
  }

  if (!cfg) {
    if (loadFailed) {
      return (
        <div className={['hg-form', props.className].filter(Boolean).join(' ')} data-hg-form="unavailable">
          <p className="hg-fallback" role="alert">
            {fallbackEmail
              ? <>This form couldn’t load. Email us at <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>.</>
              : <>This form couldn’t load. Please try again later.</>}
          </p>
        </div>
      );
    }
    return <div className={['hg-form', props.className].filter(Boolean).join(' ')} data-hg-form="loading" aria-busy="true">{props.loading ?? null}</div>;
  }

  if (status === 'sent' && cfg.afterSend?.mode !== 'redirect') {
    return (
      <div className={['hg-form', props.className].filter(Boolean).join(' ')} data-hg-form="sent">
        <p className="hg-sent" role="status">{cfg.afterSend?.message || 'Thanks! We’ll be in touch soon.'}</p>
      </div>
    );
  }

  return (
    // data-hgl-ignore: HyperGL's universal script, if also on the page, leaves this form alone (no double entry).
    <form className={['hg-form', props.className].filter(Boolean).join(' ')} data-hg-form={status} data-hgl-ignore="" onSubmit={onSubmit} noValidate={false}>
      {cfg.fields.map((f) => <Field key={f.key} id={`${uid}-${f.key}`} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />)}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Leave this empty<input ref={hp} type="text" name="hg_website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {siteKey ? <div ref={turnstileEl} className="hg-turnstile" /> : null}
      {error ? <p className="hg-error" role="alert">{error}</p> : null}
      {status === 'fallback' ? (
        <div className="hg-fallback" role="alert">
          {fallbackEmail && mailto
            ? <p>Couldn’t send. Email us at <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>. <a href={mailto} className="hg-fallback-send">Email your message</a></p>
            : <p>Couldn’t send yet. We’ll keep trying while this page is open.</p>}
        </div>
      ) : null}
      <button type="submit" className="hg-submit" disabled={status === 'sending' || cfg.paused}>
        {status === 'sending' ? 'Sending…' : props.submitLabel ?? 'Send'}
      </button>
    </form>
  );
}

function Field({ id, field: f, value, onChange }: { id: string; field: FormField; value: Values[string] | undefined; onChange: (v: string | string[] | boolean) => void }) {
  if (f.type === 'hidden') return null;
  const req = f.required ? <span aria-hidden="true"> *</span> : null;
  const help = f.help ? <span className="hg-help" id={`${id}-help`}>{f.help}</span> : null;
  const common = { id, name: f.key, required: f.required, 'aria-describedby': f.help ? `${id}-help` : undefined, className: 'hg-input' };
  const wrap = (children: ReactNode) => <div className="hg-field" data-type={f.type} data-width={f.width ?? 'full'}>{children}</div>;

  if (f.type === 'consent') {
    return wrap(
      <label className="hg-consent" htmlFor={id}>
        <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}{f.privacyUrl ? <> <a href={f.privacyUrl} target="_blank" rel="noreferrer">Privacy policy</a></> : null}</span>
      </label>,
    );
  }
  if (f.type === 'radio' || f.type === 'checkboxes') {
    const multi = f.type === 'checkboxes';
    const cur = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return wrap(
      <fieldset className="hg-group" aria-describedby={f.help ? `${id}-help` : undefined}>
        <legend className="hg-label">{f.label}{req}</legend>
        {(f.options ?? []).map((o, i) => (
          <label key={o} className="hg-option" htmlFor={`${id}-${i}`}>
            <input
              id={`${id}-${i}`} name={f.key} type={multi ? 'checkbox' : 'radio'} value={o}
              required={!multi && f.required} checked={cur.includes(o)}
              onChange={(e) => onChange(multi ? (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)) : o)}
            />
            <span>{o}</span>
          </label>
        ))}
        {help}
      </fieldset>,
    );
  }
  const label = <label className="hg-label" htmlFor={id}>{f.label}{req}</label>;
  const str = typeof value === 'string' ? value : '';
  if (f.type === 'textarea') return wrap(<>{label}<textarea {...common} rows={5} placeholder={f.placeholder ?? undefined} value={str} onChange={(e) => onChange(e.target.value)} />{help}</>);
  if (f.type === 'select') {
    return wrap(<>{label}
      <select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder || 'Choose…'}</option>
        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>{help}</>);
  }
  const type = ['email', 'tel', 'number', 'date'].includes(f.type) ? f.type : 'text';
  const auto = f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : /name/i.test(f.key) ? 'name' : undefined;
  return wrap(<>{label}<input {...common} type={type} autoComplete={auto} placeholder={f.placeholder ?? undefined} value={str} onChange={(e) => onChange(e.target.value)} />{help}</>);
}
