/**
 * FO-04 Camera capture contract (shared by Field assessment, care tasks and shift check-in).
 * Owner: Field workstream (implements the screen at route `/field/capture`). Other features call `requestCapture`
 * and await the result; nothing else about the camera leaks out of this module.
 */
export type CaptureMode = 'session_video' | 'care_photo' | 'shift_selfie';

export type CaptureResult = {
  mode: CaptureMode;
  /** Local file URI owned by the app's capture cache; the caller uploads or queues it, then releases it. */
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Device time of capture (ISO). The server records its own receipt time. */
  capturedAt: string;
};

export type CaptureRequest = {
  mode: CaptureMode;
  /** Shown on the capture screen, e.g. "Care photo · Morning feed". */
  purpose: string;
  /** Caller already verified consent where the mode needs it (session_video). The capture screen refuses otherwise. */
  consentConfirmed?: boolean;
};

type Pending = { request: CaptureRequest; resolve: (r: CaptureResult | null) => void };
const pending = new Map<string, Pending>();
let seq = 0;

/** Registers a request and returns its token; the caller navigates to `/field/capture?token=<token>`. */
export function registerCapture(request: CaptureRequest): { token: string; result: Promise<CaptureResult | null> } {
  const token = `cap-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  const result = new Promise<CaptureResult | null>((resolve) => pending.set(token, { request, resolve }));
  return { token, result };
}

/** Capture screen: read the request for a token (null when unknown or already settled). */
export function readCaptureRequest(token: string | undefined): CaptureRequest | null {
  return (token && pending.get(token)?.request) || null;
}

/** Capture screen: settle once with a result, or null on cancel. Later calls are ignored. */
export function settleCapture(token: string, result: CaptureResult | null): void {
  const p = pending.get(token);
  if (!p) return;
  pending.delete(token);
  p.resolve(result);
}

/** Sign-out / experience switch: cancel everything outstanding. */
export function cancelAllCaptures(): void {
  for (const [token] of pending) settleCapture(token, null);
}
