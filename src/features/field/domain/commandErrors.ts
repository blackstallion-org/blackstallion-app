/**
 * Server answers for field commands → what staff see. SQLSTATEs from foundations/live-delta (MIG:333):
 * 42501 not allowed · PT404 not found · PT409 conflict · PT422 invalid input (+ PT403 feature off, BACKEND_CONTRACT_V2).
 * Raw server text is shown only when it is one of the known, user-safe messages below; anything else gets generic copy
 * plus a reference code. `messageKey` names the same text in the Field string catalogue (EN/HI/TE), so screens can show
 * it in the person's language; `message` stays English for logs and tests.
 */
export type CommandErrorKind = 'forbidden' | 'notFound' | 'conflict' | 'invalid' | 'network' | 'signedOut' | 'unexpected';
export type CommandContext = 'checkIn' | 'publish' | 'correct' | 'void' | 'load';

export class FieldCommandError extends Error {
  constructor(
    readonly kind: CommandErrorKind,
    message: string,
    readonly reference?: string,
    /** Catalogue key for `message` (features/field/i18n), when one exists. */
    readonly messageKey?: string,
    /** Server version named by a stale-version conflict ("the session changed since it was loaded (version N)"). */
    readonly serverVersion?: number,
  ) {
    super(message);
    this.name = 'FieldCommandError';
  }
  /** True when repeating the same request (same operation id) is safe and may succeed. */
  get retryable(): boolean {
    return this.kind === 'network';
  }
}

/** Server text (exact) → [catalogue key, English]. */
const KNOWN: Record<string, [string, string]> = {
  'session video consent is not allowed for this cadet': ['noVideoConsent', 'This child’s guardian hasn’t allowed session videos, so the clip can’t be kept. Publish the scores without the clip.'],
  'the video does not belong to this cadet': ['videoWrongCadet', 'That clip belongs to a different cadet. Record the clip again for this cadet.'],
  'not allowed for this account': ['notAllowed', 'Your account can’t do this. Ask your hub admin if you think it should.'],
  'no cadet with this passport code at your hub': ['noCadetAtHub', 'No cadet with this passport code at your hub. Check the code or ask your hub admin.'],
  'observed time must be within the last 7 days and not in the future': [
    'clockRefused',
    'This phone’s clock looks wrong, so the check-in was refused. Set the date and time automatically, then try again.',
  ],
  'operation id already used for a different request': ['opReused', 'This request clashed with an earlier one. Try again.'],
  'check-in not found at your hub': ['checkInGone', 'This check-in isn’t at your hub any more.'],
  'this check-in already has a published session': ['alreadyPublished', 'This session was already published.'],
  'the cadet is no longer at your hub': ['cadetMoved', 'This cadet has moved to another hub, so the session can’t be published here.'],
  'riding, ground and stable scores must be whole numbers from 1 to 10': ['scoresRange', 'Riding, ground and stable scores must be whole numbers from 1 to 10.'],
  'notes are limited to 2000 characters': ['notesLong', 'Notes are limited to 2000 characters.'],
  'at most 20 skills': ['skillsMax', 'Choose at most 20 skills.'],
  'unknown or retired skill': ['skillRetired', 'One of the skills is no longer in use. Remove it and try again.'],
  'the video must be uploaded for this cadet first': ['videoMissing', 'The video must finish uploading first.'],
  // field_correct_session (MIG:452-490)
  'a reason of 3 to 500 characters is required': ['reasonLength', 'Give a reason of 3 to 500 characters.'],
  'session not found': ['sessionNotFound', 'This record isn’t available at your hub.'],
  'nothing to correct': ['nothingToCorrect', 'Nothing changed, so there is nothing to correct.'],
  // field_void_check_in (G9, SD-05 draft)
  "only today's check-ins can be voided here": ['voidPastDay', 'Only today’s check-ins can be voided here. Ask your hub admin about older ones.'],
  'this check-in is already voided': ['alreadyVoided', 'This check-in was already voided.'],
  'an assessment is published for this check-in; make a correction instead': ['voidPublished', 'An assessment is already published for this check-in. Make a correction instead.'],
  'this check-in was voided': ['checkInVoided', 'This check-in was voided, so it can’t be assessed.'],
  'only the instructor who recorded the session, at the cadet\'s hub, or a super admin may correct it': [
    'notRecorder',
    'Only the instructor who recorded this session can correct it. Ask your hub admin.',
  ],
};

