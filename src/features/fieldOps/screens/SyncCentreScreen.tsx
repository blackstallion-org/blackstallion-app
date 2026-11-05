// FO-12 Sync centre composition: the G5 outbox of the signed-in person (never another account's items, only their
// count), labels from the care timeline, and the FO-13/FO-14 actions wired to the outbox and the right screens.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { useAccess } from '@/features/identity/AccessProvider';
import { buildSyncScreenModel } from '@/features/sync/domain/syncViewModel';
import type { SyncAction } from '@/features/sync/domain/syncViewModel';
import { SyncScreen } from '@/features/sync/screens/SyncScreen';

import type { FieldOpsRepositories, OutboxOwner } from '../data/repositories';
import { isConflictState } from '../domain/conflict';
import { addDays, localDateIn } from '../domain/horses';
import type { FieldOpsScope } from '../domain/types';
import { shown, useFieldOps, useFieldOpsT, useFieldResource, useOutbox, useScreenFocused } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { NotConnected, Provenance } from './parts';

export function SyncCentreRoute() {
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const { reload } = useAccess();
  if (!ctx.repos) return <NotConnected t={t} testID="field-sync-screen" />;
  return (
    <SyncCentreView
      repos={ctx.repos}
      scope={ctx.scope}
      owner={ctx.owner}
      contextKey={ctx.contextKey}
      t={t}
      onOpenTask={(id) => router.push({ pathname: '/field/horses/care/[taskId]', params: { taskId: id } })}
      onOpenShift={() => router.push('/field/shift')}
      onOpenConflict={(id) => router.push({ pathname: '/field/sync/conflict/[itemId]', params: { itemId: id } })}
      onSignIn={reload}
    />
  );
}

export function SyncCentreView({
  repos,
  scope,
  owner,
  contextKey,
  t,
  now = Date.now,
  onOpenTask,
  onOpenShift,
  onOpenConflict,
  onSignIn,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  owner: OutboxOwner;
  contextKey: string;
  t: Translator;
  now?: () => number;
  onOpenTask: (occurrenceId: string) => void;
  onOpenShift: () => void;
  onOpenConflict: (operationId: string) => void;
  onSignIn: () => void;
}) {
  const { items, otherAccountPending, online } = useOutbox(repos.outbox, owner);
  const focused = useScreenFocused();
  const today = localDateIn(now(), 'Asia/Kolkata');
  // labels only; the queue itself is local and needs no server read
  const labels = useFieldResource(`${contextKey}:fo:syncLabels:${today}`, async () => {
    const [horses, timeline] = await Promise.all([repos.horses.listHorses(scope).catch(() => []), repos.care.timeline(scope, addDays(today, -7), today).catch(() => null)]);
    return { horses, occurrences: timeline && timeline.kind === 'ok' ? timeline.occurrences : [] };
  });
  useFocusEffect(
    useCallback(() => {
      void repos.outbox.drain();
    }, [repos.outbox]),
  );
  const lab = shown(labels)?.data;
  const model = useMemo(
    () =>
      buildSyncScreenModel({
        items,
        now: now(),
        formatTime: (at) => t.time(at, 'Asia/Kolkata'),
        label: (aggregateId) => {
          const occ = lab?.occurrences.find((o) => o.occurrenceId === aggregateId);
          if (occ) return { horse: occ.horseName, taskKey: `care.taskType.${occ.taskType}` };
          const it = items.find((i) => i.aggregateId === aggregateId);
          const horseId = typeof it?.payload.horseId === 'string' ? it.payload.horseId : null;
          const h = horseId ? lab?.horses.find((x) => x.horseId === horseId) : null;
          return h ? { horse: h.name, taskKey: 'care.timeline.title' } : null;
        },
        otherAccountPending,
        orphanFiles: 0,
        online,
      }),
    [items, lab, otherAccountPending, online, now, t],
  );

  const onAction = (operationId: string, action: Exclude<SyncAction, 'discard'>) => {
    const it = items.find((i) => i.operationId === operationId);
    if (!it) return;
    const openRecord = () => (it.commandType === 'shift.punchIn' ? onOpenShift() : onOpenTask(it.aggregateId));
    switch (action) {
      case 'retry':
        repos.outbox.retry(owner, operationId);
        return;
      case 'sign_in':
        onSignIn();
        return;
      case 'review':
        if (isConflictState(it.state)) onOpenConflict(operationId);
        else openRecord();
        return;
      case 'edit':
      case 'recapture':
        if (it.state === 'needs_edit') onOpenConflict(operationId);
        else openRecord();
        return;
    }
  };

  return (
    <SyncScreen
      model={model}
      t={t}
      durability={repos.outbox.durability}
      active={focused}
      banner={<Provenance source={repos.source} t={t} />}
      formatTime={(at) => t.time(at, 'Asia/Kolkata')}
      onSyncNow={() => void repos.outbox.drain()}
      onAction={onAction}
      onConfirmDiscard={(id) => void repos.outbox.discard(owner, id)}
    />
  );
}
