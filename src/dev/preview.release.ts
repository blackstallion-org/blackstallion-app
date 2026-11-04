/**
 * Release-bundle replacement for ./preview.ts (wired in metro.config.js).
 * Every import site is behind `__DEV__`, so these are never called; they
 * exist only so the module graph resolves without shipping fixtures.
 */
const unavailable = (): never => {
  throw new Error('Development preview is not part of release builds');
};

export const devAccessAdapter = new Proxy({}, { get: unavailable });
export const devRepositories = new Proxy({}, { get: unavailable });
export const DevPreviewPanel = unavailable;
export const ComponentGallery = unavailable;
