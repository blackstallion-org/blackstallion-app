/**
 * @jest-environment node
 *
 * EVERY SCREEN REPOSITORY on the staging stack (real Supabase Auth, PostgREST under RLS, Storage, the G5/G7/G9/G10
 * functions), through the app's own createServerRepositories() — the same objects the screens call, with the same
 * arguments the screens pass. Every method of familyHome, fieldToday, fieldWorkflow, account, familyApp, fieldApp,
 * fieldOps (incl. the outbox) and billing is called at least once by the right persona, success shapes are asserted
 * (source 'server', the seeded ids/values), and at least one wrong persona per area is refused by the SERVER.
 *
 * Grouped by screen id (MOBILE_APP_PLANNING/SCREEN_IMPLEMENTATION_MATRIX.md). BLOCKED = needs a provider that does not
 * exist (SMS, push sending, Razorpay, streaming, posture model): the app's honest "unavailable" answer is asserted.
 *
 * Global switches (feature flags, billing checkout, PostgREST exposed schemas) are restored in afterAll.
 * Run: npm run test:staging
 */
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';
import { ScopedLoadError } from '@/core/data/useScopedResource';
import type { AccountScope } from '@/features/account/data/repositories';
import type { BillingScope } from '@/features/billing/data/repositories';
import { BillingError } from '@/features/billing/domain/billingErrors';
import { billingMonthOf } from '@/features/billing/domain/orders';
import { FamilyCommandError } from '@/features/family/data/repositories';
import type { FamilyScope } from '@/features/family/types';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import type { FieldScope } from '@/features/field/types';
import type { OutboxOwner } from '@/features/fieldOps/data/repositories';
import type { FieldOpsScope } from '@/features/fieldOps/domain/types';
import { createServerRepositories } from '@/shell/serverRepositories';

import {
  attachOldClips,
  exposeFieldSchema,
  photoUri,
  restoreSwitches,
  seedScreens,
  setCheckout,
  setFlag,
  snapshotSwitches,
  type ScreensWorld,
} from './seedScreens';
import { appClient, clipUri, seedWorld, signIn, sql, type Account } from './stack';

jest.setTimeout(90_000);

type Snap = {
  kind: string;
  subjectId: string;
  displayName: string;
  allowedExperiences: ('family' | 'field')[];
  scope: { role?: string; hubId: string | null; children: { cadetId: string; firstName: string; hubId: string | null }[]; capabilities: Record<string, boolean> };
};

/** Sign in like the phone and build every scope the screens build (field/hooks, fieldOps/hooks, account/hooks, …). */
async function session(a: Account) {
  const client: SupabaseClient = await signIn(a, appClient());
  const snap = (await createSupabaseAccessAdapter(client).load()) as Snap;
  const repos = createServerRepositories(client as never);
  const hubId = snap.scope?.hubId ?? null;
  const role = snap.scope?.role ?? null;
  const children = snap.scope?.children ?? [];
  const field: FieldScope = { subjectId: snap.subjectId, experience: 'field', hubId, role: role ?? undefined, displayName: snap.displayName };
  const family: FamilyScope = { subjectId: snap.subjectId, experience: 'family', children, displayName: snap.displayName };
  const ops: FieldOpsScope = { subjectId: snap.subjectId, experience: 'field', hubId, role };
  const owner: OutboxOwner = { subjectId: snap.subjectId, hubId };
  const account: AccountScope = { subjectId: snap.subjectId, displayName: snap.displayName, allowedExperiences: snap.allowedExperiences, scope: snap.scope as AccountScope['scope'] };
  const billing: BillingScope = { subjectId: snap.subjectId, experience: 'family', children };
  return { client, snap, repos, field, family, ops, owner, account, billing };
}
type Session = Awaited<ReturnType<typeof session>>;

/** The rejection of `p` (fails the test if it resolves). */
async function errOf(p: Promise<unknown>): Promise<Error & { kind?: string; reference?: string; hint?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { kind?: string; reference?: string };
  }
  throw new Error('expected a rejection, got success');
}

const bytesAt = async (uri: string) => (await (await fetch(uri)).arrayBuffer()).byteLength;
const grade = { riding: 8, ground: 7, stable: 9, notes: 'Synthetic: screens suite.' };

let w: ScreensWorld;
let switches: ReturnType<typeof snapshotSwitches>;
const S: Record<string, Session> = {};
/** Signs in once per persona; the outbox lives in the session's repositories, so it must be the same object across tests. */
const as = async (name: 'instructorA' | 'instructorB' | 'groomA' | 'guardianA' | 'guardianB' | 'guardianC' | 'schoolAdminA' | 'stranger'): Promise<Session> =>
  (S[name] ??= await session(w[name]));

beforeAll(async () => {
  switches = snapshotSwitches();
  w = await seedScreens(await seedWorld());
});

afterAll(async () => {
  for (const s of Object.values(S)) s.repos.fieldOps?.outbox.setSession(null);
  restoreSwitches(switches);
  await exposeFieldSchema(false);
});

// shared across sections (tests run in file order)
let sessionId = '';
let checkInA = { checkInId: '', checkInOperationId: '' };
let clipPath = '';

// ===================================================================================================== SH (shared)
describe('SH shared account screens', () => {
  test('SH-01 sign-in through the access adapter: right password signs in, a wrong one is "invalid" (phone OTP: BLOCKED, SMS D07)', async () => {
    const adapter = createSupabaseAccessAdapter(appClient());
    expect(await adapter.signInWithPassword(w.guardianA.email, `${w.guardianA.password}x`)).toEqual({ ok: false, reason: 'invalid' });
    expect(await adapter.signInWithPassword(w.guardianA.email, w.guardianA.password)).toEqual({ ok: true });
    expect(await adapter.load()).toMatchObject({ kind: 'authorized', subjectId: w.guardianA.id, allowedExperiences: ['family'] });
  });

  test('SH-03 access: staff, guardians and a childless account get exactly what the server snapshot says', async () => {
    expect((await as('instructorA')).snap).toMatchObject({ kind: 'authorized', allowedExperiences: ['field'], scope: { role: 'INSTRUCTOR', hubId: w.hubA } });
    expect((await as('schoolAdminA')).snap).toMatchObject({ allowedExperiences: ['field'], scope: { role: 'SCHOOL_ADMIN', hubId: w.hubA, capabilities: { viewHubCadets: true, punchIn: false } } });
    expect((await as('groomA')).snap.scope.capabilities).toMatchObject({ punchIn: true, submitCareProof: true, recordAssessment: false });
    expect((await as('guardianA')).snap.scope.children).toEqual([{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }]);
    // no child, no staff role: no experience at all (the shell shows SH-03 "noExperience")
    expect((await as('stranger')).snap.allowedExperiences).toEqual([]);
  });

  test('SH-04 profile.get: role line + hub name for staff, child names for guardians', async () => {
    const ins = await as('instructorA');
    expect(await ins.repos.account!.profile.get(ins.account)).toEqual({ staffRole: 'instructor', hubName: `Staging Hub A ${w.run}`, childFirstNames: [], source: 'server' });
    const adm = await as('schoolAdminA');
    expect(await adm.repos.account!.profile.get(adm.account)).toMatchObject({ staffRole: 'hubAdmin', hubName: `Staging Hub A ${w.run}` });
    const gua = await as('guardianA');
    expect(await gua.repos.account!.profile.get(gua.account)).toEqual({ staffRole: null, hubName: null, childFirstNames: ['Aarav'], source: 'server' });
  });

  test('SH-08 notifications.list: only the categories offered to each audience', async () => {
    const cats = async (n: Parameters<typeof as>[0]) => {
      const s = await as(n);
      return (await s.repos.account!.notifications.list(s.account)).map((c) => c.category);
    };
    expect(await cats('guardianA')).toEqual(['check_in', 'assessment_published', 'events', 'spark_daily']);
    expect(await cats('instructorA')).toEqual(['care_reminders']);
    expect(await cats('groomA')).toEqual(['care_reminders']);
    expect(await cats('schoolAdminA')).toEqual(['review_escalations']);
    expect(await cats('stranger')).toEqual([]);
    const gua = await as('guardianA');
    const list = await gua.repos.account!.notifications.list(gua.account);
    expect(list.every((c) => c.isDefault && c.audience === 'family')).toBe(true);
    expect(list.find((c) => c.category === 'spark_daily')?.enabled).toBe(false);
  });

  test('SH-08 notifications.set: acknowledged, replay-safe, persisted; a category not offered is refused', async () => {
    const { repos, account } = await as('guardianA');
    const op = randomUUID();
    const ack = await repos.account!.notifications.set(account, { category: 'events', enabled: false, operationId: op });
    expect(ack).toMatchObject({ category: 'events', enabled: false, duplicate: false });
    expect(typeof ack.updatedAt).toBe('string');
    expect(await repos.account!.notifications.set(account, { category: 'events', enabled: false, operationId: op })).toMatchObject({ duplicate: true });
    const events = (await repos.account!.notifications.list(account)).find((c) => c.category === 'events');
    expect(events).toMatchObject({ enabled: false, isDefault: false });
    // same operation id, different request → conflict, never a silent overwrite
    expect((await errOf(repos.account!.notifications.set(account, { category: 'events', enabled: true, operationId: op }))).kind).toBe('conflict');
    // WRONG PERSONA: a guardian cannot set a staff category (server PT422)
    expect((await errOf(repos.account!.notifications.set(account, { category: 'review_escalations', enabled: false, operationId: randomUUID() }))).kind).toBe('invalid');
  });

  test('SH-08 BLOCKED(push sending): no OS-permission port in the server build; the screen says push is not built', async () => {
    expect((await as('guardianA')).repos.account!.notificationPermission).toBeUndefined();
  });

  test('SH-10 deletion: status → request → already open → cancel; another account cannot cancel it', async () => {
    const b = await as('guardianB');
    const del = b.repos.account!.deletion;
    expect(await del.status(b.account)).toBeNull();
    const req = await del.request(b.account, { reason: 'Synthetic: moving away', operationId: randomUUID() });
    expect(req).toMatchObject({ status: 'requested', canCancel: true, alreadyOpen: false, duplicate: false, reason: 'Synthetic: moving away', version: 1 });
    const again = await del.request(b.account, { reason: null, operationId: randomUUID() });
    expect(again).toMatchObject({ requestId: req.requestId, alreadyOpen: true });
    expect(await del.status(b.account)).toMatchObject({ requestId: req.requestId, status: 'requested' });
    // WRONG PERSONA: guardian A cannot cancel guardian B's request (server PT404)
    const a = await as('guardianA');
    expect((await errOf(a.repos.account!.deletion.cancel(a.account, { requestId: req.requestId, operationId: randomUUID() }))).kind).toBe('notFound');
    const op = randomUUID();
    expect(await del.cancel(b.account, { requestId: req.requestId, operationId: op })).toMatchObject({ status: 'cancelled', alreadyCancelled: false, canCancel: false, version: 2 });
    expect(await del.cancel(b.account, { requestId: req.requestId, operationId: op })).toMatchObject({ duplicate: true });
    expect(await del.status(b.account)).toMatchObject({ status: 'cancelled', canCancel: false });
    expect(sql(`select count(*) from public.account_deletion_requests where user_id = '${w.guardianB.id}'`)).toBe('1');
  });

  test('SH-09 support contact and SH-12 update links come from build config (no server read)', async () => {
    const { repos } = await as('guardianA');
    expect(await repos.account!.support.contact()).toMatchObject({ source: expect.stringMatching(/^(config|synthetic-preview)$/) });
    const dest = await repos.account!.support.updateDestinations();
    expect(Object.keys(dest).sort()).toEqual(['android', 'ios']);
  });

  test('SH-12 BLOCKED(no minimum-version contract, J09): versionPolicy is absent, so the gate fails open', async () => {
    expect((await as('guardianA')).repos.account!.versionPolicy).toBeUndefined();
  });
});

