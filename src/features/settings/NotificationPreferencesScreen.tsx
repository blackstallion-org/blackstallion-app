import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { NOT_CONNECTED, useAccountScope } from '@/features/account/hooks';
import { applyAck, groupCategories, type NotificationCategory, type OsNotificationPermission } from '@/features/account/domain/notifications';
import type { AccountStrings } from '@/features/account/i18n/strings';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { latchOperation, type OperationLatch } from '@/features/field/domain/operation';
import { AppText } from '@/ui/components';
import {
  EmptyState,
  ErrorState,
  GlassButton,
  GlassScreen,
  GlassSurface,
  ListGroup,
  LoadingState,
  PermissionDeniedState,
  SegmentedControl,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
  type StatusTone,
} from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { useSafeBack } from './navigation';

type RowState = { status: 'saving'; requested: boolean } | { status: 'saved' } | { status: 'error'; message: string };

const OS_TONE: Record<OsNotificationPermission, StatusTone> = { granted: 'success', denied: 'warning', undetermined: 'info', unknown: 'neutral' };

/**
 * SH-08 Notification preferences (BACKEND_CONTRACT_V2 §3.4). Categories come from the server (only those offered to
 * this account); a choice shows "Saved" only after the server acknowledged it, and reverts with a message when it
 * fails. Retrying the same choice reuses its operation id (replay-safe). The OS permission is shown as far as this
 * build can read it — never guessed. No push is sent in the pilot (D05): the screen says so.
 */
export function NotificationPreferencesScreen() {
  const s = useAccountStrings();
  const back = useSafeBack('/settings');
  const { subject, contextKey } = useAccountScope();
  const synthetic = useAuthorizedAccess().state.session.source === 'synthetic-preview';
  const account = useRepositories().account;
  const perm = useOsPermission();
  const list = useScopedResource(`${contextKey}:notifications`, async () => {
    if (!account) throw new FieldCommandError('unexpected', 'Not connected', NOT_CONNECTED);
    return account.notifications.list(subject);
  });

  let body;
  if (!account) {
    body = <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('common.notConnectedBody')} testID="notifications-unavailable" />;
  } else if (list.status === 'loading') {
    body = <LoadingState label={s.t('notifications.loadingLabel')} rows={2} testID="notifications-loading" />;
  } else if (list.status === 'error') {
    body =
      list.reference === '42501' ? (
        <PermissionDeniedState title={s.t('common.deniedTitle')} message={s.t('common.deniedBody')} testID="notifications-denied" />
      ) : (
        <ErrorState title={s.t('common.loadErrorTitle')} message={s.t('common.loadError')} onRetry={list.retry} details={list.reference ? s.t('common.reference', { ref: list.reference }) : undefined} testID="notifications-error" />
      );
  } else {
    body = <Categories key={contextKey} initial={list.data} s={s} />;
  }

  return (
    <GlassScreen testID="notification-preferences" header={{ onBack: back, backLabel: s.t('common.back') }}>
      <View style={styles.head}>
        <AppText variant="title" header>
          {s.t('notifications.title')}
        </AppText>
        <AppText tone="muted">{s.t('notifications.intro')}</AppText>
      </View>
      {synthetic && account ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      <StatusNote tone="info" message={s.t('notifications.notLive')} testID="notifications-not-live" />
      {/* The choices are the task; the phone setting follows — unless the phone is blocking them, then it leads. */}
      {perm === 'denied' ? <OsPermissionCard s={s} perm={perm} /> : null}
      {body}
      {perm !== 'denied' ? <OsPermissionCard s={s} perm={perm} /> : null}
    </GlassScreen>
  );
}

/** OS permission as far as this build can read it; `unknown` without a port (never guessed). Null while reading. */
function useOsPermission(): OsNotificationPermission | null {
  const port = useRepositories().account?.notificationPermission;
  const [perm, setPerm] = useState<OsNotificationPermission | null>(null);
  useEffect(() => {
    if (!port) return;
    let live = true;
    port
      .status()
      .then((p) => live && setPerm(p))
      .catch(() => live && setPerm('unknown'));
    return () => {
      live = false;
    };
  }, [port]);
  return port ? perm : 'unknown';
}

function OsPermissionCard({ s, perm }: { s: AccountStrings; perm: OsNotificationPermission | null }) {
  const [openFailed, setOpenFailed] = useState(false);
  const p = perm ?? 'unknown';
  return (
    <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.os} testID="notifications-os">
      <View style={styles.osHead}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {s.t('notifications.phoneTitle')}
        </AppText>
        {perm ? <StatusBadge label={s.t(`notifications.os.${p}`)} tone={OS_TONE[p]} testID={`notifications-os-${p}`} /> : null}
      </View>
      <AppText variant="secondary" tone="muted">
        {s.t(`notifications.osBody.${p}`)}
      </AppText>
      {p === 'denied' || p === 'unknown' ? (
        <GlassButton
          variant="secondary"
          icon="settings-outline"
          label={s.t('notifications.openSettings')}
          testID="notifications-open-settings"
          onPress={async () => {
            try {
              await Linking.openSettings();
            } catch {
              setOpenFailed(true);
            }
          }}
        />
      ) : null}
      {openFailed ? <StatusNote tone="warning" message={s.t('notifications.openSettingsFailed')} /> : null}
    </GlassSurface>
  );
}

