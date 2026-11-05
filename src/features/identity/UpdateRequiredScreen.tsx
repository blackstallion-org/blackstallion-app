import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import type { UpdateDestinations } from '@/features/account/config';
import { usePendingWork } from '@/features/account/hooks';
import type { UpdateDecision } from '@/features/account/domain/version';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { HelpSheet } from '@/features/settings/HelpSupport';
import { AppText, Icon } from '@/ui/components';
import { GlassButton, GlassScreen, GlassSurface, LoadingState, StatusNote, SyntheticDataBanner } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { useAccess } from './AccessProvider';
import { installedVersion, useUpdateGate } from './updateGate';

/**
 * SH-12 Update required (`/update-required`, 11 release rules). A blocking gate when this build is below the
 * server-published minimum: the only way on is the configured store/test-track link (validated hosts only; none is
 * invented when unset). Unsent work is counted and stays on the phone. Opened when the build is fine (stale link)
 * or when no policy can be read, it says so and lets the person continue (fail open; the server still refuses
 * incompatible writes).
 *
 * `preview` (development builds only) shows the blocking layout without a real policy, clearly labelled.
 */
export function UpdateRequiredScreen({ preview = false }: { preview?: boolean }) {
  const s = useAccountStrings();
  const router = useRouter();
  const gate = useUpdateGate();
  const devPreview = __DEV__ && preview;
  const decision: UpdateDecision | null = devPreview ? { kind: 'required', installed: installedVersion() ?? '0.0.0', minimum: '0.2.0' } : gate.decision;

  if (!decision) {
    return (
      <GlassScreen testID="update-checking" contentStyle={styles.centred}>
        <LoadingState label={s.t('update.checking')} rows={1} />
      </GlassScreen>
    );
  }
  if (decision.kind !== 'required') {
    const ok = decision.kind === 'supported';
    return (
      <GlassScreen testID={ok ? 'update-supported' : 'update-unknown'} contentStyle={styles.centred}>
        <Card icon={ok ? 'checkmark-circle-outline' : 'help-circle-outline'} title={s.t(ok ? 'update.supportedTitle' : 'update.unknownTitle')} body={s.t(ok ? 'update.supportedBody' : 'update.unknownBody')} />
        <GlassButton testID="update-continue" icon="arrow-forward" iconPosition="trailing" label={s.t('update.continue')} onPress={() => router.replace('/')} />
      </GlassScreen>
    );
  }
  return <Blocking decision={decision} devPreview={devPreview} />;
}

function Blocking({ decision, devPreview }: { decision: Extract<UpdateDecision, { kind: 'required' }>; devPreview: boolean }) {
  const s = useAccountStrings();
  const { state } = useAccess();
  const account = useRepositories().account;
  const pending = usePendingWork(state.phase === 'authorized' ? state.session.subjectId : null);
  const links = useScopedResource<UpdateDestinations | null>('update-destinations', async () => (account ? account.support.updateDestinations() : null));
  const [help, setHelp] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  // Blocking: Android back does nothing here (the stack also disables the swipe-back gesture for this route).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, []),
  );

  const url = links.status === 'ready' && links.data ? (Platform.OS === 'ios' ? links.data.ios : Platform.OS === 'android' ? links.data.android : (links.data.android ?? links.data.ios)) : null;
  return (
    <GlassScreen testID="update-required" contentStyle={styles.centred}>
      {devPreview ? <SyntheticDataBanner text={s.t('update.preview')} testID="update-preview-banner" /> : null}
      <Card icon="arrow-up-circle-outline" title={s.t('update.title')} body={s.t('update.body', { installed: decision.installed, minimum: decision.minimum })} />
      {pending.count ? (
        <StatusNote tone={pending.durable ? 'info' : 'warning'} message={s.t(pending.durable ? 'update.pending' : 'update.pendingMemory', { count: pending.count })} testID="update-pending" />
      ) : null}
      <AppText variant="secondary" tone="muted" style={styles.pad}>
        {pending.durable ? s.t('update.keepsData') : s.t('update.keepsDataMemory')}
      </AppText>
      {url ? (
        <GlassButton
          testID="update-open-store"
          icon={Platform.OS === 'ios' ? 'logo-apple-appstore' : 'logo-google-playstore'}
          label={Platform.OS === 'ios' ? s.t('update.updateIos') : s.t('update.updateAndroid')}
          onPress={async () => {
            try {
              await Linking.openURL(url);
            } catch {
              setOpenFailed(true);
            }
          }}
        />
      ) : links.status !== 'loading' ? (
        <StatusNote tone="warning" message={s.t('update.notConfigured')} testID="update-not-configured" />
      ) : null}
      {openFailed ? <StatusNote tone="warning" message={s.t('update.openFailed')} /> : null}
      <GlassButton testID="update-help" variant="secondary" icon="help-buoy-outline" label={s.t('common.getHelp')} onPress={() => setHelp(true)} />
      <HelpSheet visible={help} onClose={() => setHelp(false)} reference="UPDATE-REQUIRED" />
    </GlassScreen>
  );
}

function Card({ icon, title, body }: { icon: 'arrow-up-circle-outline' | 'checkmark-circle-outline' | 'help-circle-outline'; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.card}>
      <View style={[styles.iconDisc, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        <Icon name={icon} size={30} color={colors.accent} />
      </View>
      <AppText variant="title" header>
        {title}
      </AppText>
      <AppText tone="muted">{body}</AppText>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  centred: { flexGrow: 1, justifyContent: 'center' },
  pad: { paddingHorizontal: space.xs },
  card: { padding: space.xl, gap: space.md },
  iconDisc: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
});
