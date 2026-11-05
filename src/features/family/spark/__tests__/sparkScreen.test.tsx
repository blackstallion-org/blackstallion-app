/**
 * FA-06 on the real route tree with the development adapter and fixtures at
 * zero latency (JS-level; no device audio). The fixture player is SIMULATED.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import path from 'path';
import { render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

import { SparkWaveform } from '../SparkWaveform';
import { SPARK_COPY } from '../strings';

jest.mock('@/dev/preview', () => {
  const actual = jest.requireActual('@/dev/preview');
  const { createDevAccessAdapter } = jest.requireActual('@/dev/devAccessAdapter');
  const { createFixtureRepositories } = jest.requireActual('@/dev/fixtures');
  return { ...actual, devAccessAdapter: createDevAccessAdapter({ latencyMs: 0 }), devRepositories: createFixtureRepositories({ latencyMs: 0 }) };
});
const dev = jest.requireMock('@/dev/preview') as typeof import('@/dev/preview');
const APP_DIR = path.resolve(__dirname, '../../../../app');

beforeEach(async () => {
  await dev.devAccessAdapter.signOut();
  await AsyncStorage.clear();
});

const openSpark = async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await act(async () => dev.devAccessAdapter.selectPersona('guardian'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await fireEvent.press(await screen.findByTestId('open-spark'));
  await waitFor(() => expect(r.getPathname()).toBe('/family/spark'));
  await screen.findByTestId('spark-transport');
  return r;
};

test('Home → Spark opens above the tabs (route reachable, tab bar not shown) and closes back to Home', async () => {
  const r = await openSpark();
  expect(screen.queryByTestId('tab-profile')).toBeNull();
  expect(screen.getByTestId('preview-banner')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('header-back'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
});

test('honest Spark: streaks off while D18 is PROPOSED, a simulated player is never recorded, no waveform without peaks', async () => {
  await openSpark();
  expect(screen.getByTestId('spark-acknowledgement')).toHaveTextContent(SPARK_COPY.streaksOff, { exact: false });
  expect(screen.getByTestId('spark-simulated')).toHaveTextContent(SPARK_COPY.simulatedNotRecorded);
  expect(screen.queryByTestId('spark-waveform')).toBeNull();
  expect(screen.queryByTestId('spark-streak')).toBeNull();
  expect(screen.queryByText(/Streak:/)).toBeNull();
  // Per child: the selected child is named; nothing is "recorded" for a child the server has no acknowledgement for.
  expect(screen.getAllByText(/Aarav \(sample\)/).length).toBeGreaterThan(0);
  expect(screen.queryByTestId('spark-recorded')).toBeNull();
});

test('the server’s acknowledgement for another child is shown for that child only', async () => {
  await openSpark();
  expect(screen.queryByTestId('spark-recorded')).toBeNull();
  await fireEvent.press(screen.getByTestId('child-switcher-syn-cadet-a2'));
  expect(await screen.findByTestId('spark-recorded')).toHaveTextContent(/Recorded for Meera \(sample\) today at \d\d:\d\d/);
  await fireEvent.press(screen.getByTestId('child-switcher-syn-cadet-a1'));
  await screen.findByTestId('spark-transport');
  expect(screen.queryByTestId('spark-recorded')).toBeNull();
});

test('transport: play advances the timer from player progress; pause stops it; controls are labelled', async () => {
  await openSpark();
  const primary = () => screen.getByTestId('spark-primary');
  await waitFor(() => expect(primary().props.accessibilityLabel).toBe('Play'));
  expect(screen.getByRole('button', { name: SPARK_COPY.back10 })).toBeTruthy();
  expect(screen.getByRole('button', { name: SPARK_COPY.forward10 })).toBeTruthy();
  await fireEvent.press(primary());
  await waitFor(() => expect(primary().props.accessibilityLabel).toBe('Pause'));
  await waitFor(() => expect(screen.getByTestId('spark-elapsed')).toHaveTextContent('0:01'), { timeout: 3000 });
  await fireEvent.press(primary());
  await waitFor(() => expect(primary().props.accessibilityLabel).toBe('Resume'));
});

test('a guardian with no Spark today sees the empty state', async () => {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await act(async () => dev.devAccessAdapter.selectPersona('dualRole'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await act(async () => router.push('/family/spark'));
  await waitFor(() => expect(r.getPathname()).toBe('/family/spark'));
  expect(await screen.findByTestId('spark-empty')).toBeTruthy();
});

test('waveform renders only measured peaks and nothing for missing or silent data', async () => {
  const wrap = (peaks: readonly number[] | null) =>
    render(
      <ThemeProvider store={createMemoryStore()}>
        <SparkWaveform peaks={peaks} progress={0.5} testID="wave" />
      </ThemeProvider>,
    );
  await wrap(null);
  expect(screen.queryByTestId('wave')).toBeNull();
  await wrap(new Array(64).fill(0));
  expect(screen.queryByTestId('wave')).toBeNull();
  await wrap(Array.from({ length: 640 }, (_, i) => Math.sin(i / 7)));
  expect(screen.getByLabelText(SPARK_COPY.waveformLabel)).toBeTruthy();
});
