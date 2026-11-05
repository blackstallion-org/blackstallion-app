import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { readBackendConfig } from '@/core/auth/supabaseClient';
import { useAccess } from '@/features/identity/AccessProvider';
import { providerEmailOtp, type OtpBoundary } from '@/features/identity/otp';
import { VerifyCodeScreen } from '@/features/identity/VerifyCodeScreen';

/** Development builds with no backend only: the synthetic code preview (sends nothing; the screen says so). */
const devOtpPreview = (): OtpBoundary =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('@/dev/fixtures/account') as typeof import('@/dev/fixtures/account')).syntheticOtpPreview;

const DevPanel = (): ReactNode => {
  if (!__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dev = require('@/dev/preview') as typeof import('@/dev/preview');
  return <dev.DevPreviewPanel adapter={dev.devAccessAdapter} />;
};

/**
 * SH-02 `/verify`. Reachable only while signed out: once the boot sequence has an answer (authorized or account
 * status) this route hands over to the boot gate, which routes by the server snapshot. The address the code was sent
 * to is never in the URL (see features/identity/otp.ts).
 */
export default function VerifyRoute() {
  const access = useAccess();
  if (access.state.phase === 'authorized' || access.state.phase === 'unavailable') return <Redirect href="/" />;
  const dev = __DEV__ && !readBackendConfig();
  const boundary = providerEmailOtp(access) ?? (dev ? devOtpPreview() : null);
  return <VerifyCodeScreen boundary={boundary} devPanel={dev ? <DevPanel /> : undefined} />;
}
