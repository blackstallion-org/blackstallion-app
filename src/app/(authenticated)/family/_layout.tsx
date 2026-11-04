import { useAccess } from '@/features/identity/AccessProvider';
import { ExperienceTabs, type TabSpec } from '@/shell/ExperienceTabs';

/** Proposed Family tabs (07): Home · Progress · Horse · Community · Profile. */
const FAMILY_TABS: readonly TabSpec[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'progress', title: 'Progress', icon: 'trending-up-outline' },
  { name: 'horse', title: 'Horse', icon: 'heart-outline' },
  { name: 'community', title: 'Community', icon: 'calendar-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-outline' },
];

export default function FamilyLayout() {
  const { state } = useAccess();
  // Never render family routes outside the family context (no cross-context flash).
  if (state.phase !== 'authorized' || state.experience !== 'family') return null;
  return <ExperienceTabs tabs={FAMILY_TABS} />;
}
