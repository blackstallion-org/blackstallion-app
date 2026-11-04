import { SignInScreen } from '@/features/identity/SignInScreen';

const DevPanel = (): React.ReactNode => {
  if (!__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dev = require('@/dev/preview') as typeof import('@/dev/preview');
  return <dev.DevPreviewPanel adapter={dev.devAccessAdapter} />;
};

export default function SignInRoute() {
  return <SignInScreen devPanel={__DEV__ ? <DevPanel /> : undefined} />;
}
