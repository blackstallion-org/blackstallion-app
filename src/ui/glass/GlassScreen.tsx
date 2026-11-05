import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { AppText } from '@/ui/components/AppText';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { rgba, size as sizes, space } from '@/ui/tokens';

import { floatingTabBottom, useFloatingTabInset, useInFloatingTabs } from './floatingTabInset';
import { GlassBackdropHost } from './GlassBackdrop';
import { GlassIconButton } from './GlassIconButton';
import { GlassSurface } from './GlassSurface';

/** Espresso (or warm paper) canvas with restrained amber light from the top: no full-orange gradients. */
export function AmbientBackdrop() {
  const { colors, scheme } = useTheme();
  const a = scheme === 'dark' ? 0.55 : 0.75;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas }]}>
      <LinearGradient
        colors={[rgba(colors.canvasGlow, a), rgba(colors.canvasGlow, a * 0.25), rgba(colors.canvasGlow, 0)]}
        locations={[0, 0.28, 0.6]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.55, y: 0.65 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export type GlassHeaderProps = {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Close (×) instead of back (←) for full-screen modals. */
  closeStyle?: boolean;
  trailing?: ReactNode;
};

export type GlassScreenProps = {
  children: ReactNode;
  testID?: string;
  /** Safe-area edges this screen owns. Under the floating tab bar, bottom is handled by the tab inset. */
  edges?: Edge[];
  scroll?: boolean;
  /** Lifts content above the software keyboard (forms). */
  keyboard?: boolean;
  /** Floating glass footer for the screen's primary action (above the tab bar when present). */
  footer?: ReactNode;
  /** 'ambient' (default): canvas + amber light; 'none'; or a node such as <PhotoBackdrop/>. */
  backdrop?: 'ambient' | 'none' | ReactNode;
  header?: GlassHeaderProps;
  /** Force a scheme for the whole screen (photo-led screens are composed in dark). */
  scheme?: 'dark' | 'light';
  contentStyle?: StyleProp<ViewStyle>;
  /** Content spans the full width (no screen inset). */
  fullBleed?: boolean;
};

/**
 * Page primitive: backdrop, safe areas, keyboard avoidance, floating-tab inset
 * (content is never hidden behind the tab bar), an optional fixed header with
 * a GlassIconButton back/close, and an optional floating action footer.
 */
export function GlassScreen(props: GlassScreenProps) {
  if (props.scheme) {
    return (
      <ThemeScope scheme={props.scheme}>
        <ScreenBody {...props} />
      </ThemeScope>
    );
  }
  return <ScreenBody {...props} />;
}

function ScreenBody({ children, testID, edges = ['top', 'left', 'right', 'bottom'], scroll = true, keyboard = false, footer, backdrop = 'ambient', header, contentStyle, fullBleed = false }: GlassScreenProps) {
  const { colors, scheme, appScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabInset = useFloatingTabInset();
  const inTabs = useInFloatingTabs();
  const [headerH, setHeaderH] = useState(0);
  const [footerH, setFooterH] = useState(0);

  const top = edges.includes('top') ? insets.top : 0;
  const bottomSafe = edges.includes('bottom') && !inTabs ? insets.bottom : 0;
  const side = fullBleed ? 0 : space.screenInset;
  const footerBottom = inTabs ? floatingTabBottom(insets.bottom) + sizes.tabBar + space.sm : Math.max(bottomSafe, space.md);
  const padTop = header ? headerH + space.sm : top + space.md;
  const padBottom = Math.max(tabInset, bottomSafe + space.xxl) + (footer ? footerH + space.md : 0);

  const backdropNode = backdrop === 'ambient' ? <AmbientBackdrop /> : backdrop === 'none' ? null : backdrop;
  const column = <View style={[styles.column, contentStyle]}>{children}</View>;
  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, { paddingTop: padTop, paddingBottom: padBottom, paddingLeft: side + insets.left, paddingRight: side + insets.right }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentInsetAdjustmentBehavior="never"
      scrollIndicatorInsets={{ bottom: padBottom - space.xxl }}
    >
      {column}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, { paddingTop: padTop, paddingBottom: padBottom, paddingLeft: side + insets.left, paddingRight: side + insets.right }]}>{column}</View>
  );

  return (
    <View testID={testID} style={[styles.fill, { backgroundColor: colors.canvas }]}>
      {/* Status bar follows the scheme in effect HERE (photo screens are dark even in the light theme). */}
      {scheme !== appScheme ? <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} /> : null}
      <GlassBackdropHost backdrop={backdropNode}>
        {keyboard ? (
          <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
        {header ? (
          <View style={[styles.header, { paddingTop: top + space.sm, paddingLeft: space.lg + insets.left, paddingRight: space.lg + insets.right }]} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
            <GlassHeader {...header} />
          </View>
        ) : null}
        {footer ? (
          <View pointerEvents="box-none" style={[styles.footer, { bottom: footerBottom, left: space.lg + insets.left, right: space.lg + insets.right }]} onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}>
            <GlassSurface material="thick" borderRadius={sizes.primaryAction / 2 + space.sm} contentStyle={styles.footerContent}>
              {footer}
            </GlassSurface>
          </View>
        ) : null}
      </GlassBackdropHost>
    </View>
  );
}

/** Back/close + title + trailing actions. Title is a header for screen readers. */
export function GlassHeader({ title, onBack, backLabel = 'Back', closeStyle = false, trailing }: GlassHeaderProps) {
  return (
    <View style={styles.headerRow}>
      {onBack ? <GlassIconButton icon={closeStyle ? 'close' : 'chevron-back'} accessibilityLabel={closeStyle ? 'Close' : backLabel} onPress={onBack} material="thick" testID="header-back" /> : null}
      <View style={styles.headerTitle}>
        {title ? (
          <AppText variant="bodyStrong" header numberOfLines={1}>
            {title}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.headerTrailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1 },
  column: { width: '100%', maxWidth: sizes.contentMaxWidth, alignSelf: 'center', gap: space.lg },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: sizes.minTouch },
  headerTitle: { flex: 1 },
  headerTrailing: { flexDirection: 'row', gap: space.sm },
  footer: { position: 'absolute' },
  footerContent: { padding: space.sm, gap: space.xs },
});
