import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { HelpSheet } from '@/features/settings/HelpSupport';
import { AppText, Icon, type IconName } from '@/ui/components';
import { GlassButton, GlassScreen, GlassSurface, Pill } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { useAccess } from './AccessProvider';
import type { UnavailableReason } from './domain/access';

const ICON: Record<UnavailableReason, IconName> = {
  unknownAccount: 'person-remove-outline',
  disabled: 'pause-circle-outline',
  noExperience: 'hourglass-outline',
  bootError: 'cloud-offline-outline',
};

/**
 * SH-03 Account status (`/unavailable`, 07 boot states). ONE reason, its next step and a support path. It shows
 * nothing about the account beyond the reason — no name, e-mail, role or children — and no action here grants
 * access: Try again re-runs the boot sequence (server snapshot), Sign out ends the session.
 */
export function UnavailableScreen() {
  const access = useAccess();
  const s = useAccountStrings();
  const { colors } = useTheme();
  const [help, setHelp] = useState(false);
  const reason: UnavailableReason = access.state.phase === 'unavailable' ? access.state.reason : 'bootError';
  const tone = reason === 'bootError' ? colors.inkMuted : reason === 'disabled' ? colors.warningText : colors.accent;
  return (
    <GlassScreen testID={`unavailable-${reason}`} contentStyle={styles.centred}>
      <Pill label={s.t('status.eyebrow')} icon="person-circle-outline" material="thick" />
      <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.card}>
        <View style={[styles.iconDisc, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Icon name={ICON[reason]} size={30} color={tone} />
        </View>
        <AppText variant="title" header accessibilityRole="header">
          {s.t(`status.${reason}.title`)}
        </AppText>
        <AppText>{s.t(`status.${reason}.body`)}</AppText>
        <AppText tone="muted">{s.t(`status.${reason}.next`)}</AppText>
      </GlassSurface>
      <View style={styles.actions}>
        <GlassButton testID="retry" variant={reason === 'bootError' ? 'primary' : 'secondary'} icon="refresh" label={s.t('common.retry')} onPress={access.reload} />
        <GlassButton testID="unavailable-help" variant="secondary" icon="help-buoy-outline" label={s.t('common.getHelp')} onPress={() => setHelp(true)} />
        <GlassButton testID="unavailable-sign-out" variant="ghost" icon="log-out-outline" label={s.t('common.signOut')} onPress={() => access.signOut()} />
      </View>
      <HelpSheet visible={help} onClose={() => setHelp(false)} reference={reason === 'bootError' ? 'BOOT' : null} />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  centred: { flexGrow: 1, justifyContent: 'center' },
  card: { padding: space.xl, gap: space.md },
  iconDisc: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  actions: { gap: space.sm },
});
