import type { IconName } from '@/ui/components';
import { AppText, Card, EmptyState, Screen } from '@/ui/components';

/** Honest placeholder for proposed tabs (07 baseline) whose features belong to later gates. */
export function PlannedTabScreen({ title, icon, gate, testID }: { title: string; icon: IconName; gate: string; testID: string }) {
  return (
    <Screen edges={['top', 'left', 'right']} testID={testID}>
      <AppText variant="title" header>
        {title}
      </AppText>
      <Card>
        <EmptyState icon={icon} title="Not built yet" message={`This area is planned for ${gate}. Nothing is stored or shown here in this build.`} />
      </Card>
    </Screen>
  );
}
