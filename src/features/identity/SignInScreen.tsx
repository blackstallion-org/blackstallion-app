import { useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import type { CodeRequestResult, ResetResult, SignInResult } from '@/core/auth/accessAdapter';

import { HelpSheet } from '@/features/settings/HelpSupport';
import { AppText, Button, StatusMessage, TextField } from '@/ui/components';

import { useAccess } from './AccessProvider';
import { AuthFrame } from './AuthFrame';
import { pendingVerification, providerEmailOtp, type OtpBoundary } from './otp';

/** SH-01 copy that is new with the glass layout (EN; centralised later with the string catalogue). */
const SIGN_IN_COPY = {
  existingOnly: 'No account yet? Families register on the academy website; staff are invited by the academy.',
  help: 'Need help signing in?',
  previewCode: 'Preview the code screen (development)',
} as const;

const isIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

// G3 copy (EN). Moving these into design/i18n/strings.tsv with reviewed HI/TE is a recorded open item.
const SIGN_IN_ERRORS: Record<Exclude<SignInResult, { ok: true }>['reason'], string> = {
  invalid: "That e-mail and password don't match. Check them and try again.",
  network: "Can't reach the academy service. Check your connection and try again.",
  unavailable: "Sign-in isn't available right now. Please try again later.",
};
const CODE_ERRORS: Record<Exclude<SignInResult, { ok: true }>['reason'], string> = {
  invalid: "That code didn't work. It may have expired; check it or ask for a new one.",
  network: SIGN_IN_ERRORS.network,
  unavailable: SIGN_IN_ERRORS.unavailable,
};
const REQUEST_ERRORS: Record<Exclude<CodeRequestResult, { ok: true }>['reason'], string> = {
  network: SIGN_IN_ERRORS.network,
  unavailable: "We can't send a code right now. Please wait a few minutes and try again.",
};
const RESET_ERRORS: Record<Exclude<ResetResult, { ok: true }>['reason'], string> = {
  invalid: CODE_ERRORS.invalid,
  weakPassword: 'Choose a longer password (at least 8 characters). If you already used the code, ask for a new one.',
  network: SIGN_IN_ERRORS.network,
  unavailable: SIGN_IN_ERRORS.unavailable,
};
const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());
const MIN_PASSWORD = 8; // UX hint; the server's password policy is authoritative

/** One request at a time, even with a fast double tap. */
function useSingleFlight() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * S01. With a connected backend (G3) people sign in with e-mail + password or an e-mail code, and can reset a
 * forgotten password with an e-mail code (D07, signed 4 Nov 2026). Phone codes and Google come next. Without a
 * backend the phone layout stays and says plainly that sign-in is not connected.
 */
export function SignInScreen({ devPanel, devOtpPreview }: { devPanel?: ReactNode; devOtpPreview?: OtpBoundary }) {
  const access = useAccess();
  const [mode, setMode] = useState<'password' | 'code' | 'reset'>('password');
  const emailOtp = providerEmailOtp(access);
  // A connected build never shows the synthetic persona panel or the synthetic code preview.
  if (!access.signInWithPassword) return <PhoneLayoutNotConnected devPanel={devPanel} devOtpPreview={emailOtp ? undefined : devOtpPreview} />;
  if (mode === 'code' && emailOtp) {
    return <EmailCodeSignIn otp={emailOtp} onBack={() => setMode('password')} />;
  }
  if (mode === 'reset' && access.requestPasswordReset && access.completePasswordReset) {
    return <PasswordReset request={access.requestPasswordReset} complete={access.completePasswordReset} onBack={() => setMode('password')} />;
  }
  return (
    <PasswordSignIn
      signIn={access.signInWithPassword}
      onUseCode={access.requestEmailCode ? () => setMode('code') : undefined}
      onForgot={access.requestPasswordReset ? () => setMode('reset') : undefined}
    />
  );
}

/** SH-01 frame: the shared signed-out frame plus the existing-accounts note and a Help entry (SH-09 public variant). */
function SignInFrame({ testID, subtitle, children, after }: { testID: string; subtitle: string; children: ReactNode; after?: ReactNode }) {
  const [help, setHelp] = useState(false);
  return (
    <AuthFrame testID={testID} subtitle={subtitle}>
      {children}
      <Button testID="sign-in-help" variant="ghost" icon="help-buoy-outline" label={SIGN_IN_COPY.help} onPress={() => setHelp(true)} />
      {after}
      <HelpSheet visible={help} onClose={() => setHelp(false)} />
    </AuthFrame>
  );
}

