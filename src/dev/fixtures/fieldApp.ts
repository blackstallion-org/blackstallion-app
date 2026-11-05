/**
 * DEVELOPMENT-ONLY synthetic Field data (FO-02..FO-07), clearly labelled "(sample)". Two parts:
 *
 * 1. `createFieldReferenceModel()` — an in-memory model of the server rules this workstream depends on, written from
 *    the SQL (foundations/live-delta MIG field_record_check_in / field_publish_session / field_correct_session and
 *    MIG9 field_cadet_media_consent / field_session_roster / app_policy_flags) and the read policies (SLICE_CONTRACT
 *    §B). Same error codes and messages, same replay rules (operation id + payload hash), same hub checks. It is a
 *    JavaScript mirror for previews and tests, NOT evidence about the real database.
 * 2. `createFieldAppFixtures()` — the dev repositories: the real server mapping code (`createFieldAppServer`) running
 *    against the model through a supabase-shaped test client bound to the signed-in persona.
 */
import { ScopedLoadError } from '@/core/data/useScopedResource';
import { hubDate } from '@/core/format/hubTime';
import { createFieldAppServer } from '@/features/field/data/server';
import type { FieldAppRepositories, PreviewFieldAccess } from '@/features/field/data/repositories';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { createFakeSupabase, ok, pgError, type FakeResult } from '@/testing/fakeSupabase';

type Row = Record<string, unknown>;
type Role = 'INSTRUCTOR' | 'GROOM' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN' | 'PARENT';
type User = { id: string; role: Role; hub_id: string | null; display: string };
type Consent = { session_video: boolean; care_photo: boolean; posture_analysis: boolean };

export class ModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string, status?: number): never => {
  throw new ModelError(code, message, status);
};

/** Same synthetic hub ids as the preview personas' scopes (src/dev/personas.ts). */
export const SYN_HUB_1 = 'syn-hub-1';
export const SYN_HUB_2 = 'syn-hub-2';
const uid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const synCadetId = (n: number) => uid('c0000000', n);
const HORSE = (n: number) => uid('e0000000', n);
const SKILL = (n: number) => uid('5c000000', n);

const USERS: User[] = [
  { id: 'syn-instructor', role: 'INSTRUCTOR', hub_id: SYN_HUB_1, display: 'Ravi (sample)' },
  { id: 'syn-instructor-b', role: 'INSTRUCTOR', hub_id: SYN_HUB_1, display: 'Kavya (sample)' },
  { id: 'syn-groom', role: 'GROOM', hub_id: SYN_HUB_1, display: 'Suresh (sample)' },
  { id: 'syn-hub-admin', role: 'SCHOOL_ADMIN', hub_id: SYN_HUB_1, display: 'Meena (sample)' },
  { id: 'syn-dual', role: 'INSTRUCTOR', hub_id: SYN_HUB_2, display: 'Anil (sample)' },
  { id: 'syn-guardian-a', role: 'PARENT', hub_id: null, display: 'Priya (sample)' },
];

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const nowIso = (t: number) => new Date(t).toISOString();
const codePoints = (x: string) => Array.from(x).length;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export type FieldReferenceModel = ReturnType<typeof createFieldReferenceModel>;

