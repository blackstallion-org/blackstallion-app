import { useRouter } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/ui/components';
import { imageLibrary } from '@/ui/imageLibrary';
import { EmptyState, GlassCard, GlassScreen, ListGroup, Pill, Row, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { ChildSwitcher, FamilyTitle, NoLinkedChild, SyntheticBanner } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import type { FamilyChild, HorseInfo } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { useFamilyResource } from '../hooks';
import { HORSE_COPY } from '../strings';

/**
 * FA-07 Horse (tab root). The child's assigned horse from safe server columns only (no microchip, no camera link,
 * no staff identity). No approved horse photography exists, so the portrait is the editorial illustration, labelled
 * as such — never presented as this horse. Care status is not shared with families yet (SD-04): said plainly.
 */
export function HorseScreen() {
  const { repos, selected, linked } = useFamily();
  return (
    <GlassScreen edges={['top', 'left', 'right']} testID="family-horse">
      <FamilyTitle eyebrow={linked.length === 1 ? selected?.firstName : undefined} title={HORSE_COPY.eyebrow} />
      <ChildSwitcher />
      {!repos ? <FamilyUnconnected testID="horse" /> : !selected ? <NoLinkedChild testID="horse" /> : <HorseLoader key={selected.id} child={selected} />}
    </GlassScreen>
  );
}

function HorseLoader({ child }: { child: FamilyChild }) {
  const { scope } = useFamily();
  const res = useFamilyResource(['horse', child.id], (r) => r.horse.get(scope, child.id));
  return (
    <ResourceGate resource={res} loadingLabel={HORSE_COPY.loading} rows={2} testID="horse">
      {(data) => <HorseBody data={data} child={child} />}
    </ResourceGate>
  );
}

function HorseBody({ data, child }: { data: HorseInfo; child: FamilyChild }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const horse = data.horse;
  if (!horse) {
    return (
      <>
        <SyntheticBanner source={data.source} />
        <GlassCard>
          <EmptyState testID="horse-empty" icon="help-buoy-outline" title={HORSE_COPY.emptyTitle} message={HORSE_COPY.empty(child.firstName)} />
        </GlassCard>
      </>
    );
  }
  const heroH = Math.round(Math.min(300, Math.max(180, (Math.min(width, 560) - 40) * 0.72)));
  return (
    <>
      <SyntheticBanner source={data.source} />
      <GlassCard variant="photo" image={imageLibrary.horseBadal.source} cutout block="fir" height={heroH} testID="horse-hero" contentStyle={styles.heroContent}>
        <View style={styles.heroTop}>
          <Pill label={HORSE_COPY.illustration} icon="color-palette-outline" material="thick" testID="horse-illustration-label" />
        </View>
        <View style={styles.heroBottom}>
          <AppText variant="secondary" tone="onPhotoMuted">
            {HORSE_COPY.forChild(child.firstName)}
          </AppText>
          <AppText variant="title" tone="onPhoto" header numberOfLines={2} testID="horse-name">
            {horse.name}
          </AppText>
          <AppText variant="secondary" tone="onPhoto">
            {[horse.breed, horse.heightHands ? HORSE_COPY.hands(horse.heightHands) : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </GlassCard>

      <ListGroup title={HORSE_COPY.factsTitle} testID="horse-facts">
        {horse.breed ? <Row icon="leaf-outline" label={HORSE_COPY.breed} value={horse.breed} /> : null}
        {horse.heightHands ? <Row icon="resize-outline" label={HORSE_COPY.height} value={HORSE_COPY.hands(horse.heightHands)} /> : null}
        {horse.temperament ? <Row icon="happy-outline" label={HORSE_COPY.temperament} value={horse.temperament} /> : null}
        {data.hubName ? <Row icon="location-outline" label={HORSE_COPY.hub} value={data.hubName} /> : null}
        <Row icon="pulse-outline" label={HORSE_COPY.status} value={horse.active ? HORSE_COPY.active : HORSE_COPY.resting} />
      </ListGroup>

      <StatusNote tone="info" title={HORSE_COPY.careTitle} message={HORSE_COPY.care} testID="horse-care-unavailable" />

      <ListGroup title={HORSE_COPY.cameraTitle}>
        <Row icon="videocam-outline" label={HORSE_COPY.cameraAction} value={HORSE_COPY.cameraBody} onPress={() => router.push('/family/horse/stall-cam')} testID="open-stall-cam" />
      </ListGroup>
    </>
  );
}

const styles = StyleSheet.create({
  heroContent: { gap: space.md, paddingHorizontal: 0 },
  heroTop: { flexDirection: 'row' },
  heroBottom: { gap: space.xs },
});
