import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider, ThemeScope } from '@/ui/theme/ThemeProvider';
import { darkGlass, size } from '@/ui/tokens';

import {
  Chip,
  ConfirmDialog,
  FloatingTabBarScope,
  GlassBottomSheet,
  GlassButton,
  GlassIconButton,
  GlassInput,
  GlassScreen,
  GlassSurface,
  GlassTabBar,
  LiquidDisplayText,
  ScoreTile,
  SegmentedControl,
  selectGlassRenderer,
  StatusBadge,
  useFloatingTabInset,
} from '..';

// Deterministic renderer: this suite exercises the pre-iOS-26 blur path (glassLiquid.test.tsx covers GlassView).
// jest.mock is hoisted above the imports by babel-jest.
jest.mock('expo-glass-effect', () => ({ ...jest.requireActual('expo-glass-effect'), isLiquidGlassAvailable: () => false }));

const wrap = (ui: ReactNode) => render(<ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>);
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('GlassButton', () => {
  test('role, label, ≥48 targets: primary 56, secondary/ghost/destructive 48', async () => {
    await wrap(
      <>
        <GlassButton label="Send code" onPress={() => undefined} />
        <GlassButton label="Later" variant="secondary" onPress={() => undefined} />
        <GlassButton label="Skip" variant="ghost" onPress={() => undefined} />
        <GlassButton label="Discard" variant="destructive" icon="trash-outline" onPress={() => undefined} />
      </>,
    );
    expect(flat(screen.getByRole('button', { name: 'Send code' })).minHeight).toBe(size.primaryAction);
    for (const name of ['Later', 'Skip', 'Discard']) {
      expect(flat(screen.getByRole('button', { name })).minHeight).toBeGreaterThanOrEqual(size.minTouch);
      expect(flat(screen.getByRole('button', { name })).minWidth).toBeGreaterThanOrEqual(size.minTouch);
    }
  });

  test('disabled and loading states are exposed and block presses', async () => {
    const onPress = jest.fn();
    await wrap(
      <>
        <GlassButton label="Off" disabled onPress={onPress} />
        <GlassButton label="Busy" loading onPress={onPress} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Busy' })).toBeBusy();
    await fireEvent.press(screen.getByRole('button', { name: 'Off' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Busy' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('duplicate-submission guard: an async onPress runs once until it settles, then again', async () => {
    const d = deferred();
    const onPress = jest.fn(() => d.promise);
    await wrap(<GlassButton label="Publish" onPress={onPress} />);
    const btn = () => screen.getByRole('button', { name: 'Publish' });
    await fireEvent.press(btn());
    await fireEvent.press(btn());
    await fireEvent.press(btn());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(btn()).toBeBusy();
    await act(async () => d.resolve());
    expect(btn()).not.toBeBusy();
    await fireEvent.press(btn());
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test('a rejected async press releases the guard (no unhandled rejection)', async () => {
    const onPress = jest.fn(() => Promise.reject(new Error('network')));
    await wrap(<GlassButton label="Retry" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => undefined);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test('synchronous presses are never throttled (steppers, toggles)', async () => {
    const onPress = jest.fn();
    await wrap(<GlassButton label="+" variant="secondary" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: '+' }));
    await fireEvent.press(screen.getByRole('button', { name: '+' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test('destructive requires an icon at the type level and always renders one', async () => {
    // @ts-expect-error destructive actions need icon + explicit text
    const bad = <GlassButton variant="destructive" label="Delete" onPress={() => undefined} />;
    expect(bad).toBeTruthy();
    await wrap(<GlassButton variant="destructive" icon="trash-outline" label="Delete account" onPress={() => undefined} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('Delete account');
    expect(json).toContain('"fontFamily":"ionicons"'); // the icon glyph is rendered next to the words
  });
});

describe('GlassIconButton', () => {
  test('needs an accessibility label and never shrinks below 48', async () => {
    // @ts-expect-error icon-only controls must be named
    const unnamed = <GlassIconButton icon="close" onPress={() => undefined} />;
    expect(unnamed).toBeTruthy();
    await wrap(<GlassIconButton icon="close" accessibilityLabel="Close" size={32} onPress={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(flat(btn).width).toBeGreaterThanOrEqual(size.minTouch);
    expect(flat(btn).height).toBeGreaterThanOrEqual(size.minTouch);
  });
});

describe('GlassSurface', () => {
  test('decorative layers are untouchable and hidden; content stays interactive', async () => {
    const onPress = jest.fn();
    await wrap(
      <GlassSurface testID="surface">
        <Text onPress={onPress}>Tap me</Text>
      </GlassSurface>,
    );
    const root = screen.getByTestId('surface');
    const kids = root.children.filter((c): c is typeof root => typeof c !== 'string');
    const content = kids[kids.length - 1]!;
    const decor = kids.slice(0, -1);
    expect(decor.length).toBeGreaterThan(0);
    for (const layer of decor) {
      expect(layer.props.pointerEvents).toBe('none');
      expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
    }
    expect(content.props.pointerEvents).toBe('box-none');
    await fireEvent.press(screen.getByText('Tap me'));
    expect(onPress).toHaveBeenCalled();
  });

  test('Reduce Transparency renders an opaque warm backing and no blur', async () => {
    await wrap(
      <ThemeScope scheme="dark" reduceTransparency>
        <GlassSurface testID="surface">
          <Text>Readable</Text>
        </GlassSurface>
      </ThemeScope>,
    );
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain(darkGlass.opaque);
    expect(json).not.toContain('"intensity"');
  });

  test('without Reduce Transparency on iOS < 26 it blurs (BlurView with the material intensity)', async () => {
    await wrap(
      <ThemeScope scheme="dark">
        <GlassSurface material="thick" testID="surface" />
      </ThemeScope>,
    );
    expect(JSON.stringify(screen.toJSON())).toContain(`"intensity":${darkGlass.blurIntensity.thick}`);
  });
});

describe('renderer selection per platform', () => {
  const base = { liquidGlassAvailable: false, reduceTransparency: false, hasBlurTarget: false, fill: 'glass' as const };
  test.each([
    [{ ...base, os: 'ios', liquidGlassAvailable: true }, 'liquid-glass'],
    [{ ...base, os: 'ios' }, 'blur'],
    [{ ...base, os: 'android', hasBlurTarget: true }, 'blur'],
    [{ ...base, os: 'android' }, 'tint'],
    [{ ...base, os: 'web' }, 'css'],
    [{ ...base, os: 'ios', liquidGlassAvailable: true, reduceTransparency: true }, 'opaque'],
    [{ ...base, os: 'web', reduceTransparency: true }, 'opaque'],
    [{ ...base, os: 'ios', liquidGlassAvailable: true, fill: 'action' as const }, 'tint'],
  ])('%o → %s', (input, expected) => {
    expect(selectGlassRenderer(input)).toBe(expected);
  });
});

describe('GlassInput', () => {
  test('label is outside the glass, hint and error are announced; ≥48 high', async () => {
    await wrap(<GlassInput label="Mobile number" hint="10 digits" error="Too short" value="1" onChangeText={() => undefined} />);
    const input = screen.getByLabelText('Mobile number');
    expect(input.props.accessibilityHint).toBe('10 digits');
    expect(flat(input).minHeight).toBeGreaterThanOrEqual(size.minTouch);
    expect(screen.getByText('Mobile number')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
  });

  test('OTP variant: one-time-code autofill, numeric keypad, 6 digits', async () => {
    await wrap(<GlassInput label="Code" variant="otp" value="" onChangeText={() => undefined} />);
    const input = screen.getByLabelText('Code');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.autoComplete).toBe('one-time-code'); // iOS in this test environment; Android gets sms-otp
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.maxLength).toBe(6);
  });
});

describe('GlassTabBar (custom expo-router tab bar)', () => {
  const routes = [
    { key: 'k-home', name: 'index' },
    { key: 'k-progress', name: 'progress' },
    { key: 'k-profile', name: 'profile' },
  ];
  const descriptors = (extra: Record<string, object> = {}) =>
    Object.fromEntries(routes.map((r) => [r.key, { options: { title: r.name, tabBarButtonTestID: `tab-${r.name}`, ...(extra[r.key] ?? {}) } }]));
  const mount = (index: number, opts: { prevent?: boolean; extra?: Record<string, object> } = {}) => {
    const emit = jest.fn(() => ({ defaultPrevented: Boolean(opts.prevent) }));
    const navigateToTab = jest.fn();
    const props = { state: { index, routes }, descriptors: descriptors(opts.extra), emitter: { emit }, navigateToTab, insets: { top: 0, right: 0, bottom: 34, left: 0 } } as unknown as Parameters<typeof GlassTabBar>[0];
    return { emit, navigateToTab, ui: <GlassTabBar {...props} /> };
  };

  test('reflects router state: one selected tab, tablist role, testIDs kept', async () => {
    const { ui } = mount(1);
    await wrap(ui);
    expect(screen.getByTestId('glass-tab-bar').props.accessibilityRole).toBe('tablist');
    expect(screen.getByTestId('tab-progress')).toBeSelected();
    expect(screen.getByTestId('tab-index')).not.toBeSelected();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    for (const t of screen.getAllByRole('tab')) expect(flat(t).minHeight).toBeGreaterThanOrEqual(size.minTouch);
  });

  test('pressing another tab emits tabPress then navigates by route key; the focused tab does not navigate', async () => {
    const { ui, emit, navigateToTab } = mount(1);
    await wrap(ui);
    await fireEvent.press(screen.getByTestId('tab-profile'));
    expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'k-profile', canPreventDefault: true });
    expect(navigateToTab).toHaveBeenCalledWith('k-profile');
    await fireEvent.press(screen.getByTestId('tab-progress'));
    expect(navigateToTab).toHaveBeenCalledTimes(1);
  });

  test('a prevented tabPress does not navigate', async () => {
    const { ui, navigateToTab } = mount(0, { prevent: true });
    await wrap(ui);
    await fireEvent.press(screen.getByTestId('tab-profile'));
    expect(navigateToTab).not.toHaveBeenCalled();
  });

  test('hidden when the focused screen asks for it (tabBarStyle display none)', async () => {
    const { ui } = mount(0, { extra: { 'k-home': { tabBarStyle: { display: 'none' } } } });
    await wrap(ui);
    expect(screen.queryByTestId('glass-tab-bar')).toBeNull();
  });
});

describe('floating tab inset', () => {
  let inset = -1;
  function Probe() {
    inset = useFloatingTabInset();
    return null;
  }
  test('reserves the full bar height plus offset under the tab bar, nothing elsewhere', async () => {
    await wrap(<Probe />);
    expect(inset).toBe(0);
    await wrap(
      <FloatingTabBarScope>
        <Probe />
      </FloatingTabBarScope>,
    );
    expect(inset).toBeGreaterThanOrEqual(size.tabBar + size.tabBarGap);
  });

  test('GlassScreen pads its scroll content by that inset', async () => {
    await wrap(
      <FloatingTabBarScope>
        <GlassScreen testID="page">
          <View />
        </GlassScreen>
      </FloatingTabBarScope>,
    );
    const json = screen.toJSON() as unknown as { props: Record<string, unknown> };
    const text = JSON.stringify(json);
    const m = /"paddingBottom":(\d+)/.exec(text);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(size.tabBar + size.tabBarGap);
  });
});

describe('small primitives', () => {
  test('LiquidDisplayText exposes one header with the plain text; layered copies are hidden', async () => {
    await wrap(<LiquidDisplayText text={'Black\nStallion'} accessibilityLabel="Black Stallion Academy" role="display" />);
    const header = screen.getByRole('header', { name: 'Black Stallion Academy' });
    expect(header).toBeTruthy();
    expect(screen.getAllByRole('header')).toHaveLength(1);
  });

  test('StatusBadge is icon + word, never colour alone', async () => {
    await wrap(<StatusBadge label="Overdue" tone="danger" />);
    expect(screen.getByLabelText('Overdue')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('"fontFamily":"ionicons"');
  });

  test('ScoreTile reads as a sentence and uses tabular numerals', async () => {
    await wrap(<ScoreTile label="Riding" value={8} />);
    expect(screen.getByLabelText('Riding 8 out of 10')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('tabular-nums');
  });

  test('Chip as radio and SegmentedControl expose checked state', async () => {
    const onChange = jest.fn();
    await wrap(
      <>
        <Chip role="radio" label="Aarav" selected onPress={() => undefined} />
        <SegmentedControl label="Score" value="a" onChange={onChange} segments={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
      </>,
    );
    expect(screen.getByRole('radio', { name: 'Aarav' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(flat(screen.getByRole('radio', { name: 'B' })).minHeight).toBeGreaterThanOrEqual(size.minTouch);
  });
});

describe('sheets and dialogs', () => {
  test('bottom sheet closes from the scrim, but not while not dismissible', async () => {
    const onClose = jest.fn();
    const view = await wrap(<GlassBottomSheet visible title="Sync item" onClose={onClose} />);
    expect(screen.getByRole('header', { name: 'Sync item' })).toBeTruthy();
    // The scrim is outside the VoiceOver modal (hidden from AT by design); touch still closes the sheet.
    await fireEvent.press(screen.getByTestId('modal-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.rerender(
      <ThemeProvider store={createMemoryStore()}>
        <GlassBottomSheet visible title="Sync item" onClose={onClose} dismissible={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('modal-scrim', { includeHiddenElements: true })).toBeNull();
  });

  test('destructive confirm shows icon + explicit text and confirms once while busy', async () => {
    const d = deferred();
    const onConfirm = jest.fn(() => d.promise);
    await wrap(<ConfirmDialog visible title="Discard?" message="This cannot be undone." confirmLabel="Discard item" destructiveIcon="trash-outline" onConfirm={onConfirm} onCancel={() => undefined} testID="confirm" />);
    await fireEvent.press(screen.getByTestId('confirm-confirm'));
    await fireEvent.press(screen.getByTestId('confirm-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Discard item' })).toBeBusy();
    await act(async () => d.resolve());
  });
});
