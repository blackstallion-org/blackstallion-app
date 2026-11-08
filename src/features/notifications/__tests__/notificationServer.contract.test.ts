import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { createFakeSupabase, networkFailure, ok, pgError } from '@/testing/fakeSupabase';

import { createNotificationServer } from '../data/server';

type Client = ReturnType<typeof createFakeSupabase>['client'];
const server = (client: Client) => createNotificationServer(client, { timeoutMs: 50 });

describe('G14 device token registration', () => {
  test('register sends p_expo_token, p_platform, p_app_build to app_register_device_token', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { app_register_device_token: () => ok({ token_id: 't-1', created: true }) },
    });
    const res = await server(client).deviceTokens.register('ExponentPushToken[abc123]', 'ios', '1.0.0');
    expect(calls).toEqual([{
      kind: 'rpc',
      fn: 'app_register_device_token',
      args: { p_expo_token: 'ExponentPushToken[abc123]', p_platform: 'ios', p_app_build: '1.0.0' },
    }]);
    expect(res).toEqual({ tokenId: 't-1', created: true });
  });

  test('register with no appBuild sends null', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { app_register_device_token: () => ok({ token_id: 't-2', created: false }) },
    });
    await server(client).deviceTokens.register('ExponentPushToken[def456]', 'android');
    expect(calls[0]).toMatchObject({ args: { p_app_build: null } });
  });

  test('register rejects on malformed server reply', async () => {
    const { client } = createFakeSupabase({ rpc: { app_register_device_token: () => ok({ nope: 1 }) } });
    await expect(server(client).deviceTokens.register('t', 'ios')).rejects.toMatchObject({ kind: 'unexpected' });
  });

  test('unregister sends p_expo_token to app_unregister_device_token', async () => {
    const { client, calls } = createFakeSupabase({
      rpc: { app_unregister_device_token: () => ok({ deleted: true }) },
    });
    const res = await server(client).deviceTokens.unregister('ExponentPushToken[abc123]');
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_unregister_device_token', args: { p_expo_token: 'ExponentPushToken[abc123]' } }]);
    expect(res).toEqual({ deleted: true });
  });

  test('unregister rejects on malformed reply', async () => {
    const { client } = createFakeSupabase({ rpc: { app_unregister_device_token: () => ok('ok') } });
    await expect(server(client).deviceTokens.unregister('t')).rejects.toMatchObject({ kind: 'unexpected' });
  });

  test('network failure is retryable', async () => {
    const { client } = createFakeSupabase({ rpc: { app_register_device_token: () => networkFailure() } });
    const e = await server(client).deviceTokens.register('t', 'ios').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldCommandError);
    expect((e as FieldCommandError).retryable).toBe(true);
  });

  test('timeout rejects as retryable network error', async () => {
    const { client } = createFakeSupabase({ rpc: { app_register_device_token: () => new Promise<never>(() => undefined) } });
    const e = await server(client).deviceTokens.register('t', 'ios').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldCommandError);
    expect((e as FieldCommandError).retryable).toBe(true);
  });

  test('server refusal maps to correct error kind', async () => {
    const { client } = createFakeSupabase({ rpc: { app_register_device_token: () => pgError('42501', 'insufficient_privilege', 403) } });
    await expect(server(client).deviceTokens.register('t', 'ios')).rejects.toMatchObject({ kind: 'forbidden', reference: '42501' });
  });
});

describe('G14 push flag', () => {
  test('returns true when push_notifications is enabled', async () => {
    const { client } = createFakeSupabase({
      rpc: { app_policy_flags: () => ok([{ key: 'push_notifications', enabled: true, value: null }]) },
    });
    expect(await server(client).pushFlag.enabled()).toBe(true);
  });

  test('returns false when flag is missing', async () => {
    const { client } = createFakeSupabase({
      rpc: { app_policy_flags: () => ok([{ key: 'other_flag', enabled: true, value: null }]) },
    });
    expect(await server(client).pushFlag.enabled()).toBe(false);
  });

  test('returns false on error (fail closed)', async () => {
    const { client } = createFakeSupabase({ rpc: { app_policy_flags: () => pgError('42501', 'denied', 403) } });
    expect(await server(client).pushFlag.enabled()).toBe(false);
  });

  test('returns false on network failure (fail closed)', async () => {
    const { client } = createFakeSupabase({ rpc: { app_policy_flags: () => networkFailure() } });
    expect(await server(client).pushFlag.enabled()).toBe(false);
  });
});
