/** Wall-clock countdown. It does not read video time or wait on a frame. */

export function countdownRemainingMs(startedAt: number, now: number, fromSeconds: number): number {
  return fromSeconds * 1000 - (now - startedAt);
}

/** Matches the on-screen number: 10 at the start, 1 through the last fraction of a second. */
export function countdownShownSecond(remainingMs: number): number {
  const remainingSeconds = remainingMs / 1000;
  return Math.max(1, Math.ceil(remainingSeconds - 1e-6));
}

export function countdownDue(remainingMs: number): boolean {
  return remainingMs <= 0;
}
