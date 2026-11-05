import type { SupabaseClient } from '@supabase/supabase-js';

import { ScopedLoadError } from '@/core/data/useScopedResource';
import { hubDate, hubTime } from '@/core/format/hubTime';

import { FieldCommandError, toCommandError } from '../domain/commandErrors';
import { isUuid } from '../domain/operation';
import type { FieldScope } from '../types';
import { loadError, NOT_FOUND_REFERENCE, readRows, withTimeout, type Row } from './net';
import type {
  CadetList,
  CadetProfile,
  ConsentValue,
  CorrectRequest,
  CorrectResult,
  FieldAppRepositories,
  FieldCommandRepository,
  MediaConsent,
  RankCode,
  RosterRow,
  SessionRecord,
  SessionSummary,
  Skill,
  TodayCheckIn,
  UploadClipRequest,
  VoidCheckInRequest,
  VoidCheckInResult,
} from './repositories';
import { UNKNOWN_CONSENT } from './repositories';
import { createServerClock, type ServerClock } from './serverClock';
import { voidedCheckIns } from './voids';
import { createSupabaseFieldWorkflowRepository, SHAPE_KEY, type DataClient } from './supabaseFieldWorkflowRepository';

export type FieldAppServerOptions = { clock?: ServerClock; localNow?: () => number; timeoutMs?: number };

const MAX_ROWS = 500;
/** Keeps `.in()` id lists well under URL limits (~37 chars per uuid). */
const IN_CHUNK = 100;
const RANKS: readonly RankCode[] = ['CADET_SQUIRE', 'CADET_RIDER', 'CADET_KNIGHT', 'SOVEREIGN_LANCER'];
const SHAPE = 'The academy sent an answer this app doesn’t understand. Nothing is confirmed.';
export const FEATURE_OFF_REFERENCE = 'FEATURE-OFF';

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const rank = (v: unknown): RankCode | null => (RANKS as readonly unknown[]).includes(v) ? (v as RankCode) : null;
const fullName = (r: Row) => `${s(r.first_name)} ${s(r.last_name)}`.trim() || 'Cadet';
const scoresOf = (r: Row) => {
  const riding = n(r.riding_score);
  const ground = n(r.ground_score);
  const stable = n(r.stable_score);
  return riding !== null && ground !== null && stable !== null ? { riding, ground, stable } : null;
};

/** "BSAH-26-F3A00001" → "BSAH-26-••••0001": enough to match the leather passport, not enough to reuse it. */
export function maskPassport(code: unknown): string | null {
  const c = s(code).trim();
  if (c.length < 6) return null;
  const cut = c.lastIndexOf('-');
  const head = cut > 0 ? c.slice(0, cut + 1) : '';
  return `${head}••••${c.slice(-4)}`;
}

function requireHub(scope: FieldScope): string {
  if (scope.experience !== 'field') throw new ScopedLoadError('Denied', 'SCOPE');
  if (!scope.hubId) throw new ScopedLoadError('Your account isn’t linked to a hub. Ask your hub admin.', 'NO-HUB', true);
  return scope.hubId;
}
const notFound = () => new ScopedLoadError('Not found at your hub.', NOT_FOUND_REFERENCE, true);

function consentValue(v: unknown): ConsentValue {
  return v === true ? 'allowed' : v === false ? 'off' : 'unknown';
}

/**
 * Server implementation over SLICE_CONTRACT §A/B (merged delta MIG) and BACKEND_CONTRACT_V2 (MIG9: consent, roster,
 * flags). Reads go through RLS; the hub filter added here is defence in depth only.
 */
