// JS render tests (jest-expo). They check translated text, actions and the discard confirmation; they do NOT prove
// native layout at large text sizes (that needs a device or simulator screenshot pass).
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/ui/theme/ThemeProvider';
import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { createTranslator, type Locale } from '@/features/care/i18n/i18n';
import { buildCareTimeline } from '@/features/care/domain/timeline';
import { CareTimelineScreen } from '@/features/care/screens/CareTimelineScreen';
import { buildSyncScreenModel } from '../domain/syncViewModel';
import { SyncScreen } from '../screens/SyncScreen';
import type { QueueItem } from '../domain/types';

const T0 = Date.parse('2026-11-04T06:00:00Z');
const item = (op: string, state: QueueItem['state'], extra: Partial<QueueItem> = {}): QueueItem => ({
  operationId: op, actorId: 'a', hubId: 'h', aggregateId: `occ-${op}`, commandType: 'care.submitEvidence', payloadVersion: 1, payload: {},
  payloadHash: 'x', dependencyIds: [], localFileRefs: ['f'], state, attemptCount: 0, nextAttemptAt: null, leaseOwner: null, leaseUntil: null,
  createdAt: T0, observedAt: T0, updatedAt: T0, acknowledgedAt: null, lastErrorCode: null, lastErrorDetail: null,
  upload: { mediaPath: null, done: false }, serverReceipt: null, ...extra,
});

async function renderSync(locale: Locale, items: QueueItem[], extra: { otherAccountPending?: number } = {}) {
  const t = createTranslator(locale);
  const model = buildSyncScreenModel({ items, now: T0, formatTime: (x) => t.time(x, 'Asia/Kolkata'), label: () => ({ horse: 'Toofan', taskKey: 'care.taskType.water' }),
    otherAccountPending: extra.otherAccountPending ?? 0, orphanFiles: 0, online: true });
  const calls = { discard: [] as string[], action: [] as string[] };
  await render(
    <ThemeProvider store={createMemoryStore()}>
      <SyncScreen model={model} t={t} onSyncNow={() => undefined} onAction={(id, a) => calls.action.push(`${a}:${id}`)} onConfirmDiscard={(id) => calls.discard.push(id)} />
    </ThemeProvider>,
  );
  return { t, calls };
}

describe('Sync screen (rendered)', () => {
  test.each(['en', 'hi', 'te'] as const)('S01 %s: statuses, messages and actions are translated; nothing untranslated', async (locale) => {
    const { t } = await renderSync(locale, [item('blk', 'blocked', { lastErrorCode: 'access_revoked' }), item('rw', 'retry_wait', { nextAttemptAt: T0 + 120_000 })], { otherAccountPending: 2 });
    expect(await screen.findByText(t.t('sync.state.blocked'))).toBeTruthy();
    expect(screen.getByText(t.t('sync.otherAccount', { count: 2 }))).toBeTruthy();
    expect(screen.getAllByText(t.t('field.sync.careItem', { horse: 'Toofan', task: t.t('care.taskType.water') }))).toHaveLength(2);
    expect(screen.getAllByText(t.t('common.action.discard')).length).toBe(2);
    expect(t.missing.size).toBe(0);
  });

  test('S02 discard needs an explicit second step that states the consequence', async () => {
    const { calls } = await renderSync('en', [item('x', 'needs_recapture')]);
    await fireEvent.press(await screen.findByTestId('sync-discard-x'));
    expect(calls.discard).toEqual([]);
    expect(screen.getByText('Discarding deletes this work from the phone. It was never sent.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('discard-confirm-no'));
    expect(calls.discard).toEqual([]);
    await fireEvent.press(screen.getByTestId('sync-discard-x'));
    await fireEvent.press(screen.getByTestId('discard-confirm-yes'));
    expect(calls.discard).toEqual(['x']);
  });

  test('S03 empty queue shows the explanatory empty state', async () => {
    await renderSync('te', []);
    expect(await screen.findByTestId('sync-empty')).toBeTruthy();
  });
});

describe('Care timeline (rendered)', () => {
  const occ = { occurrenceId: 'm1', horseId: 'f1', horseName: 'Toofan', taskType: 'medication' as const, slotKey: 'night_med', localDate: '2026-11-04',
    dueAt: Date.parse('2026-11-04T18:20:00Z'), timezone: 'Asia/Kolkata', instructions: 'Give 1 sachet as prescribed', status: 'pending' as const,
    scheduleVersion: 1, latestSubmissionState: null, overdue: false };

  test.each(['en', 'hi', 'te'] as const)('T01 %s: horse, task, due time in hub tz, medication notice, instructions', async (locale) => {
    const t = createTranslator(locale);
    await render(
      <ThemeProvider store={createMemoryStore()}>
        <CareTimelineScreen days={buildCareTimeline([occ], [], T0)} t={t} staleSince={null} offlineEvidenceAllowed onCapture={() => undefined} />
      </ThemeProvider>,
    );
    expect(await screen.findByText(`Toofan · ${t.t('care.taskType.medication')}`)).toBeTruthy();
    expect(screen.getByText(t.t('care.timeline.dueAt', { time: t.time(occ.dueAt, 'Asia/Kolkata') }))).toBeTruthy();
    expect(screen.getByText(t.t('care.medication.notice'))).toBeTruthy();
    expect(screen.getByText('Give 1 sachet as prescribed')).toBeTruthy();
  });

  test('T02 capture is replaced by an explanation while offline evidence is not allowed', async () => {
    const t = createTranslator('en');
    await render(
      <ThemeProvider store={createMemoryStore()}>
        <CareTimelineScreen days={buildCareTimeline([occ], [], T0)} t={t} staleSince={null} offlineEvidenceAllowed={false} onCapture={() => undefined} />
      </ThemeProvider>,
    );
    expect(await screen.findByTestId('care-capture-blocked-m1')).toBeTruthy();
    expect(screen.queryByTestId('care-capture-m1')).toBeNull();
  });
});
