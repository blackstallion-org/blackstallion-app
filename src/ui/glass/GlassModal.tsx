import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, StyleSheet, View, type Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/ui/components/AppText';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { radius, rgba, size as sizes, space } from '@/ui/tokens';

import { GlassButton } from './GlassButton';
import { GlassSurface } from './GlassSurface';
import type { IconName } from '@/ui/components/Icon';
import type { PressHandler } from './usePressGuard';

/**
 * Moves screen-reader focus to the title when a sheet/dialog opens (iOS/Android).
 * On web, react-native-web's Modal focus trap already moves focus inside.
 */
function useInitialFocus(visible: boolean) {
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const t = setTimeout(() => {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 120);
    return () => clearTimeout(t);
  }, [visible]);
  return ref;
}

function Scrim({ onPress, label, dismissible }: { onPress: () => void; label: string; dismissible: boolean }) {
  const { colors } = useTheme();
  return dismissible ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[StyleSheet.absoluteFill, { backgroundColor: rgba(colors.scrim, 0.62) }]}
      testID="modal-scrim"
    />
  ) : (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: rgba(colors.scrim, 0.62) }]} />
  );
}

export type GlassBottomSheetProps = {
  visible: boolean;
  /** Called by the scrim, Android back and Escape (web). */
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons row/stack at the bottom. */
  actions?: ReactNode;
  /** When false, the scrim/back/escape do nothing (e.g. while a write is in flight). */
  dismissible?: boolean;
  closeLabel?: string;
  testID?: string;
};

/**
 * Modal bottom sheet on thick glass. Focus moves to the title on open; the
 * sheet is modal for VoiceOver (accessibilityViewIsModal); Android back and
 * web Escape call onClose. Slides unless Reduce Motion is on (then fades).
 */
export function GlassBottomSheet({ visible, onClose, title, description, children, actions, dismissible = true, closeLabel = 'Close', testID }: GlassBottomSheetProps) {
  const { reduceMotion, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const titleRef = useInitialFocus(visible);
  const close = () => {
    if (dismissible) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <ThemeScope scheme={scheme}>
        <View style={styles.sheetRoot}>
          <Scrim onPress={close} label={closeLabel} dismissible={dismissible} />
          {/* VoiceOver treats the scrim as outside the modal; its escape gesture closes instead. */}
          <View accessibilityViewIsModal onAccessibilityEscape={close} testID={testID} style={styles.sheetHost}>
            <GlassSurface material="thick" borderRadius={radius.sheet} style={styles.sheet} contentStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
              <View style={styles.grabber} accessible={false} importantForAccessibility="no-hide-descendants" />
              <AppText ref={titleRef} variant="section" header>
                {title}
              </AppText>
              {description ? <AppText tone="muted">{description}</AppText> : null}
              {children}
              {actions ? <View style={styles.actions}>{actions}</View> : null}
            </GlassSurface>
          </View>
        </View>
      </ThemeScope>
    </Modal>
  );
}

export type GlassDialogProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  children?: ReactNode;
  actions: ReactNode;
  dismissible?: boolean;
  testID?: string;
};

/** Centred modal dialog on thick glass (same focus/escape/back rules as the sheet). */
export function GlassDialog({ visible, onClose, title, message, children, actions, dismissible = true, testID }: GlassDialogProps) {
  const { scheme } = useTheme();
  const titleRef = useInitialFocus(visible);
  const close = () => {
    if (dismissible) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <ThemeScope scheme={scheme}>
        <View style={styles.dialogRoot}>
          <Scrim onPress={close} label="Close" dismissible={dismissible} />
          <View accessibilityViewIsModal onAccessibilityEscape={close} testID={testID} style={styles.dialogHost}>
            <GlassSurface material="thick" borderRadius={28} contentStyle={styles.dialogContent}>
              <AppText ref={titleRef} variant="section" header>
                {title}
              </AppText>
              {message ? <AppText tone="muted">{message}</AppText> : null}
              {children}
              <View style={styles.actions}>{actions}</View>
            </GlassSurface>
          </View>
        </View>
      </ThemeScope>
    </Modal>
  );
}

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive confirmations need an icon + explicit text (never colour alone). */
  destructiveIcon?: IconName;
  /** May return a promise: the confirm button shows busy and ignores repeat presses until it settles. */
  onConfirm: PressHandler;
  onCancel: () => void;
  testID?: string;
};

export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', destructiveIcon, onConfirm, onCancel, testID }: ConfirmDialogProps) {
  return (
    <GlassDialog
      visible={visible}
      onClose={onCancel}
      title={title}
      message={message}
      testID={testID}
      actions={
        <>
          {destructiveIcon ? (
            <GlassButton variant="destructive" icon={destructiveIcon} label={confirmLabel} onPress={onConfirm} testID={testID ? `${testID}-confirm` : undefined} />
          ) : (
            <GlassButton label={confirmLabel} onPress={onConfirm} testID={testID ? `${testID}-confirm` : undefined} />
          )}
          <GlassButton variant="secondary" label={cancelLabel} onPress={onCancel} testID={testID ? `${testID}-cancel` : undefined} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetHost: { paddingHorizontal: space.sm },
  sheet: { width: '100%', maxWidth: sizes.contentMaxWidth, alignSelf: 'center' },
  sheetContent: { paddingHorizontal: space.screenInset, paddingTop: space.sm, gap: space.md },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255, 233, 210, 0.35)', marginBottom: space.sm },
  actions: { gap: space.sm, marginTop: space.sm },
  dialogRoot: { flex: 1, justifyContent: 'center', padding: space.screenInset },
  dialogHost: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  dialogContent: { padding: space.xl, gap: space.md },
});
