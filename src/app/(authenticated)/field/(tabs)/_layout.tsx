import { useMemo } from 'react';

import { useFieldStrings } from '@/features/field/i18n';
import { useFieldAccess } from '@/features/field/useFieldAccess';
import { ExperienceTabs, type TabSpec } from '@/shell/ExperienceTabs';

/** Field Ops tabs (07): Today · Cadets · Horses · Sync · Profile. Cadets is hidden for roles without cadet records (grooms, SD-03). */
export default function FieldTabsLayout() {
  const s = useFieldStrings();
  // UX only: the server returns no cadet rows to these roles anyway.
  const { canViewCadets } = useFieldAccess();
  const tabs = useMemo<readonly TabSpec[]>(
    () => [
      { name: 'index', title: s.t('tabs.today'), icon: 'today-outline' },
      { name: 'cadets', title: s.t('tabs.cadets'), icon: 'people-outline' },
      { name: 'horses', title: s.t('tabs.horses'), icon: 'leaf-outline' },
      { name: 'sync', title: s.t('tabs.sync'), icon: 'sync-outline' },
      { name: 'profile', title: s.t('tabs.profile'), icon: 'person-outline' },
    ],
    [s],
  );
  return canViewCadets ? <ExperienceTabs tabs={tabs} /> : <ExperienceTabs tabs={tabs.filter((t) => t.name !== 'cadets')} hidden={['cadets']} />;
}
