/**
 * SH-09 diagnostic ID and copyable diagnostic text. Pure.
 *
 * 11 observability / SCREEN_REGISTER SH-09 acceptance: the text contains no names, tokens, QR contents or precise
 * location. It is built ONLY from an allow-list of non-personal fields (app version, build type, platform, OS
 * version, adapter name, a random per-launch ID and an error reference code), and every value is re-checked
 * against personal-data patterns before it is included.
 */
export type DiagnosticInput = {
  /** Random per app launch (newDiagnosticId); not derived from the person, device or account. */
  diagnosticId: string;
  appVersion: string | null;
  build: 'development' | 'release';
  platform: string;
  osVersion: string | null;
  adapter: string;
  /** Error reference shown on a failed screen (SQLSTATE / HTTP / fixture code), if any. */
  reference?: string | null;
  /** ISO timestamp, minute precision (no seconds: not needed to correlate, and less fingerprinting). */
  at: Date;
};

// Crockford base32 without I, L, O, U: readable over the phone.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "BSAH-7K3F-Q2MX". Uses the platform CSPRNG when present. */
export function newDiagnosticId(rand: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = rand(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
  return `BSAH-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

const PERSONAL_PATTERNS: readonly RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // e-mail
  /(?:\+?\d[\s()-]*){10,}/, // phone-like: 10+ digits, optionally spaced (Indian mobiles have 10); dates have 8
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // uuid (subject, hub, cadet ids)
  /BSAH-\d{2}-[A-Z0-9]{6,}/i, // passport code
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b(?:sb_(?:secret|publishable)_)\w+/i, // Supabase keys
  /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/, // lat,long
  /\/verify\//i, // QR payload URL
];

/** True when the text looks like it carries personal or secret data. */
export const looksPersonal = (text: string): boolean => PERSONAL_PATTERNS.some((p) => p.test(text));

/** Error references are short codes (PT404, 42501, HTTP-503, FIXTURE-500-0001). Anything else is dropped. */
export function sanitizeReference(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const s = ref.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(s)) return null;
  return looksPersonal(s) ? null : s.toUpperCase();
}

/** Each field must match its own strict format as given (nothing is stripped to make it fit); else "redacted". */
const FORMATS = {
  version: /^v?\d{1,4}(?:\.\d{1,4}){0,3}(?:-[0-9A-Za-z.]{1,16})?$/,
  platform: /^(?:ios|android|web|windows|macos)$/,
  osVersion: /^\d{1,3}(?:\.\d{1,3}){0,3}$/,
  adapter: /^[A-Za-z][A-Za-z -]{0,39}$/,
} as const;
const field = (v: string | null | undefined, format: RegExp): string => {
  if (!v) return 'unknown';
  const s = v.trim();
  return format.test(s) && !looksPersonal(s) ? s : 'redacted';
};

/** Lines of the copyable diagnostic text, in a fixed order. */
export function diagnosticLines(d: DiagnosticInput): string[] {
  const at = new Date(Math.floor(d.at.getTime() / 60_000) * 60_000).toISOString().replace(':00.000Z', 'Z');
  const ref = sanitizeReference(d.reference);
  return [
    `Diagnostic ID: ${/^BSAH-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(d.diagnosticId) ? d.diagnosticId : 'redacted'}`,
    `App: ${field(d.appVersion, FORMATS.version)} (${d.build})`,
    `Platform: ${field(d.platform, FORMATS.platform)} ${field(d.osVersion, FORMATS.osVersion)}`,
    `Sign-in adapter: ${field(d.adapter, FORMATS.adapter)}`,
    ...(ref ? [`Reference: ${ref}`] : []),
    `Time (UTC): ${at}`,
  ];
}

export const buildDiagnosticText = (d: DiagnosticInput): string => diagnosticLines(d).join('\n');
