import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { AppText, Icon } from '@/ui/components';
import { GlassButton, GlassScreen, GlassSurface } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { useAccess } from './AccessProvider';

/**
 * SH-11 content. ONE neutral message for "doesn't exist" and "not yours" (PT404 is indistinguishable on purpose):
 * it never confirms that a record exists. Detail screens render this as their denied state; `+not-found` renders it
 * for unknown paths. "Go to Home" goes to the boot gate (`/`), which picks the current experience's home, or
 * sign-in when signed out.
 */
export function NotFoundContent({ testID = 'not-found' }: { testID?: string }) {
  const s = useAccountStrings();
  const router = useRouter();
  const { state } = useAccess();
  const { colors } = useTheme();
  const signedOut = state.phase === 'signedOut';
  return (
    <View style={styles.wrap} testID={testID}>
      <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.card}>
        <View style={[styles.iconDisc, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Icon name="compass-outline" size={30} color={colors.accent} />
        </View>
        <AppText variant="title" header>
          {s.t('notFound.title')}
        </AppText>
        <AppText tone="muted">{s.t('notFound.body')}</AppText>
      </GlassSurface>
      <View style={styles.actions}>
        <GlassButton testID="not-found-home" icon={signedOut ? 'log-in-outline' : 'home-outline'} label={signedOut ? s.t('notFound.signIn') : s.t('common.goHome')} onPress={() => router.replace('/')} />
        {router.canGoBack() ? <GlassButton testID="not-found-back" variant="secondary" icon="arrow-back" label={s.t('notFound.back')} onPress={() => router.back()} /> : null}
      </View>
    </View>
  );
}

/** SH-11 Not found (`+not-found`). */
export function NotFoundScreen() {
  return (
    <GlassScreen testID="not-found-screen" contentStyle={styles.centred}>
      <NotFoundContent />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  /** Gate screens sit in the optical centre; they still scroll on small phones and with large text. */
  centred: { flexGrow: 1, justifyContent: 'center' },
  card: { padding: space.xl, gap: space.md },
  iconDisc: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  actions: { gap: space.sm },
});
