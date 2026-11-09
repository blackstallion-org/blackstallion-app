/**
 * G14 push notification repository contract.
 * Implementations: server in `./server.ts`, fixtures in `src/dev/fixtures/notifications.ts`.
 * Screens read `useRepositories().notifications`; when absent, token registration is skipped.
 */
import type { RegisterTokenResult, UnregisterTokenResult } from '../domain/types';

export interface DeviceTokenRepository {
  register(token: string, platform: 'ios' | 'android' | 'web', appBuild?: string): Promise<RegisterTokenResult>;
  unregister(token: string): Promise<UnregisterTokenResult>;
}

export interface PushFlagPort {
  enabled(): Promise<boolean>;
}

export interface NotificationRepositories {
  deviceTokens: DeviceTokenRepository;
  pushFlag: PushFlagPort;
}
