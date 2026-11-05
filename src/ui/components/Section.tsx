import type { ReactNode } from 'react';
import { View } from 'react-native';

import { space } from '@/ui/tokens';

import { AppText } from './AppText';

/** Content group with a sentence-case title (no decorative all-caps). */
export function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: space.sm }} testID={testID}>
      <AppText variant="secondary" tone="muted" header style={{ paddingHorizontal: space.xs, fontWeight: '600' }}>
        {title}
      </AppText>
      {children}
    </View>
  );
}
