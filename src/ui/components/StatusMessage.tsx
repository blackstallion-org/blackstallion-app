import { StatusNote } from '@/ui/glass/states';

export type StatusTone = 'info' | 'success' | 'warning' | 'danger';

/** Inline status (icon + words). Warnings and errors are announced (alert role + live region). */
export function StatusMessage(props: { tone?: StatusTone; title?: string; message: string; testID?: string }) {
  return <StatusNote {...props} />;
}
