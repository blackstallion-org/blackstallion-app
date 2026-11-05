/**
 * Sign-out / user-switch cleanup registry (SEC-001, SH-06 acceptance: "logged-out device shows no former user's
 * data"). Modules that keep anything private in memory outside React state (profile header cache, the address a
 * code was sent to, …) register a cleanup here. The access provider runs every cleanup when a person signs out,
 * when the session ends on its own, and when a different person signs in on this device.
 *
 * Additive to the G3 adapter: `AccessAdapter.signOut()` still owns tokens and the keystore; this only clears app
 * caches. A cleanup must be quick, must not throw (failures are swallowed so one bad cleanup can't keep another
 * person's data on screen) and must not touch the network.
 */
export type SignOutCleanup = () => void | Promise<void>;

const cleanups = new Set<SignOutCleanup>();

/** Registers a cleanup; returns an unregister function (tests, hot reload). */
export function registerSignOutCleanup(fn: SignOutCleanup): () => void {
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

/** Runs every registered cleanup once, in parallel. Never rejects. */
export async function runSignOutCleanups(): Promise<void> {
  await Promise.all(
    Array.from(cleanups, async (fn) => {
      try {
        await fn();
      } catch {
        // A failing cleanup must not stop the others (or the sign-out itself).
      }
    }),
  );
}

/** Test helper: number of registered cleanups. */
export const registeredSignOutCleanupCount = (): number => cleanups.size;
