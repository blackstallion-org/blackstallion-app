/**
 * Shared billing building blocks, composed only from the glass primitives (src/ui/glass) and AppText/Icon.
 * Route helpers, the payer scope, a load hook that keeps the typed BillingError, and the state switch every billing
 * screen uses (loading / offline / permission denied / not found / unavailable / error).
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { AppText, type TextTone } from '@/ui/components/AppText';
import type { IconName } from '@/ui/components/Icon';
import type { TextVariant } from '@/ui/tokens';
import {
  EmptyState,
  ErrorState,
  GlassButton,
  GlassDialog,
  GlassScreen,
  LoadingState,
  OfflineState,
  PermissionDeniedState,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
  type StatusTone,
} from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { BillingScope, BillingSource } from '../data/repositories';
import { BillingError, toBillingError } from '../domain/billingErrors';
import { viewOf, type OrderState, type Tone } from '../domain/paymentState';
import { dayTimeOf, money } from '../format';
import { BILLING_COPY } from '../strings';

// ------------------------------------------------------------------ routes

export const BILLING_ROUTES = {
  home: '/family/billing',
  invoices: '/family/billing/invoices',
  invoice: (orderId: string) => `/family/billing/invoices/${orderId}`,
  order: (orderId: string) => `/family/billing/orders/${orderId}`,
  autopay: '/family/billing/autopay',
  /** BI-01's parent: Profile (SH-04) in the Family experience. */
  profile: '/family/profile',
} as const;

/** Back that also works after a cold deep link (no history): go to the screen's parent instead of leaving the app. */
export function useBackTo(parent: string) {
  const router = useRouter();
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace(parent)), [router, parent]);
}

// ------------------------------------------------------------------ scope + loading

/** The signed-in guardian's billing scope. Billing routes exist only inside the Family experience. */
export function useBillingScope(): { scope: BillingScope; key: string } {
  const { state, contextKey } = useAuthorizedAccess();
  const children = state.session.scope?.children;
  const scope = useMemo<BillingScope>(
    () => ({ subjectId: state.session.subjectId, experience: 'family', children }),
    [state.session.subjectId, children],
  );
  return { scope, key: `${contextKey}:billing` };
}

export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; error: BillingError }
  /** `staleSince`: a background re-read failed; the data on screen is from that earlier load (offline "cached"). */
  | { status: 'ready'; data: T; loadedAt: number; stale: BillingError | null };

type Entry<T> = { base: string; key: string; state: Load<T> };

/**
 * Loads one keyed resource (like core useScopedResource: a result is shown only while its key is current, so another
 * person's or order's data never flashes) but keeps the typed BillingError so screens can tell offline from denied.
 * A failed background refresh keeps the earlier data on screen, marked stale, so the screen can say it is offline and
 * disable payment actions instead of showing nothing (or zero debt).
 */
export function useBillingResource<T>(
  key: string,
  loader: () => Promise<T>,
): Load<T> & { retry: () => void; refresh: () => void; replace: (data: T) => void } {
  const [attempt, setAttempt] = useState({ n: 0, silent: false });
  const requestKey = `${key}#${attempt.n}`;
  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const load = useEffectEvent(() => loader());
  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setEntry({ base: key, key: requestKey, state: { status: 'ready', data, loadedAt: Date.now(), stale: null } }),
      (e: unknown) =>
        current &&
        setEntry((prev) =>
          attempt.silent && prev && prev.base === key && prev.state.status === 'ready'
            ? { ...prev, key: requestKey, state: { ...prev.state, stale: toBillingError(e) } }
            : { base: key, key: requestKey, state: { status: 'error', error: toBillingError(e) } },
        ),
    );
    return () => {
      current = false;
    };
  }, [key, requestKey, attempt.silent]);
  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, silent: false })), []);
  /** Re-reads in the background, keeping the current data on screen until the answer arrives. */
  const refresh = useCallback(() => setAttempt((a) => ({ n: a.n + 1, silent: true })), []);
  const replace = useCallback(
    (data: T) => setEntry({ base: key, key: requestKey, state: { status: 'ready', data, loadedAt: Date.now(), stale: null } }),
    [key, requestKey],
  );
  const keep = attempt.silent && entry && entry.base === key && entry.state.status === 'ready';
  const state: Load<T> = entry && (entry.key === requestKey || keep) ? entry.state : { status: 'loading' };
  return { ...state, retry, refresh, replace };
}

