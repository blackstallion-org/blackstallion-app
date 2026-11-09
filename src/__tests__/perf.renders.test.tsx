/**
 * Render-count smoke tests: verifies that shared memoized components (Row,
 * StatusBadge, Chip) do NOT re-render when their parent re-renders with
 * unchanged props.
 *
 * React's <Profiler> is inert under the jest-expo renderer (onRender never
 * fires), so renders are counted by observing useTheme: each of these
 * components calls it exactly once per render and nothing else in the probe
 * tree calls it. The mock forwards to the real hook, so theme behaviour is
 * unchanged. JS-level reconciliation cost only — device profiling is separate.
 */
import { useState, type ReactNode } from 'react';
import { act, render } from '@testing-library/react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';
import { Row } from '@/ui/glass/ListGroup';
import { StatusBadge } from '@/ui/glass/StatusBadge';
import { Chip } from '@/ui/glass/Chip';

const mockThemeRenders = { calls: 0 };
jest.mock('@/ui/theme/ThemeProvider', () => {
  const actual = jest.requireActual('@/ui/theme/ThemeProvider');
  return {
    ...actual,
    useTheme: () => {
      mockThemeRenders.calls += 1;
      return actual.useTheme();
    },
  };
});

function useForceRender() {
  const [, set] = useState(0);
  return () => set((n) => n + 1);
}

/**
 * The child element is rebuilt on every parent render (a shared element would
 * bail out even without memo), so only the component's own memo can prevent
 * the extra render.
 */
async function memoProbe(renderChild: () => ReactNode) {
  mockThemeRenders.calls = 0;
  let force: () => void = () => {
    throw new Error('parent not mounted');
  };
  function Parent() {
    force = useForceRender();
    return renderChild();
  }
  // React 19 concurrent root: the mount commits after the sync call yields.
  await act(async () => {
    render(
      <ThemeProvider store={createMemoryStore()}>
        <Parent />
      </ThemeProvider>,
    );
  });
  return {
    initial: mockThemeRenders.calls,
    forceTwice: async () => {
      await act(async () => force());
      await act(async () => force());
    },
    renders: () => mockThemeRenders.calls,
  };
}

describe('memo: shared components skip re-render on unchanged props', () => {
  it('Row does not re-render when parent state changes', async () => {
    const p = await memoProbe(() => <Row label="Stable label" value="Stable value" testID="row" />);
    expect(p.initial).toBeGreaterThan(0);
    await p.forceTwice();
    expect(p.renders()).toBe(p.initial);
  });

  it('StatusBadge does not re-render when parent state changes', async () => {
    const p = await memoProbe(() => <StatusBadge label="Published" tone="success" testID="badge" />);
    expect(p.initial).toBeGreaterThan(0);
    await p.forceTwice();
    expect(p.renders()).toBe(p.initial);
  });

  it('Chip does not re-render when parent state changes', async () => {
    const stableOnPress = () => {};
    const p = await memoProbe(() => <Chip label="Child A" selected onPress={stableOnPress} testID="chip" />);
    expect(p.initial).toBeGreaterThan(0);
    await p.forceTwice();
    expect(p.renders()).toBe(p.initial);
  });
});