function ExistingAccountsOnly() {
  return (
    <AppText variant="secondary" tone="muted">
      {SIGN_IN_COPY.existingOnly}
    </AppText>
  );
}

function EmailField({ value, onChange, testID = 'email' }: { value: string; onChange: (t: string) => void; testID?: string }) {
  return (
    <TextField
      testID={testID}
      label="E-mail"
      keyboardType="email-address"
      textContentType="username"
      autoComplete="email"
      autoCapitalize="none"
      autoCorrect={false}
      value={value}
      onChangeText={onChange}
      returnKeyType="next"
    />
  );
}

function CodeField({ value, onChange, onSubmit }: { value: string; onChange: (t: string) => void; onSubmit?: () => void }) {
  return (
    <TextField
      testID="code"
      label="6-digit code"
      hint="From the e-mail we just sent"
      keyboardType="number-pad"
      textContentType="oneTimeCode" // → GlassInput OTP variant: one-time-code (iOS) / sms-otp (Android) autofill
      maxLength={6}
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, ''))}
      returnKeyType="go"
      onSubmitEditing={onSubmit}
    />
  );
}

function PasswordSignIn({
  signIn,
  onUseCode,
  onForgot,
}: {
  signIn: (email: string, password: string) => Promise<SignInResult>;
  onUseCode?: () => void;
  onForgot?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSingleFlight();
  const submit = async () => {
    if (!isEmail(email) || password.length === 0) {
      setError('Enter your e-mail address and password.');
      return;
    }
    setError(null);
    const r = await run(() => signIn(email, password));
    // On success the access provider reloads and navigation leaves this screen; the password is not kept.
    if (r?.ok) setPassword('');
    else if (r) setError(SIGN_IN_ERRORS[r.reason]);
  };
  return (
    <SignInFrame testID="sign-in" subtitle="Sign in with the e-mail and password you use on the academy website.">
      <EmailField value={email} onChange={(t) => { setEmail(t); setError(null); }} />
      <TextField
        testID="password"
        label="Password"
        secureTextEntry
        textContentType="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          setError(null);
        }}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error ? <StatusMessage testID="sign-in-error" tone="danger" title="Not signed in" message={error} /> : null}
      <Button testID="sign-in-submit" label="Sign in" loading={busy} onPress={() => void submit()} />
      {onForgot ? <Button testID="forgot-password" variant="ghost" label="Forgot password?" onPress={onForgot} /> : null}
      {onUseCode ? <Button testID="use-email-code" variant="secondary" label="Sign in with an e-mail code instead" onPress={onUseCode} /> : null}
      <ExistingAccountsOnly />
    </SignInFrame>
  );
}

/**
 * SH-01 e-mail code request. On "Send code" the address is kept in memory only (never in the URL) and SH-02
 * `/verify` takes over: code entry, paste/autofill, resend cooldown and safe errors.
 */
function EmailCodeSignIn({ otp, onBack }: { otp: OtpBoundary; onBack: () => void }) {
  const router = useRouter();
  const pending = pendingVerification.get();
  // Coming back from SH-02 ("change e-mail"): the address this person just typed, never a previous person's.
  const [email, setEmail] = useState(pending?.channel === 'email' && pending.boundaryKind === otp.kind ? pending.address : '');
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSingleFlight();
  const send = async () => {
    if (!isEmail(email)) return setError('Enter your e-mail address.');
    setError(null);
    const r = await run(() => otp.request(email));
    if (r?.ok) {
      pendingVerification.set({ channel: 'email', address: email, boundaryKind: otp.kind, sentAt: Date.now() });
      router.push('/verify');
    } else if (r) setError(REQUEST_ERRORS[r.reason]);
  };
  return (
    <SignInFrame testID="sign-in-code" subtitle="We'll e-mail you a 6-digit code to sign in.">
      <EmailField value={email} onChange={(t) => { setEmail(t); setError(null); }} />
      {error ? <StatusMessage testID="sign-in-error" tone="danger" title="Code not sent" message={error} /> : null}
      <Button testID="send-email-code" label="Send code" loading={busy} onPress={() => void send()} />
      <Button testID="back-to-password" variant="ghost" label="Use my password instead" onPress={onBack} />
    </SignInFrame>
  );
}

