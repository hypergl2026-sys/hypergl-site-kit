# Changelog

This package follows [semver](https://semver.org). A version stays supported for
at least 24 months after a newer one ships, and while any live site uses it.

## 1.0.1 (2026-11-23)

- `<HyperGLForm>`: a robot-check refusal (Cloudflare Turnstile) no longer drops
  the entry. The email fallback shows at once and the entry stays queued for the
  next page load. A Turnstile widget that fails to load, errors or expires no
  longer blocks the send.
- `<HyperGLBooking>`: a robot-check refusal shows the email fallback instead of
  an error the person can't fix.
- HyperGL no longer asks for Turnstile on a Web Designer site's own forms and
  booking page (the widget can't run on a client's domain).

## 1.0.0 (2026-11-05)

- `<HyperGLTracking>`: cookie-free page views and sources (sendBeacon after the
  first view), including client-side navigation; consent-aware storage.
- `<HyperGLForm>`: HyperGL hosted forms as plain HTML, with Turnstile. The entry
  is queued in the browser, retried, and after a few seconds the form shows the
  email fallback; anything unsent goes out on the next page load.
- `<HyperGLBooking>`: the client's booking page on the site.
- `<ConsentBanner>`, `<ConsentGate>`, `useConsent()`: EU/UK consent, Google
  Consent Mode update.
- `@hyperglllc/site-kit/build`: `getPosts()`, `getPost()`, `getReviews()` read
  HyperGL's JSON in `content/hypergl/` at build time.
- `configure({ endpoint })`; every request reports the kit version (`?kv=`) and
  calls only `/api/public/v1/...`.
- Test mode: `window.__HG_TEST_TOKEN__` sends forms and bookings with `?test=1`
  (checked, never a lead).
