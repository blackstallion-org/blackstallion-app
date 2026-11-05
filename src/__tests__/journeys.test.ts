/**
 * Spec §9 journey 2, end to end across both experiences on ONE reference model (the TypeScript mirror of the merged
 * delta + G9 used by the development fixtures): instructor scan → duplicate-safe check-in → consent check → publish
 * (replayed) → guardian reads exactly the acknowledged record; a correction is visible with its reason; another child's
 * record and another guardian's scope are refused. JS-level only: no device, no hosted database.
 */
import { createFieldReferenceModel, createModelClient, SYN_HUB_1, synCadetId } from '@/dev/fixtures/fieldApp';
import { createFamilyAppServer } from '@/features/family/data/server';
import type { FamilyScope } from '@/features/family/types';
import { createFieldAppServer } from '@/features/field/data/server';
import type { FieldScope } from '@/features/field/types';

const NOW = Date.parse('2026-11-05T06:00:00Z'); // 11:30 IST
const op = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const RAVI: FieldScope = { subjectId: 'syn-instructor', experience: 'field', hubId: SYN_HUB_1, role: 'INSTRUCTOR' };
const aditi = synCadetId(4);
const kabir = synCadetId(1);
const RISING_TROT = '5c000000-0000-4000-8000-000000000001';

function world() {
  const model = createFieldReferenceModel({ now: () => NOW });
  // Aditi belongs to the sample guardian (cadets.parent_id: one guardian per child, D29)
  model.tables.cadets.find((c) => c.id === aditi)!.parent_id = 'syn-guardian-a';
  const field = createFieldAppServer(createModelClient(model, 'syn-instructor').client, { localNow: () => NOW, timeoutMs: 500 });
  // the family server only needs reads here; the model client serves the same tables under the mirrored RLS
  const family = createFamilyAppServer(createModelClient(model, 'syn-guardian-a').client as never);
  const guardian: FamilyScope = { subjectId: 'syn-guardian-a', experience: 'family', children: [{ cadetId: aditi, firstName: 'Aditi', hubId: SYN_HUB_1 }] };
  return { model, field, family, guardian };
}

describe('Journey 2: scan → check-in → publish → guardian sees the exact record', () => {
  it('records attendance once, publishes once, and the guardian reads exactly what was acknowledged', async () => {
    const { model, field, family, guardian } = world();
    const cmd = field.commands(RAVI);

    const first = await cmd.checkIn({ passportCode: 'BSAH-26-SYN00004', observedAt: new Date(NOW), operationId: op(1) });
    expect(first).toMatchObject({ cadetId: aditi, duplicate: false });
    // lost reply → the same request again returns the same answer (our own replay is not "already checked in")
    expect(await cmd.checkIn({ passportCode: 'BSAH-26-SYN00004', observedAt: new Date(NOW), operationId: op(1) })).toEqual(first);
    // a second scan the same day (new id) is "already checked in" with the original check-in
    expect(await cmd.checkIn({ passportCode: 'BSAH-26-SYN00004', observedAt: new Date(NOW + 60_000), operationId: op(2) })).toMatchObject({ checkInId: first.checkInId, duplicate: true });
    expect(model.tables.cadet_check_ins.filter((r) => r.cadet_id === aditi)).toHaveLength(1);

    // consent gate: no training-video consent for this cadet → recording stays off, scores still publish
    expect((await field.consent.forCadet(RAVI, aditi)).sessionVideo).toBe('off');

    const assessment = { riding: 7, ground: 6, stable: 8, notes: 'Steady seat on the long side.', skillIds: [RISING_TROT] };
    const pub = await cmd.publish({ checkInOperationId: first.checkInOperationId, assessment, operationId: op(3) });
    expect(pub.duplicate).toBe(false);
    expect(await cmd.publish({ checkInOperationId: first.checkInOperationId, assessment, operationId: op(3) })).toMatchObject({ sessionId: pub.sessionId, duplicate: true });
    expect(model.tables.training_sessions.filter((s) => s.check_in_id === first.checkInId)).toHaveLength(1);

    const seen = await family.sessions.get(guardian, pub.sessionId);
    expect(seen).toMatchObject({ id: pub.sessionId, childId: aditi, scores: { riding: 7, ground: 6, stable: 8 }, notes: 'Steady seat on the long side.', version: 1, corrections: [] });
    expect(seen.skills.map((k) => k.name)).toEqual(['Rising trot (sample)']);

    // a correction keeps the original and the family sees the reason
    await cmd.correct({ sessionId: pub.sessionId, expectedVersion: 1, scores: { riding: 7, ground: 7, stable: 8 }, notes: 'Steady seat on the long side.', reason: 'Ground score entered wrong', operationId: op(4) });
    const corrected = await family.sessions.get(guardian, pub.sessionId);
    expect(corrected).toMatchObject({ version: 2, scores: { ground: 7 } });
    expect(corrected.corrections[0]?.reason).toBe('Ground score entered wrong');
    expect(model.tables.training_session_corrections.find((c) => c.session_id === pub.sessionId)).toBeTruthy();
  });

  it('journey 9: the guardian cannot open another child’s record, and a scope without the child is refused before any read', async () => {
    const { model, family, guardian } = world();
    const kabirSession = model.tables.training_sessions.find((s) => s.cadet_id === kabir && s.brass_stamp_verified === true)!;
    await expect(family.sessions.get(guardian, String(kabirSession.id))).rejects.toBeTruthy();
    // even claiming the child in the scope does not help: the server's row policies return nothing for this guardian
    await expect(family.sessions.get({ ...guardian, children: [{ cadetId: kabir, firstName: 'Kabir', hubId: SYN_HUB_1 }] }, String(kabirSession.id))).rejects.toBeTruthy();
  });
});
