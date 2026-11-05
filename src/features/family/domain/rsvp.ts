// FA-10/FA-11 RSVP presentation. Adapted from g6-prework/src/events/rsvpModel.ts (4 Nov 2026) to the G9 contract
// (BACKEND_CONTRACT_V2 §3.2): the SERVER decides whether replies are open (`rsvp_open`, `cancellation_open`), so the phone
// clock never opens or closes a reply. One clear action per child; a seat is never assumed before the server confirms
// it. No waitlist (none approved). Pure TypeScript.

export type RsvpEventState = {
  status: 'published' | 'cancelled';
  seatsLeft: number;
  /** Published and now < rsvp_closes_at and now < starts_at (server). */
  rsvpOpen: boolean;
  /** now < starts_at (server). Null when the server did not say (list rows): treated as closed for cancelling. */
  cancellationOpen: boolean | null;
};

export type RsvpAction =
  | { kind: 'rsvp'; label: string }
  | { kind: 'cancel'; label: string }
  | { kind: 'full'; label: string }
  | { kind: 'closed'; label: string }
  | { kind: 'event-cancelled'; label: string }
  | { kind: 'pending'; label: string };

export function rsvpAction(ev: RsvpEventState, childStatus: 'confirmed' | 'not_going', inFlight: boolean): RsvpAction {
  if (inFlight) return { kind: 'pending', label: 'Sending…' };
  if (ev.status === 'cancelled') return { kind: 'event-cancelled', label: 'This event was cancelled' };
  if (childStatus === 'confirmed') {
    return ev.cancellationOpen ? { kind: 'cancel', label: 'Cancel place' } : { kind: 'closed', label: 'Going · changes closed' };
  }
  if (!ev.rsvpOpen) return { kind: 'closed', label: ev.cancellationOpen === false ? 'Event has started' : 'Replies closed' };
  if (ev.seatsLeft <= 0) return { kind: 'full', label: 'Full · no waitlist' };
  return { kind: 'rsvp', label: 'Reserve a place' };
}

/** What a failed RSVP/cancel means for the family. `refresh`: reload the event (the server state moved on). */
export type RsvpFailure = { text: string; refresh: boolean; retry: boolean };

/**
 * Maps a command failure (SQLSTATE + server message) to family copy. G9 PT409 messages carry stable machine prefixes
 * (`event_full:` …); anything else is branched on the SQLSTATE only, never on free text.
 */
export function rsvpFailure(kind: 'conflict' | 'notFound' | 'forbidden' | 'invalid' | 'network' | 'signedOut' | 'unexpected', serverMessage: string): RsvpFailure {
  if (kind === 'conflict') {
    const prefix = /^([a-z_]+):/.exec(serverMessage)?.[1];
    switch (prefix) {
      case 'event_full':
        return { text: 'Sorry, the last place was just taken. There’s no waitlist for this event.', refresh: true, retry: false };
      case 'rsvp_closed':
        return { text: 'Replies for this event have closed.', refresh: true, retry: false };
      case 'event_started':
        return { text: 'The event has started, so places can’t be changed.', refresh: true, retry: false };
      case 'event_cancelled':
        return { text: 'This event was cancelled.', refresh: true, retry: false };
      default:
        return { text: 'This changed while you were looking. The latest details are shown.', refresh: true, retry: false };
    }
  }
  if (kind === 'notFound') return { text: 'This event isn’t available for this child any more.', refresh: true, retry: false };
  if (kind === 'forbidden' || kind === 'signedOut') return { text: 'Your account can’t change this. Sign in again or contact the academy office.', refresh: false, retry: false };
  if (kind === 'network') return { text: 'We couldn’t reach the academy, so nothing changed yet. Try again — repeating is safe and won’t book twice.', refresh: false, retry: true };
  if (kind === 'invalid') return { text: 'The academy couldn’t accept this request. Reload the event and try again.', refresh: true, retry: false };
  return { text: 'Something went wrong. Nothing changed yet; try again.', refresh: true, retry: true };
}
