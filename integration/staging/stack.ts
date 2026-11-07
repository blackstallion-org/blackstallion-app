/**
 * Staging harness for the LOCAL Supabase stack "bsah-g3-local" (backend-local/, loaded by load_staging.sh).
 * Synthetic people only (example.test addresses). Refuses to run against anything except 127.0.0.1:55421/55422.
 *
 * The secret/service key is used ONLY here, by the test harness, to create synthetic users and to set staff roles the
 * way the academy's trusted activation does. The app code under test only ever receives the publishable key.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STACK_DIR = path.resolve(__dirname, '../../../backend-local');
const DB = 'postgresql://supabase_admin:postgres@127.0.0.1:55422/postgres';

function status(): Record<string, string> {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: STACK_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return Object.fromEntries(
    out
      .split('\n')
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
}

const env = status();
export const API = env.API_URL ?? '';
export const PUBLISHABLE = env.PUBLISHABLE_KEY ?? env.ANON_KEY ?? '';
const SERVICE = env.SERVICE_ROLE_KEY ?? '';
if (API !== 'http://127.0.0.1:55421') throw new Error(`refusing to run: ${API || '(no stack)'} is not the local staging stack`);

export const sql = (q: string): string =>
  execFileSync(process.env.PSQL ?? 'psql', [DB, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const admin = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
/** A fresh app-side client: publishable key only, like the phone. */
export const appClient = () => createClient(API, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });

export type Account = { id: string; email: string; password: string };

export async function createAccount(email: string, fullName: string, role: string | null, hubId: string | null): Promise<Account> {
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  // Staff roles are set by a trusted context after creation (live activation does the same; G3 FINDING).
  if (role) sql(`update public.users set role = ${lit(role)} where id = ${lit(data.user.id)}`);
  if (hubId) sql(`update public.users set hub_id = ${lit(hubId)} where id = ${lit(data.user.id)}`);
  return { id: data.user.id, email, password };
}

export async function signIn(a: Account, client: SupabaseClient = appClient()): Promise<SupabaseClient> {
  const { error } = await client.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error(`sign-in ${a.email}: ${error.message}`);
  return client;
}

export type World = {
  run: string;
  hubA: string;
  hubB: string;
  horseA: string;
  cadetA: string;
  cadetB: string;
  passportA: string;
  passportB: string;
  skills: string[];
  instructorA: Account;
  instructorB: Account;
  guardianA: Account;
  guardianB: Account;
  groomA: Account;
};

/** Two hubs, two unrelated families, staff in hub A and hub B. Unique per run so suites never collide. */
export async function seedWorld(): Promise<World> {
  const run = randomUUID().slice(0, 8);
  const hubA = sql(`insert into public.school_hubs (school_name, slug, latitude, longitude) values ('Staging Hub A ${run}', 'stg-a-${run}', 16.50625, 80.64805) returning id`);
  const hubB = sql(`insert into public.school_hubs (school_name, slug, latitude, longitude) values ('Staging Hub B ${run}', 'stg-b-${run}', 17.385, 78.4867) returning id`);
  const horseA = sql(`insert into public.equine_fleet (hub_id, name, microchip_iso_id, height_hands, temperament) values ('${hubA}', 'Badal (synthetic)', 'STG-${run}-A', 15.2, 'Calm') returning id`);
  const instructorA = await createAccount(`instructor-a-${run}@example.test`, 'Instructor A (synthetic)', 'INSTRUCTOR', hubA);
  const instructorB = await createAccount(`instructor-b-${run}@example.test`, 'Instructor B (synthetic)', 'INSTRUCTOR', hubB);
  const groomA = await createAccount(`groom-a-${run}@example.test`, 'Groom A (synthetic)', 'GROOM', hubA);
  const guardianA = await createAccount(`guardian-a-${run}@example.test`, 'Guardian A (synthetic)', null, null);
  const guardianB = await createAccount(`guardian-b-${run}@example.test`, 'Guardian B (synthetic)', null, null);
  const passportA = `BSAH-26-S${run.slice(0, 6).toUpperCase()}A`;
  const passportB = `BSAH-26-S${run.slice(0, 6).toUpperCase()}B`;
  const cadetA = sql(`insert into public.cadets (parent_id, hub_id, assigned_horse_id, first_name, last_name, passport_code) values ('${guardianA.id}', '${hubA}', '${horseA}', 'Aarav', 'Synthetic', '${passportA}') returning id`);
  const cadetB = sql(`insert into public.cadets (parent_id, hub_id, first_name, last_name, passport_code) values ('${guardianB.id}', '${hubB}', 'Meera', 'Synthetic', '${passportB}') returning id`);
  if (sql(`select count(*) from public.skills where name like 'Synthetic %'`) === '0') {
    sql(`insert into public.skills (name, category) values ('Synthetic rising trot', 'RIDING'), ('Synthetic leading in hand', 'GROUND'), ('Synthetic tack check', 'STABLE')`);
  }
  const skills = sql(`select string_agg(id::text, ',' order by name) from public.skills where name like 'Synthetic %'`).split(',');
  return { run, hubA, hubB, horseA, cadetA, cadetB, passportA, passportB, skills, instructorA, instructorB, guardianA, guardianB, groomA };
}

/** A tiny byte string tagged as MP4, served as a data: URL (the app reads clips with fetch(uri)). */
export const clipUri = () => `data:video/mp4;base64,${Buffer.concat([Buffer.from('0000001866747970', 'hex'), randomBytes(4096)]).toString('base64')}`;
