import { useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type DimensionValue, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon } from '@/ui/components/Icon';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { radius as radii, size as sizes, space, type GlassMaterial, type ScrimName, type Tone } from '@/ui/tokens';

import { GlassSurface } from './GlassSurface';
import { PhotoBackdrop } from './PhotoBackdrop';
import { PressDecor, usePressFeedback } from './pressFeedback';
import { useWaterTrigger, WaterGlass, WaterRipple } from './WaterGlass';

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
      /**
       * Editorial image block: the picture in its own hard-edged frame, joined to ONE flat colour block that carries
       * the copy (default brown, white text — `onPhoto` tones stay legible). Never text over the picture. `scrim` is
       * ignored. `cutout` shows a transparent cut-out whole (contain) on the block colour instead of a cropped photo.
       */
      variant: 'photo';
      image: ImageSourcePropType;
      scrim?: ScrimName;
      height?: DimensionValue;
      imageStyle?: StyleProp<ViewStyle>;
      block?: Tone;
      cutout?: boolean;
    });

export function GlassCard(props: GlassCardProps) {
  const { children, onPress, accessibilityLabel, accessibilityHint, expandable, expandedContent, defaultExpanded = false, expandLabel = 'Show more', collapseLabel = 'Show less', material = 'regular', style, contentStyle, testID } = props;
  const photo = props.variant === 'photo';
  const r = props.radius ?? (photo ? radii.hero : radii.card);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { scaleStyle, focused, handlers } = usePressFeedback();
  const water = useWaterTrigger();

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
      // Editorial image block (6 Nov 2026): photograph in its own frame + one flat colour block for the copy.
      <ThemeScope tone={props.block ?? 'brown'}>
        <PhotoBlock r={r} height={props.height} image={props.image} imageStyle={props.imageStyle} cutout={props.cutout} style={style} contentStyle={contentStyle} testID={onPress ? undefined : testID}>
          <PressDecor pressed={pressed} focused={focused} radius={r} />
          {onPress ? <WaterRipple point={water.point} radius={r} /> : null}
          {inner}
        </PhotoBlock>
      </ThemeScope>
    ) : (
      <GlassSurface material={material} borderRadius={r} style={style} contentStyle={[styles.content, contentStyle]} testID={onPress ? undefined : testID}>
        <PressDecor pressed={pressed} focused={focused} radius={r} />
        {onPress ? <WaterRipple point={water.point} radius={r} /> : null}
        {inner}
      </GlassSurface>
    );

  if (!onPress) return surface(false);
  return (
    <Animated.View style={scaleStyle}>
      <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} {...handlers} onPressIn={(e) => {
          handlers.onPressIn();
          water.onPressIn(e);
        }}>
        {({ pressed }) => surface(pressed)}
      </Pressable>
    </Animated.View>
  );
}

function PhotoBlock({ r, height, image, imageStyle, cutout, style, contentStyle, testID, children }: { r: number; height?: DimensionValue; image: ImageSourcePropType; imageStyle?: StyleProp<ViewStyle>; cutout?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; testID?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.photo, { borderRadius: r, backgroundColor: colors.canvas }, style]} testID={testID}>
      <View style={[styles.frame, { height: height ?? 220, backgroundColor: cutout ? colors.canvas : colors.surfaceMuted }]}>
        <PhotoBackdrop source={image} imageStyle={imageStyle} resizeMode={cutout ? 'contain' : 'cover'} style={cutout ? styles.cutoutPad : undefined} />
        {cutout ? null : <WaterGlass radius={0} level="pane" />}
      </View>
      <View style={[styles.photoContent, contentStyle]} pointerEvents="box-none">
        {children}
      </View>
    </View>
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
  photo: { overflow: 'hidden' },
  frame: { overflow: 'hidden' },
  cutoutPad: { top: space.md, bottom: 0, left: space.md, right: space.md },
  photoContent: { gap: space.sm, padding: space.screenInset },
  toggle: { minHeight: sizes.minTouch, flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' },
});
