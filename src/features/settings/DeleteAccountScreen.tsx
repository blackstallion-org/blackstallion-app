import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useScopedResource } from '@/core/data/useScopedResource';
import { NOT_CONNECTED, useAccountScope, usePendingWork } from '@/features/account/hooks';
import {
  confirmationMatches,
  DELETE_CONFIRM_WORD,
  isOpenRequest,
  MAX_DELETION_REASON,
  normaliseReason,
  requestReference,
  type DeletionRequest,
  type DeletionStatus,
} from '@/features/account/domain/deletion';
import type { AccountStrings } from '@/features/account/i18n/strings';
import { useAccountStrings } from '@/features/account/i18n/useAccountStrings';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { latchOperation, type OperationLatch } from '@/features/field/domain/operation';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';
import { AppText, Icon } from '@/ui/components';
import {
  ConfirmDialog,
  ErrorState,
  GlassButton,
  GlassInput,
  GlassScreen,
  GlassSurface,
  ListGroup,
  LoadingState,
  PermissionDeniedState,
  Row,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
  type StatusTone,
} from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { radius, space } from '@/ui/tokens';

import { useSafeBack } from './navigation';
import { SignOutControl } from './SignOutSheet';

type Notice = { tone: 'info' | 'warning' | 'danger'; message: string };

const STATUS_TONE: Record<DeletionStatus, StatusTone> = { requested: 'info', in_review: 'warning', completed: 'success', rejected: 'danger', cancelled: 'neutral' };

/**
 * SH-10 Delete account (BACKEND_CONTRACT_V2 §3.5). A REQUEST, not a deletion: the consequences are stated, the person
 * types a confirmation word, and the server request is replay-safe. The latest request (also after reinstall) is
 * shown with its status; "Cancel request" while it is still `requested`. Nothing claims data was deleted.
 */
export function DeleteAccountScreen() {
  const s = useAccountStrings();
  const back = useSafeBack('/settings');
  const { subject, contextKey } = useAccountScope();
  const synthetic = useAuthorizedAccess().state.session.source === 'synthetic-preview';
  const account = useRepositories().account;
  const status = useScopedResource(`${contextKey}:deletion`, async () => {
    if (!account) throw new FieldCommandError('unexpected', 'Not connected', NOT_CONNECTED);
    return account.deletion.status(subject);
  });

  let body;
  if (!account) body = <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('common.notConnectedBody')} testID="deletion-unavailable" />;
  else if (status.status === 'loading') body = <LoadingState label={s.t('deletion.loadingLabel')} rows={2} testID="deletion-loading" />;
  else if (status.status === 'error') {
    body =
      status.reference === '42501' ? (
        <PermissionDeniedState title={s.t('common.deniedTitle')} message={s.t('common.deniedBody')} testID="deletion-denied" />
      ) : (
        <ErrorState title={s.t('common.loadErrorTitle')} message={s.t('common.loadError')} onRetry={status.retry} details={status.reference ? s.t('common.reference', { ref: status.reference }) : undefined} testID="deletion-error" />
      );
  } else body = <DeletionFlow key={contextKey} initial={status.data} s={s} onBack={back} />;

  return (
    <GlassScreen testID="delete-account" keyboard header={{ onBack: back, backLabel: s.t('common.back') }}>
      <AppText variant="title" header>
        {s.t('deletion.title')}
      </AppText>
      {synthetic && account ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      {body}
    </GlassScreen>
  );
}

function DeletionFlow({ initial, s, onBack }: { initial: DeletionRequest | null; s: AccountStrings; onBack: () => void }) {
  const [request, setRequest] = useState(initial);
  const [notice, setNotice] = useState<Notice | null>(null);
  // No request yet → the form. Otherwise the latest request first (also cancelled/rejected ones), with "new request".
  const [form, setForm] = useState(initial === null);
  const show = (r: DeletionRequest, n: Notice | null) => {
    setRequest(r);
    setNotice(n);
    setForm(false);
  };
  if (request && !form) {
    const onNew = () => {
      setNotice(null);
      setForm(true);
    };
    return <RequestStatus request={request} s={s} notice={notice} onChange={show} onNew={request.status === 'completed' ? undefined : onNew} />;
  }
  return <RequestForm s={s} onBack={onBack} onDone={show} />;
}

