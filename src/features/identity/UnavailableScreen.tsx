import { View } from 'react-native';

import { AppText, Button, Card, Screen } from '@/ui/components';
import { space } from '@/ui/tokens';

import { useAccess } from './AccessProvider';
import type { UnavailableReason } from './domain/access';

const COPY: Record<UnavailableReason, { title: string; message: string }> = {
  unknownAccount: {
    title: 'No BSAH account found',
    message: 'This sign-in is not linked to an academy account. Contact your academy office for help.',
  },
  disabled: {
    title: 'Access is paused',
    message: 'This account is not active right now. Your academy office can review it.',
  },
  noExperience: {
    title: 'Nothing to show yet',
    message: 'Your account has no family or staff access assigned. Contact your academy office.',
  },
  bootError: {
    title: 'Could not start',
    message: 'We could not check your access. Check your connection and try again.',
  },
};

/** Neutral no-access/blocked/unavailable screen (07 boot states). Shows no private data. */
export function UnavailableScreen() {
  const access = useAccess();
  const reason = access.state.phase === 'unavailable' ? access.state.reason : 'bootError';
  const copy = COPY[reason];
  return (
    <Screen testID={`unavailable-${reason}`}>
      <Card>
        <AppText variant="headline" header>
          {copy.title}
        </AppText>
        <AppText tone="muted">{copy.message}</AppText>
        <View style={{ gap: space.sm }}>
          {reason === 'bootError' ? <Button testID="retry" label="Retry" onPress={access.reload} /> : null}
          <Button testID="unavailable-sign-out" variant="secondary" label="Sign out" onPress={() => void access.signOut()} />
        </View>
      </Card>
    </Screen>
  );
}
