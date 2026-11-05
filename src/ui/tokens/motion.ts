/**
 * Motion tokens. Control transitions are brief and purposeful (160–240 ms);
 * no endless bouncing and no sound. With the OS reduce-motion setting on,
 * animations resolve to a static end state (see useReducedMotion).
 */
export const motion = {
  fast: 160,
  base: 200,
  slow: 240,
  seal: 800,
  skeletonPulse: 900,
} as const;

export const motionDuration = (ms: number, reduced: boolean): number => (reduced ? 0 : ms);
