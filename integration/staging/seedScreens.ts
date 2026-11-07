/**
 * Extra synthetic rows for screens.staging.ts, on top of stack.ts seedWorld(). LOCAL stack only (stack.ts refuses any
 * other API). Rows are written as the database owner (psql) or, for Storage objects the owner/service role places
 * (event images, Spark audio, an older clip), through the Storage API with the key `supabase status -o env` prints —
 * exactly how the academy would place them. App code under test only ever gets the publishable key.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { hubDate } from '@/core/format/hubTime';

import { API, appClient, createAccount, sql, type Account, type World } from './stack';

const STACK_DIR = path.resolve(__dirname, '../../../backend-local');

function serviceKey(): string {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: STACK_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /^SERVICE_ROLE_KEY="?(.*?)"?$/m.exec(out);
  if (API !== 'http://127.0.0.1:55421' || !m?.[1]) throw new Error('refusing: not the local staging stack');
  return m[1];
}
const storageAdmin = () => createClient(API, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } }).storage;

/** Places a private object the way the academy does (service role; the app has no upload path for these buckets). */
export async function placeObject(bucket: string, objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await storageAdmin().from(bucket).upload(objectPath, bytes, { contentType, upsert: true });
  if (error) throw new Error(`place ${bucket}/${objectPath}: ${error.message}`);
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** A few bytes that start like a JPEG / MP3 (Storage checks the declared type, not the content). */
export const jpegBytes = () => Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), randomBytes(2048)]);
const mp3Bytes = () => Buffer.concat([Buffer.from('494433', 'hex'), randomBytes(2048)]);
/** A data: URL the outbox can read with fetch(uri), like a camera file URI on the phone. */
export const photoUri = () => `data:image/jpeg;base64,${jpegBytes().toString('base64')}`;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type ScreensWorld = World & {
  today: string;
  schoolAdminA: Account;
  stranger: Account;
  /** A second family at hub A (guardian C, cadet C): voided check-in, roster rows. */
  guardianC: Account;
  cadetC: string;
  passportC: string;
  eventA: string;
  eventFullA: string;
  eventDraftA: string;
  eventB: string;
  eventImagePath: string;
  sparkA: string;
  sparkAudioPath: string;
  /** Older published sessions of cadet A (21: one more than a page), newest first; [0] and [1] have clips. */
  oldSessions: string[];
  oldClipPaths: string[];
};

/**
 * Hub A gets: a hub admin, care schedule v1 (three slots) with groom A assigned to horse A, occurrences for
 * yesterday..tomorrow; two published events (one with one seat) + a draft; today's Spark with audio; 21 older
 * published sessions for cadet A (paging, clip comparison); cadet A enrolled on core tuition from this month.
 * Hub B gets one event (never visible to hub A families).
 */
