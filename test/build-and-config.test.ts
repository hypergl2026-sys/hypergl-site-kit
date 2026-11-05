// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getPost, getPosts, getReviews } from '../src/build';
import { KIT_VERSION, cleanEndpoint, kitUrl, configure, DEFAULT_ENDPOINT } from '../src/config';

let dir = '';
beforeAll(async () => {
  dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'hg-kit-')), 'content', 'hypergl');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'posts.json'), JSON.stringify({ posts: [
    { slug: 'older', title: 'Older post', excerpt: 'a', html: '<p>a</p>', publishedAt: '2026-01-02T00:00:00Z' },
    { slug: 'newer', title: 'Newer post', excerpt: 'b', html: '<p>b</p>', publishedAt: '2026-03-02T00:00:00Z', tags: ['tips', 3] },
    { slug: 'Bad Slug', title: 'x', publishedAt: '2026-01-01' },
  ] }));
  await writeFile(path.join(dir, 'reviews.json'), JSON.stringify({ rating: 4.8, count: 112, url: 'https://g.page/r/x', items: [
    { author: 'Maria G.', rating: 5, text: 'Great trainers.', date: '2026-02-01' },
    { author: 'Tom B.', rating: 3, text: 'Busy at 6 pm.', date: '2026-02-03' },
  ] }));
});

describe('build-time helpers', () => {
  it('getPosts: newest first, bad rows skipped; getPost by slug', async () => {
    const posts = await getPosts({ dir });
    expect(posts.map((p) => p.slug)).toEqual(['newer', 'older']);
    expect(posts[0].tags).toEqual(['tips']);
    expect((await getPost('older', { dir }))?.title).toBe('Older post');
    expect(await getPost('missing', { dir })).toBeNull();
  });

  it('getReviews: rating, count, filters', async () => {
    const r = await getReviews({ dir, minRating: 4 });
    expect(r).toMatchObject({ rating: 4.8, count: 112, url: 'https://g.page/r/x' });
    expect(r.items.map((i) => i.author)).toEqual(['Maria G.']);
  });

  it('a new site without the files still builds', async () => {
    const empty = path.join(dir, 'nope');
    expect(await getPosts({ dir: empty })).toEqual([]);
    expect(await getReviews({ dir: empty })).toEqual({ rating: null, count: 0, url: null, items: [] });
  });
});

describe('config', () => {
  it('the kit version matches package.json', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(KIT_VERSION).toBe(pkg.version);
  });

  it('endpoint: any form of the base works; only /api/public/v1 paths are called', () => {
    expect(cleanEndpoint('https://in.agency.example/api/public/v1/')).toBe('https://in.agency.example');
    expect(cleanEndpoint('https://in.agency.example/api')).toBe('https://in.agency.example');
    expect(kitUrl('f/hf_x')).toBe(`${DEFAULT_ENDPOINT}/api/public/v1/f/hf_x?kv=${KIT_VERSION}`);
    configure({ endpoint: 'https://agency.example/' });
    expect(kitUrl('b/bk_x/slots', undefined, { type: 't' })).toBe(`https://agency.example/api/public/v1/b/bk_x/slots?kv=${KIT_VERSION}&type=t`);
    configure({ endpoint: DEFAULT_ENDPOINT });
  });
});
