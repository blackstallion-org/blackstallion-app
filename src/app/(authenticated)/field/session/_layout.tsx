import { Stack } from 'expo-router';

import { useAccess } from '@/features/identity/AccessProvider';
import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Earlier URLs of the session workflow, kept so existing links still open: `/field/session/scan` (FO-02, now at
 * `/field/scan`) and `/field/session/assess?op=` (FO-03, now at `/field/cadets/[cadetId]/assess`). The screens draw
 * their own glass header. Guards are UX only; the server authorizes every command.
 */
export default function FieldSessionLayout() {
  const { state } = useAccess();
  const { colors } = useTheme();
  if (state.phase !== 'authorized' || state.experience !== 'field') return null;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
