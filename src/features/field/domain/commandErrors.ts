/**
 * Server answers for field commands → what staff see. SQLSTATEs from foundations/live-delta (MIG:333):
 * 42501 not allowed · PT404 not found · PT409 conflict · PT422 invalid input. Raw server text is shown only when it
 * is one of the known, user-safe messages below; anything else gets generic copy plus a reference code.
 */
export type CommandErrorKind = 'forbidden' | 'notFound' | 'conflict' | 'invalid' | 'network' | 'signedOut' | 'unexpected';
export type CommandContext = 'checkIn' | 'publish' | 'load';

export class FieldCommandError extends Error {
  constructor(
    readonly kind: CommandErrorKind,
    message: string,
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'FieldCommandError';
  }
  /** True when repeating the same request (same operation id) is safe and may succeed. */
  get retryable(): boolean {
    return this.kind === 'network';
  }
}

const KNOWN: Record<string, string> = {
  'not allowed for this account': 'Your account can’t do this. Ask your hub admin if you think it should.',
  'no cadet with this passport code at your hub': 'No cadet with this passport code at your hub. Check the code or ask your hub admin.',
  'observed time must be within the last 7 days and not in the future':
    'This phone’s clock looks wrong, so the check-in was refused. Set the date and time automatically, then try again.',
  'operation id already used for a different request': 'This request clashed with an earlier one. Try again.',
  'check-in not found at your hub': 'This check-in isn’t at your hub any more.',
  'this check-in already has a published session': 'This session was already published.',
  'the cadet is no longer at your hub': 'This cadet has moved to another hub, so the session can’t be published here.',
  'riding, ground and stable scores must be whole numbers from 1 to 10': 'Riding, ground and stable scores must be whole numbers from 1 to 10.',
  'notes are limited to 2000 characters': 'Notes are limited to 2000 characters.',
  'at most 20 skills': 'Choose at most 20 skills.',
  'unknown or retired skill': 'One of the skills is no longer in use. Remove it and try again.',
  'the video must be uploaded for this cadet first': 'The video must finish uploading first.',
};

const GENERIC: Record<CommandErrorKind, Record<CommandContext, string>> = {
  forbidden: {
    checkIn: 'Your account can’t record check-ins. Ask your hub admin.',
    publish: 'Your account can’t publish sessions. Ask your hub admin.',
    load: 'Your account can’t see this.',
  },
  notFound: { checkIn: 'Not found at your hub.', publish: 'This check-in isn’t at your hub any more.', load: 'Not found.' },
  conflict: { checkIn: 'This clashed with another change. Try again.', publish: 'This clashed with another change. Reload and try again.', load: 'Reload and try again.' },
  invalid: { checkIn: 'The check-in was refused. Check the code and try again.', publish: 'The session was refused. Check the scores and try again.', load: 'Something isn’t right with this request.' },
  network: {
    checkIn: 'We couldn’t confirm the check-in. Try again — repeating it is safe and won’t check the cadet in twice.',
    publish: 'We couldn’t confirm publishing. Try again — repeating it is safe and won’t publish twice.',
    load: 'We couldn’t reach the academy. Check your connection and try again.',
  },
  signedOut: { checkIn: 'Your session ended. Sign in again.', publish: 'Your session ended. Sign in again, then re-enter the scores.', load: 'Your session ended. Sign in again.' },
  unexpected: {
    checkIn: 'Something went wrong. Nothing is confirmed yet; try again.',
    publish: 'Something went wrong. Nothing is confirmed yet; try again.',
    load: 'Something went wrong. Try again.',
  },
};

type ErrLike = { code?: unknown; message?: unknown; status?: unknown; name?: unknown };

export const CLOCK_MESSAGE =
  'This phone’s date or time is wrong, so nothing was recorded. Set the date and time to automatic, then try again.';

export function classifyCommandError(e: ErrLike | null | undefined, status?: number): CommandErrorKind {
  const s = typeof status === 'number' ? status : typeof e?.status === 'number' ? e.status : 0;
  const code = typeof e?.code === 'string' ? e.code : '';
  const msg = `${typeof e?.name === 'string' ? e.name : ''} ${typeof e?.message === 'string' ? e.message : ''}`.toLowerCase();
  if (code === '42501') return 'forbidden';
  if (code === 'PT404') return 'notFound';
  if (code === 'PT409') return 'conflict';
  if (code === 'PT422') return 'invalid';
  if (s === 401 || code.startsWith('PGRST30') || msg.includes('jwt')) return 'signedOut';
  if (s === 403) return 'forbidden';
  if (s === 0 || s === 408 || s === 429 || s >= 500 || /network request failed|failed to fetch|fetch failed|network|timeout|econn/.test(msg)) {
    return 'network';
  }
  return 'unexpected';
}

export function toCommandError(e: unknown, context: CommandContext, status?: number): FieldCommandError {
  if (e instanceof FieldCommandError) return e;
  const err = (e ?? {}) as ErrLike;
  const kind = classifyCommandError(err, status);
  const serverMessage = typeof err.message === 'string' ? err.message.trim() : '';
  const known = KNOWN[serverMessage];
  const message = known && kind !== 'network' && kind !== 'signedOut' ? known : GENERIC[kind][context];
  const reference = typeof err.code === 'string' && err.code ? err.code : status ? `HTTP-${status}` : undefined;
  return new FieldCommandError(kind, message, reference);
}
