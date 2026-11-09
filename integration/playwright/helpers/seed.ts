/**
 * Caches the seeded world for the Playwright test run. Requires the local staging stack to be running.
 * Call getWorld() in test.beforeAll — it seeds once and returns the same world for all specs.
 */
import { seedScreens, type ScreensWorld } from '../../staging/seedScreens';
import { seedWorld } from '../../staging/stack';

let world: ScreensWorld | null = null;

export async function getWorld(): Promise<ScreensWorld> {
  if (!world) {
    world = await seedScreens(await seedWorld());
  }
  return world;
}
