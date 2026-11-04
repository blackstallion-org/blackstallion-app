import { PlannedTabScreen } from '@/features/settings/PlannedTabScreen';

export default function Route() {
  return <PlannedTabScreen title="Sync" icon="sync-outline" gate="offline sync (G5)" testID="field-sync" />;
}
