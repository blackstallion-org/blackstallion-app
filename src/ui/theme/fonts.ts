import { Platform } from 'react-native';

import { BRAND_FONTS, FONT_STACK, type FontFamilyRole, type FontPlatform, type FontWeight } from '@/ui/tokens';

/** The one place that picks a font (tokens/typography.ts holds the mapping). */
export const FONT_PLATFORM: FontPlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

let brandFontsReady = false;
/** Set by the app shell once the brand font files are loaded; until then (and in tests) platform fonts are used. */
export const setBrandFontsReady = (ready: boolean): void => {
  brandFontsReady = ready;
};
export const brandFontsLoaded = (): boolean => brandFontsReady;

/**
 * Font for a role. Brand files are one file per weight, so the weight is carried by the family name and fontWeight
 * stays 'normal' (otherwise Android/iOS may synthesise or fall back). Indic text always uses the platform font.
 */
export const fontFor = (weight: FontWeight, family: FontFamilyRole = 'sans', indic = false): { fontFamily?: string; fontWeight: FontWeight | 'normal' } => {
  if (!indic && brandFontsReady) {
    const name = BRAND_FONTS[family][weight];
    if (name) return { fontFamily: name, fontWeight: 'normal' };
  }
  return FONT_STACK[FONT_PLATFORM](weight);
};
