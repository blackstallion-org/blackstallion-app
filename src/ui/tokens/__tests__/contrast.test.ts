import { contrastRatio, darkColors, lightColors, type ColorTokens } from '..';

type Pair = [fg: keyof ColorTokens, bg: keyof ColorTokens];

// Text pairs: WCAG AA 4.5:1 for normal-size text.
const TEXT: Pair[] = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink', 'surfaceMuted'],
  ['inkMuted', 'canvas'],
  ['inkMuted', 'surface'],
  ['inkMuted', 'surfaceMuted'],
  ['accentText', 'canvas'],
  ['accentText', 'surface'],
  ['onPrimary', 'primaryFill'],
  ['onSecondary', 'secondaryFill'],
  ['infoText', 'infoBg'],
  ['successText', 'successBg'],
  ['warningText', 'warningBg'],
  ['dangerText', 'dangerBg'],
  ['dangerText', 'surface'],
  ['devBannerText', 'devBannerBg'],
];

// Non-text UI boundaries (input borders, focus ring): WCAG 1.4.11 3:1.
const UI: Pair[] = [
  ['borderStrong', 'canvas'],
  ['borderStrong', 'surface'],
  ['focus', 'surface'],
  ['primaryFill', 'canvas'],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s theme contrast', (_name, colors) => {
  test.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
  test.each(UI)('ui %s on %s ≥ 3:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });
});

test('first-launch light canvas is white (DESIGN_SYSTEM)', () => {
  expect(lightColors.canvas).toBe('#FFFFFF');
  expect(lightColors.primaryFill).toBe('#191917');
});

test('raw brass is decorative only: it fails body-text contrast on white', () => {
  // Documents why components use accentText (not accent) for text.
  expect(contrastRatio(lightColors.accent, lightColors.canvas)).toBeLessThan(4.5);
});
