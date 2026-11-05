import { readAccountConfig, validHttpsUrl } from '../config';
import { confirmationMatches, isOpenRequest, parseDeletionRequest, requestReference } from '../domain/deletion';
import { buildDiagnosticText, looksPersonal, newDiagnosticId, sanitizeReference } from '../domain/diagnostics';
import { applyAck, groupCategories, parseCategoryRow, parsePreferenceAck } from '../domain/notifications';
import { initialsOf, joinNames, roleKeyFromServer } from '../domain/profile';
import { blocksUse, compareVersions, evaluateUpdate, parseVersion } from '../domain/version';

describe('SH-12 version gate', () => {
  test('parses and compares versions, ignoring pre-release suffixes', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v0.10')).toEqual([0, 10]);
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseVersion('banana')).toBeNull();
    expect(compareVersions([0, 9, 9], [0, 10])).toBe(-1);
    expect(compareVersions([1, 2], [1, 2, 0])).toBe(0);
  });
  test('blocks only a build below a readable minimum; anything unreadable fails open', () => {
    expect(evaluateUpdate('0.1.0', { minimumVersion: '0.2.0', source: 'server' })).toEqual({ kind: 'required', installed: '0.1.0', minimum: '0.2.0' });
    expect(evaluateUpdate('0.2.0', { minimumVersion: '0.2.0', source: 'server' }).kind).toBe('supported');
    expect(evaluateUpdate('0.1.0', null)).toEqual({ kind: 'unknown', reason: 'noPolicy' });
    expect(evaluateUpdate('0.1.0', { minimumVersion: 'x', source: 'server' })).toEqual({ kind: 'unknown', reason: 'unreadable' });
    expect(evaluateUpdate(null, { minimumVersion: '0.2.0', source: 'server' })).toEqual({ kind: 'unknown', reason: 'badVersion' });
    expect(blocksUse(evaluateUpdate('0.1.0', { minimumVersion: null, source: 'server' }))).toBe(false);
  });
});

describe('SH-09 diagnostics', () => {
  test('IDs are readable, random and carry no identity', () => {
    const id = newDiagnosticId();
    expect(id).toMatch(/^BSAH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newDiagnosticId(() => new Uint8Array(8).fill(1))).toBe('BSAH-1111-1111');
  });
  test('error references keep only short codes; personal data never passes', () => {
    expect(sanitizeReference('pt404')).toBe('PT404');
    expect(sanitizeReference('FIXTURE-500-0001')).toBe('FIXTURE-500-0001');
    for (const bad of ['priya@example.com', 'BSAH-26-F3A00001', '9876543210', '6b1f6c0e-3f0a-4d5e-9a1b-2c3d4e5f6a7b', 'a b', '', null, 42]) {
      expect(sanitizeReference(bad)).toBeNull();
    }
  });
  test('the copyable text contains no names, contacts, ids, codes, tokens or coordinates — even from hostile inputs', () => {
    const text = buildDiagnosticText({
      diagnosticId: 'BSAH-7K3F-Q2MX',
      appVersion: 'priya@example.com',
      build: 'release',
      platform: 'ios',
      osVersion: '17.4 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0',
      adapter: 'supabase 98765 43210',
      reference: 'BSAH-26-F3A00001',
      at: new Date('2026-11-05T10:31:45.123Z'),
    });
    expect(looksPersonal(text)).toBe(false);
    expect(text).toContain('Diagnostic ID: BSAH-7K3F-Q2MX');
    expect(text).toContain('Time (UTC): 2026-11-05T10:31Z');
    expect(text).not.toMatch(/priya|eyJ|98765|F3A0/);
    expect(text).not.toContain('Reference:');
  });
});

