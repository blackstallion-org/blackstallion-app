import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { size as sizes, space } from '@/ui/tokens';

type ScreenProps = {
  children: ReactNode;
  /**
   * Safe-area edges this screen owns. Tab screens leave 'bottom' to the tab
   * bar; screens under a native header leave 'top' to the header.
   */
  edges?: Edge[];
  scroll?: boolean;
  /** Lifts content above the software keyboard (forms). */
  keyboard?: boolean;
  testID?: string;
  footer?: ReactNode;
};

export function Screen({ children, edges = ['top', 'left', 'right', 'bottom'], scroll = true, keyboard = false, testID, footer }: ScreenProps) {
  const { colors } = useTheme();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentInsetAdjustmentBehavior="never"
    >
      <View style={styles.column}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill]}>
      <View style={[styles.column, styles.fill]}>{children}</View>
    </View>
  );
  const body = (
    <>
      {content}
      {footer ? <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View> : null}
    </>
  );
  return (
    <SafeAreaView testID={testID} edges={edges} style={[styles.fill, { backgroundColor: colors.canvas }]}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.screenInset, paddingBottom: space.xxl, flexGrow: 1 },
  column: { width: '100%', maxWidth: sizes.contentMaxWidth, alignSelf: 'center', gap: space.lg },
  footer: { paddingHorizontal: space.screenInset, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
