/** localStorage that never throws (private windows, blocked storage, server render). */
export function read(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; }
}

export function write(key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value);
  } catch { /* storage blocked: the kit still works, it just can't remember */ }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
