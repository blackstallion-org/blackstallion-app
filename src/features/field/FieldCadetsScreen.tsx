import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useScopedResource } from '@/core/data/useScopedResource';
import { AppText } from '@/ui/components';
import { EmptyState, GlassInput, GlassScreen, GlassSurface, ListGroup, LoadingState, PermissionDeniedState, Row, SegmentedControl, StatusBadge, SyntheticDataBanner, UnavailableState } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { LoadFailure } from './components/LoadStates';
import { Trailing } from './components/Trailing';
import type { HubCadet } from './data/repositories';
import { useFieldStrings, type FieldTranslator } from './i18n';
import { useFieldAccess } from './useFieldAccess';

type Filter = 'all' | 'in' | 'todo';

/** Case- and accent-insensitive name match on every word the person typed. */
export function matchesQuery(name: string, query: string): boolean {
  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(name);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => n.includes(w));
}

const rankLabel = (s: FieldTranslator, r: HubCadet['rank']) => (r ? s.t(`ranks.${r}`) : s.t('ranks.none'));

function todayBadge(c: HubCadet, s: FieldTranslator) {
  if (!c.today) return null;
  if (c.today.published === true) return <StatusBadge label={s.t('cadets.published')} tone="success" />;
  return <StatusBadge label={s.t('cadets.todayIn', { time: c.today.time })} tone="info" icon="log-in-outline" />;
}

/**
 * FO-05 Cadets: every enrolled cadet of the caller's hub (the server lists nothing else, even by search), with
 * today's state. Search filters this list on the phone; rows open FO-06.
 */
export function FieldCadetsScreen() {
  const s = useFieldStrings();
  const router = useRouter();
  const { scope, contextKey, fieldApp, canViewCadets } = useFieldAccess();
  const list = useScopedResource(`${contextKey}:cadets`, () => (fieldApp && canViewCadets ? fieldApp.cadets.list(scope) : Promise.resolve(null)));
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [filter, setFilter] = useState<Filter>('all');
  const first = useRef(true);
  const { retry } = list;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      retry();
    }, [retry]),
  );

  const shown = useMemo(() => {
    if (list.status !== 'ready' || !list.data) return [];
    return list.data.cadets.filter(
      (c) => matchesQuery(c.name, deferred) && (filter === 'all' || (filter === 'in' ? !!c.today : !!c.today && c.today.published === false)),
    );
  }, [list, deferred, filter]);

  const title = (
    <View style={styles.header}>
      <AppText variant="title" header>
        {s.t('cadets.title')}
      </AppText>
      {list.status === 'ready' && list.data ? (
        <AppText tone="muted" testID="cadets-subtitle">
          {s.tn('cadets.subtitle', list.data.cadets.length, { hub: list.data.hubName })}
        </AppText>
      ) : null}
    </View>
  );

  if (!canViewCadets) {
    return (
      <GlassScreen edges={['top', 'left', 'right']} testID="field-cadets">
        {title}
        <PermissionDeniedState title={s.t('cadets.deniedTitle')} message={s.t('cadets.denied')} testID="cadets-denied" />
      </GlassScreen>
    );
  }
  if (!fieldApp) {
    return (
      <GlassScreen edges={['top', 'left', 'right']} testID="field-cadets">
        {title}
        <UnavailableState title={s.t('common.notConnectedTitle')} message={s.t('cadets.unavailable')} testID="cadets-unavailable" />
      </GlassScreen>
    );
  }

  return (
    <GlassScreen edges={['top', 'left', 'right']} keyboard testID="field-cadets">
      {title}
      {list.status === 'ready' && list.data?.source === 'synthetic-preview' ? <SyntheticDataBanner text={s.t('common.synthetic')} /> : null}
      <GlassInput
        label={s.t('cadets.search')}
        placeholder={s.t('cadets.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
        clearButtonMode="while-editing"
        testID="cadets-search"
      />
      <SegmentedControl
        label={s.t('cadets.filterLabel')}
        segments={[
          { value: 'all', label: s.t('cadets.filterAll') },
          { value: 'in', label: s.t('cadets.filterCheckedIn') },
          { value: 'todo', label: s.t('cadets.filterToAssess') },
        ]}
        value={filter}
        onChange={setFilter}
        testID="cadets-filter"
      />
      {list.status === 'loading' ? <LoadingState label={s.t('cadets.loading')} rows={3} testID="cadets-loading" /> : null}
      {list.status === 'error' ? <LoadFailure state={list} onRetry={list.retry} testID="cadets" /> : null}
      {list.status === 'ready' && list.data ? (
        list.data.cadets.length === 0 ? (
          <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.pad}>
            <EmptyState icon="people-outline" title={s.t('cadets.emptyTitle')} message={s.t('cadets.empty', { hub: list.data.hubName })} testID="cadets-empty" />
          </GlassSurface>
        ) : shown.length === 0 ? (
          <GlassSurface material="regular" borderRadius={radius.card} contentStyle={styles.pad}>
            <EmptyState
              icon="search-outline"
              title={s.t('cadets.noMatchTitle')}
              message={deferred.trim() ? s.t('cadets.noMatch', { query: deferred.trim() }) : s.t('cadets.noFilterMatch')}
              action={{ label: s.t('cadets.clear'), icon: 'close-circle-outline', onPress: () => (setQuery(''), setFilter('all')) }}
              testID="cadets-no-match"
            />
          </GlassSurface>
        ) : (
          <ListGroup testID="cadets-list">
            {shown.map((c) => (
              <Row
                key={c.id}
                testID={`cadet-${c.id}`}
                emphasis
                icon="person-outline"
                label={c.name}
                value={c.today ? rankLabel(s, c.rank) : `${rankLabel(s, c.rank)} · ${s.t('cadets.notToday')}`}
                accessibilityLabel={[c.name, rankLabel(s, c.rank), c.today ? (c.today.published ? s.t('cadets.published') : s.t('cadets.todayIn', { time: c.today.time })) : s.t('cadets.notToday')].join(', ')}
                accessibilityHint={s.t('cadets.openHint')}
                onPress={() => router.push({ pathname: '/field/cadets/[cadetId]', params: { cadetId: c.id } })}
                trailing={c.today ? <Trailing>{todayBadge(c, s)}</Trailing> : undefined}
              />
            ))}
          </ListGroup>
        )
      ) : null}
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  pad: { paddingHorizontal: space.lg },
});
