import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useFieldStrings } from '@/features/field/i18n';
import { AppText } from '@/ui/components/AppText';
import { Icon, type IconName } from '@/ui/components/Icon';
import { GlassBottomSheet, GlassButton } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import type { PermissionKind, PermissionPort, PermissionStatus } from './contract';
import { expoPermissionPort } from './expoPermissionPort';
import { primerModeFor, type PrimerMode } from './permissionStatus';

const PortContext = createContext<PermissionPort>(expoPermissionPort);

/** Injects a permission port (tests, gallery). Production uses the platform adapter without a provider. */
export function PermissionPortProvider({ port, children }: { port: PermissionPort; children: ReactNode }) {
  return <PortContext.Provider value={port}>{children}</PortContext.Provider>;
}
export const usePermissionPort = (): PermissionPort => useContext(PortContext);

export type PermissionPrimerSheetProps = {
  kind: PermissionKind;
  visible: boolean;
  mode: PrimerMode;
  /** One sentence from the caller: why this task needs the permission right now. */
  reason?: string;
  /** True while the OS dialog is up; the sheet can't be dismissed then. */
  busy?: boolean;
  onContinue: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
  testID?: string;
};

const ICON: Record<PermissionKind, IconName> = { camera: 'camera-outline', microphone: 'mic-outline', location: 'location-outline' };

/**
 * SH-07 Permission primer: explains why before the OS dialog. It never asks the OS by itself: Continue is the only path
 * to the OS dialog, and a blocked permission offers the phone's Settings instead. "Not now" leaves the task blocked,
 * never pretending it worked.
 */
export function PermissionPrimerSheet({ kind, visible, mode, reason, busy = false, onContinue, onOpenSettings, onDismiss, testID = 'permission-primer' }: PermissionPrimerSheetProps) {
  const s = useFieldStrings();
  const { colors } = useTheme();
  const k = `permissions.${kind}`;
  const title = s.t(`${k}.${mode}.title`);
  const body = mode === 'ask' ? (reason ?? s.t(`${k}.ask.body`)) : s.t(`${k}.${mode}.body`);
  const points = mode === 'ask' ? [s.t(`${k}.ask.point1`), s.t(`${k}.ask.point2`)] : [];
  return (
    <GlassBottomSheet
      visible={visible}
      onClose={onDismiss}
      dismissible={!busy}
      title={title}
      closeLabel={s.t('permissions.notNow')}
      testID={testID}
      actions={
        mode === 'ask' ? (
          <>
            <GlassButton label={s.t('permissions.continue')} icon={ICON[kind]} loading={busy} onPress={onContinue} testID={`${testID}-continue`} />
            <GlassButton variant="secondary" label={s.t('permissions.notNow')} disabled={busy} onPress={onDismiss} testID={`${testID}-not-now`} />
          </>
        ) : mode === 'blocked' ? (
          <>
            <GlassButton label={s.t('permissions.openSettings')} icon="settings-outline" onPress={onOpenSettings} testID={`${testID}-settings`} />
            <GlassButton variant="secondary" label={s.t('permissions.notNow')} onPress={onDismiss} testID={`${testID}-not-now`} />
          </>
        ) : (
          <GlassButton variant="secondary" label={s.t('permissions.close')} onPress={onDismiss} testID={`${testID}-close`} />
        )
      }
    >
      <View style={styles.body} testID={`${testID}-${mode}`}>
        <View style={[styles.iconWell, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessible={false} importantForAccessibility="no-hide-descendants">
          <Icon name={mode === 'ask' ? ICON[kind] : 'lock-closed-outline'} size={26} color={mode === 'ask' ? colors.accent : colors.warningText} />
        </View>
        <AppText>{body}</AppText>
        {points.map((p) => (
          <View key={p} style={styles.point}>
            <Icon name="checkmark-circle-outline" size={18} color={colors.accentText} />
            <AppText variant="secondary" style={styles.pointText}>
              {p}
            </AppText>
          </View>
        ))}
        {mode === 'ask' ? (
          <AppText variant="secondary" tone="muted">
            {s.t('permissions.osNext')}
          </AppText>
        ) : null}
      </View>
    </GlassBottomSheet>
  );
}

export type PermissionGateOptions = {
  /** Shown in the primer instead of the default explanation for this kind. */
  reason?: string;
  /** Overrides the provider/platform port (tests). */
  port?: PermissionPort;
  testID?: string;
};

export type PermissionGate = {
  kind: PermissionKind;
  /** The OS status; null until the first read finishes. Re-read when the app returns to the foreground. */
  status: PermissionStatus | null;
  /**
   * Call when the person starts the task. Resolves true only when the permission is granted. Otherwise it opens the
   * primer (ask / blocked / unavailable) and resolves false when the person declines or is sent to Settings.
   */
  ensure: () => Promise<boolean>;
  /** Re-reads the OS status without asking. */
  refresh: () => Promise<PermissionStatus>;
  openSettings: () => Promise<void>;
  /** Spread onto <PermissionPrimerSheet {...gate.sheetProps} /> rendered by the caller. */
  sheetProps: PermissionPrimerSheetProps;
};

/**
 * Permission flow for one kind: read status → primer → OS dialog only after Continue → result. Shared by Field capture
 * (camera) and the attendance/care screens (location). Never requests on mount.
 */
export function usePermissionGate(kind: PermissionKind, options: PermissionGateOptions = {}): PermissionGate {
  const ctxPort = usePermissionPort();
  const port = options.port ?? ctxPort;
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [sheet, setSheet] = useState<{ mode: PrimerMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (v: boolean) => void } | null>(null);
  const mounted = useRef(true);

  const settle = useCallback((v: boolean) => {
    const p = pending.current;
    pending.current = null;
    if (mounted.current) setSheet(null);
    p?.resolve(v);
  }, []);

  const refresh = useCallback(async () => {
    const s = await port.status(kind);
    if (mounted.current) setStatus(s);
    return s;
  }, [port, kind]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Returning from the phone's Settings: pick up the new answer.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      const p = pending.current;
      pending.current = null;
      p?.resolve(false);
    };
  }, [refresh]);

  const ensure = useCallback(async () => {
    if (pending.current) return pending.current.promise;
    const s = await refresh();
    const mode = primerModeFor(s);
    if (mode === null) return true;
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    pending.current = { promise, resolve };
    if (mounted.current) setSheet({ mode });
    return promise;
  }, [refresh]);

  const onContinue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await port.request(kind);
      if (mounted.current) setStatus(r);
      settle(r === 'granted');
    } catch {
      settle(false);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, port, kind, settle]);

  const openSettings = useCallback(async () => {
    await port.openSettings();
  }, [port]);

  const onOpenSettings = useCallback(() => {
    settle(false);
    void port.openSettings();
  }, [port, settle]);

  const sheetProps = useMemo<PermissionPrimerSheetProps>(
    () => ({
      kind,
      visible: sheet !== null,
      mode: sheet?.mode ?? 'ask',
      reason: options.reason,
      busy,
      onContinue: () => void onContinue(),
      onOpenSettings,
      onDismiss: () => settle(false),
      testID: options.testID,
    }),
    [kind, sheet, options.reason, options.testID, busy, onContinue, onOpenSettings, settle],
  );

  return { kind, status, ensure, refresh, openSettings, sheetProps };
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  iconWell: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pointText: { flex: 1 },
});
