/**
 * DEVELOPMENT-ONLY synthetic world for Field horses / attendance / sync / reviews (FO-08..FO-20).
 * Every name is invented and marked "(sample)". There are no real photos: review evidence shows a labelled placeholder.
 * The fixture server applies the same rules as the server functions it stands in for (operation id + payload hash
 * replay, hub and assignment checks, review routing, version conflicts, self-review refusal), so screens can be
 * exercised end to end. It grants nothing on any server.
 */
import { evaluateDevicePolicy } from '@/features/care/domain/devicePolicy';
import type { CareTaskType, ServerCareOccurrence } from '@/features/care/domain/careTypes';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { newOperationId } from '@/features/field/domain/operation';
import { createFieldOutbox, createUriFileVault } from '@/features/fieldOps/data/outbox';
import type { FieldOpsRepositories } from '@/features/fieldOps/data/repositories';
import { addDays, localDateIn } from '@/features/fieldOps/domain/horses';
import type {
  FieldOpsScope,
  HubHorse,
  PolicyFlags,
  Rank,
  RankCandidate,
  ReviewItem,
  ShiftRecord,
  VerificationState,
} from '@/features/fieldOps/domain/types';
import { DEFAULT_FLAGS } from '@/features/fieldOps/domain/types';
import { MemoryQueueStore } from '@/features/sync/domain/memoryQueueStore';
import { TransportError, type SubmitRequest, type Transport } from '@/features/sync/domain/ports';
import { payloadHash } from '@/features/sync/domain/sha256';
import type { QueueItem } from '@/features/sync/domain/types';

const TZ = 'Asia/Kolkata';
const HUB1 = 'syn-hub-1';
const HUB2 = 'syn-hub-2';
const HUB_POS: Record<string, { lat: number; lng: number }> = { [HUB1]: { lat: 17.385, lng: 78.4867 }, [HUB2]: { lat: 16.5062, lng: 80.648 } };

type Staff = { id: string; name: string; role: 'GROOM' | 'INSTRUCTOR' | 'SCHOOL_ADMIN'; hub: string };
const STAFF: Record<string, Staff> = {
  'syn-groom': { id: 'syn-groom', name: 'Suresh (sample)', role: 'GROOM', hub: HUB1 },
  'syn-instructor': { id: 'syn-instructor', name: 'Ravi (sample)', role: 'INSTRUCTOR', hub: HUB1 },
  'syn-hub-admin': { id: 'syn-hub-admin', name: 'Meena (sample)', role: 'SCHOOL_ADMIN', hub: HUB1 },
  'syn-dual': { id: 'syn-dual', name: 'Anil (sample)', role: 'INSTRUCTOR', hub: HUB2 },
  'syn-groom-2': { id: 'syn-groom-2', name: 'Lakshmi (sample)', role: 'GROOM', hub: HUB1 },
  // simulated "no connection": every read and send fails like a dropped network, so offline states can be inspected
  'syn-field-offline': { id: 'syn-field-offline', name: 'Kavya (sample)', role: 'GROOM', hub: HUB1 },
};
const OFFLINE = 'syn-field-offline';

const horse = (id: string, hub: string, name: string, breed: string, hands: number, temperament: string, active = true): HubHorse => ({
  horseId: id, hubId: hub, name, breed, heightHands: hands, temperament, active,
});
const HORSES: HubHorse[] = [
  horse('syn-horse-badal', HUB1, 'Badal (sample)', 'Marwari', 15.1, 'Calm'),
  horse('syn-horse-chetak', HUB1, 'Chetak (sample)', 'Marwari', 15.3, 'Forward'),
  horse('syn-horse-megh', HUB1, 'Megh (sample)', 'Kathiawari', 14.2, 'Retired from lessons', false),
  horse('syn-horse-sultan', HUB1, 'Sultan (sample)', 'Thoroughbred cross', 16.0, 'Sensitive'),
  horse('syn-horse-toofan', HUB1, 'Toofan (sample)', 'Marwari', 15.2, 'Spirited'),
  horse('syn-horse-bijli', HUB2, 'Bijli (sample)', 'Marwari', 15.0, 'Calm'),
].sort((a, b) => a.name.localeCompare(b.name));

const ASSIGNED: Record<string, string[]> = {
  'syn-groom': ['syn-horse-badal', 'syn-horse-chetak', 'syn-horse-toofan'],
  'syn-groom-2': ['syn-horse-badal', 'syn-horse-chetak', 'syn-horse-toofan'],
  [OFFLINE]: ['syn-horse-badal'],
  'syn-instructor': ['syn-horse-sultan'],
  'syn-dual': ['syn-horse-bijli'],
};

