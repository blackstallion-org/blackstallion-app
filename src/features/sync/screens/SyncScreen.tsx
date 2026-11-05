// FO-12 Sync centre, FO-13 Sync item sheet and FO-14 Discard dialog. Pure presentation over SyncScreenModel; the
// composition root (features/fieldOps/screens/SyncCentreScreen) passes the actions in.
// Sunlight-readable: one summary card, then flat rows grouped by state inside single glass groups; status is icon +
// word. Every action in the sheet says what it will do. Discard is a separate, explicit dialog with Cancel first.
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Translator } from '@/features/care/i18n/i18n';
import { plain } from '@/features/care/i18n/i18n';
import { AppText } from '@/ui/components/AppText';
import type { IconName } from '@/ui/components/Icon';
import {
  EmptyState,
  GlassBottomSheet,
  GlassButton,
  GlassDialog,
  GlassScreen,
  ListGroup,
  Row,
  StatusBadge,
  StatusNote,
  type StatusTone,
} from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { SyncAction, SyncRow, SyncScreenModel } from '../domain/syncViewModel';
import type { QueueState } from '../domain/types';

const STATE_BADGE: Partial<Record<QueueState, { key: string; tone: StatusTone }>> = {
  ready: { key: 'common.status.queued', tone: 'neutral' },
  capturing: { key: 'common.status.queued', tone: 'neutral' },
  retry_wait: { key: 'sync.badge.retry', tone: 'warning' },
  leased: { key: 'common.status.uploading', tone: 'info' },
  uploading: { key: 'common.status.uploading', tone: 'info' },
  submitting: { key: 'common.status.uploading', tone: 'info' },
  acknowledged: { key: 'common.status.received', tone: 'success' },
  needs_attention: { key: 'common.status.failed', tone: 'danger' },
  needs_edit: { key: 'common.status.needsReview', tone: 'warning' },
  needs_review: { key: 'sync.badge.conflict', tone: 'warning' },
  blocked: { key: 'sync.badge.blocked', tone: 'danger' },
  needs_recapture: { key: 'common.status.failed', tone: 'danger' },
};

const ACTION: Record<SyncAction, { label: string; consequence: string; icon: IconName }> = {
  retry: { label: 'field.sync.retry', consequence: 'sync.consequence.retry', icon: 'refresh' },
  edit: { label: 'field.sync.edit', consequence: 'sync.consequence.edit', icon: 'create-outline' },
  review: { label: 'sync.action.review', consequence: 'sync.consequence.review', icon: 'git-compare-outline' },
  recapture: { label: 'sync.action.recapture', consequence: 'sync.consequence.recapture', icon: 'camera-outline' },
  discard: { label: 'common.action.discard', consequence: 'sync.consequence.discard', icon: 'trash-outline' },
  sign_in: { label: 'sync.state.signIn', consequence: 'sync.consequence.signIn', icon: 'log-in-outline' },
};

export interface SyncScreenProps {
  model: SyncScreenModel;
  t: Translator;
  onSyncNow: () => void;
  onAction: (operationId: string, action: Exclude<SyncAction, 'discard'>) => void;
  /** called only after the explicit FO-14 confirmation */
  onConfirmDiscard: (operationId: string) => void;
  /** 'memory' = the queue is lost if the app closes; said plainly, never "saved on this phone" */
  durability?: 'durable' | 'memory';
  /** provenance banner (synthetic preview) from the composition root */
  banner?: ReactNode;
  /** hub-local time for timestamps in the item sheet */
  formatTime?: (at: number) => string;
  /** false while another screen is on top: the sheet and dialog are hidden so they never cover it */
  active?: boolean;
}

function rowTitle(row: SyncRow, t: Translator): string {
  if (row.titleKey === 'sync.item.punchIn') return t.t(row.titleKey, { time: row.titleParams.time ?? '' });
  // no label available (e.g. offline, task list not loaded): say what it is without a placeholder dash
  if (!row.titleParams.horse || row.titleParams.horse === '—') return t.t('sync.item.careProof');
  return t.t(row.titleKey, { horse: row.titleParams.horse, task: t.t(row.titleParams.task ?? 'care.timeline.title') });
}

