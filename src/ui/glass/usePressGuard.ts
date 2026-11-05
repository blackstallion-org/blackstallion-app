import { useCallback, useEffect, useRef, useState } from 'react';

export type PressHandler = () => void | Promise<unknown>;

const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/**
 * Duplicate-submission guard. When `onPress` returns a promise, further presses
 * are ignored until it settles, and `pending` is true meanwhile (shown as busy).
 * Synchronous handlers are passed through untouched, so steppers and toggles
 * still respond to every press.
 */
export function usePressGuard(onPress: PressHandler | undefined): { pending: boolean; press: () => void } {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const press = useCallback(() => {
    if (!onPress || inFlight.current) return;
    const result = onPress();
    if (!isPromise(result)) return;
    inFlight.current = true;
    setPending(true);
    const settle = () => {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    };
    result.then(settle, settle);
  }, [onPress]);
  return { pending, press };
}
