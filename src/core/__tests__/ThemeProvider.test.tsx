import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as RN from 'react-native';

import { APPEARANCE_KEY } from '../preferences/appearance';
import { createMemoryStore, type KeyValueStore } from '../preferences/keyValueStore';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

let systemScheme: 'light' | 'dark' = 'light';
jest.spyOn(RN, 'useColorScheme').mockImplementation(() => systemScheme);

let api: ReturnType<typeof useTheme>;
function Probe() {
  api = useTheme();
  return <Text testID="probe">{api.ready ? `${api.preference}|${api.scheme}|${api.colors.canvas}` : 'not-ready'}</Text>;
}
const mount = (store: KeyValueStore) =>
  render(
    <ThemeProvider store={store}>
      <Probe />
    </ThemeProvider>,
  );

beforeEach(() => {
  systemScheme = 'light';
});

test('first launch: light preference, white canvas, even when the OS is dark', async () => {
  systemScheme = 'dark';
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const memory = createMemoryStore();
  const slow: KeyValueStore = { ...memory, get: async (k) => (await gate, memory.get(k)) };
  await mount(slow);
  // Nothing themed is decided before the stored preference is known.
  expect(screen.getByTestId('probe')).toHaveTextContent('not-ready');
  await act(async () => release());
  expect(screen.getByTestId('probe')).toHaveTextContent('light|light|#FFFFFF');
});

test('choice persists across a restart (remount on the same store)', async () => {
  const store = createMemoryStore();
  const first = await mount(store);
  await act(async () => undefined);
  await act(async () => api.setPreference('dark'));
  expect(await store.get(APPEARANCE_KEY)).toBe('dark');
  await first.unmount();

  await mount(store);
  await act(async () => undefined);
  expect(screen.getByTestId('probe')).toHaveTextContent('dark|dark|#0F0E0D');
});

test('System follows OS appearance changes', async () => {
  const store = createMemoryStore({ [APPEARANCE_KEY]: 'system' });
  const view = await mount(store);
  await act(async () => undefined);
  expect(screen.getByTestId('probe')).toHaveTextContent(/^system\|light\|/);
  systemScheme = 'dark';
  await view.rerender(
    <ThemeProvider store={store}>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('probe')).toHaveTextContent('system|dark|#0F0E0D');
});

test('unreadable storage falls back to light; a failed save is reported, not hidden', async () => {
  const broken: KeyValueStore = {
    get: () => Promise.reject(new Error('io')),
    set: () => Promise.reject(new Error('io')),
    remove: () => Promise.reject(new Error('io')),
  };
  await mount(broken);
  await act(async () => undefined);
  expect(screen.getByTestId('probe')).toHaveTextContent('light|light|#FFFFFF');
  await act(async () => api.setPreference('dark'));
  expect(api.scheme).toBe('dark');
  expect(api.saveError).toMatch(/could not be saved/);
});
