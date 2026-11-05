import { Redirect } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAccess } from '@/features/identity/AccessProvider';
import { homeHrefFor } from '@/features/identity/domain/access';
import { useUpdateGate } from '@/features/identity/updateGate';
import { takeResume } from '@/shell/resumeLink';
import { AppText } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

/** Neutral boot screen: no names, no data, nothing from a previous person. */
function BootScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="boot-screen"
      accessible
      accessibilityLabel="Starting BSAH"
      accessibilityState={{ busy: true }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, backgroundColor: colors.canvas }}
    >
      <ActivityIndicator color={colors.ink} />
      <AppText tone="muted">Starting…</AppText>
    </View>
  );
}

export default function Index() {
  const { state } = useAccess();
  // SH-12: a build below the published minimum stops here (the gate waits at most a few seconds for the policy;
  // no policy, unreadable or timed out lets the person in).
  const gate = useUpdateGate();
  const experience = state.phase === 'authorized' ? state.experience : null;
  // Single use: read once when the person is authorized (and the update gate has answered).
  const resume = useMemo(() => (experience && !gate.checking ? takeResume(experience) : null), [experience, gate.checking]);
  switch (state.phase) {
    case 'loading':
      return <BootScreen />;
    case 'signedOut':
      return <Redirect href="/sign-in" />;
    case 'unavailable':
      return <Redirect href="/unavailable" />;
    case 'authorized':
      if (gate.checking) return <BootScreen />;
      if (gate.decision?.kind === 'required') return <Redirect href="/update-required" />;
      return <Redirect href={(resume ?? homeHrefFor(state.experience)) as never} />;
  }
}
