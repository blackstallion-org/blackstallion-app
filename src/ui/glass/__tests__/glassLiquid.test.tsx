import { render, screen } from '@testing-library/react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider, ThemeScope } from '@/ui/theme/ThemeProvider';

import { GlassSurface } from '..';

// iOS 26+: Liquid Glass is available → GlassView carries the material (no BlurView, no extra rim).
jest.mock('expo-glass-effect', () => ({ ...jest.requireActual('expo-glass-effect'), isLiquidGlassAvailable: () => true }));

test('iOS 26 renderer: GlassView with the scheme and the material tint', async () => {
  await render(
    <ThemeProvider store={createMemoryStore()}>
      <ThemeScope scheme="dark">
        <GlassSurface material="thick" testID="surface" />
      </ThemeScope>
    </ThemeProvider>,
  );
  const json = JSON.stringify(screen.toJSON());
  expect(json).toContain('ExpoGlassEffect');
  expect(json).toContain('"colorScheme":"dark"');
  expect(json).toContain('"tintColor":"rgba(26, 13, 6, 0.7)"');
  expect(json).not.toContain('"intensity"');
});

test('Reduce Transparency still wins over Liquid Glass', async () => {
  await render(
    <ThemeProvider store={createMemoryStore()}>
      <ThemeScope scheme="dark" reduceTransparency>
        <GlassSurface testID="surface" />
      </ThemeScope>
    </ThemeProvider>,
  );
  expect(JSON.stringify(screen.toJSON())).not.toContain('ExpoGlassEffect');
});
