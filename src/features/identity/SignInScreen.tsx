import { useRef, useState, type ReactNode } from 'react';
import type { CodeRequestResult, ResetResult, SignInResult } from '@/core/auth/accessAdapter';
import { View } from 'react-native';

import { AppText, Button, Screen, StatusMessage, TextField } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

import { useAccess } from './AccessProvider';

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
export function SignInScreen({ devPanel }: { devPanel?: ReactNode }) {
  const access = useAccess();
  const [mode, setMode] = useState<'password' | 'code' | 'reset'>('password');
  // A connected build never shows the synthetic persona panel.
  if (!access.signInWithPassword) return <PhoneLayoutNotConnected devPanel={devPanel} />;
  if (mode === 'code' && access.requestEmailCode && access.verifyEmailCode) {
    return <EmailCodeSignIn request={access.requestEmailCode} verify={access.verifyEmailCode} onBack={() => setMode('password')} />;
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

function Heading({ subtitle }: { subtitle: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
      <View style={{ width: 56, height: 2, backgroundColor: colors.accent }} />
      <AppText variant="title" header align="center">
        Black Stallion Academy
      </AppText>
      <AppText tone="muted" align="center">
        {subtitle}
      </AppText>
    </View>
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
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
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
    <Screen keyboard testID="sign-in">
      <Heading subtitle="Sign in with the e-mail and password you use on the academy website." />
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
      <AppText variant="caption" tone="muted" align="center">
        No account yet? Families register on the academy website; staff are invited by the academy.
      </AppText>
    </Screen>
  );
}

function EmailCodeSignIn({
  request,
  verify,
  onBack,
}: {
  request: (email: string) => Promise<CodeRequestResult>;
  verify: (email: string, code: string) => Promise<SignInResult>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
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
    setError(null);
    const r = await run(() => verify(sentTo, code));
    if (r && !r.ok) setError(CODE_ERRORS[r.reason]); // success: the provider reloads and navigation leaves
  };
  return (
    <Screen keyboard testID="sign-in-code">
      <Heading subtitle={sentTo ? 'Enter the code from your e-mail.' : "We'll e-mail you a 6-digit code to sign in."} />
      {sentTo ? (
        <>
          <StatusMessage testID="code-sent" tone="info" title="Check your e-mail" message={`If ${sentTo} has an account, we've sent a code to it.`} />
          <CodeField value={code} onChange={(t) => { setCode(t); setError(null); }} onSubmit={() => void submit()} />
          {error ? <StatusMessage testID="sign-in-error" tone="danger" title="Not signed in" message={error} /> : null}
          <Button testID="verify-code" label="Sign in" loading={busy} onPress={() => void submit()} />
          <Button testID="resend-code" variant="ghost" label="Send a new code" onPress={() => { setCode(''); setSentTo(null); }} />
        </>
      ) : (
        <>
          <EmailField value={email} onChange={(t) => { setEmail(t); setError(null); }} />
          {error ? <StatusMessage testID="sign-in-error" tone="danger" title="Code not sent" message={error} /> : null}
          <Button testID="send-email-code" label="Send code" loading={busy} onPress={() => void send()} />
        </>
      )}
      <Button testID="back-to-password" variant="ghost" label="Use my password instead" onPress={onBack} />
    </Screen>
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
    <Screen keyboard testID="password-reset">
      <Heading subtitle={sentTo ? 'Enter the code and choose a new password.' : "We'll e-mail you a code to reset your password."} />
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
    </Screen>
  );
}

function PhoneLayoutNotConnected({ devPanel }: { devPanel?: ReactNode }) {
  const { colors } = useTheme();
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  return (
    <Screen keyboard testID="sign-in">
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
        <View style={{ width: 56, height: 2, backgroundColor: colors.accent }} />
        <AppText variant="title" header align="center">
          Black Stallion Academy
        </AppText>
        <AppText tone="muted" align="center">
          Sign in with the mobile number your academy has on file.
        </AppText>
      </View>
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
      <AppText variant="caption" tone="muted" align="center">
        No account yet? Families register on the academy website; staff are invited by the academy.
      </AppText>
      {devPanel}
    </Screen>
  );
}
