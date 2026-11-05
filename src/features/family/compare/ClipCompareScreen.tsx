import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { GlassCard, GlassScreen, StatusNote, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { ChildSwitcher, NoLinkedChild, SyntheticBanner, useBackTo } from '../components/FamilyChrome';
import { PrivateClip, type ConsentGate } from '../components/PrivateClip';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { ClipEntry, FamilyChild } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { dayLabel } from '../domain/format';
import { pairClips, routeId } from '../domain/progress';
import { useFamilyResource, useSessionVideoConsent } from '../hooks';
import { COMPARE_COPY } from '../strings';

/**
 * FA-13 Clip comparison (`/family/compare[?recent=<recordId>]`). The earliest and a recent private clip of the selected
 * child, each with its date, each behind the same consent gate and short-lived URL as FA-03. Unavailable with fewer
 * than two clips. No posture score, no coaching or clinical wording (D24/D34): a plain side-by-side.
 */
export function ClipCompareScreen() {
  const back = useBackTo('/family/progress?view=clips');
  const { repos, selected } = useFamily();
  const params = useLocalSearchParams<{ recent?: string }>();
  return (
    <GlassScreen header={{ onBack: back, title: COMPARE_COPY.title }} testID="family-compare">
      <ChildSwitcher />
      {!repos ? <FamilyUnconnected testID="compare" /> : !selected ? <NoLinkedChild testID="compare" /> : <CompareLoader key={selected.id} child={selected} recentId={routeId(params.recent)} />}
    </GlassScreen>
  );
}

function CompareLoader({ child, recentId }: { child: FamilyChild; recentId: string | null }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['clips', child.id], (r) => r.progress.clips(scope, child.id));
  const consent = useSessionVideoConsent(child.id);
  return (
    <ResourceGate resource={res} loadingLabel={COMPARE_COPY.loading} rows={2} testID="compare">
      {(data) => {
        const pair = pairClips(data.clips, recentId);
        return (
          <>
            <SyntheticBanner source={data.source} />
            <AppText tone="muted">{COMPARE_COPY.intro(child.firstName)}</AppText>
            {pair ? (
              <>
                <ClipPane label={COMPARE_COPY.earlier} entry={pair.earlier} child={child} consent={consent} testID="compare-earlier" />
                <ClipPane label={COMPARE_COPY.recent} entry={pair.recent} child={child} consent={consent} testID="compare-recent" />
                <StatusNote tone="info" message={COMPARE_COPY.noClaims} testID="compare-no-claims" />
              </>
            ) : (
              <GlassCard>
                <UnavailableState title={COMPARE_COPY.needTwoTitle} message={COMPARE_COPY.needTwo(child.firstName, data.clips.length)} testID="compare-needs-two" />
              </GlassCard>
            )}
          </>
        );
      }}
    </ResourceGate>
  );
}

function ClipPane({ label, entry, child, consent, testID }: { label: string; entry: ClipEntry; child: FamilyChild; consent: ConsentGate; testID: string }) {
  return (
    <View style={styles.pane} testID={testID}>
      <View style={styles.paneHead}>
        <AppText variant="secondary" tone="accent" style={styles.strong}>
          {label}
        </AppText>
        <AppText variant="section" header>
          {dayLabel(entry.date)}
        </AppText>
      </View>
      <PrivateClip clip={entry.clip} childName={child.firstName} consent={consent} autoPlay={false} testID={`${testID}-clip`} />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { gap: space.sm },
  paneHead: { gap: 2 },
  strong: { fontWeight: '600' },
});
