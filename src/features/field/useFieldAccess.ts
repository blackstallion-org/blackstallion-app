import { useMemo } from 'react';

import { useRepositories } from '@/core/data/RepositoryProvider';
import { useAuthorizedAccess } from '@/features/identity/AccessProvider';

import type { FieldAppRepositories, FieldCommandRepository } from './data/repositories';
import type { FieldWorkflowRepository } from './domain/workflow';
import type { FieldScope } from './types';

export type FieldAccess = {
  scope: FieldScope;
  /** Scopes every cached read: subject:experience[:hub]. */
  contextKey: string;
  /** UX only: the server refuses anything the role may not do (MIG:340,387,452; MIG9). */
  canRecord: boolean;
  canViewCadets: boolean;
  canUploadVideo: boolean;
  fieldApp?: FieldAppRepositories;
  /** Check-in / publish / correct for this caller. Absent when no backend is connected. */
  commands?: FieldCommandRepository;
  /** Check-in / publish only (older composition without fieldApp). */
  workflow?: FieldWorkflowRepository;
  isPreview: boolean;
};

/**
 * Who the Field screens act for. Server sessions carry role, hub and capabilities from app_access_snapshot();
 * synthetic preview personas carry none, so development fixtures may supply a labelled stand-in (never on a server
 * session).
 */
export function useFieldAccess(): FieldAccess {
  const { state, contextKey } = useAuthorizedAccess();
  const { fieldApp, fieldWorkflow } = useRepositories();
  const session = state.session;
  return useMemo(() => {
    const preview = session.source === 'synthetic-preview' && !session.scope ? (fieldApp?.previewAccess?.(session.subjectId) ?? null) : null;
    const caps = session.scope?.capabilities ?? preview?.capabilities ?? {};
    const scope: FieldScope = {
      subjectId: session.subjectId,
      experience: 'field',
      hubId: session.scope?.hubId ?? preview?.hubId ?? null,
      role: session.scope?.role ?? preview?.role,
      displayName: session.displayName,
    };
    const commands = fieldApp?.commands(scope);
    return {
      scope,
      contextKey,
      canRecord: caps.recordAssessment === true,
      canViewCadets: caps.viewHubCadets === true,
      canUploadVideo: caps.uploadSessionVideo === true,
      fieldApp,
      commands,
      workflow: commands ?? fieldWorkflow,
      isPreview: session.source === 'synthetic-preview',
    };
  }, [session, contextKey, fieldApp, fieldWorkflow]);
}
