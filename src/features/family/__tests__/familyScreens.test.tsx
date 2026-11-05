/**
 * FA-01..FA-13 on the real route tree (src/app) with the development adapter and synthetic fixtures at zero latency.
 * JS-level (jest-expo): no device media, no native player. Covers the critical client behaviours: another family's
 * child/record is never shown, RSVP retries reuse one operation id, missing consent hides private video, and an
 * unavailable stall camera never says LIVE.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import path from 'path';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import type { PersonaId } from '@/dev/personas';

import { createFamilyAppFixtures } from '@/dev/fixtures/familyApp';

import { FamilyCommandError } from '../data/repositories';

jest.mock('@/dev/preview', () => {
  const actual = jest.requireActual('@/dev/preview');
  const { createDevAccessAdapter } = jest.requireActual('@/dev/devAccessAdapter');
  const { createFixtureRepositories } = jest.requireActual('@/dev/fixtures');
  return { ...actual, devAccessAdapter: createDevAccessAdapter({ latencyMs: 0 }), devRepositories: createFixtureRepositories({ latencyMs: 0 }) };
});
const dev = jest.requireMock('@/dev/preview') as typeof import('@/dev/preview');
const APP_DIR = path.resolve(__dirname, '../../../app');
const textOf = () => JSON.stringify(screen.toJSON());

beforeEach(async () => {
  await dev.devAccessAdapter.signOut();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  // Fresh synthetic family data per test (RSVP seats and consent records are mutable in the fixture).
  dev.devRepositories.familyApp = createFamilyAppFixtures({ latencyMs: 0 });
});

async function signIn(persona: PersonaId = 'guardian') {
  const r = await renderRouter(APP_DIR, { initialUrl: '/' });
  await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
  await act(async () => dev.devAccessAdapter.selectPersona(persona));
  await waitFor(() => expect(r.getPathname()).toBe('/family'));
  return r;
}
async function go(r: Awaited<ReturnType<typeof signIn>>, href: string, pathname = href.split('?')[0]) {
  await act(async () => router.push(href as never));
  await waitFor(() => expect(r.getPathname()).toBe(pathname));
}

describe('FA-02 Progress, FA-04 clips, FA-03 detail', () => {
  test('trends, history and rank card from published sessions; older pages; a row opens the session', async () => {
    const r = await signIn();
    await fireEvent.press(screen.getByTestId('tab-progress'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/progress'));
    expect(await screen.findByTestId('trend-card')).toBeTruthy();
    expect(screen.getByTestId('preview-banner')).toBeTruthy();
    expect(screen.getByTestId('rank-card')).toHaveTextContent(/Cadet Rider/);
    expect(screen.getByLabelText(/^Riding: .* out of 10 over the last 8 sessions; latest 8$/)).toBeTruthy();
    expect(within(screen.getByTestId('session-history')).getAllByRole('button')).toHaveLength(8);
    await fireEvent.press(screen.getByTestId('load-older'));
    await waitFor(() => expect(within(screen.getByTestId('session-history')).getAllByRole('button')).toHaveLength(10));
    expect(screen.queryByTestId('load-older')).toBeNull();

    await fireEvent.press(screen.getByTestId('session-row-syn-ts-a1-10'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/sessions/syn-ts-a1-10'));
    expect(await screen.findByTestId('correction-notice')).toHaveTextContent(/Updated on Sun 8 Nov 2026\. Reason given: Riding score re-entered/);
    expect(screen.getByLabelText('Riding 8 out of 10')).toBeTruthy();
    expect(screen.getByTestId('session-skills')).toHaveTextContent(/Rising trot \(sample\)/);
    // Consent is allowed for Aarav, but the preview has no video files: said plainly, never a stand-in clip.
    expect(await screen.findByTestId('private-clip-media-off')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/progress'));
  });

  test('switching child never shows the sibling’s data', async () => {
    const r = await signIn();
    await go(r, '/family/progress');
    await screen.findByTestId('trend-card');
    await fireEvent.press(screen.getByTestId('child-switcher-syn-cadet-a2'));
    expect(await screen.findByTestId('progress-empty')).toBeTruthy();
    expect(textOf()).not.toMatch(/Rising trot|syn-ts-a1/);
    // The selection is shared: Home now shows Meera too.
    await fireEvent.press(screen.getByTestId('tab-index'));
    await waitFor(() => expect(r.getPathname()).toBe('/family'));
    expect(await screen.findByTestId('assessment-empty')).toBeTruthy();
  });

  test('Hall of Valour lists private clips and pairs the first and latest for comparison', async () => {
    const r = await signIn();
    await go(r, '/family/progress?view=clips', '/family/progress');
    expect(await screen.findByTestId('clip-grid')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Private clip, /)).toHaveLength(4);
    await fireEvent.press(screen.getByTestId('open-compare'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/compare'));
    expect(await screen.findByTestId('compare-earlier')).toHaveTextContent(/Earlier.*Sat 5 Sep 2026/);
    expect(screen.getByTestId('compare-recent')).toHaveTextContent(/Recent.*Sat 7 Nov 2026/);
    expect(screen.getByTestId('compare-no-claims')).toHaveTextContent(/not an assessment/);
    expect(textOf()).not.toMatch(/posture|score.*improv|spinal/i);
  });

  test('clip comparison is unavailable with fewer than two clips', async () => {
    const r = await signIn();
    await go(r, '/family/progress');
    await fireEvent.press(await screen.findByTestId('child-switcher-syn-cadet-a2'));
    await go(r, '/family/compare');
    expect(await screen.findByTestId('compare-needs-two')).toHaveTextContent(/Meera \(sample\) has none yet/);
  });

  test('missing consent blocks private video (withdrawn session_video) and points to the consent centre', async () => {
    const r = await signIn('dualRole');
    await go(r, '/family/sessions/syn-ts-d1-02');
    expect(await screen.findByTestId('private-clip-consent-missing')).toHaveTextContent(/hidden because session video consent isn’t allowed/);
    expect(screen.queryByTestId('private-clip-play')).toBeNull();
    expect(screen.queryByTestId('session-compare')).toBeNull();
    await fireEvent.press(screen.getByTestId('private-clip-review-consent'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/consents'));
    expect(await screen.findByTestId('consent-state-session_video')).toHaveTextContent('Withdrawn', { exact: false });
  });

  test('a deep link to another family’s session, or a malformed id, shows the neutral not-available state', async () => {
    const r = await signIn('guardian');
    await go(r, '/family/sessions/syn-ts-d1-01'); // belongs to the dual-role persona's child
    expect(await screen.findByTestId('session-not-found')).toBeTruthy();
    expect(textOf()).not.toMatch(/Isha|syn-cadet-d1|syn-ts-d1/);
    await go(r, '/family/sessions/x%20y', '/family/sessions/x y');
    expect(await screen.findByTestId('session-not-found')).toBeTruthy();
  });
});

describe('FA-09/FA-10/FA-11 events and RSVP', () => {
  test('feed with real dates → detail → reserve (server-confirmed) → cancel through the dialog', async () => {
    const r = await signIn();
    await fireEvent.press(screen.getByTestId('tab-community'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/community'));
    const card = await screen.findByTestId('event-card-syn-ev-open-day');
    expect(card.props.accessibilityLabel).toMatch(/Open day at the arena \(sample\), \w{3} \d{1,2} \w{3} 2026 · 10:00–13:00/);
    expect(screen.getByTestId('event-card-syn-ev-trail')).toHaveTextContent(/Cancelled/);
    await fireEvent.press(card);
    await waitFor(() => expect(r.getPathname()).toBe('/family/events/syn-ev-open-day'));
    expect(await screen.findByTestId('attendance-status-syn-cadet-a1')).toHaveTextContent('Going', { exact: false });
    expect(screen.getByTestId('attendance-status-syn-cadet-a2')).toHaveTextContent('Not going', { exact: false });
    expect(screen.getByTestId('event-places')).toHaveTextContent('13 of 40 left', { exact: false });

    await fireEvent.press(screen.getByTestId('rsvp-syn-cadet-a2'));
    expect(await screen.findByTestId('rsvp-feedback')).toHaveTextContent('Meera (sample) has a place. Confirmed by the academy.', { exact: false });
    await waitFor(() => expect(screen.getByTestId('attendance-status-syn-cadet-a2')).toHaveTextContent('Going', { exact: false }));
    expect(screen.getByTestId('event-places')).toHaveTextContent('12 of 40 left', { exact: false });

    await fireEvent.press(screen.getByTestId('cancel-syn-cadet-a2'));
    expect(await screen.findByTestId('cancel-rsvp-dialog')).toHaveTextContent(/Cancel Meera \(sample\)’s place\?.*no waitlist/);
    await fireEvent.press(screen.getByTestId('cancel-rsvp-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('rsvp-feedback')).toHaveTextContent('Meera (sample)’s place was cancelled and released.', { exact: false }));
    await waitFor(() => expect(screen.getByTestId('attendance-status-syn-cadet-a2')).toHaveTextContent('Not going', { exact: false }));
  });

  test('an RSVP retry after a lost response resends the SAME operation id (no duplicate seat)', async () => {
    const repo = dev.devRepositories.familyApp!.events;
    const real = repo.rsvp.bind(repo);
    const spy = jest.spyOn(repo, 'rsvp').mockImplementationOnce(async () => {
      throw new FamilyCommandError('network', 'TypeError: Network request failed');
    });
    spy.mockImplementation(real);
    const r = await signIn();
    await go(r, '/family/events/syn-ev-open-day');
    await fireEvent.press(await screen.findByTestId('rsvp-syn-cadet-a2'));
    expect(await screen.findByTestId('rsvp-feedback')).toHaveTextContent(/nothing changed yet.*won’t book twice/);
    expect(screen.getByTestId('attendance-status-syn-cadet-a2')).toHaveTextContent('Not going', { exact: false }); // no optimistic seat
    await fireEvent.press(screen.getByTestId('rsvp-retry'));
    await waitFor(() => expect(screen.getByTestId('attendance-status-syn-cadet-a2')).toHaveTextContent('Going', { exact: false }));
    expect(spy).toHaveBeenCalledTimes(2);
    const [first, second] = spy.mock.calls.map((c) => c[1]);
    expect(second?.operationId).toBe(first?.operationId);
    expect(second).toEqual(first);
  });

  test('a full event offers no reservation and no waitlist', async () => {
    const r = await signIn();
    await go(r, '/family/events/syn-ev-care-workshop');
    expect(await screen.findByTestId('attendance-note-syn-cadet-a1')).toHaveTextContent('Full · no waitlist', { exact: false });
    expect(screen.queryByTestId('rsvp-syn-cadet-a1')).toBeNull();
  });

  test('another hub’s event id is not available', async () => {
    const r = await signIn();
    await go(r, '/family/events/syn-ev-pony-club');
    expect(await screen.findByTestId('event-not-found')).toBeTruthy();
    expect(textOf()).not.toMatch(/Pony club/);
  });
});

describe('FA-07 Horse and FA-08 stall camera', () => {
  test('assigned horse with a labelled illustration, honest care state, and a stall camera that is never LIVE', async () => {
    const r = await signIn();
    await fireEvent.press(screen.getByTestId('tab-horse'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/horse'));
    expect(await screen.findByTestId('horse-name')).toHaveTextContent('Badal (sample)', { exact: false });
    expect(screen.getByTestId('horse-illustration-label')).toHaveTextContent('Illustration, not a photo of this horse', { exact: false });
    expect(screen.getByTestId('horse-care-unavailable')).toBeTruthy();
    expect(textOf()).not.toMatch(/microchip|rtsp/i);
    await fireEvent.press(screen.getByTestId('open-stall-cam'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/horse/stall-cam'));
    expect(await screen.findByTestId('stall-unavailable-feature_disabled')).toBeTruthy();
    expect(screen.getByTestId('stall-no-live')).toHaveTextContent('No live view', { exact: false });
    expect(screen.queryByTestId('stall-live')).toBeNull();
    expect(screen.queryByText('LIVE')).toBeNull();
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/horse'));
  });

  test('a child with no horse: empty horse state and no stream', async () => {
    const r = await signIn();
    await go(r, '/family/horse');
    await fireEvent.press(await screen.findByTestId('child-switcher-syn-cadet-a2'));
    expect(await screen.findByTestId('horse-empty')).toBeTruthy();
    await go(r, '/family/horse/stall-cam');
    expect(await screen.findByTestId('stall-unavailable-no_horse')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });
});

describe('FA-12 consent centre and FA-05 passport', () => {
  test('withdraw → confirmed by the server → state, history and the clip gate all follow', async () => {
    const r = await signIn();
    await fireEvent.press(await screen.findByTestId('home-open-consents'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/consents'));
    expect(await screen.findByTestId('consent-draft-note')).toHaveTextContent(/draft wording \(version draft-1\)/);
    expect(screen.getByTestId('consent-state-session_video')).toHaveTextContent('Allowed', { exact: false });
    await fireEvent.press(screen.getByTestId('consent-action-session_video'));
    await fireEvent.press(await screen.findByTestId('consent-withdraw-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('consent-feedback')).toHaveTextContent('Saved: Session video withdrawn. Confirmed by the academy.', { exact: false }));
    await waitFor(() => expect(screen.getByTestId('consent-state-session_video')).toHaveTextContent('Withdrawn', { exact: false }));
    await waitFor(() => expect(screen.getByTestId('consent-history')).toHaveTextContent(/Session video: withdrawn/));

    await go(r, '/family/sessions/syn-ts-a1-10');
    expect(await screen.findByTestId('private-clip-consent-missing')).toBeTruthy();

    await go(r, '/family/consents');
    await fireEvent.press(await screen.findByTestId('consent-action-session_video'));
    expect(await screen.findByTestId('consent-allow-sheet')).toHaveTextContent(/Allow session video for Aarav \(sample\)\?.*Wording version draft-1/);
    await fireEvent.press(screen.getByTestId('consent-allow-confirm'));
    await waitFor(() => expect(screen.getByTestId('consent-state-session_video')).toHaveTextContent('Allowed', { exact: false }));
  });

  test('passport: server rank, timeline from rank history, skills linking to their evidence, no invented promotion', async () => {
    const r = await signIn();
    await go(r, '/family/passport');
    expect(await screen.findByTestId('passport-rank')).toHaveTextContent(/Cadet Rider/);
    expect(screen.getByTestId('passport-credential')).toHaveTextContent(/BSAH-26-SAMPLE01/);
    expect(screen.getByTestId('rank-rule-note')).toHaveTextContent(/no automatic promotion/);
    expect(screen.getByTestId('rank-timeline')).toHaveTextContent(/Cadet Rider.*Current/);
    expect(textOf()).not.toMatch(/next rank|progress to|threshold/i);
    expect(screen.getByTestId('passport-verify-note')).toBeTruthy(); // no website URL configured in this build
    await fireEvent.press(screen.getByText('Mounting (sample)'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/sessions/syn-ts-a1-01'));
  });
});

describe('FA-01 Home next actions, deep links and states', () => {
  test('latest assessment links onwards; the next event has a real date; links to passport and consent', async () => {
    const r = await signIn();
    expect(await screen.findByTestId('home-next-event')).toHaveTextContent(/Open day at the arena \(sample\).*10:00–13:00.*Aarav \(sample\) going/);
    expect(textOf()).not.toMatch(/Riding A|horse Badal|9:30/); // the fixture's invented schedule is never shown
    await fireEvent.press(screen.getByTestId('view-latest-session'));
    await waitFor(() => expect(r.getPathname()).toBe('/family/progress'));
  });

  test('?cadet= selects a linked child only', async () => {
    const r = await signIn();
    await go(r, '/family?cadet=syn-cadet-a2', '/family');
    expect(await screen.findByTestId('assessment-empty')).toBeTruthy();
    await go(r, '/family?cadet=syn-cadet-d1', '/family');
    expect(textOf()).not.toMatch(/Isha/);
  });

  test('no linked child, failure and offline states', async () => {
    let r = await signIn('guardianNoChild');
    await go(r, '/family/progress');
    expect(await screen.findByTestId('progress-no-child')).toBeTruthy();
    await go(r, '/family/community');
    expect(await screen.findByTestId('community-no-child')).toBeTruthy();
    await act(async () => dev.devAccessAdapter.signOut());

    r = await signIn('familyDataError');
    await go(r, '/family/progress');
    expect(await screen.findByTestId('progress-error')).toHaveTextContent(/Retry/);
    await go(r, '/family/community');
    expect(await screen.findByTestId('community-offline')).toHaveTextContent(/No connection/);
  });
});