const STALE = /^the session changed since it was loaded \(version (\d+)\)$/;

const GENERIC: Record<CommandErrorKind, Record<CommandContext, string>> = {
  forbidden: {
    checkIn: 'Your account can’t record check-ins. Ask your hub admin.',
    publish: 'Your account can’t publish sessions. Ask your hub admin.',
    correct: 'Your account can’t correct this session. Ask your hub admin.',
    void: 'Your account can’t void check-ins. Ask your hub admin.',
    load: 'Your account can’t see this.',
  },
  notFound: {
    checkIn: 'Not found at your hub.',
    publish: 'This check-in isn’t at your hub any more.',
    correct: 'This record isn’t available at your hub.',
    void: 'This check-in isn’t at your hub any more.',
    load: 'Not found.',
  },
  conflict: {
    checkIn: 'This clashed with another change. Try again.',
    publish: 'This clashed with another change. Reload and try again.',
    correct: 'This record changed since you opened it. Nothing was overwritten.',
    void: 'This check-in changed since you opened it. Reload and check again.',
    load: 'Reload and try again.',
  },
  invalid: {
    checkIn: 'The check-in was refused. Check the code and try again.',
    publish: 'The session was refused. Check the scores and try again.',
    correct: 'The correction was refused. Check the scores and reason.',
    void: 'The void was refused. Check the reason and try again.',
    load: 'Something isn’t right with this request.',
  },
  network: {
    checkIn: 'We couldn’t confirm the check-in. Try again — repeating it is safe and won’t check the cadet in twice.',
    publish: 'We couldn’t confirm publishing. Try again — repeating it is safe and won’t publish twice.',
    correct: 'We couldn’t confirm the correction. Try again — repeating it is safe and won’t apply it twice.',
    void: 'We couldn’t confirm the void. Try again — repeating it is safe and won’t void twice.',
    load: 'We couldn’t reach the academy. Check your connection and try again.',
  },
  signedOut: {
    checkIn: 'Your session ended. Sign in again.',
    publish: 'Your session ended. Sign in again, then re-enter the scores.',
    correct: 'Your session ended. Sign in again, then make the correction again.',
    void: 'Your session ended. Sign in again, then void the check-in again.',
    load: 'Your session ended. Sign in again.',
  },
  unexpected: {
    checkIn: 'Something went wrong. Nothing is confirmed yet; try again.',
    publish: 'Something went wrong. Nothing is confirmed yet; try again.',
    correct: 'Something went wrong. Nothing is confirmed yet; try again.',
    void: 'Something went wrong. Nothing is confirmed yet; try again.',
    load: 'Something went wrong. Try again.',
  },
};

type ErrLike = { code?: unknown; message?: unknown; status?: unknown; name?: unknown };

export const CLOCK_MESSAGE =
  'This phone’s date or time is wrong, so nothing was recorded. Set the date and time to automatic, then try again.';
export const CLOCK_MESSAGE_KEY = 'errors.clockSkew';

export function classifyCommandError(e: ErrLike | null | undefined, status?: number): CommandErrorKind {
  const s = typeof status === 'number' ? status : typeof e?.status === 'number' ? e.status : 0;
  const code = typeof e?.code === 'string' ? e.code : '';
  const msg = `${typeof e?.name === 'string' ? e.name : ''} ${typeof e?.message === 'string' ? e.message : ''}`.toLowerCase();
  if (code === '42501') return 'forbidden';
  if (code === 'PT404') return 'notFound';
  if (code === 'PT409' || code === '23505') return 'conflict';
  if (code === 'PT422' || code === '23514') return 'invalid';
  if (code === 'PT403') return 'forbidden';
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
  const reference = typeof err.code === 'string' && err.code ? err.code : status ? `HTTP-${status}` : undefined;
  const stale = kind === 'conflict' ? STALE.exec(serverMessage) : null;
  if (stale) {
    const v = Number(stale[1]);
    return new FieldCommandError('conflict', `Someone changed this record since you opened it (now version ${v}). Nothing was overwritten.`, reference, 'errors.known.staleVersion', v);
  }
  const known = KNOWN[serverMessage];
  if (known && kind !== 'network' && kind !== 'signedOut') {
    return new FieldCommandError(kind, known[1], reference, `errors.known.${known[0]}`);
  }
  return new FieldCommandError(kind, GENERIC[kind][context], reference, `errors.generic.${kind}.${context}`);
}
