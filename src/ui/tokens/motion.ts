/**
 * Motion tokens. Routine feedback 150–250 ms; the 800 ms source seal is a
 * later-gate pattern. With OS reduce-motion on, animations resolve to a
 * static end state (see useReducedMotion).
 */
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  seal: 800,
  skeletonPulse: 900,
} as const;

export const motionDuration = (ms: number, reduced: boolean): number => (reduced ? 0 : ms);
