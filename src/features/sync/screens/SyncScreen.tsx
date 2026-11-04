// W07 Sync centre. Pure presentation over SyncScreenModel; actions are passed in by the composition root.
// Not yet mounted at src/app/(authenticated)/field/sync.tsx (G2 owns that route; mounting waits for G3 auth).
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Badge, Button, Card, EmptyState, Screen, Section, StatusMessage } from '@/ui/components';
import type { Translator } from '@/features/care/i18n/i18n';
import { plain } from '@/features/care/i18n/i18n';
import type { SyncAction, SyncRow, SyncScreenModel } from '../domain/syncViewModel';
import type { QueueState } from '../domain/types';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
const STATE_BADGE: Partial<Record<QueueState, { key: string; tone: Tone }>> = {
  ready: { key: 'common.status.queued', tone: 'neutral' },
  capturing: { key: 'common.status.queued', tone: 'neutral' },
  retry_wait: { key: 'common.status.waiting', tone: 'warning' },
  leased: { key: 'common.status.uploading', tone: 'info' },
  uploading: { key: 'common.status.uploading', tone: 'info' },
  submitting: { key: 'common.status.uploading', tone: 'info' },
  acknowledged: { key: 'common.status.received', tone: 'success' },
  needs_attention: { key: 'common.status.failed', tone: 'danger' },
  needs_edit: { key: 'common.status.needsReview', tone: 'warning' },
  needs_review: { key: 'common.status.needsReview', tone: 'warning' },
  blocked: { key: 'common.status.failed', tone: 'danger' },
  needs_recapture: { key: 'common.status.failed', tone: 'danger' },
};

const ACTION_LABEL: Record<SyncAction, string> = {
  retry: 'field.sync.retry',
  edit: 'field.sync.edit',
  review: 'sync.action.review',
  recapture: 'sync.action.recapture',
  discard: 'common.action.discard',
  sign_in: 'sync.state.signIn',
};

export interface SyncScreenProps {
  model: SyncScreenModel;
  t: Translator;
  onSyncNow: () => void;
  onAction: (operationId: string, action: Exclude<SyncAction, 'discard'>) => void;
  /** called only after the explicit confirmation step below */
  onConfirmDiscard: (operationId: string) => void;
}

function SyncItem({ row, t, onAction, onAskDiscard }: { row: SyncRow; t: Translator; onAction: SyncScreenProps['onAction']; onAskDiscard: (id: string) => void }) {
  const badge = STATE_BADGE[row.state] ?? { key: 'common.status.queued', tone: 'neutral' as Tone };
  const title = t.t(row.titleKey, { horse: row.titleParams.horse ?? '', task: t.t(row.titleParams.task ?? 'care.timeline.title') });
  return (
    <Card testID={`sync-row-${row.operationId}`}>
      <View style={{ gap: 6 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <Badge label={t.t(badge.key)} tone={badge.tone} />
        <AppText tone="muted">{t.t(row.messageKey, row.messageParams)}</AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {row.actions.map((a) =>
          a === 'discard' ? (
            <Button key={a} label={t.t(ACTION_LABEL[a])} variant="ghost" onPress={() => onAskDiscard(row.operationId)} testID={`sync-${a}-${row.operationId}`} />
          ) : (
            <Button key={a} label={t.t(ACTION_LABEL[a])} variant="secondary" onPress={() => onAction(row.operationId, a)} testID={`sync-${a}-${row.operationId}`} />
          ),
        )}
      </View>
    </Card>
  );
}

export function SyncScreen({ model, t, onSyncNow, onAction, onConfirmDiscard }: SyncScreenProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const empty = model.sections.length === 0;
  return (
    <Screen testID="field-sync-screen">
      <AppText variant="title" header>
        {t.t('field.sync.title')}
      </AppText>
      <AppText tone="muted" testID="sync-summary">
        {model.pendingCount === 0 ? t.t('field.sync.allCaught') : t.t('field.sync.summaryWaiting', { count: model.pendingCount })}
      </AppText>
      {model.progress.total > 0 ? <AppText tone="muted">{t.t('sync.progress', model.progress)}</AppText> : null}
      {model.paused === 'offline' ? <StatusMessage tone="info" message={t.t('sync.state.offline')} /> : null}
      {model.paused === 'auth_required' ? <StatusMessage tone="warning" message={t.t('sync.state.signIn')} /> : null}
      {model.otherAccountPending > 0 ? <StatusMessage tone="info" message={t.t('sync.otherAccount', { count: model.otherAccountPending })} /> : null}
      {model.orphanFiles > 0 ? <StatusMessage tone="warning" message={t.t('sync.orphans', { count: model.orphanFiles })} /> : null}
      {confirming ? (
        <Card testID="discard-confirm">
          <AppText variant="bodyStrong">{t.t('sync.discard.title')}</AppText>
          <AppText>{plain(t.t('field.sync.discardWarning'))}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label={t.t('sync.discard.confirm')} variant="danger" testID="discard-confirm-yes" onPress={() => { const id = confirming; setConfirming(null); onConfirmDiscard(id); }} />
            <Button label={t.t('common.action.cancel')} variant="secondary" testID="discard-confirm-no" onPress={() => setConfirming(null)} />
          </View>
        </Card>
      ) : null}
      {empty ? (
        <EmptyState icon="checkmark-done-outline" title={t.t('field.sync.nothing')} message={t.t('field.sync.emptyHelp')} testID="sync-empty" />
      ) : (
        model.sections.map((s) => (
          <Section key={s.key} title={t.t(s.titleKey)} testID={`sync-section-${s.key}`}>
            {s.rows.map((r) => (
              <SyncItem key={r.operationId} row={r} t={t} onAction={onAction} onAskDiscard={setConfirming} />
            ))}
          </Section>
        ))
      )}
      {model.canSyncNow ? <Button label={t.t('sync.action.syncNow')} size="field" fullWidth onPress={onSyncNow} testID="sync-now" /> : null}
    </Screen>
  );
}