// ===================================================================================================== FA-12 first
describe('FA-12 consent centre (before capture: FO-03 depends on it)', () => {
  test('centre: three purposes, own child only, nothing set yet; history empty', async () => {
    const { repos, family } = await as('guardianA');
    const centre = await repos.familyApp!.consent.centre(family);
    expect(centre.source).toBe('server');
    expect(centre.purposes.map((p) => p.purpose)).toEqual(['session_video', 'care_photo', 'posture_analysis']);
    expect(centre.children.map((c) => c.childId)).toEqual([w.cadetA]);
    expect(centre.children[0]!.consents.map((c) => c.state)).toEqual(['not_set', 'not_set', 'not_set']);
    expect(await repos.familyApp!.consent.history(family, w.cadetA)).toEqual([]);
  });

  test('set: grant session video (current wording), replay-safe; stale wording refused; history records it', async () => {
    const { repos, family } = await as('guardianA');
    const c = repos.familyApp!.consent;
    const version = (await c.centre(family)).purposes.find((p) => p.purpose === 'session_video')!.policyVersion;
    const stale = await errOf(c.set(family, { childId: w.cadetA, purpose: 'session_video', granted: true, policyVersion: 'draft-0', operationId: randomUUID() }));
    expect(stale).toBeInstanceOf(FamilyCommandError);
    expect(stale.kind).toBe('conflict');
    const op = randomUUID();
    expect(await c.set(family, { childId: w.cadetA, purpose: 'session_video', granted: true, policyVersion: version, operationId: op })).toMatchObject({ granted: true, changed: true, duplicate: false });
    expect(await c.set(family, { childId: w.cadetA, purpose: 'session_video', granted: true, policyVersion: version, operationId: op })).toMatchObject({ duplicate: true });
    const hist = await c.history(family, w.cadetA);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ purpose: 'session_video', granted: true, policyVersion: version, byCurrentGuardian: true });
    expect((await c.centre(family)).children[0]!.consents.find((x) => x.purpose === 'session_video')).toMatchObject({ state: 'granted', allowed: true });
    attachOldClips(w); // the G10 trigger now accepts the older sessions' clip references
  });

  test('WRONG PERSONA: guardian B cannot read or set consent for cadet A (client gate, then the server itself)', async () => {
    const b = await as('guardianB');
    expect((await b.repos.familyApp!.consent.centre(b.family)).children.map((c) => c.childId)).toEqual([w.cadetB]);
    const client = await errOf(b.repos.familyApp!.consent.set(b.family, { childId: w.cadetA, purpose: 'session_video', granted: false, policyVersion: 'draft-1', operationId: randomUUID() }));
    expect(client).toMatchObject({ kind: 'notFound', reference: 'CLIENT-SCOPE' });
    // forged snapshot: the request reaches the server, which refuses (PT404) — RLS/RPC is the authority
    const forged: FamilyScope = { ...b.family, children: [{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }] };
    expect(await errOf(b.repos.familyApp!.consent.set(forged, { childId: w.cadetA, purpose: 'session_video', granted: false, policyVersion: 'draft-1', operationId: randomUUID() }))).toMatchObject({
      kind: 'notFound',
      reference: 'PT404',
    });
    expect(await errOf(b.repos.familyApp!.consent.history(forged, w.cadetA))).toMatchObject({ reference: 'NOTFOUND-PT404' });
    expect(sql(`select count(*) from public.consent_records where cadet_id = '${w.cadetA}'`)).toBe('1');
  });
});

