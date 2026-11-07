/**
 * @jest-environment node
 *
 * The 19 original live-replica probes (MOBILE_APP_PLANNING/evidence/2026-11-04-live-replica-probes, 15 GAP on the live
 * schema) re-run as HTTP calls against the staging stack: real GoTrue tokens, real PostgREST under RLS, real Storage.
 * Each probe asserts the permission matrix (07), i.e. the FIXED behaviour. Run: npm run test:staging
 */
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { appClient, clipUri, createAccount, seedWorld, signIn, sql, type Account, type World } from './stack';

jest.setTimeout(60_000);

let w: World;
let stranger: Account;
let instructorA2: Account;
let sessionByA2 = '';
let consentRow = '';
let skill = '';

/** Denied = an error, or a write that touched no rows. */
async function denied(p: PromiseLike<{ error: unknown; data?: unknown; count?: number | null }>): Promise<boolean> {
  const r = await p;
  if (r.error) return true;
  return Array.isArray(r.data) ? r.data.length === 0 : r.data == null;
}

beforeAll(async () => {
  w = await seedWorld();
  // A self-registered stranger (public sign-up through real GoTrue, tries to pick a staff role).
  const email = `stranger-${w.run}@example.test`;
  const password = `Stg-${randomUUID()}`;
  const { data, error } = await appClient().auth.signUp({ email, password, options: { data: { full_name: 'Stranger', role: 'INSTRUCTOR' } } });
  if (error || !data.user) throw new Error(`sign-up: ${error?.message}`);
  stranger = { id: data.user.id, email, password };
  instructorA2 = await createAccount(`instructor-a2-${w.run}@example.test`, 'Instructor A2 (synthetic)', 'INSTRUCTOR', w.hubA);
  sql(`update public.equine_fleet set stall_cctv_rtsp_url = 'rtsp://cam-user:cam-pass@10.0.0.5/stall1' where id = '${w.horseA}'`);
  sql(`insert into public.equine_fleet (hub_id, name, microchip_iso_id, stall_cctv_rtsp_url) values ('${w.hubB}', 'Chetak (synthetic)', 'STG-${w.run}-B', 'rtsp://cam-user:cam-pass@10.0.0.9/stall7')`);
  sql(`insert into public.achievements (cadet_id, hub_id, achievement_type, title) values ('${w.cadetB}', '${w.hubB}', 'RANK', 'Synthetic: Meera earned Cadet Rider')`);
  sessionByA2 = sql(`insert into public.training_sessions (cadet_id, instructor_id, riding_score, ground_score, stable_score) values ('${w.cadetA}', '${instructorA2.id}', 6, 6, 6) returning id`);
  consentRow = sql(`insert into public.consent_records (parent_id, cadet_id, consent_type, consent_text_version) values ('${w.guardianA.id}', '${w.cadetA}', 'training_media', 'v1') returning id`);
  skill = w.skills[0]!;
});

const as = (a: Account): Promise<SupabaseClient> => signIn(a);