/** Offline with earlier data on screen: say so, say when it was loaded, and that money actions wait for a connection. */
export function StaleNote({ error, loadedAt, testID = 'billing-stale' }: { error: BillingError | null; loadedAt: number; testID?: string }) {
  if (!error) return null;
  const time = dayTimeOf(new Date(loadedAt).toISOString());
  return (
    <StatusNote
      tone="warning"
      title={error.kind === 'network' ? BILLING_COPY.staleTitle : BILLING_COPY.errorTitle}
      message={error.kind === 'network' ? BILLING_COPY.staleMessage(time) : error.message}
      testID={testID}
    />
  );
}

/** Screen title (28–32 pt, a heading for screen readers) with an optional quiet line under it. */
export function PageTitle({ title, subtitle, testID }: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View style={styles.title} testID={testID}>
      <AppText variant="title" header>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="secondary" tone="muted" selectable>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Destructive confirmation with the SAFE choice as the default: "Keep" comes first and every dismiss gesture
 * (scrim, Escape, Android back) keeps. While the request runs the dialog cannot be dismissed, so closing it never
 * looks like cancelling a command the server may already have accepted.
 */
export function ConfirmDestructive({
  visible,
  title,
  message,
  keepLabel,
  confirmLabel,
  icon,
  onKeep,
  onConfirm,
  testID,
}: {
  visible: boolean;
  title: string;
  message: string;
  keepLabel: string;
  confirmLabel: string;
  icon: IconName;
  onKeep: () => void;
  onConfirm: () => Promise<void>;
  testID: string;
}) {
  const [pending, setPending] = useState(false);
  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };
  return (
    <GlassDialog
      visible={visible}
      onClose={onKeep}
      dismissible={!pending}
      title={title}
      message={message}
      testID={testID}
      actions={
        <>
          <GlassButton variant="secondary" label={keepLabel} onPress={onKeep} disabled={pending} testID={`${testID}-keep`} />
          <GlassButton variant="destructive" icon={icon} label={confirmLabel} onPress={confirm} testID={`${testID}-confirm`} />
        </>
      }
    />
  );
}

/** One honest state per failure kind. Raw server text is never shown; a reference sits behind Details. */
export function LoadFailure({ error, onRetry, testID = 'billing-error' }: { error: BillingError; onRetry: () => void; testID?: string }) {
  const router = useRouter();
  switch (error.kind) {
    case 'network':
      return <OfflineState message={BILLING_COPY.offlineMessage} onRetry={onRetry} testID={`${testID}-offline`} />;
    case 'forbidden':
      return <PermissionDeniedState title={BILLING_COPY.deniedTitle} message={error.message} testID={`${testID}-denied`} />;
    case 'signedOut':
      return <PermissionDeniedState title={BILLING_COPY.signedOutTitle} message={error.message} testID={`${testID}-denied`} />;
    case 'notFound':
      return (
        <EmptyState
          icon="search-outline"
          title={BILLING_COPY.notFoundTitle}
          message={BILLING_COPY.notFoundMessage}
          action={{ label: BILLING_COPY.backToBilling, icon: 'arrow-back', onPress: () => router.replace(BILLING_ROUTES.home) }}
          testID={`${testID}-not-found`}
        />
      );
    case 'unavailable':
      return <UnavailableState title={BILLING_COPY.unavailableTitle} message={error.message} testID={`${testID}-unavailable`} />;
    default:
      return (
        <ErrorState
          title={BILLING_COPY.errorTitle}
          message={error.message}
          onRetry={onRetry}
          details={error.reference ? `Reference: ${error.reference}` : undefined}
          testID={testID}
        />
      );
  }
}

