import { render, screen } from '@testing-library/react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider, ThemeScope } from '@/ui/theme/ThemeProvider';

import { GlassSurface } from '..';

// Even where iOS 26 Liquid Glass is available, the redesign (6 Nov 2026) renders flat, opaque surfaces on purpose.
jest.mock('expo-glass-effect', () => ({ ...jest.requireActual('expo-glass-effect'), isLiquidGlassAvailable: () => true }));

test('iOS 26: no GlassView, no blur — the flat tone surface', async () => {
  await render(
    <ThemeProvider store={createMemoryStore()}>
      <ThemeScope tone="fir">
        <GlassSurface material="thick" testID="surface" />
      </ThemeScope>
    </ThemeProvider>,
  );
  const json = JSON.stringify(screen.toJSON());
  expect(json).not.toContain('ExpoGlassEffect');
  expect(json).not.toContain('"intensity"');
  expect(json).toContain('"backgroundColor":"#36492E"');
});
