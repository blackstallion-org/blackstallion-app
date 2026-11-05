import { clearResume, rememberResume, resumablePath, takeResume } from '../resumeLink';

afterEach(clearResume);

describe('deep-link resume (SH-01 journey)', () => {
  it('accepts in-app screen paths only', () => {
    expect(resumablePath('/family/sessions/abc-123')).toBe('/family/sessions/abc-123');
    expect(resumablePath('/settings/notifications/')).toBe('/settings/notifications');
    for (const bad of ['/', '/sign-in', '/verify', 'https://evil.example/family', '/family/../settings', '/family?x=1', '//family', '/billing', null, undefined, '']) {
      expect(resumablePath(bad as string)).toBeNull();
    }
  });

  it('is single use and only resumes into the experience the person lands in', () => {
    rememberResume('/field/cadets/c1');
    expect(takeResume('family')).toBeNull();
    expect(takeResume('field')).toBeNull(); // already consumed by the first read
    rememberResume('/family/passport');
    expect(takeResume('family')).toBe('/family/passport');
    expect(takeResume('family')).toBeNull();
    rememberResume('/settings/help');
    expect(takeResume('field')).toBe('/settings/help');
  });

  it('ignores paths it cannot resume without dropping a valid one already remembered', () => {
    rememberResume('/family/horse');
    rememberResume('/sign-in');
    expect(takeResume('family')).toBe('/family/horse');
  });
});
