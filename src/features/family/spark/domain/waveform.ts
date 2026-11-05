// Ported from g6-prework/src/spark (4 Nov 2026) unchanged in behaviour; pure TypeScript (lint-enforced).
// The Spark "waveform" may only show real data. Bars come from amplitude samples the server
// pre-computes for the approved audio file (or from decoded PCM). Without samples: no waveform.
// A decorative pulse is allowed, but it must be labelled decorative and hidden from screen readers.

export type Waveform = { kind: 'measured'; bars: number[]; source: string } | { kind: 'unavailable' };

/** Bucket absolute amplitudes into `barCount` RMS bars normalised to 0–1. */
export function waveformFromSamples(samples: ArrayLike<number> | null | undefined, barCount = 32, source = 'server-peaks'): Waveform {
  if (!samples || samples.length < barCount) return { kind: 'unavailable' };
  const bars: number[] = [];
  const size = samples.length / barCount;
  for (let b = 0; b < barCount; b++) {
    const from = Math.floor(b * size);
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    let sum = 0;
    for (let i = from; i < to; i++) {
      const v = Number(samples[i]);
      sum += v * v;
    }
    bars.push(Math.sqrt(sum / (to - from)));
  }
  const peak = Math.max(...bars);
  if (!(peak > 0)) return { kind: 'unavailable' }; // silence or invalid data: show nothing rather than fake
  return { kind: 'measured', bars: bars.map((x) => Math.round((x / peak) * 1000) / 1000), source };
}

export interface WaveformPresentation {
  show: boolean;
  animate: boolean;
  /** null = hidden from screen readers. */
  accessibilityLabel: string | null;
  caption: string | null;
}

export function presentWaveform(w: Waveform, reducedMotion: boolean): WaveformPresentation {
  if (w.kind === 'unavailable') return { show: false, animate: false, accessibilityLabel: null, caption: null };
  return { show: true, animate: !reducedMotion, accessibilityLabel: 'Loudness of this audio over time', caption: null };
}

/** Optional pulsing ring while audio plays when no measured waveform exists. Honest labelling. */
export function presentDecorativePulse(playing: boolean, reducedMotion: boolean): WaveformPresentation {
  return { show: playing, animate: playing && !reducedMotion, accessibilityLabel: null, caption: 'Decorative animation, not the audio signal' };
}
