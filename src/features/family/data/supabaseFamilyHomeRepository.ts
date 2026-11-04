import { ScopedLoadError } from '@/core/data/useScopedResource';
import { dateLabel } from '@/core/format/hubTime';
import { readRows as rows } from '@/features/field/data/net';
import type { DataClient } from '@/features/field/data/supabaseFieldWorkflowRepository';

import type { FamilyHomeData, FamilyHomeRepository, FamilyScope } from '../types';

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const score = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);

/**
 * Family home from the server. The guardian's children come from the access snapshot; every read below is limited by
 * RLS to the guardian's own children (SLICE_CONTRACT §B). The app never asks for a child that is not in the snapshot.
 * No schedule source exists, so nextSession and attendance stay empty and their cards are hidden.
 */
export function createSupabaseFamilyHomeRepository(client: DataClient): FamilyHomeRepository {
  return {
    async getHome(scope: FamilyScope, childId?: string): Promise<FamilyHomeData> {
      if (scope.experience !== 'family') throw new ScopedLoadError('Denied', 'SCOPE');
      const children = scope.children ?? [];
      const selected = children.find((c) => c.cadetId === childId) ?? children[0] ?? null;
      const base: FamilyHomeData = {
        source: 'server',
        guardianFirstName: (scope.displayName ?? '').split(/[\s@]/)[0] ?? '',
        hubName: '',
        children: children.map((c) => ({ id: c.cadetId, name: c.firstName })),
        selectedChildId: selected?.cadetId ?? null,
        nextSession: null,
        latestAssessment: null,
        recentAttendance: [],
      };
      if (!selected) return base;

      const [hub, sessions] = await Promise.all([
        selected.hubId ? rows(client.from('school_hubs').select('school_name').eq('id', selected.hubId).limit(1)) : Promise.resolve([]),
        rows(
          client
            .from('training_sessions')
            .select('id, session_date, riding_score, ground_score, stable_score, version')
            .eq('cadet_id', selected.cadetId)
            .order('session_date', { ascending: false })
            .order('id', { ascending: true })
            .limit(5),
        ),
      ]);
      base.hubName = s(hub[0]?.school_name);

      // Legacy rows may lack scores; show the newest complete assessment only.
      const latest = sessions.find((r) => score(r.riding_score) && score(r.ground_score) && score(r.stable_score));
      if (!latest) return base;

      let skills: string[] = [];
      const links = await rows(client.from('session_skills').select('skill_id').eq('session_id', s(latest.id)));
      const ids = links.map((l) => s(l.skill_id)).filter(Boolean);
      if (ids.length) {
        // Skill names are display-only; if the catalogue can't be read, the scores still show.
        skills = await rows(client.from('skills').select('id, name').in('id', ids))
          .then((r) => r.map((x) => s(x.name)).filter(Boolean).sort())
          .catch(() => []);
      }

      base.latestAssessment = {
        dateLabel: dateLabel(s(latest.session_date)),
        riding: score(latest.riding_score) as number,
        ground: score(latest.ground_score) as number,
        stable: score(latest.stable_score) as number,
        skills,
        corrected: typeof latest.version === 'number' && latest.version > 1,
      };
      return base;
    },
  };
}
