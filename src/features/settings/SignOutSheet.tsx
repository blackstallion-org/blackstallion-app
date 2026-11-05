import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePendingWork } from '@/features/account/hooks';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { AppText } from '@/ui/components';
import { GlassBottomSheet, GlassButton, GlassDialog, StatusNote } from '@/ui/glass';
import { space } from '@/ui/tokens';

import { SHARED_ROUTES } from './navigation';

type Step = 'closed' | 'dialog' | 'pending' | 'discard';

/**
 * SH-06 Sign out (13 S04; SCREEN_REGISTER SH-06). The button checks this person's unsent local work first:
 * - nothing pending (or no outbox in this build) → a plain confirmation dialog;
 * - items pending → a bottom sheet with Send them first (Field Ops → FO-12), Sign out and keep them (they stay locked
 *   to this account), or Discard (a second, explicit step with the consequence) when the outbox supports it.
 * Signing out clears this person's cached data (AccessProvider → signOutCleanup) before the adapter ends the session.
 */
export function SignOutControl({ testID = 'sign-out' }: { testID?: string }) {
  const s = useAccountStrings();
  const access = useAuthorizedAccess();
  const router = useRouter();
  const subjectId = access.state.session.subjectId;
  const pending = usePendingWork(subjectId);
  const [step, setStep] = useState<Step>('closed');
  const [busy, setBusy] = useState(false);
  const count = pending.count ?? 0;
  const inField = access.state.experience === 'field';

  const open = async () => {
    const n = await pending.refresh();
    setStep(n > 0 ? 'pending' : 'dialog');
  };
  const signOut = async (discard = false) => {
    setBusy(true);
    try {
      if (discard) await pending.port?.discard?.(subjectId);
    } finally {
      // The authorized tree unmounts as soon as the provider is signed out; nothing of this person stays rendered.
      await access.signOut();
    }
  };
  const close = () => {
    if (!busy) setStep('closed');
  };

  return (
    <>
      <GlassButton testID={testID} variant="secondary" icon="log-out-outline" label={s.t('common.signOut')} onPress={open} />

      <GlassDialog
        visible={step === 'dialog'}
        onClose={close}
        dismissible={!busy}
        title={s.t('signOut.title')}
        message={s.t('signOut.body')}
        testID="sign-out-dialog"
        actions={
          <>
            <GlassButton testID="sign-out-confirm" icon="log-out-outline" label={busy ? s.t('signOut.signingOut') : s.t('signOut.confirm')} loading={busy} onPress={() => signOut(false)} />
            <GlassButton testID="sign-out-cancel" variant="secondary" label={s.t('common.cancel')} disabled={busy} onPress={close} />
          </>
        }
      />

      <GlassBottomSheet
        visible={step === 'pending' || step === 'discard'}
        onClose={close}
        dismissible={!busy}
        title={step === 'discard' ? s.t('signOut.discardTitle') : s.t('signOut.pendingTitle')}
        description={step === 'discard' ? s.t('signOut.discardBody', { count }) : s.t('signOut.pendingCount', { count })}
        closeLabel={s.t('common.close')}
        testID="sign-out-sheet"
        actions={
          step === 'discard' ? (
            <>
              <GlassButton testID="sign-out-discard-confirm" variant="destructive" icon="trash-outline" label={s.t('signOut.discard')} loading={busy} onPress={() => signOut(true)} />
              <GlassButton testID="sign-out-discard-back" variant="secondary" label={s.t('common.back')} disabled={busy} onPress={() => setStep('pending')} />
            </>
          ) : (
            <>
              {inField ? (
                <GlassButton
                  testID="sign-out-send-first"
                  icon="cloud-upload-outline"
                  label={s.t('signOut.sendFirst')}
                  disabled={busy}
                  onPress={() => {
                    setStep('closed');
                    router.push(SHARED_ROUTES.fieldSync);
                  }}
                />
              ) : null}
              <GlassButton testID="sign-out-keep" variant={inField ? 'secondary' : 'primary'} icon="lock-closed-outline" label={s.t('signOut.keep')} loading={busy} onPress={() => signOut(false)} />
              {pending.canDiscard ? (
                <GlassButton testID="sign-out-discard" variant="destructive" icon="trash-outline" label={s.t('signOut.discard')} disabled={busy} onPress={() => setStep('discard')} />
              ) : null}
              <GlassButton testID="sign-out-sheet-cancel" variant="ghost" label={s.t('common.cancel')} disabled={busy} onPress={close} />
            </>
          )
        }
      >
        {step === 'pending' ? (
          <View style={styles.body}>
            <AppText variant="secondary" tone="muted">
              {pending.durable ? s.t('signOut.keepBody') : s.t('signOut.keepBodyMemory')}
            </AppText>
            <StatusNote tone="info" message={s.t('signOut.pendingOffline')} />
          </View>
        ) : null}
      </GlassBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
});
