import { act, renderHook } from '@testing-library/react-native';

import { useScopedResource } from '../data/useScopedResource';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

test('changing the scope key shows loading in the same render, never the previous data', async () => {
  const a = deferred<string>();
  const b = deferred<string>();
  const loaders: Record<string, Promise<string>> = { 'alice:family': a.promise, 'bob:family': b.promise };
  const { result, rerender } = await renderHook(({ k }: { k: string }) => useScopedResource(k, () => loaders[k]!), {
    initialProps: { k: 'alice:family' },
  });
  await act(async () => a.resolve('ALICE PRIVATE'));
  expect(result.current).toMatchObject({ status: 'ready', data: 'ALICE PRIVATE' });

  await rerender({ k: 'bob:family' });
  expect(result.current.status).toBe('loading');
  expect(JSON.stringify(result.current)).not.toContain('ALICE');

  await act(async () => b.resolve('BOB'));
  expect(result.current).toMatchObject({ status: 'ready', data: 'BOB' });
});

test('a late response for an old key is ignored', async () => {
  const slowA = deferred<string>();
  const fastB = deferred<string>();
  const loaders: Record<string, Promise<string>> = { a: slowA.promise, b: fastB.promise };
  const { result, rerender } = await renderHook(({ k }: { k: string }) => useScopedResource(k, () => loaders[k]!), {
    initialProps: { k: 'a' },
  });
  await rerender({ k: 'b' });
  await act(async () => fastB.resolve('B'));
  await act(async () => slowA.resolve('A-LATE'));
  expect(result.current).toMatchObject({ status: 'ready', data: 'B' });
});

test('errors expose a reference and retry reloads', async () => {
  let calls = 0;
  const { result } = await renderHook(() =>
    useScopedResource('k', async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return 'ok';
    }),
  );
  await act(async () => undefined);
  expect(result.current.status).toBe('error');
  await act(async () => result.current.retry());
  expect(result.current).toMatchObject({ status: 'ready', data: 'ok' });
  expect(calls).toBe(2);
});
