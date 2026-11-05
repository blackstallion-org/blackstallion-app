/**
 * SH-04 profile header. Pure. Everything here is DISPLAY ONLY: roles come from the server snapshot
 * (`app_access_snapshot().role`) and are never used to decide what the person may do.
 */
export type RoleKey = 'guardian' | 'instructor' | 'groom' | 'hubAdmin' | 'superAdmin' | 'admissions';

/** `public.users.role` values (16 §2 / SLICE_CONTRACT C) → display role. Unknown → null (shown as nothing). */
export function roleKeyFromServer(role: string | null | undefined): RoleKey | null {
  switch (role) {
    case 'PARENT':
      return 'guardian';
    case 'INSTRUCTOR':
      return 'instructor';
    case 'GROOM':
      return 'groom';
    case 'SCHOOL_ADMIN':
      return 'hubAdmin';
    case 'SUPER_ADMIN':
      return 'superAdmin';
    case 'ADMISSIONS':
      return 'admissions';
    default:
      return null;
  }
}

export type ProfileDetails = {
  /** Staff role at a hub (instructor, groom, hub admin), or null for guardians-only. */
  staffRole: Exclude<RoleKey, 'guardian'> | null;
  /** Name of the staff member's hub; null when unknown or not staff. */
  hubName: string | null;
  /** First names of linked children (guardians). Display only. */
  childFirstNames: string[];
  source: 'server' | 'synthetic-preview';
};

/** "AB" from "Anil Bose", "P" from "Priya (sample)", "?" from nothing. Letters only; never an e-mail fragment. */
export function initialsOf(displayName: string): string {
  const name = displayName.includes('@') ? '' : displayName.replace(/\(.*?\)/g, ' ');
  const parts = name.split(/\s+/).filter((p) => /\p{L}/u.test(p));
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const pick = (p?: string) => (p ? (Array.from(p).find((ch) => /\p{L}/u.test(ch)) ?? '') : '');
  const s = `${pick(first)}${pick(last)}`.toUpperCase();
  return s || '?';
}

/** "Aarav", "Aarav and Meera", "Aarav, Meera and Isha" (EN joiner supplied by the caller for other languages). */
export function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}
