import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/ui/components';
import { AmbientBackdrop, GlassIconButton, GlassSurface } from '@/ui/glass';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, space } from '@/ui/tokens';

/**
 * Full-screen capture layout shared by FO-02 (scan) and FO-04 (capture): the live camera edge to edge, a glass close
 * button and title capsule on top, an optional centred overlay (scan frame), and a thick-glass panel at the bottom for
 * status and actions. Always dark-scoped (white text over a camera picture). Text never sits on the raw picture:
 * it sits on thick glass.
 */
export function CameraStage({
  title,
  onClose,
  closeLabel,
  trailing,
  camera,
  overlay,
  panel,
  testID,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  trailing?: ReactNode;
  /** The live preview (absolute fill) or null when the camera isn't running. */
  camera?: ReactNode;
  overlay?: ReactNode;
  panel: ReactNode;
  testID?: string;
}) {
  return (
    <ThemeScope scheme="dark">
      <StageBody title={title} onClose={onClose} closeLabel={closeLabel} trailing={trailing} camera={camera} overlay={overlay} panel={panel} testID={testID} />
    </ThemeScope>
  );
}

function StageBody({ title, onClose, closeLabel, trailing, camera, overlay, panel, testID }: Parameters<typeof CameraStage>[0]) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]} testID={testID}>
      {camera ? <View style={StyleSheet.absoluteFill}>{camera}</View> : <AmbientBackdrop />}
      {overlay ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {overlay}
        </View>
      ) : null}
      <View style={[styles.top, { paddingTop: insets.top + space.sm, paddingLeft: space.lg + insets.left, paddingRight: space.lg + insets.right }]}>
        <GlassIconButton icon="close" accessibilityLabel={closeLabel} onPress={onClose} material="thick" testID="header-back" />
        <GlassSurface material="thick" borderRadius={24} elevated={false} style={styles.titlePill} contentStyle={styles.titleContent}>
          <AppText variant="bodyStrong" header numberOfLines={1}>
            {title}
          </AppText>
        </GlassSurface>
        <View style={styles.trailing}>{trailing}</View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomHost} pointerEvents="box-none">
        <GlassSurface
          material="thick"
          borderRadius={radius.sheet}
          style={[styles.panel, { marginLeft: space.sm + insets.left, marginRight: space.sm + insets.right, maxHeight: Math.max(280, height * 0.62) }]}
        >
          <ScrollView
            contentContainerStyle={[styles.panelContent, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {panel}
          </ScrollView>
        </GlassSurface>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Square scan frame with corner marks; the area outside is dimmed so the target is obvious in sunlight. */
export function ScanFrame({ size }: { size: number }) {
  const { colors } = useTheme();
  const dim = rgba(colors.scrim, 0.55);
  const mark = { position: 'absolute' as const, width: 36, height: 36, borderColor: colors.accent };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[styles.flex, { backgroundColor: dim }]} />
      <View style={{ flexDirection: 'row', height: size }}>
        <View style={[styles.flex, { backgroundColor: dim }]} />
        <View style={{ width: size, height: size }}>
          <View style={[mark, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 }]} />
          <View style={[mark, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 }]} />
          <View style={[mark, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 }]} />
          <View style={[mark, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 }]} />
        </View>
        <View style={[styles.flex, { backgroundColor: dim }]} />
      </View>
      <View style={[styles.flex, styles.flexMore, { backgroundColor: dim }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  flexMore: { flex: 1.6 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  titlePill: { flexShrink: 1 },
  titleContent: { paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center' },
  trailing: { marginLeft: 'auto', flexDirection: 'row', gap: space.sm },
  bottomHost: { flex: 1, justifyContent: 'flex-end' },
  panel: {},
  panelContent: { paddingHorizontal: space.screenInset, paddingTop: space.lg, gap: space.md },
});
