// Newer Node versions ship their own (file-backed, often unusable) `localStorage`
// global, which hides jsdom's. Tests get a plain in-memory Storage instead.
class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}
if (typeof window !== 'undefined') {
  const store = new MemoryStorage();
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
}
