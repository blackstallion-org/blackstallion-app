// Local location adapter for FO-10/FO-11 until `@/features/permissions` exports its PermissionPrimerSheet /
// usePermissionGate (workstream C). It implements the shared PermissionPort contract for 'location' only, so switching
// later is a one-line import change. The OS dialog is shown only after the person accepted the primer.
import * as Location from 'expo-location';
import { Linking } from 'react-native';

import type { PermissionPort, PermissionStatus } from '@/features/permissions';

import type { LocationReading } from '../domain/evidence';

export interface LocationPort extends Pick<PermissionPort, 'openSettings'> {
  status(): Promise<PermissionStatus>;
  request(): Promise<PermissionStatus>;
  /** One fresh fix. Rejects on timeout or when location services are off. */
  current(): Promise<LocationReading>;
}

function map(r: { status: string; canAskAgain?: boolean; granted?: boolean }): PermissionStatus {
  if (r.granted || r.status === 'granted') return 'granted';
  if (r.status === 'undetermined') return 'undetermined';
  return r.canAskAgain === false ? 'blocked' : 'denied';
}

const FIX_TIMEOUT_MS = 20_000;

export const expoLocationPort: LocationPort = {
  async status() {
    try {
      return map(await Location.getForegroundPermissionsAsync());
    } catch {
      return 'unavailable';
    }
  },
  async request() {
    try {
      return map(await Location.requestForegroundPermissionsAsync());
    } catch {
      return 'unavailable';
    }
  },
  async current() {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('location_timeout')), FIX_TIMEOUT_MS)),
    ]);
    const acc = fix.coords.accuracy;
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyM: typeof acc === 'number' && Number.isFinite(acc) ? acc : null,
      at: typeof fix.timestamp === 'number' ? fix.timestamp : Date.now(),
    };
  },
  openSettings: () => Linking.openSettings(),
};