describe('SH-10 deletion request', () => {
  const R = { request_id: 'aa11bb22-0000-4000-8000-000000000000', status: 'requested', reason: null, requested_at: '2026-11-05T05:00:00+00:00', status_changed_at: '2026-11-05T05:00:00+00:00', status_note: null, version: 1, can_cancel: true };
  test('parses the server object and refuses unknown shapes', () => {
    const r = parseDeletionRequest(R);
    expect(r).toMatchObject({ requestId: R.request_id, status: 'requested', canCancel: true, version: 1 });
    expect(isOpenRequest(r)).toBe(true);
    expect(isOpenRequest({ ...r, status: 'cancelled' })).toBe(false);
    expect(() => parseDeletionRequest({ ...R, status: 'deleted' })).toThrow();
    expect(() => parseDeletionRequest({ ...R, can_cancel: 'yes' })).toThrow();
    expect(requestReference(R.request_id)).toBe('AA11BB22');
  });
  test('typed confirmation is deliberate but forgiving about case and spaces', () => {
    expect(confirmationMatches(' delete ')).toBe(true);
    expect(confirmationMatches('DELET')).toBe(false);
    expect(confirmationMatches('')).toBe(false);
  });
});

describe('SH-08 notification categories', () => {
  const row = { category: 'check_in', title: 'Arrival check-in', audience: 'family', enabled: true, is_default: true, updated_at: null };
  test('rows parse strictly; acknowledgements replace only their category', () => {
    const rows = [parseCategoryRow(row), parseCategoryRow({ ...row, category: 'care_reminders', audience: 'field' })];
    expect(() => parseCategoryRow({ ...row, audience: 'admin' })).toThrow();
    expect(() => parseCategoryRow({ ...row, category: 'DROP TABLE' })).toThrow();
    const ack = parsePreferenceAck({ category: 'check_in', enabled: false, updated_at: '2026-11-05T05:00:00Z', duplicate: true });
    expect(ack.duplicate).toBe(true);
    const next = applyAck(rows, ack);
    expect(next[0]).toMatchObject({ enabled: false, isDefault: false });
    expect(next[1]).toBe(rows[1]);
    expect(groupCategories(next).map((g) => g.audience)).toEqual(['family', 'field']);
  });
});

describe('SH-04 profile display', () => {
  test('roles map for display only; unknown roles show nothing', () => {
    expect(roleKeyFromServer('SCHOOL_ADMIN')).toBe('hubAdmin');
    expect(roleKeyFromServer('PARENT')).toBe('guardian');
    expect(roleKeyFromServer('ROOT')).toBeNull();
  });
  test('initials never leak an e-mail fragment', () => {
    expect(initialsOf('Anil Bose')).toBe('AB');
    expect(initialsOf('Priya (sample)')).toBe('P');
    expect(initialsOf('priya@example.com')).toBe('?');
    expect(initialsOf('प्रिया शर्मा')).toBe('पश');
    expect(joinNames(['Aarav', 'Meera', 'Isha'], 'and')).toBe('Aarav, Meera and Isha');
  });
});

describe('account configuration', () => {
  test('only valid values are kept; nothing is invented when unset', () => {
    const c = readAccountConfig({
      EXPO_PUBLIC_SUPPORT_PHONE: '+91 80 1234 5678',
      EXPO_PUBLIC_SUPPORT_EMAIL: 'not an email',
      EXPO_PUBLIC_SUPPORT_WEBSITE: 'http://insecure.example',
      EXPO_PUBLIC_UPDATE_URL_IOS: 'https://apps.apple.com/in/app/bsah/id123',
      EXPO_PUBLIC_UPDATE_URL_ANDROID: 'https://evil.example/play.google.com',
    });
    expect(c.support).toMatchObject({ phone: '+91 80 1234 5678', email: null, website: null, privacyPolicyUrl: null, source: 'config' });
    expect(c.update).toEqual({ ios: 'https://apps.apple.com/in/app/bsah/id123', android: null });
    expect(readAccountConfig({}).support).toMatchObject({ phone: null, email: null, website: null, academyName: null });
    expect(validHttpsUrl('https://play.google.com.evil.example/x', ['play.google.com'])).toBeNull();
  });
});
