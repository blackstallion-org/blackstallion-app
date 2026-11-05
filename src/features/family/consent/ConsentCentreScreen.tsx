import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { ConfirmDialog, EmptyState, GlassBottomSheet, GlassButton, GlassCard, GlassScreen, ListGroup, Row, StatusBadge, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { ChildSwitcher, SyntheticBanner, useBackTo } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import { FamilyCommandError, type ConsentCentre, type ConsentPurpose } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { CommandLatches, consentKey } from '../domain/commandLatch';
import { consentView, type ConsentState } from '../domain/consent';
import { instantStamp } from '../domain/format';
import { useFamilyResource } from '../hooks';
import { CONSENT_COPY } from '../strings';

type Pending = { purpose: ConsentPurpose; state: ConsentState; granted: boolean } | null;
type Feedback = { tone: 'success' | 'danger' | 'info'; message: string; retry?: () => void } | null;

/**
 * FA-12 Consent centre (`/family/consents`; SH-13 "Privacy & consents" links here). Purposes, current value and
 * history come from the G9 RPCs; a change is a new server record ("Saved" only after the academy confirms it).
 * Purposes and wording are server data (D09 PROPOSED, labelled as draft wording).
 */
export function ConsentCentreScreen() {
  const back = useBackTo('/family/profile');
  const { repos } = useFamily();
  return (
    <GlassScreen header={{ onBack: back, title: CONSENT_COPY.title }} testID="family-consents">
      <View style={styles.head}>
        <AppText variant="title" header>
          {CONSENT_COPY.heading}
        </AppText>
        <AppText tone="muted">{CONSENT_COPY.intro}</AppText>
      </View>
      {repos ? <ConsentLoader /> : <FamilyUnconnected testID="consent" />}
    </GlassScreen>
  );
}

function ConsentLoader() {
  const { scope, repos, selected, linked } = useFamily();
  const res = useFamilyResource(['consent-centre'], (r) => r.consent.centre(scope));
  const [latches] = useState(() => new CommandLatches());
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [shown, setShown] = useState<ConsentCentre | null>(null);
  if (res.status === 'ready' && res.data !== shown) setShown(res.data);

  if (linked.length === 0 || !selected) {
    return (
      <GlassCard>
        <EmptyState testID="consent-empty" icon="shield-outline" title={CONSENT_COPY.emptyTitle} message={CONSENT_COPY.empty} />
      </GlassCard>
    );
  }

  const save = async (p: NonNullable<Pending>) => {
    if (!repos) return;
    const key = consentKey(selected.id, p.purpose.purpose, p.granted, p.purpose.policyVersion);
    const operationId = latches.idFor(key);
    setSaving(p.purpose.purpose);
    setFeedback({ tone: 'info', message: CONSENT_COPY.saving });
    try {
      const r = await repos.consent.set(scope, { childId: selected.id, purpose: p.purpose.purpose, granted: p.granted, policyVersion: p.purpose.policyVersion, operationId });
      latches.settle(key, 'acknowledged');
      setFeedback({ tone: 'success', message: r.changed ? CONSENT_COPY.saved(p.purpose.title, r.granted) : CONSENT_COPY.unchanged(p.purpose.title) });
      setHistoryKey((n) => n + 1);
      res.retry();
    } catch (e) {
      const err = e instanceof FamilyCommandError ? e : new FamilyCommandError('unexpected', '');
      latches.settle(key, err.kind === 'network' ? 'network' : 'refused');
      if (err.kind === 'network') setFeedback({ tone: 'danger', message: CONSENT_COPY.network, retry: () => void save(p) });
      else if (err.kind === 'conflict') {
        setFeedback({ tone: 'danger', message: CONSENT_COPY.conflict });
        res.retry();
      } else setFeedback({ tone: 'danger', message: CONSENT_COPY.failed });
    } finally {
      setSaving(null);
    }
  };

  const content = (data: ConsentCentre, refreshing: boolean) => {
    const child = data.children.find((c) => c.childId === selected.id);
    const versions = [...new Set(data.purposes.map((p) => p.policyVersion))];
    return (
      <>
        <SyntheticBanner source={data.source} />
        <ChildSwitcher />
        {versions.some((v) => v.startsWith('draft')) ? <StatusNote tone="info" message={CONSENT_COPY.draft(versions.join(', '))} testID="consent-draft-note" /> : null}
        {data.purposes.map((p) => {
          const state = child?.consents.find((c) => c.purpose === p.purpose) ?? { purpose: p.purpose, state: 'not_set' as const, granted: false, allowed: false, policyVersion: null, currentPolicyVersion: p.policyVersion, recordedAt: null };
          return (
            <PurposeCard
              key={p.purpose}
              purpose={p}
              state={state}
              busy={saving === p.purpose}
              locked={saving !== null || refreshing}
              onAction={(granted) => {
                setFeedback(null);
                setPending({ purpose: p, state, granted });
              }}
            />
          );
        })}
        {feedback ? (
          <View style={styles.feedback}>
            <StatusNote tone={feedback.tone} message={feedback.message} testID="consent-feedback" />
            {feedback.retry ? <GlassButton variant="secondary" icon="refresh" label="Try again" onPress={feedback.retry} testID="consent-retry" /> : null}
          </View>
        ) : null}
        <ConsentHistory key={`${selected.id}-${historyKey}`} childId={selected.id} purposes={data.purposes} />
      </>
    );
  };

  const childName = selected.firstName;
  return (
    <>
      {res.status === 'loading' && shown ? (
        content(shown, true)
      ) : (
        <ResourceGate resource={res} loadingLabel={CONSENT_COPY.loading} rows={3} testID="consent">
          {(data) => content(data, false)}
        </ResourceGate>
      )}
      <GlassBottomSheet
        visible={pending !== null && pending.granted}
        onClose={() => setPending(null)}
        title={pending ? CONSENT_COPY.allowTitle(pending.purpose.title, childName) : ''}
        description={pending?.purpose.description ?? undefined}
        testID="consent-allow-sheet"
        actions={
          <>
            <GlassButton
              label={CONSENT_COPY.allow}
              icon="checkmark-circle-outline"
              onPress={async () => {
                const p = pending;
                setPending(null);
                if (p) await save(p);
              }}
              testID="consent-allow-confirm"
            />
            <GlassButton variant="secondary" label={CONSENT_COPY.notNow} onPress={() => setPending(null)} />
          </>
        }
      >
        {pending ? (
          <AppText variant="secondary" tone="muted">
            {CONSENT_COPY.allowWording(pending.purpose.policyVersion)}
          </AppText>
        ) : null}
      </GlassBottomSheet>
      <ConfirmDialog
        visible={pending !== null && !pending.granted}
        title={pending ? CONSENT_COPY.withdrawTitle(pending.purpose.title, childName) : ''}
        message={CONSENT_COPY.withdrawMessage}
        confirmLabel={CONSENT_COPY.withdraw}
        cancelLabel={CONSENT_COPY.keep}
        destructiveIcon="remove-circle-outline"
        onConfirm={async () => {
          const p = pending;
          setPending(null);
          if (p) await save(p);
        }}
        onCancel={() => setPending(null)}
        testID="consent-withdraw-dialog"
      />
    </>
  );
}

function PurposeCard({ purpose, state, busy, locked, onAction }: { purpose: ConsentPurpose; state: ConsentState; busy: boolean; locked: boolean; onAction: (granted: boolean) => void }) {
  const v = consentView(state);
  return (
    <GlassCard testID={`consent-${purpose.purpose}`}>
      <View style={styles.cardHead}>
        <AppText variant="section" header style={styles.flex}>
          {purpose.title}
        </AppText>
        <StatusBadge label={v.label} tone={v.tone} icon={v.tone === 'neutral' ? null : undefined} testID={`consent-state-${purpose.purpose}`} />
      </View>
      {purpose.description ? <AppText>{purpose.description}</AppText> : null}
      <AppText variant="secondary" tone="muted">
        {state.recordedAt ? CONSENT_COPY.recorded(instantStamp(state.recordedAt), state.policyVersion) : CONSENT_COPY.never}
      </AppText>
      {v.note ? <StatusNote tone={v.tone === 'warning' ? 'warning' : 'info'} message={v.note} /> : null}
      <GlassButton
        variant={v.action.kind === 'grant' ? 'primary' : 'secondary'}
        size="regular"
        icon={v.action.kind === 'grant' ? 'checkmark-circle-outline' : 'remove-circle-outline'}
        label={busy ? CONSENT_COPY.saving : v.action.label}
        loading={busy}
        disabled={locked && !busy}
        onPress={() => onAction(v.action.kind === 'grant')}
        accessibilityLabel={`${v.action.label}: ${purpose.title}`}
        testID={`consent-action-${purpose.purpose}`}
      />
    </GlassCard>
  );
}

function ConsentHistory({ childId, purposes }: { childId: string; purposes: ConsentPurpose[] }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['consent-history', childId], (r) => r.consent.history(scope, childId));
  const title = (p: string) => purposes.find((x) => x.purpose === p)?.title ?? p;
  return (
    <ResourceGate resource={res} loadingLabel={CONSENT_COPY.loading} rows={1} testID="consent-history">
      {(rows) => (
        <ListGroup title={CONSENT_COPY.historyTitle} testID="consent-history">
          {rows.length === 0 ? (
            <Row label={CONSENT_COPY.historyEmpty} />
          ) : (
            rows.map((h) => (
              <Row
                key={h.id}
                icon={h.granted ? 'checkmark-circle-outline' : 'remove-circle-outline'}
                label={CONSENT_COPY.historyRow(title(h.purpose), h.granted)}
                value={[instantStamp(h.recordedAt), `wording ${h.policyVersion}`, h.byCurrentGuardian ? null : CONSENT_COPY.previousGuardian].filter(Boolean).join(' · ')}
              />
            ))
          )}
        </ListGroup>
      )}
    </ResourceGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  feedback: { gap: space.sm },
});
