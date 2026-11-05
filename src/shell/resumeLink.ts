/**
 * SH-01 journey: a deep link opened while signed out (or while access is still loading) is resumed once the person is
 * authorized, if it belongs to the experience they land in. In memory only and single-use. It is navigation, not
 * access: the destination screen still asks the server, so a link to someone else's record shows "not found".
 */
export type Experience = 'family' | 'field';

const SAFE = /^\/(family|field|settings)(\/[A-Za-z0-9._~\-/]*)?$/;
let pending: string | null = null;

/** The app path a deep link names, or null for anything that isn't a resumable in-app screen. */
export function resumablePath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const p = pathname.replace(/\/+$/, '') || '/';
  return SAFE.test(p) && !p.includes('..') ? p : null;
}

export function rememberResume(pathname: string | null | undefined): void {
  const p = resumablePath(pathname);
  if (p) pending = p;
}

/** Returns (and forgets) the remembered path when it fits the experience; Settings fits both. */
export function takeResume(experience: Experience): string | null {
  const p = pending;
  pending = null;
  if (!p) return null;
  if (p.startsWith('/settings')) return p;
  return p.startsWith(`/${experience}`) ? p : null;
}

export function clearResume(): void {
  pending = null;
}