function RequestForm({ s, onBack, onDone }: { s: AccountStrings; onBack: () => void; onDone: (r: DeletionRequest, n: Notice | null) => void }) {
  const { subject } = useAccountScope();
  const account = useRepositories().account;
  const { colors } = useTheme();
  const pending = usePendingWork(subject.subjectId);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const latch = useRef<OperationLatch | null>(null);
  const isGuardian = subject.allowedExperiences.includes('family');
  const ready = confirmationMatches(typed);

  const submit = async () => {
    if (!account || !ready) return;
    const r = normaliseReason(reason);
    // A retry with the same reason reuses the operation id: the server returns the original reply, never a second request.
    latch.current = latchOperation(latch.current, `delete:${r ?? ''}`);
    setError(null);
    try {
      const res = await account.deletion.request(subject, { reason: r, operationId: latch.current.operationId });
      latch.current = null;
      onDone(res, res.alreadyOpen ? { tone: 'info', message: s.t('deletion.alreadyOpen') } : null);
    } catch (e) {
      const kind = e instanceof FieldCommandError ? e.kind : 'unexpected';
      if (kind !== 'network') latch.current = null;
      setError(kind === 'network' ? s.t('deletion.errorNetwork') : s.t('deletion.errorOther'));
    }
  };

  return (
    <>
      <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.intro}>
        <View style={[styles.iconDisc, { backgroundColor: colors.dangerBg, borderColor: colors.border }]}>
          <Icon name="trash-outline" size={26} color={colors.dangerText} />
        </View>
        <AppText variant="section" header>
          {s.t('deletion.heading')}
        </AppText>
        <AppText tone="muted">{s.t('deletion.intro')}</AppText>
      </GlassSurface>

      <ListGroup title={s.t('deletion.whatHappens')} testID="deletion-consequences">
        <Row icon="people-outline" label={s.t('deletion.stepReviewTitle')} value={s.t('deletion.stepReview')} />
        <Row icon="key-outline" label={s.t('deletion.stepSignInTitle')} value={s.t('deletion.stepSignIn')} />
        {isGuardian ? <Row icon="document-lock-outline" label={s.t('deletion.stepChildrenTitle')} value={s.t('deletion.stepChildren')} /> : null}
        <Row icon="arrow-undo-outline" label={s.t('deletion.stepCancelTitle')} value={s.t('deletion.stepCancel')} />
      </ListGroup>

      {pending.count ? <StatusNote tone="warning" message={s.t('deletion.pendingWork', { count: pending.count })} testID="deletion-pending-work" /> : null}

      <GlassInput
        label={s.t('deletion.reasonLabel')}
        hint={s.t('deletion.reasonHint')}
        value={reason}
        onChangeText={(t) => setReason(t.slice(0, MAX_DELETION_REASON))}
        maxLength={MAX_DELETION_REASON}
        multiline
        testID="deletion-reason"
      />
      <GlassInput
        label={s.t('deletion.confirmLabel', { word: DELETE_CONFIRM_WORD })}
        hint={s.t('deletion.confirmHint')}
        value={typed}
        onChangeText={(t) => {
          setTyped(t);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="done"
        testID="deletion-confirm"
      />
      {error ? <StatusNote tone="danger" message={error} testID="deletion-submit-error" /> : null}
      <GlassButton variant="destructive" icon="trash-outline" label={s.t('deletion.submit')} disabled={!ready} onPress={submit} testID="deletion-submit" />
      <GlassButton variant="ghost" label={s.t('deletion.keep')} onPress={onBack} testID="deletion-keep" />
    </>
  );
}

function RequestStatus({
  request,
  s,
  notice,
  onChange,
  onNew,
}: {
  request: DeletionRequest;
  s: AccountStrings;
  notice: Notice | null;
  onChange: (r: DeletionRequest, n: Notice | null) => void;
  onNew?: () => void;
}) {
  const { subject } = useAccountScope();
  const account = useRepositories().account;
  const [confirming, setConfirming] = useState(false);
  const latch = useRef<OperationLatch | null>(null);
  const open = isOpenRequest(request);

  const cancel = async () => {
    if (!account) return;
    latch.current = latchOperation(latch.current, `cancel:${request.requestId}`);
    try {
      const res = await account.deletion.cancel(subject, { requestId: request.requestId, operationId: latch.current.operationId });
      latch.current = null;
      setConfirming(false);
      onChange(res, null);
    } catch (e) {
      const kind = e instanceof FieldCommandError ? e.kind : 'unexpected';
      setConfirming(false);
      if (kind === 'conflict') {
        latch.current = null;
        // The request moved on (e.g. now in review): show its latest status rather than guessing.
        const latest = await account.deletion.status(subject).catch(() => null);
        onChange(latest ?? request, { tone: 'warning', message: s.t('deletion.errorConflict') });
      } else {
        if (kind !== 'network') latch.current = null;
        onChange(request, { tone: 'danger', message: kind === 'network' ? s.t('deletion.errorNetwork') : s.t('deletion.errorOther') });
      }
    }
  };

  return (
    <>
      <GlassSurface material="thick" borderRadius={radius.hero} contentStyle={styles.intro} testID="deletion-status">
        <View style={styles.statusHead}>
          <AppText variant="section" header style={styles.flex}>
            {s.t('deletion.statusTitle')}
          </AppText>
          <StatusBadge label={s.t(`deletion.status.${request.status}`)} tone={STATUS_TONE[request.status]} testID={`deletion-status-${request.status}`} />
        </View>
        <AppText tone="muted">{s.t(`deletion.statusBody.${request.status}`)}</AppText>
      </GlassSurface>
      {notice ? <StatusNote tone={notice.tone} message={notice.message} testID="deletion-notice" /> : null}
      <ListGroup>
        <Row icon="pricetag-outline" label={s.t('deletion.requestReference')} value={requestReference(request.requestId)} testID="deletion-reference" />
        <Row icon="calendar-outline" label={s.t('deletion.requestedOn')} value={s.date(request.requestedAt)} />
        {request.statusNote ? <Row icon="chatbox-ellipses-outline" label={s.t('deletion.note')} value={request.statusNote} /> : null}
      </ListGroup>
      {request.canCancel ? <GlassButton variant="secondary" icon="close-circle-outline" label={s.t('deletion.cancelRequest')} onPress={() => setConfirming(true)} testID="deletion-cancel" /> : null}
      {open ? <SignOutControl testID="deletion-sign-out" /> : null}
      {!open && onNew ? <GlassButton variant="ghost" label={s.t('deletion.newRequest')} onPress={onNew} testID="deletion-new" /> : null}
      <ConfirmDialog
        visible={confirming}
        title={s.t('deletion.cancelTitle')}
        message={s.t('deletion.cancelBody')}
        confirmLabel={s.t('deletion.cancelRequest')}
        cancelLabel={s.t('deletion.cancelKeep')}
        onConfirm={cancel}
        onCancel={() => setConfirming(false)}
        testID="deletion-cancel-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  intro: { padding: space.xl, gap: space.md },
  iconDisc: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