function PasswordReset({
  request,
  complete,
  onBack,
}: {
  request: (email: string) => Promise<CodeRequestResult>;
  complete: (email: string, code: string, newPassword: string) => Promise<ResetResult>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSingleFlight();
  const send = async () => {
    if (!isEmail(email)) return setError('Enter your e-mail address.');
    setError(null);
    const r = await run(() => request(email));
    if (r?.ok) setSentTo(email.trim());
    else if (r) setError(REQUEST_ERRORS[r.reason]);
  };
  const submit = async () => {
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    if (pw.length < MIN_PASSWORD) return setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
    if (pw !== pw2) return setError("The two passwords don't match.");
    setError(null);
    const r = await run(() => complete(sentTo, code, pw));
    if (r && !r.ok) {
      setError(RESET_ERRORS[r.reason]);
      if (r.reason === 'weakPassword') { setCode(''); setSentTo(null); } // the code was used: start again
    } // success: signed in with the new password; the provider reloads and navigation leaves
  };
  return (
    <SignInFrame testID="password-reset" subtitle={sentTo ? 'Enter the code and choose a new password.' : "We'll e-mail you a code to reset your password."}>
      {sentTo ? (
        <>
          <StatusMessage testID="reset-sent" tone="info" title="Check your e-mail" message={`If ${sentTo} has an account, we've sent a code to it.`} />
          <CodeField value={code} onChange={(t) => { setCode(t); setError(null); }} />
          <TextField testID="new-password" label="New password" hint={`At least ${MIN_PASSWORD} characters`} secureTextEntry
            textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false}
            value={pw} onChangeText={(t) => { setPw(t); setError(null); }} />
          <TextField testID="confirm-password" label="Confirm new password" secureTextEntry textContentType="newPassword"
            autoComplete="new-password" autoCapitalize="none" autoCorrect={false} value={pw2}
            onChangeText={(t) => { setPw2(t); setError(null); }} returnKeyType="go" onSubmitEditing={() => void submit()} />
          {error ? <StatusMessage testID="reset-error" tone="danger" title="Password not changed" message={error} /> : null}
          <Button testID="reset-submit" label="Set new password" loading={busy} onPress={() => void submit()} />
        </>
      ) : (
        <>
          <EmailField value={email} onChange={(t) => { setEmail(t); setError(null); }} />
          {error ? <StatusMessage testID="reset-error" tone="danger" title="Code not sent" message={error} /> : null}
          <Button testID="send-reset-code" label="Send code" loading={busy} onPress={() => void send()} />
        </>
      )}
      <Button testID="back-to-password" variant="ghost" label="Back to sign in" onPress={onBack} />
    </SignInFrame>
  );
}

function PhoneLayoutNotConnected({ devPanel, devOtpPreview }: { devPanel?: ReactNode; devOtpPreview?: OtpBoundary }) {
  const router = useRouter();
  const pending = pendingVerification.get();
  const [number, setNumber] = useState(pending?.channel === 'phone' && devOtpPreview ? pending.address.replace(/^\+91\s?/, '') : '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  return (
    <SignInFrame testID="sign-in" subtitle="Sign in with the mobile number your academy has on file." after={devPanel}>
      <TextField
        testID="mobile-number"
        label="Mobile number"
        hint="10 digits, India (+91)"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={10}
        value={number}
        error={error}
        onChangeText={(t) => {
          setNumber(t.replace(/\D/g, ''));
          setError(null);
          setNotice(false);
        }}
        returnKeyType="done"
      />
      <Button
        testID="send-code"
        label="Send code"
        onPress={() => {
          if (!isIndianMobile(number)) {
            setError('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.');
            return;
          }
          setNotice(true);
        }}
      />
      {notice ? (
        <StatusMessage
          testID="sign-in-not-connected"
          tone="info"
          title="Sign-in is not connected in this build"
          message="Codes are not sent yet. Real sign-in arrives in the next gate (G3)."
        />
      ) : null}
      {notice && devOtpPreview ? (
        <Button
          testID="preview-verify"
          variant="secondary"
          icon="flask-outline"
          label={SIGN_IN_COPY.previewCode}
          onPress={async () => {
            // Development only: the synthetic boundary sends nothing; SH-02 says so on screen.
            const r = await devOtpPreview.request(`+91 ${number}`);
            if (!r.ok) return;
            pendingVerification.set({ channel: 'phone', address: `+91 ${number}`, boundaryKind: devOtpPreview.kind, sentAt: Date.now() });
            router.push('/verify');
          }}
        />
      ) : null}
      <ExistingAccountsOnly />
    </SignInFrame>
  );
}
