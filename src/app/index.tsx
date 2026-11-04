import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAccess } from '@/features/identity/AccessProvider';
import { homeHrefFor } from '@/features/identity/domain/access';
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
  switch (state.phase) {
    case 'loading':
      return <BootScreen />;
    case 'signedOut':
      return <Redirect href="/sign-in" />;
    case 'unavailable':
      return <Redirect href="/unavailable" />;
    case 'authorized':
      return <Redirect href={homeHrefFor(state.experience)} />;
  }
}
