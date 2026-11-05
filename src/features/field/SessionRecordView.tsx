import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useScopedResource } from '@/core/data/useScopedResource';
import { dateLabel } from '@/core/format/hubTime';
import { AppText } from '@/ui/components';
import { GlassButton, GlassInput, GlassScreen, GlassSurface, ListGroup, LoadingState, Row, ScoreTile, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { LoadFailure } from './components/LoadStates';
import { PublicationSeal } from './components/PublicationSeal';
import { ReasonSheet } from './components/ReasonSheet';
import { ScoreStepper } from './components/ScoreStepper';
import type { FieldCommandRepository, Scores, SessionRecord, Skill } from './data/repositories';
import { codePointLength, correctionChanges, correctionPayloadKey, NOTES_MAX, SCORE_KEYS, type CorrectionValues } from './domain/assessment';
import { toCommandError, type FieldCommandError } from './domain/commandErrors';
import { latchOperation, newOperationId, type OperationLatch } from './domain/operation';
import { useFieldStrings } from './i18n';
import { commandMessage } from './useCheckIn';
import { useFieldAccess } from './useFieldAccess';

type Mode =
  | { kind: 'read' }
  | { kind: 'editing'; values: CorrectionValues; expectedVersion: number }
  | { kind: 'saving'; values: CorrectionValues; expectedVersion: number }
  | { kind: 'saved'; version: number }
  | { kind: 'conflict'; values: CorrectionValues; serverVersion: number | null }
  | { kind: 'error'; values: CorrectionValues; expectedVersion: number; error: FieldCommandError; reason: string };

const valuesOf = (r: SessionRecord): CorrectionValues | null => (r.scores ? { ...r.scores, notes: r.notes } : null);

function ScoresPanel({ scores, testID }: { scores: Scores | null; testID?: string }) {
  const s = useFieldStrings();
  return (
    <View style={styles.tiles} testID={testID}>
      {SCORE_KEYS.map((k) => (
        <ScoreTile key={k} label={s.t(`scores.${k}`)} value={scores?.[k] ?? null} />
      ))}
    </View>
  );
}

export type SessionRecordViewProps = {
  record: SessionRecord;
  /** Fetches the server's current version (after a save or a conflict). */
  fetchLatest: () => Promise<SessionRecord>;
  skills: readonly Skill[];
  /** UX only: the recording instructor (Q8 default). The server decides (42501 otherwise). */
  canCorrect: boolean;
  commands?: FieldCommandRepository;
  onBack: () => void;
  makeId?: () => string;
};

/**
 * FO-03 for a published record: read mode with "Make a correction". A correction sends the full values with the
 * version that was loaded and a required reason (FO-16). If the server has a newer version (PT409), nothing is
 * overwritten: the latest server values are shown next to the instructor's, who decides again. The saved state
 * appears only after the server's receipt.
 */
export function SessionRecordView({ record: initial, fetchLatest, skills, canCorrect, commands, onBack, makeId = newOperationId }: SessionRecordViewProps) {
  const s = useFieldStrings();
  const [record, setRecord] = useState(initial);
  const [mode, setMode] = useState<Mode>({ kind: 'read' });
  const [askReason, setAskReason] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const latch = useRef<OperationLatch | null>(null);
  const base = valuesOf(record);

  const reload = async () => {
    try {
      const r = await fetchLatest();
      setRecord(r);
      setReloadFailed(false);
      return r;
    } catch {
      setReloadFailed(true);
      return null;
    }
  };

  const send = async (values: CorrectionValues, expectedVersion: number, reason: string) => {
    if (!commands) return;
    latch.current = latchOperation(latch.current, correctionPayloadKey(record.id, expectedVersion, values, reason), makeId);
    setMode({ kind: 'saving', values, expectedVersion });
    try {
      const r = await commands.correct({ sessionId: record.id, expectedVersion, scores: { riding: values.riding, ground: values.ground, stable: values.stable }, notes: values.notes, reason, operationId: latch.current.operationId });
      latch.current = null;
      setMode({ kind: 'saved', version: r.version });
      void reload();
    } catch (e) {
      const ce = toCommandError(e, 'correct');
      if (!ce.retryable) latch.current = null;
      if (ce.kind === 'conflict' && ce.serverVersion !== undefined) {
        setMode({ kind: 'conflict', values, serverVersion: ce.serverVersion });
        void reload();
      } else setMode({ kind: 'error', values, expectedVersion, error: ce, reason });
    }
  };

  const header = { title: record.cadetName, onBack, backLabel: s.t('common.back') };
  const skillNames = record.skillIds.map((id) => skills.find((k) => k.id === id)?.name).filter((x): x is string => !!x);

  if (mode.kind === 'editing' || mode.kind === 'saving' || (mode.kind === 'error' && mode.error.retryable)) {
    const v = mode.values;
    const frozen = mode.kind !== 'editing';
    const edit = (patch: Partial<CorrectionValues>) => {
      if (mode.kind !== 'editing') return;
      setUnchanged(false);
      setMode({ ...mode, values: { ...mode.values, ...patch } });
    };
    const retryable = mode.kind === 'error';
    return (
      <GlassScreen
        header={header}
        keyboard
        testID="field-correct"
        footer={
          <View style={styles.footer}>
            <GlassButton
              size="large"
              icon="create-outline"
              label={retryable ? s.t('assess.correct.retry') : s.t('assess.correct.save')}
              loading={mode.kind === 'saving'}
              onPress={() => {
                if (mode.kind === 'error') return send(mode.values, mode.expectedVersion, mode.reason);
                if (!base || !correctionChanges(base, v)) return setUnchanged(true);
                setAskReason(true);
              }}
              testID="correct-submit"
            />
          </View>
        }
      >
        <AppText variant="title" header>
          {s.t('assess.correct.title')}
        </AppText>
        <AppText tone="muted">{s.t('assess.correct.body')}</AppText>
        <StatusBadge label={s.t('assess.record.version', { version: mode.kind === 'error' ? mode.expectedVersion : mode.expectedVersion })} tone="neutral" icon="git-branch-outline" />
        <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.pad, styles.gap]}>
          {SCORE_KEYS.map((k) => (
            <ScoreStepper key={k} k={k} value={v[k]} disabled={frozen} onChange={(x) => edit({ [k]: x })} />
          ))}
        </GlassSurface>
        <GlassInput
          label={s.t('assess.notesLabel')}
          hint={s.t('assess.notesCount', { count: codePointLength((v.notes ?? '').trim()), max: NOTES_MAX })}
          value={v.notes ?? ''}
          onChangeText={(t) => edit({ notes: t })}
          multiline
          editable={!frozen}
          maxLength={NOTES_MAX * 2}
          testID="correct-notes"
        />
        {unchanged ? <StatusNote tone="info" message={s.t('assess.correct.unchanged')} testID="correct-unchanged" /> : null}
        {mode.kind === 'error' ? <StatusNote tone="danger" message={commandMessage(mode.error, s)} testID="correct-error" /> : null}
        {mode.kind === 'editing' ? <GlassButton variant="ghost" label={s.t('assess.correct.cancel')} onPress={() => setMode({ kind: 'read' })} testID="correct-cancel" /> : null}
        <ReasonSheet
          visible={askReason}
          title={s.t('reason.correctionTitle')}
          description={s.t('reason.correctionBody')}
          submitLabel={s.t('reason.submit')}
          onCancel={() => setAskReason(false)}
          onSubmit={(reason) => {
            setAskReason(false);
            if (mode.kind === 'editing') void send(mode.values, mode.expectedVersion, reason);
          }}
        />
      </GlassScreen>
    );
  }

  return (
    <GlassScreen header={header} testID="field-record">
      {mode.kind === 'saved' ? (
        <PublicationSeal title={s.t('assess.correct.done')} caption={s.t('assess.correct.doneBody', { version: mode.version })} testID="correct-done" />
      ) : null}
      {mode.kind === 'conflict' ? (
        <View style={styles.gap} testID="correct-conflict">
          <StatusNote tone="warning" title={s.t('assess.conflict.title')} message={s.t('assess.conflict.body', { version: mode.serverVersion ?? record.version })} />
          <View style={styles.compare}>
            <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.pad, styles.gap]} style={styles.compareCol}>
              <AppText variant="label">{s.t('assess.conflict.server', { version: record.version })}</AppText>
              <ScoresPanel scores={record.scores} testID="conflict-server" />
              <AppText variant="secondary" tone="muted">
                {record.notes ?? s.t('assess.record.noNotes')}
              </AppText>
            </GlassSurface>
            <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.pad, styles.gap]} style={styles.compareCol}>
              <AppText variant="label">{s.t('assess.conflict.yours')}</AppText>
              <ScoresPanel scores={mode.values} testID="conflict-mine" />
              <AppText variant="secondary" tone="muted">
                {mode.values.notes?.trim() || s.t('assess.record.noNotes')}
              </AppText>
            </GlassSurface>
          </View>
          {reloadFailed ? <StatusNote tone="danger" message={s.t('assess.conflict.reloadFailed')} /> : null}
          <GlassButton
            size="large"
            icon="refresh"
            label={s.t('assess.conflict.reapply')}
            disabled={reloadFailed || (mode.serverVersion !== null && record.version !== mode.serverVersion)}
            onPress={() => setMode({ kind: 'editing', values: mode.values, expectedVersion: record.version })}
            testID="conflict-reapply"
          />
          <GlassButton variant="secondary" icon="close" label={s.t('assess.conflict.discard')} onPress={() => setMode({ kind: 'read' })} testID="conflict-discard" />
          {reloadFailed ? <GlassButton variant="ghost" icon="refresh" label={s.t('common.retry')} onPress={() => void reload()} /> : null}
        </View>
      ) : null}
      {mode.kind === 'error' ? <StatusNote tone="danger" message={commandMessage(mode.error, s)} testID="correct-error" /> : null}

      <View style={styles.gap}>
        <AppText variant="title" header>
          {dateLabel(record.sessionDate)}
        </AppText>
        <View style={styles.badges}>
          {record.published ? <StatusBadge label={s.t('assess.record.published')} tone="success" icon="ribbon-outline" /> : <StatusBadge label={s.t('assess.record.legacy')} tone="neutral" />}
          <StatusBadge label={s.t('assess.record.version', { version: record.version })} tone="neutral" icon="git-branch-outline" testID="record-version" />
          {record.version > 1 ? <StatusBadge label={s.t('assess.record.corrected')} tone="info" icon="create-outline" /> : null}
        </View>
      </View>
      <GlassSurface material="regular" borderRadius={radius.card} contentStyle={[styles.pad, styles.gap]}>
        <ScoresPanel scores={record.scores} testID="record-scores" />
        {skillNames.length > 0 ? (
          <View style={styles.badges}>
            {skillNames.map((n) => (
              <StatusBadge key={n} label={n} tone="success" />
            ))}
          </View>
        ) : null}
        <AppText tone={record.notes ? 'default' : 'muted'}>{record.notes ?? s.t('assess.record.noNotes')}</AppText>
        {record.hasClip ? <StatusBadge label={s.t('assess.record.clip')} tone="neutral" icon="videocam-outline" /> : null}
      </GlassSurface>
      {mode.kind !== 'conflict' ? (
        canCorrect && commands && base ? (
          <GlassButton variant="secondary" icon="create-outline" label={s.t('assess.record.makeCorrection')} onPress={() => setMode({ kind: 'editing', values: base, expectedVersion: record.version })} testID="make-correction" />
        ) : (
          <StatusNote tone="info" message={s.t('assess.record.notRecorder')} testID="correct-not-allowed" />
        )
      ) : null}
      {record.corrections.length > 0 ? (
        <ListGroup title={s.t('assess.record.history')} testID="correction-history">
          {record.corrections.map((c) => (
            <Row
              key={c.id}
              icon="time-outline"
              label={s.t('assess.record.historyRow', { version: c.versionBefore + 1, date: dateLabel(c.correctedAt.slice(0, 10)) })}
              value={`${c.reason}\n${s.t('assess.record.previous', { riding: c.previous.riding, ground: c.previous.ground, stable: c.previous.stable })}`}
            />
          ))}
        </ListGroup>
      ) : null}
    </GlassScreen>
  );
}

