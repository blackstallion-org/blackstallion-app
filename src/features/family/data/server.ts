import { ScopedLoadError } from '@/core/data/useScopedResource';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';
import { isUuid } from '@/features/field/domain/operation';

import { SESSION_VIDEO, type ConsentState } from '../domain/consent';
import { dayLabel } from '../domain/format';
import { toPassportInput, type LiveAchievement, type LiveRankChange, type LiveSessionRecord } from '../domain/passportLive';
import { parseStreamCapability } from '../domain/stream';
import { D18_PROPOSED } from '../spark/domain/policy';
import type { SparkAudioFactory, SparkContent, SparkFeature, SparkScope } from '../spark/types';
import type { FamilyScope } from '../types';
import { asRows, int, loadData, loadRows, outOfScope, runCommand, score, shapeError, str, strOrNull, toLoadError, type Row } from './familyNet';
import {
  FamilyCommandError,
  type ClipEntry,
  type ClipRef,
  type ConsentCentre,
  type EventChild,
  type FamilyAppRepositories,
  type FamilyChild,
  type FamilyEvent,
  type RsvpResult,
  type SessionSummary,
  type SignedMedia,
} from './repositories';

/**
 * Device audio (expo-audio) is required lazily: the native module only exists in a dev/production build, and loading it
 * at import time would break every screen test that composes the server repositories.
 */
const deviceSparkAudio: SparkAudioFactory = (content) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('../spark/audio/expoAudioAdapter') as typeof import('../spark/audio/expoAudioAdapter')).createExpoSparkAudio(content);

/** Signed-URL lifetimes (seconds). Short on purpose; screens fetch a new one per playback and never cache past expiry. */
export const CLIP_URL_TTL_S = 120;
export const CONTENT_URL_TTL_S = 300;
export const PAGE_SIZE = 20;

type SignedUrlResult = { data: { signedUrl: string } | null; error: unknown };
export type StorageLike = { from(bucket: string): { createSignedUrl(path: string, expiresIn: number): PromiseLike<SignedUrlResult> } };
export type FamilyDataClient = DataClient & { storage?: StorageLike };

const SESSION_COLS = 'id, cadet_id, session_date, riding_score, ground_score, stable_score, version, video_log_s3_url';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `<hub uuid>/<cadet uuid>/<file>` in the private session-videos bucket (MIG:69,75). */
const CLIP_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,200})$/i;
const EVENT_IMAGE = /^events\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,200})$/i;
const SPARK_AUDIO = /^spark\/(all|[0-9a-f-]{36})\/([A-Za-z0-9._-]{1,200})$/i;

const childrenOf = (scope: { children?: FamilyScope['children'] }): FamilyChild[] =>
  (scope.children ?? []).map((c) => ({ id: c.cadetId, firstName: c.firstName, hubId: c.hubId }));

/** The ONLY gate before a child-scoped request: the id must be in the access snapshot. */
function requireChild(scope: { children?: FamilyScope['children'] }, childId: string): FamilyChild {
  const child = childrenOf(scope).find((c) => c.id === childId);
  if (!child) throw outOfScope('CHILD');
  return child;
}

function requireChildForCommand(scope: FamilyScope, childId: string): FamilyChild {
  const child = childrenOf(scope).find((c) => c.id === childId);
  if (!child) throw new FamilyCommandError('notFound', 'child not in this account', 'CLIENT-SCOPE');
  return child;
}

const clipPathFor = (childId: string, raw: unknown): string | null => {
  const path = typeof raw === 'string' ? raw.trim() : '';
  const m = CLIP_PATH.exec(path);
  return m && !path.includes('..') && m[2]?.toLowerCase() === childId.toLowerCase() ? path : null;
};

function toSummary(r: Row, childId: string): SessionSummary | null {
  const riding = score(r.riding_score);
  const ground = score(r.ground_score);
  const stable = score(r.stable_score);
  const date = str(r.session_date);
  if (riding === null || ground === null || stable === null || !DATE.test(date) || !str(r.id)) return null; // legacy rows without scores
  return {
    id: str(r.id),
    childId,
    date,
    scores: { riding, ground, stable },
    corrected: (int(r.version) ?? 1) > 1,
    hasClip: clipPathFor(childId, r.video_log_s3_url) !== null,
  };
}

