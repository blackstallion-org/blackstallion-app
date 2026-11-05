/**
 * Server implementation over the merged delta (hub_horses, field_punch_in/out), G5 (field.my_care_timeline,
 * field.submit_care_evidence, proof-photos) and G9 (review, rank, posture capability, flags). Contracts:
 * SLICE_CONTRACT.md §A5, BACKEND_CONTRACT_V2.md §2–3.10. Every argument is sent (no SQL defaults). Nothing is reported as
 * done unless the server answered with a well-formed success payload.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateDevicePolicy } from '@/features/care/domain/devicePolicy';
import type { CareTaskType, ServerCareOccurrence } from '@/features/care/domain/careTypes';
import { withTimeout } from '@/features/field/data/net';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { FieldCommandError, toCommandError } from '@/features/field/domain/commandErrors';
import { newOperationId } from '@/features/field/domain/operation';
import { MemoryQueueStore } from '@/features/sync/domain/memoryQueueStore';
import type { SubmitRequest, Transport, UploadIntentRequest, UploadTarget } from '@/features/sync/domain/ports';
import { TransportError } from '@/features/sync/domain/ports';

import { isRank } from '../domain/review';
import {
  DEFAULT_FLAGS,
  type CareTimeline,
  type FieldOpsScope,
  type HubHorse,
  type PolicyFlags,
  type PostureCapability,
  type RankCandidate,
  type ReviewItem,
  type ReviewKind,
  type ShiftRecord,
  type VerificationState,
} from '../domain/types';
import { createFieldOutbox, createUriFileVault } from './outbox';
import type { FieldOpsRepositories, FieldOutbox } from './repositories';

type Obj = Record<string, unknown>;
type Res = { data: unknown; error: unknown; status?: number };
type RpcLike = Pick<DataClient, 'rpc'>;
type Bucket = {
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  createSignedUploadUrl(path: string): PromiseLike<{ data: { signedUrl: string; token: string; path: string } | null; error: unknown }>;
  uploadToSignedUrl(path: string, token: string, body: ArrayBuffer | Uint8Array, opts?: { contentType?: string }): PromiseLike<{ data: unknown; error: unknown }>;
};
/** The real client is a SupabaseClient; tests pass a fake with the same surfaces. */
export type FieldOpsClient = DataClient & { schema?: (name: string) => RpcLike; storage?: { from(bucket: string): Bucket } } & Partial<Pick<SupabaseClient, 'auth'>>;

