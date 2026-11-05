import type { ResourceState } from '@/core/data/useScopedResource';
import { ErrorState, OfflineState, UnavailableState } from '@/ui/glass';

import { NOT_FOUND_REFERENCE, OFFLINE_REFERENCE } from '../data/net';
import { useFieldStrings } from '../i18n';

/**
 * One place that turns a failed scoped read into the right state: offline (Try again), neutral not-found (no retry,
 * no hint that a record exists elsewhere), no hub, or a recoverable error with the reference under Details.
 */
export function LoadFailure({ state, onRetry, notFoundTitle, notFoundMessage, testID }: { state: Extract<ResourceState<unknown>, { status: 'error' }>; onRetry: () => void; notFoundTitle?: string; notFoundMessage?: string; testID?: string }) {
  const s = useFieldStrings();
  if (state.reference === OFFLINE_REFERENCE) return <OfflineState message={s.t('common.offline')} onRetry={onRetry} testID={testID ? `${testID}-offline` : undefined} />;
  if (state.reference === NOT_FOUND_REFERENCE) {
    return <UnavailableState title={notFoundTitle ?? s.t('common.notFoundTitle')} message={notFoundMessage ?? s.t('common.notFound')} testID={testID ? `${testID}-not-found` : undefined} />;
  }
  if (state.reference === 'NO-HUB') return <UnavailableState title={s.t('common.noHubTitle')} message={s.t('common.noHub')} testID={testID ? `${testID}-no-hub` : undefined} />;
  return (
    <ErrorState
      title={s.t('common.errorTitle')}
      message={s.t('common.loadError')}
      onRetry={onRetry}
      details={state.reference ? s.t('common.reference', { ref: state.reference }) : undefined}
      testID={testID ? `${testID}-error` : undefined}
    />
  );
}
