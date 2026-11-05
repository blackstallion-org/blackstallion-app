import type { CaptureResult } from '@/features/capture/contract';

import type { AssessmentDraft } from './domain/assessment';

/**
 * Unsent assessment drafts, kept in memory only and keyed by `<subject:experience:hub>|<check-in operation id>`.
 * Navigating away and back keeps the scores; signing out, switching experience or closing the app clears them
 * (field layout unmount). Durable drafts need an encrypted local store (notes are about a child): not decided yet.
 */
export type StoredDraft = { draft: AssessmentDraft; clip: { clipId: string; capture: CaptureResult } | null };

const drafts = new Map<string, StoredDraft>();

export const readDraft = (key: string | undefined): StoredDraft | null => (key ? (drafts.get(key) ?? null) : null);
export function writeDraft(key: string | undefined, value: StoredDraft): void {
  if (key) drafts.set(key, value);
}
export function clearDraft(key: string | undefined): void {
  if (key) drafts.delete(key);
}
export function forgetDrafts(): void {
  drafts.clear();
}
