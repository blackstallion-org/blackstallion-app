/**
 * G14 token registration hook. Behind the `push_notifications` feature flag (D05: OFF during pilot).
 * When the flag is OFF, no expo-notifications import happens, no permission is requested, no token is sent.
 * When ON: requests permission, gets Expo push token, registers with the server, unregisters on unmount.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';

export function useTokenRegistration() {
  const repos = useRepositories();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repos.notifications) return;
    const { deviceTokens, pushFlag } = repos.notifications;
    let cancelled = false;

    (async () => {
      try {
        const on = await pushFlag.enabled();
        if (!on || cancelled) return;

        const Notifications = await import('expo-notifications');

        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || cancelled) return;

        const { data: expoToken } = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;

        const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
        await deviceTokens.register(expoToken, platform);
        tokenRef.current = expoToken;
      } catch {
        // Flag OFF, library absent, or permission denied — all expected; do nothing.
      }
    })();

    return () => {
      cancelled = true;
      const token = tokenRef.current;
      if (token) {
        tokenRef.current = null;
        deviceTokens.unregister(token).catch(() => {});
      }
    };
  }, [repos.notifications]);
}
