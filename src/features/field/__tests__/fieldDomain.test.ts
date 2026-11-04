import { dateLabel, hubDate, hubTime } from '@/core/format/hubTime';

import { assessmentPayloadKey, emptyDraft, validateAssessment } from '../domain/assessment';
import { FieldCommandError, toCommandError } from '../domain/commandErrors';
import { isUuid, latchOperation, newOperationId } from '../domain/operation';
import { parsePassportInput } from '../domain/passportCode';

describe('passport input', () => {
  it.each([
    ['BSAH-26-F3A00001', 'BSAH-26-F3A00001'],
    ['  bsah-26-f3a00001 ', 'BSAH-26-F3A00001'],
    ['https://blackstallion.example/verify/BSAH-26-F3A00001', 'BSAH-26-F3A00001'],
    ['https://blackstallion.example/verify/BSAH-26-F3A00001/?utm=qr#top', 'BSAH-26-F3A00001'],
  ])('accepts %p', (raw, code) => expect(parsePassportInput(raw)).toEqual({ ok: true, code }));

  it.each(['', '   '])('rejects empty %p', (raw) => expect(parsePassportInput(raw)).toEqual({ ok: false, reason: 'empty' }));
  it.each(['ABC', 'BSAH 26 F3A', '<script>', "BSAH-26' OR 1=1", 'x'.repeat(41)])('rejects malformed %p', (raw) =>
    expect(parsePassportInput(raw)).toEqual({ ok: false, reason: 'format' }),
  );
});

describe('assessment validation mirrors the server limits', () => {
  it('requires all three scores', () => {
    const r = validateAssessment(emptyDraft());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['ground', 'riding', 'stable']);
  });
  it.each([0, 11, 5.5, -1])('rejects score %p', (v) => {
    expect(validateAssessment({ ...emptyDraft(), riding: v, ground: 5, stable: 5 }).ok).toBe(false);
  });
  it('accepts the bounds and normalises notes and skills', () => {
    const r = validateAssessment({ riding: 1, ground: 10, stable: 7, notes: '   ', skillIds: ['b', 'a', 'b', ''] });
    expect(r).toEqual({ ok: true, value: { riding: 1, ground: 10, stable: 7, notes: null, skillIds: ['a', 'b'] } });
  });
  it('counts notes in code points like Postgres char_length', () => {
    const emoji2000 = '🐴'.repeat(2000); // 4000 UTF-16 units, 2000 code points
    expect(validateAssessment({ riding: 5, ground: 5, stable: 5, notes: emoji2000, skillIds: [] }).ok).toBe(true);
    expect(validateAssessment({ riding: 5, ground: 5, stable: 5, notes: 'a'.repeat(2001), skillIds: [] }).ok).toBe(false);
  });
  it('rejects more than 20 distinct skills', () => {
    const skillIds = Array.from({ length: 21 }, (_, i) => `s${i}`);
    expect(validateAssessment({ riding: 5, ground: 5, stable: 5, notes: '', skillIds }).ok).toBe(false);
  });
  it('payload key changes when any sent value changes', () => {
    const v = { riding: 5, ground: 5, stable: 5, notes: null, skillIds: null };
    const k = assessmentPayloadKey('op', v);
    expect(assessmentPayloadKey('op', { ...v })).toBe(k);
    expect(assessmentPayloadKey('op', { ...v, stable: 6 })).not.toBe(k);
    expect(assessmentPayloadKey('op', { ...v, notes: 'x' })).not.toBe(k);
  });
});

describe('operation ids', () => {
  it('reuses the id for the same payload and renews it for a changed payload', () => {
    let n = 0;
    const make = () => `id-${++n}`;
    const a = latchOperation(null, 'k1', make);
    expect(latchOperation(a, 'k1', make)).toBe(a);
    expect(latchOperation(a, 'k2', make).operationId).toBe('id-2');
  });
  it('produces RFC 4122 v4 ids with and without a platform CSPRNG', () => {
    expect(isUuid(newOperationId())).toBe(true);
    const ids = new Set(Array.from({ length: 500 }, () => newOperationId({})));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isUuid(id)).toBe(true);
  });
});

describe('server error → staff message', () => {
  it('maps SQLSTATEs and shows only known server text', () => {
    expect(toCommandError({ code: '42501', message: 'not allowed for this account' }, 'checkIn').kind).toBe('forbidden');
    const nf = toCommandError({ code: 'PT404', message: 'no cadet with this passport code at your hub' }, 'checkIn');
    expect(nf.kind).toBe('notFound');
    expect(nf.message).toMatch(/No cadet with this passport code at your hub/);
    expect(toCommandError({ code: 'PT409', message: 'this check-in already has a published session' }, 'publish').message).toBe(
      'This session was already published.',
    );
    const leak = toCommandError({ code: 'PT422', message: 'relation "secret_table" does not exist' }, 'publish');
    expect(leak.kind).toBe('invalid');
    expect(leak.message).not.toMatch(/secret_table/);
    expect(leak.reference).toBe('PT422');
  });
  it('treats transport failures as retryable and auth failures as signed out', () => {
    const net = toCommandError(new TypeError('Network request failed'), 'publish');
    expect(net.kind).toBe('network');
    expect(net.retryable).toBe(true);
    expect(net.message).toMatch(/repeating it is safe/);
    expect(toCommandError({ message: 'upstream' }, 'checkIn', 503).kind).toBe('network');
    expect(toCommandError({ code: 'PGRST301', message: 'JWT expired' }, 'checkIn', 401).kind).toBe('signedOut');
    expect(toCommandError({ code: 'XX000', message: 'boom' }, 'checkIn', 400).kind).toBe('unexpected');
  });
  it('passes FieldCommandError through unchanged', () => {
    const e = new FieldCommandError('conflict', 'x');
    expect(toCommandError(e, 'checkIn')).toBe(e);
  });
});

describe('hub-local time (Asia/Kolkata, UTC+05:30)', () => {
  it('rolls the day over at 18:30 UTC', () => {
    expect(hubDate(new Date('2026-11-04T18:29:59Z'))).toBe('2026-11-04');
    expect(hubDate(new Date('2026-11-04T18:30:00Z'))).toBe('2026-11-05');
    expect(hubTime('2026-11-04T04:30:00Z')).toBe('10:00');
    expect(hubTime('nonsense')).toBe('');
    expect(dateLabel('2026-11-04')).toBe('4 Nov 2026');
    expect(dateLabel('bad')).toBe('bad');
  });
});
