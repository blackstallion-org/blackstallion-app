import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { hasAnyContact, type SupportContact } from '@/features/account/config';
import { buildDiagnosticText, newDiagnosticId, sanitizeReference } from '@/features/account/domain/diagnostics';
import type { AccountStrings } from '@/features/account/i18n/strings';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { useAccess } from '@/features/identity/AccessProvider';
import { AppText } from '@/ui/components';
import { GlassBottomSheet, GlassButton, GlassCard, GlassScreen, ListGroup, Row, Skeleton, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { useSafeBack } from './navigation';

/** One random ID per app launch: identifies a report, not a person, device or account. */
const LAUNCH_DIAGNOSTIC_ID = newDiagnosticId();
export const launchDiagnosticId = (): string => LAUNCH_DIAGNOSTIC_ID;

/**
 * SH-09 Help & support (signed in: `/settings/help`, optionally `?ref=<error reference>` from an error's Details).
 * The public variant for signed-out screens (SH-01/02/03/12) is `HelpSheet`, with the same content.
 */
export function HelpSupportScreen({ reference }: { reference?: string | null }) {
  const s = useAccountStrings();
  const back = useSafeBack('/settings');
  return (
    <GlassScreen testID="help-support" header={{ onBack: back, backLabel: s.t('common.back') }}>
      <View style={styles.head}>
        <AppText variant="title" header>
          {s.t('help.title')}
        </AppText>
        <AppText tone="muted">{s.t('help.intro')}</AppText>
      </View>
      <HelpContent reference={reference} s={s} />
    </GlassScreen>
  );
}

/** Help as a bottom sheet for places with no signed-in route (sign-in, verify, account status, update gate). */
export function HelpSheet({ visible, onClose, reference }: { visible: boolean; onClose: () => void; reference?: string | null }) {
  const s = useAccountStrings();
  const { height } = useWindowDimensions();
  return (
    <GlassBottomSheet visible={visible} onClose={onClose} title={s.t('help.title')} description={s.t('help.intro')} closeLabel={s.t('common.close')} testID="help-sheet"
      actions={<GlassButton variant="secondary" label={s.t('common.close')} onPress={onClose} testID="help-sheet-close" />}
    >
      <ScrollView style={{ maxHeight: Math.max(220, height * 0.5) }} contentContainerStyle={styles.sheetScroll}>
        {visible ? <HelpContent reference={reference} s={s} compact /> : null}
      </ScrollView>
    </GlassBottomSheet>
  );
}

function HelpContent({ reference, s, compact = false }: { reference?: string | null; s: AccountStrings; compact?: boolean }) {
  const account = useRepositories().account;
  const contact = useScopedResource('support-contact', async () => (account ? account.support.contact() : null));
  const ref = sanitizeReference(reference);
  return (
    <>
      {contact.status === 'loading' ? (
        <View accessible accessibilityLabel={s.t('help.loadingLabel')} accessibilityState={{ busy: true }} style={styles.skeleton}>
          <Skeleton height={18} width="60%" />
          <Skeleton height={18} width="80%" />
        </View>
      ) : contact.status === 'ready' && contact.data && hasAnyContact(contact.data) ? (
        <ContactGroup contact={contact.data} s={s} />
      ) : (
        <StatusNote tone="info" message={s.t('help.notConfigured')} testID="help-not-configured" />
      )}
      <DiagnosticCard reference={ref} s={s} compact={compact} />
    </>
  );
}

function ContactGroup({ contact, s }: { contact: SupportContact; s: AccountStrings }) {
  const sample = contact.source === 'synthetic-preview';
  const [failed, setFailed] = useState(false);
  const open = (url: string) => async () => {
    try {
      await Linking.openURL(url);
    } catch {
      setFailed(true);
    }
  };
  // Samples are shown but never dialled or opened.
  const act = (url: string) => (sample ? undefined : open(url));
  return (
    <View style={styles.group}>
      <ListGroup title={contact.academyName ?? s.t('help.contactTitle')} testID="help-contact">
        {contact.phone ? <Row testID="help-call" icon="call-outline" label={s.t('help.call')} value={contact.phone} onPress={act(`tel:${contact.phone.replace(/[^\d+]/g, '')}`)} /> : null}
        {contact.email ? <Row testID="help-email" icon="mail-outline" label={s.t('help.email')} value={contact.email} onPress={act(`mailto:${contact.email}`)} /> : null}
        {contact.website ? <Row testID="help-website" icon="globe-outline" label={s.t('help.website')} value={contact.website.replace(/^https:\/\//, '')} onPress={act(contact.website)} /> : null}
        {contact.hours ? <Row icon="time-outline" label={s.t('help.hours')} value={contact.hours} /> : null}
      </ListGroup>
      {sample ? (
        <AppText variant="secondary" tone="muted" style={styles.footnote} testID="help-sample">
          {s.t('help.sample')}
        </AppText>
      ) : null}
      {failed ? <StatusNote tone="warning" message={s.t('help.openFailed')} /> : null}
    </View>
  );
}

function DiagnosticCard({ reference, s, compact }: { reference: string | null; s: AccountStrings; compact: boolean }) {
  const { adapterName } = useAccess();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = () =>
    buildDiagnosticText({
      diagnosticId: LAUNCH_DIAGNOSTIC_ID,
      appVersion: Constants.expoConfig?.version ?? null,
      build: __DEV__ ? 'development' : 'release',
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? ''),
      adapter: adapterName,
      reference,
      at: new Date(),
    });
  return (
    <GlassCard material="thick" testID="help-diagnostic" contentStyle={styles.diag} expandable expandLabel={s.t('help.included')} collapseLabel={s.t('help.included')}
      expandedContent={
        <AppText variant="secondary" tone="muted">
          {s.t('help.includedBody')}
        </AppText>
      }
    >
      <AppText variant="secondary" tone="muted" header>
        {s.t('help.diagnosticTitle')}
      </AppText>
      <AppText variant="score" selectable testID="help-diagnostic-id" accessibilityLabel={`${s.t('help.diagnosticTitle')}: ${LAUNCH_DIAGNOSTIC_ID.split('').join(' ')}`}>
        {LAUNCH_DIAGNOSTIC_ID}
      </AppText>
      {!compact ? <AppText tone="muted">{s.t('help.diagnosticBody')}</AppText> : null}
      {reference ? <Row icon="bug-outline" label={s.t('help.errorReference')} value={reference} testID="help-reference" /> : null}
      <Row icon="information-circle-outline" label={s.t('help.appVersion')} value={`${Constants.expoConfig?.version ?? '—'} · ${Platform.OS}`} />
      <GlassButton
        variant="secondary"
        icon="copy-outline"
        label={s.t('help.copy')}
        testID="help-copy"
        onPress={async () => {
          try {
            const ok = await Clipboard.setStringAsync(text());
            setCopy(ok === false ? 'failed' : 'copied');
          } catch {
            setCopy('failed');
          }
        }}
      />
      {copy === 'copied' ? <StatusNote tone="success" message={s.t('help.copied')} testID="help-copied" /> : null}
      {copy === 'failed' ? <StatusNote tone="warning" message={s.t('help.copyFailed')} testID="help-copy-failed" /> : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  group: { gap: space.sm },
  footnote: { paddingHorizontal: space.xs },
  skeleton: { gap: space.sm, paddingVertical: space.md },
  diag: { padding: space.xl, gap: space.md },
  sheetScroll: { gap: space.lg, paddingBottom: space.sm },
});
