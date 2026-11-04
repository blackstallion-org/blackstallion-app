import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { AppText, Button, Screen, StatusMessage, TextField } from '@/ui/components';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

const isIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/**
 * S01 layout. Real OTP sign-in is G3 (D07 still PROPOSED), so this build does
 * not send codes; it says so instead of pretending.
 */
export function SignInScreen({ devPanel }: { devPanel?: ReactNode }) {
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