export function createFieldAppServer(client: DataClient, opts: FieldAppServerOptions = {}): FieldAppRepositories {
  const localNow = opts.localNow ?? Date.now;
  const clock = opts.clock ?? createServerClock(client, localNow, opts.timeoutMs);
  const t = opts.timeoutMs;
  /** Hub-local "today" by the server's clock when it can be measured; reads only (writes refuse a skewed clock). */
  const today = async () => hubDate(new Date(localNow() + (await clock.offsetMs().catch(() => 0))));

  async function rpc(fn: string, args: Record<string, unknown> | undefined, context: 'load' | 'correct' | 'void'): Promise<unknown> {
    let res;
    try {
      res = await withTimeout(args ? client.rpc(fn, args) : client.rpc(fn), t);
    } catch (e) {
      throw toCommandError(e, context);
    }
    if (res.error) throw toCommandError(res.error, context, res.status);
    return res.data;
  }

  async function inChunks(table: string, cols: string, col: string, ids: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      out.push(...(await readRows(client.from(table).select(cols).in(col, ids.slice(i, i + IN_CHUNK)), t)));
    }
    return out;
  }

  const voidedAmong = (ids: string[]) => voidedCheckIns(client, ids, t);

  async function todayCheckIns(scope: FieldScope, hub: string): Promise<TodayCheckIn[]> {
    const day = await today();
    const all = await readRows(
      client.from('cadet_check_ins').select('id, cadet_id, received_at, client_operation_id').eq('hub_id', hub).eq('session_date', day).order('received_at', { ascending: false }).limit(MAX_ROWS),
      t,
    );
    const voided = await voidedAmong(all.map((r) => s(r.id)).filter(Boolean));
    const rows = all.filter((r) => !voided.has(s(r.id)));
    const cadetIds = Array.from(new Set(rows.map((r) => s(r.cadet_id)).filter(Boolean)));
    const ids = rows.map((r) => s(r.id)).filter(Boolean);
    const canReadSessions = scope.role === 'INSTRUCTOR';
    const [cadets, sessions] = await Promise.all([
      cadetIds.length ? inChunks('cadets', 'id, first_name, last_name', 'id', cadetIds) : Promise.resolve([]),
      canReadSessions && ids.length ? inChunks('training_sessions', 'check_in_id', 'check_in_id', ids) : Promise.resolve([]),
    ]);
    const names = new Map(cadets.map((c) => [s(c.id), fullName(c)]));
    const published = new Set(sessions.map((x) => s(x.check_in_id)));
    return rows.map((r) => ({
      checkInId: s(r.id),
      checkInOperationId: s(r.client_operation_id),
      cadetId: s(r.cadet_id),
      cadetName: names.get(s(r.cadet_id)) ?? 'Cadet',
      time: hubTime(s(r.received_at)),
      published: canReadSessions ? published.has(s(r.id)) : null,
    }));
  }

  async function consentFor(cadetId: string): Promise<MediaConsent> {
    if (!isUuid(cadetId)) return UNKNOWN_CONSENT;
    try {
      const d = await rpc('field_cadet_media_consent', { p_cadet_id: cadetId }, 'load');
      const c = isObj(d) && isObj(d.consents) ? d.consents : null;
      if (!c) return UNKNOWN_CONSENT;
      return { sessionVideo: consentValue(c.session_video), carePhoto: consentValue(c.care_photo), postureAnalysis: consentValue(c.posture_analysis) };
    } catch {
      // Fail closed: no answer (G9 not applied, offline, refused) means recording stays off.
      return UNKNOWN_CONSENT;
    }
  }

  const correct = async (req: CorrectRequest): Promise<CorrectResult> => {
    if (!isUuid(req.operationId) || !isUuid(req.sessionId)) throw new FieldCommandError('unexpected', 'Internal error: bad operation id.', 'CLIENT-OPID');
    const d = await rpc(
      'field_correct_session',
      {
        p_session_id: req.sessionId,
        p_expected_version: req.expectedVersion,
        p_riding_score: req.scores.riding,
        p_ground_score: req.scores.ground,
        p_stable_score: req.scores.stable,
        p_notes: req.notes?.trim() ? req.notes.trim() : null,
        p_reason: req.reason.trim(),
        p_operation_id: req.operationId,
      },
      'correct',
    );
    if (!isObj(d) || !isUuid(d.session_id) || typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 2 || typeof d.correction_id !== 'string' || typeof d.duplicate !== 'boolean') {
      throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-correct', SHAPE_KEY);
    }
    return { sessionId: d.session_id, version: d.version, correctionId: d.correction_id, duplicate: d.duplicate };
  };

  const storage = (client as Partial<Pick<SupabaseClient, 'storage'>>).storage;
  const uploadClip = storage
    ? async (req: UploadClipRequest) => {
        if (!isUuid(req.clipId) || !isUuid(req.cadetId) || !req.hubId) throw new FieldCommandError('unexpected', 'Internal error: bad clip id.', 'CLIENT-CLIP');
        const ext = /quicktime|mov/i.test(req.mimeType) ? 'mov' : 'mp4';
        // Same clip id → same object path, so a retry after a lost reply finds the first upload instead of a second file.
        const objectPath = `${req.hubId}/${req.cadetId}/${req.clipId}.${ext}`;
        let body: ArrayBuffer;
        try {
          body = await (await fetch(req.uri)).arrayBuffer();
        } catch {
          throw new FieldCommandError('unexpected', 'The clip on this phone couldn’t be read. Record it again.', 'CLIP-READ', 'errors.clipRead');
        }
        let res;
        try {
          res = await withTimeout(storage.from('session-videos').upload(objectPath, body, { contentType: req.mimeType, upsert: false }), 120_000);
        } catch (e) {
          throw toCommandError(e, 'publish');
        }
        if (res.error) {
          const msg = String((res.error as { message?: unknown }).message ?? '');
          if (!/already exists|duplicate/i.test(msg)) throw toCommandError(res.error, 'publish', Number((res.error as { statusCode?: unknown }).statusCode) || undefined);
        }
        return { objectPath };
      }
    : undefined;

  const voidCheckIn = async (req: VoidCheckInRequest): Promise<VoidCheckInResult> => {
    if (!isUuid(req.operationId) || !isUuid(req.checkInId)) throw new FieldCommandError('unexpected', 'Internal error: bad operation id.', 'CLIENT-OPID');
    const d = await rpc('field_void_check_in', { p_check_in_id: req.checkInId, p_reason: req.reason.trim(), p_operation_id: req.operationId }, 'void');
    if (!isObj(d) || !isUuid(d.check_in_id) || typeof d.voided_at !== 'string' || typeof d.duplicate !== 'boolean') {
      throw new FieldCommandError('unexpected', SHAPE, 'SHAPE-void', SHAPE_KEY);
    }
    return { checkInId: d.check_in_id, voidedAt: d.voided_at, duplicate: d.duplicate };
  };

  const workflow = createSupabaseFieldWorkflowRepository(client, { clock, timeoutMs: t, localNow });
  const commands: FieldCommandRepository = { checkIn: workflow.checkIn, publish: workflow.publish, correct, voidCheckIn, uploadClip };

  return {
    checkIns: { listToday: (scope) => todayCheckIns(scope, requireHub(scope)) },

    cadets: {
      async list(scope): Promise<CadetList> {
        const hub = requireHub(scope);
        const [hubRow, cadets, checkIns] = await Promise.all([
          readRows(client.from('school_hubs').select('school_name').eq('id', hub).limit(1), t),
          readRows(client.from('cadets').select('id, first_name, last_name, current_rank').eq('hub_id', hub).order('first_name').order('last_name').limit(MAX_ROWS), t),
          todayCheckIns(scope, hub),
        ]);
        const byCadet = new Map(checkIns.map((c) => [c.cadetId, c]));
        return {
          source: 'server',
          hubName: s(hubRow[0]?.school_name) || 'Your hub',
          cadets: cadets.map((c) => {
            const ci = byCadet.get(s(c.id));
            return { id: s(c.id), name: fullName(c), rank: rank(c.current_rank), today: ci ? { checkInOperationId: ci.checkInOperationId, time: ci.time, published: ci.published } : null };
          }),
        };
      },

      async profile(scope, cadetId): Promise<CadetProfile> {
        const hub = requireHub(scope);
        if (!isUuid(cadetId)) throw notFound();
        const [row] = await readRows(
          client.from('cadets').select('id, first_name, last_name, current_rank, passport_code, assigned_horse_id').eq('id', cadetId).eq('hub_id', hub).limit(1),
          t,
        );
        if (!row) throw notFound();
        const canReadSessions = scope.role === 'INSTRUCTOR';
        const horseId = s(row.assigned_horse_id);
        const [day, allCheckIns, sessions, horse, consent] = await Promise.all([
          today(),
          readRows(client.from('cadet_check_ins').select('id, session_date, received_at, client_operation_id').eq('cadet_id', cadetId).order('session_date', { ascending: false }).limit(30), t),
          canReadSessions
            ? readRows(
                client
                  .from('training_sessions')
                  .select('id, session_date, riding_score, ground_score, stable_score, version, brass_stamp_verified, instructor_id, check_in_id')
                  .eq('cadet_id', cadetId)
                  .order('session_date', { ascending: false })
                  .limit(30),
                t,
              )
            : Promise.resolve(null),
          horseId ? readRows(client.from('equine_fleet').select('name').eq('id', horseId).limit(1), t).catch(() => []) : Promise.resolve([]),
          consentFor(cadetId),
        ]);
        const byCheckIn = new Map((sessions ?? []).map((x) => [s(x.check_in_id), s(x.id)]));
        const voided = await voidedAmong(allCheckIns.map((c) => s(c.id)).filter(Boolean));
        const checkIns = allCheckIns.filter((c) => !voided.has(s(c.id)));
        const todayRow = checkIns.find((c) => s(c.session_date) === day);
        const summaries: SessionSummary[] | null = sessions
          ? sessions.map((x) => ({
              id: s(x.id),
              sessionDate: s(x.session_date),
              scores: scoresOf(x),
              version: n(x.version) ?? 1,
              published: x.brass_stamp_verified === true,
              instructorId: s(x.instructor_id) || null,
            }))
          : null;
        return {
          source: 'server',
          cadet: { id: cadetId, name: fullName(row), firstName: s(row.first_name) || 'Cadet', rank: rank(row.current_rank), passportHint: maskPassport(row.passport_code), horseName: s(horse[0]?.name) || null },
          today: todayRow ? { checkInId: s(todayRow.id), checkInOperationId: s(todayRow.client_operation_id), time: hubTime(s(todayRow.received_at)), publishedSessionId: sessions ? (byCheckIn.get(s(todayRow.id)) ?? null) : null } : null,
          attendance: checkIns.map((c) => ({ date: s(c.session_date), time: hubTime(s(c.received_at)), published: sessions ? byCheckIn.has(s(c.id)) : null })),
          sessions: summaries,
          consent,
        };
      },
    },

    sessions: {
      async record(scope, sessionId): Promise<SessionRecord> {
        const hub = requireHub(scope);
        if (!isUuid(sessionId)) throw notFound();
        const [row] = await readRows(
          client
            .from('training_sessions')
            .select('id, cadet_id, session_date, riding_score, ground_score, stable_score, instructor_notes, version, brass_stamp_verified, instructor_id, check_in_id, video_log_s3_url')
            .eq('id', sessionId)
            .limit(1),
          t,
        );
        if (!row) throw notFound();
        const [cadet] = await readRows(client.from('cadets').select('id, first_name, last_name').eq('id', s(row.cadet_id)).eq('hub_id', hub).limit(1), t);
        if (!cadet) throw notFound(); // a record of a cadet at another hub is never shown, even if a policy let it through
        const [skills, corrections] = await Promise.all([
          readRows(client.from('session_skills').select('skill_id').eq('session_id', sessionId), t),
          readRows(client.from('training_session_corrections').select('id, version_before, previous, reason, corrected_at').eq('session_id', sessionId).order('corrected_at', { ascending: false }).limit(20), t),
        ]);
        return {
          id: sessionId,
          cadetId: s(row.cadet_id),
          cadetName: fullName(cadet),
          sessionDate: s(row.session_date),
          scores: scoresOf(row),
          notes: s(row.instructor_notes) || null,
          version: n(row.version) ?? 1,
          published: row.brass_stamp_verified === true,
          instructorId: s(row.instructor_id) || null,
          skillIds: skills.map((k) => s(k.skill_id)).filter(Boolean),
          hasClip: Boolean(s(row.video_log_s3_url)),
          corrections: corrections.map((c) => {
            const p = isObj(c.previous) ? c.previous : {};
            return {
              id: s(c.id),
              versionBefore: n(c.version_before) ?? 1,
              reason: s(c.reason),
              correctedAt: s(c.corrected_at),
              previous: { riding: n(p.riding) ?? 0, ground: n(p.ground) ?? 0, stable: n(p.stable) ?? 0, notes: s(p.notes) || null },
            };
          }),
        };
      },
      async skills(scope): Promise<Skill[]> {
        requireHub(scope);
        const rows = await readRows(client.from('skills').select('id, name, category').eq('is_active', true).order('category').order('name').limit(200), t);
        return rows.map((r) => ({ id: s(r.id), name: s(r.name), category: s(r.category) })).filter((k) => k.id && k.name);
      },
    },

    consent: { forCadet: async (scope, cadetId) => (requireHub(scope), consentFor(cadetId)) },

    policy: {
      async flags(scope) {
        requireHub(scope);
        try {
          const d = await rpc('app_policy_flags', undefined, 'load');
          const r = isObj(d) && isObj(d.session_roster) ? d.session_roster : null;
          return { sessionRoster: r?.enabled === true };
        } catch {
          return { sessionRoster: false }; // unknown policy = the default (off)
        }
      },
    },

    roster: {
      async forDate(scope, sessionDate): Promise<RosterRow[]> {
        requireHub(scope);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new ScopedLoadError('Not a date.', 'BAD-DATE', true);
        let d: unknown;
        try {
          d = await rpc('field_session_roster', { p_session_date: sessionDate }, 'load');
        } catch (e) {
          const ce = toCommandError(e, 'load');
          if (ce.reference === 'PT403') throw new ScopedLoadError('The session roster is switched off.', FEATURE_OFF_REFERENCE, true);
          throw loadError(ce);
        }
        const rows = Array.isArray(d) ? (d as Row[]) : [];
        return rows.map((r) => ({
          cadetId: s(r.cadet_id),
          name: fullName(r),
          rank: rank(r.current_rank),
          horseName: s(r.horse_name) || null,
          checkInId: s(r.check_in_id) || null,
          checkedInAt: s(r.checked_in_at) ? hubTime(s(r.checked_in_at)) : null,
          sessionId: s(r.session_id) || null,
          published: r.published === true,
          sessionVideoAllowed: r.session_video_allowed === true,
        }));
      },
    },

    commands: () => commands,
  };
}
