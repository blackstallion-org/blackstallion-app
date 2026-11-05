import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SignInResult } from '@/core/auth/accessAdapter';
import { HelpSheet } from '@/features/settings/HelpSupport';
import { GlassButton, GlassInput, LoadingState, StatusNote, SyntheticDataBanner } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { AuthFrame } from './AuthFrame';
import {
  extractCode,
  formatCountdown,
  isCompleteCode,
  MAX_WRONG_CODES,
  OTP_LENGTH,
  pendingVerification,
  RESEND_COOLDOWN_MS,
  type OtpBoundary,
} from './otp';

/** SH-02 copy (EN, like SH-01; both join the string catalogue together). */
export const VERIFY_COPY = {
  title: 'Enter your code',
  sentEmail: (a: string) => `If ${a} has an account, we've sent a 6-digit code to it.`,
  sentPhone: (a: string) => `If ${a} is registered with the academy, we've sent a 6-digit code by SMS.`,
  codeLabel: '6-digit code',
  hintEmail: 'From the e-mail we just sent. You can paste the whole message.',
  hintPhone: 'From the SMS we just sent. Your phone may fill it in for you.',
  verify: 'Verify',
  resendIn: (t: string) => `Send a new code in ${t}`,
  resend: 'Send a new code',
  resent: 'If the address has an account, a new code is on its way. Use the newest code.',
  changeEmail: 'Change e-mail address',
  changePhone: 'Change mobile number',
  help: 'Get help',
  checking: 'Checking your access…',
  incomplete: `Enter all ${OTP_LENGTH} digits.`,
  // One message for wrong, expired AND unknown-account codes: it never says whether an account exists.
  errors: {
    invalid: "That code didn't work. It may have expired — check it or send a new code.",
    network: "Can't reach the academy service. Your code is kept — check your connection and try again.",
    unavailable: "Sign-in isn't available right now. Please try again in a few minutes.",
    tooMany: 'Too many attempts with this code. Send a new code to try again.',
    resendFailed: "We can't send a code right now. Please wait a few minutes and try again.",
  },
  restartTitle: 'Start again',
  restartBody: 'Enter your e-mail address or mobile number to get a code first.',
  restart: 'Go to sign-in',
  notConnected: "Sign-in isn't connected in this build, so no code can be checked.",
  preview: 'Development preview: no code was sent. Enter 123456 to continue, or 000000 to see the offline message.',
  previewAccepted: 'Code accepted (preview)',
  previewAcceptedBody: 'Synthetic preview only — no account was signed in. Choose a sample persona below.',
} as const;

type Failure = Exclude<SignInResult, { ok: true }>['reason'] | 'tooMany' | 'incomplete' | 'resendFailed';

/** Wall clock for the resend countdown, ticking once a second while the screen is open. */
const useNow = (): [number, () => void] => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return [now, () => setNow(Date.now())];
};

/**
 * SH-02 Verify code. Readable OTP field (large tabular digits, one-time-code autofill, paste of a whole message),
 * resend after 0:30, "change address", and safe errors that never reveal whether an account exists. A correct code
 * only ends the provider step: the access provider then loads the server snapshot and the boot gate routes
 * (FA-01 / FO-01 / SH-03 / SH-12). Nothing private renders here.
 */
