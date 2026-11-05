/**
 * SH-07 Permission primer contract. Owner: Field workstream (implements `PermissionPrimerSheet` in this folder and
 * the platform permission adapters). Others import only from `@/features/permissions`.
 * The primer explains why before the OS dialog; it never requests a permission by itself without the person's tap,
 * and offers Settings when the OS permission is permanently denied.
 */
export type PermissionKind = 'camera' | 'microphone' | 'location';
export type PermissionStatus = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unavailable';

export interface PermissionPort {
  status(kind: PermissionKind): Promise<PermissionStatus>;
  /** Shows the OS dialog. Call only after the person accepted the primer. */
  request(kind: PermissionKind): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
}