/** A memory-only queue must not say "saved on this phone". */
const messageKey = (key: string, durability: 'durable' | 'memory') => (durability === 'memory' && key === 'sync.state.offline' ? 'sync.state.offlineMemory' : key);

function badgeOf(row: SyncRow) {
  if (row.state === 'acknowledged' && row.reviewRequired) return { key: 'common.status.needsReview', tone: 'warning' as StatusTone };
  return STATE_BADGE[row.state] ?? { key: 'common.status.queued', tone: 'neutral' as StatusTone };
}

export function SyncScreen({ model, t, onSyncNow, onAction, onConfirmDiscard, durability = 'durable', banner, formatTime, active = true }: SyncScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const rows = model.sections.flatMap((s) => s.rows);
  const open = rows.find((r) => r.operationId === openId) ?? null;
  const fmt = formatTime ?? ((at: number) => t.time(at, 'Asia/Kolkata'));
  const empty = model.sections.length === 0;
  const attention = model.sections.find((s) => s.key === 'needsAction')?.rows.length ?? 0;

  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="field-sync-screen">
      <View style={styles.heading}>
        <AppText variant="secondary" tone="accent" style={styles.eyebrow}>
          {t.t('common.experience.field')}
        </AppText>
        <AppText variant="title" header>
          {t.t('field.sync.title')}
        </AppText>
      </View>
      {banner}
      {/* connectivity → pending count: flat, the one dominant action below it */}
      <View style={styles.summary} testID="sync-summary-card">
          {model.pendingCount === 0 ? (
            <AppText variant="section" testID="sync-summary">
              {t.t('field.sync.allCaught')}
            </AppText>
          ) : (
            <View accessible accessibilityLabel={t.t('sync.waitingCount', { count: model.pendingCount })} style={styles.count} testID="sync-summary">
              <AppText variant="score" testID="sync-count">
                {t.number(model.pendingCount)}
              </AppText>
              <AppText variant="bodyStrong">{t.t('sync.waitingLabel')}</AppText>
            </View>
          )}
          {attention > 0 ? <StatusBadge label={t.t('sync.needsYou', { count: attention })} tone="warning" /> : null}
          {model.progress.total > 0 ? (
            <AppText variant="secondary" tone="muted">
              {t.t('sync.progress', model.progress)}
            </AppText>
          ) : null}
          <AppText variant="secondary" tone="muted" testID="sync-durability">
            {durability === 'durable' ? t.t('sync.durability.durable') : t.t('sync.durability.memory')}
          </AppText>
      </View>
      {model.canSyncNow ? <GlassButton label={t.t('sync.action.syncNow')} icon="cloud-upload-outline" onPress={onSyncNow} testID="sync-now" /> : null}
      {model.paused === 'offline' ? <StatusNote tone="info" message={t.t(messageKey('sync.state.offline', durability))} testID="sync-offline" /> : null}
      {model.paused === 'auth_required' ? <StatusNote tone="warning" message={t.t('sync.state.signIn')} /> : null}
      {model.otherAccountPending > 0 ? <StatusNote tone="info" message={t.t('sync.otherAccount', { count: model.otherAccountPending })} testID="sync-other-account" /> : null}
      {model.orphanFiles > 0 ? <StatusNote tone="warning" message={t.t('sync.orphans', { count: model.orphanFiles })} /> : null}
      {empty ? (
        <EmptyState icon="checkmark-done-outline" title={t.t('field.sync.nothing')} message={t.t('field.sync.emptyHelp')} testID="sync-empty" />
      ) : (
        model.sections.map((s) => (
          <ListGroup key={s.key} title={t.t(s.titleKey)} testID={`sync-section-${s.key}`} material={s.key === 'sent' ? 'thin' : 'regular'}>
            {s.rows.map((r) => {
              const b = badgeOf(r);
              const title = rowTitle(r, t);
              const msg = t.t(messageKey(r.messageKey, durability), r.messageParams);
              return (
                <Row
                  key={r.operationId}
                  testID={`sync-row-${r.operationId}`}
                  emphasis
                  icon={r.commandType === 'shift.punchIn' ? 'time-outline' : 'camera-outline'}
                  label={title}
                  value={`${msg} · ${t.t('sync.savedAt', { time: fmt(r.observedAt) })}`}
                  accessibilityLabel={`${title}, ${t.t(b.key)}, ${msg}`}
                  accessibilityHint={t.t('sync.rowHint')}
                  onPress={() => setOpenId(r.operationId)}
                  trailing={<StatusBadge label={t.t(b.key)} tone={b.tone} />}
                />
              );
            })}
          </ListGroup>
        ))
      )}

      {/* FO-13 Sync item */}
      <GlassBottomSheet
        visible={open !== null && active}
        onClose={() => setOpenId(null)}
        title={open ? rowTitle(open, t) : ''}
        description={open ? t.t(messageKey(open.messageKey, durability), open.messageParams) : undefined}
        testID="sync-item-sheet"
      >
        {open ? (
          <View style={{ gap: space.md }}>
            <ListGroup material="regular">
              <Row icon="flag-outline" label={t.t('sync.sheet.status')} value={t.t(badgeOf(open).key)} />
              <Row icon="phone-portrait-outline" label={t.t('sync.sheet.saved')} value={fmt(open.observedAt)} />
              {open.acknowledgedAt ? <Row icon="cloud-done-outline" label={t.t('sync.sheet.received')} value={open.receivedAt ? fmt(Date.parse(open.receivedAt)) : fmt(open.acknowledgedAt)} /> : null}
              {open.attemptCount > 0 ? <Row icon="repeat-outline" label={t.t('sync.sheet.attempts')} value={t.number(open.attemptCount)} /> : null}
              {open.lastErrorCode && open.state !== 'acknowledged' ? <Row icon="alert-circle-outline" label={t.t('sync.sheet.why')} value={t.t(messageKey(open.messageKey, durability), open.messageParams)} /> : null}
              <Row icon="key-outline" label={t.t('sync.sheet.reference')} value={open.operationId.slice(0, 8)} />
            </ListGroup>
            {open.actions.length === 0 ? (
              <AppText tone="muted" testID="sync-sheet-no-actions">
                {open.state === 'acknowledged' ? t.t('sync.consequence.none') : t.t('sync.consequence.inProgress')}
              </AppText>
            ) : null}
            {open.actions.map((a) => {
              const spec = ACTION[a];
              const consequence = a === 'review' && open.state === 'blocked' ? 'sync.consequence.reviewBlocked' : a === 'review' && open.state === 'acknowledged' ? 'sync.consequence.reviewReceipt' : spec.consequence;
              return (
                <View key={a} style={styles.action}>
                  {a === 'discard' ? (
                    <GlassButton
                      variant="destructive"
                      icon="trash-outline"
                      label={t.t(spec.label)}
                      onPress={() => {
                        const id = open.operationId;
                        setOpenId(null);
                        setConfirming(id);
                      }}
                      testID={`sync-${a}-${open.operationId}`}
                    />
                  ) : (
                    <GlassButton
                      variant="secondary"
                      icon={spec.icon}
                      label={a === 'review' && open.state !== 'acknowledged' ? t.t('field.sync.reviewConflict') : t.t(spec.label)}
                      onPress={() => {
                        const id = open.operationId;
                        setOpenId(null);
                        onAction(id, a);
                      }}
                      testID={`sync-${a}-${open.operationId}`}
                    />
                  )}
                  <AppText variant="secondary" tone="muted">
                    {t.t(consequence)}
                  </AppText>
                </View>
              );
            })}
          </View>
        ) : null}
      </GlassBottomSheet>

      {/* FO-14 Discard queued item: destructive, icon + words, Cancel first */}
      <GlassDialog
        visible={confirming !== null && active}
        onClose={() => setConfirming(null)}
        title={t.t('sync.discard.title')}
        message={plain(t.t('field.sync.discardWarning'))}
        testID="discard-confirm"
        actions={
          <>
            <GlassButton variant="secondary" label={t.t('common.action.cancel')} testID="discard-confirm-no" onPress={() => setConfirming(null)} />
            <GlassButton
              variant="destructive"
              icon="trash-outline"
              label={t.t('sync.discard.confirm')}
              testID="discard-confirm-yes"
              onPress={() => {
                const id = confirming;
                setConfirming(null);
                if (id) onConfirmDiscard(id);
              }}
            />
          </>
        }
      />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: space.xs },
  eyebrow: { fontWeight: '600' },
  summary: { gap: space.xs },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  action: { gap: space.xs },
});