export async function seedScreens(w: World): Promise<ScreensWorld> {
  const today = hubDate(new Date());
  const schoolAdminA = await createAccount(`school-admin-a-${w.run}@example.test`, 'Hub Admin A (synthetic)', 'SCHOOL_ADMIN', w.hubA);
  const stranger = await createAccount(`no-child-${w.run}@example.test`, 'No Child (synthetic)', null, null);
  const guardianC = await createAccount(`guardian-c-${w.run}@example.test`, 'Guardian C (synthetic)', null, null);
  const passportC = `BSAH-26-S${w.run.slice(0, 6).toUpperCase()}C`;
  const cadetC = sql(
    `insert into public.cadets (parent_id, hub_id, first_name, last_name, passport_code) values ('${guardianC.id}', '${w.hubA}', 'Kabir', 'Synthetic', '${passportC}') returning id`,
  );

  // ---------------------------------------------------------------- G5 care (schema field), as client_fixtures.sql
  const sched = sql(
    `insert into field.care_schedules (hub_id, version, effective_from, published_by) values ('${w.hubA}', 1, '${addDays(today, -1)}', '${schoolAdminA.id}') returning id`,
  );
  sql(`insert into field.care_schedule_slots (schedule_id, slot_key, task_type, local_time, instructions) values
        ('${sched}', 'morning_feed', 'feed', '06:00', 'Synthetic: morning feed, 2 kg oats'),
        ('${sched}', 'hoof', 'grooming_hoof', '09:00', 'Synthetic: pick out all four hooves'),
        ('${sched}', 'evening_water', 'water', '18:00', 'Synthetic: top up water')`);
  sql(`insert into field.care_assignments (hub_id, horse_id, staff_id, valid_from) values ('${w.hubA}', '${w.horseA}', '${w.groomA.id}', '${addDays(today, -1)}')`);
  sql(`select field.generate_care_occurrences('${w.hubA}', '${addDays(today, -1)}', '${addDays(today, 1)}')`);

  // ---------------------------------------------------------------- G9 community events (+ private artwork)
  const eventImagePath = `events/${w.hubA}/stg-${w.run}.jpg`;
  await placeObject('app-content', eventImagePath, jpegBytes(), 'image/jpeg');
  const ev = (hub: string, title: string, status: string, capacity: number, image: string | null) =>
    sql(`insert into public.community_events (hub_id, title, description, venue, starts_at, ends_at, rsvp_closes_at, capacity, status, image_object_path)
         values ('${hub}', ${lit(title)}, 'Synthetic event for staging', 'Arena 1', now() + interval '7 days', now() + interval '7 days 2 hours',
                 now() + interval '6 days', ${capacity}, '${status}', ${image ? lit(image) : 'null'}) returning id`);
  const eventA = ev(w.hubA, `Gymkhana ${w.run}`, 'published', 20, eventImagePath);
  const eventFullA = ev(w.hubA, `One-seat clinic ${w.run}`, 'published', 1, null);
  const eventDraftA = ev(w.hubA, `Draft show ${w.run}`, 'draft', 20, null);
  const eventB = ev(w.hubB, `Hub B open day ${w.run}`, 'published', 20, null);

  // ---------------------------------------------------------------- G9 Daily Spark for hub A today (+ audio)
  const sparkAudioPath = `spark/${w.hubA}/stg-${w.run}.mp3`;
  await placeObject('app-content', sparkAudioPath, mp3Bytes(), 'audio/mpeg');
  const sparkA = sql(
    `insert into public.spark_contents (hub_id, local_date, title, audio_object_path, duration_seconds, status)
     values ('${w.hubA}', (now() at time zone 'Asia/Kolkata')::date, 'Synthetic: steady hands', ${lit(sparkAudioPath)}, 75, 'published') returning id`,
  );

  // ---------------------------------------------------------------- older published sessions for cadet A
  // Clip references need session-video consent (G10 trigger), so they are attached by attachOldClips() once the
  // guardian has granted it through FA-12; the objects are placed now.
  const oldSessions: string[] = [];
  const oldClipPaths: string[] = [];
  for (let i = 0; i < 21; i++) {
    if (i < 2) {
      const clip = `${w.hubA}/${w.cadetA}/old-${w.run}-${i}.mp4`;
      await placeObject('session-videos', clip, Buffer.concat([Buffer.from('0000001866747970', 'hex'), randomBytes(4096)]), 'video/mp4');
      oldClipPaths.push(clip);
    }
    oldSessions.push(
      sql(`insert into public.training_sessions (cadet_id, instructor_id, session_date, riding_score, ground_score, stable_score, instructor_notes, brass_stamp_verified)
           values ('${w.cadetA}', '${w.instructorA.id}', '${addDays(today, -10 - i)}', ${5 + (i % 4)}, 6, 7, 'Synthetic older session ${i}', true) returning id`),
    );
  }

  // ---------------------------------------------------------------- G7 billing: enrolment + core tuition plan
  const prog = sql(`select id from public.programs where code = 'foundation'`);
  const app = sql(
    `insert into public.applications (kind, status, applicant_id, program_id, hub_id) values ('cadet', 'enrolled', '${w.guardianA.id}', '${prog}', '${w.hubA}') returning id`,
  );
  sql(`insert into public.enrollments (application_id, cadet_id, program_id, hub_id, enrolled_at) values ('${app}', '${w.cadetA}', '${prog}', '${w.hubA}', now() - interval '40 days')`);
  sql(
    `insert into public.billing_cadet_plans (cadet_id, fee_code, from_month, note) values ('${w.cadetA}', 'core_monthly', date_trunc('month', now() at time zone 'Asia/Kolkata')::date, 'Synthetic staging plan')`,
  );

  return {
    ...w,
    today,
    schoolAdminA,
    stranger,
    guardianC,
    cadetC,
    passportC,
    eventA,
    eventFullA,
    eventDraftA,
    eventB,
    eventImagePath,
    sparkA,
    sparkAudioPath,
    oldSessions,
    oldClipPaths,
  };
}

