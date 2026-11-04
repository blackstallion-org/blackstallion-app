import { renderHook, waitFor } from '@testing-library/react-native';

import { ScopedLoadError, useScopedResource } from '../data/useScopedResource';

it('shows a repository’s own user-facing message, and the generic text otherwise', async () => {
  const own = await renderHook(() => useScopedResource('a', () => Promise.reject(new ScopedLoadError('Your session ended. Sign in again.', 'PGRST301', true))));
  await waitFor(() => expect(own.result.current).toMatchObject({ status: 'error', message: 'Your session ended. Sign in again.', reference: 'PGRST301' }));
  const generic = await renderHook(() => useScopedResource('b', () => Promise.reject(new ScopedLoadError('Denied', 'FIXTURE-SCOPE'))));
  await waitFor(() => expect(generic.result.current).toMatchObject({ status: 'error', message: expect.stringMatching(/could not be loaded/) }));
});
