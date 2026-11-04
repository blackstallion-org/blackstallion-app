/**
 * Operation ids make every field command replay-safe: the same id + the same payload returns the original result
 * (duplicate: true) instead of writing twice. An id is bound to one payload; changing the payload needs a new id.
 */
export type OperationLatch = { operationId: string; payloadKey: string };

export function latchOperation(
  prev: OperationLatch | null,
  payloadKey: string,
  make: () => string = newOperationId,
): OperationLatch {
  return prev && prev.payloadKey === payloadKey ? prev : { operationId: make(), payloadKey };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

type CryptoLike = { randomUUID?: () => string; getRandomValues?: <T extends Uint8Array>(a: T) => T };

/**
 * RFC 4122 v4 id. Uses the platform CSPRNG when present. Ids need uniqueness, not secrecy: the server binds each id
 * to its caller, so a guessed id cannot replay or overwrite another person's operation (MIG:345-351).
 */
export function newOperationId(c: CryptoLike | undefined = (globalThis as { crypto?: CryptoLike }).crypto): string {
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
