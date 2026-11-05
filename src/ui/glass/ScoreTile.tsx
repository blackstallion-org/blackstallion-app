import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

/**
 * One score: tabular numerals in the score role, never liquid/distorted. The
 * tile reads as "Riding 8 out of 10" to screen readers. A thin track shows the
 * value against the scale; it is not the only carrier of meaning.
 */
export function ScoreTile({ label, value, max = 10, testID }: { label: string; value: number | null; max?: number; testID?: string }) {
  const { colors } = useTheme();
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <View
      testID={testID}
      style={styles.tile}
      accessible
      accessibilityLabel={value === null ? `${label}, not scored` : `${label} ${value} out of ${max}`}
    >
      <View style={styles.valueRow}>
        <AppText variant="score">{value === null ? '–' : String(value)}</AppText>
        <AppText variant="secondary" tone="muted" style={styles.max}>
          /{max}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.accent }]} />
      </View>
      <AppText variant="secondary" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 80, gap: space.xs + 2 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  max: { marginBottom: 2 },
  track: { height: 4, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.pill },
});
