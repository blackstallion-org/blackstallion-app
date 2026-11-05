import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { Linking } from 'react-native';

import type { PermissionKind, PermissionPort, PermissionStatus } from './contract';
import { toPermissionStatus, type OsPermissionResponse } from './permissionStatus';

type Pair = { get: () => Promise<OsPermissionResponse>; ask: () => Promise<OsPermissionResponse> };

const OS: Record<PermissionKind, Pair> = {
  camera: { get: () => Camera.getCameraPermissionsAsync(), ask: () => Camera.requestCameraPermissionsAsync() },
  microphone: { get: () => Camera.getMicrophonePermissionsAsync(), ask: () => Camera.requestMicrophonePermissionsAsync() },
  // Foreground only: nothing in the app tracks location in the background.
  location: { get: () => Location.getForegroundPermissionsAsync(), ask: () => Location.requestForegroundPermissionsAsync() },
};

/** A module that throws (missing native module in an old dev build, simulator without a camera) is "unavailable". */
async function safely(fn: () => Promise<OsPermissionResponse>): Promise<PermissionStatus> {
  try {
    return toPermissionStatus(await fn());
  } catch {
    return 'unavailable';
  }
}

/**
 * iOS/Android adapter (expo-camera, expo-location, React Native Linking). Not device-verified in this workspace:
 * jest exercises it against the jest-expo module mocks only.
 */
export const expoPermissionPort: PermissionPort = {
  status: (kind) => safely(OS[kind].get),
  request: (kind) => safely(OS[kind].ask),
  openSettings: async () => {
    await Linking.openSettings().catch(() => undefined);
  },
};
