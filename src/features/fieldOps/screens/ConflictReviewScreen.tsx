// FO-15 Conflict review: the local copy and the academy's current record side by side, what the conflict means, and
// the only allowed paths. Nothing here overwrites the academy's record; "send as new" creates a separate record that a
// supervisor reviews.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { GlassButton, GlassDialog, GlassScreen, ListGroup, Row, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories, OutboxOwner } from '../data/repositories';
import { conflictView, type ConflictPath } from '../domain/conflict';
import { formatAccuracy } from '../domain/evidence';
import { addDays, findOccurrence, localDateIn } from '../domain/horses';
import type { FieldOpsScope } from '../domain/types';
import { backOr, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { NotConnected, Provenance, ResourceGate } from './parts';

export function ConflictReviewRoute() {
  const params = useLocalSearchParams<{ itemId?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field/sync');
  if (!ctx.repos) return <NotConnected t={t} header={{ onBack: back, title: t.t('fo.conflict.title') }} testID="fo15-conflict" />;
  const itemId = typeof params.itemId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(params.itemId) ? params.itemId : '';
  return (
    <ConflictReviewView
      repos={ctx.repos}
      scope={ctx.scope}
      owner={ctx.owner}
      contextKey={ctx.contextKey}
      itemId={itemId}
      t={t}
      onBack={back}
      onDone={() => router.replace('/field/sync')}
      onOpenShift={() => router.push('/field/shift')}
    />
  );
}

export function ConflictReviewView({
  repos,
  scope,
  owner,
  contextKey,
  itemId,
  t,
  now = Date.now,
  onBack,
  onDone,
  onOpenShift,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  owner: OutboxOwner;
  contextKey: string;
  itemId: string;
  t: Translator;
  now?: () => number;
  onBack: () => void;
  onDone: () => void;
  onOpenShift: () => void;
}) {
  // owner-scoped read: another account's item is simply not found
  useOutbox(repos.outbox, owner);
  const item = itemId ? repos.outbox.get(owner, itemId) : null;
  const today = localDateIn(now(), 'Asia/Kolkata');
  const server = useFieldResource(item ? `${contextKey}:fo:conflict:${itemId}` : null, async () => {
    if (item!.commandType === 'shift.punchIn') return { occurrence: null, shift: await repos.shift.status(scope) };
    const tl = await repos.care.timeline(scope, addDays(today, -7), addDays(today, 1));
    return { occurrence: findOccurrence(tl, item!.aggregateId), shift: null };
  });
  const [confirmKeep, setConfirmKeep] = useState(false);
  const header = { onBack, title: t.t('fo.conflict.title'), backLabel: t.t('fo.common.back') };

  if (!item) {
    return (
      <GlassScreen header={header} testID="fo15-conflict">
        <UnavailableState title={t.t('fo.conflict.goneTitle')} message={t.t('fo.conflict.gone')} testID="fo15-gone" />
      </GlassScreen>
    );
  }
  const p = item.payload as { observedAt?: string; location?: { accuracyM?: number | null } | null };
  const localAcc = formatAccuracy(p.location?.accuracyM ?? null) ?? t.t('fo.location.none');

  const act = async (path: ConflictPath) => {
    if (path === 'send_as_new') {
      if (repos.outbox.sendAsNew(owner, item.operationId)) onDone();
    } else if (path === 'keep_server') setConfirmKeep(true);
    else if (path === 'open_shift') onOpenShift();
    else onBack();
  };

  return (
    <GlassScreen header={header} testID="fo15-conflict">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={server} t={t} loadingLabel={t.t('fo.conflict.loading')} testIDPrefix="fo15">
        {(srv) => {
          const v = conflictView(item, srv);
          const occ = srv.occurrence;
          return (
            <View style={{ gap: space.lg }}>
              <StatusNote tone="warning" title={t.t('fo.conflict.heading')} message={t.t(v.explanationKey)} testID="fo15-explanation" />
              <View style={styles.sides}>
                <ListGroup title={t.t('fo.conflict.phone')} testID="fo15-local">
                  <Row icon={item.commandType === 'shift.punchIn' ? 'time-outline' : 'camera-outline'} label={item.commandType === 'shift.punchIn' ? t.t('fo.conflict.punchIn') : t.t('fo.conflict.photo')} value={t.t('fo.conflict.takenAt', { time: t.time(item.observedAt, 'Asia/Kolkata') })} />
                  <Row icon="locate-outline" label={t.t('fo.shift.accuracy')} value={localAcc} />
                  <Row icon="alert-circle-outline" label={t.t('fo.conflict.serverSaid')} value={t.t(v.explanationKey === 'fo.conflict.unknown' ? 'fo.conflict.answerUnknown' : 'fo.conflict.answerConflict')} />
                </ListGroup>
                <ListGroup title={t.t('fo.conflict.academy')} testID="fo15-server">
                  {item.commandType === 'shift.punchIn' ? (
                    srv.shift?.open ? (
                      <Row icon="time-outline" label={t.t('fo.conflict.openShift')} value={t.time(Date.parse(srv.shift.open.punchInAt), 'Asia/Kolkata')} trailing={<StatusBadge label={t.t('fo.conflict.kept')} tone="info" />} />
                    ) : (
                      <Row icon="time-outline" label={t.t('fo.conflict.noOpenShift')} />
                    )
                  ) : occ ? (
                    <>
                      <Row icon="leaf-outline" label={`${occ.horseName} · ${t.t(`care.taskType.${occ.taskType}`)}`} value={t.t('care.timeline.dueAt', { time: t.time(occ.dueAt, occ.timezone) })} />
                      <Row
                        icon="cloud-done-outline"
                        label={t.t(`fo.conflict.occ.${occ.status}`)}
                        value={occ.latestSubmissionState ? t.t(`fo.conflict.sub.${occ.latestSubmissionState}`) : t.t('fo.conflict.sub.none')}
                        trailing={<StatusBadge label={t.t('fo.conflict.kept')} tone="info" />}
                      />
                    </>
                  ) : (
                    <Row icon="help-circle-outline" label={t.t('fo.conflict.noTask')} />
                  )}
                </ListGroup>
              </View>
              <AppText tone="muted">{t.t('fo.conflict.noOverwrite')}</AppText>
              {v.paths.map((path) => (
                <View key={path} style={styles.path}>
                  {path === 'keep_server' ? (
                    <GlassButton variant="destructive" icon="trash-outline" label={t.t('fo.conflict.path.keep_server')} onPress={() => act(path)} testID={`fo15-${path}`} />
                  ) : (
                    <GlassButton
                      variant={path === 'later' ? 'ghost' : path === v.paths[0] ? 'primary' : 'secondary'}
                      icon={path === 'send_as_new' ? 'duplicate-outline' : path === 'open_shift' ? 'time-outline' : 'time'}
                      label={t.t(`fo.conflict.path.${path}`)}
                      onPress={() => act(path)}
                      testID={`fo15-${path}`}
                    />
                  )}
                  <AppText variant="secondary" tone="muted">
                    {t.t(`fo.conflict.pathBody.${path}`)}
                  </AppText>
                </View>
              ))}
            </View>
          );
        }}
      </ResourceGate>
      <GlassDialog
        visible={confirmKeep}
        onClose={() => setConfirmKeep(false)}
        title={t.t('sync.discard.title')}
        message={t.t('field.sync.discardWarning')}
        testID="fo15-discard-dialog"
        actions={
          <>
            <GlassButton variant="secondary" label={t.t('common.action.cancel')} onPress={() => setConfirmKeep(false)} testID="fo15-discard-cancel" />
            <GlassButton
              variant="destructive"
              icon="trash-outline"
              label={t.t('sync.discard.confirm')}
              onPress={async () => {
                setConfirmKeep(false);
                await repos.outbox.discard(owner, item.operationId);
                onDone();
              }}
              testID="fo15-discard-confirm"
            />
          </>
        }
      />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  sides: { gap: space.lg },
  path: { gap: space.xs },
});
