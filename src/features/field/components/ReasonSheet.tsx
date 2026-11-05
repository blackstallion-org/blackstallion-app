import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';

import { GlassBottomSheet, GlassButton, GlassInput } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { codePointLength, REASON_MAX, REASON_MIN, validateReason } from '../domain/assessment';
import { useFieldStrings } from '../i18n';

/** Keeps the sheet's input and buttons above the software keyboard (the shared sheet has no keyboard inset). */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/**
 * FO-16 Reason: one required reason for a correction (and later void/reject, SD-05/FO-18). Mirrors the server rule
 * (3–500 characters after trimming, MIG:463-465); the server still checks it and stores it in the audit history.
 * The sheet only collects the reason; the caller submits.
 */
export function ReasonSheet({
  visible,
  title,
  description,
  submitLabel,
  onSubmit,
  onCancel,
  testID = 'reason-sheet',
}: {
  visible: boolean;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  testID?: string;
}) {
  const s = useFieldStrings();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const kb = useKeyboardHeight();
  // A reason belongs to one action: closing the sheet either way clears it.
  const clear = () => {
    setText('');
    setError(null);
  };
  const cancel = () => {
    clear();
    onCancel();
  };
  const submit = () => {
    const e = validateReason(text);
    if (e) {
      setError(e === 'short' ? s.t('reason.short', { min: REASON_MIN }) : s.t('reason.long', { max: REASON_MAX }));
      return;
    }
    const reason = text.trim();
    clear();
    onSubmit(reason);
  };
  return (
    <GlassBottomSheet visible={visible} onClose={cancel} title={title} description={description} closeLabel={s.t('common.cancel')} testID={testID}>
      <GlassInput
        label={s.t('reason.label')}
        hint={s.t('reason.count', { count: codePointLength(text.trim()), max: REASON_MAX })}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (error) setError(null);
        }}
        multiline
        maxLength={REASON_MAX * 2}
        error={error}
        autoFocus={Platform.OS !== 'web'}
        testID={`${testID}-input`}
      />
      <View style={styles.actions}>
        <GlassButton label={submitLabel} icon="checkmark" onPress={submit} testID={`${testID}-submit`} />
        <GlassButton variant="secondary" label={s.t('common.cancel')} onPress={cancel} testID={`${testID}-cancel`} />
      </View>
      {kb > 0 ? <View style={{ height: kb }} /> : null}
    </GlassBottomSheet>
  );
}

const styles = StyleSheet.create({ actions: { gap: space.sm, marginTop: space.sm } });
