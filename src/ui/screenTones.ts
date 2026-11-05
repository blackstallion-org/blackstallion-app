import type { Tone } from '@/ui/tokens';

/**
 * EXACT screen-to-colour assignments (6 Nov 2026 redesign). One dominant, flat background per screen, keyed by the
 * screen's root testID (GlassScreen / BillingPage / CameraStage). Anything not listed is White — most informational,
 * form, financial and settings screens stay white on purpose. Text and accent pairings per tone are defined and
 * contrast-tested in tokens/colors.ts (TONE_COLORS) and tokens/__tests__/contrast.test.ts.
 *
 * Rationale per colour:
 *  brown    — brand entry and camera work (sign-in, verify, account status, scan, capture, stall camera)
 *  burgundy — heritage and audio (Daily Spark)
 *  fir      — horses and their care at a glance (Family horse, Field Horses tab)
 *  olive    — the Field Ops day (Today)
 *  pearl    — documents and notices (Passport & ranks, Update required)
 *  copper   — reserved for editorial blocks inside white screens (Spark entry, primary actions), not whole screens
 *  white    — everything else
 */
export const SCREEN_TONES: Readonly<Record<string, Tone>> = {
  // Layer 1 — access
  'auth-frame': 'brown',
  'update-required': 'pearl',
  'update-checking': 'pearl',
  // Layer 3 — family
  'family-passport': 'pearl',
  'family-spark': 'burgundy',
  'family-horse': 'fir',
  'family-stall-cam': 'brown',
  // Layer 4 — field cadets/assessment
  'field-today': 'olive',
  'field-scan': 'brown',
  'field-capture': 'brown',
  // Layer 5 — field horses
  'fo08-horses': 'fir',
};

export const toneForScreen = (testID: string | undefined): Tone | undefined => (testID ? SCREEN_TONES[testID] : undefined);