// ===================================================================================================== FO core (instructor)
describe('FO field core: Today, scan, cadets, assessment, void, roster', () => {
  test('FO-01 fieldToday.getToday before any check-in (instructor and groom)', async () => {
    const ins = await as('instructorA');
    // development-fixture hooks never exist in the server build
    expect(ins.repos.fieldApp!.previewAccess).toBeUndefined();
    expect(ins.repos.fieldApp!.previewPassportCodes).toBeUndefined();
    const t = await ins.repos.fieldToday.getToday(ins.field);
    expect(t).toMatchObject({ source: 'server', roleLabel: 'Instructor', hubName: `Staging Hub A ${w.run}`, checkIns: [], cadets: [], careAvailable: false });
    const g = await as('groomA');
    expect(await g.repos.fieldToday.getToday(g.field)).toMatchObject({ source: 'server', roleLabel: 'Groom', checkIns: [] });
  });

  test('FO-05 cadets.list: hub A cadets only, with ranks', async () => {
    const { repos, field } = await as('instructorA');
    const list = await repos.fieldApp!.cadets.list(field);
    expect(list).toMatchObject({ source: 'server', hubName: `Staging Hub A ${w.run}` });
    expect(list.cadets.map((c) => c.id).sort()).toEqual([w.cadetA, w.cadetC].sort());
    expect(list.cadets.find((c) => c.id === w.cadetA)).toMatchObject({ name: 'Aarav Synthetic', rank: 'CADET_SQUIRE', today: null });
    const b = await as('instructorB');
    expect((await b.repos.fieldApp!.cadets.list(b.field)).cadets.map((c) => c.id)).toEqual([w.cadetB]);
  });

  test('FO-02 fieldWorkflow.checkIn (scan): new, own replay, someone else’s later scan', async () => {
    const { repos } = await as('instructorA');
    const op = randomUUID();
    const observedAt = new Date(); // a retry resends the SAME request (FO-02 keeps it until the server answers)
    const ci = await repos.fieldWorkflow!.checkIn({ passportCode: w.passportA, observedAt, operationId: op });
    expect(ci).toMatchObject({ cadetId: w.cadetA, cadetName: 'Aarav Synthetic', duplicate: false, isToday: true, sessionDate: w.today, checkInOperationId: op });
    checkInA = { checkInId: ci.checkInId, checkInOperationId: ci.checkInOperationId };
    expect(await repos.fieldWorkflow!.checkIn({ passportCode: w.passportA, observedAt, operationId: op })).toMatchObject({ checkInId: ci.checkInId, duplicate: false });
    // same operation id, different request → refused, never a silent second check-in
    expect((await errOf(repos.fieldWorkflow!.checkIn({ passportCode: w.passportA, observedAt: new Date(observedAt.getTime() + 1000), operationId: op }))).kind).toBe('conflict');
    const later = await repos.fieldApp!.commands((await as('instructorA')).field).checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() });
    expect(later).toMatchObject({ checkInId: ci.checkInId, checkInOperationId: op, duplicate: true });
  });

  test('WRONG PERSONA: a groom and another hub’s instructor cannot check in a hub A cadet', async () => {
    const g = await as('groomA');
    expect((await errOf(g.repos.fieldWorkflow!.checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() }))).kind).toBe('forbidden');
    const b = await as('instructorB');
    const cross = await errOf(b.repos.fieldApp!.commands(b.field).checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() }));
    expect(cross).toBeInstanceOf(FieldCommandError);
    expect(cross.kind).toBe('notFound');
    expect(sql(`select count(*) from public.cadet_check_ins where cadet_id = '${w.cadetA}'`)).toBe('1');
  });

  test('FO-01 / checkIns.listToday after the scan: instructor sees "not published", hub admin no session state, groom no cadets', async () => {
    const ins = await as('instructorA');
    expect((await ins.repos.fieldToday.getToday(ins.field)).checkIns).toEqual([expect.objectContaining({ cadetId: w.cadetA, cadetName: 'Aarav Synthetic', checkInId: checkInA.checkInId, published: false })]);
    expect(await ins.repos.fieldApp!.checkIns.listToday(ins.field)).toEqual([expect.objectContaining({ cadetId: w.cadetA, checkInOperationId: checkInA.checkInOperationId, published: false })]);
    const a = await as('schoolAdminA');
    expect(await a.repos.fieldToday.getToday(a.field)).toMatchObject({ roleLabel: 'Hub admin', checkIns: [expect.objectContaining({ cadetId: w.cadetA, published: null })] });
    // grooms read no cadet data at all (mobile_can_read_cadet: INSTRUCTOR/SCHOOL_ADMIN of the hub, the guardian)
    const g = await as('groomA');
    expect((await g.repos.fieldToday.getToday(g.field)).checkIns).toEqual([]);
  });

  test('FO-06 cadets.profile: masked passport, horse, today, history, consent', async () => {
    const { repos, field } = await as('instructorA');
    const p = await repos.fieldApp!.cadets.profile(field, w.cadetA);
    expect(p.source).toBe('server');
    expect(p.cadet).toMatchObject({ id: w.cadetA, name: 'Aarav Synthetic', firstName: 'Aarav', rank: 'CADET_SQUIRE', horseName: 'Badal (synthetic)' });
    expect(p.cadet.passportHint).toBe(`BSAH-26-••••${w.passportA.slice(-4)}`);
    expect(p.today).toMatchObject({ checkInId: checkInA.checkInId, checkInOperationId: checkInA.checkInOperationId, publishedSessionId: null });
    expect(p.attendance[0]).toMatchObject({ date: w.today, published: false });
    expect(p.sessions?.length).toBe(21); // the seeded history (limit 30)
    expect(p.consent).toEqual({ sessionVideo: 'allowed', carePhoto: 'off', postureAnalysis: 'off' });
  });

  test('WRONG PERSONA: FO-06 for another hub’s cadet (or for a groom) is a neutral not-found; a hub admin gets no assessments', async () => {
    const b = await as('instructorB');
    expect(await errOf(b.repos.fieldApp!.cadets.profile(b.field, w.cadetA))).toMatchObject({ reference: 'NOT-FOUND' });
    expect(await b.repos.fieldApp!.consent.forCadet(b.field, w.cadetA)).toEqual({ sessionVideo: 'unknown', carePhoto: 'unknown', postureAnalysis: 'unknown' });
    const g = await as('groomA');
    expect(await errOf(g.repos.fieldApp!.cadets.profile(g.field, w.cadetA))).toMatchObject({ reference: 'NOT-FOUND' });
    const a = await as('schoolAdminA');
    const p = await a.repos.fieldApp!.cadets.profile(a.field, w.cadetA);
    expect(p.sessions).toBeNull();
    expect(p.consent.sessionVideo).toBe('allowed');
  });

  test('FO-03 skills, consent, uploadClip, publish (fieldWorkflow), record', async () => {
    const { repos, field } = await as('instructorA');
    const skills = await repos.fieldApp!.sessions.skills(field);
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining(w.skills));
    expect(await repos.fieldApp!.consent.forCadet(field, w.cadetA)).toMatchObject({ sessionVideo: 'allowed' });
    const up = await repos.fieldApp!.commands(field).uploadClip!({ hubId: w.hubA, cadetId: w.cadetA, clipId: randomUUID(), uri: clipUri(), mimeType: 'video/mp4' });
    clipPath = up.objectPath;
    const pub = await repos.fieldWorkflow!.publish({ checkInOperationId: checkInA.checkInOperationId, operationId: randomUUID(), videoObject: clipPath, assessment: { ...grade, skillIds: w.skills.slice(0, 2) } });
    expect(pub).toMatchObject({ version: 1, sessionDate: w.today, duplicate: false });
    sessionId = pub.sessionId;
    const rec = await repos.fieldApp!.sessions.record(field, sessionId);
    expect(rec).toMatchObject({ id: sessionId, cadetId: w.cadetA, cadetName: 'Aarav Synthetic', scores: { riding: 8, ground: 7, stable: 9 }, notes: grade.notes, version: 1, published: true, instructorId: w.instructorA.id, hasClip: true, corrections: [] });
    expect(rec.skillIds.sort()).toEqual(w.skills.slice(0, 2).sort());
    expect((await repos.fieldApp!.checkIns.listToday(field))[0]).toMatchObject({ published: true });
  });

  test('FO-03 correct (FO-16 reason): version 2 with the previous scores; a stale version is refused', async () => {
    const { repos, field } = await as('instructorA');
    const cmd = repos.fieldApp!.commands(field);
    const res = await cmd.correct({ sessionId, expectedVersion: 1, scores: { riding: 7, ground: 7, stable: 9 }, notes: grade.notes, reason: 'Synthetic: riding one point high', operationId: randomUUID() });
    expect(res).toMatchObject({ sessionId, version: 2, duplicate: false });
    const stale = await errOf(cmd.correct({ sessionId, expectedVersion: 1, scores: { riding: 6, ground: 7, stable: 9 }, notes: null, reason: 'Synthetic: stale', operationId: randomUUID() }));
    expect(stale.kind).toBe('conflict');
    const rec = await repos.fieldApp!.sessions.record(field, sessionId);
    expect(rec.version).toBe(2);
    expect(rec.corrections).toEqual([expect.objectContaining({ versionBefore: 1, reason: 'Synthetic: riding one point high', previous: { riding: 8, ground: 7, stable: 9, notes: grade.notes } })]);
    const b = await as('instructorB');
    expect(await errOf(b.repos.fieldApp!.sessions.record(b.field, sessionId))).toMatchObject({ reference: 'NOT-FOUND' });
  });

  test('FO-06 → FO-16 voidCheckIn: today’s wrong scan voided with a reason; the day can’t be re-recorded; a published one can’t be voided', async () => {
    const { repos, field } = await as('instructorA');
    const cmd = repos.fieldApp!.commands(field);
    const ci = await cmd.checkIn({ passportCode: w.passportC, observedAt: new Date(), operationId: randomUUID() });
    expect(ci.cadetId).toBe(w.cadetC);
    const op = randomUUID();
    const v = await cmd.voidCheckIn!({ checkInId: ci.checkInId, reason: 'Synthetic: wrong passport scanned', operationId: op });
    expect(v).toMatchObject({ checkInId: ci.checkInId, duplicate: false });
    expect(await cmd.voidCheckIn!({ checkInId: ci.checkInId, reason: 'Synthetic: wrong passport scanned', operationId: op })).toMatchObject({ duplicate: true });
    expect((await repos.fieldApp!.checkIns.listToday(field)).map((c) => c.cadetId)).toEqual([w.cadetA]);
    expect((await repos.fieldApp!.cadets.profile(field, w.cadetC)).today).toBeNull();
    expect(await errOf(cmd.checkIn({ passportCode: w.passportC, observedAt: new Date(), operationId: randomUUID() }))).toMatchObject({ kind: 'conflict', reference: 'CHECKIN-VOIDED' });
    expect(await errOf(cmd.publish({ checkInOperationId: ci.checkInOperationId, operationId: randomUUID(), videoObject: null, assessment: { ...grade, skillIds: null } }))).toMatchObject({ kind: 'conflict' });
    expect((await errOf(cmd.voidCheckIn!({ checkInId: checkInA.checkInId, reason: 'Synthetic: try void published', operationId: randomUUID() }))).kind).toBe('conflict');
    // WRONG PERSONA: another hub's instructor gets a neutral not-found
    const b = await as('instructorB');
    expect((await errOf(b.repos.fieldApp!.commands(b.field).voidCheckIn!({ checkInId: checkInA.checkInId, reason: 'Synthetic: cross hub', operationId: randomUUID() }))).kind).toBe('notFound');
  });

  test('FO-07 roster: off by policy (FEATURE-OFF), then on: every hub cadet with check-in/publish/consent state', async () => {
    const { repos, field } = await as('instructorA');
    expect(await repos.fieldApp!.policy.flags(field)).toEqual({ sessionRoster: false });
    expect(await errOf(repos.fieldApp!.roster.forDate(field, w.today))).toMatchObject({ reference: 'FEATURE-OFF' });
    setFlag('session_roster', true);
    try {
      expect(await repos.fieldApp!.policy.flags(field)).toEqual({ sessionRoster: true });
      const rows = await repos.fieldApp!.roster.forDate(field, w.today);
      expect(rows.map((r) => r.cadetId).sort()).toEqual([w.cadetA, w.cadetC].sort());
      expect(rows.find((r) => r.cadetId === w.cadetA)).toMatchObject({ name: 'Aarav Synthetic', horseName: 'Badal (synthetic)', checkInId: checkInA.checkInId, sessionId, published: true, sessionVideoAllowed: true });
      expect(rows.find((r) => r.cadetId === w.cadetC)).toMatchObject({ checkInId: null, sessionId: null, published: false, sessionVideoAllowed: false });
      // WRONG PERSONA: a groom is refused by the server (42501)
      const g = await as('groomA');
      const denied = await errOf(g.repos.fieldApp!.roster.forDate(g.field, w.today));
      expect(denied).toBeInstanceOf(ScopedLoadError);
      expect(denied.reference).toBe('42501');
    } finally {
      setFlag('session_roster', false);
    }
  });
});

