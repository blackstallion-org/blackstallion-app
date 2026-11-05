/** Mapping of expo-audio status updates into the playback reducer's events (no device; expo-audio is mocked). */
import type { PlaybackEvent } from '../domain/playback';

type Status = { isLoaded: boolean; duration: number; currentTime: number; playing: boolean; didJustFinish: boolean; isBuffering: boolean };
const mockPlayer = {
  listener: null as null | ((s: Status) => void),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  remove: jest.fn(),
  addListener: jest.fn((_e: string, l: (s: Status) => void) => {
    mockPlayer.listener = l;
    return { remove: jest.fn() };
  }),
};
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

// eslint-disable-next-line import/first -- the mock must be registered before the adapter loads expo-audio
import { createExpoSparkAudio } from '../audio/expoAudioAdapter';

const content = { id: 's', title: 't', subtitle: '', dateLabel: '', durationMs: 30000, audio: { uri: 'https://example.invalid/a.m4a' }, peaks: null };
const status = (over: Partial<Status>): Status => ({ isLoaded: true, duration: 30, currentTime: 0, playing: false, didJustFinish: false, isBuffering: false, ...over });

test('loaded → LOADED; ticks while playing → PROGRESS; finish → ENDED', () => {
  const port = createExpoSparkAudio(content);
  const events: PlaybackEvent[] = [];
  port.subscribe((e) => events.push(e));
  port.load();
  mockPlayer.listener?.(status({}));
  port.play();
  mockPlayer.listener?.(status({ playing: true, currentTime: 0.25 }));
  mockPlayer.listener?.(status({ playing: true, currentTime: 0.5 }));
  mockPlayer.listener?.(status({ didJustFinish: true, currentTime: 30 }));
  expect(events).toEqual([
    { type: 'LOAD' },
    { type: 'LOADED', durationMs: 30000 },
    { type: 'PROGRESS', positionMs: 250 },
    { type: 'PROGRESS', positionMs: 500 },
    { type: 'ENDED' },
  ]);
  port.release();
});

test('a stop we did not ask for is an interruption; playing again ends it; our own pause is not', () => {
  const port = createExpoSparkAudio(content);
  const events: PlaybackEvent[] = [];
  port.subscribe((e) => events.push(e));
  port.load();
  mockPlayer.listener?.(status({}));
  port.play();
  mockPlayer.listener?.(status({ playing: true, currentTime: 1 }));
  mockPlayer.listener?.(status({ playing: false, currentTime: 1 })); // phone call
  mockPlayer.listener?.(status({ playing: true, currentTime: 1.25 })); // system resumed
  port.pause();
  mockPlayer.listener?.(status({ playing: false, currentTime: 1.25 }));
  expect(events.filter((e) => e.type.startsWith('INTERRUPT'))).toEqual([
    { type: 'INTERRUPT_BEGIN', reason: 'focus-loss' },
    { type: 'INTERRUPT_END', systemSaysResume: true },
  ]);
  port.release();
});

test('no audio URL → an honest error, no player created', () => {
  const port = createExpoSparkAudio({ ...content, audio: null });
  const events: PlaybackEvent[] = [];
  port.subscribe((e) => events.push(e));
  port.load();
  expect(events).toEqual([{ type: 'ERROR', message: 'This Spark has no audio yet.' }]);
});
