import { Redirect, useLocalSearchParams } from 'expo-router';

/** Registered route for FO-19 (`/field/cadets/[cadetId]/rank`) → the rank proposal screen (flag-gated server-side). */
export default function RankProposalAlias() {
  const { cadetId } = useLocalSearchParams<{ cadetId?: string }>();
  return <Redirect href={{ pathname: '/field/rank/[cadetId]', params: { cadetId: typeof cadetId === 'string' ? cadetId : '' } }} />;
}
