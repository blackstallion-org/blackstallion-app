/**
 * SH-02 one-time-code boundary and the in-memory "code sent to …" handoff between SH-01 and SH-02.
 *
 * - Real path: the access adapter's `requestEmailCode`/`verifyEmailCode` (core/auth Supabase adapter →
 *   `auth.signInWithOtp({ shouldCreateUser: false })` / `auth.verifyOtp({ type: 'email' })`). Success is reported by
 *   the adapter's session notification, which re-runs the boot sequence (access snapshot) — this screen never routes
 *   to a home by itself.
 * - Development preview: a synthetic boundary from `src/dev/fixtures/account.ts` (no code is sent; the screen says so).
 *
 * The address never goes into a URL (no personal data in links): SH-01 stores it here, SH-02 reads it, and it is
 * cleared on success, on "change address", on sign-out and on a user switch.
 */
import type { CodeRequestResult, SignInResult } from '@/core/auth/accessAdapter';
import { registerSignOutCleanup } from '@/core/auth/signOutCleanup';

export type OtpChannel = 'email' | 'phone';

export interface OtpBoundary {
  /** 'provider' = a real identity provider; 'synthetic-preview' = development only, sends nothing. */
  readonly kind: 'provider' | 'synthetic-preview';
  readonly channel: OtpChannel;
  /** Never reveals whether an account exists for the address. */
  request(address: string): Promise<CodeRequestResult>;
  /** `invalid` covers wrong, expired AND unknown-account codes alike (no enumeration). */
  verify(address: string, code: string): Promise<SignInResult>;
}

/** Builds the real boundary from the adapter methods the access provider exposes (e-mail code, D07). */
export function providerEmailOtp(access: {
  requestEmailCode?: (email: string) => Promise<CodeRequestResult>;
  verifyEmailCode?: (email: string, code: string) => Promise<SignInResult>;
}): OtpBoundary | null {
  const { requestEmailCode, verifyEmailCode } = access;
  if (!requestEmailCode || !verifyEmailCode) return null;
  return { kind: 'provider', channel: 'email', request: requestEmailCode, verify: verifyEmailCode };
}

/** Resend cooldown (SCREEN_REGISTER SH-02: "Resend after 0:30"). */
export const RESEND_COOLDOWN_MS = 30_000;
/** After this many wrong codes in a row the screen asks for a new code (the provider enforces its own lock). */
export const MAX_WRONG_CODES = 5;
export const OTP_LENGTH = 6;

/**
 * Digits from typed, autofilled or pasted text: "123 456", "Your code is 123456." → "123456". Only the first six
 * digits are kept, so a pasted message with a trailing number ("… expires in 10 minutes") still yields the code.
 */
export const extractCode = (text: string): string => text.replace(/\D/g, '').slice(0, OTP_LENGTH);
export const isCompleteCode = (code: string): boolean => new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);

/** "0:30", "0:05". */
export const formatCountdown = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type PendingVerification = {
  channel: OtpChannel;
  address: string;
  boundaryKind: OtpBoundary['kind'];
  /** Local clock time the last code was requested, for the resend cooldown. */
  sentAt: number;
};

let pending: PendingVerification | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const pendingVerification = {
  get: (): PendingVerification | null => pending,
  set(next: PendingVerification): void {
    pending = { ...next, address: next.address.trim() };
    notify();
  },
  /** Restart the cooldown after a resend. */
  markResent(at: number): void {
    if (pending) {
      pending = { ...pending, sentAt: at };
      notify();
    }
  },
  clear(): void {
    if (pending) {
      pending = null;
      notify();
    }
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// The address typed by one person must never be shown to the next one.
registerSignOutCleanup(() => pendingVerification.clear());
