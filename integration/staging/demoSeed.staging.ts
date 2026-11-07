/**
 * @jest-environment node
 *
 * Demo data for looking at the app against the staging stack (web preview now, a development build later).
 * Skipped unless STAGING_DEMO=1. Creates a fresh synthetic world, runs the real instructor flow through the app's
 * repositories (consent → check-in → clip → publish), and writes the synthetic sign-ins to
 * backend-local/.staging-demo-users.json (gitignored; local stack only; never real people).
 *
 *   STAGING_DEMO=1 PSQL=psql npx jest -c jest.staging.config.js integration/staging/demoSeed.staging.ts
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createSupabaseAccessAdapter } from '@/core/auth/supabase/supabaseAccessAdapter';
import type { FamilyScope } from '@/features/family/types';
import type { FieldScope } from '@/features/field/types';
import { createServerRepositories } from '@/shell/serverRepositories';

import { appClient, clipUri, seedWorld, signIn, type Account } from './stack';

const run = process.env.STAGING_DEMO === '1' ? test : test.skip;
jest.setTimeout(120_000);

async function scopes(a: Account) {
  const client = await signIn(a, appClient());
  const snap = (await createSupabaseAccessAdapter(client).load()) as { subjectId: string; scope: { hubId: string | null; role?: string; children: { cadetId: string; firstName: string; hubId: string | null }[] } };
  const field: FieldScope = { subjectId: snap.subjectId, experience: 'field', hubId: snap.scope.hubId, role: snap.scope.role };
  const family: FamilyScope = { subjectId: snap.subjectId, experience: 'family', children: snap.scope.children };
  return { repos: createServerRepositories(client as never), field, family };
}

run('seed a demo world with two published sessions and a clip', async () => {
  const w = await seedWorld();
  const g = await scopes(w.guardianA);
  const centre = await g.repos.familyApp!.consent.centre(g.family);
  const video = centre.children[0]!.consents.find((c) => c.purpose === 'session_video')!;
  await g.repos.familyApp!.consent.set(g.family, { childId: w.cadetA, purpose: 'session_video', granted: true, policyVersion: video.currentPolicyVersion, operationId: randomUUID() });

  const i = await scopes(w.instructorA);
  const cmd = i.repos.fieldApp!.commands(i.field);
  const ci = await cmd.checkIn({ passportCode: w.passportA, observedAt: new Date(), operationId: randomUUID() });
  const up = await cmd.uploadClip!({ hubId: w.hubA, cadetId: w.cadetA, clipId: randomUUID(), uri: clipUri(), mimeType: 'video/mp4' });
  const pub = await cmd.publish({
    checkInOperationId: ci.checkInOperationId,
    operationId: randomUUID(),
    videoObject: up.objectPath,
    assessment: { riding: 8, ground: 7, stable: 9, notes: 'Synthetic: steady rising trot; calm at the mounting block.', skillIds: w.skills.slice(0, 2) },
  });

  const out = path.resolve(__dirname, '../../../backend-local/.staging-demo-users.json');
  const pick = (a: Account) => ({ email: a.email, password: a.password });
  writeFileSync(out, JSON.stringify({ note: 'Synthetic staging accounts (local stack only).', sessionId: pub.sessionId, guardianA: pick(w.guardianA), instructorA: pick(w.instructorA), groomA: pick(w.groomA), guardianB: pick(w.guardianB) }, null, 2));
  expect(pub.version).toBe(1);
});
