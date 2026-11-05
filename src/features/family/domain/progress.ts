// FA-02/FA-03/FA-04/FA-13 view logic. Pure TypeScript.

export type ScoreKey = 'riding' | 'ground' | 'stable';
export const SCORE_KEYS: readonly ScoreKey[] = ['riding', 'ground', 'stable'];
export type Scores = Record<ScoreKey, number>;

export type TrendPoint = { sessionId: string; date: string; value: number };
export type ScoreTrend = { key: ScoreKey; points: TrendPoint[]; latest: number | null; first: number | null };

/** Max sessions on the trend: enough to see direction, few enough to read each point on a 320 pt phone. */
export const TREND_WINDOW = 10;

/**
 * Small-multiple series (one per score, oldest → newest) from PUBLISHED sessions only, current revision only (the
 * repositories never return superseded rows). Each series shares the fixed 1–10 scale; nothing is smoothed,
 * extrapolated or turned into a "level".
 */
export function scoreTrends(sessions: readonly { id: string; date: string; scores: Scores }[], window = TREND_WINDOW): ScoreTrend[] {
  const ordered = [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)).slice(-window);
  return SCORE_KEYS.map((key) => {
    const points = ordered.map((s) => ({ sessionId: s.id, date: s.date, value: s.scores[key] }));
    return { key, points, latest: points[points.length - 1]?.value ?? null, first: points[0]?.value ?? null };
  });
}

/** Plain-language summary for screen readers: values, not judgements. */
export function trendSentence(label: string, t: ScoreTrend): string {
  if (t.points.length === 0) return `${label}: no scores yet`;
  if (t.points.length === 1) return `${label}: ${t.latest} out of 10 in the only session so far`;
  return `${label}: ${t.points.map((p) => p.value).join(', ')} out of 10 over the last ${t.points.length} sessions; latest ${t.latest}`;
}

/** Vertical position of a 1–10 score in a box of `height` px (10 at the top). */
export const scoreY = (value: number, height: number, pad = 4): number => {
  const v = Math.max(1, Math.min(10, value));
  return pad + ((10 - v) / 9) * (height - pad * 2);
};

// ------------------------------------------------------------------ clips

export type ClipAccess =
  | { kind: 'allowed' }
  | { kind: 'no-clip' }
  | { kind: 'consent-missing' }
  | { kind: 'consent-unknown' }
  | { kind: 'media-unavailable' };

/**
 * Private session video is shown only when (1) the session has a clip, (2) the child's CURRENT `session_video` consent
 * is allowed under the current wording (BACKEND_CONTRACT_V2 §3.1 `allowed`), and (3) a media boundary exists. Fails
 * closed: unknown consent hides the clip.
 */
export function clipAccess(hasClip: boolean, consentAllowed: boolean | null, mediaAvailable: boolean): ClipAccess {
  if (!hasClip) return { kind: 'no-clip' };
  if (consentAllowed === null) return { kind: 'consent-unknown' };
  if (!consentAllowed) return { kind: 'consent-missing' };
  if (!mediaAvailable) return { kind: 'media-unavailable' };
  return { kind: 'allowed' };
}

/**
 * FA-13 pairing: the earliest clip and a recent one (the requested session when it has a clip, else the newest).
 * Null when fewer than two clips exist — the screen is then unavailable, never padded with a stand-in.
 */
export function pairClips<T extends { id: string; date: string }>(clips: readonly T[], recentId?: string | null): { earlier: T; recent: T } | null {
  if (clips.length < 2) return null;
  const ordered = [...clips].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const earlier = ordered[0] as T;
  const requested = recentId ? ordered.find((c) => c.id === recentId) : undefined;
  const recent = requested && requested.id !== earlier.id ? requested : (ordered[ordered.length - 1] as T);
  return { earlier, recent };
}

/** Signed URLs are used only while comfortably inside their lifetime (never cached past expiry). */
export const SIGNED_URL_MARGIN_MS = 10_000;
export const signedUrlUsable = (expiresAt: number, now: number): boolean => expiresAt - now > SIGNED_URL_MARGIN_MS;

// ------------------------------------------------------------------ route params

/**
 * Route parameters are untrusted (deep links, notifications). Accept one short opaque id; anything else is "not found"
 * without a request. Repositories still check the id against the access snapshot / server scope.
 */
export function routeId(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}