// ------------------------------------------------------------------ page

/**
 * Billing page: ambient espresso backdrop, glass header with back, the synthetic-data banner whenever fixtures are in
 * use. Billing routes sit above the Family tabs, so GlassScreen reserves the bottom safe area (no tab bar here).
 */
export function BillingPage({
  title,
  subtitle,
  onBack,
  source,
  children,
  footer,
  testID,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  source?: BillingSource;
  children: ReactNode;
  footer?: ReactNode;
  testID: string;
}) {
  return (
    <GlassScreen testID={testID} header={{ onBack, backLabel: BILLING_COPY.back }} footer={footer}>
      <PageTitle title={title} subtitle={subtitle} />
      {source === 'synthetic-preview' ? <SyntheticDataBanner text={BILLING_COPY.syntheticBanner} /> : null}
      {children}
    </GlassScreen>
  );
}

export const BillingLoading = ({ rows = 3, testID }: { rows?: number; testID: string }) => <LoadingState label={BILLING_COPY.loading} rows={rows} testID={testID} />;

// ------------------------------------------------------------------ money + status

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/** An amount from integer paise, always with tabular numerals. */
export function Amount({
  paise,
  variant = 'bodyStrong',
  tone,
  prefix = '',
  style,
  testID,
  hidden = false,
}: {
  paise: number;
  variant?: TextVariant;
  tone?: TextTone;
  prefix?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  /** Hide from assistive tech when the amount is already part of an enclosing label. */
  hidden?: boolean;
}) {
  return (
    <AppText
      variant={variant}
      tone={tone}
      style={[TABULAR, style]}
      testID={testID}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      {prefix}
      {money(paise)}
    </AppText>
  );
}

const TONE: Record<Tone, StatusTone> = { neutral: 'neutral', progress: 'info', success: 'success', warning: 'warning', danger: 'danger' };

export const ORDER_BADGE: Record<OrderState, string> = {
  created: 'Open',
  awaiting_payment: 'Waiting for payment',
  failed: 'Failed',
  awaiting_confirmation: 'Confirming',
  paid: 'Paid',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Order status as icon + word, from the SERVER state only. */
export function OrderBadge({ state, testID }: { state: OrderState; testID?: string }) {
  const tone = TONE[viewOf({ state, underReview: false }).tone];
  const icon = state === 'awaiting_confirmation' ? 'hourglass-outline' : state === 'expired' || state === 'cancelled' ? 'remove-circle-outline' : undefined;
  return <StatusBadge label={ORDER_BADGE[state]} tone={tone} icon={icon} testID={testID} />;
}

export const toneOf = (t: Tone): StatusTone => TONE[t];

/** A label/value pair with the amount on the right, read as one sentence by screen readers. */
export function AmountLine({
  label,
  detail,
  paise,
  prefix,
  strong = false,
  testID,
}: {
  label: string;
  detail?: string;
  paise: number;
  prefix?: string;
  strong?: boolean;
  testID?: string;
}) {
  const said = [label, detail, `${prefix ?? ''}${money(paise)}`].filter(Boolean).join(', ');
  return (
    <View style={styles.amountLine} accessible accessibilityLabel={said} testID={testID}>
      <View style={styles.amountText}>
        <AppText variant={strong ? 'bodyStrong' : 'body'}>{label}</AppText>
        {detail ? (
          <AppText variant="secondary" tone="muted">
            {detail}
          </AppText>
        ) : null}
      </View>
      <Amount paise={paise} prefix={prefix} variant={strong ? 'bodyStrong' : 'body'} hidden />
    </View>
  );
}

/** A compact label/value pair for record details (method, limit, dates). Read as one phrase. */
export function DetailLine({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <AppText variant="secondary" tone="muted" style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText variant="secondary" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { gap: space.xs, marginBottom: space.xs },
  detail: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space.md, rowGap: 2, paddingVertical: space.xs + 2 },
  detailLabel: { flexShrink: 0 },
  detailValue: { fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  amountLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  amountText: { flex: 1, gap: 2 },
});
