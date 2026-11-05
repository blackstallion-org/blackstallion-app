/** Native entry: the flat editorial surface (the blur/Liquid Glass renderers were retired on 6 Nov 2026). */
export { GlassSurface } from './FlatSurface';

/** Kept for callers and tests that still ask; the flat redesign never uses Liquid Glass. */
export const liquidGlassAvailable = (): boolean => false;
