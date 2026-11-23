'use client';
/**
 * <HyperGLBooking code="bk_…" fallbackEmail="hello@harbordental.example" />
 *
 * The client's HyperGL booking page, drawn on the site: pick a service, a
 * person (or anyone), a day and a time, then name and email. The booking and
 * its lead go into HyperGL. A booking is never queued for later (the time may
 * be gone): if HyperGL can't be reached, or it refuses the booking at its
 * robot check (which can't run on every domain), the widget says so and shows
 * the fallback email.
 *
 * Styling: `hg-booking`, `hg-booking-step`, `hg-days`, `hg-day`, `hg-times`,
 * `hg-time`, plus the form classes (`hg-field`, `hg-label`, `hg-input`, …).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { kitUrl } from './config.js';
import { attributionForForm } from './attribution.js';
import { getConsent } from './consent.js';
import { isBotCheckRefusal } from './form-sender.js';

interface BookingType {
  id: string; name: string; durationMin: number;
  questions: Array<{ id: string; label: string; required: boolean }>;
  people: Array<{ id: string; name: string }>;
}
interface BookingConfig { title: string; intro?: string | null; tz: string; types: BookingType[]; turnstileSiteKey?: string | null; ticket: string }
interface Slots { tz: string; from: string; days: Array<{ date: string; slots: string[] }> }

export interface HyperGLBookingProps {
  /** The client's booking code (`bk_…`, from HyperGL → Leads → Booking). */
  code: string;
  fallbackEmail?: string;
  endpoint?: string;
  className?: string;
  onBooked?: (manageToken: string | null) => void;
}

const MIN_TICKET_AGE_MS = 2100;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'omit', mode: 'cors' });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
  return r.json() as Promise<T>;
}