describe('19 original probes, over HTTP on staging (each asserts the fixed behaviour)', () => {
  test('S7a a signed-in stranger cannot read stall camera links', async () => {
    const r = await (await as(stranger)).from('equine_fleet').select('stall_cctv_rtsp_url');
    expect(r.error !== null || (r.data ?? []).every((x) => x.stall_cctv_rtsp_url == null)).toBe(true);
  });
  test('S7b a signed-in stranger cannot read hub revenue shares', async () => {
    const r = await (await as(stranger)).from('school_hubs').select('revenue_share_percentage');
    expect(r.error !== null || (r.data ?? []).every((x) => x.revenue_share_percentage == null)).toBe(true);
  });
  test('S7c a signed-in stranger cannot read other children’s achievements', async () => {
    const r = await (await as(stranger)).from('achievements').select('id');
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
  });
  test('S3 anonymous cannot read stall camera links', async () => {
    const r = await appClient().from('equine_fleet').select('stall_cctv_rtsp_url');
    expect(r.error !== null || (r.data ?? []).every((x) => x.stall_cctv_rtsp_url == null)).toBe(true);
  });
  test('W1 a hub-A instructor cannot record a session for a hub-B cadet', async () => {
    const c = await as(w.instructorA);
    expect(await denied(c.from('training_sessions').insert({ cadet_id: w.cadetB, instructor_id: w.instructorA.id, riding_score: 7 }).select('id'))).toBe(true);
    expect(await denied(c.rpc('field_record_check_in', { p_passport_code: w.passportB, p_observed_at: new Date().toISOString(), p_operation_id: randomUUID() }))).toBe(true);
  });
  test('W2 the seal (brass_stamp_verified) cannot be set by a client', async () => {
    const c = await as(w.instructorA);
    expect(await denied(c.from('training_sessions').update({ brass_stamp_verified: true }).eq('id', sessionByA2).select('id'))).toBe(true);
    expect(sql(`select coalesce(brass_stamp_verified::text, 'null') from public.training_sessions where id = '${sessionByA2}'`)).not.toBe('true');
  });
  test('W3 a hub-A instructor cannot promote a hub-B cadet in rank_history', async () => {
    const c = await as(w.instructorA);
    expect(await denied(c.from('rank_history').insert({ cadet_id: w.cadetB, from_rank: 'CADET_SQUIRE', to_rank: 'CADET_KNIGHT', promoted_by: w.instructorA.id }).select('id'))).toBe(true);
  });
  test('W4 rank_history and cadets.current_rank agree after a promotion (current_rank is authoritative; history follows)', async () => {
    sql(`update public.cadets set current_rank = 'CADET_RIDER' where id = '${w.cadetB}'`);
    expect(sql(`select to_rank from public.rank_history where cadet_id = '${w.cadetB}' order by promoted_at desc limit 1`)).toBe('CADET_RIDER');
  });
  test('W5 a hub-A groom cannot log care for a hub-B horse (or self-verify)', async () => {
    const c = await as(w.groomA);
    const horseB = sql(`select id from public.equine_fleet where hub_id = '${w.hubB}' limit 1`);
    expect(await denied(c.from('groom_daily_logs').insert({ hub_id: w.hubB, groom_id: w.groomA.id, horse_id: horseB, log_type: 'MORNING_FEED', proof_photo_s3_url: 'x', latitude: 0, longitude: 0, ai_verified: true, scheduled_time: new Date().toISOString() }).select('id'))).toBe(true);
  });
  test('W6 a parent account cannot punch in as staff', async () => {
    const c = await as(w.guardianA);
    expect(await denied(c.from('staff_attendance').insert({ user_id: w.guardianA.id, hub_id: w.hubA, punch_in_latitude: 0, punch_in_longitude: 0 }).select('id'))).toBe(true);
    expect(await denied(c.rpc('field_punch_in', { p_latitude: 16.5, p_longitude: 80.6, p_accuracy_m: 10, p_observed_at: new Date().toISOString(), p_operation_id: randomUUID() }))).toBe(true);
  });
  test('W7 a guardian cannot delete consent history', async () => {
    const c = await as(w.guardianA);
    await c.from('consent_records').delete().eq('id', consentRow);
    expect(sql(`select count(*) from public.consent_records where id = '${consentRow}'`)).toBe('1');
  });
  test('W8 an instructor sees the hub cadet’s earlier sessions by another instructor (grading history)', async () => {
    const r = await (await as(w.instructorA)).from('training_sessions').select('id').eq('id', sessionByA2);
    expect(r.data?.map((x) => x.id)).toEqual([sessionByA2]);
  });
  test('W9 a correction path exists for an instructor’s own session (and not for someone else’s)', async () => {
    const other = await (await as(w.instructorA)).rpc('field_correct_session', { p_session_id: sessionByA2, p_expected_version: 1, p_riding_score: 9, p_ground_score: 9, p_stable_score: 9, p_notes: null, p_reason: 'Synthetic probe W9 (not mine)', p_operation_id: randomUUID() });
    expect(other.error?.code).toBe('42501');
    const r = await (await as(instructorA2)).rpc('field_correct_session', { p_session_id: sessionByA2, p_expected_version: 1, p_riding_score: 7, p_ground_score: 6, p_stable_score: 6, p_notes: null, p_reason: 'Synthetic probe W9', p_operation_id: randomUUID() });
    expect(r.error).toBeNull();
    expect(sql(`select version from public.training_sessions where id = '${sessionByA2}'`)).toBe('2');
  });
  test('W10 an instructor cannot attach skills directly to a session', async () => {
    const c = await as(w.instructorA);
    expect(await denied(c.from('session_skills').insert({ session_id: sessionByA2, skill_id: skill }).select('session_id'))).toBe(true);
  });
  test('W11 an instructor CAN upload a session video for a consented hub cadet (and nowhere else)', async () => {
    const g = await as(w.guardianA);
    await g.rpc('app_set_media_consent', { p_cadet_id: w.cadetA, p_purpose: 'session_video', p_granted: true, p_policy_version: 'draft-1', p_operation_id: randomUUID() });
    const c = await as(w.instructorA);
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    expect((await c.storage.from('session-videos').upload(`${w.hubA}/${w.cadetA}/${randomUUID()}.mp4`, bytes, { contentType: 'video/mp4' })).error).toBeNull();
    expect((await c.storage.from('session-videos').upload(`${w.hubB}/${w.cadetB}/${randomUUID()}.mp4`, bytes, { contentType: 'video/mp4' })).error).not.toBeNull();
    expect((await c.storage.from('session-videos').upload(`${w.hubA}/../${randomUUID()}.mp4`, bytes, { contentType: 'video/mp4' })).error).not.toBeNull();
  });
  test('OK1 a guardian reads own child’s sessions', async () => {
    const r = await (await as(w.guardianA)).from('training_sessions').select('id').eq('cadet_id', w.cadetA);
    expect((r.data ?? []).length).toBeGreaterThanOrEqual(1);
  });
  test('OK2 a guardian cannot read another family’s child', async () => {
    const r = await (await as(w.guardianA)).from('cadets').select('id').eq('id', w.cadetB);
    expect(r.data).toEqual([]);
  });
  test('OK3 a staff member who is also a parent sees own child', async () => {
    const own = sql(`insert into public.cadets (parent_id, hub_id, first_name, last_name, passport_code) values ('${instructorA2.id}', '${w.hubB}', 'Ravi', 'Synthetic', 'BSAH-26-S${w.run.slice(0, 6).toUpperCase()}D') returning id`);
    const r = await (await as(instructorA2)).from('cadets').select('id').eq('id', own);
    expect(r.data?.map((x) => x.id)).toEqual([own]);
  });
  test('OK4 a user cannot self-promote their role (stranger stays PARENT, no field access)', async () => {
    const c = await as(stranger);
    await c.from('users').update({ role: 'SUPER_ADMIN' }).eq('id', stranger.id);
    expect(sql(`select role from public.users where id = '${stranger.id}'`)).toBe('PARENT');
    const snap = await c.rpc('app_access_snapshot');
    expect(JSON.stringify(snap.data ?? {})).not.toContain('"field"');
  });
});
