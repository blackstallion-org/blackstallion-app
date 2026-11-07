/**
 * @jest-environment node
 *
 * VERTICAL SLICE on the staging stack (real Supabase Auth, PostgREST under RLS, Storage), through the APP'S OWN code:
 * the access adapter that the phone uses to build its scope, and createServerRepositories() — the same repositories
 * the screens call. Nothing here is mocked except the clip bytes.
 *
 * Instructor signs in → sees own hub's cadets → guardian grants session-video consent → instructor scans passport
 * (check-in) → grades → uploads a 10 s clip → publishes → guardian signs in → sees the session, the grade and plays
 * the clip through a short-lived signed URL. Plus: replay safety, cross-family and cross-hub denial, correction.
 *
 * Run: npm run test:staging  (needs the stack: backend-local/ `supabase start …` + load_staging.sh)
 */
import { randomUUID } from 'node:crypto';

import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';
import type { FamilyScope } from '@/features/family/types';
import type { FieldScope } from '@/features/field/types';
import { createServerRepositories } from '@/shell/serverRepositories';

import { placeObject } from './seedScreens';
import { appClient, clipUri, seedWorld, signIn, sql, type Account, type World } from './stack';

jest.setTimeout(60_000);

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

/** Sign in like the phone: publishable-key client → access adapter → server snapshot → scope. */
async function session(a: Account) {
  const client = await signIn(a, appClient());
  const snap = (await createSupabaseAccessAdapter(client).load()) as {
    kind: string;
    subjectId: string;
    allowedExperiences: string[];
    scope: { role?: string; hubId: string | null; children: { cadetId: string; firstName: string; hubId: string | null }[] };
  };
  const repos = createServerRepositories(client as never);
  const field: FieldScope = { subjectId: snap.subjectId, experience: 'field', hubId: snap.scope?.hubId, role: snap.scope?.role };
  const family: FamilyScope = { subjectId: snap.subjectId, experience: 'family', children: snap.scope?.children ?? [] };
  return { client, snap, repos, field, family };
}

const grade = { riding: 8, ground: 7, stable: 9, notes: 'Synthetic: steady rising trot, good tack check.' };