export function HyperGLBooking({ code, fallbackEmail, endpoint, className, onBooked }: HyperGLBookingProps) {
  const uid = useId();
  const [cfg, setCfg] = useState<BookingConfig | null>(null);
  const [down, setDown] = useState(false);
  const loadedAt = useRef(0);
  const [typeId, setTypeId] = useState('');
  const [personId, setPersonId] = useState('any');
  const [slots, setSlots] = useState<Slots | null>(null);
  const [day, setDay] = useState('');
  const [start, setStart] = useState('');
  const [details, setDetails] = useState({ name: '', email: '', phone: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const hp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getJson<BookingConfig>(kitUrl(`b/${encodeURIComponent(code)}`, endpoint))
      .then((c) => { if (!live) return; loadedAt.current = Date.now(); setCfg(c); if (c.types.length === 1) setTypeId(c.types[0].id); })
      .catch(() => { if (live) setDown(true); });
    return () => { live = false; };
  }, [code, endpoint]);

  useEffect(() => {
    if (!typeId) { setSlots(null); return; }
    let live = true;
    setSlots(null); setDay(''); setStart('');
    getJson<Slots>(kitUrl(`b/${encodeURIComponent(code)}/slots`, endpoint, { type: typeId, person: personId }))
      .then((s) => { if (!live) return; setSlots(s); const first = s.days.find((d) => d.slots.length); if (first) setDay(first.date); })
      .catch(() => { if (live) setError('Couldn’t load the free times. Please try again.'); });
    return () => { live = false; };
  }, [code, endpoint, typeId, personId]);

  const type = cfg?.types.find((t) => t.id === typeId) ?? null;
  const tz = slots?.tz ?? cfg?.tz ?? 'UTC';
  const timeOf = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
  const dayLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cfg || !type || !start || busy) return;
    setBusy(true); setError(null);
    const wait = MIN_TICKET_AGE_MS - (Date.now() - loadedAt.current);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(kitUrl(`b/${encodeURIComponent(code)}`, endpoint), {
        method: 'POST', credentials: 'omit', mode: 'cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          typeId: type.id, personId, start, name: details.name, email: details.email, phone: details.phone || undefined, answers,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ticket: cfg.ticket, hp: hp.current?.value ?? '',
          page: window.location.href, a: attributionForForm(getConsent() === 'granted'),
        }),
      });
      if (r.ok) {
        let manage: string | null = null;
        try { manage = (((await r.json()) as { manage?: string }).manage) ?? null; } catch { /* 204 in test mode */ }
        setDone(true); onBooked?.(manage);
      } else if (r.status >= 500 || r.status === 429) {
        setDown(true);
      } else {
        let body: { error?: unknown; code?: unknown } | null = null;
        try { body = (await r.json()) as { error?: unknown; code?: unknown }; } catch { /* no body */ }
        if (isBotCheckRefusal(r.status, body)) setDown(true);
        else setError(String(body?.error || 'That didn’t work. Please check and try again.'));
      }
    } catch { setDown(true); } finally { setBusy(false); }
  }

  const cls = ['hg-booking', className].filter(Boolean).join(' ');
  const fallback = (
    <p className="hg-fallback" role="alert">
      {fallbackEmail ? <>Booking isn’t working right now. Email us at <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a> and we’ll find a time.</> : <>Booking isn’t working right now. Please try again later.</>}
    </p>
  );
  if (done) return <div className={cls} data-hg-booking="booked"><p className="hg-sent" role="status">You’re booked. We’ve emailed you the details.</p></div>;
  if (down && !cfg) return <div className={cls} data-hg-booking="unavailable">{fallback}</div>;
  if (!cfg) return <div className={cls} data-hg-booking="loading" aria-busy="true" />;

  const times = slots?.days.find((d) => d.date === day)?.slots ?? [];
  return (
    <form className={cls} data-hg-booking="open" data-hgl-ignore="" onSubmit={onSubmit}>
      {cfg.types.length > 1 ? (
        <div className="hg-field hg-booking-step">
          <label className="hg-label" htmlFor={`${uid}-type`}>Service</label>
          <select id={`${uid}-type`} className="hg-input" value={typeId} onChange={(e) => { setTypeId(e.target.value); setPersonId('any'); }} required>
            <option value="">Choose a service…</option>
            {cfg.types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.durationMin} min)</option>)}
          </select>
        </div>
      ) : null}
      {type && type.people.length > 1 ? (
        <div className="hg-field hg-booking-step">
          <label className="hg-label" htmlFor={`${uid}-person`}>With</label>
          <select id={`${uid}-person`} className="hg-input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="any">Anyone</option>
            {type.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      ) : null}
      {type && slots ? (
        <div className="hg-booking-step">
          <div className="hg-days" role="group" aria-label="Day">
            {slots.days.filter((d) => d.slots.length).map((d) => (
              <button type="button" key={d.date} className="hg-day" aria-pressed={d.date === day} onClick={() => { setDay(d.date); setStart(''); }}>{dayLabel(d.date)}</button>
            ))}
          </div>
          {slots.days.every((d) => !d.slots.length) ? <p className="hg-help">No free times this week.</p> : null}
          <div className="hg-times" role="group" aria-label="Time">
            {times.map((s) => <button type="button" key={s} className="hg-time" aria-pressed={s === start} onClick={() => setStart(s)}>{timeOf(s)}</button>)}
          </div>
        </div>
      ) : null}
      {start && type ? (
        <div className="hg-booking-step">
          {(['name', 'email', 'phone'] as const).map((k) => (
            <div className="hg-field" key={k}>
              <label className="hg-label" htmlFor={`${uid}-${k}`}>{k === 'name' ? 'Name' : k === 'email' ? 'Email' : 'Phone (optional)'}</label>
              <input id={`${uid}-${k}`} className="hg-input" type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} autoComplete={k === 'phone' ? 'tel' : k} required={k !== 'phone'} value={details[k]} onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))} />
            </div>
          ))}
          {type.questions.map((q) => (
            <div className="hg-field" key={q.id}>
              <label className="hg-label" htmlFor={`${uid}-q-${q.id}`}>{q.label}{q.required ? <span aria-hidden="true"> *</span> : null}</label>
              <input id={`${uid}-q-${q.id}`} className="hg-input" required={q.required} value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            </div>
          ))}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label>Leave this empty<input ref={hp} type="text" name="hg_website" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <button type="submit" className="hg-submit" disabled={busy}>{busy ? 'Booking…' : 'Book'}</button>
        </div>
      ) : null}
      {error ? <p className="hg-error" role="alert">{error}</p> : null}
      {down ? fallback : null}
    </form>
  );
}