// ===================================================================================================== FA (guardian)
describe('FA family screens', () => {
  test('FA-01 familyHome.getHome: the corrected latest assessment', async () => {
    const { repos, family } = await as('guardianA');
    const home = await repos.familyHome.getHome(family, w.cadetA);
    expect(home).toMatchObject({ source: 'server', hubName: `Staging Hub A ${w.run}`, selectedChildId: w.cadetA, children: [{ id: w.cadetA, name: 'Aarav' }] });
    expect(home.latestAssessment).toMatchObject({ sessionId, riding: 7, ground: 7, stable: 9, corrected: true });
    expect(home.latestAssessment?.skills).toHaveLength(2);
  });

  test('FA-02 progress.get + older: keyset pages of 20, newest first, nothing repeated', async () => {
    const { repos, family } = await as('guardianA');
    expect(repos.familyApp!.linkedChildren(family)).toEqual([{ id: w.cadetA, firstName: 'Aarav', hubId: w.hubA }]);
    const p = await repos.familyApp!.progress.get(family, w.cadetA);
    expect(p).toMatchObject({ source: 'server', childId: w.cadetA, currentRank: 'CADET_SQUIRE' });
    expect(p.sessions).toHaveLength(20);
    expect(p.sessions[0]).toMatchObject({ id: sessionId, date: w.today, scores: { riding: 7, ground: 7, stable: 9 }, corrected: true, hasClip: true });
    expect(p.nextCursor).not.toBeNull();
    const older = await repos.familyApp!.progress.older(family, w.cadetA, p.nextCursor!);
    expect(older.nextCursor).toBeNull();
    const all = [...p.sessions, ...older.sessions].map((s) => s.id);
    expect(new Set(all).size).toBe(22);
    expect(all.sort()).toEqual([sessionId, ...w.oldSessions].sort());
  });

  test('FA-03 sessions.get: scores, skills, notes, correction notice, clip handle', async () => {
    const { repos, family } = await as('guardianA');
    const d = await repos.familyApp!.sessions.get(family, sessionId);
    expect(d).toMatchObject({ source: 'server', id: sessionId, childId: w.cadetA, date: w.today, scores: { riding: 7, ground: 7, stable: 9 }, notes: grade.notes, version: 2 });
    expect(d.corrections).toEqual([expect.objectContaining({ reason: 'Synthetic: riding one point high' })]);
    expect(d.clip).toMatchObject({ sessionId, objectPath: clipPath });
    expect(d.skills.map((s) => s.id).sort()).toEqual(w.skills.slice(0, 2).sort());
    expect((await repos.familyApp!.sessions.get(family, w.oldSessions[5]!)).clip).toBeNull();
    // WRONG PERSONA: guardian B gets the neutral not-found
    const b = await as('guardianB');
    expect(await errOf(b.repos.familyApp!.sessions.get(b.family, sessionId))).toMatchObject({ reference: 'NOTFOUND-SESSION' });
  });

  test('FA-04 Hall of Valour clips + FA-13 compare: two short-lived signed URLs that play', async () => {
    const { repos, family } = await as('guardianA');
    expect(repos.familyApp!.media.available).toBe(true);
    const { source, clips } = await repos.familyApp!.progress.clips(family, w.cadetA);
    expect(source).toBe('server');
    expect(clips.map((c) => c.clip.objectPath)).toEqual([clipPath, ...w.oldClipPaths]);
    const [a, b] = await Promise.all([repos.familyApp!.media.clipUrl(family, clips[0]!.clip), repos.familyApp!.media.clipUrl(family, clips[1]!.clip)]);
    expect(a.uri).not.toBe(b.uri);
    expect(a.expiresAt).toBeGreaterThan(Date.now());
    expect(await bytesAt(a.uri)).toBeGreaterThan(4000);
    expect(await bytesAt(b.uri)).toBeGreaterThan(4000);
    // WRONG PERSONA: guardian B, forged snapshot: the server's consent centre has no such child, so no URL is asked for;
    // and Storage itself refuses to sign the object for guardian B
    const gb = await as('guardianB');
    const forged: FamilyScope = { ...gb.family, children: [{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }] };
    expect(await errOf(gb.repos.familyApp!.media.clipUrl(forged, clips[0]!.clip))).toMatchObject({ reference: 'CONSENT-session_video' });
    expect((await gb.client.storage.from('session-videos').createSignedUrl(clips[0]!.clip.objectPath, 60)).data?.signedUrl ?? null).toBeNull();
  });

  test('FA-05 passport.get: code, server rank, every published session', async () => {
    const { repos, family } = await as('guardianA');
    const p = await repos.familyApp!.passport.get(family, w.cadetA);
    expect(p).toMatchObject({ source: 'server', childId: w.cadetA, passportCode: w.passportA });
    expect(p.input).toMatchObject({ cadetId: w.cadetA, serverCurrentRank: 'CADET_SQUIRE', rankEvents: [] });
    expect(p.input.sessions).toHaveLength(22);
  });

  test('FA-06 Daily Spark: today’s Spark with signed audio; acknowledge is replay-safe and once per day', async () => {
    const { repos, family } = await as('guardianA');
    const spark = repos.familyApp!.spark!;
    const scope = { subjectId: family.subjectId, experience: 'family' as const, cadetId: w.cadetA, children: family.children };
    const today = await spark.repository.getToday(scope);
    expect(today).toMatchObject({ source: 'server', cadetId: w.cadetA, acknowledgement: { acknowledged: false, at: null }, streak: { enabled: false, current: null, longest: null } });
    expect(today.spark).toMatchObject({ id: w.sparkA, title: 'Synthetic: steady hands', durationMs: 75_000, peaks: null });
    expect(await bytesAt(today.spark!.audio!.uri)).toBeGreaterThan(2000);
    const op = randomUUID();
    const ack = await spark.repository.acknowledge!(scope, { cadetId: w.cadetA, sparkId: w.sparkA, operationId: op });
    expect(ack).toMatchObject({ already: false, duplicate: false });
    expect(await spark.repository.acknowledge!(scope, { cadetId: w.cadetA, sparkId: w.sparkA, operationId: op })).toMatchObject({ duplicate: true });
    expect(await spark.repository.acknowledge!(scope, { cadetId: w.cadetA, sparkId: w.sparkA, operationId: randomUUID() })).toMatchObject({ already: true, duplicate: false });
    expect((await spark.repository.getToday(scope)).acknowledgement).toMatchObject({ acknowledged: true });
    // WRONG PERSONA: guardian B, forged snapshot → the server says not found
    const b = await as('guardianB');
    const forged = { subjectId: b.family.subjectId, experience: 'family' as const, cadetId: w.cadetA, children: [{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }] };
    expect(await errOf(b.repos.familyApp!.spark!.repository.getToday(forged))).toMatchObject({ reference: 'NOTFOUND-PT404' });
    // BLOCKED(device audio): createAudio wraps expo-audio, a native module that only exists in a phone build
    expect(typeof spark.createAudio).toBe('function');
  });

  test('FA-07 horse.get: safe horse facts, hub name; care status unavailable (SD-04)', async () => {
    const { repos, family } = await as('guardianA');
    expect(await repos.familyApp!.horse.get(family, w.cadetA)).toEqual({
      source: 'server',
      childId: w.cadetA,
      hubName: `Staging Hub A ${w.run}`,
      horse: { id: w.horseA, name: 'Badal (synthetic)', breed: 'Marwari', heightHands: 15.2, temperament: 'Calm', active: true },
      care: { status: 'unavailable', decisionRef: 'SD-04' },
    });
    const b = await as('guardianB');
    expect((await b.repos.familyApp!.horse.get(b.family, w.cadetB)).horse).toBeNull();
  });

  test('FA-08 BLOCKED(streaming provider, D23): capability is unavailable and no grant can be requested', async () => {
    const { repos, family } = await as('guardianA');
    expect(await repos.familyApp!.stream.capability(family, w.cadetA)).toEqual({ status: 'unavailable', reason: 'feature_disabled', horseAssigned: true });
    expect(repos.familyApp!.stream.requestGrant).toBeUndefined();
    const b = await as('guardianB');
    expect(await b.repos.familyApp!.stream.capability(b.family, w.cadetB)).toEqual({ status: 'unavailable', reason: 'feature_disabled', horseAssigned: false });
  });

  test('FA-09 events.list + media.imageUrl: own hub’s published events only, private artwork via a signed URL', async () => {
    const { repos, family } = await as('guardianA');
    const { source, events } = await repos.familyApp!.events.list(family);
    expect(source).toBe('server');
    const ids = events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([w.eventA, w.eventFullA]));
    expect(ids).not.toContain(w.eventDraftA);
    expect(ids).not.toContain(w.eventB);
    const ev = events.find((e) => e.id === w.eventA)!;
    expect(ev).toMatchObject({ hubId: w.hubA, venue: 'Arena 1', capacity: 20, seatsLeft: 20, status: 'published', rsvpOpen: true, cancellationOpen: null, children: [{ childId: w.cadetA, firstName: 'Aarav', status: 'not_going' }] });
    expect(ev.image).toEqual({ bucket: 'app-content', path: w.eventImagePath });
    const img = await repos.familyApp!.media.imageUrl(family, ev.image!);
    expect(await bytesAt(img.uri)).toBeGreaterThan(2000);
    // WRONG PERSONA: hub B family sees hub B only; a childless account gets nothing
    const b = await as('guardianB');
    const bIds = (await b.repos.familyApp!.events.list(b.family)).events.map((e) => e.id);
    expect(bIds).toContain(w.eventB);
    expect(bIds).not.toContain(w.eventA);
    expect(await errOf(b.repos.familyApp!.media.imageUrl(b.family, ev.image!))).toMatchObject({ reference: 'NOTFOUND-IMAGE' });
    const s = await as('stranger');
    expect((await s.repos.familyApp!.events.list(s.family)).events).toEqual([]);
  });

  test('FA-10 detail + RSVP, FA-11 cancel: seats counted by the server, replay-safe, no waitlist', async () => {
    const { repos, family } = await as('guardianA');
    const ev = repos.familyApp!.events;
    expect((await ev.detail(family, w.eventA)).event).toMatchObject({ id: w.eventA, cancellationOpen: true, rsvpOpen: true, seatsLeft: 20 });
    const op = randomUUID();
    expect(await ev.rsvp(family, { eventId: w.eventA, childId: w.cadetA, operationId: op })).toEqual({ status: 'confirmed', seatsLeft: 19, already: false, duplicate: false });
    expect(await ev.rsvp(family, { eventId: w.eventA, childId: w.cadetA, operationId: op })).toMatchObject({ status: 'confirmed', duplicate: true });
    expect(await ev.rsvp(family, { eventId: w.eventA, childId: w.cadetA, operationId: randomUUID() })).toMatchObject({ already: true, seatsLeft: 19 });
    expect((await ev.detail(family, w.eventA)).event.children).toEqual([{ childId: w.cadetA, firstName: 'Aarav', status: 'confirmed' }]);
    // one seat left: guardian A takes it, guardian C (same hub) is refused — no waitlist
    expect(await ev.rsvp(family, { eventId: w.eventFullA, childId: w.cadetA, operationId: randomUUID() })).toMatchObject({ seatsLeft: 0 });
    const c = await as('guardianC');
    expect(await errOf(c.repos.familyApp!.events.rsvp(c.family, { eventId: w.eventFullA, childId: w.cadetC, operationId: randomUUID() }))).toMatchObject({ kind: 'conflict' });
    // FA-11
    const cop = randomUUID();
    expect(await ev.cancel(family, { eventId: w.eventA, childId: w.cadetA, operationId: cop })).toEqual({ status: 'cancelled', seatsLeft: 20, already: false, duplicate: false });
    expect(await ev.cancel(family, { eventId: w.eventA, childId: w.cadetA, operationId: cop })).toMatchObject({ duplicate: true });
    expect(await ev.cancel(family, { eventId: w.eventA, childId: w.cadetA, operationId: randomUUID() })).toMatchObject({ already: true });
    // WRONG PERSONA: guardian B cannot open or book hub A's event, even with a forged snapshot
    const b = await as('guardianB');
    expect(await errOf(b.repos.familyApp!.events.detail(b.family, w.eventA))).toMatchObject({ reference: 'NOTFOUND-PT404' });
    const forged: FamilyScope = { ...b.family, children: [{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }] };
    expect(await errOf(b.repos.familyApp!.events.rsvp(forged, { eventId: w.eventA, childId: w.cadetA, operationId: randomUUID() }))).toMatchObject({ kind: 'notFound', reference: 'PT404' });
  });
});

