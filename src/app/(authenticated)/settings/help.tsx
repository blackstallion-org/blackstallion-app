import { useLocalSearchParams } from 'expo-router';

import { sanitizeReference } from '@/features/account/domain/diagnostics';
import { HelpSupportScreen } from '@/features/settings/HelpSupport';

/**
 * SH-09 `/settings/help`. Optional `?ref=` is an error reference code (e.g. PT404, HTTP-503) from an error's Details;
 * anything that isn't a short code is dropped, so personal data can't ride along in the link.
 */
export default function HelpRoute() {
  const { ref } = useLocalSearchParams<{ ref?: string | string[] }>();
  return <HelpSupportScreen reference={sanitizeReference(Array.isArray(ref) ? ref[0] : ref)} />;
}
