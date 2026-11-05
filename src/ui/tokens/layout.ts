/** Spacing, radius, border and size tokens (4-point scale; brief §3 layout). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  screenInset: 20,
} as const;

export const radius = {
  sm: 8,
  control: 16,
  /** Regular panels 20–24. */
  card: 22,
  /** Hero / photo cards 28–36. */
  hero: 32,
  sheet: 32,
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
  /** Primary actions (and Field Ops actions): 56. */
  primaryAction: 56,
  /** Kept for existing call sites: Field Ops actions are primary-height. */
  fieldAction: 56,
  icon: 22,
  tabIcon: 24,
  /** Floating tab bar pill height (icons + labels). */
  tabBar: 64,
  /** Gap between the floating tab bar and the safe-area bottom. */
  tabBarGap: 8,
  contentMaxWidth: 560,
} as const;
