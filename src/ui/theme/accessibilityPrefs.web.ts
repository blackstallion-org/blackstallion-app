/** Web preview: the CSS media query mirrors the OS Reduce Transparency setting where the browser supports it. */
const query = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-transparency: reduce)')
    : null;

export function readReduceTransparency(): Promise<boolean> {
  return Promise.resolve(query()?.matches ?? false);
}

export function subscribeReduceTransparency(listener: (enabled: boolean) => void): () => void {
  const mq = query();
  if (!mq) return () => undefined;
  const onChange = (e: MediaQueryListEvent) => listener(e.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
