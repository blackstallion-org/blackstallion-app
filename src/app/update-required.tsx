import { Stack, useLocalSearchParams } from 'expo-router';

import { UpdateRequiredScreen } from '@/features/identity/UpdateRequiredScreen';

/**
 * SH-12 `/update-required`. The boot gate redirects here when the build is below the published minimum (see
 * features/identity/updateGate.ts). `?preview=required` shows the blocking layout in development builds only;
 * any other parameter is ignored.
 */
export default function UpdateRequiredRoute() {
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <UpdateRequiredScreen preview={__DEV__ && preview === 'required'} />
    </>
  );
}
