import { Easing } from 'react-native';

/**
 * Motion tokens. Control transitions are brief and purposeful (160–240 ms);
 * no endless bouncing and no sound. With the OS reduce-motion setting on,
 * animations resolve to a static end state (see useReducedMotion).
 */
export const motion = {
  fast: 160,
  base: 200,
  slow: 240,
  ripple: 520,
  seal: 800,
  skeletonPulse: 900,
  tabStretch: 110,
  spring: {
    tab: { damping: 16, stiffness: 190, mass: 0.8 },
    tabStretch: { damping: 9, stiffness: 160 },
  },
  easing: {
    decel: Easing.out(Easing.cubic),
  },
} as const;

export const motionDuration = (ms: number, reduced: boolean): number => (reduced ? 0 : ms);
