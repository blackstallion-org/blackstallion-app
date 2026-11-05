/**
 * Type entry point. Metro resolves GlassSurface.web.tsx on web and
 * GlassSurface.native.tsx on iOS/Android before this file; TypeScript (and any
 * other platform) uses this re-export. Both renderers share GlassSurfaceProps.
 */
export { GlassSurface } from './GlassSurface.native';
