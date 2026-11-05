// FO-19 Rank proposal (conditional): behind the `rank_proposals` policy flag, OFF by default (D15 unsigned). When on,
// a proposer cites published sessions as evidence; the configured authority decides on FO-18. Nobody approves their own
// proposal, and no promotion threshold is invented.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { latchOperation, newOperationId, type OperationLatch } from '@/features/field/domain/operation';
import { AppText } from '@/ui/components/AppText';
import {
  Chip,
  EmptyState,
  FeatureGatedState,
  GlassButton,
  GlassInput,
  GlassScreen,
  ListGroup,
  PermissionDeniedState,
  Row,
  StatusBadge,
  StatusNote,
  UnavailableState,
} from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import { EVIDENCE_MAX, mayPropose, NOTE_MAX, proposalProblem, safeId } from '../domain/review';
import { RANKS, type FieldOpsScope, type Rank, type RankProposalResult } from '../domain/types';
import { backOr, shown, useFieldOps, useFieldOpsT, useFieldResource, useOutbox } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { ErrorBody, Heading, NotConnected, Provenance, ResourceGate } from './parts';

export function RankProposalRoute() {
  const params = useLocalSearchParams<{ cadetId?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field/cadets');
  const header = { onBack: back, title: t.t('fo.rank.title'), backLabel: t.t('fo.common.back') };
  if (!ctx.repos) return <NotConnected t={t} header={header} testID="fo19-rank" />;
  const cadetId = safeId(params.cadetId);
  if (!cadetId) {
    return (
      <GlassScreen header={header} testID="fo19-rank">
        <UnavailableState title={t.t('fo.common.notFoundTitle')} message={t.t('fo.rank.notFound')} testID="fo19-notfound" />
      </GlassScreen>
    );
  }
  return <RankProposalView repos={ctx.repos} scope={ctx.scope} contextKey={ctx.contextKey} cadetId={cadetId} t={t} onBack={back} />;
}

export function RankProposalView({
  repos,
  scope,
  contextKey,
  cadetId,
  t,
  makeId = newOperationId,
  onBack,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  cadetId: string;
  t: Translator;
  makeId?: () => string;
  onBack: () => void;
}) {
  const flags = useFieldResource(`${contextKey}:fo:flags`, () => repos.policy.flags(scope));
  const f = shown(flags)?.data ?? null;
  const enabled = f?.rankProposals.enabled === true && mayPropose(scope.role, f.rankProposals.proposerRoles);
  const cand = useFieldResource(enabled ? `${contextKey}:fo:rank:${cadetId}` : null, () => repos.rank.candidate(scope, cadetId));
  const { online } = useOutbox(repos.outbox, { subjectId: scope.subjectId, hubId: scope.hubId });
  const [to, setTo] = useState<Rank | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [latch, setLatch] = useState<OperationLatch | null>(null);
  const [result, setResult] = useState<RankProposalResult | null>(null);
  const [error, setError] = useState<FieldCommandError | null>(null);
  const header = { onBack, title: t.t('fo.rank.title'), backLabel: t.t('fo.common.back') };

  return (
    <GlassScreen header={header} keyboard testID="fo19-rank">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={flags} t={t} loadingLabel={t.t('fo.rank.loading')} testIDPrefix="fo19-flags">
        {(fl) => {
          if (!fl.rankProposals.enabled) return <FeatureGatedState title={t.t('fo.rank.offTitle')} message={t.t('fo.rank.off')} testID="fo19-off" />;
          if (!mayPropose(scope.role, fl.rankProposals.proposerRoles)) return <PermissionDeniedState title={t.t('fo.common.deniedTitle')} message={t.t('fo.rank.notProposer')} testID="fo19-denied" />;
          return (
            <ResourceGate r={cand} t={t} loadingLabel={t.t('fo.rank.loading')} notFoundMessage={t.t('fo.rank.notFound')} testIDPrefix="fo19">
              {(c, meta) => {
                const problem = proposalProblem({ currentRank: c.currentRank, toRank: to, evidence, note });
                const submit = async () => {
                  setTouched(true);
                  setError(null);
                  if (problem || !to) return;
                  const l = latchOperation(latch, `${cadetId}|${to}|${[...evidence].sort().join(',')}|${note.trim()}`, makeId);
                  setLatch(l);
                  try {
                    setResult(await repos.rank.propose(scope, { cadetId, toRank: to, evidenceSessionIds: evidence, note: note.trim() || null, operationId: l.operationId }));
                  } catch (e) {
                    const err = e instanceof FieldCommandError ? e : new FieldCommandError('unexpected', '');
                    if (err.kind !== 'network') setLatch(null);
                    setError(err);
                  }
                };
                if (result) {
                  return (
                    <View style={{ gap: space.lg }}>
                      <StatusNote
                        tone="success"
                        title={t.t('fo.rank.sentTitle')}
                        message={t.t('fo.rank.sent', { name: c.name, rank: t.t(`fo.rank.name.${result.toRank}`), time: t.time(Date.parse(result.proposedAt), 'Asia/Kolkata'), approver: t.t(`fo.rank.role.${fl.rankProposals.approverRole ?? 'none'}`) })}
                        testID="fo19-sent"
                      />
                      <GlassButton variant="secondary" label={t.t('fo.common.back')} onPress={onBack} />
                    </View>
                  );
                }
                return (
                  <View style={{ gap: space.lg }}>
                    <Heading title={c.name} subtitle={t.t('fo.rank.current', { rank: t.t(`fo.rank.name.${c.currentRank ?? 'none'}`) })} />
                    <StatusNote tone="info" message={t.t('fo.rank.authority', { approver: t.t(`fo.rank.role.${fl.rankProposals.approverRole ?? 'none'}`) })} testID="fo19-authority" />
                    {c.sessions.length === 0 ? (
                      <EmptyState icon="document-text-outline" title={t.t('fo.rank.noEvidenceTitle')} message={t.t('fo.rank.noEvidence')} testID="fo19-no-evidence" />
                    ) : (
                      <>
                        <View testID="fo19-target" style={styles.section}>
                          <AppText variant="secondary" tone="muted" header>
                            {t.t('fo.rank.toLabel')}
                          </AppText>
                          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t.t('fo.rank.toLabel')}>
                            {RANKS.filter((x) => x !== c.currentRank).map((x) => (
                              <Chip key={x} role="radio" label={t.t(`fo.rank.name.${x}`)} selected={to === x} onPress={() => setTo(x)} testID={`fo19-rank-${x}`} />
                            ))}
                          </View>
                          {touched && (problem === 'no_rank' || problem === 'same_rank') ? <AppText tone="danger">{t.t(`fo.rank.problem.${problem}`)}</AppText> : null}
                        </View>
                        <ListGroup title={t.t('fo.rank.evidenceTitle', { max: EVIDENCE_MAX })} testID="fo19-evidence">
                          {c.sessions.map((s) => {
                            const on = evidence.includes(s.sessionId);
                            return (
                              <Row
                                key={s.sessionId}
                                testID={`fo19-session-${s.sessionId}`}
                                icon={on ? 'checkbox-outline' : 'square-outline'}
                                label={t.date(Date.parse(`${s.sessionDate}T06:30:00Z`), 'Asia/Kolkata')}
                                value={t.t('fo.rank.scores', { r: s.riding ?? '—', g: s.ground ?? '—', s: s.stable ?? '—' })}
                                accessibilityLabel={`${t.date(Date.parse(`${s.sessionDate}T06:30:00Z`), 'Asia/Kolkata')}, ${on ? t.t('fo.rank.selected') : t.t('fo.rank.notSelected')}`}
                                onPress={() => setEvidence((v) => (on ? v.filter((x) => x !== s.sessionId) : [...v, s.sessionId]))}
                                trailing={on ? <StatusBadge label={t.t('fo.rank.selected')} tone="success" /> : <StatusBadge label={t.t('fo.rank.notSelected')} tone="neutral" icon={null} />}
                              />
                            );
                          })}
                        </ListGroup>
                        {touched && problem === 'evidence_count' ? <AppText tone="danger">{t.t('fo.rank.problem.evidence_count', { max: EVIDENCE_MAX })}</AppText> : null}
                        <GlassInput
                          label={t.t('fo.rank.noteLabel')}
                          hint={t.t('fo.rank.noteHint', { max: NOTE_MAX })}
                          value={note}
                          onChangeText={setNote}
                          multiline
                          maxLength={NOTE_MAX + 50}
                          error={touched && problem === 'note_too_long' ? t.t('fo.rank.problem.note_too_long', { max: NOTE_MAX }) : undefined}
                          testID="fo19-note"
                        />
                        {error ? (error.kind === 'conflict' ? <StatusNote tone="warning" message={t.t('fo.rank.conflict')} testID="fo19-conflict" /> : <ErrorBody error={error} t={t} testIDPrefix="fo19-submit" />) : null}
                        <GlassButton label={t.t('fo.rank.submit')} icon="send-outline" onPress={submit} disabled={!online || meta.stale} testID="fo19-submit" />
                        {!online || meta.stale ? <AppText variant="secondary" tone="muted" align="center">{t.t('fo.rank.offline')}</AppText> : null}
                      </>
                    )}
                  </View>
                );
              }}
            </ResourceGate>
          );
        }}
      </ResourceGate>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { gap: space.sm },
});
