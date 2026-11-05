import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';

import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { motion, radius, rgba, size as sizes, space } from '@/ui/tokens';

import { GlassButton } from './GlassButton';
import { GlassSurface } from './GlassSurface';
import { toneColors, type StatusTone } from './StatusBadge';

/** Placeholder block. Pulses unless the OS asks for reduced motion. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: DimensionValue }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: motion.skeletonPulse, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.skeletonPulse, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View style={{ height, width, borderRadius: radius.sm, backgroundColor: colors.skeleton, opacity: pulse }} />;
}

/**
 * Skeleton matching the final layout. It never renders data, so nothing from a
 * previous person or context can show while loading.
 */
export function LoadingState({ label, rows = 3, testID }: { label: string; rows?: number; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityLabel={label} accessibilityState={{ busy: true }} accessibilityRole="progressbar" style={styles.stack}>
      {Array.from({ length: rows }, (_, i) => (
        <GlassSurface key={i} borderRadius={radius.card} elevated={false} contentStyle={styles.skeletonCard}>
          <Skeleton height={12} width="40%" />
          <Skeleton height={20} width="85%" />
          <Skeleton height={14} width="60%" />
        </GlassSurface>
      ))}
    </View>
  );
}

export type StateAction = { label: string; onPress: () => void | Promise<unknown>; icon?: IconName };

function StateShell({
  icon,
  iconTone = 'accent',
  title,
  message,
  alert,
  children,
  testID,
}: {
  icon: IconName;
  iconTone?: 'accent' | 'danger' | 'warning' | 'muted';
  title: string;
  message: string;
  alert?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const iconColor = iconTone === 'danger' ? colors.dangerText : iconTone === 'warning' ? colors.warningText : iconTone === 'muted' ? colors.inkMuted : colors.accent;
  return (
    <View testID={testID} style={styles.centered}>
      <View style={[styles.iconDisc, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        <Icon name={icon} size={28} color={iconColor} />
      </View>
      <AppText variant="section" header align="center" accessibilityRole={alert ? 'alert' : 'header'}>
        {title}
      </AppText>
      <AppText tone="muted" align="center">
        {message}
      </AppText>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export function EmptyState({ icon = 'leaf-outline', title, message, action, testID }: { icon?: IconName; title: string; message: string; action?: StateAction; testID?: string }) {
  return (
    <StateShell icon={icon} title={title} message={message} testID={testID}>
      {action ? <GlassButton label={action.label} icon={action.icon} variant="secondary" onPress={action.onPress} /> : null}
    </StateShell>
  );
}

/** Safe message + Retry; a support reference sits behind "Details" (13 shared rules). */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  details,
  testID,
}: {
  title?: string;
  message: string;
  onRetry?: () => void | Promise<unknown>;
  details?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <StateShell icon="cloud-offline-outline" iconTone="danger" title={title} message={message} alert testID={testID}>
      {onRetry ? <GlassButton label="Retry" icon="refresh" onPress={onRetry} /> : null}
      {details ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide details' : 'Show details'}
          onPress={() => setOpen((v) => !v)}
          style={styles.details}
        >
          <AppText variant="label" tone="muted">
            {open ? 'Hide details' : 'Details'}
          </AppText>
          {open ? (
            <AppText variant="caption" tone="muted" selectable>
              {details}
            </AppText>
          ) : null}
        </Pressable>
      ) : null}
    </StateShell>
  );
}

/** A permission the feature needs was refused; explain and offer the OS settings route (when provided). */
export function PermissionDeniedState({ title, message, onOpenSettings, settingsLabel = 'Open phone settings', testID }: { title: string; message: string; onOpenSettings?: () => void; settingsLabel?: string; testID?: string }) {
  return (
    <StateShell icon="lock-closed-outline" iconTone="warning" title={title} message={message} testID={testID}>
      {onOpenSettings ? <GlassButton variant="secondary" icon="settings-outline" label={settingsLabel} onPress={onOpenSettings} /> : null}
    </StateShell>
  );
}

/** No connection. Shows when cached content was last updated, if any; never pretends to be live. */
export function OfflineState({ message = 'You’re offline. Connect to load the latest information.', lastUpdated, onRetry, testID }: { message?: string; lastUpdated?: string; onRetry?: () => void; testID?: string }) {
  return (
    <StateShell icon="cloud-offline-outline" iconTone="muted" title="No connection" message={lastUpdated ? `${message} Last updated ${lastUpdated}.` : message} testID={testID}>
      {onRetry ? <GlassButton variant="secondary" icon="refresh" label="Try again" onPress={onRetry} /> : null}
    </StateShell>
  );
}

/** Feature not available in this build / not enabled for this account (gated by policy or entitlement). */
export function UnavailableState({ title = 'Not available yet', message, testID }: { title?: string; message: string; testID?: string }) {
  return <StateShell icon="hourglass-outline" iconTone="muted" title={title} message={message} testID={testID} />;
}
export const FeatureGatedState = UnavailableState;

/** Shown on every screen that renders synthetic fixtures, so they are never mistaken for records. */
export function SyntheticDataBanner({ text = 'Synthetic preview data — not real people or records.', testID = 'preview-banner' }: { text?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={text} testID={testID} style={[styles.banner, { backgroundColor: colors.devBannerBg, borderColor: rgba(colors.devBannerText, 0.35) }]}>
      <Icon name="flask-outline" color={colors.devBannerText} size={16} />
      <AppText variant="secondary" style={[styles.bannerText, { color: colors.devBannerText }]}>
        {text}
      </AppText>
    </View>
  );
}

const NOTE_ICON: Record<Exclude<StatusTone, 'neutral'>, IconName> = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  danger: 'close-circle-outline',
};

/** Inline status (icon + words). Warnings and errors are announced (alert role + live region). */
export function StatusNote({ tone = 'info', title, message, testID }: { tone?: Exclude<StatusTone, 'neutral'>; title?: string; message: string; testID?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : motion.base, useNativeDriver: true }).start();
  }, [opacity, reduced]);
  const t = toneColors(tone, colors);
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole={urgent ? 'alert' : 'text'}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      accessibilityLabel={[title, message].filter(Boolean).join('. ')}
      style={[styles.note, { backgroundColor: t.bg, borderColor: t.fg, opacity }]}
    >
      <Icon name={NOTE_ICON[tone]} color={t.fg} />
      <View style={styles.noteText}>
        {title ? (
          <AppText variant="label" style={{ color: t.fg }}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="body" style={{ color: t.fg }}>
          {message}
        </AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  skeletonCard: { padding: space.screenInset, gap: space.md },
  centered: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  iconDisc: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xs },
  details: { minHeight: sizes.minTouch, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth },
  bannerText: { flex: 1, fontWeight: '600' },
  note: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  noteText: { flex: 1, gap: space.xs },
});
