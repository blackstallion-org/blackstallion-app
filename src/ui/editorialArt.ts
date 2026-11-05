// Compatibility aliases: the 6 Nov 2026 redesign replaced the earlier editorial set with ui/imageLibrary.ts.
import type { ImageSourcePropType } from 'react-native';

import { imageLibrary } from './imageLibrary';

/** @deprecated Use `imageLibrary` (cut-out flag, aspect and alt text included). */
export const editorialArt = {
  authHero: imageLibrary.authHorse.source,
  familyHero: imageLibrary.familyCourtyard.source,
  horsePortrait: imageLibrary.horseBadal.source,
  sparkCover: imageLibrary.sparkHoof.source,
  communityEvent: imageLibrary.communityArena.source,
  passportArt: imageLibrary.saddle.source,
} as const satisfies Record<string, ImageSourcePropType>;
