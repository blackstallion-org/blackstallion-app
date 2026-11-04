/**
 * In-memory hand-off from Scan/Today to Assess. The cadet's name never goes into a route URL (deep links and logs
 * can expose URLs); only the opaque operation id does. Cleared on sign-out with the rest of the JS state.
 */
export type AssessTarget = { checkInOperationId: string; cadetId: string; cadetName: string };

const targets = new Map<string, AssessTarget>();

export function rememberAssessTarget(t: AssessTarget): void {
  targets.set(t.checkInOperationId, t);
}

export function recallAssessTarget(op: string | undefined): AssessTarget | null {
  return (op && targets.get(op)) || null;
}

export function forgetAssessTargets(): void {
  targets.clear();
}
