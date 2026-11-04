import {
  canSwitchExperience,
  contextKeyOf,
  resolveAccess,
  switchExperience,
  type AccessSnapshot,
} from '../domain/access';

const auth = (allowed: unknown[], subjectId = 's1'): AccessSnapshot =>
  ({ kind: 'authorized', subjectId, displayName: 'X', allowedExperiences: allowed, source: 'server' }) as AccessSnapshot;

test('signed out and unavailable map directly', () => {
  expect(resolveAccess({ kind: 'signedOut' })).toEqual({ phase: 'signedOut' });
  expect(resolveAccess({ kind: 'unavailable', reason: 'disabled' })).toEqual({ phase: 'unavailable', reason: 'disabled' });
});

test('authorized with no known experience is unavailable, never a default experience', () => {
  expect(resolveAccess(auth([]))).toEqual({ phase: 'unavailable', reason: 'noExperience' });
  expect(resolveAccess(auth(['admin', 'superuser']))).toEqual({ phase: 'unavailable', reason: 'noExperience' });
});

test('unknown experiences from the adapter are dropped', () => {
  const s = resolveAccess(auth(['field', 'admin']));
  expect(s.phase === 'authorized' && s.session.allowedExperiences).toEqual(['field']);
});

test('last choice is honoured only for the same subject and if still allowed', () => {
  const both = auth(['family', 'field']);
  const a = resolveAccess(both, { subjectId: 's1', experience: 'field' });
  expect(a.phase === 'authorized' && a.experience).toBe('field');
  const otherSubject = resolveAccess(both, { subjectId: 's2', experience: 'field' });
  expect(otherSubject.phase === 'authorized' && otherSubject.experience).toBe('family');
  const revoked = resolveAccess(auth(['family']), { subjectId: 's1', experience: 'field' });
  expect(revoked.phase === 'authorized' && revoked.experience).toBe('family');
});

test('switching never grants: a disallowed target is refused and the allowed set is unchanged', () => {
  const familyOnly = resolveAccess(auth(['family']));
  expect(canSwitchExperience(familyOnly)).toBe(false);
  const after = switchExperience(familyOnly, 'field');
  expect(after).toBe(familyOnly);
  const dual = resolveAccess(auth(['family', 'field']));
  const switched = switchExperience(dual, 'field');
  expect(switched.phase === 'authorized' && switched.experience).toBe('field');
  expect(switched.phase === 'authorized' && switched.session.allowedExperiences).toEqual(['family', 'field']);
});

test('context key combines subject and experience', () => {
  const dual = resolveAccess(auth(['family', 'field'], 'abc'));
  expect(contextKeyOf(dual)).toBe('abc:family');
  expect(contextKeyOf(switchExperience(dual, 'field'))).toBe('abc:field');
  expect(contextKeyOf({ phase: 'signedOut' })).toBeNull();
});

test('field context key includes the hub, so a hub move cannot reuse cached data', () => {
  const at = (hubId: string | null) =>
    resolveAccess({
      kind: 'authorized',
      subjectId: 'staff1',
      displayName: 'S',
      allowedExperiences: ['field'],
      source: 'server',
      scope: { role: 'INSTRUCTOR', hubId },
    });
  expect(contextKeyOf(at('hubA'))).toBe('staff1:field:hub=hubA');
  expect(contextKeyOf(at('hubB'))).not.toBe(contextKeyOf(at('hubA')));
  expect(contextKeyOf(at(null))).toBe('staff1:field:hub=none');
});
