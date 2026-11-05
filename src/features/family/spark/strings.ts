/**
 * FA-06 Daily Spark copy (EN). Kept here as constants until the shared string
 * catalogue step moves them (with reviewed HI/TE) into design/i18n.
 */
export const SPARK_COPY = {
  screenLabel: 'Daily Spark',
  category: 'Daily Spark',
  close: 'Close',
  back10: 'Back 10 seconds',
  forward10: 'Forward 10 seconds',
  progressLabel: 'Playback position',
  waveformLabel: 'Loudness of this audio over time',
  loading: 'Loading today’s Spark',
  emptyTitle: 'No Spark today',
  emptyMessage: 'Today’s Spark hasn’t been released yet. It appears here once the academy publishes it.',
  unavailableTitle: 'Daily Spark isn’t available',
  unavailableMessage: 'Daily Spark isn’t switched on in this build. Nothing is played or recorded here.',
  noAudio: 'This Spark has no audio yet.',
  syntheticPill: 'Synthetic preview',
  simulated: 'Simulated player: no sound plays in this preview.',
  notCounted: 'Listening isn’t recorded yet: the academy is still confirming Daily Spark rules.',
  streaksOff: 'Streaks are off while the academy confirms Daily Spark rules.',
  howCounted: (name: string) => `Listening to the end without skipping is recorded for ${name}.`,
  simulatedNotRecorded: 'Simulated player: no sound plays, so this listen isn’t recorded.',
  recorded: (name: string, time: string) => (time ? `Recorded for ${name} today at ${time}.` : `Recorded for ${name} today.`),
  recording: (name: string) => `Recording that ${name} listened…`,
  recordFailed: 'We couldn’t record this listen. Try again — repeating is safe and counts once.',
  notToday: 'This Spark is from another day, so it wasn’t recorded.',
  recordRefused: 'The academy didn’t record this listen.',
  recordAgain: 'Try recording again',
  streak: (n: number) => (n === 1 ? 'Streak: 1 day' : `Streak: ${n} days`),
  noChildTitle: 'No linked child yet',
  noChild: 'Daily Spark is shared per child. It appears once the academy links your child to this account.',
  minutes: (ms: number) => {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}-second listen` : `${Math.round(s / 60)}-minute listen`;
  },
} as const;
