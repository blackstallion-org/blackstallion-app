// Test-only: a Transport + upload path that talk to the LOCAL THROWAWAY Postgres replica (server/live-delta/g5-field-care)
// through psql, executing the real field.* functions and storage policies as the signed-in synthetic user.
// Never point this at a hosted or live database.
/* eslint-disable @typescript-eslint/no-require-imports */
import type { SubmitRequest, Transport, UploadIntentRequest, UploadTarget } from '../domain/ports';
import { TransportError } from '../domain/ports';

const { execFileSync } = require('node:child_process') as typeof import('node:child_process');

const PSQL = '/opt/homebrew/opt/postgresql@18/bin/psql';

export interface ReplicaOptions {
  port: string;
  /** the account whose token the transport carries (null = signed out) */
  token: { subject: string | null; valid: boolean };
  offline?: () => boolean;
  /** lose the response after the server committed */
  dropAfterCommit?: { count: number };
}

function q(v: string | null): string {
  return v === null ? 'null' : `'${v.replace(/'/g, "''")}'`;
}

function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : 'null';
}

export function psql(port: string, sql: string): string {
  try {
    return execFileSync(PSQL, ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'bsah_live', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: `\\set VERBOSITY verbose\n${sql}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? '');
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
    if (!m) throw new Error(`psql failed: ${stderr.slice(0, 400)}`);
    const sqlstate = m[1]!;
    const message = m[2]!.trim();
    const status = sqlstate.startsWith('PT') ? Number(sqlstate.slice(2)) : sqlstate === '42501' ? 403 : 500;
    // Supabase Storage answers an RLS refusal with 403; give it a stable code
    const code = sqlstate === '42501' && message.includes('row-level security') ? 'storage_denied' : message;
    throw new TransportError('http', { status, code, message: `${sqlstate} ${message}` });
  }
}

/** Run SQL as the synthetic user (PostgREST-style: jwt sub claim + role authenticated). */
export function asUser(port: string, subject: string, sql: string): string {
  return psql(port, `begin;\nset local "request.jwt.claim.sub" = ${q(subject)};\nset local role authenticated;\n${sql}\ncommit;`);
}

export function createReplicaTransport(o: ReplicaOptions): Transport & { uploadAs(mediaPath: string): void } {
  const guard = (actorId: string): string => {
    if (o.offline?.()) throw new TransportError('network', { message: 'offline' });
    if (!o.token.valid || !o.token.subject) throw new TransportError('http', { status: 401, code: 'no_session' });
    // a correct adapter refuses to send queued work with another account's token
    if (o.token.subject !== actorId) throw new TransportError('http', { status: 403, code: 'not_owner_session' });
    return o.token.subject;
  };
  return {
    async createUploadIntent(req: UploadIntentRequest): Promise<UploadTarget> {
      const subject = guard(req.actorId);
      const hub = psql(o.port, `select hub_id from public.users where id = ${q(subject)}`);
      return { mediaPath: `${hub}/${subject}/${req.operationId}.jpg`, url: `local-replica://${req.operationId}`, expiresAt: Date.now() + 60_000 };
    },
    uploadAs(mediaPath: string): void {
      const subject = guard(o.token.subject ?? '');
      // object insert under the real g5_proof_photos_staff_insert policy; idempotent on retry
      asUser(o.port, subject, `insert into storage.objects (bucket_id, name) select 'proof-photos', ${q(mediaPath)}
        where not exists (select 1 from storage.objects where bucket_id = 'proof-photos' and name = ${q(mediaPath)});`);
    },
    async submit(req: SubmitRequest): Promise<Record<string, unknown>> {
      const subject = guard(req.actorId);
      const p = req.payload as { occurrenceId: string; horseId: string; mediaPath: string; observedAt: string;
        location: { latitude: number; longitude: number; accuracyM: number | null } | null };
      const out = asUser(o.port, subject, `select field.submit_care_evidence(${q(req.operationId)}::uuid, ${q(req.payloadHash)}, ${q(p.occurrenceId)}::uuid,
        ${q(p.horseId)}::uuid, ${q(p.mediaPath)}, ${q(p.observedAt)}::timestamptz, ${num(p.location?.latitude)}, ${num(p.location?.longitude)},
        ${num(p.location?.accuracyM)})::text;`);
      if (o.dropAfterCommit && o.dropAfterCommit.count > 0) {
        o.dropAfterCommit.count--;
        throw new TransportError('network', { message: 'response lost after commit' });
      }
      return JSON.parse(out) as Record<string, unknown>;
    },
  };
}