describe('instructor → guardian vertical slice (staging)', () => {
  let sessionId = '';
  let checkInOperationId = '';
  let objectPath = '';
  let publishOp = '';

  test('access: each person gets exactly their experience and scope from the server', async () => {
    const ins = await session(w.instructorA);
    expect(ins.snap.kind).toBe('authorized');
    expect(ins.snap.allowedExperiences).toEqual(['field']);
    expect(ins.snap.scope.hubId).toBe(w.hubA);
    const gua = await session(w.guardianA);
    expect(gua.snap.allowedExperiences).toEqual(['family']);
    expect(gua.snap.scope.children.map((c) => c.cadetId)).toEqual([w.cadetA]);
  });

  test('instructor A sees hub A cadets only', async () => {
    const { repos, field } = await session(w.instructorA);
    const list = await repos.fieldApp!.cadets.list(field);
    expect(list.source).toBe('server');
    const ids = list.cadets.map((c) => c.id);
    expect(ids).toContain(w.cadetA);
    expect(ids).not.toContain(w.cadetB);
  });

  test('guardian A grants session-video consent through the consent centre', async () => {
    const { repos, family } = await session(w.guardianA);
    const centre = await repos.familyApp!.consent.centre(family);
    const child = centre.children.find((c) => c.childId === w.cadetA)!;
    const video = child.consents.find((c) => c.purpose === 'session_video')!;
    expect(video).toBeDefined();
    const r = await repos.familyApp!.consent.set(family, { childId: w.cadetA, purpose: 'session_video', granted: true, policyVersion: video.currentPolicyVersion, operationId: randomUUID() });
    expect(r.granted).toBe(true);
    const ins = await session(w.instructorA);
    expect((await ins.repos.fieldApp!.consent.forCadet(ins.field, w.cadetA)).sessionVideo).toBe('allowed');
  });

  test('instructor A: scan passport → check-in → upload clip → publish', async () => {
    const { repos, field } = await session(w.instructorA);
    const cmd = repos.fieldApp!.commands(field);
    const ci = await cmd.checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() });
    expect(ci.cadetId).toBe(w.cadetA);
    checkInOperationId = ci.checkInOperationId;
    const up = await cmd.uploadClip!({ hubId: w.hubA, cadetId: w.cadetA, clipId: randomUUID(), uri: clipUri(), mimeType: 'video/mp4' });
    objectPath = up.objectPath;
    expect(objectPath.startsWith(`${w.hubA}/${w.cadetA}/`)).toBe(true);
    publishOp = randomUUID();
    const pub = await cmd.publish({ checkInOperationId, operationId: publishOp, videoObject: objectPath, assessment: { ...grade, skillIds: w.skills.slice(0, 2) } });
    expect(pub.duplicate).toBe(false);
    expect(pub.version).toBe(1);
    sessionId = pub.sessionId;
  });

  test('replay safety: the same publish again returns the same session, no second row', async () => {
    const { repos, field } = await session(w.instructorA);
    const again = await repos.fieldApp!.commands(field).publish({ checkInOperationId, operationId: publishOp, videoObject: objectPath, assessment: { ...grade, skillIds: w.skills.slice(0, 2) } });
    expect(again.sessionId).toBe(sessionId);
    expect(again.duplicate).toBe(true);
    expect(sql(`select count(*) from public.training_sessions where cadet_id = '${w.cadetA}'`)).toBe('1');
  });

  test('guardian A sees the real session, grade, skills and plays the clip', async () => {
    const { repos, family } = await session(w.guardianA);
    const progress = await repos.familyApp!.progress.get(family, w.cadetA);
    expect(progress.source).toBe('server');
    expect(progress.sessions.map((s) => s.id)).toContain(sessionId);
    const detail = await repos.familyApp!.sessions.get(family, sessionId);
    expect(detail.scores).toEqual({ riding: 8, ground: 7, stable: 9 });
    expect(detail.skills.map((s) => s.id).sort()).toEqual(w.skills.slice(0, 2).sort());
    expect(detail.notes).toBe(grade.notes);
    const clips = await repos.familyApp!.progress.clips(family, w.cadetA);
    const entry = clips.clips.find((c) => c.clip.sessionId === sessionId)!;
    expect(entry.clip.objectPath).toBe(objectPath);
    const signed = await repos.familyApp!.media.clipUrl(family, entry.clip);
    expect(signed.expiresAt).toBeGreaterThan(Date.now());
    const bytes = await (await fetch(signed.uri)).arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(4000);
  });

  test('family home shows the latest session for the child', async () => {
    const { repos, family } = await session(w.guardianA);
    const home = await repos.familyHome!.getHome(family, w.cadetA);
    expect(home.source).toBe('server');
    expect(home.selectedChildId).toBe(w.cadetA);
    expect(home.latestAssessment?.sessionId).toBe(sessionId);
    expect([home.latestAssessment?.riding, home.latestAssessment?.ground, home.latestAssessment?.stable]).toEqual([8, 7, 9]);
  });

  test('guardian B (other family) cannot see the session or the clip', async () => {
    const gb = await session(w.guardianB);
    expect((await gb.client.from('training_sessions').select('id').eq('id', sessionId)).data).toEqual([]);
    const dl = await gb.client.storage.from('session-videos').download(objectPath);
    expect(dl.error).not.toBeNull();
    const signed = await gb.client.storage.from('session-videos').createSignedUrl(objectPath, 60);
    expect(signed.data?.signedUrl ?? null).toBeNull();
  });

  test('instructor B (other hub) cannot check in a hub A cadet or upload into hub A', async () => {
    const { repos, field } = await session(w.instructorB);
    const cmd = repos.fieldApp!.commands(field);
    await expect(cmd.checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() })).rejects.toBeTruthy();
    await expect(cmd.uploadClip!({ hubId: w.hubA, cadetId: w.cadetA, clipId: randomUUID(), uri: clipUri(), mimeType: 'video/mp4' })).rejects.toBeTruthy();
    expect(sql(`select count(*) from storage.objects where bucket_id='session-videos' and name like '${w.hubA}/%'`)).toBe('1');
  });

  test('a guardian cannot write sessions directly (writes go through server functions only)', async () => {
    const { client } = await session(w.guardianA);
    const r = await client.from('training_sessions').insert({ cadet_id: w.cadetA, instructor_id: w.instructorA.id, riding_score: 10 });
    expect(r.error).not.toBeNull();
    const u = await client.from('training_sessions').update({ riding_score: 10 }).eq('id', sessionId).select('id');
    expect(u.data ?? []).toEqual([]);
    expect(sql(`select riding_score from public.training_sessions where id='${sessionId}'`)).toBe('8');
  });

  test('correction: instructor corrects with a reason; guardian sees version 2 and the notice', async () => {
    const ins = await session(w.instructorA);
    const res = await ins.repos.fieldApp!.commands(ins.field).correct({
      sessionId,
      expectedVersion: 1,
      scores: { riding: 7, ground: 7, stable: 9 },
      notes: grade.notes,
      reason: 'Synthetic: riding score entered one point high',
      operationId: randomUUID(),
    });
    expect(res.version).toBe(2);
    const gua = await session(w.guardianA);
    const detail = await gua.repos.familyApp!.sessions.get(gua.family, sessionId);
    expect(detail.version).toBe(2);
    expect(detail.scores.riding).toBe(7);
    expect(detail.corrections.length).toBe(1);
  });

  test('PRIVACY: no clip without session-video consent — the server refuses, not just the app', async () => {
    // Guardian B never granted session_video. Instructor B (cadet B's hub) checks cadet B in.
    const { repos, client, field } = await session(w.instructorB);
    const cmd = repos.fieldApp!.commands(field);
    const ci = await cmd.checkIn({ passportCode: w.passportB, observedAt: new Date(), operationId: randomUUID() });
    const bytes = Buffer.from(clipUri().split(',')[1]!, 'base64');
    // 1. Storage refuses the upload by policy (G10 restrictive INSERT), not for some other reason.
    const path = `${w.hubB}/${w.cadetB}/${randomUUID()}.mp4`;
    const up = await client.storage.from('session-videos').upload(path, bytes, { contentType: 'video/mp4' });
    expect(String((up.error as { message?: string } | null)?.message ?? '')).toMatch(/row-level security/i);
    // 2. Even if a clip object exists (placed by a trusted path), publishing it is refused by the G10 trigger: PT403.
    const placed = `${w.hubB}/${w.cadetB}/${randomUUID()}.mp4`;
    await placeObject('session-videos', placed, bytes, 'video/mp4');
    const err = await cmd
      .publish({ checkInOperationId: ci.checkInOperationId, operationId: randomUUID(), videoObject: placed, assessment: { ...grade, skillIds: null } })
      .then(() => null, (e: { reference?: string; messageKey?: string }) => e);
    expect(err?.reference).toBe('PT403');
    expect(err?.messageKey).toBe('errors.known.noVideoConsent');
    // 3. Scores without a clip still publish (J25: "Recording is off", scores still publish).
    const pub = await cmd.publish({ checkInOperationId: ci.checkInOperationId, operationId: randomUUID(), videoObject: null, assessment: { ...grade, skillIds: null } });
    expect(pub.version).toBe(1);
    expect(sql(`select coalesce(video_log_s3_url,'none') from public.training_sessions where id='${pub.sessionId}'`)).toBe('none');
  });

  test('PRIVACY: a session with a clip cannot be moved to another child (trigger guards cadet_id too)', () => {
    expect(() => sql(`update public.training_sessions set cadet_id = '${w.cadetB}' where id = '${sessionId}'`)).toThrow(/does not belong to this cadet|consent/);
    expect(sql(`select cadet_id from public.training_sessions where id = '${sessionId}'`)).toBe(w.cadetA);
  });

  test('signed-out client gets nothing', async () => {
    const anon = appClient();
    expect((await anon.from('training_sessions').select('id')).data ?? []).toEqual([]);
    expect((await anon.from('cadets').select('id')).data ?? []).toEqual([]);
  });
});
