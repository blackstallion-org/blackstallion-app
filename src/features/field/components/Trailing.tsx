import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Centres a row's trailing badge/button vertically (StatusBadge aligns itself to the top of its parent). */
export function Trailing({ children }: { children: ReactNode }) {
  return <View style={styles.trail}>{children}</View>;
}

const styles = StyleSheet.create({ trail: { alignSelf: 'center', justifyContent: 'center' } });
