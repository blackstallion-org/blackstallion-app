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

test('first launch: espresso (dark) preference and canvas, even when the OS is light', async () => {
  systemScheme = 'light';
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const memory = createMemoryStore();
  const slow: KeyValueStore = { ...memory, get: async (k) => (await gate, memory.get(k)) };
  await mount(slow);
  // Nothing themed is decided before the stored preference is known.
  expect(screen.getByTestId('probe')).toHaveTextContent('not-ready');
  await act(async () => release());
  expect(screen.getByTestId('probe')).toHaveTextContent('dark|dark|#1A0D06');
});

test('choice persists across a restart (remount on the same store)', async () => {
  const store = createMemoryStore();
  const first = await mount(store);
  await act(async () => undefined);
  await act(async () => api.setPreference('light'));
  expect(await store.get(APPEARANCE_KEY)).toBe('light');
  await first.unmount();

  await mount(store);
  await act(async () => undefined);
  expect(screen.getByTestId('probe')).toHaveTextContent('light|light|#FBF1E4');
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
  expect(screen.getByTestId('probe')).toHaveTextContent('system|dark|#1A0D06');
});

test('unreadable storage falls back to the default (dark); a failed save is reported, not hidden', async () => {
  const broken: KeyValueStore = {
    get: () => Promise.reject(new Error('io')),
    set: () => Promise.reject(new Error('io')),
    remove: () => Promise.reject(new Error('io')),
  };
  await mount(broken);
  await act(async () => undefined);
  expect(screen.getByTestId('probe')).toHaveTextContent('dark|dark|#1A0D06');
  await act(async () => api.setPreference('light'));
  expect(api.scheme).toBe('light');
  expect(api.saveError).toMatch(/could not be saved/);
});

test('ThemeScope forces dark over photographs without changing the person’s choice', async () => {
  const { ThemeScope } = jest.requireActual('@/ui/theme/ThemeProvider') as typeof import('@/ui/theme/ThemeProvider');
  let inner!: ReturnType<typeof useTheme>;
  function Inner() {
    inner = useTheme();
    return null;
  }
  const store = createMemoryStore({ [APPEARANCE_KEY]: 'light' });
  await render(
    <ThemeProvider store={store}>
      <ThemeScope scheme="dark" reduceTransparency>
        <Inner />
      </ThemeScope>
    </ThemeProvider>,
  );
  await act(async () => undefined);
  expect(inner.preference).toBe('light');
  expect(inner.appScheme).toBe('light');
  expect(inner.scheme).toBe('dark');
  expect(inner.colors.canvas).toBe('#1A0D06');
  expect(inner.reduceTransparency).toBe(true);
});

test('Reduce Transparency is read from the OS once and followed', async () => {
  const spy = jest.spyOn(RN.AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
  await mount(createMemoryStore());
  await act(async () => undefined);
  expect(api.reduceTransparency).toBe(true);
  spy.mockRestore();
});
