// Copied from foundations/client-auth/src (G3, 4 Nov 2026), import extensions removed; keep both in step.
// Trusted access snapshot (server: public.app_access_snapshot()) → what the app may show.
// The client never derives a role or a hub on its own: everything comes from the server snapshot, and the server
// re-checks every read and write anyway (RLS + storage policies). Experience = navigation + query scope only.

export type Experience = 'family' | 'field';
export type AccessStatus = 'active' | 'no_access' | 'no_profile';

export interface Capabilities {
  recordAssessment: boolean;
  uploadSessionVideo: boolean;
  submitCareProof: boolean;
  punchIn: boolean;
  viewHubCadets: boolean;
}

export interface ChildLink { cadetId: string; firstName: string; hubId: string | null }

export interface AccessSnapshot {
  userId: string;
  status: AccessStatus;
  role: string | null;
  hubId: string | null;
  experiences: Experience[];
  children: ChildLink[];
  capabilities: Capabilities;
  issuedAt: string;
}

export class SnapshotError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CAPS: Capabilities = { recordAssessment: false, uploadSessionVideo: false, submitCareProof: false, punchIn: false, viewHubCadets: false };

/** Validate the raw RPC result. Anything malformed is treated as an error, never as partial access. */
export function parseSnapshot(raw: unknown, expectedUserId: string): AccessSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('snapshot is not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string' || !UUID.test(r.userId)) throw new SnapshotError('bad userId');
  // A snapshot for a different identity than the current session must never be applied (stale response after switch).
  if (r.userId.toLowerCase() !== expectedUserId.toLowerCase()) throw new SnapshotError('snapshot belongs to another user');
  if (r.status !== 'active' && r.status !== 'no_access' && r.status !== 'no_profile') throw new SnapshotError('bad status');
  const exps = Array.isArray(r.experiences) ? r.experiences : null;
  if (!exps || !exps.every((e) => e === 'family' || e === 'field')) throw new SnapshotError('bad experiences');
  const kids = Array.isArray(r.children) ? r.children : null;
  if (!kids) throw new SnapshotError('bad children');
  const children: ChildLink[] = kids.map((k) => {
    const c = k as Record<string, unknown>;
    if (typeof c.cadetId !== 'string' || !UUID.test(c.cadetId)) throw new SnapshotError('bad child id');
    return { cadetId: c.cadetId, firstName: typeof c.firstName === 'string' ? c.firstName : '', hubId: typeof c.hubId === 'string' ? c.hubId : null };
  });
  const caps = (typeof r.capabilities === 'object' && r.capabilities !== null ? r.capabilities : {}) as Record<string, unknown>;
  const capabilities = Object.fromEntries(Object.keys(NO_CAPS).map((k) => [k, caps[k] === true])) as unknown as Capabilities;
  const experiences = [...new Set(exps as Experience[])];
  // Consistency rules: no experience without its basis in the same snapshot.
  if (experiences.includes('family') && children.length === 0) throw new SnapshotError('family without children');
  if (experiences.includes('field') && (typeof r.hubId !== 'string' || !UUID.test(r.hubId))) throw new SnapshotError('field without hub');
  return {
    userId: r.userId, status: r.status, role: typeof r.role === 'string' ? r.role : null,
    hubId: experiences.includes('field') ? (r.hubId as string) : null,
    experiences, children, capabilities: experiences.includes('field') ? capabilities : NO_CAPS,
    issuedAt: typeof r.issuedAt === 'string' ? r.issuedAt : '',
  };
}

/** Which experience to open. `lastUsed` is only a preference; it is ignored if no longer authorized. */
export function chooseExperience(s: AccessSnapshot, lastUsed: Experience | null): Experience | null {
  if (s.experiences.length === 0) return null;
  if (lastUsed && s.experiences.includes(lastUsed)) return lastUsed;
  return s.experiences[0] ?? null;
}

/** The switcher is shown only when the server authorizes both experiences. */
export function canShowSwitcher(s: AccessSnapshot): boolean {
  return s.experiences.includes('family') && s.experiences.includes('field');
}

export function canSwitchTo(s: AccessSnapshot, target: Experience): boolean {
  return s.experiences.includes(target);
}

export function isLinkedChild(s: AccessSnapshot, cadetId: string): boolean {
  return s.children.some((c) => c.cadetId.toLowerCase() === cadetId.toLowerCase());
}
