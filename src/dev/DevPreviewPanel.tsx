import { View } from 'react-native';

import { AppText, Button, Card, PreviewBanner } from '@/ui/components';
import { space } from '@/ui/tokens';

import type { DevAccessAdapter } from './devAccessAdapter';
import { PERSONAS } from './personas';

/**
 * DEVELOPMENT-ONLY. Picks which synthetic adapter result the app boots with.
 * It is not a role selector: it never contacts a server and grants nothing.
 */
export function DevPreviewPanel({ adapter }: { adapter: DevAccessAdapter }) {
  if (!__DEV__) return null;
  return (
    <Card tone="muted" testID="dev-preview-panel">
      <AppText variant="headline" header>
        Development preview
      </AppText>
      <PreviewBanner text="Development builds only. Synthetic personas simulate an access result; they grant no server access." />
      <View style={{ gap: space.sm }}>
        {PERSONAS.map((p) => (
          <Button
            key={p.id}
            testID={`persona-${p.id}`}
            variant="secondary"
            label={`${p.label} — ${p.description}`}
            onPress={() => adapter.selectPersona(p.id)}
          />
        ))}
      </View>
    </Card>
  );
}
