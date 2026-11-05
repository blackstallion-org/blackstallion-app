import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Re-reads in the background when the screen comes back into focus (e.g. after cancelling an order on BI-04), but not
 * on the first focus, which the initial load already covers.
 */
export function useFocusRefresh(refresh: () => void) {
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) refresh();
      seen.current = true;
    }, [refresh]),
  );
}
