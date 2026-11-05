import { Platform } from 'react-native';

import { FONT_STACK, type FontPlatform, type FontWeight } from '@/ui/tokens';

/** The one place that picks a platform font (tokens/typography.ts FONT_STACK holds the mapping). */
export const FONT_PLATFORM: FontPlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

export const fontFor = (weight: FontWeight): { fontFamily?: string; fontWeight: FontWeight } => FONT_STACK[FONT_PLATFORM](weight);
