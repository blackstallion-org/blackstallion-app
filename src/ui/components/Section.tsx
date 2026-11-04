import type { ReactNode } from 'react';
import { View } from 'react-native';

import { space } from '@/ui/tokens';

import { AppText } from './AppText';

export function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: space.sm }} testID={testID}>
      <AppText variant="overline" tone="muted" header>
        {title}
      </AppText>
      {children}
    </View>
  );
}
