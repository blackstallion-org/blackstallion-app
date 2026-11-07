import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';
import { compositeOver, contrastRatio, TONE_COLORS, TONES } from '@/ui/tokens';

import { GlassButton, GlassCard, GlassIconButton } from '..';
import { TAB_DROP_TINT } from '../GlassTabBar';
import { GLOSS_ALPHA, SHEEN_TONES, GLOSS_HEIGHT, SHEEN_ALPHA, SHEEN_HEIGHT } from '../WaterGlass';

/**
 * Waterline glass (7 Nov 2026): decorative highlights and a press ripple on buttons, cards and the tab-bar drop.
 * They must never carry meaning, never reach assistive tech, and never lower text contrast below the flat pairings.
 */
const hidden = { includeHiddenElements: true } as const;
const wrap = (ui: ReactNode) => render(<ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>);

describe('Waterline glass', () => {
  test('a primary button has the lit rim and gloss, and stays one accessible button', async () => {
    await wrap(<GlassButton label="Send code" onPress={() => undefined} />);
    expect(screen.getAllByTestId('water-glass', hidden).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Send code' })).toHaveLength(1);
  });

  test('every glass layer is hidden from assistive technology and never takes touches', async () => {
    await wrap(<GlassIconButton icon="close" accessibilityLabel="Close" appearance="solid" />);
    for (const layer of screen.getAllByTestId('water-glass', hidden)) {
      expect(layer.props.pointerEvents).toBe('none');
      expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(layer.props.accessibilityElementsHidden).toBe(true);
    }
  });

  test('no shadow or blur is introduced', async () => {
    await wrap(
      <>
        <GlassButton label="Go" onPress={() => undefined} />
        <GlassIconButton icon="close" accessibilityLabel="Close" />
      </>,
    );
    const json = JSON.stringify(screen.toJSON());
    expect(json).not.toContain('shadow');
    expect(json).not.toContain('blur');
  });

  test('pressing a button spreads a ripple and still fires onPress once', async () => {
    const onPress = jest.fn();
    await wrap(<GlassButton label="Go" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Go' });
    await act(async () => {
      fireEvent(btn, 'pressIn', { nativeEvent: { locationX: 10, locationY: 12 } });
    });
    expect(screen.getByTestId('water-ripple', hidden)).toBeTruthy();
    await act(async () => {
      fireEvent.press(btn);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('an image card gets the pane gloss; its cut-out variant stays untouched', async () => {
    const src = { uri: 'x.png' };
    await wrap(
      <>
        <GlassCard variant="photo" image={src} testID="photo" />
        <GlassCard variant="photo" image={src} cutout testID="cutout" />
      </>,
    );
    expect(screen.getAllByTestId('water-glass', hidden)).toHaveLength(1);
  });
});

describe('Waterline contrast', () => {
  test('the gloss strip stays above the text zone of the shortest button (48 pt, ~20 pt line)', () => {
    const textTop = (48 - 20) / 2;
    expect(GLOSS_HEIGHT).toBeLessThan(textTop);
    expect(SHEEN_HEIGHT).toBeLessThan(16); // card padding
  });

  test.each(TONES.map((t) => [t, TONE_COLORS[t]] as const))('%s: active-tab label on the water drop ≥ 4.5:1', (_t, c) => {
    const drop = compositeOver(c.accent, TAB_DROP_TINT, c.canvas);
    expect(contrastRatio(c.accentText, drop)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(SHEEN_TONES.map((t) => [t, TONE_COLORS[t]] as const))('%s: body text still ≥ 4.5:1 under the faint sheen', (_t, c) => {
    const lit = compositeOver('#FFFFFF', SHEEN_ALPHA, c.canvas);
    expect(contrastRatio(c.ink, lit)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.inkMuted, lit)).toBeGreaterThanOrEqual(4.5);
  });

  test('worst case: white text on the gloss-lightened top of a copper button would fail, so the band is kept off the text', () => {
    const c = TONE_COLORS.white;
    const lightened = compositeOver('#FFFFFF', GLOSS_ALPHA, c.primaryFill);
    expect(contrastRatio(c.onPrimary, c.primaryFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onPrimary, lightened)).toBeLessThan(contrastRatio(c.onPrimary, c.primaryFill));
  });
});