const encodeCursor = (r: Row) => `${str(r.session_date)}|${str(r.id)}`;
function decodeCursor(cursor: string): { date: string; id: string } | null {
  const [date, id] = cursor.split('|');
  return date && id && DATE.test(date) && isUuid(id) ? { date, id } : null;
}

function page(rows: Row[], childId: string) {
  const more = rows.length > PAGE_SIZE;
  const kept = rows.slice(0, PAGE_SIZE);
  const last = kept[kept.length - 1];
  return {
    sessions: kept.map((r) => toSummary(r, childId)).filter((s): s is SessionSummary => s !== null),
    nextCursor: more && last ? encodeCursor(last) : null,
  };
}

function parseConsentStates(raw: unknown): ConsentState[] {
  return asRows(raw).map((c) => ({
    purpose: str(c.purpose),
    state: c.state === 'granted' || c.state === 'withdrawn' ? c.state : 'not_set',
    granted: c.granted === true,
    allowed: c.allowed === true,
    policyVersion: strOrNull(c.policy_version),
    currentPolicyVersion: str(c.current_policy_version),
    recordedAt: strOrNull(c.recorded_at),
  }));
}

function parseEvent(r: Row, linked: FamilyChild[]): FamilyEvent | null {
  const id = str(r.event_id);
  const status = r.status === 'published' || r.status === 'cancelled' ? r.status : null;
  const startsAt = str(r.starts_at);
  if (!id || !status || !startsAt || !str(r.title)) return null;
  const linkedIds = new Set(linked.map((c) => c.id));
  const children: EventChild[] = asRows(r.children)
    .map((c) => ({ childId: str(c.cadet_id), firstName: str(c.first_name), status: c.rsvp_status === 'confirmed' ? ('confirmed' as const) : ('not_going' as const) }))
    .filter((c) => linkedIds.has(c.childId)); // never show anyone outside the snapshot
  const imagePath = strOrNull(r.image_object_path);
  return {
    id,
    hubId: str(r.hub_id),
    title: str(r.title),
    description: strOrNull(r.description),
    venue: str(r.venue),
    startsAt,
    endsAt: strOrNull(r.ends_at),
    rsvpClosesAt: str(r.rsvp_closes_at),
    capacity: int(r.capacity) ?? 0,
    seatsLeft: Math.max(0, int(r.seats_left) ?? 0),
    status,
    image: imagePath ? { bucket: 'app-content', path: imagePath } : null,
    rsvpOpen: r.rsvp_open === true,
    cancellationOpen: typeof r.cancellation_open === 'boolean' ? r.cancellation_open : null,
    children,
  };
}

function rsvpResult(r: Row, status: 'confirmed' | 'cancelled'): RsvpResult {
  if (r.status !== status) throw new FamilyCommandError('unexpected', 'unexpected response shape', 'SHAPE-status');
  return {
    status,
    seatsLeft: Math.max(0, int(r.seats_left) ?? 0),
    already: r.already_confirmed === true || r.already_cancelled === true,
    duplicate: r.duplicate === true,
  };
}

