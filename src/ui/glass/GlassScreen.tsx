import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { AppText } from '@/ui/components/AppText';
import { toneForScreen } from '@/ui/screenTones';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, space, type Tone } from '@/ui/tokens';

import { floatingTabBottom, useFloatingTabInset, useInFloatingTabs } from './floatingTabInset';
import { GlassBackdropHost } from './GlassBackdrop';
import { GlassIconButton } from './GlassIconButton';

/** The screen's flat tone colour, edge to edge (no glow, no gradient). Name kept for existing callers. */
export function AmbientBackdrop() {
  const { colors } = useTheme();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas }]} />;
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
  /** Force a scheme for the whole screen. Prefer `tone`. */
  scheme?: 'dark' | 'light';
  /** The screen's ONE dominant flat background (see ui/screenTones.ts for the assignments). Default: white. */
  tone?: Tone;
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
  const tone = props.tone ?? toneForScreen(props.testID);
  if (props.scheme || tone) {
    return (
      <ThemeScope scheme={tone ? undefined : props.scheme} tone={tone}>
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
            <View style={[styles.footerContent, { backgroundColor: colors.canvas }]}>{footer}</View>
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
          <AppText variant="headline" header numberOfLines={1}>
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
  footerContent: { paddingTop: space.sm, gap: space.xs },
});