/** Loads the record, the skill names and decides whether this person may correct it. */
export function SessionRecordScreen({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const s = useFieldStrings();
  const { scope, contextKey, fieldApp, commands } = useFieldAccess();
  const rec = useScopedResource(`${contextKey}:record:${sessionId}`, () =>
    fieldApp ? fieldApp.sessions.record(scope, sessionId) : Promise.reject(new Error('unconnected')),
  );
  const skills = useScopedResource(`${contextKey}:skills`, () => (fieldApp ? fieldApp.sessions.skills(scope) : Promise.resolve([])));
  const header = { title: s.t('assess.record.title'), onBack, backLabel: s.t('common.back') };
  if (!fieldApp) {
    return (
      <GlassScreen header={header} testID="field-record">
        <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('common.notConnected')} />
      </GlassScreen>
    );
  }
  if (rec.status !== 'ready') {
    return (
      <GlassScreen header={header} testID="field-record">
        {rec.status === 'loading' ? <LoadingState label={s.t('assess.loading')} /> : <LoadFailure state={rec} onRetry={rec.retry} testID="record" />}
      </GlassScreen>
    );
  }
  return (
    <SessionRecordView
      record={rec.data}
      fetchLatest={() => fieldApp.sessions.record(scope, sessionId)}
      skills={skills.status === 'ready' ? skills.data : []}
      canCorrect={!!rec.data.instructorId && rec.data.instructorId === scope.subjectId}
      commands={commands}
      onBack={onBack}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.lg },
  gap: { gap: space.md },
  tiles: { flexDirection: 'row', gap: space.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  compare: { gap: space.md },
  compareCol: {},
  footer: { gap: space.xs },
});
