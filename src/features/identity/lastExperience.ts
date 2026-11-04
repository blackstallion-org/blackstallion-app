import type { KeyValueStore } from '@/core/preferences/keyValueStore';

import type { Experience } from './domain/access';

const KEY = 'bsah.pref.lastExperience.v1';

/** Remembers the last chosen experience per subject (07: dual-role default). Not an authorization input. */
export const lastExperienceStore = (store: KeyValueStore) => ({
  read: async (): Promise<{ subjectId: string; experience: string } | null> => {
    try {
      const raw = await store.get(KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Record<string, unknown>).subjectId === 'string' &&
        typeof (parsed as Record<string, unknown>).experience === 'string'
      ) {
        return parsed as { subjectId: string; experience: string };
      }
      return null;
    } catch {
      return null;
    }
  },
  write: async (subjectId: string, experience: Experience) => {
    try {
      await store.set(KEY, JSON.stringify({ subjectId, experience }));
    } catch {
      // Non-critical convenience; ignore storage failures.
    }
  },
  clear: async () => {
    try {
      await store.remove(KEY);
    } catch {
      // ignore
    }
  },
});