/** The two newest older sessions get their clips (the G10 trigger accepts it only while session-video consent is allowed). */
export function attachOldClips(sw: ScreensWorld): void {
  sw.oldClipPaths.forEach((clip, i) => sql(`update public.training_sessions set video_log_s3_url = ${lit(clip)} where id = '${sw.oldSessions[i]}'`));
}

// ---------------------------------------------------------------- global switches (restored by the suite)
// app_feature_flags and the billing settings singleton are global on the stack: the suite records them first and puts
// them back in afterAll, so the other suites always see the loaded defaults.

export function snapshotSwitches(): { flags: string; billing: string } {
  return {
    flags: sql(`select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.app_feature_flags f`),
    billing: sql(`select to_jsonb(s) from app_private.billing_settings s where id`),
  };
}

export function restoreSwitches(s: { flags: string; billing: string }): void {
  sql(`update public.app_feature_flags f set enabled = (x->>'enabled')::boolean, value = nullif(x->'value', 'null'::jsonb)
       from jsonb_array_elements(${lit(s.flags)}::jsonb) x where f.key = x->>'key'`);
  sql(`update app_private.billing_settings set checkout_enabled = (${lit(s.billing)}::jsonb->>'checkout_enabled')::boolean,
         kit_channel = ${lit(s.billing)}::jsonb->>'kit_channel' where id`);
}

export function setFlag(key: string, enabled: boolean, value?: unknown): void {
  sql(`update public.app_feature_flags set enabled = ${enabled}${value === undefined ? '' : `, value = ${lit(JSON.stringify(value))}::jsonb`} where key = ${lit(key)}`);
}

export const setCheckout = (enabled: boolean) => sql(`update app_private.billing_settings set checkout_enabled = ${enabled} where id`);

// ---------------------------------------------------------------- PostgREST exposed schemas
// The staging stack now exposes `field` (backend-local/supabase/config.toml api.schemas), as the app requires
// (fieldOps/data/server.ts: client.schema('field')). Only G5's granted functions are reachable there: no table grants.
// Live needs the same setting (Dashboard → API → Exposed schemas); see server/live-delta/APPLY_ORDER.md.

/** Waits until a signed-out call reaches Postgres and is refused there (42501: anon has no USAGE on schema field). */
async function waitForSchema(): Promise<void> {
  const probe = appClient();
  for (let i = 0; i < 75; i++) {
    const r = await probe.schema('field').rpc('my_care_timeline', { p_from: '2026-01-01', p_to: '2026-01-01' });
    if ((r.error as { code?: string } | null)?.code === '42501') return;
    if (i % 5 === 4) sql(`notify pgrst, 'reload schema'`);
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('PostgREST does not expose schema field (check backend-local/supabase/config.toml api.schemas)');
}

/** Kept for the suite's structure: asserts the deployment setting instead of toggling it. */
export async function exposeFieldSchema(_on: boolean): Promise<void> {
  await waitForSchema();
}
