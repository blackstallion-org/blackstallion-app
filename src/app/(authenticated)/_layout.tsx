import { Stack } from 'expo-router';

import { useAccess } from '@/features/identity/AccessProvider';
import { useTheme } from '@/ui/theme/ThemeProvider';

/**
 * Authenticated tree. Exactly one experience's routes exist at a time: when
 * the experience changes, the other experience's history is removed by its
 * guard, so Back cannot return into it. Settings is shared.
 * These guards are UX only; the server authorizes every action (G3).
 */
export default function AuthenticatedLayout() {
  const { state, contextKey } = useAccess();
  const { colors } = useTheme();
  // Render nothing (not even the previous tree) unless authorized.
  if (state.phase !== 'authorized') return null;
  return (
    <Stack
      key={state.session.subjectId}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Stack.Protected guard={state.experience === 'family'}>
        <Stack.Screen name="family" key={`${contextKey}-family`} />
      </Stack.Protected>
      <Stack.Protected guard={state.experience === 'field'}>
        <Stack.Screen name="field" key={`${contextKey}-field`} />
      </Stack.Protected>
      <Stack.Screen name="settings/index" options={{ headerShown: true, title: 'Settings', headerBackTitle: 'Back' }} />
      <Stack.Protected guard={__DEV__}>
        <Stack.Screen name="settings/gallery" options={{ headerShown: true, title: 'Component gallery' }} />
      </Stack.Protected>
    </Stack>
  );
}
