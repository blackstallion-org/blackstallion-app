import { Children, isValidElement, memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, size as sizes, space, type GlassMaterial } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PressDecor, usePressFeedback } from './pressFeedback';

/**
 * Dense operational data: flat rows inside ONE glass group (not a card per
 * row). Optional section title sits outside the glass, in sentence case.
 */
export function ListGroup({
  title,
  children,
  footer,
  material = 'regular',
  testID,
  style,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  material?: GlassMaterial;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {title ? (
        <AppText variant="secondary" tone="muted" header style={styles.title}>
          {title}
        </AppText>
      ) : null}
      <GlassSurface material={material} borderRadius={radius.card} contentStyle={styles.group}>
        {rows.map((row, i) => (
          <View key={row.key ?? i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            {row}
          </View>
        ))}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </GlassSurface>
    </View>
  );
}

export type RowProps = {
  label: string;
  value?: string;
  icon?: IconName;
  /** Right-hand content (badge, button). Not part of the row's press target. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** Larger label for sunlight-readable operational lists. */
  emphasis?: boolean;
};

/** A flat row: label + value, optional icon and trailing content; pressable rows show a chevron. */
export const Row = memo(function Row({ label, value, icon, trailing, onPress, accessibilityLabel, accessibilityHint, testID, emphasis = false }: RowProps) {
  const { colors } = useTheme();
  const { focused, handlers } = usePressFeedback();
  const name = accessibilityLabel ?? [label, value].filter(Boolean).join(', ');
  const body = (
    <>
      {icon ? (
        <View style={[styles.iconWell, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name={icon} size={18} color={colors.accentText} />
        </View>
      ) : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" style={emphasis ? styles.emphasis : undefined}>
          {label}
        </AppText>
        {value ? (
          <AppText variant="secondary" tone="muted">
            {value}
          </AppText>
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        <View style={styles.main} accessible accessibilityLabel={name}>
          {body}
        </View>
        {trailing}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={accessibilityHint}
        {...handlers}
        style={styles.main}
      >
        {({ pressed }) => (
          <>
            <PressDecor pressed={pressed} focused={focused} radius={radius.control} />
            {body}
            {!trailing ? <Icon name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
          </>
        )}
      </Pressable>
      {trailing}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  title: { paddingHorizontal: space.xs },
  group: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: sizes.minTouch + 8 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: sizes.minTouch + 8, paddingVertical: space.md },
  iconWell: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  emphasis: { fontSize: 18, lineHeight: 24 },
  footer: { paddingVertical: space.md },
});
