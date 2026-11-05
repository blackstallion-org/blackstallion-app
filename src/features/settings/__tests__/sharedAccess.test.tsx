/**
 * Critical shared-access tests (CLAUDE_BUILD_PROMPT §8) on the real route files and shell (sharedRouterHarness),
 * with the REAL account server repositories over a recording fake supabase client:
 * - sign-out / user switch removes the previous person's private data from caches;
 * - switching experience cannot elevate a role (and the server is never told the experience);
 * - SH-06: pending local work gets an explicit choice; nothing is discarded silently.
 * JS-level (jest-expo); server authorization itself is tested in server/live-delta.
 */
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { unconnectedRepositories, type Repositories } from '@/core/data/RepositoryProvider';
import { createAccountServer } from '@/features/account/data/server';
import type { PendingWorkPort } from '@/features/account/data/repositories';
import { profileCacheSubjects } from '@/features/account/hooks';
import { readAccountConfig } from '@/features/account/config';
import { pendingVerification } from '@/features/identity/otp';
import { createFakeSupabase, ok, type FakeResult } from '@/testing/fakeSupabase';

import { authorized, createTestAdapter, renderSharedApp } from '../testing/sharedRouterHarness';

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('@/core/auth/supabaseClient', () => ({
  readBackendConfig: () => ({ url: 'http://127.0.0.1:55421', publishableKey: 'test-publishable' }),
  createConfiguredAccessAdapter: () => null,
  getConfiguredClient: () => null,
}));

const ASHA = authorized('u-asha', 'Asha Verma', ['field'], { role: 'INSTRUCTOR', hubId: 'h-alpha', children: [], capabilities: { recordAssessment: true } });
const BALA = authorized('u-bala', 'Bala Rao', ['field'], { role: 'GROOM', hubId: 'h-beta', children: [], capabilities: {} });
const GUARDIAN = authorized('u-g', 'Gita Nair', ['family'], { role: 'PARENT', hubId: null, children: [{ cadetId: 'c-1', firstName: 'Kavya', hubId: 'h-alpha' }], capabilities: {} });
const DUAL = authorized('u-d', 'Dev Menon', ['family', 'field'], { role: 'INSTRUCTOR', hubId: 'h-alpha', children: [{ cadetId: 'c-2', firstName: 'Ira', hubId: 'h-beta' }], capabilities: { recordAssessment: true } });

function backend(opts: { pending?: PendingWorkPort } = {}) {
  const failTables: Record<string, FakeResult | Error> = {};
  const fake = createFakeSupabase({
    tables: { school_hubs: [{ id: 'h-alpha', school_name: 'Hub Alpha' }, { id: 'h-beta', school_name: 'Hub Beta' }] },
    rpc: { app_notification_preferences: () => ok([]) },
    failTables,
  });
  const account = { ...createAccountServer(fake.client, { timeoutMs: 200, config: readAccountConfig({}) }), pendingWork: opts.pending };
  const repositories: Repositories = { ...unconnectedRepositories, account };
  return { ...fake, failTables, repositories };
}

const textOf = () => JSON.stringify(screen.toJSON());
const openProfile = async () => {
  await fireEvent.press(screen.getByTestId('tab-profile'));
  await screen.findByTestId('profile-roles');
};
const openSettingsFromProfile = async (r: { getPathname(): string }) => {
  await fireEvent.press(screen.getByTestId('open-settings'));
  await waitFor(() => expect(r.getPathname()).toBe('/settings'));
};

beforeEach(() => pendingVerification.clear());

