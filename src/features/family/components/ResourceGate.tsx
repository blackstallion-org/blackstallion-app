import type { ReactNode } from 'react';

import type { ResourceState } from '@/core/data/useScopedResource';
import { ErrorState, GlassCard, LoadingState, OfflineState, UnavailableState } from '@/ui/glass';

import { loadFailureOf } from '../data/familyNet';
import { COMMON } from '../strings';

/**
 * One place that turns a scoped resource into the register's states (SCREEN_REGISTER §1):
 * loading skeleton · offline (Try again) · denied/not found (neutral, no retry, no hint a record exists) ·
 * switched off by policy · error (Retry + reference under Details). Data renders only when ready.
 */
export function ResourceGate<T>({
  resource,
  loadingLabel,
  rows = 2,
  notFound,
  testID,
  children,
}: {
  resource: ResourceState<T> & { retry: () => void };
  loadingLabel: string;
  rows?: number;
  /** Custom neutral not-found content (e.g. with a way back). */
  notFound?: ReactNode;
  testID: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading') return <LoadingState label={loadingLabel} rows={rows} testID={`${testID}-loading`} />;
  if (resource.status === 'ready') return <>{children(resource.data)}</>;
  const failure = loadFailureOf(resource.reference);
  if (failure === 'offline') {
    return (
      <GlassCard>
        <OfflineState onRetry={resource.retry} testID={`${testID}-offline`} />
      </GlassCard>
    );
  }
  if (failure === 'denied' || failure === 'notFound') {
    return notFound ? (
      <>{notFound}</>
    ) : (
      <GlassCard>
        <UnavailableState title={COMMON.notAvailableTitle} message={COMMON.notAvailable} testID={`${testID}-denied`} />
      </GlassCard>
    );
  }
  if (failure === 'off') {
    return (
      <GlassCard>
        <UnavailableState title={COMMON.offFeatureTitle} message={resource.message || COMMON.offFeature} testID={`${testID}-off`} />
      </GlassCard>
    );
  }
  return (
    <GlassCard>
      <ErrorState message={resource.message} onRetry={resource.retry} details={resource.reference ? COMMON.details(resource.reference) : undefined} testID={`${testID}-error`} />
    </GlassCard>
  );
}

/** Shown when this build has no Family data source at all (repositories.familyApp undefined). */
export function FamilyUnconnected({ testID }: { testID: string }) {
  return (
    <GlassCard>
      <UnavailableState title={COMMON.unconnectedTitle} message={COMMON.unconnected} testID={`${testID}-unconnected`} />
    </GlassCard>
  );
}
