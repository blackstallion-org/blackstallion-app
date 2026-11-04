import type { ReactNode } from 'react';

export default function GalleryRoute(): ReactNode {
  if (!__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dev = require('@/dev/preview') as typeof import('@/dev/preview');
  return <dev.ComponentGallery />;
}
