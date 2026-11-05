import { readBackendConfig } from '@/core/auth/supabaseClient';
import type { OtpBoundary } from '@/features/identity/otp';
import { SignInScreen } from '@/features/identity/SignInScreen';

/** Development builds with no backend only: the synthetic code preview (sends nothing; SH-02 says so). */
const devOtpPreview = (): OtpBoundary =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('@/dev/fixtures/account') as typeof import('@/dev/fixtures/account')).syntheticOtpPreview;

const DevPanel = (): React.ReactNode => {
  if (!__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dev = require('@/dev/preview') as typeof import('@/dev/preview');
  return <dev.DevPreviewPanel adapter={dev.devAccessAdapter} />;
};

export default function SignInRoute() {
  // The persona panel and the synthetic code preview exist only in development builds with no backend configured.
  const dev = __DEV__ && !readBackendConfig();
  return <SignInScreen devPanel={dev ? <DevPanel /> : undefined} devOtpPreview={dev ? devOtpPreview() : undefined} />;
}