function Categories({ initial, s }: { initial: NotificationCategory[]; s: AccountStrings }) {
  const { subject } = useAccountScope();
  const account = useRepositories().account;
  const [rows, setRows] = useState(initial);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const latches = useRef<Record<string, OperationLatch | null>>({});
  const inFlight = useRef(new Set<string>());

  if (rows.length === 0) {
    return <EmptyState icon="notifications-off-outline" title={s.t('notifications.emptyTitle')} message={s.t('notifications.emptyBody')} testID="notifications-empty" />;
  }

  const choose = async (row: NotificationCategory, enabled: boolean) => {
    if (!account || inFlight.current.has(row.category) || enabled === row.enabled) return;
    inFlight.current.add(row.category);
    // Same category + same choice after a failure → same operation id (the server replays instead of writing twice).
    const latch = latchOperation(latches.current[row.category] ?? null, `${row.category}:${enabled}`);
    latches.current[row.category] = latch;
    setRowState((m) => ({ ...m, [row.category]: { status: 'saving', requested: enabled } }));
    try {
      const ack = await account.notifications.set(subject, { category: row.category, enabled, operationId: latch.operationId });
      latches.current[row.category] = null;
      setRows((r) => applyAck(r, ack));
      setRowState((m) => ({ ...m, [row.category]: { status: 'saved' } }));
    } catch (e) {
      const kind = e instanceof FieldCommandError ? e.kind : 'unexpected';
      if (kind !== 'network') latches.current[row.category] = null;
      const message = kind === 'network' ? s.t('notifications.failedNetwork') : kind === 'invalid' ? s.t('notifications.failedInvalid') : s.t('notifications.failedOther');
      setRowState((m) => ({ ...m, [row.category]: { status: 'error', message } }));
    } finally {
      inFlight.current.delete(row.category);
    }
  };

  return (
    <>
      {groupCategories(rows).map((g) => (
        <ListGroup key={g.audience} title={s.t(`notifications.group.${g.audience}`)} testID={`notifications-group-${g.audience}`}>
          {g.rows.map((row) => (
            <CategoryRow key={row.category} row={row} state={rowState[row.category]} onChange={(v) => void choose(row, v)} s={s} />
          ))}
        </ListGroup>
      ))}
    </>
  );
}

function CategoryRow({ row, state, onChange, s }: { row: NotificationCategory; state?: RowState; onChange: (v: boolean) => void; s: AccountStrings }) {
  const known = s.has(`notifications.category.${row.category}.title`);
  const title = known ? s.t(`notifications.category.${row.category}.title`) : row.title;
  const description = known ? s.t(`notifications.category.${row.category}.description`) : null;
  // While saving, show the requested choice; on failure the acknowledged value stays (the toggle "reverts").
  const shown = state?.status === 'saving' ? state.requested : row.enabled;
  return (
    <View style={styles.row} testID={`notification-${row.category}`}>
      <View accessible style={styles.rowText}>
        <AppText variant="bodyStrong">{title}</AppText>
        {description ? (
          <AppText variant="secondary" tone="muted">
            {description}
          </AppText>
        ) : null}
      </View>
      <View style={styles.controlRow}>
        <View style={styles.control}>
          <SegmentedControl<'off' | 'on'>
            label={s.t('notifications.toggleLabel', { category: title })}
            testID={`notification-${row.category}-toggle`}
            segments={[
              { value: 'off', label: s.t('notifications.off') },
              { value: 'on', label: s.t('notifications.on') },
            ]}
            value={shown ? 'on' : 'off'}
            onChange={(v) => onChange(v === 'on')}
          />
        </View>
        <View style={styles.flex}>
          <RowStatus state={state} isDefault={row.isDefault} s={s} category={row.category} />
        </View>
      </View>
      {state?.status === 'error' ? <StatusNote tone="danger" message={state.message} testID={`notification-${row.category}-error`} /> : null}
    </View>
  );
}

function RowStatus({ state, isDefault, s, category }: { state?: RowState; isDefault: boolean; s: AccountStrings; category: string }) {
  if (state?.status === 'saving') {
    return (
      <AppText variant="secondary" tone="muted" accessibilityLiveRegion="polite" testID={`notification-${category}-saving`}>
        {s.t('notifications.saving')}
      </AppText>
    );
  }
  if (state?.status === 'saved') return <StatusBadge label={s.t('notifications.saved')} tone="success" testID={`notification-${category}-saved`} />;
  if (isDefault) {
    return (
      <AppText variant="caption" tone="muted">
        {s.t('notifications.isDefault')}
      </AppText>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  os: { padding: space.lg, gap: space.md },
  osHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  row: { paddingVertical: space.md, gap: space.md },
  rowText: { gap: space.xxs },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  control: { width: 156 },
});