export function createFieldReferenceModel(opts: { now?: () => number; sessionRoster?: boolean } = {}) {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const today = hubDate(new Date(t0));
  const dayAgo = (d: number) => hubDate(new Date(t0 - d * DAY));
  /** ISO time at hub-local HH:MM on the hub-local date `date`. */
  const at = (date: string, hh: number, mm: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm - 330) * MIN).toISOString();

  let seq = 1000;
  const nextId = (prefix: string) => uid(prefix, ++seq);

  const db = {
    school_hubs: [
      { id: SYN_HUB_1, school_name: 'Demo Hub One' },
      { id: SYN_HUB_2, school_name: 'Demo Hub Two' },
    ] as Row[],
    equine_fleet: [
      { id: HORSE(1), hub_id: SYN_HUB_1, name: 'Badal (sample)' },
      { id: HORSE(2), hub_id: SYN_HUB_1, name: 'Chetak (sample)' },
      { id: HORSE(3), hub_id: SYN_HUB_2, name: 'Toofan (sample)' },
    ] as Row[],
    cadets: [
      [1, SYN_HUB_1, 'Kabir', 'Mehta', 'CADET_RIDER', HORSE(1)],
      [2, SYN_HUB_1, 'Diya', 'Nair', 'CADET_SQUIRE', HORSE(2)],
      [3, SYN_HUB_1, 'Rohan', 'Das', 'CADET_SQUIRE', HORSE(1)],
      [4, SYN_HUB_1, 'Aditi', 'Rao', 'CADET_KNIGHT', HORSE(2)],
      [5, SYN_HUB_1, 'Vihaan', 'Iyer', 'CADET_RIDER', null],
      [6, SYN_HUB_1, 'Sana', 'Kapoor', 'CADET_SQUIRE', null],
      [101, SYN_HUB_2, 'Tara', 'Singh', 'CADET_RIDER', HORSE(3)],
      [102, SYN_HUB_2, 'Arjun', 'Bose', 'CADET_SQUIRE', null],
    ].map(([n, hub, first, last, rank, horse]) => ({
      id: synCadetId(n as number),
      hub_id: hub,
      parent_id: null,
      first_name: `${first as string}`,
      last_name: `${last as string} (sample)`,
      passport_code: `BSAH-26-SYN${String(n).padStart(5, '0')}`,
      current_rank: rank,
      assigned_horse_id: horse,
    })) as Row[],
    cadet_check_ins: [] as Row[],
    training_sessions: [] as Row[],
    session_skills: [] as Row[],
    skills: [
      [1, 'Rising trot (sample)', 'RIDING'],
      [2, 'Halt and stand (sample)', 'RIDING'],
      [3, 'Two-point position (sample)', 'RIDING'],
      [4, 'Leading in hand (sample)', 'GROUND'],
      [5, 'Picking up feet (sample)', 'GROUND'],
      [6, 'Tacking up (sample)', 'STABLE'],
      [7, 'Grooming routine (sample)', 'STABLE'],
      [8, 'Retired skill (sample)', 'RIDING', false],
    ].map(([n, name, category, active]) => ({ id: SKILL(n as number), name, category, is_active: active !== false })) as Row[],
    training_session_corrections: [] as Row[],
    /** G9 SD-05 draft: void rows (the check-in itself is kept). */
    cadet_check_in_voids: [] as Row[],
  };
  const consents = new Map<string, Consent>([
    [synCadetId(1), { session_video: true, care_photo: true, posture_analysis: false }],
    [synCadetId(3), { session_video: true, care_photo: false, posture_analysis: false }],
    [synCadetId(5), { session_video: true, care_photo: true, posture_analysis: true }],
    [synCadetId(101), { session_video: true, care_photo: false, posture_analysis: false }],
  ]);
  const flags = { session_roster: opts.sessionRoster ?? false };
  const objects = new Set<string>();

  const user = (id: string) => USERS.find((u) => u.id === id) ?? null;
  const cadet = (id: unknown) => db.cadets.find((c) => c.id === id) ?? null;
  const cadetName = (c: Row) => `${String(c.first_name)} ${String(c.last_name)}`.trim();

  // ---- seed: today and some history (hub one), one check-in at hub two
  const seedCheckIn = (cadetN: number, date: string, hh: number, mm: number, by = 'syn-instructor') => {
    const c = cadet(synCadetId(cadetN))!;
    const row = {
      id: nextId('c1000000'),
      cadet_id: c.id,
      hub_id: c.hub_id,
      session_date: date,
      scanned_by: by,
      observed_at: at(date, hh, mm),
      received_at: at(date, hh, mm),
      client_operation_id: nextId('0e000000'),
      operation_hash: 'seed',
    };
    db.cadet_check_ins.push(row);
    return row;
  };
  const seedSession = (ci: Row | null, cadetN: number, date: string, scores: [number, number, number], notes: string | null, by: string, skills: number[] = []) => {
    const row = {
      id: nextId('5e000000'),
      cadet_id: synCadetId(cadetN),
      instructor_id: by,
      horse_id: cadet(synCadetId(cadetN))!.assigned_horse_id,
      session_date: date,
      riding_score: scores[0],
      ground_score: scores[1],
      stable_score: scores[2],
      instructor_notes: notes,
      video_log_s3_url: null,
      brass_stamp_verified: true,
      check_in_id: ci?.id ?? null,
      client_operation_id: ci ? nextId('0e000000') : null,
      operation_hash: ci ? 'seed' : null,
      version: 1,
    };
    db.training_sessions.push(row);
    for (const k of skills) db.session_skills.push({ session_id: row.id, skill_id: SKILL(k) });
    return row;
  };
  const kabirToday = seedCheckIn(1, today, 9, 32);
  seedSession(kabirToday, 1, today, [8, 7, 8], 'Steady rising trot on both reins.', 'syn-instructor', [1, 6]);
  seedCheckIn(2, today, 9, 35);
  seedCheckIn(3, today, 9, 41);
  seedCheckIn(101, today, 7, 5, 'syn-dual');
  const k3 = seedSession(seedCheckIn(1, dayAgo(3), 9, 30), 1, dayAgo(3), [7, 7, 8], 'Good seat; work on halts.', 'syn-instructor', [2]);
  // A correction made earlier (version 2), with the original values kept in the history.
  db.training_session_corrections.push({
    id: nextId('c0aa0000'),
    session_id: k3.id,
    version_before: 1,
    previous: { riding: 7, ground: 5, stable: 8, notes: 'Good seat; work on halts.' },
    next: { riding: 7, ground: 7, stable: 8, notes: 'Good seat; work on halts.' },
    reason: 'Ground score entered in the wrong row (sample).',
    corrected_by: 'syn-instructor',
    corrected_at: at(dayAgo(3), 17, 10),
    client_operation_id: nextId('0e000000'),
    operation_hash: 'seed',
  });
  k3.version = 2;
  seedSession(seedCheckIn(1, dayAgo(7), 16, 5, 'syn-instructor-b'), 1, dayAgo(7), [6, 7, 7], null, 'syn-instructor-b');
  const diyaPast = seedSession(seedCheckIn(2, dayAgo(3), 9, 34), 2, dayAgo(3), [5, 6, 7], 'First canter on the lunge.', 'syn-instructor');
  // Synthetic scenario for previews: the first correction sent for this record finds that it was corrected elsewhere
  // a moment earlier (another device), so the app's conflict path can be seen without a second phone.
  const editedElsewhere = new Set<unknown>([diyaPast.id]);
  seedSession(null, 4, dayAgo(10), [9, 8, 9], null, 'syn-instructor-b'); // legacy row without a check-in

  // ---- read policies (SLICE_CONTRACT §B; mobile_can_read_cadet / mobile_can_read_session)
  const canReadCadet = (u: User | null, cadetId: unknown) => {
    const c = cadet(cadetId);
    if (!u || !c) return false;
    return u.role === 'SUPER_ADMIN' || c.parent_id === u.id || ((u.role === 'INSTRUCTOR' || u.role === 'SCHOOL_ADMIN') && !!u.hub_id && c.hub_id === u.hub_id);
  };
  const sessionById = (id: unknown) => db.training_sessions.find((s) => s.id === id) ?? null;
  const canReadSession = (u: User | null, sessionId: unknown) => {
    const s = sessionById(sessionId);
    return !!s && canReadCadet(u, s.cadet_id);
  };

  function visibleRows(callerId: string, table: string): Row[] {
    const u = user(callerId);
    if (!u) return [];
    switch (table) {
      case 'school_hubs':
      case 'skills':
        return db[table];
      case 'equine_fleet':
        return db.equine_fleet;
      case 'cadets':
        // Grooms read no cadet records (13 W01); hub staff read their hub; guardians their own children.
        return db.cadets.filter((c) => canReadCadet(u, c.id));
      case 'cadet_check_ins':
        return db.cadet_check_ins.filter((r) => canReadCadet(u, r.cadet_id));
      case 'cadet_check_in_voids':
        // column grant: no reason or voiding staff member through table reads (G9)
        return db.cadet_check_in_voids.filter((r) => canReadCadet(u, r.cadet_id)).map(({ check_in_id, cadet_id, hub_id, voided_at }) => ({ check_in_id, cadet_id, hub_id, voided_at }));
      case 'training_sessions':
        // mobile_instructor_hub_sessions: INSTRUCTOR reads every session of own-hub cadets; guardians their children.
        return db.training_sessions.filter((s) => {
          const c = cadet(s.cadet_id);
          return !!c && (u.role === 'SUPER_ADMIN' || c.parent_id === u.id || (u.role === 'INSTRUCTOR' && c.hub_id === u.hub_id));
        });
      case 'session_skills':
        return db.session_skills.filter((r) => canReadSession(u, r.session_id));
      case 'training_session_corrections':
        return db.training_session_corrections.filter((r) => canReadSession(u, r.session_id));
      default:
        return [];
    }
  }

  // ---- commands (MIG:335-504) and G9 functions
  const instructorHub = (callerId: string): { u: User; hub: string } => {
    const u = user(callerId);
    if (!u || u.role !== 'INSTRUCTOR' || !u.hub_id) fail('42501', 'not allowed for this account', 403);
    return { u: u!, hub: u!.hub_id! };
  };

  function recordCheckIn(callerId: string, a: Row) {
    const { hub } = instructorHub(callerId);
    const op = a.p_operation_id;
    if (typeof op !== 'string' || !op) fail('PT422', 'operation id is required', 422);
    const observed = typeof a.p_observed_at === 'string' ? Date.parse(a.p_observed_at) : Number.NaN;
    if (Number.isNaN(observed) || observed > now() + 5 * MIN || observed < now() - 7 * DAY) {
      fail('PT422', 'observed time must be within the last 7 days and not in the future', 422);
    }
    const code = String(a.p_passport_code ?? '').trim();
    const hash = JSON.stringify({ code, observed: Math.floor(observed / 1000) });
    const json = (r: Row, duplicate: boolean) => ({
      check_in_id: r.id,
      cadet_id: r.cadet_id,
      cadet_name: cadetName(cadet(r.cadet_id)!),
      session_date: r.session_date,
      received_at: r.received_at,
      duplicate,
    });
    const replay = db.cadet_check_ins.find((r) => r.client_operation_id === op);
    if (replay) {
      if (replay.scanned_by !== callerId || replay.operation_hash !== hash) fail('PT409', 'operation id already used for a different request', 409);
      return json(replay, true);
    }
    const c = db.cadets.find((x) => x.passport_code === code && x.hub_id === hub);
    if (!c) return fail('PT404', 'no cadet with this passport code at your hub', 404);
    const date = hubDate(new Date(observed));
    const same = db.cadet_check_ins.find((r) => r.cadet_id === c.id && r.session_date === date);
    if (same) return json(same, true);
    const row = { id: nextId('c1000000'), cadet_id: c.id, hub_id: hub, session_date: date, scanned_by: callerId, observed_at: nowIso(observed), received_at: nowIso(now()), client_operation_id: op, operation_hash: hash };
    db.cadet_check_ins.push(row);
    return json(row, false);
  }

  const validScores = (a: Row) =>
    [a.p_riding_score, a.p_ground_score, a.p_stable_score].every((v) => isInt(v) && v >= 1 && v <= 10) ||
    fail('PT422', 'riding, ground and stable scores must be whole numbers from 1 to 10', 422);

  function publishSession(callerId: string, a: Row) {
    const { hub } = instructorHub(callerId);
    if (!a.p_operation_id || !a.p_check_in_operation_id) fail('PT422', 'operation ids are required', 422);
    validScores(a);
    const notes = typeof a.p_notes === 'string' ? a.p_notes : null;
    if (notes !== null && codePoints(notes) > 2000) fail('PT422', 'notes are limited to 2000 characters', 422);
    const skills = Array.from(new Set(Array.isArray(a.p_skill_ids) ? (a.p_skill_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [])).sort();
    if (skills.length > 20) fail('PT422', 'at most 20 skills', 422);
    const ci = db.cadet_check_ins.find((r) => r.client_operation_id === a.p_check_in_operation_id && r.hub_id === hub);
    if (!ci) return fail('PT404', 'check-in not found at your hub', 404);
    const video = typeof a.p_video_object === 'string' ? a.p_video_object : null;
    const hash = JSON.stringify({ check_in: ci.id, r: a.p_riding_score, g: a.p_ground_score, s: a.p_stable_score, skills, notes: notes ?? '', video: video ?? '' });
    const replay = db.training_sessions.find((s) => s.client_operation_id === a.p_operation_id);
    if (replay) {
      if (replay.instructor_id !== callerId || replay.operation_hash !== hash) fail('PT409', 'operation id already used for a different request', 409);
      return { session_id: replay.id, version: replay.version, session_date: replay.session_date, duplicate: true };
    }
    if (db.training_sessions.some((s) => s.check_in_id === ci.id)) fail('PT409', 'this check-in already has a published session', 409);
    if (isVoided(ci.id)) fail('PT409', 'this check-in was voided', 409);
    const c = cadet(ci.cadet_id)!;
    if (c.hub_id !== hub) fail('PT409', 'the cadet is no longer at your hub', 409);
    if (skills.some((id) => !db.skills.some((k) => k.id === id && k.is_active === true))) fail('PT422', 'unknown or retired skill', 422);
    if (video && (!video.startsWith(`${hub}/${String(c.id)}/`) || video.includes('..') || !objects.has(video))) {
      fail('PT422', 'the video must be uploaded for this cadet first', 422);
    }
    const trimmed = notes?.trim() ? notes.trim() : null;
    const row = {
      id: nextId('5e000000'),
      cadet_id: c.id,
      instructor_id: callerId,
      horse_id: c.assigned_horse_id,
      session_date: ci.session_date,
      riding_score: a.p_riding_score,
      ground_score: a.p_ground_score,
      stable_score: a.p_stable_score,
      instructor_notes: trimmed,
      video_log_s3_url: video,
      brass_stamp_verified: true,
      check_in_id: ci.id,
      client_operation_id: a.p_operation_id,
      operation_hash: hash,
      version: 1,
    };
    db.training_sessions.push(row);
    for (const k of skills) db.session_skills.push({ session_id: row.id, skill_id: k });
    return { session_id: row.id, version: 1, session_date: row.session_date, duplicate: false };
  }

  function correctSession(callerId: string, a: Row) {
    const u = user(callerId);
    if (!u || (u.role !== 'INSTRUCTOR' && u.role !== 'SUPER_ADMIN')) fail('42501', 'not allowed for this account', 403);
    if (!a.p_operation_id || !a.p_session_id || a.p_expected_version === null || a.p_expected_version === undefined) {
      fail('PT422', 'session, expected version and operation id are required', 422);
    }
    validScores(a);
    const rawNotes = typeof a.p_notes === 'string' ? a.p_notes : null;
    if (rawNotes !== null && codePoints(rawNotes) > 2000) fail('PT422', 'notes are limited to 2000 characters', 422);
    const reason = typeof a.p_reason === 'string' ? a.p_reason.trim() : '';
    if (codePoints(reason) < 3 || codePoints(reason) > 500) fail('PT422', 'a reason of 3 to 500 characters is required', 422);
    const notes = rawNotes?.trim() ? rawNotes.trim() : null;
    const hash = JSON.stringify({ s: a.p_session_id, e: a.p_expected_version, r: a.p_riding_score, g: a.p_ground_score, st: a.p_stable_score, notes: notes ?? '', reason });
    const s = sessionById(a.p_session_id);
    if (!s) return fail('PT404', 'session not found', 404);
    const replay = db.training_session_corrections.find((c) => c.client_operation_id === a.p_operation_id);
    if (replay) {
      if (replay.corrected_by !== callerId || replay.operation_hash !== hash) fail('PT409', 'operation id already used for a different request', 409);
      return { session_id: replay.session_id, version: (replay.version_before as number) + 1, correction_id: replay.id, duplicate: true };
    }
    if (u!.role === 'INSTRUCTOR' && (s.instructor_id !== callerId || cadet(s.cadet_id)?.hub_id !== u!.hub_id)) {
      fail('42501', "only the instructor who recorded the session, at the cadet's hub, or a super admin may correct it", 403);
    }
    if (editedElsewhere.delete(s.id)) {
      db.training_session_corrections.push({
        id: nextId('c0aa0000'),
        session_id: s.id,
        version_before: s.version,
        previous: { riding: s.riding_score, ground: s.ground_score, stable: s.stable_score, notes: s.instructor_notes },
        next: { riding: s.riding_score, ground: 7, stable: s.stable_score, notes: s.instructor_notes },
        reason: 'Corrected on another device (sample scenario).',
        corrected_by: 'syn-instructor',
        corrected_at: nowIso(now() - MIN),
        client_operation_id: nextId('0e000000'),
        operation_hash: 'seed',
      });
      Object.assign(s, { ground_score: 7, version: (s.version as number) + 1 });
    }
    if (s.version !== a.p_expected_version) fail('PT409', `the session changed since it was loaded (version ${String(s.version)})`, 409);
    if (s.riding_score === a.p_riding_score && s.ground_score === a.p_ground_score && s.stable_score === a.p_stable_score && (s.instructor_notes ?? null) === notes) {
      fail('PT422', 'nothing to correct', 422);
    }
    const c = {
      id: nextId('c0aa0000'),
      session_id: s.id,
      version_before: s.version,
      previous: { riding: s.riding_score, ground: s.ground_score, stable: s.stable_score, notes: s.instructor_notes },
      next: { riding: a.p_riding_score, ground: a.p_ground_score, stable: a.p_stable_score, notes },
      reason,
      corrected_by: callerId,
      corrected_at: nowIso(now()),
      client_operation_id: a.p_operation_id,
      operation_hash: hash,
    };
    db.training_session_corrections.push(c);
    Object.assign(s, { riding_score: a.p_riding_score, ground_score: a.p_ground_score, stable_score: a.p_stable_score, instructor_notes: notes, version: (s.version as number) + 1 });
    return { session_id: s.id, version: s.version, correction_id: c.id, duplicate: false };
  }

  function mediaConsent(callerId: string, a: Row) {
    const u = user(callerId);
    if (!u || (u.role !== 'SUPER_ADMIN' && ((u.role !== 'INSTRUCTOR' && u.role !== 'SCHOOL_ADMIN') || !u.hub_id))) fail('42501', 'not allowed for this account', 403);
    const c = db.cadets.find((x) => x.id === a.p_cadet_id && (u!.role === 'SUPER_ADMIN' || x.hub_id === u!.hub_id));
    if (!c) return fail('PT404', 'cadet not found at your hub', 404);
    const k = consents.get(String(c.id)) ?? { session_video: false, care_photo: false, posture_analysis: false };
    return { cadet_id: c.id, consents: { ...k } };
  }

  const isVoided = (checkInId: unknown) => db.cadet_check_in_voids.some((v) => v.check_in_id === checkInId);
  const voidReceipts = new Map<string, { by: string; hash: string; result: Row }>();

  /** G9 field_void_check_in (SD-05 draft): today's check-in at the caller's hub, not published, with a reason. */
  function voidCheckIn(callerId: string, a: Row) {
    const u = user(callerId);
    if (!u || (u.role !== 'INSTRUCTOR' && u.role !== 'SCHOOL_ADMIN' && u.role !== 'SUPER_ADMIN')) return fail('42501', 'not allowed for this account', 403);
    const reason = typeof a.p_reason === 'string' ? a.p_reason.trim() : '';
    if (codePoints(reason) < 3 || codePoints(reason) > 500) fail('PT422', 'a reason of 3 to 500 characters is required', 422);
    if (!a.p_check_in_id) fail('PT422', 'check-in is required', 422);
    const op = a.p_operation_id;
    if (typeof op !== 'string' || !op) return fail('PT422', 'operation id is required', 422);
    const hash = JSON.stringify({ check_in: a.p_check_in_id, reason });
    const prev = voidReceipts.get(op);
    if (prev) {
      if (prev.by !== callerId || prev.hash !== hash) fail('PT409', 'operation id already used for a different request', 409);
      return { ...prev.result, duplicate: true };
    }
    const ci = db.cadet_check_ins.find((r) => r.id === a.p_check_in_id);
    if (!ci || (u.role !== 'SUPER_ADMIN' && ci.hub_id !== u.hub_id)) return fail('PT404', 'check-in not found at your hub', 404);
    if (ci.session_date !== hubDate(new Date(now()))) fail('PT422', "only today's check-ins can be voided here", 422);
    if (isVoided(ci.id)) fail('PT409', 'this check-in is already voided', 409);
    if (db.training_sessions.some((s) => s.check_in_id === ci.id)) fail('PT409', 'an assessment is published for this check-in; make a correction instead', 409);
    const voidedAt = nowIso(now());
    db.cadet_check_in_voids.push({ check_in_id: ci.id, cadet_id: ci.cadet_id, hub_id: ci.hub_id, voided_by: callerId, reason, voided_at: voidedAt });
    const result = { check_in_id: ci.id, cadet_id: ci.cadet_id, voided_at: voidedAt };
    voidReceipts.set(op, { by: callerId, hash, result });
    return { ...result, duplicate: false };
  }

  function sessionRoster(callerId: string, a: Row) {
    const u = user(callerId);
    if (!u || (u.role !== 'INSTRUCTOR' && u.role !== 'SCHOOL_ADMIN') || !u.hub_id) fail('42501', 'not allowed for this account', 403);
    if (!flags.session_roster) fail('PT403', 'feature session_roster is switched off by policy', 403);
    if (!a.p_session_date) fail('PT422', 'date is required', 422);
    return db.cadets
      .filter((c) => c.hub_id === u!.hub_id)
      .sort((x, y) => `${String(x.first_name)} ${String(x.last_name)}`.localeCompare(`${String(y.first_name)} ${String(y.last_name)}`))
      .map((c) => {
        const ci = db.cadet_check_ins.find((r) => r.cadet_id === c.id && r.session_date === a.p_session_date && !isVoided(r.id));
        const ts = ci ? db.training_sessions.find((s) => s.check_in_id === ci.id) : undefined;
        return {
          cadet_id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          current_rank: c.current_rank,
          horse_id: c.assigned_horse_id,
          horse_name: db.equine_fleet.find((h) => h.id === c.assigned_horse_id)?.name ?? null,
          check_in_id: ci?.id ?? null,
          checked_in_at: ci?.received_at ?? null,
          session_id: ts?.id ?? null,
          published: ts?.brass_stamp_verified === true,
          session_video_allowed: consents.get(String(c.id))?.session_video === true,
        };
      });
  }

  const RPC: Record<string, (callerId: string, a: Row) => unknown> = {
    app_access_snapshot: () => ({ issuedAt: nowIso(now()) }),
    app_policy_flags: () => ({
      session_roster: { enabled: flags.session_roster, value: null, decision_ref: 'Q7, D31' },
      rank_proposals: { enabled: false, value: { proposer_roles: ['INSTRUCTOR'], approver_role: 'SUPER_ADMIN' }, decision_ref: 'D15, Q8' },
    }),
    field_record_check_in: recordCheckIn,
    field_publish_session: publishSession,
    field_correct_session: correctSession,
    field_cadet_media_consent: mediaConsent,
    field_session_roster: sessionRoster,
    field_void_check_in: voidCheckIn,
  };

  return {
    now,
    today,
    /** Turns the "edited elsewhere" preview scenario off (tests that need a plain model). */
    clearScenarios() {
      editedElsewhere.clear();
    },
    rpc(fn: string, callerId: string, args: Row | undefined): unknown {
      const h = RPC[fn];
      if (!h) fail('PGRST202', 'function not found', 404);
      if (!user(callerId)) fail('42501', 'not signed in', 401);
      return h!(callerId, args ?? {});
    },
    visibleRows,
    /** Storage insert policy for session-videos: INSTRUCTOR of the hub, path `<hub>/<hub cadet>/<file>` (MIG:69-94). */
    storeObject(callerId: string, path: string) {
      const { hub } = instructorHub(callerId);
      const [h, c] = path.split('/');
      if (h !== hub || cadet(c)?.hub_id !== hub || path.includes('..')) fail('42501', 'new row violates row-level security policy', 403);
      objects.add(path);
    },
    access(callerId: string): PreviewFieldAccess | null {
      const u = user(callerId);
      if (!u || !u.hub_id || (u.role !== 'INSTRUCTOR' && u.role !== 'GROOM' && u.role !== 'SCHOOL_ADMIN')) return null;
      return {
        role: u.role,
        hubId: u.hub_id,
        capabilities: { recordAssessment: u.role === 'INSTRUCTOR', uploadSessionVideo: u.role === 'INSTRUCTOR', viewHubCadets: u.role !== 'GROOM' },
      };
    },
    passportCodes(callerId: string) {
      const hub = user(callerId)?.hub_id;
      const mine = db.cadets.filter((c) => c.hub_id === hub).slice(0, 4);
      const other = db.cadets.find((c) => c.hub_id !== hub);
      return [
        ...mine.map((c) => ({ code: String(c.passport_code), label: String(c.first_name) + ' (sample)' })),
        ...(other ? [{ code: String(other.passport_code), label: 'Other hub (sample)' }] : []),
        { code: 'BSAH-26-SYN99999', label: 'Unknown code (sample)' },
      ];
    },
    setFlag(key: 'session_roster', enabled: boolean) {
      flags[key] = enabled;
    },
    setConsent(cadetId: string, value: Partial<Consent>) {
      consents.set(cadetId, { session_video: false, care_photo: false, posture_analysis: false, ...consents.get(cadetId), ...value });
    },
    /** Test helper: simulates another device changing a record (bumps the version). */
    bumpVersion(sessionId: string) {
      const s = sessionById(sessionId);
      if (s) s.version = (s.version as number) + 1;
    },
    tables: db,
  };
}

