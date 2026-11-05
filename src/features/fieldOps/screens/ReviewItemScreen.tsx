// FO-18 Review item: evidence and its provenance (who, device time vs academy time, location accuracy, reasons), and
// accept / reject with a required reason (FO-16 reason sheet). The decision carries the version that was loaded: if
// another reviewer decided first the server answers 409 and this screen shows THEIR decision; nothing is overwritten.
// Nobody can decide their own record (server rule, repeated here so a stale row can never offer it).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { latchOperation, newOperationId, type OperationLatch } from '@/features/field/domain/operation';
import { AppText } from '@/ui/components/AppText';
import { GlassBottomSheet, GlassButton, GlassInput, GlassScreen, ListGroup, Row, StatusNote, UnavailableState } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import { formatAccuracy } from '../domain/evidence';
import { mayDecide, REASON_MAX, reasonProblem, reviewReasonKey, safeId, safeKind } from '../domain/review';
import type { FieldOpsScope, ReviewItem, ReviewKind } from '../domain/types';
import { backOr, shown, useFieldOps, useFieldOpsT, useFieldResource, useOutbox, useScreenFocused } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { ErrorBody, NotConnected, Provenance, ResourceGate } from './parts';

/** `/field/review/[kind]/[itemId]` (canonical) or `/field/review/[itemId]?kind=…`; both are validated before any read. */
export function ReviewItemRoute() {
  const params = useLocalSearchParams<{ itemId?: string; kind?: string }>();
  const focused = useScreenFocused();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field/review');
  const header = { onBack: back, title: t.t('fo.reviewItem.title'), backLabel: t.t('fo.common.back') };
  if (!ctx.repos) return <NotConnected t={t} header={header} testID="fo18-item" />;
  const itemId = safeId(params.itemId);
  const kind = safeKind(params.kind);
  if (!itemId || !kind) {
    return (
      <GlassScreen header={header} testID="fo18-item">
        <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.reviewItem.notFound')} testID="fo18-notfound" />
      </GlassScreen>
    );
  }
  return <ReviewItemView repos={ctx.repos} scope={ctx.scope} contextKey={ctx.contextKey} kind={kind} itemId={itemId} t={t} onBack={back} focused={focused} />;
}

type Outcome = { kind: 'decided'; decision: 'accepted' | 'rejected'; at: string } | { kind: 'conflict' } | { kind: 'error'; error: FieldCommandError };

