import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { GlassIconButton } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { SCORE_MAX, SCORE_MIN, type ScoreKey } from '../domain/assessment';
import { useFieldStrings } from '../i18n';

const FIRST_VALUE = 5; // first +/− press on an unset score starts in the middle of the scale

export const stepScore = (v: number | null, d: 1 | -1): number => (v === null ? FIRST_VALUE : Math.min(SCORE_MAX, Math.max(SCORE_MIN, v + d)));

/**
 * One score 1–10: large tabular value between 56 pt −/+ glass buttons. The row is one adjustable control for screen
 * readers (swipe up/down), and the buttons stay for touch.
 */
export function ScoreStepper({ k, value, error, disabled, onChange }: { k: ScoreKey; value: number | null; error?: string; disabled: boolean; onChange: (v: number) => void }) {
  const s = useFieldStrings();
  const label = s.t(`scores.${k}`);
  return (
    <View style={styles.stepper}>
      <View
        style={styles.row}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={s.t('scores.a11y', { label })}
        accessibilityValue={{ min: SCORE_MIN, max: SCORE_MAX, now: value ?? undefined, text: value === null ? s.t('scores.notSet') : s.t('scores.of', { value, max: SCORE_MAX }) }}
        accessibilityState={{ disabled }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (!disabled) onChange(stepScore(value, e.nativeEvent.actionName === 'increment' ? 1 : -1));
        }}
        testID={`score-${k}`}
      >
        <AppText variant="bodyStrong" style={styles.label}>
          {label}
        </AppText>
        <GlassIconButton icon="remove" size={56} disabled={disabled} accessibilityLabel={s.t('scores.lower', { label })} onPress={() => onChange(stepScore(value, -1))} testID={`score-${k}-down`} />
        <AppText variant="score" style={styles.value} testID={`score-${k}-value`}>
          {value === null ? '–' : String(value)}
        </AppText>
        <GlassIconButton icon="add" size={56} disabled={disabled} accessibilityLabel={s.t('scores.raise', { label })} onPress={() => onChange(stepScore(value, 1))} testID={`score-${k}-up`} />
      </View>
      {error ? (
        <AppText tone="danger" variant="secondary" accessibilityLiveRegion="polite" testID={`score-${k}-error`}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64 },
  label: { flex: 1, fontSize: 18, lineHeight: 24 },
  value: { minWidth: 44, textAlign: 'center' },
});
