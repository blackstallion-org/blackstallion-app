// Replay-safe family commands (RSVP, cancel, consent, Spark acknowledgement). Pure TypeScript.
// BACKEND_CONTRACT_V2 §1/§7: an operation id is bound to one exact payload. A retry after a network failure MUST resend
// the same id with the same arguments (the server then returns the original answer, `duplicate: true`, and writes
// nothing twice). Once the server has answered — success or a definite refusal — the id is spent and the next attempt
// at the same payload is a NEW operation.

import { newOperationId } from '@/features/field/domain/operation';

export type CommandOutcome = 'acknowledged' | 'refused' | 'network';

export class CommandLatches {
  private readonly open = new Map<string, string>();

  constructor(private readonly make: () => string = newOperationId) {}

  /** The operation id for this payload: the pending one after a network failure, otherwise a fresh one. */
  idFor(payloadKey: string): string {
    const existing = this.open.get(payloadKey);
    if (existing) return existing;
    const id = this.make();
    this.open.set(payloadKey, id);
    return id;
  }

  /** Network/timeout keeps the id for an identical retry; any server answer spends it. */
  settle(payloadKey: string, outcome: CommandOutcome): void {
    if (outcome !== 'network') this.open.delete(payloadKey);
  }

  /** For tests/diagnostics: payloads that still await an identical retry. */
  pending(): string[] {
    return [...this.open.keys()];
  }
}

export const rsvpKey = (eventId: string, childId: string, action: 'rsvp' | 'cancel') => `${action}:${eventId}:${childId}`;
export const consentKey = (childId: string, purpose: string, granted: boolean, policyVersion: string) =>
  `consent:${childId}:${purpose}:${granted ? 1 : 0}:${policyVersion}`;
export const sparkAckKey = (childId: string, sparkId: string) => `spark:${childId}:${sparkId}`;
