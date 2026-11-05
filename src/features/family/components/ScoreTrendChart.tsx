import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { rgba, space } from '@/ui/tokens';

import { scoreTrends, scoreY, trendSentence, type ScoreTrend, type Scores } from '../domain/progress';
import { shortDay } from '../domain/format';
import { SCORE_LABEL } from '../strings';

const PLOT_H = 44;
const PAD_X = 6;

/**
 * FA-02 score trends as SMALL MULTIPLES: one row per score on the same fixed 1–10 scale (one axis, no dual scales),
 * one hue (the accent), 2 px lines, ≥ 8 px markers with the latest point emphasised. Each row is one accessible
 * element whose label reads the values (the session list below is the table view). No smoothing, no projection.
 */
export function ScoreTrendChart({ sessions, testID = 'score-trends' }: { sessions: readonly { id: string; date: string; scores: Scores }[]; testID?: string }) {
  const trends = scoreTrends(sessions);
  const points = trends[0]?.points ?? [];
  if (points.length === 0) return null;
  return (
    <View testID={testID} style={styles.wrap}>
      {trends.map((t) => (
        <TrendRow key={t.key} trend={t} />
      ))}
      {points.length > 1 ? (
        <View style={styles.axisRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.labelCol} />
          <View style={[styles.plotCol, styles.axis]}>
            <AppText variant="caption" tone="muted">
              {shortDay(points[0]?.date ?? '')}
            </AppText>
            <AppText variant="caption" tone="muted">
              {shortDay(points[points.length - 1]?.date ?? '')}
            </AppText>
          </View>
          <View style={styles.valueCol} />
        </View>
      ) : null}
    </View>
  );
}

function TrendRow({ trend }: { trend: ScoreTrend }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const label = SCORE_LABEL[trend.key];
  const n = trend.points.length;
  const xs = trend.points.map((_, i) => (n === 1 ? w / 2 : PAD_X + (i * (w - PAD_X * 2)) / (n - 1)));
  const ys = trend.points.map((p) => scoreY(p.value, PLOT_H, 6));
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel={trendSentence(label, trend)} testID={`trend-${trend.key}`}>
      <AppText variant="secondary" tone="muted" style={styles.labelCol} numberOfLines={2}>
        {label}
      </AppText>
      <View style={[styles.plotCol, { height: PLOT_H }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} importantForAccessibility="no-hide-descendants">
        {/* recessive frame: the 10 and 1 lines of the shared scale */}
        <View style={[styles.grid, { top: scoreY(10, PLOT_H, 6), backgroundColor: rgba(colors.ink, 0.1) }]} />
        <View style={[styles.grid, { top: scoreY(1, PLOT_H, 6), backgroundColor: rgba(colors.ink, 0.1) }]} />
        {w > 0
          ? trend.points.slice(1).map((p, i) => {
              const x1 = xs[i] ?? 0;
              const y1 = ys[i] ?? 0;
              const x2 = xs[i + 1] ?? 0;
              const y2 = ys[i + 1] ?? 0;
              const len = Math.hypot(x2 - x1, y2 - y1);
              const angle = Math.atan2(y2 - y1, x2 - x1);
              return (
                <View
                  key={`seg-${p.sessionId}`}
                  style={[styles.segment, { left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1, width: len, backgroundColor: colors.accent, transform: [{ rotate: `${angle}rad` }] }]}
                />
              );
            })
          : null}
        {w > 0
          ? trend.points.map((p, i) => {
              const last = i === n - 1;
              const d = last ? 12 : 8;
              return (
                <View
                  key={`dot-${p.sessionId}`}
                  style={[
                    styles.dot,
                    { width: d, height: d, borderRadius: d / 2, left: (xs[i] ?? 0) - d / 2, top: (ys[i] ?? 0) - d / 2, backgroundColor: colors.accent, borderColor: colors.canvas, borderWidth: last ? 2 : 1.5 },
                  ]}
                />
              );
            })
          : null}
      </View>
      <View style={styles.valueCol}>
        <AppText variant="score" style={styles.value}>
          {trend.latest ?? '–'}
        </AppText>
        <AppText variant="caption" tone="muted">
          /10
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: PLOT_H + 4 },
  labelCol: { width: 76 },
  plotCol: { flex: 1, position: 'relative' },
  valueCol: { width: 52, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 1 },
  value: { fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'] },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  segment: { position: 'absolute', height: 2, borderRadius: 1 },
  dot: { position: 'absolute' },
  axisRow: { flexDirection: 'row', gap: space.md },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
