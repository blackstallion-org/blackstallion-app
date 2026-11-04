/**
 * Development preview composition. Imported only behind `__DEV__` checks in
 * src/app so release bundles contain neither personas nor fixtures.
 */
import { createDevAccessAdapter } from './devAccessAdapter';
import { createFixtureRepositories } from './fixtures';

export const devAccessAdapter = createDevAccessAdapter();
export const devRepositories = createFixtureRepositories();
export { DevPreviewPanel } from './DevPreviewPanel';
export { ComponentGallery } from './ComponentGallery';
