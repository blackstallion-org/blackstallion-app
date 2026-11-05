import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { rgba } from '@/ui/tokens';

import { presentWaveform, waveformFromSamples } from './domain/waveform';
import { SPARK_COPY } from './strings';

/**
 * 32-bar waveform drawn ONLY from measured peaks of this audio. With no data
 * it renders nothing (no decorative stand-in). Played bars take the golden-hour
 * tint; the bars never animate on their own (static, so Reduce Motion needs no
 * special case beyond the position colouring).
 */
export function SparkWaveform({ peaks, progress, testID }: { peaks: readonly number[] | null; progress: number; testID?: string }) {
  const { colors } = useTheme();
  const wave = waveformFromSamples(peaks, 32);
  const presentation = presentWaveform(wave, true);
  if (!presentation.show || wave.kind !== 'measured') return null;
  const playedBars = Math.round(progress * wave.bars.length);
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={presentation.accessibilityLabel ?? SPARK_COPY.waveformLabel} style={styles.row}>
      {wave.bars.map((b, i) => (
        <View
          key={i}
          style={[styles.bar, { height: 6 + Math.round(b * 34), backgroundColor: i < playedBars ? colors.accent : rgba(colors.onPhoto, 0.42) }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, gap: 2 },
  bar: { flex: 1, maxWidth: 6, borderRadius: 3 },
});
