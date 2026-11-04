/**
 * DEVELOPMENT-ONLY synthetic personas. These simulate what the G3 access
 * snapshot might return so layouts and navigation can be exercised. They are
 * not accounts, grant nothing on any server, and are excluded from
 * non-development bundles (see src/app/_layout.tsx and the bundle check in
 * G2_FOUNDATION_REPORT.md).
 */
import type { AccessSnapshot } from '@/features/identity/domain/access';

export type PersonaId =
  | 'guardian'
  | 'guardianNoChild'
  | 'instructor'
  | 'groom'
  | 'dualRole'
  | 'familyDataError'
  | 'unknownAccount'
  | 'disabled'
  | 'bootError';

export type Persona = {
  id: PersonaId;
  label: string;
  description: string;
  /** null = the adapter throws (simulated boot failure). */
  snapshot: AccessSnapshot | null;
};

const authorized = (
  subjectId: string,
  displayName: string,
  allowedExperiences: ('family' | 'field')[],
): AccessSnapshot => ({ kind: 'authorized', subjectId, displayName, allowedExperiences, source: 'synthetic-preview' });

export const PERSONAS: readonly Persona[] = [
  { id: 'guardian', label: 'Guardian', description: 'Family only · two sample children', snapshot: authorized('syn-guardian-a', 'Priya (sample)', ['family']) },
  { id: 'guardianNoChild', label: 'Guardian, no linked child', description: 'Family only · empty state', snapshot: authorized('syn-guardian-b', 'Kiran (sample)', ['family']) },
  { id: 'instructor', label: 'Instructor', description: 'Field Ops only', snapshot: authorized('syn-instructor', 'Ravi (sample)', ['field']) },
  { id: 'groom', label: 'Groom', description: 'Field Ops only · care tasks', snapshot: authorized('syn-groom', 'Suresh (sample)', ['field']) },
  { id: 'dualRole', label: 'Instructor who is also a parent', description: 'Family + Field Ops · switcher', snapshot: authorized('syn-dual', 'Anil (sample)', ['family', 'field']) },
  { id: 'familyDataError', label: 'Guardian, data fails to load', description: 'Family only · error state', snapshot: authorized('syn-guardian-err', 'Neha (sample)', ['family']) },
  { id: 'unknownAccount', label: 'Unknown account', description: 'No-access screen', snapshot: { kind: 'unavailable', reason: 'unknownAccount' } },
  { id: 'disabled', label: 'Disabled account', description: 'Blocked screen', snapshot: { kind: 'unavailable', reason: 'disabled' } },
  { id: 'bootError', label: 'Bootstrap failure', description: 'Unavailable + retry', snapshot: null },
];
