// Node has no expo-sqlite native module: the staging suites run the outbox in memory (openQueueStore falls back).
// Durability itself is covered by src/features/sync/__tests__/openQueueStore.test.ts and the G5 failure-injection suites.
export function openDatabaseSync(): never {
  throw new Error('expo-sqlite is not available in the Node staging harness');
}