export function VerifyCodeScreen({ boundary, devPanel }: { boundary: OtpBoundary | null; devPanel?: ReactNode }) {
  const router = useRouter();
  const pending = useSyncExternalStore(pendingVerification.subscribe, pendingVerification.get, pendingVerification.get);
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [wrong, setWrong] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [help, setHelp] = useState(false);
  const lastTried = useRef<string | null>(null);
  const inFlight = useRef(false);

  const [now, tick] = useNow();
  const left = pending ? Math.min(RESEND_COOLDOWN_MS, Math.max(0, pending.sentAt + RESEND_COOLDOWN_MS - now)) : 0;
  const locked = wrong >= MAX_WRONG_CODES;

  const changeAddress = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-in');
  };
  const header = { onBack: changeAddress, backLabel: pending?.channel === 'phone' ? VERIFY_COPY.changePhone : VERIFY_COPY.changeEmail };

  // A provider success re-runs the boot sequence; show a neutral wait, never a home, until it routes.
  if (checking) {
    return (
      <AuthFrame testID="verify-checking" title={VERIFY_COPY.title} subtitle={VERIFY_COPY.checking} compact>
        <LoadingState label={VERIFY_COPY.checking} rows={1} />
      </AuthFrame>
    );
  }

  if (previewAccepted) {
    return (
      <AuthFrame testID="verify-preview-accepted" title={VERIFY_COPY.previewAccepted} subtitle={VERIFY_COPY.previewAcceptedBody} compact header={header}>
        <SyntheticDataBanner text={VERIFY_COPY.preview} />
        {devPanel}
      </AuthFrame>
    );
  }

  if (!boundary || !pending || pending.boundaryKind !== boundary.kind) {
    return (
      <AuthFrame testID="verify-restart" title={VERIFY_COPY.restartTitle} subtitle={boundary ? VERIFY_COPY.restartBody : VERIFY_COPY.notConnected} compact header={{ onBack: changeAddress }}>
        <GlassButton testID="verify-restart-sign-in" label={VERIFY_COPY.restart} icon="arrow-back" onPress={() => router.replace('/sign-in')} />
      </AuthFrame>
    );
  }

  const submit = async (value: string) => {
    if (inFlight.current || locked) return;
    if (!isCompleteCode(value)) return setFailure('incomplete');
    inFlight.current = true;
    lastTried.current = value;
    setBusy(true);
    setFailure(null);
    setResent(false);
    try {
      const r = await boundary.verify(pending.address, value);
      if (r.ok) {
        // The address is no longer needed; the session (if any) is the provider's now.
        pendingVerification.clear();
        if (boundary.kind === 'synthetic-preview') setPreviewAccepted(true);
        else setChecking(true);
        return;
      }
      if (r.reason === 'invalid') {
        const n = wrong + 1;
        setWrong(n);
        setFailure(n >= MAX_WRONG_CODES ? 'tooMany' : 'invalid');
        setCode('');
      } else setFailure(r.reason); // network / unavailable: the code is kept
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const onChange = (text: string) => {
    const digits = extractCode(text);
    setCode(digits);
    if (failure === 'incomplete' || failure === 'invalid') setFailure(null);
    // Autofill or paste of a complete code verifies at once (once per distinct code).
    if (isCompleteCode(digits) && digits !== lastTried.current) void submit(digits);
  };

  const resend = async () => {
    if (left > 0 || resending) return;
    setResending(true);
    setFailure(null);
    try {
      const r = await boundary.request(pending.address);
      if (r.ok) {
        pendingVerification.markResent(Date.now());
        tick();
        setWrong(0);
        setCode('');
        lastTried.current = null;
        setResent(true);
      } else setFailure(r.reason === 'network' ? 'network' : 'resendFailed');
    } finally {
      setResending(false);
    }
  };

  const message = failure ? (failure === 'incomplete' ? VERIFY_COPY.incomplete : VERIFY_COPY.errors[failure]) : null;
  return (
    <AuthFrame
      testID="verify"
      title={VERIFY_COPY.title}
      subtitle={pending.channel === 'phone' ? VERIFY_COPY.sentPhone(pending.address) : VERIFY_COPY.sentEmail(pending.address)}
      compact
      header={header}
    >
      {boundary.kind === 'synthetic-preview' ? <SyntheticDataBanner text={VERIFY_COPY.preview} testID="verify-preview-banner" /> : null}
      <GlassInput
        testID="code"
        variant="otp"
        label={VERIFY_COPY.codeLabel}
        hint={pending.channel === 'phone' ? VERIFY_COPY.hintPhone : VERIFY_COPY.hintEmail}
        material="thick"
        value={code}
        onChangeText={onChange}
        // Paste of a whole message: the field takes it in full, the digits are extracted above.
        maxLength={undefined}
        editable={!locked}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={() => void submit(code)}
      />
      {message ? <StatusNote testID="verify-error" tone={failure === 'network' ? 'warning' : 'danger'} message={message} /> : null}
      {resent && !message ? <StatusNote testID="verify-resent" tone="info" message={VERIFY_COPY.resent} /> : null}
      <GlassButton testID="verify-code" label={VERIFY_COPY.verify} loading={busy} disabled={locked} onPress={() => submit(code)} />
      <View style={styles.row}>
        <GlassButton
          testID="resend-code"
          variant="ghost"
          icon="refresh"
          label={left > 0 ? VERIFY_COPY.resendIn(formatCountdown(left)) : VERIFY_COPY.resend}
          accessibilityHint={left > 0 ? undefined : VERIFY_COPY.resent}
          disabled={left > 0}
          loading={resending}
          onPress={resend}
        />
      </View>
      <GlassButton testID="change-address" variant="secondary" icon="create-outline" label={header.backLabel} onPress={changeAddress} />
      <GlassButton testID="verify-help" variant="ghost" icon="help-buoy-outline" label={VERIFY_COPY.help} onPress={() => setHelp(true)} />
      <HelpSheet visible={help} onClose={() => setHelp(false)} />
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
});
