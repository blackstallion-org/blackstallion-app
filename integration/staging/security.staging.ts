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

/**
 * G15 hardening probes — DB-level and HTTP-level security checks beyond the original 19.
 * Each probe tests a control that SHOULD hold; a failure means a gap.
 */
describe('G15 hardening probes', () => {
  // ── RLS coverage ──────────────────────────────────────────────────

  test('G15-R1 every public-schema app table has RLS enabled', () => {
    const unprotected = sql(
      `select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations','spatial_ref_sys') and tablename not like 'pg_%' and tablename not like '_realtime%' and tablename not like 'supabase_%' and tablename not like 'mfa_%' and tablename not like 'refresh_tokens%' and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = pg_tables.tablename and c.relrowsecurity = true)`,
    );
    expect(unprotected).toBe('');
  });

  test('G15-R2 every field-schema table has RLS enabled', () => {
    const hasFieldSchema = sql(`select count(*) from pg_namespace where nspname = 'field'`);
    if (hasFieldSchema === '0') return; // no field schema — skip
    const unprotected = sql(
      `select tablename from pg_tables where schemaname = 'field' and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'field' and c.relname = pg_tables.tablename and c.relrowsecurity = true)`,
    );
    expect(unprotected).toBe('');
  });

  // ── SECURITY DEFINER without pinned search_path ───────────────────

  test('G15-D1 no SECURITY DEFINER function without pinned search_path', () => {
    const unsafe = sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','field') and p.prosecdef = true and not (p.proconfig::text[] @> array['search_path='])`,
    );
    expect(unsafe).toBe('');
  });

  // ── Anon grants ───────────────────────────────────────────────────

  test('G15-A1 anon cannot SELECT application tables', () => {
    const readable = sql(
      `select string_agg(table_name, ',') from information_schema.role_table_grants where grantee = 'anon' and privilege_type = 'SELECT' and table_schema = 'public' and table_name not in ('schema_migrations')`,
    );
    // PostgREST needs some tables readable for anon endpoints — but sensitive tables should not be
    const sensitive = ['users', 'cadets', 'training_sessions', 'staff_attendance', 'consent_records', 'rank_history', 'achievements', 'groom_daily_logs', 'billing_orders', 'billing_line_items'];
    for (const t of sensitive) {
      expect(readable).not.toContain(t);
    }
  });

  test('G15-A2 anon cannot EXECUTE sensitive app RPCs', async () => {
    const c = appClient();
    const rpcs = ['app_access_snapshot', 'field_punch_in', 'billing_list_orders', 'app_notification_preferences'] as const;
    for (const fn of rpcs) {
      const r = await c.rpc(fn, fn === 'field_punch_in' ? { p_latitude: 0, p_longitude: 0, p_accuracy_m: 1, p_observed_at: new Date().toISOString(), p_operation_id: randomUUID() } : {});
      expect(r.error).not.toBeNull();
    }
  });

  test('G15-A3 anon cannot list or download from any storage bucket', async () => {
    const c = appClient();
    for (const bucket of ['session-videos', 'proof-photos', 'app-content']) {
      const list = await c.storage.from(bucket).list();
      expect(list.error !== null || (list.data ?? []).length === 0).toBe(true);
    }
  });

  // ── TRUNCATE ──────────────────────────────────────────────────────

  test('G15-T1 no non-admin role has TRUNCATE on app tables', () => {
    const grants = sql(
      `select string_agg(grantee || ':' || table_name, ',') from information_schema.role_table_grants where privilege_type = 'TRUNCATE' and table_schema = 'public' and grantee in ('anon','authenticated','service_role')`,
    );
    expect(grants).toBe('');
  });

  // ── Storage policies ──────────────────────────────────────────────

  test('G15-S1 all three buckets have at least one storage policy', () => {
    for (const bucket of ['session-videos', 'proof-photos', 'app-content']) {
      const count = sql(`select count(*) from storage.policies p join storage.buckets b on b.id = p.bucket_id where b.name = '${bucket}'`);
      expect(Number(count)).toBeGreaterThanOrEqual(1);
    }
  });

  test('G15-S2 stranger cannot upload to proof-photos', async () => {
    const c = await as(stranger);
    const bytes = Buffer.from('fake-proof', 'utf8');
    const r = await c.storage.from('proof-photos').upload(`some-hub/${stranger.id}/${randomUUID()}.jpg`, bytes, { contentType: 'image/jpeg' });
    expect(r.error).not.toBeNull();
  });

  test('G15-S3 hub-A instructor cannot upload to proof-photos under hub-B path', async () => {
    const c = await as(w.instructorA);
    const bytes = Buffer.from('fake-proof', 'utf8');
    const r = await c.storage.from('proof-photos').upload(`${w.hubB}/${w.instructorA.id}/${randomUUID()}.jpg`, bytes, { contentType: 'image/jpeg' });
    expect(r.error).not.toBeNull();
  });

  test('G15-S4 path traversal blocked in proof-photos', async () => {
    const c = await as(w.instructorA);
    const bytes = Buffer.from('fake-proof', 'utf8');
    const r = await c.storage.from('proof-photos').upload(`${w.hubA}/../${randomUUID()}.jpg`, bytes, { contentType: 'image/jpeg' });
    expect(r.error).not.toBeNull();
  });

  test('G15-S5 app-content is read-only for authenticated (no uploads)', async () => {
    const c = await as(w.instructorA);
    const bytes = Buffer.from('injected', 'utf8');
    const r = await c.storage.from('app-content').upload(`injected-${randomUUID()}.html`, bytes, { contentType: 'text/html' });
    expect(r.error).not.toBeNull();
  });

  // ── Authenticated function allow-list ─────────────────────────────

  test('G15-F1 authenticated-executable functions match known allow-list', () => {
    const KNOWN = new Set([
      'app_access_snapshot', 'app_notification_preferences', 'app_set_notification_preference',
      'app_account_deletion_status', 'app_request_account_deletion', 'app_cancel_account_deletion',
      'app_consent_centre', 'app_consent_history', 'app_set_media_consent',
      'app_spark_today', 'app_ack_spark', 'app_stream_capability',
      'app_list_events', 'app_event_detail', 'app_rsvp_event', 'app_cancel_rsvp', 'app_policy_flags',
      'field_record_check_in', 'field_publish_session', 'field_correct_session', 'field_void_check_in',
      'field_cadet_media_consent', 'field_session_roster', 'field_punch_in', 'field_punch_out',
      'field_review_queue', 'field_review_item', 'field_review_decide',
      'field_decide_rank_proposal', 'field_propose_rank', 'field_posture_capability',
      'hub_horses',
      'billing_checkout_status', 'billing_quote', 'billing_create_order', 'billing_get_order',
      'billing_list_orders', 'billing_note_client_return', 'billing_cancel_order',
    ]);
    const rows = sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','field') and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.proname not like 'pg_%' and p.proname not like 'st_%' and p.proname not like '_st_%' and p.proname not like 'postgis_%' and p.proname not in ('uuid_generate_v4')`,
    );
    const funcs = rows.split('\n').map((f) => f.trim()).filter(Boolean);
    const extra = funcs.filter((f) => !KNOWN.has(f));
    expect(extra).toEqual([]);
  });

  // ── Billing cross-family isolation ────────────────────────────────

  test('G15-B1 guardian A cannot see guardian B orders', async () => {
    // Create an order for family B via service context
    sql(`insert into public.billing_orders (parent_id, cadet_id, hub_id, status, total_cents) values ('${w.guardianB.id}', '${w.cadetB}', '${w.hubB}', 'paid', 5000) on conflict do nothing`);
    const c = await as(w.guardianA);
    const r = await c.rpc('billing_list_orders', { p_operation_id: randomUUID() });
    const ids = JSON.stringify(r.data ?? {});
    expect(ids).not.toContain(w.cadetB);
  });

  test('G15-B2 stranger cannot create orders for others children', async () => {
    const c = await as(stranger);
    const r = await c.rpc('billing_create_order', {
      p_cadet_id: w.cadetA,
      p_hub_id: w.hubA,
      p_line_items: JSON.stringify([{ sku: 'FAKE', qty: 1 }]),
      p_operation_id: randomUUID(),
    });
    expect(r.error).not.toBeNull();
  });

  // ── Consent isolation ─────────────────────────────────────────────

  test('G15-C1 stranger cannot read consent records', async () => {
    const c = await as(stranger);
    const r = await c.from('consent_records').select('id');
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
  });

  test('G15-C2 guardian A cannot modify consent for guardian B child', async () => {
    const c = await as(w.guardianA);
    const r = await c.rpc('app_set_media_consent', {
      p_cadet_id: w.cadetB,
      p_purpose: 'session_video',
      p_granted: true,
      p_policy_version: 'draft-1',
      p_operation_id: randomUUID(),
    });
    expect(r.error).not.toBeNull();
  });

  // ── Role-based RPC restrictions ───────────────────────────────────

  test('G15-P1 parent cannot field_punch_in (W6 re-verified via RPC error code)', async () => {
    const c = await as(w.guardianA);
    const r = await c.rpc('field_punch_in', { p_latitude: 16.5, p_longitude: 80.6, p_accuracy_m: 10, p_observed_at: new Date().toISOString(), p_operation_id: randomUUID() });
    expect(r.error).not.toBeNull();
  });

  test('G15-P2 groom cannot field_review_decide', async () => {
    const c = await as(w.groomA);
    const r = await c.rpc('field_review_decide', {
      p_check_in_id: randomUUID(),
      p_decision: 'approved',
      p_reason: 'Synthetic G15-P2',
      p_operation_id: randomUUID(),
    });
    expect(r.error).not.toBeNull();
  });

  test('G15-P3 groom cannot field_propose_rank', async () => {
    const c = await as(w.groomA);
    const r = await c.rpc('field_propose_rank', {
      p_cadet_id: w.cadetA,
      p_to_rank: 'CADET_KNIGHT',
      p_reason: 'Synthetic G15-P3',
      p_operation_id: randomUUID(),
    });
    expect(r.error).not.toBeNull();
  });

  // ── Users table protection ────────────────────────────────────────

  test('G15-V1 authenticated cannot UPDATE another user row', async () => {
    const c = await as(w.instructorA);
    await c.from('users').update({ full_name: 'HACKED' }).eq('id', w.guardianA.id);
    const name = sql(`select full_name from public.users where id = '${w.guardianA.id}'`);
    expect(name).not.toBe('HACKED');
  });

  test('G15-V2 authenticated cannot read other users email or phone', async () => {
    const c = await as(w.instructorA);
    const r = await c.from('users').select('email, phone').neq('id', w.instructorA.id);
    if (r.error) return; // access denied entirely — pass
    for (const row of r.data ?? []) {
      expect(row.email).toBeNull();
      expect(row.phone).toBeNull();
    }
  });
});
