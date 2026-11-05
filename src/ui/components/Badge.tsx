import { StatusBadge } from '@/ui/glass/StatusBadge';

import type { StatusTone } from './StatusMessage';

/** Pre-glass API kept for existing screens; renders a StatusBadge (icon + word, never colour alone). */
export function Badge({ label, tone = 'info', testID }: { label: string; tone?: StatusTone | 'neutral'; testID?: string }) {
  return <StatusBadge label={label} tone={tone} testID={testID} />;
}
