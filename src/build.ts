/**
 * Build-time helpers: `import { getPosts, getReviews } from '@hyperglllc/site-kit/build'`.
 *
 * At every checkpoint HyperGL writes the site's blog posts and reviews into the
 * repo as JSON (`content/hypergl/posts.json`, `content/hypergl/reviews.json`).
 * These read them while the site builds, so the pages are plain static HTML:
 * no request to HyperGL when a visitor opens them. A missing file means "none
 * yet", so a new site still builds.
 *
 * Node only (it reads files): call it from a Server Component, `generateStaticParams`,
 * or a build script — never from a client component.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface Post {
  slug: string;
  title: string;
  /** Short summary for lists and the meta description. */
  excerpt: string;
  /** The post body as HTML, already cleaned by HyperGL. */
  html: string;
  publishedAt: string;
  updatedAt?: string | null;
  image?: { src: string; alt: string; width?: number; height?: number } | null;
  author?: { name: string } | null;
  tags?: string[];
  seo?: { title?: string; description?: string; canonical?: string | null } | null;
}

export interface Review {
  author: string;
  rating: number;
  text: string;
  date: string;
  /** Where the review came from, e.g. "google". */
  source?: string;
  url?: string | null;
}

export interface Reviews {
  /** Average rating, 1–5, or null with no reviews. */
  rating: number | null;
  count: number;
  /** Where people can read all reviews / leave one. */
  url?: string | null;
  items: Review[];
}

export interface ContentOptions {
  /** Folder with HyperGL's JSON files. Default: `<cwd>/content/hypergl`. */
  dir?: string;
}

const dirOf = (o?: ContentOptions) => o?.dir ?? path.join(process.cwd(), 'content', 'hypergl');

async function readJsonFile(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw new Error(`@hyperglllc/site-kit: ${file} is not valid JSON (${(err as Error).message})`);
  }
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function toPost(raw: unknown): Post | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const slug = str(p.slug);
  if (!/^[a-z0-9][a-z0-9-]{0,200}$/.test(slug) || !str(p.title) || !str(p.publishedAt)) return null;
  return {
    slug, title: str(p.title), excerpt: str(p.excerpt), html: str(p.html), publishedAt: str(p.publishedAt),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
    image: p.image && typeof p.image === 'object' ? (p.image as Post['image']) : null,
    author: p.author && typeof p.author === 'object' ? (p.author as Post['author']) : null,
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    seo: p.seo && typeof p.seo === 'object' ? (p.seo as Post['seo']) : null,
  };
}

/** Every published post, newest first. */
export async function getPosts(options?: ContentOptions): Promise<Post[]> {
  const raw = await readJsonFile(path.join(dirOf(options), 'posts.json'));
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { posts?: unknown }).posts) ? (raw as { posts: unknown[] }).posts : [];
  return list.map(toPost).filter((p): p is Post => !!p).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** One post by its slug, or null. */
export async function getPost(slug: string, options?: ContentOptions): Promise<Post | null> {
  return (await getPosts(options)).find((p) => p.slug === slug) ?? null;
}

/** The client's reviews (Google and others), as HyperGL last read them. */
export async function getReviews(options?: ContentOptions & { minRating?: number; limit?: number }): Promise<Reviews> {
  const raw = (await readJsonFile(path.join(dirOf(options), 'reviews.json'))) as Partial<Reviews> | null;
  const items = (Array.isArray(raw?.items) ? raw!.items : [])
    .filter((r): r is Review => !!r && typeof r.author === 'string' && typeof r.text === 'string' && typeof r.rating === 'number')
    .filter((r) => r.rating >= (options?.minRating ?? 0))
    .slice(0, options?.limit ?? 50);
  return {
    rating: typeof raw?.rating === 'number' ? raw.rating : null,
    count: typeof raw?.count === 'number' ? raw.count : items.length,
    url: typeof raw?.url === 'string' ? raw.url : null,
    items,
  };
}
