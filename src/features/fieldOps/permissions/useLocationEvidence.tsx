// Location evidence for FO-10/FO-11 with an SH-07-style primer (local until `@/features/permissions` ships
// PermissionPrimerSheet). The primer explains why first; the OS dialog appears only after the person taps Continue.
// Denied/blocked location never blocks the action: the record goes to a supervisor instead.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { PermissionStatus } from '@/features/permissions';
import { GlassBottomSheet, GlassButton } from '@/ui/glass';

import type { LocationReading } from '../domain/evidence';
import type { Translator } from '../i18n/i18n';
import type { LocationPort } from './location';

export interface LocationEvidence {
  status: PermissionStatus | 'checking';
  reading: LocationReading | null;
  busy: boolean;
  failed: boolean;
  /** opens the primer when permission is undetermined; otherwise takes a new fix */
  ask: () => void;
  refresh: () => Promise<void>;
  openSettings: () => void;
  primer: ReactNode;
}

export function useLocationEvidence(port: LocationPort, t: Translator, purposeKey: string): LocationEvidence {
  const [status, setStatus] = useState<PermissionStatus | 'checking'>('checking');
  const [reading, setReading] = useState<LocationReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await port.current();
      if (alive.current) setReading(r);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [port]);

  useEffect(() => {
    let live = true;
    void port.status().then((s) => {
      if (!live) return;
      setStatus(s);
      if (s === 'granted') void refresh();
    });
    return () => {
      live = false;
    };
  }, [port, refresh]);

  const ask = useCallback(() => {
    if (status === 'granted') void refresh();
    else if (status === 'undetermined' || status === 'denied') setPrimerOpen(true);
  }, [status, refresh]);

  const accept = useCallback(async () => {
    const s = await port.request();
    if (!alive.current) return;
    setPrimerOpen(false);
    setStatus(s);
    if (s === 'granted') await refresh();
  }, [port, refresh]);

  const primer = (
    <GlassBottomSheet
      visible={primerOpen}
      onClose={() => setPrimerOpen(false)}
      title={t.t('fo.location.primerTitle')}
      description={t.t(purposeKey)}
      testID="fo-location-primer"
      actions={
        <>
          <GlassButton label={t.t('fo.location.primerContinue')} icon="location-outline" onPress={accept} testID="fo-location-primer-continue" />
          <GlassButton variant="secondary" label={t.t('fo.location.primerNotNow')} onPress={() => setPrimerOpen(false)} testID="fo-location-primer-later" />
        </>
      }
    />
  );

  return { status, reading, busy, failed, ask, refresh, openSettings: () => void port.openSettings(), primer };
}
