# @hyperglllc/site-kit

Connects a static Next.js website to HyperGL: page views, forms, booking,
consent, and blog posts and reviews baked in at build time.

- Works in a **static export** (`output: 'export'`). There's no server code: the
  browser pieces call HyperGL directly, and the build pieces read JSON files in
  the repo.
- Talks only to the **versioned** endpoints `/api/public/v1/...`. A version stays
  supported for at least 24 months after a newer one ships, and while any live
  site uses it.
- **Forms never lose an entry.** If sending fails, the entry is kept in the
  browser and retried. After a few seconds the form shows "Couldn't send. Email
  us at …" with the entry ready to send by email. Anything still unsent goes
  out the next time a page with the kit loads.
- MIT licensed. The site keeps working if it leaves HyperGL; forms then show the
  email fallback.

```bash
npm install @hyperglllc/site-kit
```

## In the browser

```tsx
// app/layout.tsx
import { HyperGLTracking, ConsentBanner, configure } from '@hyperglllc/site-kit';

configure({ endpoint: 'https://in.youragency.example' }); // optional; HyperGL sets this

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HyperGLTracking source="ls_…" />
        <ConsentBanner privacyHref="/privacy" />
      </body>
    </html>
  );
}
```

| Piece | What it does |
|:--|:--|
| `<HyperGLTracking source="ls_…" />` | Cookie-free page views and where visitors came from, including client-side navigation. Nothing is stored on the device without consent. |
| `<HyperGLForm token="hf_…" fallbackEmail="…" />` | Draws a HyperGL hosted form as plain HTML and sends it to Leads, with Cloudflare Turnstile when it's on. Retries, then the email fallback. |
| `<HyperGLBooking code="bk_…" />` | The client's booking page on the site: service, person, day, time, details. |
| `<ConsentBanner />`, `<ConsentGate>` | Asks EU/UK visitors (or everyone, with `show="always"`) before anything is stored. Third-party tags inside `<ConsentGate>` load only after consent. Updates Google Consent Mode. |
| `configure({ endpoint })` | The address HyperGL answers on: the agency's domain or the ingestion hostname. Each component also takes `endpoint`. |

Styling: every piece uses plain class names (`hg-form`, `hg-field`, `hg-label`,
`hg-input`, `hg-submit`, `hg-error`, `hg-fallback`, `hg-sent`, `hg-booking`,
`hg-day`, `hg-time`, `hg-consent-banner`, …). The site styles them.

## At build time

```tsx
// app/blog/[slug]/page.tsx: a Server Component, run at build time
import { getPost, getPosts } from '@hyperglllc/site-kit/build';

export async function generateStaticParams() {
  return (await getPosts()).map((p) => ({ slug: p.slug }));
}
```

`getPosts()`, `getPost(slug)` and `getReviews()` read the JSON files HyperGL
writes into the repo at every checkpoint (`content/hypergl/posts.json` and
`content/hypergl/reviews.json`; change the folder with `{ dir }`). If a file is
missing, you get an empty result, so a new site still builds. These are
Node-only: never import `@hyperglllc/site-kit/build` in a client component.

## Test mode

The site's smoke tests set `window.__HG_TEST_TOKEN__` (the checkpoint token
HyperGL gives them) before the page loads. Every form and booking then goes out
with `?test=1`. HyperGL checks it like a real one and answers 204, but never
creates a lead or a booking.

## The package name

The package name stays `@hyperglllc/site-kit` in `package.json` on white-labeled
sites as well. Visitors never see it: requests go to the endpoint you configure.

## License

MIT © HyperGL LLC