export function ReviewItemView({
  repos,
  scope,
  contextKey,
  kind,
  itemId,
  t,
  makeId = newOperationId,
  focused = true,
  onBack,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  kind: ReviewKind;
  itemId: string;
  t: Translator;
  makeId?: () => string;
  /** overlays are hidden while another screen is on top */
  focused?: boolean;
  onBack: () => void;
}) {
  const r = useFieldResource(`${contextKey}:fo:reviewItem:${kind}:${itemId}`, () => repos.review.item(scope, kind, itemId));
  const { online } = useOutbox(repos.outbox, { subjectId: scope.subjectId, hubId: scope.hubId });
  const item = shown(r)?.data ?? null;
  const media = item?.media ?? null;
  const photo = useFieldResource(media ? `${contextKey}:fo:reviewPhoto:${itemId}` : null, () => repos.review.evidenceUrl(scope, media!));
  const [sheet, setSheet] = useState<'accept' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [latch, setLatch] = useState<OperationLatch | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const openSheet = (which: 'accept' | 'reject') => {
    setTouched(false);
    setSheet(which);
  };
  const submit = async () => {
    if (!item || !sheet) return;
    setTouched(true);
    if (reasonProblem(reason)) return;
    const decision = sheet === 'accept' ? ('accept' as const) : ('reject' as const);
    // same payload → same operation id, so a retry after a lost reply cannot record twice
    const l = latchOperation(latch, `${item.kind}|${item.itemId}|${item.version}|${decision}|${reason.trim()}`, makeId);
    setLatch(l);
    try {
      const res = await repos.review.decide(scope, { kind: item.kind, itemId: item.itemId, expectedVersion: item.version, decision, reason, operationId: l.operationId });
      setSheet(null);
      setOutcome({ kind: 'decided', decision: res.decision, at: res.decidedAt });
      setLatch(null);
      r.retry();
    } catch (e) {
      const err = e instanceof FieldCommandError ? e : new FieldCommandError('unexpected', '');
      if (err.kind !== 'network') setLatch(null); // a definite answer: a new attempt gets a new id
      if (err.kind === 'conflict') {
        setSheet(null);
        setOutcome({ kind: 'conflict' });
        r.retry(); // show what the other reviewer decided
      } else if (err.kind === 'invalid') {
        setTouched(true);
        setOutcome({ kind: 'error', error: err });
      } else {
        setSheet(null);
        setOutcome({ kind: 'error', error: err });
      }
    }
  };

  const problem = touched ? reasonProblem(reason) : null;
  return (
    <GlassScreen header={{ onBack, title: t.t('fo.reviewItem.title'), backLabel: t.t('fo.common.back') }} testID="fo18-item">
      <Provenance source={repos.source} t={t} />
      {outcome?.kind === 'decided' ? (
        <StatusNote tone="success" title={t.t(`fo.reviewItem.done.${outcome.decision}`)} message={t.t('fo.reviewItem.doneAt', { time: t.time(Date.parse(outcome.at), 'Asia/Kolkata') })} testID="fo18-decided" />
      ) : null}
      {outcome?.kind === 'conflict' ? <StatusNote tone="warning" title={t.t('fo.reviewItem.conflictTitle')} message={t.t('fo.reviewItem.conflict')} testID="fo18-conflict" /> : null}
      {outcome?.kind === 'error' && outcome.error.kind !== 'invalid' ? <ErrorBody error={outcome.error} t={t} testIDPrefix="fo18-decide" /> : null}
      <ResourceGate r={r} t={t} loadingLabel={t.t('fo.reviewItem.loading')} deniedMessage={t.t('fo.review.denied')} notFoundMessage={t.t('fo.reviewItem.notFound')} testIDPrefix="fo18">
        {(it, meta) => (
          <View style={{ gap: space.lg }}>
            <Evidence it={it} t={t} photo={shown(photo)?.data ?? null} photoLoading={photo.status === 'loading'} source={repos.source} />
            <ProvenanceList it={it} t={t} viewerId={scope.subjectId} />
            <Decision it={it} t={t} viewerId={scope.subjectId} offline={!online || meta.stale} onAccept={() => openSheet('accept')} onReject={() => openSheet('reject')} />
          </View>
        )}
      </ResourceGate>
      {/* FO-16 reason sheet: required for both decisions (G9 §3.6), 3..500 characters */}
      <GlassBottomSheet
        visible={sheet !== null && focused}
        onClose={() => setSheet(null)}
        title={sheet === 'reject' ? t.t('fo.reason.sheetReject') : t.t('fo.reason.sheetAccept')}
        description={t.t('fo.reason.sheetBody')}
        testID="fo18-reason-sheet"
        actions={
          <>
            <GlassButton
              icon={sheet === 'reject' ? 'close-circle-outline' : 'checkmark-circle-outline'}
              label={sheet === 'reject' ? t.t('fo.reviewItem.rejectWithReason') : t.t('fo.reviewItem.acceptWithReason')}
              onPress={submit}
              testID="fo18-submit"
            />
            <GlassButton variant="secondary" label={t.t('common.action.cancel')} onPress={() => setSheet(null)} testID="fo18-cancel" />
          </>
        }
      >
        <GlassInput
          label={t.t('fo.reason.label')}
          hint={t.t('fo.reason.hint', { max: REASON_MAX })}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={REASON_MAX + 50}
          error={problem ? t.t(`fo.reason.problem.${problem}`) : outcome?.kind === 'error' && outcome.error.kind === 'invalid' ? t.t('fo.reason.serverRefused') : undefined}
          testID="fo18-reason"
        />
      </GlassBottomSheet>
    </GlassScreen>
  );
}

function Evidence({ it, t, photo, photoLoading, source }: { it: ReviewItem; t: Translator; photo: string | null; photoLoading: boolean; source: 'synthetic-preview' | 'server' }) {
  const { colors } = useTheme();
  if (it.kind === 'care_evidence') {
    return (
      <ListGroup title={t.t('fo.reviewItem.evidence')} testID="fo18-evidence">
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" accessibilityLabel={t.t('fo.reviewItem.photoA11y', { horse: it.horseName ?? '' })} />
        ) : (
          <View style={[styles.noPhoto, { borderColor: colors.borderStrong }]} accessible accessibilityLabel={photoLoading ? t.t('fo.reviewItem.photoLoading') : t.t(source === 'synthetic-preview' ? 'fo.reviewItem.photoSynthetic' : 'fo.reviewItem.photoUnavailable')}>
            <AppText tone="muted" align="center">
              {photoLoading ? t.t('fo.reviewItem.photoLoading') : t.t(source === 'synthetic-preview' ? 'fo.reviewItem.photoSynthetic' : 'fo.reviewItem.photoUnavailable')}
            </AppText>
          </View>
        )}
        <Row icon="leaf-outline" label={`${it.horseName ?? '—'} · ${it.taskType ? t.t(`care.taskType.${it.taskType}`) : ''}`} value={it.dueAt ? t.t('fo.reviewItem.dueAt', { time: t.time(Date.parse(it.dueAt), 'Asia/Kolkata') }) : undefined} />
      </ListGroup>
    );
  }
  if (it.kind === 'shift_attendance') {
    return (
      <ListGroup title={t.t('fo.reviewItem.evidence')} testID="fo18-evidence">
        <Row icon="time-outline" label={t.t('fo.review.punchLabel', { name: it.subjectName ?? t.t('fo.review.someone') })} value={t.t('fo.reviewItem.noPhotoShift')} />
      </ListGroup>
    );
  }
  return (
    <ListGroup title={t.t('fo.reviewItem.evidence')} testID="fo18-evidence">
      <Row icon="ribbon-outline" label={`${it.cadetName ?? '—'}`} value={`${t.t(`fo.rank.name.${it.fromRank ?? 'none'}`)} → ${t.t(`fo.rank.name.${it.toRank ?? 'none'}`)}`} />
      <Row icon="document-text-outline" label={t.t('fo.reviewItem.sessions')} value={t.t('fo.reviewItem.sessionsCount', { count: it.evidenceSessionIds.length })} />
    </ListGroup>
  );
}

