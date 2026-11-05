// Static image assets for Metro (require keeps them in the bundle).
import type { ImageSourcePropType } from 'react-native';

/**
 * Higgsfield-generated editorial art (assets/editorial/assets-manifest.json,
 * status "generated; pending owner approval"). EDITORIAL ART ONLY: never care
 * evidence, a real horse profile, session video, camera stream or identity
 * record. Fictional subjects; no people likeness.
 */
export const editorialArt = {
  authHero: require('../../assets/editorial/auth-hero.jpg') as ImageSourcePropType,
  familyHero: require('../../assets/editorial/family-hero.jpg') as ImageSourcePropType,
  horsePortrait: require('../../assets/editorial/horse-portrait.jpg') as ImageSourcePropType,
  sparkCover: require('../../assets/editorial/spark-cover.jpg') as ImageSourcePropType,
  communityEvent: require('../../assets/editorial/community-event.jpg') as ImageSourcePropType,
  passportArt: require('../../assets/editorial/passport-art.jpg') as ImageSourcePropType,
} as const;