const SHAPE = 'The academy sent an answer this app doesn’t understand. Nothing is confirmed.';
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (o: Obj, k: string): string | null => (typeof o[k] === 'string' && (o[k] as string).length > 0 ? (o[k] as string) : null);
const n = (o: Obj, k: string): number | null => {
  const v = o[k];
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};
const must = (o: Obj, k: string): string => {
  const v = s(o, k);
  if (v === null) throw new FieldCommandError('unexpected', SHAPE, `SHAPE-${k}`);
  return v;
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const PROOF_BUCKET = 'proof-photos';
const SIGNED_URL_TTL_S = 120;

async function call(q: PromiseLike<Res>, timeoutMs?: number): Promise<Res> {
  try {
    return await withTimeout(q as PromiseLike<Res> & { abortSignal?: never }, timeoutMs);
  } catch (e) {
    throw toCommandError(e, 'load');
  }
}

async function rpcData(c: RpcLike, fn: string, args: Obj, timeoutMs?: number): Promise<unknown> {
  const r = await call(c.rpc(fn, args) as unknown as PromiseLike<Res>, timeoutMs);
  if (r.error) throw toCommandError(r.error, 'load', r.status);
  return r.data;
}

function fieldSchema(c: FieldOpsClient): RpcLike {
  if (typeof c.schema !== 'function') throw new FieldCommandError('unexpected', 'Care tasks need a build connected to the academy.', 'CLIENT-SCHEMA');
  return c.schema('field');
}

function scopeGuard(scope: FieldOpsScope): void {
  if (scope.experience !== 'field') throw new FieldCommandError('forbidden', 'This isn’t available in this experience.', 'SCOPE');
}

// ------------------------------------------------------------------ mappers (exported for contract tests)
export function mapHorse(r: unknown): HubHorse {
  if (!isObj(r)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-horse');
  // microchip_iso_id is deliberately not copied (FO-08 acceptance)
  return {
    horseId: must(r, 'horse_id'),
    hubId: must(r, 'hub_id'),
    name: must(r, 'name'),
    breed: s(r, 'breed'),
    heightHands: n(r, 'height_hands'),
    temperament: s(r, 'temperament'),
    active: r.is_active !== false,
  };
}

const TASKS: readonly CareTaskType[] = ['feed', 'water', 'grooming_hoof', 'tack_check', 'medication'];
export function mapOccurrence(r: unknown): ServerCareOccurrence {
  if (!isObj(r)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-occurrence');
  const task = must(r, 'task_type');
  const status = must(r, 'status');
  const due = Date.parse(must(r, 'due_at'));
  if (!TASKS.includes(task as CareTaskType) || Number.isNaN(due) || !['pending', 'submitted', 'completed', 'cancelled'].includes(status)) {
    throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-occurrence');
  }
  const latest = s(r, 'latest_submission_state');
  return {
    occurrenceId: must(r, 'occurrence_id'),
    horseId: must(r, 'horse_id'),
    horseName: must(r, 'horse_name'),
    taskType: task as CareTaskType,
    slotKey: s(r, 'slot_key') ?? '',
    localDate: must(r, 'local_date'),
    dueAt: due,
    timezone: s(r, 'timezone') ?? 'Asia/Kolkata',
    instructions: s(r, 'instructions') ?? '',
    status: status as ServerCareOccurrence['status'],
    scheduleVersion: n(r, 'schedule_version') ?? 1,
    latestSubmissionState: latest === 'received' || latest === 'review_required' || latest === 'accepted' || latest === 'rejected' ? latest : null,
    overdue: r.overdue === true,
  };
}

const VSTATES: readonly VerificationState[] = ['within_radius', 'outside_radius', 'low_accuracy', 'no_location', 'hub_location_unknown'];
const vstate = (v: unknown): VerificationState | null => (VSTATES.includes(v as VerificationState) ? (v as VerificationState) : null);

export function mapReviewItem(r: unknown): ReviewItem {
  if (!isObj(r)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-review');
  const kind = must(r, 'item_kind');
  if (kind !== 'care_evidence' && kind !== 'shift_attendance' && kind !== 'rank_proposal') throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-kind');
  const state = must(r, 'state');
  const bucket = s(r, 'media_bucket');
  const path = s(r, 'media_path');
  return {
    kind,
    itemId: must(r, 'item_id'),
    hubId: must(r, 'hub_id'),
    version: n(r, 'version') ?? 1,
    state: state === 'accepted' || state === 'rejected' ? state : 'open',
    reasons: strs(r.reasons),
    subjectUserId: s(r, 'subject_user_id'),
    subjectName: s(r, 'subject_name'),
    observedAt: s(r, 'observed_at'),
    receivedAt: s(r, 'received_at'),
    accuracyM: n(r, 'accuracy_m'),
    distanceM: n(r, 'distance_m'),
    horseName: s(r, 'horse_name'),
    taskType: s(r, 'task_type'),
    dueAt: s(r, 'due_at'),
    late: typeof r.late === 'boolean' ? r.late : null,
    media: bucket && path ? { bucket, path } : null,
    cadetId: s(r, 'cadet_id'),
    cadetName: s(r, 'cadet_name'),
    fromRank: s(r, 'from_rank'),
    toRank: s(r, 'to_rank'),
    evidenceSessionIds: strs(r.evidence_session_ids),
    decidedBy: s(r, 'decided_by'),
    decidedAt: s(r, 'decided_at'),
    decisionReason: s(r, 'decision_reason'),
    // absent → false: never offer a decision the server did not allow
    canDecide: r.can_decide === true,
  };
}

export function mapFlags(raw: unknown): PolicyFlags {
  if (!isObj(raw)) return DEFAULT_FLAGS;
  const f = (k: string) => (isObj(raw[k]) ? (raw[k] as Obj) : null);
  const rank = f('rank_proposals');
  const thr = f('attendance_accuracy_threshold_m');
  const posture = f('posture_analysis');
  const roles = f('review_roles');
  const rankVal = isObj(rank?.value) ? (rank!.value as Obj) : {};
  const rolesVal = roles?.enabled === true && isObj(roles.value) ? (roles.value as Obj) : {};
  const thrVal = thr?.enabled === true ? n({ v: thr.value }, 'v') : null;
  return {
    rankProposals: {
      enabled: rank?.enabled === true,
      proposerRoles: strs(rankVal.proposer_roles).length ? strs(rankVal.proposer_roles) : DEFAULT_FLAGS.rankProposals.proposerRoles,
      approverRole: s(rankVal, 'approver_role') ?? DEFAULT_FLAGS.rankProposals.approverRole,
    },
    attendanceAccuracyThresholdM: thrVal,
    postureAnalysis: { enabled: posture?.enabled === true, provider: isObj(posture?.value) ? s(posture!.value as Obj, 'provider') : null },
    reviewRoles: {
      careEvidence: strs(rolesVal.care_evidence).length ? strs(rolesVal.care_evidence) : DEFAULT_FLAGS.reviewRoles.careEvidence,
      shiftAttendance: strs(rolesVal.shift_attendance).length ? strs(rolesVal.shift_attendance) : DEFAULT_FLAGS.reviewRoles.shiftAttendance,
    },
  };
}

/** supabase-js error → TransportError the G5 worker classifies (PTxyz → HTTP xyz, 42501 → 403, PT401 → 401). */
export function toTransportError(error: unknown, status?: number): TransportError {
  const e = isObj(error) ? error : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  if (/^PT\d{3}$/.test(code)) return new TransportError('http', { status: Number(code.slice(2)), code: message || code, message: `${code} ${message}` });
  if (code === '42501') return new TransportError('http', { status: 403, code: message || code, message: `${code} ${message}` });
  const st = typeof status === 'number' ? status : 0;
  if (st === 0 || /network|failed to fetch|timed out|timeout/i.test(message)) return new TransportError('network', { message: message || 'network' });
  if (st === 401 || code.startsWith('PGRST30')) return new TransportError('http', { status: 401, code: 'no_session' });
  return new TransportError('http', { status: st, code: code || message || `http_${st}`, message });
}

// ------------------------------------------------------------------ transport for the outbox
export function createSupabaseFieldTransport(c: FieldOpsClient, hubOf: () => string | null, timeoutMs?: number): Transport {
  const rpcOrThrow = async (target: RpcLike, fn: string, args: Obj): Promise<Obj> => {
    let r: Res;
    try {
      r = await withTimeout(target.rpc(fn, args) as unknown as PromiseLike<Res> & { abortSignal?: never }, timeoutMs);
    } catch (e) {
      throw new TransportError('network', { message: e instanceof Error ? e.message : 'network' });
    }
    if (r.error) throw toTransportError(r.error, r.status);
    if (!isObj(r.data)) throw new TransportError('http', { status: 502, code: 'bad_shape', message: SHAPE });
    return r.data;
  };
  return {
    async createUploadIntent(req: UploadIntentRequest): Promise<UploadTarget> {
      const hub = hubOf();
      if (!hub) throw new TransportError('http', { status: 403, code: 'not_field_staff' });
      if (!c.storage) throw new TransportError('http', { status: 501, code: 'no_storage' });
      // G5 policy: staff upload only under <their hub>/<their id>/ in the private proof-photos bucket
      const mediaPath = `${hub}/${req.actorId}/${req.operationId}.jpg`;
      const { data, error } = await c.storage.from(PROOF_BUCKET).createSignedUploadUrl(mediaPath);
      if (error || !data) {
        const msg = isObj(error) && typeof error.message === 'string' ? error.message : '';
        // a retry after a lost "upload done" mark: the object is already there, so the upload step is skipped
        if (/exists|duplicate/i.test(msg)) return { mediaPath, url: 'already-uploaded:', expiresAt: Date.now() + 60_000 };
        throw toTransportError(error, isObj(error) && typeof error.statusCode === 'string' ? Number(error.statusCode) : 403);
      }
      return { mediaPath, url: `${data.signedUrl}#token=${data.token}`, expiresAt: Date.now() + 2 * 3_600_000 };
    },
    async submit(req: SubmitRequest): Promise<Record<string, unknown>> {
      const p = req.payload as Obj;
      const loc = isObj(p.location) ? (p.location as Obj) : null;
      if (req.commandType === 'care.submitEvidence') {
        const r = await rpcOrThrow(fieldSchema(c), 'submit_care_evidence', {
          p_operation_id: req.operationId,
          p_payload_hash: req.payloadHash,
          p_occurrence_id: p.occurrenceId,
          p_horse_id: p.horseId,
          p_media_path: p.mediaPath,
          p_observed_at: p.observedAt,
          p_latitude: loc ? loc.latitude : null,
          p_longitude: loc ? loc.longitude : null,
          p_accuracy_m: loc ? (loc.accuracyM ?? null) : null,
        });
        if (typeof r.reviewState !== 'string') throw new TransportError('http', { status: 502, code: 'bad_shape', message: SHAPE });
        return { ...r, receiptId: r.receiptId ?? req.operationId, replayed: r.replayed === true };
      }
      if (req.commandType === 'shift.punchIn') {
        const r = await rpcOrThrow(c, 'field_punch_in', {
          p_latitude: loc ? loc.latitude : null,
          p_longitude: loc ? loc.longitude : null,
          p_accuracy_m: loc ? (loc.accuracyM ?? null) : null,
          p_observed_at: p.observedAt,
          p_operation_id: req.operationId,
        });
        if (typeof r.attendance_id !== 'string') throw new TransportError('http', { status: 502, code: 'bad_shape', message: SHAPE });
        return {
          receiptId: req.operationId,
          replayed: r.duplicate === true,
          attendanceId: r.attendance_id,
          verificationState: r.verification_state ?? null,
          distanceM: r.distance_m ?? null,
        };
      }
      throw new TransportError('http', { status: 422, code: 'unknown_command' });
    },
  };
}

async function readUri(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

function signedPut(c: FieldOpsClient) {
  return async (target: UploadTarget, bytes: Uint8Array) => {
    if (target.url.startsWith('already-uploaded:')) return;
    if (!c.storage) throw new TransportError('http', { status: 501, code: 'no_storage' });
    const token = /#token=(.+)$/.exec(target.url)?.[1];
    if (!token) throw new TransportError('http', { status: 410, code: 'upload_url_expired' });
    if (Date.now() > target.expiresAt) throw new TransportError('http', { status: 410, code: 'upload_url_expired' });
    const { error } = await c.storage.from(PROOF_BUCKET).uploadToSignedUrl(target.mediaPath, token, bytes, { contentType: 'image/jpeg' });
    if (error) {
      const msg = isObj(error) && typeof error.message === 'string' ? error.message : '';
      if (/exists|duplicate/i.test(msg)) return; // same object already stored by an earlier attempt
      throw toTransportError(error, 400);
    }
  };
}

// ------------------------------------------------------------------ repositories
export function createFieldOpsServer(client: DataClient, opts: { timeoutMs?: number; outbox?: FieldOutbox } = {}): FieldOpsRepositories | undefined {
  const c = client as FieldOpsClient;
  const t = opts.timeoutMs;
  let hub: string | null = null;
  const outbox =
    opts.outbox ??
    createFieldOutbox({
      // No durable driver is installed (expo-sqlite): the queue is honest about being memory-only.
      store: new MemoryQueueStore(),
      files: createUriFileVault({ read: readUri, put: signedPut(c) }),
      transport: createSupabaseFieldTransport(c, () => hub, t),
      offlineEvidenceAllowed: evaluateDevicePolicy({
        buildProfile: 'production',
        usesSyntheticData: false,
        storageProtection: 'unverified',
        ownerAcceptedStorageEvidence: false,
      }).offlineEvidenceAllowed,
      newId: () => newOperationId(),
    });
  const setSession = outbox.setSession.bind(outbox);
  outbox.setSession = (who) => {
    hub = who?.hubId ?? null;
    setSession(who);
  };

  return {
    source: 'server',
    outbox,
    horses: {
      async listHorses(scope) {
        scopeGuard(scope);
        const data = await rpcData(c, 'hub_horses', {}, t);
        return (Array.isArray(data) ? data : []).map(mapHorse);
      },
    },
    care: {
      async timeline(scope, from, to): Promise<CareTimeline> {
        scopeGuard(scope);
        const r = await call(fieldSchema(c).rpc('my_care_timeline', { p_from: from, p_to: to }) as unknown as PromiseLike<Res>, t);
        if (r.error) {
          const e = r.error as Obj;
          if (e.code === '42501' && e.message === 'not_field_staff') return { kind: 'not_assigned_staff' };
          throw toCommandError(r.error, 'load', r.status);
        }
        return { kind: 'ok', occurrences: (Array.isArray(r.data) ? r.data : []).map(mapOccurrence), fetchedAt: Date.now() };
      },
    },
    shift: {
      async status(scope) {
        scopeGuard(scope);
        const flags = mapFlags(await rpcData(c, 'app_policy_flags', {}, t));
        const r = await call(
          c
            .from('staff_attendance')
            .select('id, punch_in_time, punch_out_time, observed_at, accuracy_m, distance_m, verification_state, client_operation_id')
            .eq('user_id', scope.subjectId)
            .order('punch_in_time', { ascending: false })
            .limit(5) as unknown as PromiseLike<Res>,
          t,
        );
        if (r.error) throw toCommandError(r.error, 'load', r.status);
        const rows = (Array.isArray(r.data) ? r.data : []).filter(isObj);
        const ids = rows.map((x) => s(x, 'id')).filter((x): x is string => x !== null);
        const decisions = new Map<string, ShiftRecord['review']>();
        if (ids.length) {
          const d = await call(
            c.from('app_review_decisions').select('item_id, decision, reason, decided_at').eq('item_kind', 'shift_attendance').in('item_id', ids) as unknown as PromiseLike<Res>,
            t,
          );
          if (!d.error) {
            for (const x of (Array.isArray(d.data) ? d.data : []).filter(isObj)) {
              const dec = s(x, 'decision');
              const id = s(x, 'item_id');
              if (id && (dec === 'accepted' || dec === 'rejected')) decisions.set(id, { decision: dec, reason: s(x, 'reason') ?? '', decidedAt: s(x, 'decided_at') ?? '' });
            }
          }
        }
        const recs: ShiftRecord[] = rows.map((x) => ({
          attendanceId: must(x, 'id'),
          punchInAt: must(x, 'punch_in_time'),
          punchOutAt: s(x, 'punch_out_time'),
          observedAt: s(x, 'observed_at'),
          accuracyM: n(x, 'accuracy_m'),
          distanceM: n(x, 'distance_m'),
          verificationState: vstate(x.verification_state),
          operationId: s(x, 'client_operation_id'),
          review: decisions.get(must(x, 'id')) ?? null,
        }));
        // the server's own rule (MIG:530): an open punch-in is one without punch-out in the last 24 h
        const open = recs.find((x) => x.punchOutAt === null && Date.parse(x.punchInAt) > Date.now() - 24 * 3_600_000) ?? null;
        return { open, recent: recs, photoProof: 'not_supported', thresholdM: flags.attendanceAccuracyThresholdM };
      },
      async punchOut(scope, attendanceId) {
        scopeGuard(scope);
        const d = await rpcData(c, 'field_punch_out', { p_attendance_id: attendanceId }, t);
        if (!isObj(d)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-punchout');
        return { attendanceId: must(d, 'attendance_id'), punchOutAt: must(d, 'punch_out_time'), duplicate: d.duplicate === true };
      },
    },
    policy: {
      async flags(scope) {
        scopeGuard(scope);
        return mapFlags(await rpcData(c, 'app_policy_flags', {}, t));
      },
    },
    review: {
      async queue(scope) {
        scopeGuard(scope);
        if (!scope.hubId) return { kind: 'denied' };
        const r = await call(c.rpc('field_review_queue', { p_hub_id: scope.hubId }) as unknown as PromiseLike<Res>, t);
        if (r.error) {
          if ((r.error as Obj).code === '42501') return { kind: 'denied' };
          throw toCommandError(r.error, 'load', r.status);
        }
        return { kind: 'ok', items: (Array.isArray(r.data) ? r.data : []).map(mapReviewItem), fetchedAt: Date.now() };
      },
      async item(scope, kind: ReviewKind, itemId) {
        scopeGuard(scope);
        return mapReviewItem(await rpcData(c, 'field_review_item', { p_item_kind: kind, p_item_id: itemId }, t));
      },
      async decide(scope, req) {
        scopeGuard(scope);
        const reason = req.reason.trim();
        const d =
          req.kind === 'rank_proposal'
            ? await rpcData(c, 'field_decide_rank_proposal', {
                p_proposal_id: req.itemId,
                p_expected_version: req.expectedVersion,
                p_decision: req.decision === 'accept' ? 'approved' : 'rejected',
                p_reason: reason,
                p_operation_id: req.operationId,
              }, t)
            : await rpcData(c, 'field_review_decide', {
                p_item_kind: req.kind,
                p_item_id: req.itemId,
                p_expected_version: req.expectedVersion,
                p_decision: req.decision === 'accept' ? 'accepted' : 'rejected',
                p_reason: reason,
                p_operation_id: req.operationId,
              }, t);
        if (!isObj(d)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-decision');
        const raw = req.kind === 'rank_proposal' ? s(d, 'status') : s(d, 'decision');
        const decision = raw === 'accepted' || raw === 'approved' ? 'accepted' : raw === 'rejected' ? 'rejected' : null;
        if (!decision) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-decision');
        return { kind: req.kind, itemId: req.itemId, decision, decidedAt: must(d, 'decided_at'), duplicate: d.duplicate === true };
      },
      async evidenceUrl(scope, media) {
        scopeGuard(scope);
        if (!c.storage) return null;
        const { data, error } = await c.storage.from(media.bucket).createSignedUrl(media.path, SIGNED_URL_TTL_S);
        if (error || !data) throw toCommandError(error, 'load', 403);
        return data.signedUrl;
      },
    },
    rank: {
      async candidate(scope, cadetId): Promise<RankCandidate> {
        scopeGuard(scope);
        const cr = await call(c.from('cadets').select('id, first_name, last_name, current_rank').eq('id', cadetId).maybeSingle() as unknown as PromiseLike<Res>, t);
        if (cr.error) throw toCommandError(cr.error, 'load', cr.status);
        if (!isObj(cr.data)) throw new FieldCommandError('notFound', 'This cadet isn’t at your hub.', 'PT404');
        const sr = await call(
          c
            .from('training_sessions')
            .select('id, session_date, riding_score, ground_score, stable_score')
            .eq('cadet_id', cadetId)
            .eq('brass_stamp_verified', true)
            .order('session_date', { ascending: false })
            .limit(20) as unknown as PromiseLike<Res>,
          t,
        );
        if (sr.error) throw toCommandError(sr.error, 'load', sr.status);
        const rank = cr.data.current_rank;
        return {
          cadetId: must(cr.data, 'id'),
          name: [s(cr.data, 'first_name'), s(cr.data, 'last_name')].filter(Boolean).join(' ') || 'Cadet',
          currentRank: isRank(rank) ? rank : null,
          sessions: (Array.isArray(sr.data) ? sr.data : []).filter(isObj).map((x) => ({
            sessionId: must(x, 'id'),
            sessionDate: must(x, 'session_date'),
            riding: n(x, 'riding_score'),
            ground: n(x, 'ground_score'),
            stable: n(x, 'stable_score'),
          })),
        };
      },
      async propose(scope, req) {
        scopeGuard(scope);
        const d = await rpcData(c, 'field_propose_rank', {
          p_cadet_id: req.cadetId,
          p_to_rank: req.toRank,
          p_evidence_session_ids: req.evidenceSessionIds,
          p_note: req.note && req.note.trim() ? req.note.trim() : null,
          p_operation_id: req.operationId,
        }, t);
        if (!isObj(d) || d.status !== 'proposed') throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-proposal');
        return { proposalId: must(d, 'proposal_id'), fromRank: must(d, 'from_rank'), toRank: must(d, 'to_rank'), status: 'proposed', proposedAt: must(d, 'proposed_at'), duplicate: d.duplicate === true };
      },
    },
    posture: {
      async capability(scope): Promise<PostureCapability> {
        scopeGuard(scope);
        const d = await rpcData(c, 'field_posture_capability', {}, t);
        if (!isObj(d)) throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-capability');
        const reason = s(d, 'reason');
        // whatever the server says, this build has no posture renderer: only `unavailable` is ever shown
        return { status: 'unavailable', reason: reason === 'feature_disabled' || reason === 'provider_not_configured' || reason === 'provider_not_integrated' ? reason : 'unknown' };
      },
    },
  };
}
