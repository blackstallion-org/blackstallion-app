import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { AppText, Button, EmptyState, Screen, StatusMessage, TextField } from '@/ui/components';
import { space } from '@/ui/tokens';

import { recallAssessTarget, type AssessTarget } from './assessHandoff';
import {
  assessmentPayloadKey,
  codePointLength,
  emptyDraft,
  NOTES_MAX,
  SCORE_KEYS,
  SCORE_MAX,
  SCORE_MIN,
  validateAssessment,
  type AssessmentDraft,
  type AssessmentErrors,
  type ScoreKey,
} from './domain/assessment';
import { toCommandError } from './domain/commandErrors';
import { isUuid, latchOperation, newOperationId, type OperationLatch } from './domain/operation';
import type { FieldWorkflowRepository, PublishResult } from './domain/workflow';

const LABEL: Record<ScoreKey, string> = { riding: 'Riding', ground: 'Ground', stable: 'Stable' };
const FIRST_VALUE = 5; // first +/− press on an unset score starts in the middle of the scale

const step = (v: number | null, d: 1 | -1): number =>
  v === null ? FIRST_VALUE : Math.min(SCORE_MAX, Math.max(SCORE_MIN, v + d));

function ScoreStepper({
  k,
  value,
  error,
  disabled,
  onChange,
}: {
  k: ScoreKey;
  value: number | null;
  error?: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const label = LABEL[k];
  return (
    <View style={styles.stepper}>
      <View
        style={styles.stepperRow}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} score`}
        accessibilityValue={{ min: SCORE_MIN, max: SCORE_MAX, now: value ?? undefined, text: value === null ? 'Not set' : `${value} of ${SCORE_MAX}` }}
        accessibilityState={{ disabled }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (!disabled) onChange(step(value, e.nativeEvent.actionName === 'increment' ? 1 : -1));
        }}
        testID={`score-${k}`}
      >
        <AppText variant="bodyStrong" style={styles.stepperLabel}>
          {label}
        </AppText>
        <Button variant="secondary" fullWidth={false} label="−" disabled={disabled} accessibilityLabel={`Lower ${label}`} onPress={() => onChange(step(value, -1))} testID={`score-${k}-down`} />
        <AppText variant="headline" style={styles.stepperValue} testID={`score-${k}-value`}>
          {value === null ? '–' : String(value)}
        </AppText>
        <Button variant="secondary" fullWidth={false} label="+" disabled={disabled} accessibilityLabel={`Raise ${label}`} onPress={() => onChange(step(value, 1))} testID={`score-${k}-up`} />
      </View>
      {error ? (
        <AppText tone="danger" variant="caption" accessibilityLiveRegion="polite" testID={`score-${k}-error`}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

type Status =
  | { kind: 'editing' }
  | { kind: 'busy' }
  | { kind: 'done'; result: PublishResult }
  | { kind: 'error'; message: string; reference?: string; retryable: boolean };

export type AssessSessionViewProps = {
  repo?: FieldWorkflowRepository;
  target: AssessTarget | null;
  onDone: () => void;
  makeId?: () => string;
};

/** FO-03 Score and publish. Online-only in slice 1; the server re-validates every value. */
export function AssessSessionView({ repo, target, onDone, makeId = newOperationId }: AssessSessionViewProps) {
  const [draft, setDraft] = useState<AssessmentDraft>(emptyDraft);
  const [errors, setErrors] = useState<AssessmentErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  // One operation id per exact payload: a retry after a lost reply is a replay, an edited payload is a new request.
  const latch = useRef<OperationLatch | null>(null);

  if (!repo || !target) {
    return (
      <Screen edges={['left', 'right', 'bottom']} testID="field-assess">
        <EmptyState
          icon="person-outline"
          title={repo ? 'Open this cadet from Today' : 'Not connected'}
          message={repo ? 'Check the cadet in first, then choose Assess.' : 'This build isn’t connected to the academy, so sessions can’t be published.'}
        />
        <Button variant="secondary" label="Back to Today" onPress={onDone} />
      </Screen>
    );
  }

  // After an unknown outcome (lost reply) the scores are frozen: the only safe action is to resend the SAME payload.
  const locked = status.kind === 'busy' || (status.kind === 'error' && status.retryable);
  const set = <K extends keyof AssessmentDraft>(k: K, v: AssessmentDraft[K]) => {
    if (locked) return;
    setDraft((d) => ({ ...d, [k]: v }));
    if (status.kind === 'error') setStatus({ kind: 'editing' });
  };

  const publish = async () => {
    if (status.kind === 'busy') return;
    const v = validateAssessment(draft);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    latch.current = latchOperation(latch.current, assessmentPayloadKey(target.checkInOperationId, v.value), makeId);
    const operationId = latch.current.operationId;
    setStatus({ kind: 'busy' });
    try {
      const result = await repo.publish({ checkInOperationId: target.checkInOperationId, assessment: v.value, operationId });
      setStatus({ kind: 'done', result });
    } catch (e) {
      const ce = toCommandError(e, 'publish');
      if (!ce.retryable) latch.current = null;
      setStatus({ kind: 'error', message: ce.message, reference: ce.reference, retryable: ce.retryable });
    }
  };

  if (status.kind === 'done') {
    return (
      <Screen edges={['left', 'right', 'bottom']} testID="field-assess">
        <StatusMessage
          tone="success"
          title="Published"
          message={`${target.cadetName}’s family can see this session now.`}
          testID="publish-done"
        />
        <Button size="field" label="Back to Today" onPress={onDone} testID="publish-back" />
      </Screen>
    );
  }

  const notesLength = codePointLength(draft.notes.trim());
  return (
    <Screen
      edges={['left', 'right', 'bottom']}
      keyboard
      testID="field-assess"
      footer={
        <Button
          size="field"
          label={status.kind === 'error' && status.retryable ? 'Retry publishing' : 'Publish to family'}
          icon="send-outline"
          loading={status.kind === 'busy'}
          onPress={() => void publish()}
          testID="publish-submit"
        />
      }
    >
      <AppText variant="title" header>
        {target.cadetName}
      </AppText>
      {SCORE_KEYS.map((k) => (
        <ScoreStepper key={k} k={k} value={draft[k]} error={errors[k]} disabled={locked} onChange={(v) => set(k, v)} />
      ))}
      <TextField
        label="Notes for the family (optional)"
        hint={`${notesLength} / ${NOTES_MAX}`}
        value={draft.notes}
        onChangeText={(t) => set('notes', t)}
        multiline
        editable={!locked}
        maxLength={NOTES_MAX * 2}
        error={errors.notes ?? null}
        testID="assess-notes"
      />
      <StatusMessage tone="info" message="Skill tags appear here once the skills list is approved (D16). Video clips come in a later slice." />
      {status.kind === 'error' ? (
        <StatusMessage tone="danger" message={status.reference ? `${status.message} (Reference: ${status.reference})` : status.message} testID="publish-error" />
      ) : null}
    </Screen>
  );
}

export function AssessScreen() {
  const router = useRouter();
  const { fieldWorkflow } = useRepositories();
  const { op } = useLocalSearchParams<{ op?: string }>();
  const target = isUuid(op) ? recallAssessTarget(op) : null;
  return <AssessSessionView repo={fieldWorkflow} target={target} onDone={() => router.navigate('/field')} />;
}

const styles = StyleSheet.create({
  stepper: { gap: space.xs },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  stepperLabel: { flex: 1 },
  stepperValue: { minWidth: 32, textAlign: 'center' },
});
