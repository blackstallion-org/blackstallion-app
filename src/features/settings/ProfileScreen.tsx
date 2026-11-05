import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { NOT_CONNECTED, useProfileDetails } from '@/features/account/hooks';
import { initialsOf, joinNames, type ProfileDetails } from '@/features/account/domain/profile';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import type { AccountStrings } from '@/features/account/i18n/strings';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { useExperienceSwitch } from '@/features/identity/ExperienceSwitch';
import type { Experience } from '@/features/identity/domain/access';
import { AppText } from '@/ui/components';
import { GlassButton, GlassScreen, GlassSurface, ListGroup, Pill, Row, SegmentedControl, Skeleton, StatusNote, SyntheticDataBanner } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontFor } from '@/ui/theme/fonts';
import { radius, space } from '@/ui/tokens';

import { SHARED_ROUTES } from './navigation';

/**
 * SH-04 Profile: ONE component mounted as the Profile tab of both experiences. Identity (who is signed in, display
 * role line from the server snapshot), the experience switch when — and only when — the snapshot allows both, and
 * grouped destinations. Nothing here grants anything: switching changes navigation and query scope only.
 */
export function ProfileScreen() {
  const { state, canSwitch } = useAuthorizedAccess();
  const s = useAccountStrings();
  const router = useRouter();
  const switchTo = useExperienceSwitch();
  const details = useProfileDetails();
  const session = state.session;
  const experience = state.experience;
  const synthetic = session.source === 'synthetic-preview';

  return (
    <GlassScreen edges={['top', 'left', 'right']} testID={`profile-${experience}`}>
      <AppText variant="title" header>
        {s.t('profile.title')}
      </AppText>

      <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.identity} testID="profile-identity">
        <View style={styles.identityRow}>
          <Monogram name={session.displayName} />
          <View style={styles.identityText}>
            <AppText variant="section" numberOfLines={2} testID="profile-name">
              {session.displayName}
            </AppText>
            <RoleLines details={details.status === 'ready' ? details.data : details.cached?.details ?? null} loading={details.status === 'loading'} s={s} />
          </View>
        </View>
        <Pill icon={experience === 'family' ? 'home-outline' : 'briefcase-outline'} label={s.t('profile.viewing', { experience: s.t(`experience.${experience}`) })} material="regular" testID="profile-viewing" />
        {details.status === 'error' && details.reference !== NOT_CONNECTED ? (
          <View style={styles.detailsError}>
            <StatusNote tone={details.cached ? 'info' : 'warning'} message={details.cached ? s.t('profile.detailsStale') : s.t('profile.detailsError')} testID="profile-details-error" />
            <GlassButton variant="ghost" size="regular" icon="refresh" label={s.t('common.retry')} onPress={details.retry} testID="profile-details-retry" />
          </View>
        ) : null}
        {synthetic ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      </GlassSurface>

      {canSwitch ? (
        <View style={styles.block} testID="profile-switch">
          <AppText variant="secondary" tone="muted" header style={styles.blockTitle}>
            {s.t('profile.switchTitle')}
          </AppText>
          <SegmentedControl<Experience>
            label={s.t('profile.switchTitle')}
            testID="profile-experience"
            segments={session.allowedExperiences.map((e) => ({ value: e, label: s.t(`experience.${e}`) }))}
            value={experience}
            onChange={switchTo}
          />
          <AppText variant="secondary" tone="muted" style={styles.blockTitle}>
            {s.t('profile.switchHint')}
          </AppText>
        </View>
      ) : null}

      <ListGroup title={s.t('profile.groupAccount')}>
        <Row testID="open-settings" icon="settings-outline" label={s.t('profile.settings')} value={s.t('profile.settingsValue')} onPress={() => router.push(SHARED_ROUTES.settings)} />
        <Row testID="open-notifications" icon="notifications-outline" label={s.t('profile.notifications')} value={s.t('profile.notificationsValue')} onPress={() => router.push(SHARED_ROUTES.notifications)} />
        <Row testID="open-help" icon="help-buoy-outline" label={s.t('profile.help')} value={s.t('profile.helpValue')} onPress={() => router.push(SHARED_ROUTES.help)} />
      </ListGroup>

      {/* 07: Billing sits under Profile, for guardians, in the Family experience only. Hidden (not disabled) otherwise. */}
      {experience === 'family' && session.allowedExperiences.includes('family') ? (
        <ListGroup title={s.t('profile.groupFamily')}>
          <Row testID="open-billing" icon="card-outline" label={s.t('profile.billing')} value={s.t('profile.billingValue')} onPress={() => router.push(SHARED_ROUTES.billing)} />
        </ListGroup>
      ) : null}
    </GlassScreen>
  );
}

/** "Instructor at Demo Hub One" / "Guardian of Aarav and Meera" — display only, from the server snapshot. */
function RoleLines({ details, loading, s }: { details: ProfileDetails | null; loading: boolean; s: AccountStrings }) {
  if (loading) {
    return (
      <View style={styles.roleLines} accessible accessibilityLabel={s.t('profile.loadingLabel')} accessibilityState={{ busy: true }} testID="profile-details-loading">
        <Skeleton height={14} width="80%" />
        <Skeleton height={14} width="55%" />
      </View>
    );
  }
  if (!details) return null;
  const lines: string[] = [];
  if (details.staffRole) {
    const role = s.t(`role.${details.staffRole}`);
    lines.push(details.hubName ? s.t('profile.roleAtHub', { role, hub: details.hubName }) : role);
  }
  if (details.childFirstNames.length > 0) lines.push(s.t('profile.guardianOf', { names: joinNames(details.childFirstNames, s.t('common.and')) }));
  else if (!details.staffRole) lines.push(s.t('role.guardian'));
  return (
    <View style={styles.roleLines} testID="profile-roles">
      {lines.map((l) => (
        <AppText key={l} variant="secondary" tone="muted">
          {l}
        </AppText>
      ))}
    </View>
  );
}

/** Initials on a thick glass disc with an amber rim. Decorative: the name next to it is the accessible text. */
function Monogram({ name }: { name: string }) {
  const { colors } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.monoRing, { borderColor: colors.accent }]}>
      <GlassSurface material="regular" borderRadius={34} width={68} height={68} elevated={false} contentStyle={styles.monoContent}>
        <AppText style={[styles.monoText, fontFor('600'), { color: colors.accentText }]} maxFontSizeMultiplier={1.2}>
          {initialsOf(name)}
        </AppText>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { padding: space.xl, gap: space.lg },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  identityText: { flex: 1, gap: space.xs },
  roleLines: { gap: space.xxs },
  detailsError: { gap: space.xs },
  block: { gap: space.sm },
  blockTitle: { paddingHorizontal: space.xs },
  monoRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  monoContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontSize: 26, lineHeight: 32, letterSpacing: 0.5 },
});
