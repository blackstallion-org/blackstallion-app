// Assigned-staff care timeline (Today → Care) and task card. Presentation only; data comes from field.my_care_timeline
// via the composition root (not wired: G2 has no backend and G3 auth is not done).
import { View } from 'react-native';

import { AppText, Badge, Button, Card, EmptyState, Screen, Section, StatusMessage } from '@/ui/components';
import type { CareDay, CareRow, CareRowStatus } from '../domain/timeline';
import type { Translator } from '../i18n/i18n';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
const STATUS_TONE: Record<CareRowStatus, Tone> = {
  upcoming: 'neutral',
  due: 'info',
  past_due: 'warning',
  overdue: 'danger',
  submitted: 'info',
  completed: 'success',
};

export interface CareTimelineProps {
  days: CareDay[];
  t: Translator;
  /** when the cached timeline was fetched; shown when offline/stale */
  staleSince: number | null;
  offlineEvidenceAllowed: boolean;
  onCapture: (occurrenceId: string) => void;
}

export function CareTaskCard({ row, t, onCapture, captureAllowed }: { row: CareRow; t: Translator; onCapture: (id: string) => void; captureAllowed: boolean }) {
  const due = t.t('care.timeline.dueAt', { time: t.time(row.dueAt, row.timezone) });
  return (
    <Card testID={`care-row-${row.occurrenceId}`} accessibilityLabel={`${row.horseName}, ${t.t(row.taskLabelKey)}, ${due}, ${t.t(row.statusLabelKey)}`}>
      <View style={{ gap: 6 }}>
        <AppText variant="bodyStrong">{`${row.horseName} · ${t.t(row.taskLabelKey)}`}</AppText>
        <AppText tone="muted">{due}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Badge label={t.t(row.statusLabelKey)} tone={STATUS_TONE[row.status]} />
          {row.evidenceLabelKey ? <Badge label={t.t(row.evidenceLabelKey)} tone={row.evidence === 'needs_action' || row.evidence === 'rejected' ? 'danger' : 'neutral'} /> : null}
        </View>
        {row.isMedication ? <StatusMessage tone="warning" message={t.t('care.medication.notice')} /> : null}
        {/* hub-entered instructions are data in the language the hub wrote them */}
        <AppText>{row.instructions}</AppText>
        {row.warnAlreadyCompleted && row.canCapture ? <AppText tone="warning">{t.t('care.capture.alreadyCompleted')}</AppText> : null}
      </View>
      {row.canCapture ? (
        captureAllowed ? (
          <Button label={t.t('field.care.takePhoto')} size="field" icon="camera-outline" fullWidth onPress={() => onCapture(row.occurrenceId)} testID={`care-capture-${row.occurrenceId}`} />
        ) : (
          <AppText tone="muted" testID={`care-capture-blocked-${row.occurrenceId}`}>{t.t('care.capture.notAllowed')}</AppText>
        )
      ) : null}
    </Card>
  );
}

export function CareTimelineScreen({ days, t, staleSince, offlineEvidenceAllowed, onCapture }: CareTimelineProps) {
  return (
    <Screen testID="care-timeline">
      <AppText variant="title" header>
        {t.t('care.timeline.title')}
      </AppText>
      {staleSince !== null ? <StatusMessage tone="info" message={t.t('care.timeline.stale', { time: t.time(staleSince, days[0]?.rows[0]?.timezone ?? 'Asia/Kolkata') })} /> : null}
      {days.length === 0 ? (
        <EmptyState icon="leaf-outline" title={t.t('care.timeline.title')} message={t.t('care.timeline.empty')} testID="care-empty" />
      ) : (
        days.map((d) => (
          <Section key={d.localDate} title={t.date(d.rows[0]!.dueAt, d.rows[0]!.timezone)}>
            {d.rows.map((r) => (
              <CareTaskCard key={r.occurrenceId} row={r} t={t} onCapture={onCapture} captureAllowed={offlineEvidenceAllowed} />
            ))}
          </Section>
        ))
      )}
    </Screen>
  );
}
