// Native (iOS/Android): evidence files live in the app's document directory so they survive a restart.
// The browser preview uses durableFileVault.web.ts (memory fallback, and says so).
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  EncodingType,
  getFreeDiskStorageAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';

import type { FileVault, StoredFile, UploadTarget } from '../domain/ports';
import { sha256BytesHex } from '../domain/sha256';

const EVIDENCE_DIR = `${documentDirectory}evidence/`;

function refPath(ref: string): string {
  return `${documentDirectory}${ref}`;
}

async function ensureDir(path: string): Promise<void> {
  const info = await getInfoAsync(path);
  if (!info.exists) await makeDirectoryAsync(path, { intermediates: true });
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readBytes(filePath: string): Promise<Uint8Array> {
  const b64 = await readAsStringAsync(filePath, { encoding: EncodingType.Base64 });
  return base64ToBytes(b64);
}

export function createDurableFileVault(io: {
  put(target: UploadTarget, bytes: Uint8Array): Promise<void>;
}): FileVault {
  return {
    durability: 'durable' as const,

    freeBytes: async () => {
      try {
        return await getFreeDiskStorageAsync();
      } catch {
        return Number.MAX_SAFE_INTEGER;
      }
    },

    async finalize(tempRef, finalRef) {
      const dest = refPath(finalRef);
      const dir = dest.substring(0, dest.lastIndexOf('/'));
      await ensureDir(dir);
      await copyAsync({ from: tempRef, to: dest });
      const bytes = await readBytes(dest);
      return { ref: finalRef, sizeBytes: bytes.length, sha256: sha256BytesHex(bytes) };
    },

    async exists(ref) {
      const info = await getInfoAsync(refPath(ref));
      return info.exists;
    },

    async stat(ref): Promise<StoredFile | null> {
      const path = refPath(ref);
      const info = await getInfoAsync(path);
      if (!info.exists) return null;
      try {
        const bytes = await readBytes(path);
        return { ref, sizeBytes: bytes.length, sha256: sha256BytesHex(bytes) };
      } catch {
        return null;
      }
    },

    async remove(ref) {
      await deleteAsync(refPath(ref), { idempotent: true });
    },

    async upload(ref, target) {
      const bytes = await readBytes(refPath(ref));
      await io.put(target, bytes);
    },

    async listFinalRefs() {
      try {
        const info = await getInfoAsync(EVIDENCE_DIR);
        if (!info.exists) return [];
        const actors = await readDirectoryAsync(EVIDENCE_DIR);
        const refs: string[] = [];
        for (const actor of actors) {
          const actorDir = `${EVIDENCE_DIR}${actor}/`;
          const files = await readDirectoryAsync(actorDir);
          for (const f of files) refs.push(`evidence/${actor}/${f}`);
        }
        return refs;
      } catch {
        return [];
      }
    },
  };
}
