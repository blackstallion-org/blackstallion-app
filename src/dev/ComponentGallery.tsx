import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  PreviewBanner,
  Screen,
  Section,
  StatusMessage,
  TextField,
} from '@/ui/components';
import { space } from '@/ui/tokens';

/** DEVELOPMENT-ONLY gallery of primitives and states for screenshots and review. */
export function ComponentGallery() {
  const [value, setValue] = useState('');
  return (
    <Screen edges={['left', 'right', 'bottom']} keyboard testID="component-gallery">
      <PreviewBanner text="Development-only component gallery." />
      <Section title="Text">
        <AppText variant="display">Display 32</AppText>
        <AppText variant="title">Title 28</AppText>
        <AppText variant="headline">Headline 20</AppText>
        <AppText>Body 16 — readable utility text in the system sans.</AppText>
        <AppText variant="caption" tone="muted">
          Caption 13 muted
        </AppText>
        <AppText variant="label" tone="accent">
          Accent text (contrast-checked brass)
        </AppText>
      </Section>
      <Section title="Buttons">
        <Button label="Primary" onPress={() => undefined} />
        <Button label="Secondary" variant="secondary" onPress={() => undefined} />
        <Button label="Field action (56)" size="field" icon="qr-code-outline" onPress={() => undefined} />
        <Button label="Danger" variant="danger" onPress={() => undefined} />
        <Button label="Loading" loading onPress={() => undefined} />
        <Button label="Disabled" disabled onPress={() => undefined} />
      </Section>
      <Section title="Inputs">
        <TextField label="Text input" hint="Hint text sits under the label" value={value} onChangeText={setValue} />
        <TextField label="With error" value="abc" error="Enter a 10-digit mobile number" onChangeText={() => undefined} />
      </Section>
      <Section title="Status">
        <StatusMessage tone="info" message="Information message." />
        <StatusMessage tone="success" title="Saved" message="Success message." />
        <StatusMessage tone="warning" message="1 overdue care task." />
        <StatusMessage tone="danger" title="Not saved" message="Error message." />
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Badge label="Neutral" tone="neutral" />
          <Badge label="Corrected" tone="info" />
          <Badge label="Done" tone="success" />
          <Badge label="Due" tone="warning" />
          <Badge label="Overdue" tone="danger" />
        </View>
      </Section>
      <Section title="Card and rows">
        <Card>
          <AppText variant="headline">Card title</AppText>
          <ListRow label="Row label" value="Row value" icon="person-outline" onPress={() => undefined} />
          <ListRow label="Static row" value="No action" divider={false} />
        </Card>
      </Section>
      <Section title="Loading state">
        <LoadingState label="Loading example" rows={1} />
      </Section>
      <Section title="Empty state">
        <Card>
          <EmptyState title="Nothing here yet" message="One sentence and one useful action." action={{ label: 'Useful action', onPress: () => undefined }} />
        </Card>
      </Section>
      <Section title="Error state">
        <Card>
          <ErrorState message="This information could not be loaded." onRetry={() => undefined} details="Reference: EXAMPLE-0001" />
        </Card>
      </Section>
    </Screen>
  );
}
