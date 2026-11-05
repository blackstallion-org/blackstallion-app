// Location evidence shared by FO-10 and FO-11: one flat row (accuracy, what it means for review) that sits inside the
// screen's evidence group, and one quiet action outside it (no glass button inside a glass group). Never "verified".
import { GlassButton, Row, StatusBadge } from '@/ui/glass';

import { formatAccuracy, locationQuality } from '../domain/evidence';
import type { Translator } from '../i18n/i18n';
import type { LocationEvidence } from '../permissions/useLocationEvidence';

export function LocationRow({ loc, t, maxAccuracyM, testID }: { loc: LocationEvidence; t: Translator; maxAccuracyM: number; testID: string }) {
  const q = locationQuality(loc.reading, maxAccuracyM);
  const acc = formatAccuracy(loc.reading?.accuracyM);
  const off = loc.status === 'denied' || loc.status === 'blocked' || loc.status === 'unavailable';
  const value = loc.busy
    ? t.t('fo.location.getting')
    : off
      ? t.t('fo.location.off')
      : loc.status === 'undetermined'
        ? t.t('fo.location.notAsked')
        : loc.failed
          ? t.t('fo.location.failed')
          : !loc.reading
            ? t.t('fo.location.none')
            : q === 'good'
              ? t.t('fo.location.good', { accuracy: acc ?? '' })
              : t.t('fo.location.weak', { accuracy: acc ?? t.t('fo.location.unknownAccuracy') });
  // the value already says whether it goes to review; a badge only marks a good fix (minimal: no duplicate status)
  return (
    <Row
      icon={off ? 'location-outline' : 'locate-outline'}
      label={acc && !loc.busy ? acc : t.t('fo.location.label')}
      value={value}
      trailing={!loc.busy && loc.reading && q === 'good' ? <StatusBadge label={t.t('fo.location.badge.good')} tone="success" /> : undefined}
      testID={testID}
    />
  );
}

/** Quiet secondary action under the evidence group: allow (primer first), check again, or open phone settings. */
export function LocationAction({ loc, t, testID }: { loc: LocationEvidence; t: Translator; testID: string }) {
  if (loc.status === 'unavailable' || loc.status === 'checking') return null;
  if (loc.status === 'blocked') {
    return <GlassButton variant="ghost" icon="settings-outline" label={t.t('fo.location.openSettings')} onPress={loc.openSettings} testID={`${testID}-settings`} />;
  }
  return (
    <GlassButton
      variant="ghost"
      icon={loc.status === 'granted' ? 'refresh' : 'location-outline'}
      label={loc.status === 'granted' ? t.t('fo.location.again') : t.t('fo.location.allow')}
      loading={loc.busy}
      onPress={loc.ask}
      testID={`${testID}-ask`}
    />
  );
}
