// Browser preview only: expo-file-system's documentDirectory is null on web and the file APIs are no-ops.
// Falls back to the memory vault; screens already say unsent work would be lost.
import type { FileVault, UploadTarget } from '../domain/ports';
import { createUriFileVault } from '@/features/fieldOps/data/outbox';

export function createDurableFileVault(io: {
  put(target: UploadTarget, bytes: Uint8Array): Promise<void>;
  read?(uri: string): Promise<Uint8Array>;
}): FileVault {
  const read = io.read ?? (async (uri: string) => new Uint8Array(await (await fetch(uri)).arrayBuffer()));
  return createUriFileVault({ read, put: io.put });
}
