/**
 * SH-12 Update required: compares the installed app version with the server-published minimum (11 release rules).
 * Pure. There is no server contract for the minimum yet (BACKEND_CONTRACT_V2 has none), so the policy is optional
 * and an unreadable/absent policy FAILS OPEN (SCREEN_REGISTER SH-12: "config unreadable → let the user in"; the server
 * still rejects incompatible writes).
 */
export type VersionPolicy = {
  /** Lowest supported version, e.g. "0.2.0"; null = no minimum published. */
  minimumVersion: string | null;
  source: 'server' | 'config' | 'synthetic-preview';
};

export type UpdateDecision =
  | { kind: 'required'; installed: string; minimum: string }
  | { kind: 'supported'; installed: string }
  | { kind: 'unknown'; reason: 'noPolicy' | 'unreadable' | 'badVersion' };

/** "1", "1.2", "1.2.3", "v1.2.3", "1.2.3-beta.1" → numeric parts (pre-release suffix ignored). Null when unusable. */
export function parseVersion(raw: string | null | undefined): number[] | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*v?(\d{1,6}(?:\.\d{1,6}){0,3})(?:[-+][0-9A-Za-z.-]*)?\s*$/.exec(raw);
  if (!m) return null;
  return m[1]!.split('.').map((p) => Number.parseInt(p, 10));
}

/** -1 / 0 / 1; missing parts count as 0 ("1.2" == "1.2.0"). */
export function compareVersions(a: number[], b: number[]): -1 | 0 | 1 {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d < 0) return -1;
    if (d > 0) return 1;
  }
  return 0;
}

export function evaluateUpdate(installed: string | null | undefined, policy: VersionPolicy | null | undefined): UpdateDecision {
  if (!policy) return { kind: 'unknown', reason: 'noPolicy' };
  if (policy.minimumVersion === null) {
    const v = parseVersion(installed);
    return v ? { kind: 'supported', installed: installed as string } : { kind: 'unknown', reason: 'badVersion' };
  }
  const min = parseVersion(policy.minimumVersion);
  const have = parseVersion(installed);
  if (!min) return { kind: 'unknown', reason: 'unreadable' };
  if (!have) return { kind: 'unknown', reason: 'badVersion' };
  return compareVersions(have, min) < 0
    ? { kind: 'required', installed: installed as string, minimum: policy.minimumVersion.trim() }
    : { kind: 'supported', installed: installed as string };
}

/** Only `required` blocks; `unknown` lets the person in (fail open for reads). */
export const blocksUse = (d: UpdateDecision): boolean => d.kind === 'required';
