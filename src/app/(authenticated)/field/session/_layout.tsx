import { Stack } from 'expo-router';

import { useAccess } from '@/features/identity/AccessProvider';
import { useTheme } from '@/ui/theme/ThemeProvider';

/** Field session workflow (FO-02 → FO-03). Guards are UX only; the server authorizes every command. */
export default function FieldSessionLayout() {
  const { state } = useAccess();
  const { colors } = useTheme();
  if (state.phase !== 'authorized' || state.experience !== 'field') return null;
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: 'Back',
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="scan" options={{ title: 'Check in' }} />
      <Stack.Screen name="assess" options={{ title: 'Assess' }} />
    </Stack>
  );
}
