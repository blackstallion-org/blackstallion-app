/**
 * @jest-environment node
 *
 * G14 push notification infrastructure: device_tokens table, notification_outbox, RPCs, triggers, feature flag.
 * Proves token storage and outbox rows against the local Supabase stack.
 * Run: npm run test:staging
 */
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { appClient, createAccount, seedWorld, signIn, sql, type Account, type World } from './stack';

jest.setTimeout(90_000);

let w: World;

const MIGRATION = `
-- G14 push notification infrastructure (D05: flag OFF)

-- 1a. device_tokens (owner-only RLS)
create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expo_token    text not null,
  platform      text not null check (platform in ('ios','android','web')),
  app_build     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, expo_token)
);
alter table public.device_tokens enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'device_tokens' and policyname = 'owner_read') then
    create policy owner_read on public.device_tokens for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'device_tokens' and policyname = 'owner_write') then
    create policy owner_write on public.device_tokens for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'device_tokens' and policyname = 'owner_delete') then
    create policy owner_delete on public.device_tokens for delete using (auth.uid() = user_id);
  end if;
end $$;

-- 1b. notification_outbox (service-role only, no user RLS)
create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references auth.users(id) on delete cascade,
  category        text not null,
  title           text not null,
  body            text not null,
  data            jsonb not null default '{}',
  source_event    text not null,
  source_id       text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  error           text
);
alter table public.notification_outbox enable row level security;
-- No user policies: only service_role / triggers write/read this table.

-- 1c. RPCs
create or replace function public.app_register_device_token(
  p_expo_token text,
  p_platform text,
  p_app_build text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_created boolean;
begin
  insert into device_tokens (user_id, expo_token, platform, app_build)
  values (auth.uid(), p_expo_token, p_platform, p_app_build)
  on conflict (user_id, expo_token) do update set updated_at = now(), app_build = excluded.app_build
  returning id, (xmax = 0) into v_id, v_created;
  return jsonb_build_object('token_id', v_id, 'created', v_created);
end;
$$;

create or replace function public.app_unregister_device_token(
  p_expo_token text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_deleted boolean;
begin
  delete from device_tokens where user_id = auth.uid() and expo_token = p_expo_token;
  v_deleted := found;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- 1d. Outbox-writing helper (internal, not exposed as RPC)
create or replace function internal_enqueue_notification(
  p_recipient_id uuid, p_category text, p_title text, p_body text,
  p_data jsonb, p_source_event text, p_source_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Only enqueue if the user has this category enabled (reads the underlying preference table).
  -- The RPC app_notification_preferences is user-facing; the trigger reads the raw table.
  if exists (
    select 1 from notification_preferences
    where user_id = p_recipient_id and category = p_category and enabled = true
  ) then
    insert into notification_outbox (recipient_id, category, title, body, data, source_event, source_id)
    values (p_recipient_id, p_category, p_title, p_body, p_data, p_source_event, p_source_id);
  end if;
end;
$$;

-- 1e. Feature flag (D05: OFF)
insert into app_feature_flags (key, enabled, value, decision_ref)
values ('push_notifications', false, null, 'D05')
on conflict (key) do nothing;
`;

const as = (a: Account): Promise<SupabaseClient> => signIn(a);

beforeAll(async () => {
  w = await seedWorld();
  sql(MIGRATION);
});

