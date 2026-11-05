// FA-12 consent view logic (BACKEND_CONTRACT_V2 §3.1). Pure TypeScript. Purposes are server DATA (seeded under D09,
// PROPOSED): the app shows whatever the server lists and never hard-codes a purpose.

export type ConsentStateName = 'not_set' | 'granted' | 'withdrawn';

export type ConsentState = {
  purpose: string;
  state: ConsentStateName;
  granted: boolean;
  /** Granted under the CURRENT wording: the only value that permits recording/viewing. */
  allowed: boolean;
  policyVersion: string | null;
  currentPolicyVersion: string;
  recordedAt: string | null;
};

export type ConsentView = {
  label: 'Allowed' | 'Withdrawn' | 'Not set' | 'Needs review';
  tone: 'success' | 'neutral' | 'warning';
  /** The one action offered. Withdrawal is never blocked by wording version (server rule). */
  action: { kind: 'grant'; label: string } | { kind: 'withdraw'; label: string };
  note: string | null;
};

export function consentView(c: ConsentState): ConsentView {
  if (c.state === 'granted' && !c.allowed) {
    return {
      label: 'Needs review',
      tone: 'warning',
      action: { kind: 'grant', label: 'Review and allow' },
      note: `The wording changed (now version ${c.currentPolicyVersion}). Until you allow it again, this is treated as not allowed.`,
    };
  }
  if (c.state === 'granted') return { label: 'Allowed', tone: 'success', action: { kind: 'withdraw', label: 'Withdraw' }, note: null };
  if (c.state === 'withdrawn') return { label: 'Withdrawn', tone: 'neutral', action: { kind: 'grant', label: 'Allow' }, note: null };
  return { label: 'Not set', tone: 'neutral', action: { kind: 'grant', label: 'Allow' }, note: 'No choice recorded yet, so this is treated as not allowed.' };
}

/** The `session_video` purpose gates private clips (FA-03/FA-04/FA-13). */
export const SESSION_VIDEO = 'session_video';
