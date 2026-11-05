// Shared pieces for FO-08..FO-20: page heading, provenance banner, honest unavailable/denied/offline states, status
// badges for care rows. Compositions stay per screen; these only keep the same rule written once.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CareRowStatus } from '@/features/care/domain/timeline';
import type { FieldCommandError } from '@/features/field/domain/commandErrors';
import { AppText } from '@/ui/components/AppText';
import {
  ErrorState,
  GlassScreen,
  LoadingState,
  OfflineState,
  PermissionDeniedState,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
  type GlassScreenProps,
  type StatusTone,
} from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { Translator } from '../i18n/i18n';
import type { FieldResource } from '../hooks';

export function Heading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      {eyebrow ? (
        <AppText variant="secondary" tone="accent" style={styles.eyebrow}>
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="title" header>
        {title}
      </AppText>
      {subtitle ? <AppText tone="muted">{subtitle}</AppText> : null}
    </View>
  );
}

export function Provenance({ source, t }: { source: 'synthetic-preview' | 'server'; t: Translator }) {
  return source === 'synthetic-preview' ? <SyntheticDataBanner text={t.t('fo.common.synthetic')} /> : null;
}

/** No fieldOps repositories in this build: say so, never show placeholders as data. */
export function NotConnected({ t, header, testID }: { t: Translator; header?: GlassScreenProps['header']; testID?: string }) {
  return (
    <GlassScreen header={header} testID={testID}>
      <UnavailableState title={t.t('fo.common.notConnectedTitle')} message={t.t('fo.common.notConnected')} testID="fo-not-connected" />
    </GlassScreen>
  );
}

/** Loading, denied, not found, offline and error for a resource that has nothing to show. */
export function ResourceGate<T>({
  r,
  t,
  loadingLabel,
  deniedMessage,
  notFoundMessage,
  children,
  testIDPrefix,
}: {
  r: FieldResource<T> & { retry: () => void };
  t: Translator;
  loadingLabel: string;
  deniedMessage?: string;
  notFoundMessage?: string;
  children: (data: T, meta: { at: number; stale: boolean }) => ReactNode;
  testIDPrefix: string;
}) {
  if (r.status === 'loading') return <LoadingState label={loadingLabel} testID={`${testIDPrefix}-loading`} />;
  if (r.status === 'ready') return <>{children(r.data, { at: r.at, stale: false })}</>;
  if (r.kind === 'network' && r.cached) {
    return (
      <>
        <StatusNote tone="info" message={t.t('fo.common.staleSince', { time: t.time(r.cached.at, 'Asia/Kolkata') })} testID={`${testIDPrefix}-stale`} />
        {children(r.cached.data, { at: r.cached.at, stale: true })}
      </>
    );
  }
  return <ErrorBody error={r.error} t={t} retry={r.retry} deniedMessage={deniedMessage} notFoundMessage={notFoundMessage} testIDPrefix={testIDPrefix} />;
}

export function ErrorBody({
  error,
  t,
  retry,
  deniedMessage,
  notFoundMessage,
  testIDPrefix,
}: {
  error: FieldCommandError;
  t: Translator;
  retry?: () => void;
  deniedMessage?: string;
  notFoundMessage?: string;
  testIDPrefix: string;
}) {
  switch (error.kind) {
    case 'forbidden':
      return <PermissionDeniedState title={t.t('fo.common.deniedTitle')} message={deniedMessage ?? t.t('fo.common.denied')} testID={`${testIDPrefix}-denied`} />;
    case 'notFound':
      return <UnavailableState title={t.t('fo.common.notFoundTitle')} message={notFoundMessage ?? t.t('fo.common.notFound')} testID={`${testIDPrefix}-notfound`} />;
    case 'network':
      return <OfflineState message={t.t('fo.common.offline')} onRetry={retry} testID={`${testIDPrefix}-offline`} />;
    case 'signedOut':
      return <ErrorState title={t.t('fo.common.signedOutTitle')} message={t.t('fo.common.signedOut')} testID={`${testIDPrefix}-signedout`} />;
    default:
      return (
        <ErrorState
          title={t.t('fo.common.errorTitle')}
          message={t.t('fo.common.error')}
          onRetry={retry}
          details={error.reference ? t.t('fo.common.reference', { ref: error.reference }) : undefined}
          testID={`${testIDPrefix}-error`}
        />
      );
  }
}

/** Hub-local HH:MM for "last updated" lines (pilot hubs are in Asia/Kolkata). */
export function timeOf(at: number, timeZone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

export const CARE_TONE: Record<CareRowStatus, StatusTone> = {
  upcoming: 'neutral',
  due: 'info',
  past_due: 'warning',
  overdue: 'danger',
  submitted: 'info',
  completed: 'success',
};

export const TASK_ICON = {
  feed: 'nutrition-outline',
  water: 'water-outline',
  grooming_hoof: 'brush-outline',
  tack_check: 'construct-outline',
  medication: 'medkit-outline',
} as const;

export function Gap({ size = space.sm }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  heading: { gap: space.xs },
  eyebrow: { fontWeight: '600' },
});
