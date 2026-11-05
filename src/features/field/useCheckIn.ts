import { useCallback, useRef, useState } from 'react';

import { FieldCommandError, toCommandError } from './domain/commandErrors';
import { newOperationId } from './domain/operation';
import { parsePassportInput } from './domain/passportCode';
import type { CheckInResult, FieldWorkflowRepository } from './domain/workflow';
import type { FieldTranslator } from './i18n';

/** A retry reuses the same request only briefly; after that it is a new check-in (the server de-duplicates the day). */
export const ATTEMPT_TTL_MS = 2 * 60_000;

export type CheckInStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; code: string }
  | { kind: 'done'; result: CheckInResult }
  | { kind: 'error'; code: string; error: FieldCommandError };

export type CheckInSubmit = { ok: true } | { ok: false; reason: 'empty' | 'format' | 'busy' | 'unconnected' };

/** The person's language when the catalogue has the text; otherwise the English the error carries. */
export const commandMessage = (e: FieldCommandError, s: FieldTranslator): string => (e.messageKey && s.has(e.messageKey) ? s.t(e.messageKey) : e.message);

/**
 * Passport → check-in, replay-safe. Retrying the same code soon after a lost reply resends the SAME operation id and
 * observed time, so the server returns the first result instead of recording twice; a definite answer (success or
 * refusal) ends the attempt, so the next scan is a new request.
 */
export function useCheckIn(repo: FieldWorkflowRepository | undefined, { now = () => new Date(), makeId = newOperationId }: { now?: () => Date; makeId?: () => string } = {}) {
  const [status, setStatus] = useState<CheckInStatus>({ kind: 'idle' });
  const attempt = useRef<{ code: string; operationId: string; observedAt: Date } | null>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (raw: string): Promise<CheckInSubmit> => {
      if (busy.current) return { ok: false, reason: 'busy' };
      const parsed = parsePassportInput(raw);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      if (!repo) return { ok: false, reason: 'unconnected' };
      const at = now();
      const a0 = attempt.current;
      const a = !a0 || a0.code !== parsed.code || at.getTime() - a0.observedAt.getTime() > ATTEMPT_TTL_MS ? { code: parsed.code, operationId: makeId(), observedAt: at } : a0;
      attempt.current = a;
      busy.current = true;
      setStatus({ kind: 'busy', code: a.code });
      try {
        const result = await repo.checkIn({ passportCode: a.code, observedAt: a.observedAt, operationId: a.operationId });
        attempt.current = null;
        setStatus({ kind: 'done', result });
      } catch (e) {
        const error = toCommandError(e, 'checkIn');
        if (!error.retryable) attempt.current = null;
        setStatus({ kind: 'error', code: a.code, error });
      } finally {
        busy.current = false;
      }
      return { ok: true };
    },
    [repo, now, makeId],
  );

  const reset = useCallback(() => {
    attempt.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  return { status, submit, reset };
}
