import { useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type DimensionValue, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon } from '@/ui/components/Icon';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii, size as sizes, space, type GlassMaterial, type ScrimName } from '@/ui/tokens';

import { GlassBackdropHost } from './GlassBackdrop';
import { GlassSurface } from './GlassSurface';
import { PhotoBackdrop } from './PhotoBackdrop';
import { PressDecor, usePressFeedback } from './pressFeedback';

type CardBase = {
  children?: ReactNode;
  /** Makes the whole card one accessible button; requires an explicit label. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Expandable cards show `expandedContent` behind a labelled toggle. No drag (brief: disabled by default). */
  expandable?: boolean;
  expandedContent?: ReactNode;
  defaultExpanded?: boolean;
  expandLabel?: string;
  collapseLabel?: string;
  material?: GlassMaterial;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export type GlassCardProps =
  | (CardBase & { variant?: 'regular' })
  | (CardBase & {
      /** Editorial photo card: radius 28–36 (default 32), espresso scrim, content in the dark scope. */
      variant: 'photo';
      image: ImageSourcePropType;
      scrim?: ScrimName;
      height?: DimensionValue;
      imageStyle?: StyleProp<ViewStyle>;
    });

export function GlassCard(props: GlassCardProps) {
  const { children, onPress, accessibilityLabel, accessibilityHint, expandable, expandedContent, defaultExpanded = false, expandLabel = 'Show more', collapseLabel = 'Show less', material = 'regular', style, contentStyle, testID } = props;
  const photo = props.variant === 'photo';
  const r = props.radius ?? (photo ? radii.hero : radii.card);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { scaleStyle, focused, handlers } = usePressFeedback();

  const inner = (
    <>
      {children}
      {expandable ? (
        <>
          {expanded ? expandedContent : null}
          <ExpandToggle expanded={expanded} label={expanded ? collapseLabel : expandLabel} onPress={() => setExpanded((v) => !v)} />
        </>
      ) : null}
    </>
  );

  const surface = (pressed: boolean) =>
    photo ? (
      <ThemeScope scheme="dark">
        <View style={[styles.photo, { borderRadius: r, height: props.height }, style]} testID={onPress ? undefined : testID}>
          {/* The photo is the blur source for glass chips on the card (Android BlurTargetView). */}
          <GlassBackdropHost backdrop={<PhotoBackdrop source={props.image} scrim={props.scrim ?? 'card'} imageStyle={props.imageStyle} style={{ borderRadius: r }} />}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.photoRim, { borderRadius: r }]} />
            <PressDecor pressed={pressed} focused={focused} radius={r} />
            <View style={[styles.photoContent, contentStyle]} pointerEvents="box-none">
              {inner}
            </View>
          </GlassBackdropHost>
        </View>
      </ThemeScope>
    ) : (
      <GlassSurface material={material} borderRadius={r} style={style} contentStyle={[styles.content, contentStyle]} testID={onPress ? undefined : testID}>
        <PressDecor pressed={pressed} focused={focused} radius={r} />
        {inner}
      </GlassSurface>
    );

  if (!onPress) return surface(false);
  return (
    <Animated.View style={scaleStyle}>
      <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} {...handlers}>
        {({ pressed }) => surface(pressed)}
      </Pressable>
    </Animated.View>
  );
}

function ExpandToggle({ expanded, label, onPress }: { expanded: boolean; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={label} onPress={onPress} style={styles.toggle}>
      <AppText variant="secondary" tone="accent" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.accentText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screenInset, gap: space.md },
  photo: { overflow: 'hidden', justifyContent: 'flex-end' },
  photoRim: { borderWidth: 1, borderColor: 'rgba(255, 233, 210, 0.16)' },
  photoContent: { flexGrow: 1, padding: space.screenInset, gap: space.md, justifyContent: 'flex-end' },
  toggle: { minHeight: sizes.minTouch, flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' },
});
