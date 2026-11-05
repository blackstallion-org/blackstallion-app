import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { AppearancePreference } from '@/core/preferences/appearance';
import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { APP_LANGUAGES, useLanguagePreference, type AppLanguage } from '@/features/account/i18n/languagePreference';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { useExperienceSwitch } from '@/features/identity/ExperienceSwitch';
import type { Experience } from '@/features/identity/domain/access';
import { AppText } from '@/ui/components';
import { GlassScreen, ListGroup, Row, SegmentedControl, StatusNote, SyntheticDataBanner } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import { SHARED_ROUTES, useSafeBack } from './navigation';
import { SignOutControl } from './SignOutSheet';

const APPEARANCE: readonly AppearancePreference[] = ['dark', 'light', 'system'];
/** Language names are shown in their own script, so anyone can find theirs. */
const LANGUAGE_NAME: Record<AppLanguage, string> = { en: 'English', hi: 'हिन्दी', te: 'తెలుగు' };

/**
 * SH-13 Settings (13 S04), pushed from Profile over the tab set. Local preferences apply at once and persist
 * (appearance: core/preferences; language: account/i18n). Rows a role can't use are hidden, not disabled.
 */
export function SettingsScreen() {
  const theme = useTheme();
  const access = useAuthorizedAccess();
  const s = useAccountStrings();
  const router = useRouter();
  const back = useSafeBack('/');
  const language = useLanguagePreference();
  const switchTo = useExperienceSwitch();
  const account = useRepositories().account;
  const contact = useScopedResource(`${access.contextKey}:support`, async () => (account ? account.support.contact() : null));
  const session = access.state.session;
  const isGuardian = session.allowedExperiences.includes('family');
  const privacyUrl = contact.status === 'ready' && contact.data?.source === 'config' ? contact.data.privacyPolicyUrl : null;

  return (
    <GlassScreen testID="settings" header={{ onBack: back, backLabel: s.t('common.back') }}>
      <AppText variant="title" header>
        {s.t('settings.title')}
      </AppText>

      <Block title={s.t('settings.appearance')}>
        <SegmentedControl<AppearancePreference>
          label={s.t('settings.appearance')}
          testID="appearance"
          segments={APPEARANCE.map((v) => ({ value: v, label: s.t(`settings.${v}`) }))}
          value={theme.preference}
          onChange={(v) => void theme.setPreference(v)}
        />
        <Hint>{s.t(`settings.${theme.preference}Hint`)}</Hint>
        {theme.saveError ? <StatusNote tone="warning" message={s.t('settings.saveFailed')} testID="appearance-save-error" /> : null}
      </Block>

      <Block title={s.t('settings.language')}>
        <SegmentedControl<AppLanguage>
          label={s.t('settings.language')}
          testID="language"
          segments={APP_LANGUAGES.map((v) => ({ value: v, label: LANGUAGE_NAME[v] }))}
          value={language.effective}
          onChange={(v) => void language.setLanguage(v)}
        />
        <Hint>{s.t('settings.languageHint')}</Hint>
        {isGuardian ? <Hint>{s.t('settings.languageFamily')}</Hint> : null}
        {language.effective !== 'en' ? <Hint>{s.t('settings.languageDraft')}</Hint> : null}
        {language.saveFailed ? <StatusNote tone="warning" message={s.t('settings.saveFailed')} testID="language-save-error" /> : null}
      </Block>

      {access.canSwitch ? (
        <Block title={s.t('settings.experience')}>
          <SegmentedControl<Experience>
            label={s.t('settings.experience')}
            testID="experience-options"
            segments={session.allowedExperiences.map((e) => ({ value: e, label: s.t(`experience.${e}`) }))}
            value={access.state.experience}
            onChange={switchTo}
          />
          <Hint>{s.t('profile.switchHint')}</Hint>
        </Block>
      ) : null}

      <ListGroup title={s.t('settings.groupNotifications')}>
        <Row testID="open-notifications" icon="notifications-outline" label={s.t('settings.notifications')} value={s.t('settings.notificationsValue')} onPress={() => router.push(SHARED_ROUTES.notifications)} />
        {isGuardian && access.state.experience === 'family' ? (
          <Row testID="open-consents" icon="shield-checkmark-outline" label={s.t('settings.privacyConsents')} value={s.t('settings.privacyConsentsValue')} onPress={() => router.push(SHARED_ROUTES.consents)} />
        ) : null}
        {privacyUrl ? (
          <Row testID="open-privacy-policy" icon="document-text-outline" label={s.t('settings.privacyPolicy')} value={s.t('settings.privacyPolicyValue')} onPress={() => void Linking.openURL(privacyUrl).catch(() => undefined)} />
        ) : null}
      </ListGroup>

      <ListGroup title={s.t('settings.groupSupport')}>
        <Row testID="open-help" icon="help-buoy-outline" label={s.t('settings.help')} value={s.t('settings.helpValue')} onPress={() => router.push(SHARED_ROUTES.help)} />
      </ListGroup>

      <ListGroup title={s.t('settings.groupAccount')} footer={<SignOutControl />}>
        <Row icon="person-circle-outline" label={s.t('settings.signedInAs')} value={session.displayName} />
        {session.source === 'synthetic-preview' ? <SyntheticDataBanner text={s.t('settings.syntheticAccount')} /> : null}
      </ListGroup>

      <ListGroup>
        <Row testID="open-delete-account" icon="trash-outline" label={s.t('settings.deleteAccount')} value={s.t('settings.deleteAccountValue')} onPress={() => router.push(SHARED_ROUTES.deleteAccount)} />
      </ListGroup>

      <ListGroup title={s.t('settings.groupAbout')}>
        <Row label={s.t('settings.version')} value={Constants.expoConfig?.version ?? '—'} />
        <Row label={s.t('settings.build')} value={__DEV__ ? s.t('settings.buildDevelopment') : s.t('settings.buildRelease')} />
        <Row label={s.t('settings.adapter')} value={access.adapterName} />
        {__DEV__ ? (
          <Row testID="open-gallery" icon="color-palette-outline" label={s.t('settings.gallery')} value={s.t('settings.galleryValue')} onPress={() => router.push(SHARED_ROUTES.gallery)} />
        ) : null}
      </ListGroup>
    </GlassScreen>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <AppText variant="secondary" tone="muted" header style={styles.pad}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function Hint({ children }: { children: string }) {
  return (
    <AppText variant="secondary" tone="muted" style={styles.pad}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  pad: { paddingHorizontal: space.xs },
});
