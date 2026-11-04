import { useAccess } from '@/features/identity/AccessProvider';
import { ExperienceTabs, type TabSpec } from '@/shell/ExperienceTabs';

/** Proposed Field Ops tabs (07): Today · Cadets · Horses · Sync · Profile. */
const FIELD_TABS: readonly TabSpec[] = [
  { name: 'index', title: 'Today', icon: 'today-outline' },
  { name: 'cadets', title: 'Cadets', icon: 'people-outline' },
  { name: 'horses', title: 'Horses', icon: 'leaf-outline' },
  { name: 'sync', title: 'Sync', icon: 'sync-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-outline' },
];

export default function FieldLayout() {
  const { state } = useAccess();
  if (state.phase !== 'authorized' || state.experience !== 'field') return null;
  return <ExperienceTabs tabs={FIELD_TABS} />;
}
