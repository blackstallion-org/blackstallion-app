/**
 * Passport QR payload or typed code → normalised passport code.
 * The server is the authority: field_record_check_in matches btrim(code) exactly at the caller's hub. This only
 * rejects input that can never match, so staff get an immediate, specific message before any network call.
 * QR payloads are `<site>/verify/<passport_code>` (16_FOUNDATION_VALIDATION); codes look like BSAH-26-F3A00001.
 */
export type PassportParse = { ok: true; code: string } | { ok: false; reason: 'empty' | 'format' };

const CODE = /^[A-Z0-9-]{4,40}$/;
const VERIFY_PATH = /\/verify\/([A-Za-z0-9-]{4,40})\/?(?:[?#].*)?$/;

export function parsePassportInput(raw: string): PassportParse {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };
  const fromLink = VERIFY_PATH.exec(text);
  // Issued codes are upper case (BSAH-YY-XXXXXXXX). Typed lower-case input is normalised; see DECISIONS in ARCHITECTURE.md.
  const candidate = (fromLink?.[1] ?? text).toUpperCase();
  return CODE.test(candidate) ? { ok: true, code: candidate } : { ok: false, reason: 'format' };
}
