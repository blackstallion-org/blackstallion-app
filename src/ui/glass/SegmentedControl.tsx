import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, space, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';

export type Segment<T extends string> = { value: T; label: string };

/** One glass track; the selected segment is a golden-hour thumb. Radio semantics. */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
  material = 'regular',
  testID,
}: {
  /** Accessible group name. */
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  material?: GlassMaterial;
  testID?: string;
}) {
  return (
    <GlassSurface
      testID={testID}
      material={material}
      borderRadius={(sizes.minTouch + 8) / 2}
      elevated={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      contentStyle={styles.track}
    >
      {segments.map((s) => (
        <SegmentButton key={s.value} segment={s} selected={s.value === value} onPress={() => onChange(s.value)} testID={testID ? `${testID}-${s.value}` : undefined} />
      ))}
    </GlassSurface>
  );
}

function SegmentButton<T extends string>({ segment, selected, onPress, testID }: { segment: Segment<T>; selected: boolean; onPress: () => void; testID?: string }) {
  const { colors, glass } = useTheme();
  const { focused, handlers } = usePressFeedback();
  const r = sizes.minTouch / 2;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={segment.label}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      style={[styles.segment, { borderRadius: r }]}
    >
      {({ pressed }) => (
        <>
          {selected ? <GlassSurface pointerEvents="none" fill="action" borderRadius={r} elevated={false} style={StyleSheet.absoluteFill} /> : null}
          <PressDecor pressed={pressed && !selected} focused={focused} radius={r} />
          <AppText variant="secondary" align="center" numberOfLines={1} style={{ color: selected ? glass.action.text : colors.ink, fontWeight: '600' }}>
            {segment.label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: space.xs, gap: space.xs },
  segment: { flex: 1, minHeight: sizes.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
});
