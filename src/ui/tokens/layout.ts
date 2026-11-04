/** Spacing, radius, border and size tokens (DESIGN_SYSTEM.md). */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  screenInset: 20,
} as const;

export const radius = {
  sm: 8,
  control: 12,
  card: 20,
  pill: 999,
} as const;

export const border = {
  hairline: 1,
  strong: 2,
  focus: 3,
} as const;

export const size = {
  /** Minimum touch target on both platforms. */
  minTouch: 48,
  /** Field Ops primary actions: larger for gloves/sunlight/one hand. */
  fieldAction: 56,
  icon: 22,
  tabIcon: 24,
  contentMaxWidth: 560,
} as const;
