// Copied from foundations/client-auth/src (G3, 4 Nov 2026), import extensions removed; keep both in step.
// supabase-js `auth.storage` adapter that keeps the session ONLY in the platform keystore (expo-secure-store in the
// app), split into chunks so a large session JSON fits per-item size limits. Pure: the keystore is injected, so this
// is unit-tested in Node and used unchanged in the app with `import * as SecureStore from 'expo-secure-store'`.
// Rules: never fall back to plain AsyncStorage; a partial/corrupt read returns null (forces sign-in) instead of a
// half session; a keystore that THROWS (e.g. device locked) is reported as KeystoreUnavailableError, never as
// "no session", so the app retries instead of asking the person to sign in again; removeItem deletes every chunk.

export interface KeystoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class KeystoreUnavailableError extends Error {}

/** Per-item budget in UTF-8 BYTES; Expo documents values above 2048 bytes as unsupported. */
export const CHUNK_BYTES = 1800;
const MAX_CHUNKS = 32;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_'); // SecureStore keys: alphanumeric, ".", "-", "_"

const utf8Len = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Splits on code-point boundaries so no chunk exceeds `budget` UTF-8 bytes and no surrogate pair is cut. */
export function splitUtf8(value: string, budget = CHUNK_BYTES): string[] {
  const out: string[] = [];
  let cur = '', bytes = 0;
  for (const ch of value) {
    const n = utf8Len(ch.codePointAt(0)!);
    if (bytes + n > budget && cur) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out;
}

export function createChunkedSecureStorage(store: KeystoreLike) {
  const meta = (k: string) => `${safeKey(k)}.n`;
  const part = (k: string, i: number) => `${safeKey(k)}.${i}`;
  const read = async (k: string) => {
    try { return await store.getItemAsync(k); } catch (e) { throw new KeystoreUnavailableError(String(e)); }
  };
  async function removeItem(key: string): Promise<void> {
    const n = Number(await store.getItemAsync(meta(key)).catch(() => null)) || 0;
    // delete the count first, so an interrupted removal can never be read back as a valid session
    await store.deleteItemAsync(meta(key)).catch(() => undefined);
    for (let i = 0; i < Math.max(n, MAX_CHUNKS); i++) await store.deleteItemAsync(part(key, i)).catch(() => undefined);
  }
  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await read(meta(key));
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await read(part(key, i));
        if (p === null) return null;       // incomplete write: treat as signed out
        parts.push(p);
      }
      return parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      const chunks = splitUtf8(value);
      if (chunks.length > MAX_CHUNKS) throw new Error('session too large for secure storage');
      const old = Number(await store.getItemAsync(meta(key)).catch(() => null)) || 0;
      await store.deleteItemAsync(meta(key)).catch(() => undefined); // invalidate while rewriting
      for (let i = 0; i < chunks.length; i++) await store.setItemAsync(part(key, i), chunks[i]!);
      for (let i = chunks.length; i < Math.min(old, MAX_CHUNKS); i++) await store.deleteItemAsync(part(key, i)).catch(() => undefined);
      await store.setItemAsync(meta(key), String(chunks.length));     // commit point
    },
    removeItem,
  };
}
