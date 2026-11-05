import type { PlaybackEvent } from './domain/playback';
import type { SparkPolicy } from './domain/policy';

/** Today's Spark as the server (or a labelled fixture) describes it. */
export type SparkContent = {
  id: string;
  title: string;
  subtitle: string;
  /** Hub-local date label, e.g. "Tue 10 Nov". */
  dateLabel: string;
  durationMs: number;
  /** Playable audio. null = no audio available (screen says so). */
  audio: { uri: string } | null;
  /**
   * Amplitude peaks precomputed from THIS audio file (server). null = no
   * measured data: the waveform is hidden, never invented.
   */
  peaks: readonly number[] | null;
};

export type SparkToday = {
  source: 'synthetic-preview' | 'server';
  spark: SparkContent | null;
  /** Policy from the server; while status is PROPOSED (D18) completion/streaks are not recorded. */
  policy: SparkPolicy;
  /** G9 (per child): the child this Spark was fetched for. Absent in the pre-G9 source. */
  cadetId?: string;
  /** G9: the server's acknowledgement for today (hub-local day, server clock). */
  acknowledgement?: { acknowledged: boolean; at: string | null };
  /** G9: streak numbers are null while the `spark_streaks` flag is off (D18 PROPOSED). */
  streak?: { enabled: boolean; current: number | null; longest: number | null };
};

/** `cadetId` is required by the G9 source (Spark is per child, C01); the pre-G9 source ignores it. */
export type SparkScope = { subjectId: string; experience: 'family'; cadetId?: string; children?: readonly { cadetId: string; firstName: string; hubId: string | null }[] };

export type SparkAckRequest = { cadetId: string; sparkId: string; operationId: string };
export type SparkAck = { acknowledgedAt: string; already: boolean; duplicate: boolean };

export interface SparkRepository {
  getToday(scope: SparkScope): Promise<SparkToday>;
  /**
   * G9 `app_ack_spark`: records that today's Spark was heard (the CLIENT decides "heard": continuous coverage, never
   * seeks). Absent in sources that cannot record; the screen then says listening isn't recorded.
   */
  acknowledge?(scope: SparkScope, req: SparkAckRequest): Promise<SparkAck>;
}

/**
 * Audio boundary. The device implementation wraps expo-audio
 * (audio/expoAudioAdapter.ts); development builds may use a SIMULATED adapter
 * that plays no sound — the screen must say so and never claim listening.
 */
export interface SparkAudioPort {
  readonly kind: 'device' | 'simulated';
  load(): void;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): void;
  release(): void;
  /** Player events, already translated into the domain's PlaybackEvent vocabulary. */
  subscribe(listener: (event: PlaybackEvent) => void): () => void;
}

export type SparkAudioFactory = (content: SparkContent) => SparkAudioPort;

/** Present only in builds where Daily Spark is wired; absent → the entry point is hidden and the route says "unavailable". */
export type SparkFeature = { repository: SparkRepository; createAudio: SparkAudioFactory };