describe('sign-out and user switch remove the previous person’s private data', () => {
  test('explicit sign-out clears the cached header and the code address; the next person sees none of it', async () => {
    const t = createTestAdapter();
    const b = backend();
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    await act(async () => t.signInAs(ASHA));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    await openProfile();
    expect(screen.getByTestId('profile-roles')).toHaveTextContent('Instructor at Hub Alpha');
    expect(profileCacheSubjects()).toEqual(['u-asha']);
    pendingVerification.set({ channel: 'email', address: 'asha@academy.test', boundaryKind: 'provider', sentAt: Date.now() });

    await openSettingsFromProfile(r);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(await screen.findByTestId('sign-out-dialog')).toBeTruthy(); // nothing pending → plain dialog
    await fireEvent.press(screen.getByTestId('sign-out-confirm'));
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    expect(t.state.signOuts).toBe(1);
    expect(profileCacheSubjects()).toEqual([]);
    expect(pendingVerification.get()).toBeNull();
    expect(textOf()).not.toMatch(/Asha|Hub Alpha|asha@/);

    // Bala's own header fails to load: the stale fallback must not be Asha's.
    b.failTables.school_hubs = new TypeError('Network request failed');
    await act(async () => t.signInAs(BALA));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    await fireEvent.press(screen.getByTestId('tab-profile'));
    expect(await screen.findByTestId('profile-details-error')).toHaveTextContent(/couldn't load/);
    expect(textOf()).toContain('Bala Rao');
    expect(textOf()).not.toMatch(/Asha|Hub Alpha/);
  });

  test('a different person signing in on this device (no explicit sign-out) also clears the previous caches', async () => {
    const t = createTestAdapter();
    const b = backend();
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await act(async () => t.signInAs(ASHA));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    await openProfile();
    expect(profileCacheSubjects()).toEqual(['u-asha']);
    pendingVerification.set({ channel: 'email', address: 'asha@academy.test', boundaryKind: 'provider', sentAt: Date.now() });

    // The provider session changes to Bala (e.g. a sign-in from another tab of the auth flow): reload, new subject.
    await act(async () => t.signInAs(BALA));
    await screen.findByTestId('field-today-stub'); // the authorized tree is rebuilt for the new subject
    expect(profileCacheSubjects()).toEqual([]);
    await openProfile();
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Bala Rao');
    expect(screen.getByTestId('profile-roles')).toHaveTextContent('Groom at Hub Beta');
    expect(profileCacheSubjects()).toEqual(['u-bala']);
    expect(pendingVerification.get()).toBeNull();
    expect(textOf()).not.toMatch(/Asha|Hub Alpha/);
  });
});

describe('switching experience cannot elevate a role', () => {
  test('a family-only person gets no switch anywhere, and Field Ops stays unreachable by link', async () => {
    const t = createTestAdapter();
    const b = backend();
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await act(async () => t.signInAs(GUARDIAN));
    await waitFor(() => expect(r.getPathname()).toBe('/family'));
    await openProfile();
    expect(screen.queryByTestId('profile-switch')).toBeNull();
    expect(screen.getByTestId('open-billing')).toBeTruthy(); // guardians, Family experience only
    await openSettingsFromProfile(r);
    expect(screen.queryByTestId('experience-options')).toBeNull();
    await act(async () => {
      try {
        const { router } = await import('expo-router');
        router.push('/field/profile');
      } catch {
        // the guard refuses; expected
      }
    });
    await waitFor(() => expect(r.getPathname()).not.toMatch(/^\/field/));
    expect(screen.queryByTestId('profile-field')).toBeNull();
  });

  test('a dual-role switch changes navigation only: same grants, same server calls, nothing sent about the experience', async () => {
    const t = createTestAdapter();
    const b = backend();
    let loads = 0;
    const load = t.adapter.load;
    t.adapter.load = async () => {
      loads++;
      return load();
    };
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await act(async () => t.signInAs(DUAL));
    await waitFor(() => expect(r.getPathname()).toBe('/family'));
    await openProfile();
    const before = textOf().match(/Instructor at Hub Alpha|Guardian of Ira/g);
    const loadsBefore = loads;
    expect(screen.queryByTestId('open-billing')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('profile-experience-field'));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    expect(loads).toBe(loadsBefore); // no new access snapshot: switching asks the server for nothing
    await openProfile();
    expect(textOf().match(/Instructor at Hub Alpha|Guardian of Ira/g)).toEqual(before); // same display roles
    expect(screen.queryByTestId('open-billing')).toBeNull(); // Billing is a Family destination
    // The account server never receives the experience or the subject: grants come from auth.uid() only.
    for (const c of b.calls) expect(JSON.stringify(c)).not.toMatch(/family|field|u-d/);
  });
});

describe('SH-06 sign-out with unsent work', () => {
  const pendingPort = (n: number) => {
    let count = n;
    const discard = jest.fn(async () => {
      count = 0;
    });
    return { port: { count: async () => count, discard } as PendingWorkPort, discard };
  };

  test('Field Ops: "Send them first" opens Sync and signs nobody out', async () => {
    const t = createTestAdapter();
    const { port } = pendingPort(2);
    const b = backend({ pending: port });
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await act(async () => t.signInAs(ASHA));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    await openProfile();
    await openSettingsFromProfile(r);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(await screen.findByTestId('sign-out-sheet')).toHaveTextContent(/Items waiting to send: 2/);
    await fireEvent.press(screen.getByTestId('sign-out-send-first'));
    await waitFor(() => expect(r.getPathname()).toBe('/field/sync'));
    expect(t.state.signOuts).toBe(0);
  });

  test('Discard needs a second, explicit step with the consequence; then the work is discarded and the person signed out', async () => {
    const t = createTestAdapter();
    const { port, discard } = pendingPort(3);
    const b = backend({ pending: port });
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories, initialUrl: '/' });
    await act(async () => t.signInAs(ASHA));
    await waitFor(() => expect(r.getPathname()).toBe('/field'));
    await openProfile();
    await openSettingsFromProfile(r);
    await fireEvent.press(screen.getByTestId('sign-out'));
    await fireEvent.press(await screen.findByTestId('sign-out-discard'));
    expect(screen.getByTestId('sign-out-sheet')).toHaveTextContent(/deletes 3 unsent item\(s\) from this phone/);
    expect(discard).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sign-out-discard-back'));
    await fireEvent.press(await screen.findByTestId('sign-out-discard'));
    await fireEvent.press(screen.getByTestId('sign-out-discard-confirm'));
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    expect(discard).toHaveBeenCalledWith('u-asha');
    expect(t.state.signOuts).toBe(1);
  });

  test('"Sign out and keep them" keeps the work (nothing discarded); Family has no "Send first"', async () => {
    const t = createTestAdapter();
    const { port, discard } = pendingPort(1);
    const b = backend({ pending: port });
    const r = await renderSharedApp({ adapter: t.adapter, repositories: b.repositories });
    await act(async () => t.signInAs(DUAL));
    await waitFor(() => expect(r.getPathname()).toBe('/family'));
    await openProfile();
    await openSettingsFromProfile(r);
    await fireEvent.press(screen.getByTestId('sign-out'));
    await screen.findByTestId('sign-out-sheet');
    expect(screen.queryByTestId('sign-out-send-first')).toBeNull();
    await fireEvent.press(screen.getByTestId('sign-out-keep'));
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    expect(discard).not.toHaveBeenCalled();
    expect(t.state.signOuts).toBe(1);
  });
});
