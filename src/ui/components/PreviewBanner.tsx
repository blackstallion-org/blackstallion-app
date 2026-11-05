import { SyntheticDataBanner } from '@/ui/glass/states';

/** Shown on every screen that renders synthetic fixtures, so they are never mistaken for records. */
export function PreviewBanner({ text }: { text?: string }) {
  return <SyntheticDataBanner text={text} />;
}
