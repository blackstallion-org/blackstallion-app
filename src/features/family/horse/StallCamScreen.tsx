import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/ui/components';
import { GlassCard, GlassScreen, StatusNote, UnavailableState } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

import { NoLinkedChild, useBackTo } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { FamilyChild } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import type { StreamCapability } from '../domain/stream';
import { useFamilyResource } from '../hooks';
import { STALL_COPY } from '../strings';
import { StallPlayer } from './StallPlayer';

/**
 * FA-08 Stall camera (`/family/horse/stall-cam`). Capability first (`app_stream_capability`): in this delta the
 * answer is always "unavailable" with a reason, so the screen explains why and shows an empty dark frame labelled
 * "No live view" — never the editorial horse art, a still, or an old clip presented as live.
 */
export function StallCamScreen() {
  const back = useBackTo('/family/horse');
  const { repos, selected } = useFamily();
  return (
    <GlassScreen scheme="dark" header={{ onBack: back, title: STALL_COPY.title }} testID="family-stall-cam">
      {!repos ? <FamilyUnconnected testID="stall" /> : !selected ? <NoLinkedChild testID="stall" /> : <StallLoader key={selected.id} child={selected} />}
    </GlassScreen>
  );
}

function StallLoader({ child }: { child: FamilyChild }) {
  const { scope, repos } = useFamily();
  const res = useFamilyResource(['stream', child.id], (r) => r.stream.capability(scope, child.id));
  const request = repos?.stream.requestGrant;
  const requestGrant = useCallback(() => (request ? request(scope, child.id) : Promise.reject(new Error('no grant source'))), [request, scope, child.id]);
  return (
    <>
      <AppText variant="secondary" tone="muted">
        {child.firstName}
      </AppText>
      <ResourceGate resource={res} loadingLabel={STALL_COPY.checking} rows={1} testID="stall">
        {(cap) => (cap.status === 'available' && request ? <StallPlayer requestGrant={requestGrant} /> : <StallUnavailable cap={cap} />)}
      </ResourceGate>
      <StatusNote tone="info" message={STALL_COPY.honesty} testID="stall-honesty" />
    </>
  );
}

function StallUnavailable({ cap }: { cap: StreamCapability }) {
  const { colors } = useTheme();
  const reason = cap.status === 'unavailable' ? cap.reason : 'unknown';
  const copy = STALL_COPY.reasons[reason];
  return (
    <>
      <View style={[styles.frame, { borderColor: rgba(colors.ink, 0.14) }]} testID="stall-no-live" accessible accessibilityLabel={STALL_COPY.noLive}>
        <Icon name="videocam-off-outline" size={36} color={colors.inkMuted} />
        <AppText variant="bodyStrong" tone="muted">
          {STALL_COPY.noLive}
        </AppText>
      </View>
      <GlassCard>
        <UnavailableState title={copy.title} message={copy.message} testID={`stall-unavailable-${reason}`} />
      </GlassCard>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, borderRadius: radius.card, borderWidth: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: space.sm },
});
