import Constants from 'expo-constants';
import { useEffect, useState } from 'react';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { evaluateUpdate, type UpdateDecision } from '@/features/account/domain/version';

const NO_POLICY: UpdateDecision = { kind: 'unknown', reason: 'noPolicy' };

/** The version this build reports (app.json `expo.version`). */
export const installedVersion = (): string | null => Constants.expoConfig?.version ?? null;

/**
 * SH-12 gate decision for the boot sequence. `checking` until the policy answers; then `required` blocks, and
 * everything else (`supported`, `unknown` — no policy published, unreadable, timed out) lets the person in.
 *
 * Wiring (boot gate, outside this workstream): in `src/app/index.tsx`, while authorized,
 * `if (gate.decision?.kind === 'required') return <Redirect href="/update-required" />`.
 */
export function useUpdateGate({ timeoutMs = 4000 }: { timeoutMs?: number } = {}): { checking: boolean; decision: UpdateDecision | null } {
  const policy = useRepositories().account?.versionPolicy;
  const [decision, setDecision] = useState<UpdateDecision | null>(null);
  useEffect(() => {
    if (!policy) return;
    let live = true;
    const timer = setTimeout(() => live && setDecision((d) => d ?? { kind: 'unknown', reason: 'unreadable' }), timeoutMs);
    policy
      .get()
      .then((p) => live && setDecision(evaluateUpdate(installedVersion(), p)))
      .catch(() => live && setDecision({ kind: 'unknown', reason: 'unreadable' }));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [policy, timeoutMs]);
  const effective: UpdateDecision | null = policy ? decision : NO_POLICY;
  return { checking: effective === null, decision: effective };
}
