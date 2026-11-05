import { StyleSheet, View } from 'react-native';

import { dateLabel, hubTime } from '@/core/format/hubTime';
import { AppText } from '@/ui/components';
import { GlassButton, StatusBadge, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { AssessTarget } from '../assessHandoff';
import { useFieldStrings } from '../i18n';
import { commandMessage, type CheckInStatus } from '../useCheckIn';

/**
 * The outcome of one scan, shown in place (FO-02 result panel): checked in / already checked in (with the first
 * check-in's server time) / not on this hub's list / filed under another day / not confirmed. Only server answers
 * appear here; "Checked in" is never shown before the server confirms it.
 */
export function CheckInResultPanel({
  status,
  onAssess,
  onNext,
  onRetry,
  onOpenProfile,
}: {
  status: Exclude<CheckInStatus, { kind: 'idle' } | { kind: 'busy' }>;
  onAssess?: (t: AssessTarget) => void;
  onNext: () => void;
  onRetry: () => void;
  onOpenProfile?: (cadetId: string) => void;
}) {
  const s = useFieldStrings();
  if (status.kind === 'error') {
    const e = status.error;
    const notOnList = e.kind === 'notFound';
    return (
      <View style={styles.panel} testID="checkin-error-panel">
        {notOnList ? <StatusBadge label={s.t('scan.result.notOnListTitle')} tone="warning" /> : null}
        <StatusNote
          tone={notOnList ? 'warning' : 'danger'}
          title={notOnList ? undefined : s.t('scan.result.failedTitle')}
          message={notOnList ? s.t('scan.result.notOnList') : e.reference ? `${commandMessage(e, s)} (${s.t('common.reference', { ref: e.reference })})` : commandMessage(e, s)}
          testID="checkin-error"
        />
        {e.retryable ? <GlassButton size="large" icon="refresh" label={s.t('scan.result.retry')} onPress={onRetry} testID="checkin-retry" /> : null}
        <GlassButton variant="secondary" icon="scan-outline" label={s.t('scan.result.scanAgain')} onPress={onNext} testID="checkin-another" />
      </View>
    );
  }
  const r = status.result;
  return (
    <View style={styles.panel} testID="checkin-result">
      <StatusBadge label={r.duplicate ? s.t('scan.result.already') : s.t('scan.result.checkedIn')} tone={r.duplicate ? 'info' : 'success'} />
      <AppText variant="section" accessibilityRole="header">
        {r.cadetName}
      </AppText>
      <AppText tone="muted">
        {r.duplicate ? s.t('scan.result.firstAt', { time: hubTime(r.receivedAt), date: dateLabel(r.sessionDate) }) : s.t('scan.result.receivedAt', { time: hubTime(r.receivedAt), date: dateLabel(r.sessionDate) })}
      </AppText>
      {r.isToday ? (
        onAssess ? (
          <GlassButton
            size="large"
            icon="clipboard-outline"
            label={s.t('scan.result.assess', { name: r.cadetName })}
            testID="open-assess"
            onPress={() => onAssess({ checkInOperationId: r.checkInOperationId, cadetId: r.cadetId, cadetName: r.cadetName })}
          />
        ) : null
      ) : (
        <StatusNote tone="warning" title={s.t('scan.result.wrongDayTitle')} message={s.t('scan.result.wrongDay', { date: dateLabel(r.sessionDate) })} testID="checkin-wrong-day" />
      )}
      {onOpenProfile ? <GlassButton variant="ghost" icon="person-outline" label={s.t('scan.result.viewProfile')} onPress={() => onOpenProfile(r.cadetId)} testID="checkin-profile" /> : null}
      <GlassButton variant="secondary" icon="scan-outline" label={s.t('scan.result.scanNext')} onPress={onNext} testID="checkin-another" />
    </View>
  );
}

const styles = StyleSheet.create({ panel: { gap: space.md } });
