import { useCallback, useEffect, useEffectEvent, useState } from 'react';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; reference?: string }
  | { status: 'ready'; data: T };

export class ScopedLoadError extends Error {
  constructor(
    message: string,
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'ScopedLoadError';
  }
}

/**
 * Loads data for one scope (subject + experience [+ more]). Each result is
 * stored with the key that produced it and is returned only while that key
 * is current: when the key changes, the hook reports `loading` in the same
 * render, so another person's or experience's data can never flash. Late
 * responses for an older key are ignored.
 *
 * G3/G4 may replace this with TanStack Query (D04) using the same key rule.
 */
export function useScopedResource<T>(
  scopeKey: string,
  loader: () => Promise<T>,
): ResourceState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${scopeKey}#${attempt}`;
  const [entry, setEntry] = useState<{ key: string; state: ResourceState<T> } | null>(null);
  const load = useEffectEvent(() => loader());

  useEffect(() => {
    let current = true;
    load()
      .then((data) => {
        if (current) setEntry({ key: requestKey, state: { status: 'ready', data } });
      })
      .catch((err: unknown) => {
        if (!current) return;
        const reference = err instanceof ScopedLoadError ? err.reference : undefined;
        setEntry({
          key: requestKey,
          state: {
            status: 'error',
            message: 'This information could not be loaded. Check your connection and try again.',
            reference,
          },
        });
      });
    return () => {
      current = false;
    };
  }, [requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: ResourceState<T> = entry && entry.key === requestKey ? entry.state : { status: 'loading' };
  return { ...state, retry };
}
