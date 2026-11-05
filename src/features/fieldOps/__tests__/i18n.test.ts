/**
 * @jest-environment node
 */
// Every fo.* key the FO-08..FO-20 code asks for exists in EN, HI and TE (no English fallback on a Field screen), with the
// same placeholders; HI/TE are recorded as machine drafts needing native review.
import fs from 'fs';
import path from 'path';

import { createFieldOpsTranslator } from '../i18n/i18n';
import review from '../i18n/locales/review.json';

const SRC = path.resolve(__dirname, '..');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });

const source = files(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const staticKeys = [...new Set(Array.from(source.matchAll(/'(fo\.[A-Za-z0-9_.]+[A-Za-z0-9_])'/g), (m) => m[1]!))].filter((k) => !k.endsWith('.'));
// keys built from values at run time (template literals): every value the code can produce
const dynamicKeys = [
  ...['saved', 'sending', 'received', 'review', 'completed', 'rejected', 'cancelled', 'needsAction'].map((x) => `fo.task.phase.${x}`),
  ...['no_session', 'storage_full', 'capture_failed', 'not_allowed'].map((x) => `fo.task.sendError.${x}`),
  ...['pending', 'recorded', 'needs_review', 'review_accepted', 'review_rejected'].map((x) => `fo.shift.badge.${x}`),
  ...['not_supported', 'optional', 'required'].map((x) => `fo.shift.photo.${x}`),
  ...['send_as_new', 'keep_server', 'open_shift', 'later'].flatMap((x) => [`fo.conflict.path.${x}`, `fo.conflict.pathBody.${x}`]),
  ...['pending', 'submitted', 'completed', 'cancelled'].map((x) => `fo.conflict.occ.${x}`),
  ...['none', 'received', 'review_required', 'accepted', 'rejected'].map((x) => `fo.conflict.sub.${x}`),
  ...['care_evidence', 'shift_attendance', 'rank_proposal'].flatMap((x) => [`fo.review.segment.${x}`, `fo.review.empty.${x}`, `fo.review.listTitle.${x}`]),
  ...['accepted', 'rejected'].flatMap((x) => [`fo.reviewItem.decided.${x}`, `fo.reviewItem.done.${x}`]),
  ...['too_short', 'too_long'].map((x) => `fo.reason.problem.${x}`),
  ...['no_rank', 'same_rank', 'evidence_count', 'note_too_long'].map((x) => `fo.rank.problem.${x}`),
  ...['CADET_SQUIRE', 'CADET_RIDER', 'CADET_KNIGHT', 'SOVEREIGN_LANCER', 'none'].map((x) => `fo.rank.name.${x}`),
  ...['SUPER_ADMIN', 'SCHOOL_ADMIN', 'none'].map((x) => `fo.rank.role.${x}`),
  ...['feature_disabled', 'provider_not_configured', 'provider_not_integrated', 'unknown'].map((x) => `fo.posture.reason.${x}`),
  ...[
    'location_missing', 'weak_location_accuracy', 'outside_geofence', 'observed_in_future', 'task_already_completed', 'task_already_submitted',
    'task_cancelled', 'low_accuracy', 'outside_radius', 'no_location', 'hub_location_unknown', 'review_all_policy', 'accuracy_above_threshold',
    'rank_change', 'other',
  ].flatMap((x) => [`fo.reason.${x}`, `fo.reasonShort.${x}`]),
  ...['lowAccuracy', 'outsideRadius', 'noLocation', 'hubUnknown', 'reviewAll', 'aboveThreshold'].map((x) => `fo.shift.reason.${x}`),
  ...['careGone', 'careReused', 'careHasProof', 'punchOpen', 'punchReused', 'unknown', 'notConflict', 'blocked'].map((x) => `fo.conflict.${x}`),
];

describe('Field Ops strings (EN/HI/TE)', () => {
  test.each(['en', 'hi', 'te'] as const)('I01 %s: every key used by the screens exists (no fallback)', (locale) => {
    const t = createFieldOpsTranslator(locale);
    expect(staticKeys.length).toBeGreaterThan(150);
    for (const k of [...staticKeys, ...dynamicKeys]) t.t(k, {});
    expect([...t.missing]).toEqual([]);
  });

  test('I02 HI and TE are real translations with the same placeholders, and every key is flagged for native review', () => {
    const en = createFieldOpsTranslator('en');
    for (const loc of ['hi', 'te'] as const) {
      const tr = createFieldOpsTranslator(loc);
      for (const k of staticKeys) {
        const a = en.t(k);
        const b = tr.t(k);
        expect((a.match(/\{\{\w+\}\}/g) ?? []).sort()).toEqual((b.match(/\{\{\w+\}\}/g) ?? []).sort());
        if (/[a-z]{4,}/i.test(a.replace(/\{\{\w+\}\}/g, ''))) expect(b).not.toBe(a);
      }
    }
    for (const k of staticKeys) expect((review as Record<string, { review: string }>)[k]?.review).toMatch(/needs-native-review/);
  });

  test('I03 no Field Ops string claims verified presence or a completed task before acceptance', () => {
    const en = createFieldOpsTranslator('en');
    const all = [...staticKeys, ...dynamicKeys].map((k) => en.t(k, {}));
    const verified = all.filter((s) => /\bverified\b/i.test(s));
    // the only mentions are negations ("does not mark ... as verified presence")
    for (const s of verified) expect(s).toMatch(/not|never/i);
  });
});
