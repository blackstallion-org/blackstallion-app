import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { AccessAdapter } from '@/core/auth/accessAdapter';
import { createMemoryStore } from '@/core/preferences/keyValueStore';

import { AccessProvider, useAccess } from '../AccessProvider';
import type { AccessSnapshot } from '../domain/access';

let api: ReturnType<typeof useAccess>;
function Probe() {
  api = useAccess();
  const s = api.state;
  return <Text testID="probe">{s.phase === 'authorized' ? `authorized:${s.session.displayName}` : s.phase}</Text>;
}

const controllable = () => {
  const pending: ((s: AccessSnapshot) => void)[] = [];
  const listeners = new Set<() => void>();
  const adapter: AccessAdapter = {
    name: 'test',
    load: () => new Promise((resolve) => pending.push(resolve)),
    signOut: async () => undefined,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { adapter, pending, fire: () => listeners.forEach((l) => l()) };
};

test('a load that resolves after sign-out cannot authorize the previous person', async () => {
  const c = controllable();
  await render(
    <AccessProvider adapter={c.adapter} store={createMemoryStore()}>
      <Probe />
    </AccessProvider>,
  );
  expect(screen.getByTestId('probe')).toHaveTextContent('loading');
  await act(async () => api.signOut());
  await act(async () =>
    c.pending[0]!({ kind: 'authorized', subjectId: 'a', displayName: 'Previous', allowedExperiences: ['family'], source: 'server' }),
  );
  expect(screen.getByTestId('probe')).toHaveTextContent('signedOut');
});

test('an adapter failure becomes the unavailable state, and reload retries', async () => {
  let fail = true;
  const adapter: AccessAdapter = {
    name: 'test',
    load: async () => {
      if (fail) throw new Error('network');
      return { kind: 'signedOut' };
    },
    signOut: async () => undefined,
    subscribe: () => () => undefined,
  };
  await render(
    <AccessProvider adapter={adapter} store={createMemoryStore()}>
      <Probe />
    </AccessProvider>,
  );
  await act(async () => undefined);
  expect(api.state).toEqual({ phase: 'unavailable', reason: 'bootError' });
  fail = false;
  await act(async () => api.reload());
  expect(screen.getByTestId('probe')).toHaveTextContent('signedOut');
});

test('adapter session-change notifications re-run the bootstrap through loading', async () => {
  const c = controllable();
  await render(
    <AccessProvider adapter={c.adapter} store={createMemoryStore()}>
      <Probe />
    </AccessProvider>,
  );
  await act(async () => c.pending[0]!({ kind: 'signedOut' }));
  expect(screen.getByTestId('probe')).toHaveTextContent('signedOut');
  await act(async () => c.fire());
  expect(screen.getByTestId('probe')).toHaveTextContent('loading');
  await act(async () =>
    c.pending[1]!({ kind: 'authorized', subjectId: 'b', displayName: 'Next', allowedExperiences: ['field'], source: 'server' }),
  );
  expect(screen.getByTestId('probe')).toHaveTextContent('authorized:Next');
});