const INSTRUCTIONS: Record<CareTaskType, string> = {
  feed: 'Two scoops of the morning mix, soaked. Check the water bucket while you are there. (sample)',
  water: 'Empty, rinse and refill both buckets. Note if less than half was drunk. (sample)',
  grooming_hoof: 'Pick out all four hooves, check shoes and look for heat or swelling. (sample)',
  tack_check: 'Check girth stitching, stirrup leathers and the bridle buckles before the 16:00 lesson. (sample)',
  medication: 'Give one sachet of the prescribed supplement mixed into the evening feed. Authorised by the hub vet (sample).',
};

type Occ = ServerCareOccurrence & { hubId: string; submissions: number };
type Sub = { id: string; occurrenceId: string; actor: string; opId: string; state: 'received' | 'review_required' | 'accepted' | 'rejected'; reasons: string[]; late: boolean; observedAt: string; receivedAt: string; accuracyM: number | null; decidedBy: string | null; decidedAt: string | null; note: string | null; raceWith?: string };
type Shift = ShiftRecord & { userId: string; hubId: string; decision: { by: string; decision: 'accepted' | 'rejected'; reason: string; at: string } | null; raceWith?: string };
type Proposal = { id: string; cadetId: string; hubId: string; from: Rank; to: Rank; evidence: string[]; note: string | null; by: string; at: string; status: 'proposed' | 'approved' | 'rejected'; version: number; decidedBy: string | null; decidedAt: string | null; reason: string | null };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
const round15 = (t: number) => Math.round(t / 900_000) * 900_000;
const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function denied(): never {
  throw new FieldCommandError('forbidden', 'Your account can’t see this.', 'FIXTURE-SCOPE');
}

