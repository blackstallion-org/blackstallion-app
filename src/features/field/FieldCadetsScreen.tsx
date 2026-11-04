import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { AppText, Card, EmptyState, ErrorState, ListRow, LoadingState, PreviewBanner, Screen } from '@/ui/components';

import { useFieldToday } from './FieldTodayScreen';

/** Cadets tab: today's assigned cadets from the same scoped read (synthetic in G2). */
export function FieldCadetsScreen() {
  useAuthorizedAccess();
  const today = useFieldToday();
  return (
    <Screen edges={['top', 'left', 'right']} testID="field-cadets">
      <AppText variant="title" header>
        Cadets
      </AppText>
      {today.status === 'loading' ? <LoadingState label="Loading cadets" rows={2} /> : null}
      {today.status === 'error' ? <ErrorState message={today.message} onRetry={today.retry} /> : null}
      {today.status === 'ready' ? (
        <>
          {today.data.source === 'synthetic-preview' ? <PreviewBanner /> : null}
          <Card>
            {today.data.cadets.length === 0 ? (
              <EmptyState icon="people-outline" title="No cadets assigned" message="Cadets appear here when you are assigned to a session." />
            ) : (
              today.data.cadets.map((c, i) => (
                <ListRow key={c.id} label={c.name} value={c.group} icon="person-outline" divider={i < today.data.cadets.length - 1} />
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