/** Server implementation over BACKEND_CONTRACT_V2 (G9) and SLICE_CONTRACT §B reads under RLS. */
export function createFamilyAppServer(base: DataClient): FamilyAppRepositories {
  const client = base as FamilyDataClient;
  const storage = client.storage;

  async function sign(bucket: string, path: string, ttl: number): Promise<SignedMedia> {
    if (!storage) throw new ScopedLoadError('Private media isn’t available in this build.', 'OFF-MEDIA', true);
    let res: SignedUrlResult;
    try {
      res = await storage.from(bucket).createSignedUrl(path, ttl);
    } catch (e) {
      throw toLoadError(e);
    }
    if (res.error || !res.data?.signedUrl) throw toLoadError(res.error ?? { code: 'SIGN' });
    return { uri: res.data.signedUrl, expiresAt: Date.now() + ttl * 1000 };
  }

  async function consentAllowed(childId: string, purpose: string): Promise<boolean> {
    const data = await loadData(client.rpc('app_consent_centre', {}));
    const child = asRows((data as Row | null)?.children).find((c) => str(c.cadet_id) === childId);
    return parseConsentStates(child?.consents).some((c) => c.purpose === purpose && c.allowed);
  }

  async function skillsFor(sessionIds: string[]): Promise<Map<string, { id: string; name: string; category: 'RIDING' | 'GROUND' | 'STABLE' | null }[]>> {
    const out = new Map<string, { id: string; name: string; category: 'RIDING' | 'GROUND' | 'STABLE' | null }[]>();
    if (sessionIds.length === 0) return out;
    // Skill names are display-only: if the catalogue can't be read the scores still show (same rule as FA-01).
    try {
      const links = await loadRows(client.from('session_skills').select('session_id, skill_id').in('session_id', sessionIds));
      const ids = [...new Set(links.map((l) => str(l.skill_id)).filter(Boolean))];
      if (ids.length === 0) return out;
      const skills = await loadRows(client.from('skills').select('id, name, category').in('id', ids));
      const byId = new Map(skills.map((s) => [str(s.id), s]));
      for (const l of links) {
        const s = byId.get(str(l.skill_id));
        if (!s || !str(s.name)) continue;
        const cat = s.category === 'RIDING' || s.category === 'GROUND' || s.category === 'STABLE' ? s.category : null;
        const list = out.get(str(l.session_id)) ?? [];
        list.push({ id: str(s.id), name: str(s.name), category: cat });
        out.set(str(l.session_id), list);
      }
      for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return new Map();
    }
    return out;
  }

  const sessionsQuery = (childId: string) =>
    client.from('training_sessions').select(SESSION_COLS).eq('cadet_id', childId).eq('brass_stamp_verified', true);

  const spark: SparkFeature = {
    createAudio: deviceSparkAudio,
    repository: {
      async getToday(scope: SparkScope) {
        if (!scope.cadetId) throw outOfScope('CHILD');
        const child = requireChild(scope, scope.cadetId);
        const data = (await loadData(client.rpc('app_spark_today', { p_cadet_id: child.id }))) as Row | null;
        if (!data || typeof data !== 'object') throw shapeError('spark');
        const s = data.spark && typeof data.spark === 'object' ? (data.spark as Row) : null;
        let content: SparkContent | null = null;
        if (s) {
          const path = str(s.audio_object_path);
          const audio = SPARK_AUDIO.test(path) && !path.includes('..') && storage ? await sign(str(s.audio_bucket) || 'app-content', path, CONTENT_URL_TTL_S) : null;
          content = {
            id: str(s.spark_id),
            title: str(s.title),
            subtitle: '',
            dateLabel: dayLabel(str(s.local_date)),
            durationMs: (int(s.duration_seconds) ?? 0) * 1000,
            audio: audio ? { uri: audio.uri } : null,
            peaks: null, // the contract carries no measured peaks: the waveform stays hidden
          };
        }
        const streak = data.streak && typeof data.streak === 'object' ? (data.streak as Row) : {};
        return {
          source: 'server' as const,
          cadetId: child.id,
          spark: content,
          policy: { ...D18_PROPOSED, timeZone: str(data.timezone) || D18_PROPOSED.timeZone },
          acknowledgement: { acknowledged: data.acknowledged === true, at: strOrNull(data.acknowledged_at) },
          streak: { enabled: streak.enabled === true, current: int(streak.current), longest: int(streak.longest) },
        };
      },
      async acknowledge(scope, req) {
        const child = childrenOf(scope).find((c) => c.id === req.cadetId);
        if (!child) throw new FamilyCommandError('notFound', 'child not in this account', 'CLIENT-SCOPE');
        if (!isUuid(req.operationId) || !isUuid(req.sparkId)) throw new FamilyCommandError('invalid', 'bad id', 'CLIENT-ID');
        const r = await runCommand(client.rpc('app_ack_spark', { p_cadet_id: child.id, p_spark_id: req.sparkId, p_operation_id: req.operationId }));
        return { acknowledgedAt: str(r.acknowledged_at), already: r.already_acknowledged === true, duplicate: r.duplicate === true };
      },
    },
  };

  return {
    linkedChildren: childrenOf,

    progress: {
      async get(scope, childId) {
        const child = requireChild(scope, childId);
        const [cadet, rows] = await Promise.all([
          loadRows(client.from('cadets').select('id, current_rank').eq('id', child.id).limit(1)),
          loadRows(sessionsQuery(child.id).order('session_date', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1)),
        ]);
        return { source: 'server', childId: child.id, currentRank: strOrNull(cadet[0]?.current_rank), ...page(rows, child.id) };
      },
      async older(scope, childId, cursor) {
        const child = requireChild(scope, childId);
        const c = decodeCursor(cursor);
        if (!c) throw outOfScope('CURSOR');
        // Keyset (session_date desc, id desc): a session published meanwhile never shifts or repeats rows.
        const rows = await loadRows(
          sessionsQuery(child.id)
            .or(`session_date.lt.${c.date},and(session_date.eq.${c.date},id.lt.${c.id})`)
            .order('session_date', { ascending: false })
            .order('id', { ascending: false })
            .limit(PAGE_SIZE + 1),
        );
        return page(rows, child.id);
      },
      async clips(scope, childId) {
        const child = requireChild(scope, childId);
        const rows = await loadRows(sessionsQuery(child.id).order('session_date', { ascending: false }).order('id', { ascending: false }).limit(200));
        const clips: ClipEntry[] = [];
        for (const r of rows) {
          const sum = toSummary(r, child.id);
          const objectPath = clipPathFor(child.id, r.video_log_s3_url);
          if (sum && objectPath) clips.push({ ...sum, clip: { sessionId: sum.id, childId: child.id, date: sum.date, objectPath } });
        }
        return { source: 'server', clips };
      },
    },

    sessions: {
      async get(scope, recordId) {
        if (!isUuid(recordId)) throw outOfScope('ID');
        const rows = await loadRows(
          client
            .from('training_sessions')
            .select(`${SESSION_COLS}, instructor_notes, brass_stamp_verified`)
            .eq('id', recordId)
            .limit(1),
        );
        const r = rows[0];
        const childId = str(r?.cadet_id);
        // RLS already limits rows to the guardian's children; the snapshot check is the client-side second gate.
        if (!r || r.brass_stamp_verified !== true || !childrenOf(scope).some((c) => c.id === childId)) throw outOfScope('SESSION');
        const summary = toSummary(r, childId);
        if (!summary) throw shapeError('scores');
        const [skills, corrections] = await Promise.all([
          skillsFor([summary.id]),
          (int(r.version) ?? 1) > 1
            ? loadRows(client.from('training_session_corrections').select('corrected_at, reason').eq('session_id', summary.id).order('corrected_at', { ascending: false })).catch(() => [])
            : Promise.resolve([] as Row[]),
        ]);
        const objectPath = clipPathFor(childId, r.video_log_s3_url);
        const clip: ClipRef | null = objectPath ? { sessionId: summary.id, childId, date: summary.date, objectPath } : null;
        return {
          source: 'server',
          id: summary.id,
          childId,
          date: summary.date,
          scores: summary.scores,
          skills: skills.get(summary.id) ?? [],
          notes: strOrNull(typeof r.instructor_notes === 'string' ? r.instructor_notes.trim() : null),
          version: int(r.version) ?? 1,
          corrections: corrections.map((c) => ({ at: str(c.corrected_at), reason: strOrNull(c.reason) })).filter((c) => c.at),
          clip,
        };
      },
    },

    media: {
      available: Boolean(storage),
      async clipUrl(scope, clip) {
        const child = requireChild(scope, clip.childId);
        const path = clipPathFor(child.id, clip.objectPath);
        if (!path) throw outOfScope('CLIP');
        // Fail closed: no URL is requested unless the CURRENT session_video consent is allowed (§3.1 `allowed`).
        if (!(await consentAllowed(child.id, SESSION_VIDEO))) throw new ScopedLoadError('Session video consent is off for this child.', 'CONSENT-session_video', true);
        return sign('session-videos', path, CLIP_URL_TTL_S);
      },
      async imageUrl(scope, image) {
        const m = EVENT_IMAGE.exec(image.path);
        const hubs = new Set(childrenOf(scope).map((c) => c.hubId?.toLowerCase()));
        if (image.bucket !== 'app-content' || !m || image.path.includes('..') || !hubs.has(m[1]?.toLowerCase())) throw outOfScope('IMAGE');
        return sign('app-content', image.path, CONTENT_URL_TTL_S);
      },
    },

    passport: {
      async get(scope, childId) {
        const child = requireChild(scope, childId);
        const [cadet, sessionRows, rankRows, achievementRows] = await Promise.all([
          loadRows(client.from('cadets').select('id, current_rank, passport_code').eq('id', child.id).limit(1)),
          loadRows(sessionsQuery(child.id).order('session_date', { ascending: false }).order('id', { ascending: false }).limit(200)),
          loadRows(client.from('rank_history').select('id, from_rank, to_rank, promoted_at').eq('cadet_id', child.id).order('promoted_at', { ascending: true })),
          loadRows(client.from('achievements').select('id, achievement_type, title, awarded_at').eq('cadet_id', child.id).order('awarded_at', { ascending: true })),
        ]);
        const summaries = sessionRows.map((r) => toSummary(r, child.id)).filter((s): s is SessionSummary => s !== null);
        const skills = await skillsFor(summaries.map((s) => s.id));
        const sessions: LiveSessionRecord[] = summaries.map((s) => ({
          id: s.id,
          sessionDate: s.date,
          version: s.corrected ? 2 : 1,
          scores: s.scores,
          skills: (skills.get(s.id) ?? []).map((k) => ({ id: k.id, name: k.name })),
          hasClip: s.hasClip,
        }));
        const rankChanges: LiveRankChange[] = rankRows
          .map((r) => ({ id: str(r.id), fromRank: strOrNull(r.from_rank), toRank: str(r.to_rank), promotedAt: str(r.promoted_at) }))
          .filter((r) => r.id && r.toRank && r.promotedAt);
        const achievements: LiveAchievement[] = achievementRows
          .map((a) => ({ id: str(a.id), type: str(a.achievement_type), title: str(a.title), awardedAt: strOrNull(a.awarded_at) }))
          .filter((a) => a.id && a.title);
        return {
          source: 'server',
          childId: child.id,
          passportCode: strOrNull(cadet[0]?.passport_code),
          input: toPassportInput({ cadetId: child.id, currentRank: strOrNull(cadet[0]?.current_rank), sessions, rankChanges, achievements, dataAsOf: new Date().toISOString() }),
        };
      },
    },

    horse: {
      async get(scope, childId) {
        const child = requireChild(scope, childId);
        const [cadet, hub] = await Promise.all([
          loadRows(client.from('cadets').select('id, assigned_horse_id').eq('id', child.id).limit(1)),
          child.hubId ? loadRows(client.from('school_hubs').select('school_name').eq('id', child.hubId).limit(1)).catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
        ]);
        const horseId = strOrNull(cadet[0]?.assigned_horse_id);
        // Safe columns only (MIG S7a): no microchip, no camera link.
        const horse = horseId ? (await loadRows(client.from('equine_fleet').select('id, name, breed, height_hands, temperament, is_active').eq('id', horseId).limit(1)))[0] : undefined;
        return {
          source: 'server',
          childId: child.id,
          hubName: strOrNull(hub[0]?.school_name),
          horse: horse
            ? {
                id: str(horse.id),
                name: str(horse.name),
                breed: strOrNull(horse.breed),
                heightHands: typeof horse.height_hands === 'number' ? horse.height_hands : typeof horse.height_hands === 'string' && horse.height_hands ? Number(horse.height_hands) : null,
                temperament: strOrNull(horse.temperament),
                active: horse.is_active !== false,
              }
            : null,
          care: { status: 'unavailable', decisionRef: 'SD-04' },
        };
      },
    },

    stream: {
      async capability(scope, childId) {
        const child = requireChild(scope, childId);
        return parseStreamCapability(await loadData(client.rpc('app_stream_capability', { p_cadet_id: child.id })));
      },
      // No requestGrant: no provider or issuing Edge Function exists (BACKEND_CONTRACT_V2 §3.9).
    },

    events: {
      async list(scope) {
        const linked = childrenOf(scope);
        if (linked.length === 0) return { source: 'server', events: [] };
        const rows = await loadRows(client.rpc('app_list_events', {}));
        return { source: 'server', events: rows.map((r) => parseEvent(r, linked)).filter((e): e is FamilyEvent => e !== null) };
      },
      async detail(scope, eventId) {
        if (!isUuid(eventId)) throw outOfScope('ID');
        const data = await loadData(client.rpc('app_event_detail', { p_event_id: eventId }));
        const event = data && typeof data === 'object' && !Array.isArray(data) ? parseEvent(data as Row, childrenOf(scope)) : null;
        if (!event) throw shapeError('event');
        return { source: 'server', event };
      },
      async rsvp(scope, cmd) {
        const child = requireChildForCommand(scope, cmd.childId);
        if (!isUuid(cmd.eventId) || !isUuid(cmd.operationId)) throw new FamilyCommandError('invalid', 'bad id', 'CLIENT-ID');
        return rsvpResult(await runCommand(client.rpc('app_rsvp_event', { p_event_id: cmd.eventId, p_cadet_id: child.id, p_operation_id: cmd.operationId })), 'confirmed');
      },
      async cancel(scope, cmd) {
        const child = requireChildForCommand(scope, cmd.childId);
        if (!isUuid(cmd.eventId) || !isUuid(cmd.operationId)) throw new FamilyCommandError('invalid', 'bad id', 'CLIENT-ID');
        return rsvpResult(await runCommand(client.rpc('app_cancel_rsvp', { p_event_id: cmd.eventId, p_cadet_id: child.id, p_operation_id: cmd.operationId })), 'cancelled');
      },
    },

    consent: {
      async centre(scope) {
        const linked = childrenOf(scope);
        const data = (await loadData(client.rpc('app_consent_centre', {}))) as Row | null;
        if (!data || typeof data !== 'object') throw shapeError('consent');
        const purposes = asRows(data.purposes)
          .map((p) => ({ purpose: str(p.purpose), title: str(p.title), description: strOrNull(p.description), policyVersion: str(p.policy_version) }))
          .filter((p) => p.purpose && p.title && p.policyVersion);
        const ids = new Set(linked.map((c) => c.id));
        const children: ConsentCentre['children'] = asRows(data.children)
          .filter((c) => ids.has(str(c.cadet_id)))
          .map((c) => ({ childId: str(c.cadet_id), firstName: str(c.first_name), consents: parseConsentStates(c.consents) }));
        return { source: 'server', purposes, children };
      },
      async history(scope, childId) {
        const child = requireChild(scope, childId);
        const rows = await loadRows(client.rpc('app_consent_history', { p_cadet_id: child.id }));
        return rows
          .map((r) => ({
            id: str(r.consent_id),
            purpose: str(r.purpose),
            granted: r.granted === true,
            policyVersion: str(r.policy_version),
            recordedAt: str(r.recorded_at),
            byCurrentGuardian: r.recorded_by_current_guardian === true,
          }))
          .filter((r) => r.id && r.recordedAt);
      },
      async set(scope, cmd) {
        const child = requireChildForCommand(scope, cmd.childId);
        if (!isUuid(cmd.operationId)) throw new FamilyCommandError('invalid', 'bad id', 'CLIENT-ID');
        const r = await runCommand(
          client.rpc('app_set_media_consent', {
            p_cadet_id: child.id,
            p_purpose: cmd.purpose,
            p_granted: cmd.granted,
            p_policy_version: cmd.policyVersion,
            p_operation_id: cmd.operationId,
          }),
        );
        if (typeof r.granted !== 'boolean') throw new FamilyCommandError('unexpected', 'unexpected response shape', 'SHAPE-granted');
        return { granted: r.granted, recordedAt: strOrNull(r.recorded_at), changed: r.changed === true, duplicate: r.duplicate === true };
      },
    },

    spark,
  };
}
