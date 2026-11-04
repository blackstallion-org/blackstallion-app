/**
 * Semantic colour tokens (DESIGN_SYSTEM.md). Screens use the semantic names
 * only; raw palette values never appear in components.
 * Contrast for every text pair is asserted in __tests__/contrast.test.ts.
 */
export const palette = {
  white: '#FFFFFF',
  paper: '#F5F4F1',
  ink: '#191917',
  inkMuted: '#62625E',
  stone: '#E5E2DC',
  stoneStrong: '#8C8880',
  night: '#0F0E0D',
  nightSurface: '#1A1A18',
  nightRaised: '#252421',
  nightBorder: '#3A3834',
  nightBorderStrong: '#77736B',
  bone: '#F7F4EE',
  boneMuted: '#B9B4AA',
  brass: '#C5A059',
  brassDeep: '#7A5C22',
  copper: '#B87333',
} as const;

export type ColorTokens = {
  canvas: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  inkMuted: string;
  border: string;
  borderStrong: string;
  accent: string; // decorative brass: rules, icons, never small body text
  accentText: string; // brass tone that meets 4.5:1 on canvas
  primaryFill: string;
  onPrimary: string;
  secondaryFill: string;
  onSecondary: string;
  focus: string;
  infoBg: string;
  infoText: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningText: string;
  dangerBg: string;
  dangerText: string;
  skeleton: string;
  devBannerBg: string;
  devBannerText: string;
};

export const lightColors: ColorTokens = {
  canvas: palette.white,
  surface: palette.white,
  surfaceMuted: palette.paper,
  ink: palette.ink,
  inkMuted: palette.inkMuted,
  border: palette.stone,
  borderStrong: palette.stoneStrong,
  accent: palette.brass,
  accentText: palette.brassDeep,
  primaryFill: palette.ink,
  onPrimary: palette.white,
  secondaryFill: palette.paper,
  onSecondary: palette.ink,
  focus: '#2F5FD0',
  infoBg: '#EEF2FA',
  infoText: '#23407F',
  successBg: '#EAF4EC',
  successText: '#1E5A2C',
  warningBg: '#FBF1E1',
  warningText: '#704A0C',
  dangerBg: '#FBECEA',
  dangerText: '#9A2A1E',
  skeleton: '#ECEAE5',
  devBannerBg: '#FFF4D6',
  devBannerText: '#5C4300',
};

export const darkColors: ColorTokens = {
  canvas: palette.night,
  surface: palette.nightSurface,
  surfaceMuted: palette.nightRaised,
  ink: palette.bone,
  inkMuted: palette.boneMuted,
  border: palette.nightBorder,
  borderStrong: palette.nightBorderStrong,
  accent: palette.brass,
  accentText: '#D9B878',
  primaryFill: palette.bone,
  onPrimary: palette.night,
  secondaryFill: palette.nightRaised,
  onSecondary: palette.bone,
  focus: '#8FB0FF',
  infoBg: '#18223A',
  infoText: '#B9CCF5',
  successBg: '#15291A',
  successText: '#A9DDB3',
  warningBg: '#2E2312',
  warningText: '#F0CE8E',
  dangerBg: '#341815',
  dangerText: '#F4B4AB',
  skeleton: '#2A2926',
  devBannerBg: '#3A2E0A',
  devBannerText: '#F6DE9A',
};

export type ColorSchemeName = 'light' | 'dark';

export const colorsFor = (scheme: ColorSchemeName): ColorTokens =>
  scheme === 'dark' ? darkColors : lightColors;
