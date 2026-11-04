import { createFixtureRepositories } from '../fixtures';

const repos = createFixtureRepositories({ latencyMs: 0 });

test('family fixtures refuse a field scope and unknown subjects', async () => {
  await expect(repos.familyHome.getHome({ subjectId: 'syn-guardian-a', experience: 'field' as never })).rejects.toThrow();
  await expect(repos.familyHome.getHome({ subjectId: 'syn-instructor', experience: 'family' })).rejects.toThrow();
});

test('field fixtures refuse a family scope and family-only subjects', async () => {
  await expect(repos.fieldToday.getToday({ subjectId: 'syn-instructor', experience: 'family' as never })).rejects.toThrow();
  await expect(repos.fieldToday.getToday({ subjectId: 'syn-guardian-a', experience: 'field' })).rejects.toThrow();
});

test("a child not linked to the guardian is never served (falls back to the guardian's own child)", async () => {
  const home = await repos.familyHome.getHome({ subjectId: 'syn-guardian-a', experience: 'family' }, 'syn-cadet-d1');
  expect(home.selectedChildId).toBe('syn-cadet-a1');
  expect(JSON.stringify(home)).not.toContain('Isha');
});

test('dual-role family data contains no staff data and vice versa', async () => {
  const family = JSON.stringify(await repos.familyHome.getHome({ subjectId: 'syn-dual', experience: 'family' }));
  const field = JSON.stringify(await repos.fieldToday.getToday({ subjectId: 'syn-dual', experience: 'field' }));
  expect(family).not.toContain('Tara');
  expect(family).not.toContain('Riding C · 5');
  expect(field).not.toContain('Isha');
});

test('returned data is a copy: mutating it cannot leak into later reads', async () => {
  const a = await repos.fieldToday.getToday({ subjectId: 'syn-instructor', experience: 'field' });
  a.cadets.push({ id: 'x', name: 'Injected', group: 'X' });
  const b = await repos.fieldToday.getToday({ subjectId: 'syn-instructor', experience: 'field' });
  expect(JSON.stringify(b)).not.toContain('Injected');
});
