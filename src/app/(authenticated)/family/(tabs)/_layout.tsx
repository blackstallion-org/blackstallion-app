import { ExperienceTabs, type TabSpec } from '@/shell/ExperienceTabs';

/** Proposed Family tabs (07): Home · Progress · Horse · Community · Profile. */
const FAMILY_TABS: readonly TabSpec[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'progress', title: 'Progress', icon: 'trending-up-outline' },
  { name: 'horse', title: 'Horse', icon: 'heart-outline' },
  { name: 'community', title: 'Community', icon: 'calendar-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-outline' },
];

export default function FamilyTabsLayout() {
  return <ExperienceTabs tabs={FAMILY_TABS} />;
}
