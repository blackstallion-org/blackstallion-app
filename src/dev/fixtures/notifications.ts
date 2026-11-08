/**
 * DEVELOPMENT-ONLY synthetic fixtures for G14 push notification token registration.
 * In-memory Map for device tokens; replay-safe via expo_token uniqueness.
 */
import type { NotificationRepositories } from '@/features/notifications/data/repositories';
import type { RegisterTokenResult, UnregisterTokenResult } from '@/features/notifications/domain/types';

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function createNotificationFixtures({ latencyMs = 350 }: { latencyMs?: number } = {}): NotificationRepositories {
  const tokens = new Map<string, { tokenId: string; platform: string; appBuild: string | null; createdAt: string }>();
  let counter = 0;

  return {
    deviceTokens: {
      async register(token, platform, appBuild): Promise<RegisterTokenResult> {
        await wait(latencyMs);
        const existing = tokens.get(token);
        if (existing) {
          return { tokenId: existing.tokenId, created: false };
        }
        counter += 1;
        const tokenId = `syn-token-${counter}`;
        tokens.set(token, { tokenId, platform, appBuild: appBuild ?? null, createdAt: new Date().toISOString() });
        return { tokenId, created: true };
      },
      async unregister(token): Promise<UnregisterTokenResult> {
        await wait(latencyMs);
        const had = tokens.delete(token);
        return { deleted: had };
      },
    },
    pushFlag: {
      async enabled() {
        return false;
      },
    },
  };
}
