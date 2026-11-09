// Static image assets for Metro (require keeps them in the bundle).
import type { ImageSource } from 'expo-image';

/**
 * Editorial image library (6 Nov 2026 redesign). Source of truth: assets/library/assets-manifest.json (prompt, screens,
 * review status, alt text). App-sized derivatives are built by scripts/build-image-library.py. Only approved assets that a
 * screen actually uses are listed here, so Metro bundles nothing else; the other approved derivatives stay in
 * assets/library for later placement.
 *
 * EDITORIAL ART ONLY: never care evidence, a real horse profile, session video, camera stream or identity record.
 * Fictional subjects; generated people are illustrative. All images are decorative (hidden from screen readers);
 * the screen's own text carries the meaning.
 *
 * `cutout` = transparent PNG shown whole on a flat palette colour (resizeMode contain). Otherwise a photograph shown
 * in a hard-edged frame (cover). Never under text, never faded or tinted.
 */
export type LibraryImage = { source: ImageSource; cutout: boolean; aspect: number; alt: string };

const img = (source: ImageSource, cutout: boolean, w: number, h: number, alt: string): LibraryImage => ({ source, cutout, aspect: w / h, alt });

export const imageLibrary = {
  // 01 Academy and brand
  authHorse: img(require('../../assets/library/marwari-black-portrait.png'), true, 658, 800, 'Black Marwari horse, head and neck'),
  // 02 Horses
  horseBadal: img(require('../../assets/library/marwari-chestnut-rearing.png'), true, 668, 800, 'Chestnut Marwari horse rearing'),
  // 03 Tack and objects
  saddle: img(require('../../assets/library/saddle.png'), true, 600, 478, 'Brown leather saddle with stirrup'),
  sparkHoof: img(require('../../assets/library/spark-hoof.png'), true, 432, 600, 'Horse hoof with a steel shoe'),
  leatherTack: img(require('../../assets/library/leather-tack.jpg'), false, 1045, 1400, 'Saddled bay horse in a stone archway'),
  // 04 Training
  groundwork: img(require('../../assets/library/groundwork.jpg'), false, 1400, 930, 'Instructor lunging a horse in a sand arena'),
  // 05 Places and care
  familyCourtyard: img(require('../../assets/library/family-courtyard.jpg'), false, 1400, 1045, 'Sandstone stable courtyard with a bay horse'),
  grooming: img(require('../../assets/library/grooming.jpg'), false, 1400, 792, "Hands brushing a horse's neck"),
  // 06 Community
  communityArena: img(require('../../assets/library/community-arena.jpg'), false, 1400, 792, 'Riding arena at golden hour with families watching'),
} as const;

export type LibraryImageName = keyof typeof imageLibrary;
