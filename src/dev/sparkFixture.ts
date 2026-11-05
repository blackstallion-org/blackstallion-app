/**
 * DEVELOPMENT-ONLY Daily Spark fixture. The Spark text is invented sample copy
 * and the "player" is SIMULATED: it plays no sound (kind: 'simulated'), so the
 * screen says so and nothing counts as listened. No peaks are supplied because
 * there is no real audio file to measure — the waveform therefore stays hidden,
 * exactly as it would for a real Spark without server peaks.
 */
import { ScopedLoadError } from '@/core/data/useScopedResource';
import type { PlaybackEvent } from '@/features/family/spark/domain/playback';
import { D18_PROPOSED } from '@/features/family/spark/domain/policy';
import type { SparkAudioFactory, SparkAudioPort, SparkFeature, SparkToday } from '@/features/family/spark/types';

const SPARK: Record<string, SparkToday> = {
  'syn-guardian-a': {
    source: 'synthetic-preview',
    policy: D18_PROPOSED,
    spark: {
      id: 'syn-spark-1110',
      title: 'Soft hands, calm seat',
      subtitle: 'Breathe with the horse before you mount. Sample copy, not academy content.',
      dateLabel: 'Tue 10 Nov',
      durationMs: 30000,
      audio: { uri: 'fixture://spark/syn-spark-1110' },
      peaks: null,
    },
  },
  'syn-dual': { source: 'synthetic-preview', policy: D18_PROPOSED, spark: null },
};

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Silent simulated player: advances position on a timer so the transport can be exercised. */
export const createSimulatedSparkAudio: SparkAudioFactory = (content) => {
  const listeners = new Set<(e: PlaybackEvent) => void>();
  const emit = (e: PlaybackEvent) => listeners.forEach((l) => l(e));
  let position = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const port: SparkAudioPort = {
    kind: 'simulated',
    load() {
      port.release();
      emit({ type: 'LOAD' });
      loadTimer = setTimeout(() => emit({ type: 'LOADED', durationMs: content.durationMs }), 300);
    },
    play() {
      stop();
      if (position >= content.durationMs) position = 0;
      timer = setInterval(() => {
        position = Math.min(content.durationMs, position + 250);
        emit({ type: 'PROGRESS', positionMs: position });
        if (position >= content.durationMs) {
          stop();
          emit({ type: 'ENDED' });
        }
      }, 250);
    },
    pause: stop,
    seekTo(ms) {
      position = Math.max(0, Math.min(content.durationMs, ms));
    },
    release() {
      stop();
      if (loadTimer) clearTimeout(loadTimer);
      loadTimer = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return port;
};

export const createSparkFixture = ({ latencyMs = 450 }: { latencyMs?: number } = {}): SparkFeature => ({
  repository: {
    async getToday(scope) {
      await wait(latencyMs);
      if (scope.experience !== 'family') throw new ScopedLoadError('Denied', 'FIXTURE-SCOPE');
      if (scope.subjectId === 'syn-guardian-err') throw new ScopedLoadError('Simulated failure', 'FIXTURE-500-0002');
      const rec = SPARK[scope.subjectId];
      if (!rec) return { source: 'synthetic-preview', policy: D18_PROPOSED, spark: null };
      return structuredClone(rec);
    },
  },
  createAudio: createSimulatedSparkAudio,
});