/** Builds one synthetic world. `now` is fixed per instance so the timeline is stable while you look at it. */
export function createFieldOpsFixtures({ latencyMs = 300, now: nowAt = Date.now() }: { latencyMs?: number; now?: number } = {}): FieldOpsRepositories | undefined {
  const today = localDateIn(nowAt, TZ);
  const occs = new Map<string, Occ>();
  const subs: Sub[] = [];
  const shifts: Shift[] = [];
  const proposals: Proposal[] = [];
  const receipts = new Map<string, { actor: string; hash: string; result: Record<string, unknown> }>();
  const objects = new Set<string>();
  const decisionOps = new Map<string, { actor: string; hash: string; result: Record<string, unknown> }>();

  // ---------------------------------------------------------------- occurrences (yesterday, today, tomorrow)
  const plan: { horse: string; task: CareTaskType; offsetMin: number; status: Occ['status']; latest: Occ['latestSubmissionState']; overdue?: boolean; day?: -1 | 0 | 1 }[] = [
    { horse: 'syn-horse-badal', task: 'feed', offsetMin: -300, status: 'completed', latest: 'accepted' },
    { horse: 'syn-horse-badal', task: 'grooming_hoof', offsetMin: -120, status: 'pending', latest: null },
    { horse: 'syn-horse-badal', task: 'water', offsetMin: 30, status: 'pending', latest: null },
    { horse: 'syn-horse-badal', task: 'tack_check', offsetMin: 240, status: 'pending', latest: null },
    { horse: 'syn-horse-chetak', task: 'feed', offsetMin: -300, status: 'completed', latest: 'accepted' },
    { horse: 'syn-horse-chetak', task: 'water', offsetMin: -180, status: 'submitted', latest: 'review_required' },
    { horse: 'syn-horse-chetak', task: 'grooming_hoof', offsetMin: -75, status: 'pending', latest: null, overdue: true },
    { horse: 'syn-horse-chetak', task: 'tack_check', offsetMin: 200, status: 'pending', latest: null },
    { horse: 'syn-horse-toofan', task: 'feed', offsetMin: -300, status: 'completed', latest: 'accepted' },
    { horse: 'syn-horse-toofan', task: 'water', offsetMin: -45, status: 'pending', latest: null },
    { horse: 'syn-horse-toofan', task: 'medication', offsetMin: 300, status: 'pending', latest: null },
    { horse: 'syn-horse-sultan', task: 'tack_check', offsetMin: 90, status: 'pending', latest: null },
    { horse: 'syn-horse-sultan', task: 'feed', offsetMin: -240, status: 'completed', latest: 'accepted' },
    { horse: 'syn-horse-bijli', task: 'water', offsetMin: 60, status: 'pending', latest: null },
    { horse: 'syn-horse-badal', task: 'feed', offsetMin: -300, status: 'completed', latest: 'accepted', day: -1 },
    { horse: 'syn-horse-badal', task: 'water', offsetMin: -60, status: 'completed', latest: 'accepted', day: -1 },
    { horse: 'syn-horse-badal', task: 'feed', offsetMin: -300, status: 'pending', latest: null, day: 1 },
    { horse: 'syn-horse-toofan', task: 'medication', offsetMin: 300, status: 'completed', latest: 'accepted', day: -1 },
  ];
  // Anchor the sample day inside the hub's working hours (06:00–18:00 IST), so "today" always holds every sample task —
  // near midnight a −5 h offset would otherwise fall on yesterday and the overdue sample would vanish (time-of-day flake).
  const dayStart = Date.parse(`${today}T00:00:00+05:30`);
  const anchor = Math.min(Math.max(nowAt, dayStart + 6 * 3_600_000), dayStart + 18 * 3_600_000);
  for (const p of plan) {
    const h = HORSES.find((x) => x.horseId === p.horse)!;
    const day = p.day ?? 0;
    const due = round15(anchor + p.offsetMin * 60_000) + day * 86_400_000;
    const id = `syn-occ-${p.horse.slice(10)}-${p.task.replace('_', '')}-${day + 1}`;
    occs.set(id, {
      occurrenceId: id, horseId: h.horseId, horseName: h.name, taskType: p.task, slotKey: p.task, localDate: localDateIn(due, TZ), dueAt: due,
      timezone: TZ, instructions: INSTRUCTIONS[p.task], status: p.status, scheduleVersion: 1, latestSubmissionState: p.latest,
      overdue: p.overdue === true, hubId: h.hubId, submissions: p.latest ? 1 : 0,
    });
  }

  // ---------------------------------------------------------------- review material for the hub admin
  const chetakWater = 'syn-occ-chetak-water-1';
  subs.push(
    { id: 'syn-sub-0', occurrenceId: 'syn-occ-badal-feed-1', actor: 'syn-groom', opId: 'syn-op-groom-badal-feed', state: 'accepted', reasons: [], late: false, observedAt: iso(nowAt - 298 * 60_000), receivedAt: iso(nowAt - 297 * 60_000), accuracyM: 9, decidedBy: 'syn-other-admin', decidedAt: iso(nowAt - 240 * 60_000), note: 'Clear photo, both buckets full (sample).' },
    { id: 'syn-sub-1', occurrenceId: chetakWater, actor: 'syn-groom', opId: 'syn-op-groom-chetak-water', state: 'review_required', reasons: ['weak_location_accuracy'], late: false, observedAt: iso(nowAt - 175 * 60_000), receivedAt: iso(nowAt - 172 * 60_000), accuracyM: 85, decidedBy: null, decidedAt: null, note: null },
    { id: 'syn-sub-2', occurrenceId: 'syn-occ-toofan-feed-1', actor: 'syn-groom-2', opId: 'syn-op-g2-toofan-feed', state: 'received', reasons: [], late: true, observedAt: iso(nowAt - 250 * 60_000), receivedAt: iso(nowAt - 229 * 60_000), accuracyM: 12, decidedBy: null, decidedAt: null, note: null, raceWith: 'syn-other-admin' },
  );
  shifts.push(
    { attendanceId: 'syn-att-groom-today', userId: 'syn-groom', hubId: HUB1, punchInAt: iso(nowAt - 6 * 3_600_000 + 120_000), punchOutAt: null, observedAt: iso(nowAt - 6 * 3_600_000 + 60_000), accuracyM: 85, distanceM: 120, verificationState: 'low_accuracy', operationId: 'syn-op-punch-groom', review: null, decision: null },
    { attendanceId: 'syn-att-groom-y', userId: 'syn-groom', hubId: HUB1, punchInAt: iso(nowAt - 30 * 3_600_000), punchOutAt: iso(nowAt - 21 * 3_600_000), observedAt: iso(nowAt - 30 * 3_600_000), accuracyM: 9, distanceM: 14, verificationState: 'within_radius', operationId: 'syn-op-punch-groom-y', review: null, decision: { by: 'syn-hub-admin', decision: 'accepted', reason: 'Seen at morning feed (sample).', at: iso(nowAt - 20 * 3_600_000) } },
    { attendanceId: 'syn-att-g2-today', userId: 'syn-groom-2', hubId: HUB1, punchInAt: iso(nowAt - 5 * 3_600_000), punchOutAt: null, observedAt: iso(nowAt - 5 * 3_600_000), accuracyM: 11, distanceM: 18, verificationState: 'within_radius', operationId: 'syn-op-punch-g2', review: null, decision: null },
  );

  // ---------------------------------------------------------------- policy flags (synthetic)
  const flagsFor = (scope: FieldOpsScope): PolicyFlags =>
    // The second demo hub shows the conditional rank-proposal screen with the flag ON; everywhere else it is OFF.
    scope.hubId === HUB2
      ? { ...DEFAULT_FLAGS, rankProposals: { enabled: true, proposerRoles: ['INSTRUCTOR'], approverRole: 'SCHOOL_ADMIN' } }
      : DEFAULT_FLAGS;

  const CADETS: Record<string, { name: string; hub: string; rank: Rank; sessions: RankCandidate['sessions'] }> = {
    'syn-f9': {
      name: 'Tara (sample)', hub: HUB2, rank: 'CADET_RIDER',
      sessions: [0, 7, 14, 21].map((d, i) => ({ sessionId: `syn-ts-tara-${i}`, sessionDate: addDays(today, -d - 1), riding: 7 + (i % 2), ground: 7, stable: 8 })),
    },
    'syn-f1': { name: 'Kabir (sample)', hub: HUB1, rank: 'CADET_SQUIRE', sessions: [] },
  };

  // ---------------------------------------------------------------- guards
  const staffOf = (scope: FieldOpsScope): Staff => {
    if (scope.experience !== 'field') denied();
    const s = STAFF[scope.subjectId];
    if (!s || (scope.hubId != null && scope.hubId !== s.hub)) denied();
    if (s.id === OFFLINE) throw new FieldCommandError('network', 'We couldn’t reach the academy.', 'FIXTURE-OFFLINE');
    return s;
  };
  const delay = () => wait(latencyMs);
  const reviewer = (s: Staff) => s.role === 'SCHOOL_ADMIN';

  const reviewItems = (hub: string, viewer: Staff): ReviewItem[] => {
    const care: ReviewItem[] = subs
      .filter((x) => occs.get(x.occurrenceId)?.hubId === hub)
      .map((x) => {
        const o = occs.get(x.occurrenceId)!;
        const decided = x.state === 'accepted' || x.state === 'rejected';
        return {
          kind: 'care_evidence', itemId: x.id, hubId: hub, version: decided ? 2 : 1, state: decided ? (x.state as 'accepted' | 'rejected') : 'open', reasons: x.reasons,
          subjectUserId: x.actor, subjectName: STAFF[x.actor]?.name ?? null, observedAt: x.observedAt, receivedAt: x.receivedAt, accuracyM: x.accuracyM,
          distanceM: null, horseName: o.horseName, taskType: o.taskType, dueAt: iso(o.dueAt), late: x.late, media: { bucket: 'proof-photos', path: `${hub}/${x.actor}/${x.opId}.jpg` },
          cadetId: null, cadetName: null, fromRank: null, toRank: null, evidenceSessionIds: [], decidedBy: x.decidedBy, decidedAt: x.decidedAt, decisionReason: x.note,
          canDecide: !decided && x.actor !== viewer.id,
        };
      });
    const att: ReviewItem[] = shifts
      .filter((x) => x.hubId === hub)
      .map((x) => ({
        kind: 'shift_attendance' as const, itemId: x.attendanceId, hubId: hub, version: x.decision ? 2 : 1, state: x.decision ? x.decision.decision : ('open' as const),
        reasons: x.verificationState !== 'within_radius' ? [x.verificationState ?? 'unknown'] : ['review_all_policy'],
        subjectUserId: x.userId, subjectName: STAFF[x.userId]?.name ?? null, observedAt: x.observedAt, receivedAt: x.punchInAt, accuracyM: x.accuracyM, distanceM: x.distanceM,
        horseName: null, taskType: null, dueAt: null, late: null, media: null, cadetId: null, cadetName: null, fromRank: null, toRank: null, evidenceSessionIds: [],
        decidedBy: x.decision?.by ?? null, decidedAt: x.decision?.at ?? null, decisionReason: x.decision?.reason ?? null, canDecide: !x.decision && x.userId !== viewer.id,
      }));
    const rank: ReviewItem[] = proposals
      .filter((p) => p.hubId === hub)
      .map((p) => ({
        kind: 'rank_proposal' as const, itemId: p.id, hubId: hub, version: p.version, state: p.status === 'proposed' ? ('open' as const) : p.status === 'approved' ? ('accepted' as const) : ('rejected' as const),
        reasons: ['rank_change'], subjectUserId: p.by, subjectName: STAFF[p.by]?.name ?? null, observedAt: null, receivedAt: p.at, accuracyM: null, distanceM: null, horseName: null,
        taskType: null, dueAt: null, late: null, media: null, cadetId: p.cadetId, cadetName: CADETS[p.cadetId]?.name ?? null, fromRank: p.from, toRank: p.to, evidenceSessionIds: p.evidence,
        decidedBy: p.decidedBy, decidedAt: p.decidedAt, decisionReason: p.reason, canDecide: p.status === 'proposed' && p.by !== viewer.id,
      }));
    return [...care, ...att, ...rank];
  };

  // ---------------------------------------------------------------- fixture transport (outbox)
  const submitCare = (req: SubmitRequest): Record<string, unknown> => {
    const s = STAFF[req.actorId];
    if (!s || (s.role !== 'GROOM' && s.role !== 'INSTRUCTOR')) throw new TransportError('http', { status: 403, code: 'access_revoked' });
    const p = req.payload as { occurrenceId: string; horseId: string; mediaPath: string; observedAt: string; location: { accuracyM: number | null } | null };
    const o = occs.get(p.occurrenceId);
    if (!o) throw new TransportError('http', { status: 404, code: 'task_not_found' });
    if (o.hubId !== s.hub) throw new TransportError('http', { status: 403, code: 'cross_hub_denied' });
    if (o.horseId !== p.horseId) throw new TransportError('http', { status: 403, code: 'horse_mismatch' });
    if (!ASSIGNED[s.id]?.includes(o.horseId)) throw new TransportError('http', { status: 403, code: 'not_assigned' });
    if (!objects.has(p.mediaPath)) throw new TransportError('http', { status: 404, code: 'media_not_found' });
    const reasons: string[] = [];
    if (!p.location) reasons.push('location_missing');
    else if (p.location.accuracyM == null || p.location.accuracyM > 50) reasons.push('weak_location_accuracy');
    if (Date.parse(p.observedAt) > Date.now() + 5 * 60_000) reasons.push('observed_in_future');
    let outcome = 'recorded';
    if (o.status === 'completed') {
      reasons.push('task_already_completed');
      outcome = 'already_completed';
    } else if (o.status === 'submitted') {
      reasons.push('task_already_submitted');
      outcome = 'already_submitted';
    }
    const reviewState = reasons.length ? 'review_required' : 'received';
    const late = Date.now() > o.dueAt + 15 * 60_000;
    const subId = `syn-sub-${subs.length + 1}`;
    const receivedAt = iso(Date.now());
    subs.push({ id: subId, occurrenceId: o.occurrenceId, actor: s.id, opId: req.operationId, state: reviewState, reasons, late, observedAt: p.observedAt, receivedAt, accuracyM: p.location?.accuracyM ?? null, decidedBy: null, decidedAt: null, note: null });
    if (o.status === 'pending') {
      o.status = 'submitted';
      o.overdue = false;
    }
    o.latestSubmissionState = reviewState;
    return { receiptId: req.operationId, submissionId: subId, reviewState, reviewReasons: reasons, outcome, late, receivedAt };
  };

  const submitPunch = (req: SubmitRequest): Record<string, unknown> => {
    const s = STAFF[req.actorId];
    if (!s || (s.role !== 'GROOM' && s.role !== 'INSTRUCTOR')) throw new TransportError('http', { status: 403, code: 'not allowed for this account' });
    if (shifts.some((x) => x.userId === s.id && x.punchOutAt === null && Date.parse(x.punchInAt) > Date.now() - 24 * 3_600_000)) {
      throw new TransportError('http', { status: 409, code: 'already punched in; punch out first' });
    }
    const p = req.payload as { observedAt: string; location: { latitude: number; longitude: number; accuracyM: number | null } | null };
    const hubPos = HUB_POS[s.hub]!;
    const dist = p.location ? Math.round(distanceM(hubPos, { lat: p.location.latitude, lng: p.location.longitude })) : null;
    const state: VerificationState = !p.location ? 'no_location' : p.location.accuracyM == null || p.location.accuracyM > 50 ? 'low_accuracy' : (dist ?? 0) > 50 ? 'outside_radius' : 'within_radius';
    const id = `syn-att-${shifts.length + 1}`;
    shifts.push({ attendanceId: id, userId: s.id, hubId: s.hub, punchInAt: iso(Date.now()), punchOutAt: null, observedAt: p.observedAt, accuracyM: p.location?.accuracyM ?? null, distanceM: dist, verificationState: state, operationId: req.operationId, review: null, decision: null });
    return { receiptId: req.operationId, attendanceId: id, verificationState: state, distanceM: dist };
  };

  const transport: Transport = {
    async createUploadIntent(req) {
      await delay();
      if (req.actorId === OFFLINE) throw new TransportError('network', { message: 'offline (simulated)' });
      const s = STAFF[req.actorId];
      if (!s) throw new TransportError('http', { status: 403, code: 'not_field_staff' });
      return { mediaPath: `${s.hub}/${req.actorId}/${req.operationId}.jpg`, url: `fixture://${req.operationId}`, expiresAt: Date.now() + 60_000 };
    },
    async submit(req) {
      await delay();
      if (req.actorId === OFFLINE) throw new TransportError('network', { message: 'offline (simulated)' });
      const prev = receipts.get(req.operationId);
      if (prev) {
        if (prev.actor !== req.actorId || prev.hash !== req.payloadHash) throw new TransportError('http', { status: 409, code: 'idempotency_key_reused' });
        return { ...prev.result, replayed: true };
      }
      const result = req.commandType === 'shift.punchIn' ? submitPunch(req) : submitCare(req);
      receipts.set(req.operationId, { actor: req.actorId, hash: req.payloadHash, result });
      return { ...result, replayed: false };
    },
  };

  // ---------------------------------------------------------------- outbox with a few parked items for the Sync centre
  const store = new MemoryQueueStore();
  const vault = createUriFileVault({
    read: async (uri) => new TextEncoder().encode(`synthetic photo bytes for ${uri}`),
    put: async (target) => {
      await delay();
      objects.add(target.mediaPath);
    },
  });
  const seed = async () => {
    const add = async (it: { op: string; actor: string; occ: string | null; state: QueueItem['state']; minutesAgo: number; code?: string; detail?: string; receipt?: Record<string, unknown>; nextInMin?: number; accuracyM?: number | null; attempts?: number }) => {
      const o = it.occ ? occs.get(it.occ)! : null;
      const observed = nowAt - it.minutesAgo * 60_000;
      const ref = o ? `evidence/${it.actor}/${it.op}.jpg` : null;
      const payload = o
        ? { occurrenceId: o.occurrenceId, horseId: o.horseId, observedAt: iso(observed), location: it.accuracyM === null ? null : { latitude: 17.3851, longitude: 78.4868, accuracyM: it.accuracyM ?? 14 }, evidence: { sha256: 'synthetic', sizeBytes: 1, mimeType: 'image/jpeg' } }
        : { observedAt: iso(observed), location: { latitude: 17.3851, longitude: 78.4868, accuracyM: it.accuracyM ?? 14 } };
      store.insertCapturing(
        { operationId: it.op, actorId: it.actor, hubId: HUB1, aggregateId: o?.occurrenceId ?? 'shift', commandType: o ? 'care.submitEvidence' : 'shift.punchIn', payloadVersion: 1, payload, payloadHash: 'pending', localFileRefs: ref ? [ref] : [], observedAt: observed },
        observed,
      );
      if (ref) await vault.finalize(`fixture-capture://${it.op}`, ref);
      store.markReady(it.op, { payload, payloadHash: payloadHash(payload) }, observed);
      if (it.state === 'acknowledged') {
        const lease = store.leaseNext(it.actor, 'seed', observed + 60_000, 1000);
        if (lease?.operationId === it.op) store.acknowledge(it.op, 'seed', { receiptId: it.op, replayed: false, ...(it.receipt ?? {}) }, observed + 3 * 60_000);
      } else if (it.state !== 'ready') {
        const lease = store.leaseNext(it.actor, 'seed', observed + 60_000, 1000);
        if (lease?.operationId === it.op) {
          store.updateLeased(it.op, 'seed', { state: it.state, attemptCount: it.attempts ?? 1, nextAttemptAt: it.nextInMin ? nowAt + it.nextInMin * 60_000 : null, lastErrorCode: it.code ?? null, lastErrorDetail: it.detail ?? null }, observed + 60_000);
        }
      }
    };
    await add({ op: 'syn-op-groom-chetak-water', actor: 'syn-groom', occ: chetakWater, state: 'acknowledged', minutesAgo: 175, accuracyM: 85, receipt: { reviewState: 'review_required', reviewReasons: ['weak_location_accuracy'], receivedAt: iso(nowAt - 172 * 60_000), outcome: 'recorded' } });
    await add({ op: 'syn-op-groom-badal-groom', actor: 'syn-groom', occ: 'syn-occ-badal-groominghoof-1', state: 'needs_review', minutesAgo: 95, code: 'idempotency_key_reused', detail: '409 idempotency_key_reused' });
    await add({ op: 'syn-op-groom-toofan-water', actor: 'syn-groom', occ: 'syn-occ-toofan-water-1', state: 'retry_wait', minutesAgo: 20, code: 'network', detail: 'network', nextInMin: 12, attempts: 3 });
    await add({ op: 'syn-op-offline-badal-water', actor: OFFLINE, occ: 'syn-occ-badal-water-1', state: 'retry_wait', minutesAgo: 8, code: 'network', detail: 'network', nextInMin: -1, attempts: 2 });
    // another account's unsent work on this phone: counted on the Sync screen, never shown
    await add({ op: 'syn-op-g2-badal-water', actor: 'syn-groom-2', occ: 'syn-occ-badal-water-1', state: 'retry_wait', minutesAgo: 400, code: 'network', nextInMin: 600 });
  };
  const seeded = seed();

  const outbox = createFieldOutbox({
    store,
    files: vault,
    transport,
    offlineEvidenceAllowed: evaluateDevicePolicy({ buildProfile: 'development', usesSyntheticData: true, storageProtection: 'unverified', ownerAcceptedStorageEvidence: false }).offlineEvidenceAllowed,
    newId: () => newOperationId(),
  });
  const setSession = outbox.setSession.bind(outbox);
  outbox.setSession = (who) => {
    void seeded.then(() => setSession(who));
  };

  // ---------------------------------------------------------------- repositories
  return {
    source: 'synthetic-preview',
    outbox,
    horses: {
      async listHorses(scope) {
        const s = staffOf(scope);
        await delay();
        return HORSES.filter((h) => h.hubId === s.hub).map((h) => ({ ...h }));
      },
    },
    care: {
      async timeline(scope, from, to) {
        const s = staffOf(scope);
        await delay();
        if (s.role === 'SCHOOL_ADMIN') return { kind: 'not_assigned_staff' };
        await seeded;
        const mine = ASSIGNED[s.id] ?? [];
        const occurrences = [...occs.values()]
          .filter((o) => o.hubId === s.hub && mine.includes(o.horseId) && o.localDate >= from && o.localDate <= to && o.status !== 'cancelled')
          .sort((a, b) => a.dueAt - b.dueAt)
          .map(({ hubId: _h, submissions: _s, ...o }) => ({ ...o }));
        return { kind: 'ok', occurrences, fetchedAt: Date.now() };
      },
    },
    shift: {
      async status(scope) {
        const s = staffOf(scope);
        await delay();
        const recent = shifts
          .filter((x) => x.userId === s.id)
          .sort((a, b) => Date.parse(b.punchInAt) - Date.parse(a.punchInAt))
          .slice(0, 5)
          .map(({ userId: _u, hubId: _h, decision, raceWith: _r, ...x }) => ({ ...x, review: decision ? { decision: decision.decision, reason: decision.reason, decidedAt: decision.at } : null }));
        const open = recent.find((x) => x.punchOutAt === null && Date.parse(x.punchInAt) > Date.now() - 24 * 3_600_000) ?? null;
        return { open, recent, photoProof: 'not_supported', thresholdM: flagsFor(scope).attendanceAccuracyThresholdM };
      },
      async punchOut(scope, attendanceId) {
        const s = staffOf(scope);
        await delay();
        const x = shifts.find((r) => r.attendanceId === attendanceId && r.userId === s.id);
        if (!x) throw new FieldCommandError('notFound', 'This shift record isn’t yours.', 'PT404');
        if (x.punchOutAt) return { attendanceId, punchOutAt: x.punchOutAt, duplicate: true };
        x.punchOutAt = iso(Date.now());
        return { attendanceId, punchOutAt: x.punchOutAt, duplicate: false };
      },
    },
    policy: {
      async flags(scope) {
        staffOf(scope);
        await delay();
        return flagsFor(scope);
      },
    },
    review: {
      async queue(scope) {
        const s = staffOf(scope);
        await delay();
        if (!reviewer(s)) return { kind: 'denied' };
        await seeded;
        return { kind: 'ok', items: reviewItems(s.hub, s).filter((i) => i.state === 'open').sort((a, b) => (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '')), fetchedAt: Date.now() };
      },
      async item(scope, kind, itemId) {
        const s = staffOf(scope);
        await delay();
        if (!reviewer(s)) throw new FieldCommandError('forbidden', 'Your account can’t see this.', '42501');
        const it = reviewItems(s.hub, s).find((i) => i.kind === kind && i.itemId === itemId);
        if (!it) throw new FieldCommandError('notFound', 'Not found.', 'PT404');
        return it;
      },
      async decide(scope, req) {
        const s = staffOf(scope);
        await delay();
        const hash = payloadHash({ k: req.kind, i: req.itemId, v: req.expectedVersion, d: req.decision, r: req.reason.trim() });
        const prev = decisionOps.get(req.operationId);
        if (prev) {
          if (prev.actor !== s.id || prev.hash !== hash) throw new FieldCommandError('conflict', 'This clashed with an earlier request.', 'PT409');
          return { ...(prev.result as { kind: typeof req.kind; itemId: string; decision: 'accepted' | 'rejected'; decidedAt: string }), duplicate: true };
        }
        if (!reviewer(s)) throw new FieldCommandError('forbidden', 'Your account can’t do this.', '42501');
        const reason = req.reason.trim();
        if (reason.length < 3 || reason.length > 500) throw new FieldCommandError('invalid', 'A reason of 3 to 500 characters is required.', 'PT422');
        const at = iso(Date.now());
        const decision = req.decision === 'accept' ? ('accepted' as const) : ('rejected' as const);
        if (req.kind === 'care_evidence') {
          const x = subs.find((r) => r.id === req.itemId && occs.get(r.occurrenceId)?.hubId === s.hub);
          if (!x) throw new FieldCommandError('notFound', 'Not found.', 'PT404');
          if (x.actor === s.id) throw new FieldCommandError('forbidden', 'You can’t review your own record.', '42501');
          if (x.raceWith && x.state !== 'accepted' && x.state !== 'rejected') {
            // simulated concurrent reviewer: someone else decided a moment earlier
            Object.assign(x, { state: 'accepted', decidedBy: x.raceWith, decidedAt: iso(Date.now() - 20_000), note: 'Checked at the stable (sample).' });
            const o = occs.get(x.occurrenceId)!;
            o.status = 'completed';
            o.latestSubmissionState = 'accepted';
          }
          const version = x.state === 'accepted' || x.state === 'rejected' ? 2 : 1;
          if (version !== req.expectedVersion) throw new FieldCommandError('conflict', `the item changed since it was loaded (version ${version})`, 'PT409');
          Object.assign(x, { state: decision, decidedBy: s.id, decidedAt: at, note: reason });
          const o = occs.get(x.occurrenceId)!;
          o.latestSubmissionState = decision;
          if (decision === 'accepted') {
            o.status = 'completed';
            o.overdue = false;
          } else if (o.status === 'submitted') o.status = 'pending';
        } else if (req.kind === 'shift_attendance') {
          const x = shifts.find((r) => r.attendanceId === req.itemId && r.hubId === s.hub);
          if (!x) throw new FieldCommandError('notFound', 'Not found.', 'PT404');
          if (x.userId === s.id) throw new FieldCommandError('forbidden', 'You can’t review your own record.', '42501');
          const version = x.decision ? 2 : 1;
          if (version !== req.expectedVersion) throw new FieldCommandError('conflict', `the item changed since it was loaded (version ${version})`, 'PT409');
          x.decision = { by: s.id, decision, reason, at }; // the attendance row itself is never marked verified
        } else {
          const p = proposals.find((r) => r.id === req.itemId && r.hubId === s.hub);
          if (!p) throw new FieldCommandError('notFound', 'Not found.', 'PT404');
          if (p.by === s.id) throw new FieldCommandError('forbidden', 'You cannot decide your own proposal.', '42501');
          if (p.version !== req.expectedVersion) throw new FieldCommandError('conflict', `the item changed since it was loaded (version ${p.version})`, 'PT409');
          Object.assign(p, { status: decision === 'accepted' ? 'approved' : 'rejected', version: 2, decidedBy: s.id, decidedAt: at, reason });
          if (decision === 'accepted' && CADETS[p.cadetId]) CADETS[p.cadetId]!.rank = p.to;
        }
        const result = { kind: req.kind, itemId: req.itemId, decision, decidedAt: at };
        decisionOps.set(req.operationId, { actor: s.id, hash, result });
        return { ...result, duplicate: false };
      },
      async evidenceUrl() {
        return null; // no photos exist in the synthetic world
      },
    },
    rank: {
      async candidate(scope, cadetId) {
        const s = staffOf(scope);
        await delay();
        const c = CADETS[cadetId];
        if (!c || c.hub !== s.hub) throw new FieldCommandError('notFound', 'This cadet isn’t at your hub.', 'PT404');
        return { cadetId, name: c.name, currentRank: c.rank, sessions: c.sessions.map((x) => ({ ...x })) };
      },
      async propose(scope, req) {
        const s = staffOf(scope);
        await delay();
        const flags = flagsFor(scope);
        if (!flags.rankProposals.enabled) throw new FieldCommandError('forbidden', 'Rank proposals are switched off.', 'PT403');
        if (!flags.rankProposals.proposerRoles.includes(s.role)) throw new FieldCommandError('forbidden', 'Your account can’t propose ranks.', '42501');
        const c = CADETS[req.cadetId];
        if (!c || c.hub !== s.hub) throw new FieldCommandError('notFound', 'This cadet isn’t at your hub.', 'PT404');
        const existing = proposals.find((p) => p.cadetId === req.cadetId && p.status === 'proposed');
        if (existing) {
          if (existing.by === s.id && existing.to === req.toRank) return { proposalId: existing.id, fromRank: existing.from, toRank: existing.to, status: 'proposed', proposedAt: existing.at, duplicate: true };
          throw new FieldCommandError('conflict', 'An open proposal already exists for this cadet.', 'PT409');
        }
        if (req.toRank === c.rank) throw new FieldCommandError('invalid', 'The cadet already holds this rank.', 'PT422');
        const p: Proposal = { id: `syn-prop-${proposals.length + 1}`, cadetId: req.cadetId, hubId: s.hub, from: c.rank, to: req.toRank, evidence: [...new Set(req.evidenceSessionIds)], note: req.note, by: s.id, at: iso(Date.now()), status: 'proposed', version: 1, decidedBy: null, decidedAt: null, reason: null };
        proposals.push(p);
        return { proposalId: p.id, fromRank: p.from, toRank: p.to, status: 'proposed', proposedAt: p.at, duplicate: false };
      },
    },
    posture: {
      async capability(scope) {
        const s = staffOf(scope);
        await delay();
        if (s.role === 'GROOM') throw new FieldCommandError('forbidden', 'Your account can’t see this.', '42501');
        return { status: 'unavailable', reason: 'feature_disabled' };
      },
    },
  };
}
