import { Redirect, useLocalSearchParams } from 'expo-router';

/** Registered route for FO-10 (`/field/care/[taskId]`, care reminder links) → the Horses stack's care task screen. */
export default function CareTaskAlias() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  return <Redirect href={{ pathname: '/field/horses/care/[taskId]', params: { taskId: typeof taskId === 'string' ? taskId : '' } }} />;
}
