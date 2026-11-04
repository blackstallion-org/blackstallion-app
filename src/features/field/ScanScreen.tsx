import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { dateLabel, hubTime } from '@/core/format/hubTime';
import { AppText, Badge, Button, Card, Screen, StatusMessage, TextField } from '@/ui/components';
import { space } from '@/ui/tokens';

import { rememberAssessTarget, type AssessTarget } from './assessHandoff';
import { toCommandError } from './domain/commandErrors';
import { newOperationId } from './domain/operation';
import { parsePassportInput } from './domain/passportCode';
import type { CheckInResult, FieldWorkflowRepository } from './domain/workflow';

/** A retry reuses the same request only briefly; after that it is a new check-in (the server de-duplicates the day). */
const ATTEMPT_TTL_MS = 2 * 60_000;

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; result: CheckInResult }
  | { kind: 'error'; message: string; reference?: string };

export type ScanCheckInViewProps = {
  repo?: FieldWorkflowRepository;
  onAssess: (t: AssessTarget) => void;
  now?: () => Date;
  makeId?: () => string;
};

/** FO-02 Check in a cadet. Camera scanning needs a native build (G1 E1); typed or pasted codes work everywhere. */
export function ScanCheckInView({ repo, onAssess, now = () => new Date(), makeId = newOperationId }: ScanCheckInViewProps) {
  const [code, setCode] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Retrying the same code reuses the same operation id and observed time, so a lost reply can't double-record.
  const attempt = useRef<{ code: string; operationId: string; observedAt: Date } | null>(null);

  const submit = async () => {
    if (status.kind === 'busy') return;
    const parsed = parsePassportInput(code);
    if (!parsed.ok) {
      setInputError(parsed.reason === 'empty' ? 'Enter the passport code.' : 'That doesn’t look like a passport code, for example BSAH-26-F3A00001.');
      return;
    }
    setInputError(null);
    if (!repo) return;
    const at = now();
    const a0 = attempt.current;
    const a =
      !a0 || a0.code !== parsed.code || at.getTime() - a0.observedAt.getTime() > ATTEMPT_TTL_MS
        ? { code: parsed.code, operationId: makeId(), observedAt: at }
        : a0;
    attempt.current = a;
    setStatus({ kind: 'busy' });
    try {
      const result = await repo.checkIn({ passportCode: a.code, observedAt: a.observedAt, operationId: a.operationId });
      attempt.current = null;
      setStatus({ kind: 'done', result });
    } catch (e) {
      const ce = toCommandError(e, 'checkIn');
      if (!ce.retryable) attempt.current = null;
      setStatus({ kind: 'error', message: ce.message, reference: ce.reference });
    }
  };

  const reset = () => {
    setCode('');
    setStatus({ kind: 'idle' });
    attempt.current = null;
  };

  if (!repo) {
    return (
      <Screen edges={['left', 'right', 'bottom']} testID="field-scan">
        <StatusMessage tone="warning" message="This build isn’t connected to the academy, so check-ins can’t be recorded." testID="scan-unconnected" />
      </Screen>
    );
  }

  if (status.kind === 'done') {
    const r = status.result;
    return (
      <Screen edges={['left', 'right', 'bottom']} testID="field-scan">
        <Card>
          <View style={styles.result} testID="checkin-result">
            <AppText variant="headline">{r.cadetName}</AppText>
            <Badge label={r.duplicate ? 'Already checked in' : 'Checked in'} tone={r.duplicate ? 'info' : 'success'} />
            <AppText tone="muted">
              {dateLabel(r.sessionDate)} · received {hubTime(r.receivedAt)}
            </AppText>
          </View>
        </Card>
        {r.isToday ? (
          <Button
            size="field"
            label={`Assess ${r.cadetName}`}
            testID="open-assess"
            onPress={() => onAssess({ checkInOperationId: r.checkInOperationId, cadetId: r.cadetId, cadetName: r.cadetName })}
          />
        ) : (
          <StatusMessage
            tone="warning"
            title="Not today’s check-in"
            message={`This check-in is filed under ${dateLabel(r.sessionDate)}, not today, so it can’t be assessed here. Check this phone’s date and ask your hub admin.`}
            testID="checkin-wrong-day"
          />
        )}
        <Button variant="secondary" label="Check in another cadet" onPress={reset} testID="checkin-another" />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']} keyboard testID="field-scan">
      <StatusMessage
        tone="info"
        message="Camera scanning needs a phone build and isn’t switched on yet. Type the code printed under the QR, or paste the QR link."
      />
      <TextField
        label="Passport code"
        placeholder="BSAH-26-…"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          if (inputError) setInputError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        error={inputError}
        testID="passport-input"
      />
      <Button size="field" label="Check in" icon="log-in-outline" loading={status.kind === 'busy'} onPress={() => void submit()} testID="checkin-submit" />
      {status.kind === 'error' ? (
        <StatusMessage tone="danger" message={status.reference ? `${status.message} (Reference: ${status.reference})` : status.message} testID="checkin-error" />
      ) : null}
    </Screen>
  );
}

export function ScanScreen() {
  const router = useRouter();
  const { fieldWorkflow } = useRepositories();
  return (
    <ScanCheckInView
      repo={fieldWorkflow}
      onAssess={(t) => {
        rememberAssessTarget(t);
        router.push({ pathname: '/field/session/assess', params: { op: t.checkInOperationId } });
      }}
    />
  );
}

const styles = StyleSheet.create({ result: { gap: space.sm } });
