import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { Chip, EmptyState, GlassCard, SyntheticDataBanner } from '@/ui/glass';
import { space, type GlassMaterial } from '@/ui/tokens';

import { useFamily } from '../FamilyContext';
import { COMMON } from '../strings';

/** Tab-root heading: small accent eyebrow + screen title (header role) + optional subtitle. */
export function FamilyTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.title}>
      {eyebrow ? (
        <AppText variant="secondary" tone="accent" style={styles.eyebrow}>
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="title" header>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="secondary" tone="muted">
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

/** Child selector (SH-05 inline control): radio chips, only when more than one child is linked. */
export function ChildSwitcher({ testID = 'child-switcher', material = 'regular' }: { testID?: string; material?: GlassMaterial }) {
  const { linked, selected, select } = useFamily();
  if (linked.length < 2 || !selected) return null;
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={COMMON.childGroup} style={styles.chips}>
      {linked.map((c) => (
        <Chip key={c.id} role="radio" label={c.firstName} selected={c.id === selected.id} onPress={() => select(c.id)} material={material} testID={`${testID}-${c.id}`} />
      ))}
    </View>
  );
}

export function SyntheticBanner({ source }: { source: 'synthetic-preview' | 'server' }) {
  return source === 'synthetic-preview' ? <SyntheticDataBanner /> : null;
}

export function NoLinkedChild({ testID }: { testID: string }) {
  return (
    <GlassCard>
      <EmptyState testID={`${testID}-no-child`} icon="people-outline" title={COMMON.noChildTitle} message={COMMON.noChild} />
    </GlassCard>
  );
}

/** Back that always lands somewhere sensible: history when present, otherwise the given parent (deep-link entry). */
export function useBackTo(parent: Href) {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace(parent));
}

const styles = StyleSheet.create({
  title: { gap: 2 },
  eyebrow: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
