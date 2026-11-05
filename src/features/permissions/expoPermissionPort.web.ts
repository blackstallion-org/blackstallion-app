import * as Location from 'expo-location';

import type { PermissionKind, PermissionPort, PermissionStatus } from './contract';
import { toPermissionStatus } from './permissionStatus';

/**
 * Web preview adapter. Capture (passport scan, clips, proof photos, selfies) targets the phone app; the web preview is
 * for layout review only, so camera and microphone report `unavailable` and screens show their honest unavailable
 * state instead of a browser camera that has never been verified. Location uses expo-location's browser
 * implementation (navigator.geolocation).
 */
async function locationStatus(ask: boolean): Promise<PermissionStatus> {
  try {
    return toPermissionStatus(await (ask ? Location.requestForegroundPermissionsAsync() : Location.getForegroundPermissionsAsync()));
  } catch {
    return 'unavailable';
  }
}

export const expoPermissionPort: PermissionPort = {
  status: async (kind: PermissionKind) => (kind === 'location' ? locationStatus(false) : 'unavailable'),
  request: async (kind: PermissionKind) => (kind === 'location' ? locationStatus(true) : 'unavailable'),
  openSettings: async () => undefined,
};
