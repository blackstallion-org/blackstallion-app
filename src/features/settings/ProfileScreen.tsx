import { useRouter } from 'expo-router';

import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { EXPERIENCE_LABEL, ExperienceSwitchButton } from '@/features/identity/ExperienceSwitch';
import { AppText, Badge, Card, ListRow, Screen } from '@/ui/components';

/** Profile tab in both experiences; entry point to the shared Settings stack. */
export function ProfileScreen() {
  const { state } = useAuthorizedAccess();
  const router = useRouter();
  return (
    <Screen edges={['top', 'left', 'right']} testID={`profile-${state.experience}`}>
      <AppText variant="title" header>
        Profile
      </AppText>
      <Card>
        <AppText variant="headline">{state.session.displayName}</AppText>
        <AppText tone="muted">Viewing: {EXPERIENCE_LABEL[state.experience]}</AppText>
        {state.session.source === 'synthetic-preview' ? <Badge label="Synthetic preview" tone="warning" /> : null}
      </Card>
      <ExperienceSwitchButton />
      <Card>
        <ListRow
          testID="open-settings"
          label="Settings"
          value="Appearance, account and about"
          icon="settings-outline"
          divider={false}
          onPress={() => router.push('/settings')}
        />
      </Card>
    </Screen>
  );
}
