/**
 * Media boundaries with stand-in players (JS-level; no device media): private clip URL lifecycle (fetched on Play,
 * refetched once when expired), the stall-camera player (LIVE only while a live grant delivers fresh frames), and the
 * Spark acknowledgement (sent once, only for a DEVICE listen with enough continuous coverage, retried with the same id).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import path from 'path';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { createFamilyAppFixtures } from '@/dev/fixtures/familyApp';

import { FamilyCommandError } from '../data/repositories';
import type { StreamGrant } from '../domain/stallcam';
import type { PlaybackEvent } from '../spark/domain/playback';
import type { SparkAudioFactory } from '../spark/types';

type Listener = (payload: Record<string, unknown>) => void;
const mockPlayers: { uri: string; listeners: Map<string, Set<Listener>>; emit: (event: string, payload: Record<string, unknown>) => void }[] = [];

jest.mock('expo-video', () => {
  const React = jest.requireActual('react');
  return {
    useVideoPlayer: (source: { uri: string }, setup?: (p: unknown) => void) => {
      const [p] = React.useState(() => {
        const listeners = new Map<string, Set<Listener>>();
        const player = {
          uri: source.uri,
          listeners,
          loop: false,
          muted: false,
          timeUpdateEventInterval: 0,
          play: jest.fn(),
          addListener: (event: string, cb: Listener) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(cb);
            return { remove: () => listeners.get(event)?.delete(cb) };
          },
          emit: (event: string, payload: Record<string, unknown>) => listeners.get(event)?.forEach((cb) => cb(payload)),
        };
        mockPlayers.push(player);
        setup?.(player);
        return player;
      });
      return p;
    },
    VideoView: () => null,
  };
});

// The clip boundary is replaced by a stub that can report a player error (expired URL) on demand.
jest.mock('../components/ClipVideo', () => {
  const RN = jest.requireActual('react-native');
  return {
    ClipVideo: ({ uri, onError }: { uri: string; onError: () => void }) => (
      <RN.Pressable accessibilityRole="button" testID="clip-video" onPress={onError}>
        <RN.Text>{uri}</RN.Text>
      </RN.Pressable>
    ),
  };
});

jest.mock('@/dev/preview', () => {
  const actual = jest.requireActual('@/dev/preview');
  const { createDevAccessAdapter } = jest.requireActual('@/dev/devAccessAdapter');
  const { createFixtureRepositories } = jest.requireActual('@/dev/fixtures');
  return { ...actual, devAccessAdapter: createDevAccessAdapter({ latencyMs: 0 }), devRepositories: createFixtureRepositories({ latencyMs: 0 }) };
});
const dev = jest.requireMock('@/dev/preview') as typeof import('@/dev/preview');
const APP_DIR = path.resolve(__dirname, '../../../app');

beforeEach(async () => {
  await dev.devAccessAdapter.signOut();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  mockPlayers.length = 0;
  dev.devRepositories.familyApp = createFamilyAppFixtures({ latencyMs: 0 });
});

async function signInAt(href: string) {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await act(async () => dev.devAccessAdapter.selectPersona('guardian'));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  await act(async () => router.push(href as never));
  await waitFor(() => expect(r.getPathname()).toBe(href.split('?')[0]));
  return r;
}

describe('FA-03 private clip URL lifecycle', () => {
  test('the URL is requested only on Play, and an expired URL is refetched exactly once', async () => {
    const fa = dev.devRepositories.familyApp!;
    Object.defineProperty(fa.media, 'available', { value: true });
    let n = 0;
    const clipUrl = jest.spyOn(fa.media, 'clipUrl').mockImplementation(async () => ({ uri: `https://storage.example/clip-${++n}`, expiresAt: Date.now() - 1 }));
    await signInAt('/family/sessions/syn-ts-a1-10');
    await screen.findByTestId('private-clip-poster');
    expect(clipUrl).not.toHaveBeenCalled(); // nothing is fetched until the guardian asks
    await fireEvent.press(screen.getByTestId('private-clip-play'));
    expect(await screen.findByText('https://storage.example/clip-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('clip-video')); // player reports an error; the URL has expired
    expect(await screen.findByText('https://storage.example/clip-2')).toBeTruthy();
    expect(clipUrl).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByTestId('clip-video')); // a second failure is reported, not retried forever
    expect(await screen.findByTestId('private-clip-failed')).toBeTruthy();
    expect(clipUrl).toHaveBeenCalledTimes(2);
  });

  test('the repository’s own consent refusal also hides the clip (defence in depth)', async () => {
    const fa = dev.devRepositories.familyApp!;
    Object.defineProperty(fa.media, 'available', { value: true });
    const { ScopedLoadError } = jest.requireActual('@/core/data/useScopedResource');
    jest.spyOn(fa.media, 'clipUrl').mockRejectedValue(new ScopedLoadError('Session video consent is off for this child.', 'CONSENT-session_video', true));
    await signInAt('/family/sessions/syn-ts-a1-10');
    await fireEvent.press(await screen.findByTestId('private-clip-play'));
    expect(await screen.findByTestId('private-clip-consent-missing')).toBeTruthy();
    expect(screen.queryByTestId('clip-video')).toBeNull();
  });
});

describe('FA-08 stall player: LIVE only for fresh frames of a live grant', () => {
  const grant = (o: Partial<StreamGrant> = {}): StreamGrant => ({
    kind: 'live',
    playbackUrl: 'https://gw.example/hls/h1/index.m3u8?t=abc',
    fallbackUrl: null,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...o,
  });

  test('available capability + grant: connecting first, LIVE after an advancing frame', async () => {
    const fa = dev.devRepositories.familyApp!;
    jest.spyOn(fa.stream, 'capability').mockResolvedValue({ status: 'available', horseAssigned: true });
    fa.stream.requestGrant = jest.fn(async () => grant());
    await signInAt('/family/horse/stall-cam');
    expect(await screen.findByTestId('stall-player')).toBeTruthy();
    await waitFor(() => expect(mockPlayers).toHaveLength(1));
    expect(mockPlayers[0]?.uri).toBe('https://gw.example/hls/h1/index.m3u8?t=abc');
    expect(screen.queryByTestId('stall-live')).toBeNull(); // granted is not live until frames arrive
    await act(async () => mockPlayers[0]!.emit('timeUpdate', { currentTime: 1 }));
    expect(await screen.findByTestId('stall-live')).toBeTruthy();
  });

  test('a recording is labelled "Recorded", never LIVE', async () => {
    const fa = dev.devRepositories.familyApp!;
    jest.spyOn(fa.stream, 'capability').mockResolvedValue({ status: 'available', horseAssigned: true });
    fa.stream.requestGrant = jest.fn(async () => grant({ kind: 'recording', recordedAt: '2026-11-05T04:10:00Z' }));
    await signInAt('/family/horse/stall-cam');
    await waitFor(() => expect(mockPlayers).toHaveLength(1));
    await act(async () => mockPlayers[0]!.emit('timeUpdate', { currentTime: 1 }));
    expect(await screen.findByTestId('stall-badge')).toHaveTextContent('Recorded', { exact: false });
    expect(screen.queryByTestId('stall-live')).toBeNull();
  });

  test('a grant that would put a camera source or credentials on the phone is refused', async () => {
    const fa = dev.devRepositories.familyApp!;
    jest.spyOn(fa.stream, 'capability').mockResolvedValue({ status: 'available', horseAssigned: true });
    fa.stream.requestGrant = jest.fn(async () => grant({ playbackUrl: 'rtsp://user:pw@10.0.0.5/stall' }));
    await signInAt('/family/horse/stall-cam');
    expect(await screen.findByTestId('stall-status')).toHaveTextContent(/went wrong/);
    expect(mockPlayers).toHaveLength(0);
    expect(screen.queryByTestId('stall-live')).toBeNull();
  });
});

describe('FA-06 Spark acknowledgement (device player)', () => {
  /** A device-kind port that plays the whole file instantly with continuous progress. */
  const fastDevice = (opts: { seekOnly?: boolean } = {}): SparkAudioFactory => (content) => {
    const ls = new Set<(e: PlaybackEvent) => void>();
    const emit = (e: PlaybackEvent) => ls.forEach((l) => l(e));
    return {
      kind: 'device',
      load: () => {
        emit({ type: 'LOAD' });
        setTimeout(() => emit({ type: 'LOADED', durationMs: content.durationMs }), 0);
      },
      play: () =>
        setTimeout(() => {
          if (!opts.seekOnly) for (let t = 250; t <= content.durationMs; t += 250) emit({ type: 'PROGRESS', positionMs: t });
          emit({ type: 'ENDED' });
        }, 0),
      pause: () => undefined,
      seekTo: () => undefined,
      release: () => undefined,
      subscribe: (l) => {
        ls.add(l);
        return () => ls.delete(l);
      },
    };
  };

  test('a full listen is acknowledged once and "Recorded" appears only after the server answers; a lost answer is retried with the same id', async () => {
    const spark = dev.devRepositories.familyApp!.spark!;
    spark.createAudio = fastDevice();
    const repo = spark.repository;
    const real = repo.acknowledge!.bind(repo);
    const ack = jest.spyOn(repo, 'acknowledge').mockImplementationOnce(async () => {
      throw new FamilyCommandError('network', 'Network request failed');
    });
    ack.mockImplementation(real);
    await signInAt('/family/spark');
    const primary = await screen.findByTestId('spark-primary');
    await waitFor(() => expect(primary.props.accessibilityLabel).toBe('Play'));
    expect(screen.queryByTestId('spark-recorded')).toBeNull();
    await fireEvent.press(screen.getByTestId('spark-primary'));
    expect(await screen.findByTestId('spark-record-failed')).toBeTruthy();
    expect(screen.queryByTestId('spark-recorded')).toBeNull();
    await fireEvent.press(screen.getByTestId('spark-record-retry'));
    expect(await screen.findByTestId('spark-recorded')).toHaveTextContent(/Recorded for Aarav \(sample\) today at \d\d:\d\d/);
    expect(ack).toHaveBeenCalledTimes(2);
    expect(ack.mock.calls[1]?.[1]).toEqual(ack.mock.calls[0]?.[1]); // same child, Spark and operation id
  });

  test('playing to the end by seeking (no continuous coverage) is never acknowledged', async () => {
    const spark = dev.devRepositories.familyApp!.spark!;
    spark.createAudio = fastDevice({ seekOnly: true });
    const ack = jest.spyOn(spark.repository, 'acknowledge');
    await signInAt('/family/spark');
    const primary = await screen.findByTestId('spark-primary');
    await waitFor(() => expect(primary.props.accessibilityLabel).toBe('Play'));
    await fireEvent.press(primary);
    await waitFor(() => expect(screen.getByTestId('spark-primary').props.accessibilityLabel).toBe('Play again'));
    expect(ack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('spark-recorded')).toBeNull();
  });
});