/** A supabase-shaped client for one caller over the model: rpc() runs the mirrored functions, from() reads under the mirrored RLS. */
export function createModelClient(model: FieldReferenceModel, callerId: string) {
  const tables = new Proxy({} as Record<string, Row[]>, { get: (_t, table) => (typeof table === 'string' ? model.visibleRows(callerId, table) : []) });
  const rpc = new Proxy({} as Record<string, (args: Record<string, unknown>) => FakeResult>, {
    get: (_t, fn) =>
      typeof fn === 'string'
        ? (args: Record<string, unknown>) => {
            try {
              return ok(model.rpc(fn, callerId, args));
            } catch (e) {
              if (e instanceof ModelError) return pgError(e.code, e.message, e.status);
              throw e;
            }
          }
        : undefined,
  });
  return createFakeSupabase({ tables, rpc });
}

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Development repositories. `EXPO_PUBLIC_DEV_FIELD_SESSION_ROSTER=1` turns the (default off) roster flag on for previews. */
export function createFieldAppFixtures(opts: { latencyMs?: number; model?: FieldReferenceModel } = {}): FieldAppRepositories {
  const latencyMs = opts.latencyMs ?? 300;
  const model = opts.model ?? createFieldReferenceModel({ sessionRoster: process.env.EXPO_PUBLIC_DEV_FIELD_SESSION_ROSTER === '1' });
  const servers = new Map<string, { client: DataClient; repos: FieldAppRepositories }>();
  const serverFor = (subjectId: string) => {
    let hit = servers.get(subjectId);
    if (!hit) {
      const client = createModelClient(model, subjectId).client;
      hit = { client, repos: createFieldAppServer(client, { localNow: model.now }) };
      servers.set(subjectId, hit);
    }
    return hit.repos;
  };
  const guard = async (scope: { experience: string }) => {
    await wait(latencyMs);
    if (scope.experience !== 'field') throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
  };
  const synthetic = <T extends { source: string }>(v: T): T => ({ ...v, source: 'synthetic-preview' });

  return {
    checkIns: { listToday: async (scope) => (await guard(scope), serverFor(scope.subjectId).checkIns.listToday(scope)) },
    cadets: {
      list: async (scope) => (await guard(scope), synthetic(await serverFor(scope.subjectId).cadets.list(scope))),
      profile: async (scope, id) => (await guard(scope), synthetic(await serverFor(scope.subjectId).cadets.profile(scope, id))),
    },
    sessions: {
      record: async (scope, id) => (await guard(scope), serverFor(scope.subjectId).sessions.record(scope, id)),
      skills: async (scope) => (await guard(scope), serverFor(scope.subjectId).sessions.skills(scope)),
    },
    consent: { forCadet: async (scope, id) => (await guard(scope), serverFor(scope.subjectId).consent.forCadet(scope, id)) },
    policy: { flags: async (scope) => (await guard(scope), serverFor(scope.subjectId).policy.flags(scope)) },
    roster: { forDate: async (scope, d) => (await guard(scope), serverFor(scope.subjectId).roster.forDate(scope, d)) },
    commands(scope) {
      const c = serverFor(scope.subjectId).commands(scope);
      const slow = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => (await wait(latencyMs), fn(...a));
      return {
        checkIn: slow(c.checkIn),
        publish: slow(c.publish),
        correct: slow(c.correct),
        ...(c.voidCheckIn ? { voidCheckIn: slow(c.voidCheckIn) } : {}),
        // No file is read or sent: the model records that the object exists so publish can reference it.
        uploadClip: slow(async (req) => {
          const objectPath = `${req.hubId}/${req.cadetId}/${req.clipId}.mp4`;
          model.storeObject(scope.subjectId, objectPath);
          return { objectPath };
        }),
      };
    },
    previewAccess: (subjectId) => model.access(subjectId),
    previewPassportCodes: (subjectId) => model.passportCodes(subjectId),
  };
}