describe('G14 device token registration', () => {
  test('register stores a token and returns token_id + created', async () => {
    const client = await as(w.guardianA);
    const { data, error } = await client.rpc('app_register_device_token', {
      p_expo_token: `ExponentPushToken[test-${w.run}-1]`,
      p_platform: 'ios',
      p_app_build: '1.0.0',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ token_id: expect.any(String), created: true });

    const row = sql(`select user_id, expo_token, platform, app_build from device_tokens where id = '${(data as Record<string, unknown>).token_id}'`);
    expect(row).toContain(w.guardianA.id);
    expect(row).toContain('ios');
  });

  test('re-registering the same token is replay-safe (upsert, created=false)', async () => {
    const client = await as(w.guardianA);
    const token = `ExponentPushToken[test-${w.run}-2]`;
    await client.rpc('app_register_device_token', { p_expo_token: token, p_platform: 'android' });
    const { data } = await client.rpc('app_register_device_token', { p_expo_token: token, p_platform: 'android', p_app_build: '2.0.0' });
    expect(data).toMatchObject({ created: false });
  });

  test('unregister deletes the token', async () => {
    const client = await as(w.guardianA);
    const token = `ExponentPushToken[test-${w.run}-3]`;
    await client.rpc('app_register_device_token', { p_expo_token: token, p_platform: 'web' });
    const { data } = await client.rpc('app_unregister_device_token', { p_expo_token: token });
    expect(data).toMatchObject({ deleted: true });
    const count = sql(`select count(*) from device_tokens where expo_token = '${token}'`);
    expect(count).toBe('0');
  });

  test('unregister for a non-existent token returns deleted=false', async () => {
    const client = await as(w.guardianA);
    const { data } = await client.rpc('app_unregister_device_token', { p_expo_token: 'ExponentPushToken[nope]' });
    expect(data).toMatchObject({ deleted: false });
  });

  test('RLS: user can only see their own tokens via direct table read', async () => {
    const token = `ExponentPushToken[test-${w.run}-rls]`;
    const clientA = await as(w.guardianA);
    await clientA.rpc('app_register_device_token', { p_expo_token: token, p_platform: 'ios' });

    const clientB = await as(w.guardianB);
    const { data: visible } = await clientB.from('device_tokens').select('id');
    expect((visible ?? []).length).toBe(0);
  });
});

describe('G14 notification outbox with preference checking', () => {
  test('outbox row appears when category is enabled, absent when disabled', async () => {
    const userId = w.guardianA.id;
    const sourceId = randomUUID();

    sql(`insert into notification_preferences (user_id, category, enabled) values ('${userId}', 'check_in', true) on conflict (user_id, category) do update set enabled = true`);

    sql(`select internal_enqueue_notification('${userId}', 'check_in', 'Arrival', 'Aarav checked in', '{}', 'staff_attendance_insert', '${sourceId}')`);

    const outbox = sql(`select category, title, body, source_event from notification_outbox where recipient_id = '${userId}' and source_id = '${sourceId}'`);
    expect(outbox).toContain('check_in');
    expect(outbox).toContain('Arrival');

    sql(`update notification_preferences set enabled = false where user_id = '${userId}' and category = 'check_in'`);
    const sourceId2 = randomUUID();
    sql(`select internal_enqueue_notification('${userId}', 'check_in', 'Arrival 2', 'Meera checked in', '{}', 'staff_attendance_insert', '${sourceId2}')`);
    const count = sql(`select count(*) from notification_outbox where recipient_id = '${userId}' and source_id = '${sourceId2}'`);
    expect(count).toBe('0');
  });

  test('outbox row absent when preference does not exist (no row = not enabled)', async () => {
    const userId = w.instructorA.id;
    const sourceId = randomUUID();

    sql(`delete from notification_preferences where user_id = '${userId}' and category = 'assessment_published'`);
    sql(`select internal_enqueue_notification('${userId}', 'assessment_published', 'New assessment', 'Published', '{}', 'assessment_publish', '${sourceId}')`);
    const count = sql(`select count(*) from notification_outbox where recipient_id = '${userId}' and source_id = '${sourceId}'`);
    expect(count).toBe('0');
  });
});

describe('G14 feature flag', () => {
  test('push_notifications flag exists and is OFF (D05)', () => {
    const row = sql(`select enabled, decision_ref from app_feature_flags where key = 'push_notifications'`);
    expect(row).toContain('f');
    expect(row).toContain('D05');
  });
});
