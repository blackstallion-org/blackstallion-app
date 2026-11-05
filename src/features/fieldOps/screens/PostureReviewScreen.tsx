// FO-20 Posture review: asks the server whether posture analysis exists for this hub. In this delta the answer is
// always `unavailable` (no provider integrated), so the screen says why, states what is and is not done, and shows no
// landmarks, scores or confidence. Grading never waits for it (D24, D34).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { GlassScreen, ListGroup, Row, UnavailableState } from '@/ui/glass';
import { space } from '@/ui/tokens';

import type { FieldOpsRepositories } from '../data/repositories';
import type { FieldOpsScope } from '../domain/types';
import { backOr, useFieldOps, useFieldOpsT, useFieldResource } from '../hooks';
import type { Translator } from '../i18n/i18n';
import { NotConnected, Provenance, ResourceGate } from './parts';

export function PostureReviewRoute() {
  const params = useLocalSearchParams<{ mediaId?: string }>();
  const ctx = useFieldOps();
  const t = useFieldOpsT();
  const router = useRouter();
  const back = backOr(router, '/field');
  if (!ctx.repos) return <NotConnected t={t} header={{ onBack: back, title: t.t('fo.posture.title') }} testID="fo20-posture" />;
  // the media id is never used to fetch anything until a provider exists; it only must look like an id
  const mediaOk = typeof params.mediaId === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(params.mediaId) && !params.mediaId.includes('..');
  return <PostureReviewView repos={ctx.repos} scope={ctx.scope} contextKey={ctx.contextKey} mediaOk={mediaOk} t={t} onBack={back} />;
}

export function PostureReviewView({
  repos,
  scope,
  contextKey,
  mediaOk,
  t,
  onBack,
}: {
  repos: FieldOpsRepositories;
  scope: FieldOpsScope;
  contextKey: string;
  mediaOk: boolean;
  t: Translator;
  onBack: () => void;
}) {
  const r = useFieldResource(`${contextKey}:fo:posture`, () => repos.posture.capability(scope));
  return (
    <GlassScreen header={{ onBack, title: t.t('fo.posture.title'), backLabel: t.t('fo.common.back') }} testID="fo20-posture">
      <Provenance source={repos.source} t={t} />
      <ResourceGate r={r} t={t} loadingLabel={t.t('fo.posture.loading')} deniedMessage={t.t('fo.posture.denied')} testIDPrefix="fo20">
        {(cap) => (
          <View style={{ gap: space.lg }}>
            <UnavailableState title={t.t('fo.posture.unavailableTitle')} message={t.t(`fo.posture.reason.${cap.reason}`)} testID="fo20-unavailable" />
            <ListGroup title={t.t('fo.posture.whatTitle')} testID="fo20-limits">
              <Row icon="videocam-outline" label={t.t('fo.posture.clip')} value={mediaOk ? t.t('fo.posture.clipKept') : t.t('fo.posture.clipUnknown')} />
              <Row icon="create-outline" label={t.t('fo.posture.grading')} value={t.t('fo.posture.gradingBody')} />
              <Row icon="eye-off-outline" label={t.t('fo.posture.noResult')} value={t.t('fo.posture.noResultBody')} />
              <Row icon="document-text-outline" label={t.t('fo.posture.decision')} value={t.t('fo.posture.decisionBody')} />
            </ListGroup>
          </View>
        )}
      </ResourceGate>
    </GlassScreen>
  );
}
