// FA-08 capability check (BACKEND_CONTRACT_V2 §3.9). Pure TypeScript. In this delta the server ALWAYS answers
// `unavailable` (flag `stream_entitlement` off, no provider, no issuing Edge Function), and never sends a URL or token.
// Anything other than an explicit, well-formed `available` is treated as unavailable: the player is never shown on a guess.

export type StreamUnavailableReason = 'feature_disabled' | 'provider_not_configured' | 'provider_not_integrated' | 'no_horse' | 'unknown';

export type StreamCapability =
  | { status: 'unavailable'; reason: StreamUnavailableReason; horseAssigned: boolean }
  | { status: 'available'; horseAssigned: true };

const REASONS: readonly StreamUnavailableReason[] = ['feature_disabled', 'provider_not_configured', 'provider_not_integrated'];

export function parseStreamCapability(raw: unknown): StreamCapability {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const horseAssigned = o.horse_assigned === true;
  if (o.capability === 'stall_stream' && o.status === 'available' && horseAssigned) return { status: 'available', horseAssigned: true };
  const reason = typeof o.reason === 'string' && (REASONS as readonly string[]).includes(o.reason) ? (o.reason as StreamUnavailableReason) : 'unknown';
  return { status: 'unavailable', reason: !horseAssigned && reason === 'unknown' ? 'no_horse' : reason, horseAssigned };
}
