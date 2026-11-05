import { ScopedLoadError } from '@/core/data/useScopedResource';
import { dateLabel, hubDate, hubTime } from '@/core/format/hubTime';

import type { FieldScope, FieldTodayData, FieldTodayRepository } from '../types';
import { readRows } from './net';
import type { ServerClock } from './serverClock';
import type { DataClient } from './supabaseFieldWorkflowRepository';
import { voidedCheckIns } from './voids';

const ROLE_LABEL: Record<string, string> = { INSTRUCTOR: 'Instructor', GROOM: 'Groom', SCHOOL_ADMIN: 'Hub admin' };
/** Keeps `.in()` id lists well under URL limits (~37 chars per uuid). */
const MAX_ROWS = 100;
const s = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Field "Today" from the server. Sources (all under RLS, SLICE_CONTRACT §B): school_hubs (name), cadet_check_ins
 * (today, this hub, voided ones left out), cadets (names), training_sessions (instructors only: which check-ins are already published).
 * There are no schedule, roster or care-assignment sources yet, so those stay empty and are labelled not connected.
 */
export function createSupabaseFieldTodayRepository(
  client: DataClient,
  opts: { clock?: ServerClock; localNow?: () => number; timeoutMs?: number } = {},
): FieldTodayRepository {
  const localNow = opts.localNow ?? Date.now;
  return {
    async getToday(scope: FieldScope): Promise<FieldTodayData> {
      if (scope.experience !== 'field') throw new ScopedLoadError('Denied', 'SCOPE');
      const hubId = scope.hubId;
      if (!hubId) throw new ScopedLoadError('Your account isn’t linked to a hub. Ask your hub admin.', 'NO-HUB', true);
      // "Today" by the server's clock when it can be measured; the phone's otherwise (listing only, no writes).
      const offset = opts.clock ? await opts.clock.offsetMs().catch(() => 0) : 0;
      const day = hubDate(new Date(localNow() + offset));
      const canReadSessions = scope.role === 'INSTRUCTOR';

      const [hub, allCheckIns] = await Promise.all([
        readRows(client.from('school_hubs').select('school_name').eq('id', hubId).limit(1), opts.timeoutMs),
        readRows(
          client
            .from('cadet_check_ins')
            .select('id, cadet_id, received_at, client_operation_id')
            .eq('hub_id', hubId)
            .eq('session_date', day)
            .order('received_at', { ascending: false })
            .limit(MAX_ROWS),
          opts.timeoutMs,
        ),
      ]);

      // a voided check-in (G9, SD-05 draft) is not "checked in today"
      const voided = await voidedCheckIns(client, allCheckIns.map((c) => s(c.id)).filter(Boolean), opts.timeoutMs);
      const checkIns = allCheckIns.filter((c) => !voided.has(s(c.id)));
      const cadetIds = Array.from(new Set(checkIns.map((c) => s(c.cadet_id)).filter(Boolean)));
      const checkInIds = checkIns.map((c) => s(c.id)).filter(Boolean);
      const [cadets, sessions] = await Promise.all([
        cadetIds.length ? readRows(client.from('cadets').select('id, first_name, last_name').in('id', cadetIds), opts.timeoutMs) : Promise.resolve([]),
        canReadSessions && checkInIds.length
          ? readRows(client.from('training_sessions').select('check_in_id').in('check_in_id', checkInIds), opts.timeoutMs)
          : Promise.resolve([]),
      ]);

      const names = new Map(cadets.map((c) => [s(c.id), `${s(c.first_name)} ${s(c.last_name)}`.trim()]));
      const published = new Set(sessions.map((t) => s(t.check_in_id)));
      const list = checkIns.map((c) => ({
        checkInId: s(c.id),
        checkInOperationId: s(c.client_operation_id),
        cadetId: s(c.cadet_id),
        cadetName: names.get(s(c.cadet_id)) || 'Cadet',
        time: hubTime(s(c.received_at)),
        published: canReadSessions ? published.has(s(c.id)) : null,
      }));

      return {
        source: 'server',
        staffFirstName: (scope.displayName ?? '').split(/[\s@]/)[0] ?? '',
        roleLabel: ROLE_LABEL[scope.role ?? ''] ?? 'Staff',
        hubName: s(hub[0]?.school_name) || 'Your hub',
        dateLabel: dateLabel(day),
        pendingSyncCount: 0,
        overdueCareCount: 0,
        sessions: [],
        care: [],
        careAvailable: false,
        cadets: list.map((c) => ({ id: c.cadetId, name: c.cadetName, group: 'Checked in today' })),
        checkIns: list,
      };
    },
  };
}
