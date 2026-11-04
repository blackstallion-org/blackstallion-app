import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import type { AppearancePreference } from '@/core/preferences/appearance';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { ExperienceOptions } from '@/features/identity/ExperienceSwitch';
import { Button, Card, ListRow, OptionGroup, Screen, Section, StatusMessage } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', description: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System', description: 'Follows your device setting' },
] as const satisfies readonly { value: AppearancePreference; label: string; description?: string }[];

/** S04 Settings (G2 scope: appearance, experience, account, about). */
export function SettingsScreen() {
  const theme = useTheme();
  const access = useAuthorizedAccess();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Screen edges={['left', 'right', 'bottom']} testID="settings">
      <Section title="Appearance">
        <OptionGroup
          testID="appearance"
          label="Appearance"
          options={APPEARANCE_OPTIONS}
          value={theme.preference}
          onChange={(v) => void theme.setPreference(v)}
        />
        {theme.saveError ? <StatusMessage tone="warning" message={theme.saveError} /> : null}
      </Section>
      {access.canSwitch ? (
        <Section title="Experience">
          <ExperienceOptions />
        </Section>
      ) : null}
      <Section title="Account">
        <Card>
          <ListRow label="Signed in as" value={access.state.session.displayName} icon="person-circle-outline" divider={false} />
          {access.state.session.source === 'synthetic-preview' ? (
            <StatusMessage tone="info" message="Synthetic development preview. No real account is signed in." />
          ) : null}
          <Button
            testID="sign-out"
            variant="secondary"
            label="Sign out"
            icon="log-out-outline"
            loading={signingOut}
            onPress={async () => {
              setSigningOut(true);
              await access.signOut();
            }}
          />
        </Card>
      </Section>
      <Section title="About">
        <Card>
          <ListRow label="Version" value={Constants.expoConfig?.version ?? 'unknown'} />
          <ListRow label="Build" value={__DEV__ ? 'Development' : 'Release'} />
          <ListRow label="Access adapter" value={access.adapterName} divider={!__DEV__ ? false : true} />
          {__DEV__ ? (
            <ListRow
              testID="open-gallery"
              label="Component gallery"
              value="Development only"
              icon="color-palette-outline"
              divider={false}
              onPress={() => router.push('/settings/gallery')}
            />
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