// ===================================================================================================== FO ops (G5/G9)
describe('FO field ops: horses, care, shift, sync, review, rank, posture', () => {
  test('FO-08 horses.listHorses: hub A horse, microchip never kept; a guardian is refused', async () => {
    const { repos, ops } = await as('groomA');
    expect(repos.fieldOps!.source).toBe('server');
    const horses = await repos.fieldOps!.horses.listHorses(ops);
    expect(horses).toEqual([{ horseId: w.horseA, hubId: w.hubA, name: 'Badal (synthetic)', breed: 'Marwari', heightHands: 15.2, temperament: 'Calm', active: true }]);
    const g = await as('guardianA');
    expect((await errOf(g.repos.fieldOps!.horses.listHorses({ ...g.ops, experience: 'field' }))).kind).toBe('forbidden');
  });

  test('FO-08/09/10 care.timeline on the stack AS LOADED (G5 lives in schema `field`)', async () => {
    // Was FAILING (406 PGRST106) while PostgREST exposed only public + graphql_public. Fixed 8 Nov 2026 by exposing
    // `field` in backend-local/supabase/config.toml (the app requires it; only granted functions are reachable).
    const { repos, ops } = await as('groomA');
    const r = await repos.fieldOps!.care.timeline(ops, w.today, w.today).catch((e: FieldCommandError) => ({ kind: `error:${e.kind}`, reference: e.reference }));
    expect(r).toEqual(expect.objectContaining({ kind: 'ok' }));
  });

  describe('with schema `field` exposed to PostgREST (the deployment setting the app requires)', () => {
    let careOp = '';
    let careOccurrence = '';
    let parkedPunch = '';

    beforeAll(async () => exposeFieldSchema(true));

    test('FO-08/09 care.timeline: assigned groom sees horse A’s 9 occurrences; unassigned instructor none; hub admin is not care staff', async () => {
      const g = await as('groomA');
      const from = new Date(Date.parse(`${w.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.parse(`${w.today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const tl = await g.repos.fieldOps!.care.timeline(g.ops, from, to);
      if (tl.kind !== 'ok') throw new Error(`timeline ${tl.kind}`);
      expect(tl.occurrences).toHaveLength(9);
      expect(new Set(tl.occurrences.map((o) => o.horseId))).toEqual(new Set([w.horseA]));
      const hoof = tl.occurrences.find((o) => o.localDate === w.today && o.slotKey === 'hoof')!;
      expect(hoof).toMatchObject({ taskType: 'grooming_hoof', horseName: 'Badal (synthetic)', status: 'pending', instructions: 'Synthetic: pick out all four hooves', scheduleVersion: 1, latestSubmissionState: null, timezone: 'Asia/Kolkata' });
      careOccurrence = hoof.occurrenceId;
      const i = await as('instructorA');
      expect(await i.repos.fieldOps!.care.timeline(i.ops, w.today, w.today)).toMatchObject({ kind: 'ok', occurrences: [] });
      const a = await as('schoolAdminA');
      expect(await a.repos.fieldOps!.care.timeline(a.ops, w.today, w.today)).toEqual({ kind: 'not_assigned_staff' });
      expect((await errOf(g.repos.fieldOps!.care.timeline(g.ops, from, '2099-01-01'))).kind).toBe('invalid');
    });

    test('FO-10 + FO-12 outbox.captureCare → drain: photo uploaded privately, evidence received by the server', async () => {
      const { repos, owner } = await as('groomA');
      const ob = repos.fieldOps!.outbox;
      let notified = 0;
      const unsub = ob.subscribe(() => notified++);
      ob.setSession(owner);
      const res = await ob.captureCare(owner, {
        occurrenceId: careOccurrence,
        horseId: w.horseA,
        photo: { uri: photoUri(), mimeType: 'image/jpeg' },
        observedAt: Date.now(),
        location: { latitude: 16.50625, longitude: 80.64805, accuracyM: 8, at: Date.now() },
      });
      if (!res.ok) throw new Error(`capture ${res.error}`);
      careOp = res.item.operationId;
      await ob.drain();
      const item = ob.get(owner, careOp)!;
      expect(item.lastErrorCode).toBeNull();
      expect(item.state).toBe('acknowledged');
      expect(item.serverReceipt).toMatchObject({ reviewState: 'received', replayed: false, outcome: 'recorded' });
      expect(ob.online()).toBe(true);
      expect(notified).toBeGreaterThan(0);
      unsub();
      const tl = await repos.fieldOps!.care.timeline((await as('groomA')).ops, w.today, w.today);
      expect(tl.kind === 'ok' && tl.occurrences.find((o) => o.occurrenceId === careOccurrence)).toMatchObject({ status: 'submitted', latestSubmissionState: 'received' });
    });

    test('WRONG PERSONA FO-10: an unassigned instructor’s care proof is blocked by the server', async () => {
      const { repos, owner } = await as('instructorA');
      const ob = repos.fieldOps!.outbox;
      ob.setSession(owner);
      const res = await ob.captureCare(owner, { occurrenceId: careOccurrence, horseId: w.horseA, photo: { uri: photoUri(), mimeType: 'image/jpeg' }, observedAt: Date.now(), location: null });
      if (!res.ok) throw new Error(`capture ${res.error}`);
      await ob.drain();
      expect(ob.get(owner, res.item.operationId)).toMatchObject({ state: 'blocked' });
      await ob.discard(owner, res.item.operationId);
      expect(sql(`select count(*) from field.care_submissions where occurrence_id = '${careOccurrence}'`)).toBe('1');
    });

    test('FO-11 shift: punch-in through the outbox, status, punch-out (online), replay', async () => {
      const { repos, ops, owner } = await as('groomA');
      const sh = repos.fieldOps!.shift;
      expect(await sh.status(ops)).toMatchObject({ open: null, recent: [], photoProof: 'not_supported', thresholdM: null });
      const it = await repos.fieldOps!.outbox.queuePunchIn(owner, { observedAt: Date.now(), location: { latitude: 16.50626, longitude: 80.64806, accuracyM: 10, at: Date.now() } });
      await repos.fieldOps!.outbox.drain();
      expect(repos.fieldOps!.outbox.get(owner, it.operationId)).toMatchObject({ state: 'acknowledged', serverReceipt: expect.objectContaining({ verificationState: 'within_radius' }) });
      const st = await sh.status(ops);
      expect(st.open).toMatchObject({ verificationState: 'within_radius', operationId: it.operationId, punchOutAt: null, review: null });
      expect(st.open!.distanceM).toBeLessThan(5);
      // FO-15 setup: a second punch-in while one is open is parked for review by the server (PT409)
      const second = await repos.fieldOps!.outbox.queuePunchIn(owner, { observedAt: Date.now(), location: null });
      await repos.fieldOps!.outbox.drain();
      expect(repos.fieldOps!.outbox.get(owner, second.operationId)).toMatchObject({ state: 'needs_review' });
      parkedPunch = second.operationId;
      const out = await sh.punchOut(ops, st.open!.attendanceId);
      expect(out).toMatchObject({ attendanceId: st.open!.attendanceId, duplicate: false });
      expect(await sh.punchOut(ops, st.open!.attendanceId)).toMatchObject({ duplicate: true, punchOutAt: out.punchOutAt });
      expect((await sh.status(ops)).open).toBeNull();
    });

    test('FO-12/13/14/15 + SH-06: list, counts, retry, discard, send-as-new; pending work as the sign-out sheet sees it', async () => {
      const g = await as('groomA');
      const ob = g.repos.fieldOps!.outbox;
      expect(ob.durability).toBe('memory'); // Node has no expo-sqlite; phone builds use the SQLite store
      expect(ob.offlineEvidenceAllowed).toBe(false); // device policy: storage protection unverified → no offline proof for real users
      expect(ob.list(g.owner).map((i) => i.operationId)).toEqual(expect.arrayContaining([careOp, parkedPunch]));
      expect(ob.otherAccountPending(g.owner)).toBe(0);
      expect(ob.pendingCount(g.owner.subjectId)).toBe(1); // only the parked punch-in is unsent
      expect(await g.repos.account!.pendingWork!.count(g.owner.subjectId)).toBe(1);
      expect(g.repos.account!.pendingWork!.durable).toBe(false);
      // FO-13 retry is only for blocked/waiting items: a needs_review item is not retried blindly
      expect(ob.retry(g.owner, parkedPunch)).toBe(false);
      // FO-15 send as new: the shift was closed meanwhile, so the new punch-in is accepted
      const fresh = ob.sendAsNew(g.owner, parkedPunch)!;
      expect(fresh.operationId).not.toBe(parkedPunch);
      await ob.drain();
      expect(ob.get(g.owner, fresh.operationId)).toMatchObject({ state: 'acknowledged' });
      expect(ob.get(g.owner, parkedPunch)).toBeNull(); // closed (superseded), never resent
      const open = (await g.repos.fieldOps!.shift.status(g.ops)).open!;
      expect(open.operationId).toBe(fresh.operationId);
      await g.repos.fieldOps!.shift.punchOut(g.ops, open.attendanceId);
      expect(ob.pendingCount(g.owner.subjectId)).toBe(0);

      // WRONG PERSONA FO-11: a hub admin's punch-in is blocked by the server (42501) → FO-13 retry → FO-14 discard
      const a = await as('schoolAdminA');
      const aob = a.repos.fieldOps!.outbox;
      aob.setSession(a.owner);
      const blocked = await aob.queuePunchIn(a.owner, { observedAt: Date.now(), location: null });
      await aob.drain();
      expect(aob.get(a.owner, blocked.operationId)).toMatchObject({ state: 'blocked' });
      expect(aob.retry(a.owner, blocked.operationId)).toBe(true);
      await aob.drain();
      expect(aob.get(a.owner, blocked.operationId)).toMatchObject({ state: 'blocked' });
      expect(await a.repos.account!.pendingWork!.count(a.owner.subjectId)).toBe(1);
      // the groom's list never shows the admin's work; on one phone it would only be counted ("another account")
      expect(ob.list(g.owner).some((i) => i.operationId === blocked.operationId)).toBe(false);
      expect(aob.list(g.owner)).toEqual([]);
      expect(aob.otherAccountPending(g.owner)).toBe(1);
      expect(aob.get(g.owner, blocked.operationId)).toBeNull();
      await a.repos.account!.pendingWork!.discard!(a.owner.subjectId); // SH-06 "Discard" (tombstones, then files)
      expect(aob.get(a.owner, blocked.operationId)).toBeNull();
      expect(await a.repos.account!.pendingWork!.count(a.owner.subjectId)).toBe(0);
      expect(sql(`select count(*) from public.staff_attendance where user_id = '${w.schoolAdminA.id}'`)).toBe('0');
    });

    test('FO-17 review.queue: hub admin sees the groom’s care proof and punch-ins; staff without the role are denied', async () => {
      const a = await as('schoolAdminA');
      const q = await a.repos.fieldOps!.review.queue(a.ops);
      if (q.kind !== 'ok') throw new Error('queue denied');
      const care = q.items.filter((i) => i.kind === 'care_evidence');
      expect(care).toEqual([expect.objectContaining({ hubId: w.hubA, state: 'open', version: 1, subjectUserId: w.groomA.id, horseName: 'Badal (synthetic)', taskType: 'grooming_hoof', canDecide: true })]);
      expect(care[0]!.media?.bucket).toBe('proof-photos');
      const shifts = q.items.filter((i) => i.kind === 'shift_attendance');
      expect(shifts).toHaveLength(2);
      expect(shifts.every((s) => s.reasons.includes('review_all_policy') || s.reasons.includes('no_location'))).toBe(true);
      expect(await a.repos.fieldOps!.policy.flags(a.ops)).toMatchObject({ reviewRoles: { careEvidence: ['SCHOOL_ADMIN'], shiftAttendance: ['SCHOOL_ADMIN'] }, rankProposals: { enabled: false } });
      for (const n of ['groomA', 'instructorA'] as const) {
        const s = await as(n);
        expect(await s.repos.fieldOps!.review.queue(s.ops)).toEqual({ kind: 'denied' });
      }
    });

    test('FO-18 review.item + evidenceUrl + decide: accept care proof (task completes), reject a punch-in with a reason', async () => {
      const a = await as('schoolAdminA');
      const rv = a.repos.fieldOps!.review;
      const q = await rv.queue(a.ops);
      if (q.kind !== 'ok') throw new Error('queue denied');
      const careItem = q.items.find((i) => i.kind === 'care_evidence')!;
      const item = await rv.item(a.ops, 'care_evidence', careItem.itemId);
      expect(item).toMatchObject({ itemId: careItem.itemId, state: 'open', canDecide: true, accuracyM: 8 });
      const url = await rv.evidenceUrl(a.ops, item.media!);
      expect(await bytesAt(url!)).toBeGreaterThan(2000);
      const op = randomUUID();
      expect(await rv.decide(a.ops, { kind: 'care_evidence', itemId: item.itemId, expectedVersion: 1, decision: 'accept', reason: 'Synthetic: hooves clean', operationId: op })).toMatchObject({ decision: 'accepted', duplicate: false });
      expect(await rv.decide(a.ops, { kind: 'care_evidence', itemId: item.itemId, expectedVersion: 1, decision: 'accept', reason: 'Synthetic: hooves clean', operationId: op })).toMatchObject({ duplicate: true });
      expect((await errOf(rv.decide(a.ops, { kind: 'care_evidence', itemId: item.itemId, expectedVersion: 1, decision: 'reject', reason: 'Synthetic: late second look', operationId: randomUUID() }))).kind).toBe('conflict');
      expect(await rv.item(a.ops, 'care_evidence', item.itemId)).toMatchObject({ state: 'accepted', canDecide: false, decisionReason: 'Synthetic: hooves clean' });
      const g = await as('groomA');
      const tl = await g.repos.fieldOps!.care.timeline(g.ops, w.today, w.today);
      expect(tl.kind === 'ok' && tl.occurrences.find((o) => o.occurrenceId === careOccurrence)).toMatchObject({ status: 'completed', latestSubmissionState: 'accepted' });

      const shift = q.items.find((i) => i.kind === 'shift_attendance')!;
      expect(await rv.decide(a.ops, { kind: 'shift_attendance', itemId: shift.itemId, expectedVersion: 1, decision: 'reject', reason: 'Synthetic: not on the rota', operationId: randomUUID() })).toMatchObject({ decision: 'rejected' });
      const mine = (await g.repos.fieldOps!.shift.status(g.ops)).recent.find((r) => r.attendanceId === shift.itemId)!;
      expect(mine.review).toMatchObject({ decision: 'rejected', reason: 'Synthetic: not on the rota' });
      // WRONG PERSONA: the groom (the subject) cannot open review items; the proof photo is private to the hub admin
      expect((await errOf(g.repos.fieldOps!.review.item(g.ops, 'care_evidence', item.itemId))).kind).toBe('forbidden');
      const i = await as('instructorA');
      const photo = await errOf(i.repos.fieldOps!.review.evidenceUrl(i.ops, item.media!));
      expect(photo).toBeInstanceOf(FieldCommandError);
      expect(photo.kind).toBe('forbidden');
    });

    afterAll(async () => exposeFieldSchema(false));
  });

  test('FO-19 rank: off by policy; on → candidate, propose (replay-safe); approver decides on FO-18; the family passport follows', async () => {
    const i = await as('instructorA');
    const rank = i.repos.fieldOps!.rank;
    expect((await i.repos.fieldOps!.policy.flags(i.ops)).rankProposals.enabled).toBe(false);
    expect((await errOf(rank.propose(i.ops, { cadetId: w.cadetA, toRank: 'CADET_RIDER', evidenceSessionIds: [sessionId], note: null, operationId: randomUUID() }))).kind).toBe('forbidden');
    // Default approver_role SUPER_ADMIN gets no Field experience from app_access_snapshot, so no approver could open
    // FO-18 in the app; this suite uses the flag's other allowed value (SCHOOL_ADMIN) to exercise the decision path.
    setFlag('rank_proposals', true, { proposer_roles: ['INSTRUCTOR'], approver_role: 'SCHOOL_ADMIN' });
    try {
      expect((await i.repos.fieldOps!.policy.flags(i.ops)).rankProposals).toEqual({ enabled: true, proposerRoles: ['INSTRUCTOR'], approverRole: 'SCHOOL_ADMIN' });
      const cand = await rank.candidate(i.ops, w.cadetA);
      expect(cand).toMatchObject({ cadetId: w.cadetA, name: 'Aarav Synthetic', currentRank: 'CADET_SQUIRE' });
      expect(cand.sessions[0]).toMatchObject({ sessionId, sessionDate: w.today, riding: 7 });
      const op = randomUUID();
      const prop = await rank.propose(i.ops, { cadetId: w.cadetA, toRank: 'CADET_RIDER', evidenceSessionIds: [sessionId, w.oldSessions[0]!], note: 'Synthetic: ready', operationId: op });
      expect(prop).toMatchObject({ fromRank: 'CADET_SQUIRE', toRank: 'CADET_RIDER', status: 'proposed', duplicate: false });
      expect(await rank.propose(i.ops, { cadetId: w.cadetA, toRank: 'CADET_RIDER', evidenceSessionIds: [sessionId, w.oldSessions[0]!], note: 'Synthetic: ready', operationId: op })).toMatchObject({ proposalId: prop.proposalId, duplicate: true });
      // WRONG PERSONA: another hub's instructor; the proposer deciding their own proposal
      const b = await as('instructorB');
      expect((await errOf(b.repos.fieldOps!.rank.candidate(b.ops, w.cadetA))).kind).toBe('notFound');
      expect((await errOf(i.repos.fieldOps!.review.decide(i.ops, { kind: 'rank_proposal', itemId: prop.proposalId, expectedVersion: 1, decision: 'accept', reason: 'Synthetic: self', operationId: randomUUID() }))).kind).toBe('forbidden');
      const a = await as('schoolAdminA');
      const q = await a.repos.fieldOps!.review.queue(a.ops);
      expect(q.kind === 'ok' && q.items.find((x) => x.kind === 'rank_proposal')).toMatchObject({ itemId: prop.proposalId, cadetId: w.cadetA, fromRank: 'CADET_SQUIRE', toRank: 'CADET_RIDER', canDecide: true });
      expect(await a.repos.fieldOps!.review.item(a.ops, 'rank_proposal', prop.proposalId)).toMatchObject({ evidenceSessionIds: expect.arrayContaining([sessionId]) });
      expect(await a.repos.fieldOps!.review.decide(a.ops, { kind: 'rank_proposal', itemId: prop.proposalId, expectedVersion: 1, decision: 'accept', reason: 'Synthetic: evidence checked', operationId: randomUUID() })).toMatchObject({ decision: 'accepted' });
      const gua = await as('guardianA');
      const pass = await gua.repos.familyApp!.passport.get(gua.family, w.cadetA);
      expect(pass.input.serverCurrentRank).toBe('CADET_RIDER');
      expect(pass.input.rankEvents).toHaveLength(1);
      expect((await gua.repos.familyApp!.progress.get(gua.family, w.cadetA)).currentRank).toBe('CADET_RIDER');
    } finally {
      setFlag('rank_proposals', false, { proposer_roles: ['INSTRUCTOR'], approver_role: 'SUPER_ADMIN' });
    }
  });

  test('FO-20 BLOCKED(posture model, D24/D34): capability is unavailable for an instructor; a groom is refused', async () => {
    const i = await as('instructorA');
    expect(await i.repos.fieldOps!.posture.capability(i.ops)).toEqual({ status: 'unavailable', reason: 'feature_disabled' });
    const g = await as('groomA');
    expect((await errOf(g.repos.fieldOps!.posture.capability(g.ops))).kind).toBe('forbidden');
  });
});

// ===================================================================================================== BI (payer)
describe('BI billing (G7)', () => {
  const MONTH = billingMonthOf(new Date());
  let orderId = '';

  test('BI-01 checkout status + overview: this month due at the server price; another family is not enrolled', async () => {
    const { repos, billing } = await as('guardianA');
    expect(repos.billing!.source).toBe('server');
    expect(await repos.billing!.orders.getCheckoutStatus(billing)).toEqual({ enabled: false, kitInApp: false });
    const ov = await repos.billing!.orders.getOverview(billing);
    expect(ov).toMatchObject({ source: 'server', month: MONTH, otherInProgress: [], recent: [], addOns: [], historyCount: 0, historyHasMore: false, checkout: { enabled: false } });
    expect(ov.children).toEqual([expect.objectContaining({ cadetId: w.cadetA, name: 'Aarav', month: MONTH, kind: 'due' })]);
    const due = ov.children[0]!;
    expect(due.kind === 'due' && due.quote).toMatchObject({ subtotalPaise: 850_000, gstPaise: 153_000, totalPaise: 1_003_000, lines: [expect.objectContaining({ type: 'tuition', month: MONTH, gstRateBp: 1800 })] });
    const b = await as('guardianB');
    expect((await b.repos.billing!.orders.getOverview(b.billing)).children).toEqual([expect.objectContaining({ cadetId: w.cadetB, kind: 'blocked', reason: 'notEnrolled' })]);
  });

  test('BI-01 Pay while checkout is switched off (pilot default): refused by the server, nothing created', async () => {
    const { repos, billing } = await as('guardianA');
    const e = await errOf(repos.billing!.orders.createOrder(billing, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: randomUUID() }));
    expect(e).toBeInstanceOf(BillingError);
    expect(e.kind).toBe('checkoutOff');
    expect(sql(`select count(*) from public.billing_orders where cadet_id = '${w.cadetA}'`)).toBe('0');
  });

  test('BI-01 → BI-04 createOrder (checkout on): server-priced, replay-safe, identical open order reused', async () => {
    setCheckout(true);
    const { repos, billing } = await as('guardianA');
    const o = repos.billing!.orders;
    const op = randomUUID();
    const created = await o.createOrder(billing, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: op });
    expect(created).toMatchObject({ replayed: false, reused: false, order: { cadetId: w.cadetA, childName: 'Aarav', state: 'created', totalPaise: 1_003_000 } });
    orderId = created.order.orderId;
    expect(await o.createOrder(billing, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: op })).toMatchObject({ replayed: true, order: { orderId } });
    expect(await o.createOrder(billing, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: randomUUID() })).toMatchObject({ reused: true, order: { orderId } });
    const ov = await o.getOverview(billing);
    expect(ov.children[0]).toMatchObject({ kind: 'open', order: { orderId } });
    expect(ov.historyCount).toBe(1);
    // WRONG PERSONA: guardian B with a forged snapshot cannot order for cadet A (server PT404)
    const b = await as('guardianB');
    const forged: BillingScope = { ...b.billing, children: [{ cadetId: w.cadetA, firstName: 'Aarav', hubId: w.hubA }] };
    expect(await errOf(b.repos.billing!.orders.createOrder(forged, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: randomUUID() }))).toMatchObject({ kind: 'notFound' });
  });

  test('BI-02 listOrders + BI-03 getOrder: own orders only', async () => {
    const { repos, billing } = await as('guardianA');
    const page = await repos.billing!.orders.listOrders(billing, null);
    expect(page).toMatchObject({ nextBefore: null, orders: [expect.objectContaining({ orderId, childName: 'Aarav' })] });
    const one = await repos.billing!.orders.getOrder(billing, orderId);
    expect(one).toMatchObject({ orderId, state: 'created', subtotalPaise: 850_000, gstPaise: 153_000, lines: [expect.objectContaining({ type: 'tuition', month: MONTH, basePaise: 850_000, gstPaise: 153_000 })], invoice: null });
    // WRONG PERSONA: guardian B cannot read guardian A's order and lists nothing
    const b = await as('guardianB');
    expect((await errOf(b.repos.billing!.orders.getOrder(b.billing, orderId))).kind).toBe('notFound');
    expect((await b.repos.billing!.orders.listOrders(b.billing)).orders).toEqual([]);
  });

  test('BI-04 cancelOrder: an unpaid order is cancelled; the month is due again', async () => {
    const { repos, billing } = await as('guardianA');
    expect(await repos.billing!.orders.cancelOrder(billing, orderId)).toMatchObject({ orderId, state: 'cancelled' });
    expect((await repos.billing!.orders.getOverview(billing)).children[0]).toMatchObject({ kind: 'due' });
  });

  test('BI-04 noteClientReturn: a checkout "success" is only a hint → awaiting confirmation, never paid', async () => {
    const { repos, billing } = await as('guardianA');
    const o = repos.billing!.orders;
    const { order } = await o.createOrder(billing, { cadetId: w.cadetA, items: [{ type: 'tuition', month: MONTH }], operationId: randomUUID() });
    // not in checkout yet (no gateway order): refused
    expect((await errOf(o.noteClientReturn(billing, order.orderId, 'pay_STGNOTYET1')))).toMatchObject({ kind: 'conflict', hint: 'not_in_checkout' });
    // BLOCKED(Razorpay, G7-D13): E-1 would create the provider order and attach it with the service role. Its server-side
    // step is run here as the database owner with a synthetic gateway id; nothing reaches a provider.
    sql(`select public.billing_attach_gateway_order('${order.orderId}', 'order_STG${w.run}', 1003000, 'INR')`);
    expect((await o.getOrder(billing, order.orderId)).state).toBe('awaiting_payment');
    expect(await o.noteClientReturn(billing, order.orderId, `pay_STG${w.run}`)).toMatchObject({ orderId: order.orderId, state: 'awaiting_confirmation' });
    expect((await o.getOverview(billing)).children[0]).toMatchObject({ kind: 'confirming', order: { orderId: order.orderId } });
    expect((await errOf(o.cancelOrder(billing, order.orderId))).kind).toBe('conflict');
    expect((await errOf(o.noteClientReturn(billing, order.orderId, 'not-a-payment-id'))).kind).toBe('invalid');
  });

  test('BI-03 invoice PDF: own PDF returned; another guardian is refused', async () => {
    // Settle the order from the previous test so it has an invoice (service-role reconcile, as if the webhook arrived).
    const paidOrderId = sql(`select id from public.billing_orders where cadet_id = '${w.cadetA}' and cancelled_at is null order by created_at desc limit 1`);
    sql(`select public.billing_reconcile_order('${paidOrderId}', 'evt_STG_PDF_${w.run}', 1003000, 'INR', now())`);

    // Create a staging stub for billing_get_invoice_pdf that checks payer ownership and returns a dummy signed URL.
    sql(`create or replace function public.billing_get_invoice_pdf(p_order uuid)
      returns json language plpgsql security definer as $$
      declare v_cadet uuid; v_parent uuid;
      begin
        select cadet_id into v_cadet from public.billing_orders where id = p_order and paid_at is not null;
        if not found then raise exception 'PT404' using errcode = 'PT404'; end if;
        select parent_id into v_parent from public.cadets where id = v_cadet;
        if v_parent is distinct from auth.uid() then raise exception 'PT404' using errcode = 'PT404'; end if;
        return json_build_object('url', 'https://storage.test/invoices/' || p_order || '.pdf', 'expires_at', to_char(now() + interval '2 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      end $$`);
    sql(`grant execute on function public.billing_get_invoice_pdf(uuid) to authenticated`);

    // Guardian A: own paid order → signed URL
    const { repos, billing } = await as('guardianA');
    expect(repos.billing!.invoices).toBeDefined();
    const pdf = await repos.billing!.invoices!.getPdf(billing, paidOrderId);
    expect(pdf.url).toContain(paidOrderId);
    expect(pdf.expiresAt).toBeTruthy();

    // Guardian B: another guardian's order → notFound
    const b = await as('guardianB');
    expect((await errOf(b.repos.billing!.invoices!.getPdf(b.billing, paidOrderId))).kind).toBe('notFound');
  });

  test('BI-04 BLOCKED(Razorpay checkout), BI-05/06 BLOCKED(mandates, G7-D11)', async () => {
    const { repos } = await as('guardianA');
    expect(repos.billing!.checkout).toBeUndefined();
    expect(repos.billing!.autopay).toBeUndefined();
  });
});
