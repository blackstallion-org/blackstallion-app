import type { PermissionStatus } from './contract';

/** Shape shared by expo-camera / expo-location / expo-modules-core permission responses. */
export type OsPermissionResponse = { status: string; granted?: boolean; canAskAgain?: boolean };

/**
 * OS answer → app status. `denied` means the OS will still show its dialog again (Android before "don't ask again");
 * `blocked` means only the phone's Settings can change it (iOS after the first refusal, Android permanently denied).
 */
export function toPermissionStatus(r: OsPermissionResponse | null | undefined): PermissionStatus {
  if (!r) return 'unavailable';
  if (r.granted === true || r.status === 'granted') return 'granted';
  if (r.status === 'undetermined') return r.canAskAgain === false ? 'blocked' : 'undetermined';
  if (r.status === 'denied') return r.canAskAgain === false ? 'blocked' : 'denied';
  return 'unavailable';
}

/** Which primer the person sees for a status (none when granted). */
export type PrimerMode = 'ask' | 'blocked' | 'unavailable';
export function primerModeFor(s: PermissionStatus): PrimerMode | null {
  switch (s) {
    case 'granted':
      return null;
    case 'undetermined':
    case 'denied':
      return 'ask';
    case 'blocked':
      return 'blocked';
    default:
      return 'unavailable';
  }
}
