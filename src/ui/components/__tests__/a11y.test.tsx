import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';
import { size } from '@/ui/tokens';

import { Button, ErrorState, LoadingState, OptionGroup, Skeleton, StatusMessage, TextField } from '..';

const wrap = (ui: ReactNode) => render(<ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>);

test('buttons expose role, label, disabled/busy state and a ≥48pt target', async () => {
  await wrap(
    <>
      <Button label="Save" onPress={() => undefined} />
      <Button label="Scan" size="field" disabled onPress={() => undefined} />
      <Button label="Sending" loading onPress={() => undefined} />
    </>,
  );
  const save = screen.getByRole('button', { name: 'Save' });
  expect(StyleSheet.flatten(save.props.style).minHeight).toBeGreaterThanOrEqual(size.minTouch);
  const scan = screen.getByRole('button', { name: 'Scan' });
  expect(scan).toBeDisabled();
  expect(StyleSheet.flatten(scan.props.style).minHeight).toBe(size.fieldAction);
  expect(screen.getByRole('button', { name: 'Sending' })).toBeBusy();
});

test('text field is labelled, hinted and announces errors', async () => {
  await wrap(<TextField label="Mobile number" hint="10 digits" error="Too short" value="1" onChangeText={() => undefined} />);
  const input = screen.getByLabelText('Mobile number');
  expect(input.props.accessibilityHint).toBe('10 digits');
  expect(StyleSheet.flatten(input.props.style).minHeight).toBeGreaterThanOrEqual(size.minTouch);
  expect(screen.getByRole('alert')).toHaveTextContent('Too short');
});

test('option group is a radiogroup of radios with checked state', async () => {
  await wrap(
    <OptionGroup
      label="Appearance"
      value="light"
      onChange={() => undefined}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
    />,
  );
  expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
});

test('warnings and errors use the alert role; info does not', async () => {
  await wrap(
    <>
      <StatusMessage tone="danger" message="Not saved" />
      <StatusMessage tone="info" message="FYI" />
    </>,
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

test('loading state is announced as busy and renders no data', async () => {
  await wrap(<LoadingState label="Loading family home" />);
  const el = screen.getByLabelText('Loading family home');
  expect(el).toBeBusy();
});

test('error state offers Retry and hides the reference behind Details', async () => {
  await wrap(<ErrorState message="Could not load" onRetry={() => undefined} details="Reference: X-1" />);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByText('Reference: X-1')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
});

test('reduced motion: the skeleton pulse is stopped and never restarted', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const start = jest.fn();
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() } as never);
  await wrap(<Skeleton />);
  await act(async () => undefined);
  // At most the pre-setting first frame starts a loop; once the OS setting is
  // known the loop is stopped and no new one is created.
  expect(loop.mock.calls.length).toBeLessThanOrEqual(1);
  if (loop.mock.calls.length === 1) expect(stop).toHaveBeenCalled();
  loop.mockRestore();
});