function ProvenanceList({ it, t, viewerId }: { it: ReviewItem; t: Translator; viewerId: string }) {
  const at = (v: string | null) => (v ? t.time(Date.parse(v), 'Asia/Kolkata') : '—');
  return (
    <ListGroup title={t.t('fo.reviewItem.provenance')} testID="fo18-provenance">
      <Row icon="person-outline" label={t.t(it.kind === 'rank_proposal' ? 'fo.reviewItem.proposedBy' : 'fo.reviewItem.staff')} value={it.subjectUserId === viewerId ? t.t('fo.reviewItem.you') : (it.subjectName ?? '—')} />
      {it.kind !== 'rank_proposal' ? <Row icon="phone-portrait-outline" label={t.t('fo.reviewItem.observed')} value={at(it.observedAt)} /> : null}
      <Row icon="server-outline" label={t.t(it.kind === 'rank_proposal' ? 'fo.reviewItem.proposedAt' : 'fo.reviewItem.received')} value={at(it.receivedAt)} />
      {it.kind !== 'rank_proposal' ? <Row icon="locate-outline" label={t.t('fo.shift.accuracy')} value={formatAccuracy(it.accuracyM) ?? t.t('fo.location.none')} /> : null}
      {it.kind === 'shift_attendance' ? <Row icon="navigate-outline" label={t.t('fo.shift.distance')} value={it.distanceM != null ? t.t('fo.shift.meters', { meters: Math.round(it.distanceM) }) : t.t('fo.shift.distanceUnknown')} /> : null}
      {it.kind === 'care_evidence' && it.late ? <Row icon="alarm-outline" label={t.t('fo.reviewItem.late')} value={t.t('fo.reviewItem.lateBody')} /> : null}
      {it.reasons.map((x) => (
        <Row key={x} icon="alert-circle-outline" label={t.t('fo.reviewItem.why')} value={t.t(reviewReasonKey(it.kind, x), { accuracy: formatAccuracy(it.accuracyM) ?? '' })} />
      ))}
    </ListGroup>
  );
}

function Decision({ it, t, viewerId, offline, onAccept, onReject }: { it: ReviewItem; t: Translator; viewerId: string; offline: boolean; onAccept: () => void; onReject: () => void }) {
  if (it.state !== 'open') {
    return (
      <StatusNote
        tone={it.state === 'accepted' ? 'success' : 'danger'}
        title={t.t(`fo.reviewItem.decided.${it.state}`, { who: it.decidedBy === viewerId ? t.t('fo.reviewItem.you') : t.t('fo.reviewItem.otherReviewer') })}
        message={[it.decidedAt ? t.time(Date.parse(it.decidedAt), 'Asia/Kolkata') : null, it.decisionReason].filter(Boolean).join(' · ')}
        testID="fo18-already-decided"
      />
    );
  }
  if (it.subjectUserId === viewerId) return <StatusNote tone="info" message={t.t('fo.reviewItem.ownRecord')} testID="fo18-own" />;
  if (!mayDecide(it, viewerId)) return <StatusNote tone="info" message={t.t('fo.reviewItem.cannotDecide')} testID="fo18-cannot" />;
  return (
    <View style={{ gap: space.sm }}>
      {it.kind === 'shift_attendance' ? <AppText tone="muted">{t.t('fo.reviewItem.acceptNotVerified')}</AppText> : null}
      <GlassButton label={t.t(it.kind === 'rank_proposal' ? 'fo.reviewItem.approve' : 'fo.reviewItem.accept')} icon="checkmark-circle-outline" onPress={onAccept} disabled={offline} testID="fo18-accept" />
      <GlassButton variant="secondary" icon="close-circle-outline" label={t.t('fo.reviewItem.reject')} onPress={onReject} disabled={offline} testID="fo18-reject" />
      {offline ? <AppText variant="secondary" tone="muted" align="center">{t.t('fo.review.offlineDecisions')}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.control, marginTop: space.md },
  noPhoto: { minHeight: 120, borderRadius: radius.control, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: space.lg, marginTop: space.md },
});
