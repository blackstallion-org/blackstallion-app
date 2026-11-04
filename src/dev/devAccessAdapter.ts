import type { AccessAdapter } from '@/core/auth/accessAdapter';

import { PERSONAS, type PersonaId } from './personas';

/**
 * DEVELOPMENT-ONLY adapter. Holds the selected synthetic persona in memory
 * only, so every cold start begins signed out. It simulates an adapter
 * result; it cannot grant a server role.
 */
export const createDevAccessAdapter = ({ latencyMs = 350 }: { latencyMs?: number } = {}) => {
  let selected: PersonaId | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const adapter: AccessAdapter & { selectPersona: (id: PersonaId) => void } = {
    name: 'development synthetic preview',
    async load() {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      if (!selected) return { kind: 'signedOut' };
      const persona = PERSONAS.find((p) => p.id === selected);
      if (!persona || !persona.snapshot) throw new Error('Simulated bootstrap failure');
      return persona.snapshot;
    },
    async signOut() {
      selected = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectPersona(id) {
      selected = id;
      notify();
    },
  };
  return adapter;
};

export type DevAccessAdapter = ReturnType<typeof createDevAccessAdapter>;
