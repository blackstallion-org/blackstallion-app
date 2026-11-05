// Rendered behaviour of FO-08..FO-20 over the synthetic fixture world (src/dev/fixtures/fieldOps.ts) and small fakes.
// JS-level tests (jest-expo): they check states, wording and the critical rules, not native layout or large-text fit.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { useState, type ReactNode } from 'react';
import { Pressable } from 'react-native';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { createFieldOpsFixtures } from '@/dev/fixtures/fieldOps';
import { FieldCommandError } from '@/features/field/domain/commandErrors';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

import type { FieldOpsRepositories } from '../data/repositories';
import type { FieldOpsScope, ReviewItem } from '../domain/types';
import { createFieldOpsTranslator } from '../i18n/i18n';
import type { LocationPort } from '../permissions/location';
import { CareTaskView } from '../screens/CareTaskScreen';
import { ConflictReviewView } from '../screens/ConflictReviewScreen';
import { HorsesView } from '../screens/HorsesScreen';
import { PostureReviewView } from '../screens/PostureReviewScreen';
import { RankProposalView } from '../screens/RankProposalScreen';
import { ReviewItemView } from '../screens/ReviewItemScreen';
import { ReviewQueueView } from '../screens/ReviewQueueScreen';
import { ShiftView } from '../screens/ShiftScreen';
import { SyncCentreView } from '../screens/SyncCentreScreen';

const t = createFieldOpsTranslator('en');
const NOW = Date.now();
const S = (subjectId: string, role: string, hubId = 'syn-hub-1'): FieldOpsScope => ({ subjectId, experience: 'field', hubId, role });
const GROOM = S('syn-groom', 'GROOM');
const INSTR = S('syn-instructor', 'INSTRUCTOR');
const ADMIN = S('syn-hub-admin', 'SCHOOL_ADMIN');
const DUAL = S('syn-dual', 'INSTRUCTOR', 'syn-hub-2');
const own = (s: FieldOpsScope) => ({ subjectId: s.subjectId, hubId: s.hubId });
const key = (s: FieldOpsScope) => `${s.subjectId}:field:hub=${s.hubId}`;
const fixtures = () => createFieldOpsFixtures({ latencyMs: 0, now: NOW })!;
const wrap = (ui: ReactNode) => <ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>;
const inRouter = (ui: ReactNode) => renderRouter({ index: () => wrap(ui) }, { initialUrl: '/' });
const text = () => JSON.stringify(screen.toJSON());
const loc = (accuracyM: number | null, status: 'granted' | 'denied' = 'granted'): LocationPort => ({
  status: async () => status,
  request: async () => status,
  current: async () => ({ latitude: 17.3851, longitude: 78.4868, accuracyM, at: NOW }),
  openSettings: async () => undefined,
});

// expo-router's renderRouter switches Jest to fake timers; the fixture world and the outbox use real ones.
afterEach(() => {
  jest.useRealTimers();
});

describe('FO-08 Horses', () => {
  test('groom: attention first, shift row, no review entry (grooms are never reviewers)', async () => {
    const repos = fixtures();
    await inRouter(<HorsesView repos={repos} scope={GROOM} contextKey={key(GROOM)} canPunch t={t} onOpenHorse={jest.fn()} onOpenShift={jest.fn()} onOpenReview={jest.fn()} />);
    expect(await screen.findByTestId('fo08-list')).toBeTruthy();
    expect(screen.getByTestId('fo08-open-shift')).toBeTruthy();
    expect(screen.queryByTestId('fo08-open-review')).toBeNull();
    expect(screen.getByTestId('preview-banner')).toBeTruthy();
    expect(text()).toContain('Chetak (sample)');
    expect(text()).not.toContain('Sultan (sample), 1 of'); // another person's duties are not summarised as mine
  });

  test('hub admin: horses without invented care status, plus the review queue entry', async () => {
    const repos = fixtures();
    await inRouter(<HorsesView repos={repos} scope={ADMIN} contextKey={key(ADMIN)} canPunch={false} t={t} onOpenHorse={jest.fn()} onOpenShift={jest.fn()} onOpenReview={jest.fn()} />);
    expect(await screen.findByTestId('fo08-care-note')).toBeTruthy();
    expect(await screen.findByTestId('fo08-open-review')).toBeTruthy();
    expect(screen.queryByTestId('fo08-open-shift')).toBeNull();
    expect(screen.queryByText('On time')).toBeNull();
  });
});

describe('FO-10 Care task', () => {
  test('photo first; weak GPS goes to review; result comes from the server and never says Done', async () => {
    const repos = fixtures();
    repos.outbox.setSession(own(GROOM));
    const takePhoto = jest.fn(async () => ({ mode: 'care_photo' as const, uri: 'fixture-capture://t1', mimeType: 'image/jpeg', capturedAt: new Date(NOW).toISOString() }));
    await render(wrap(<CareTaskView repos={repos} scope={GROOM} owner={own(GROOM)} contextKey={key(GROOM)} taskId="syn-occ-badal-water-1" t={t} location={loc(85)} takePhoto={takePhoto} onBack={jest.fn()} onOpenSync={jest.fn()} />));
    expect(await screen.findByTestId('fo10-summary')).toBeTruthy();
    expect(screen.getByTestId('fo10-notes')).toBeTruthy(); // notes: honest "can't be sent yet"
    expect(await screen.findByText(/Weak signal \(±85 m\)/)).toBeTruthy();
    // one dominant action at a time: Take photo first, then Send
    expect(screen.queryByTestId('fo10-send')).toBeNull();
    await fireEvent.press(screen.getByTestId('fo10-take-photo'));
    await waitFor(() => expect(screen.getByTestId('fo10-send')).toBeEnabled());
    expect(screen.queryByTestId('fo10-take-photo')).toBeNull();
    await fireEvent.press(screen.getByTestId('fo10-send'));
    await waitFor(() => expect(screen.getByTestId('fo10-result')).toHaveTextContent(/Received — a supervisor will review it/), { timeout: 3000 });
    expect(screen.getByTestId('fo10-result')).toHaveTextContent(/recorded it at/);
    expect(text()).not.toMatch(/Completed|\bDone\b|[Vv]erified/);
    const item = repos.outbox.list(own(GROOM)).find((i) => i.aggregateId === 'syn-occ-badal-water-1')!;
    expect(item.payload.location).toMatchObject({ accuracyM: 85 });
  });

  test('a task outside the person’s assigned list is not found (deep links cannot reach it)', async () => {
    const repos = fixtures();
    await render(wrap(<CareTaskView repos={repos} scope={GROOM} owner={own(GROOM)} contextKey={key(GROOM)} taskId="syn-occ-sultan-tackcheck-1" t={t} location={loc(10)} takePhoto={jest.fn()} onBack={jest.fn()} onOpenSync={jest.fn()} />));
    expect(await screen.findByTestId('fo10-notfound')).toBeTruthy();
  });
});

describe('FO-11 Shift', () => {
  test('an open punch-in with weak GPS shows Needs review and why; never "verified"', async () => {
    const repos = fixtures();
    await render(wrap(<ShiftView repos={repos} scope={GROOM} owner={own(GROOM)} contextKey={key(GROOM)} allowed t={t} location={loc(85)} onBack={jest.fn()} onOpenSync={jest.fn()} />));
    expect(await screen.findByTestId('fo11-review-note')).toBeTruthy();
    expect(screen.getByTestId('fo11-outcome')).toHaveTextContent(/Needs review/);
    expect(screen.getByText(/not precise enough/)).toBeTruthy();
    expect(text()).not.toMatch(/[Vv]erified/);
  });

  test('punch-in is queued with its evidence and, once the academy answers, enters review (threshold off)', async () => {
    const repos = fixtures();
    repos.outbox.setSession(own(INSTR));
    await render(wrap(<ShiftView repos={repos} scope={INSTR} owner={own(INSTR)} contextKey={key(INSTR)} allowed t={t} location={loc(12)} onBack={jest.fn()} onOpenSync={jest.fn()} />));
    await fireEvent.press(await screen.findByTestId('fo11-punch-in'));
    await waitFor(() => expect(screen.getByTestId('fo11-outcome')).toHaveTextContent(/Needs review/), { timeout: 3000 });
    expect(repos.outbox.list(own(INSTR)).filter((i) => i.commandType === 'shift.punchIn')).toHaveLength(1);
  });

  test('accounts that may not punch in get a denied state, not a button', async () => {
    await render(wrap(<ShiftView repos={fixtures()} scope={ADMIN} owner={own(ADMIN)} contextKey={key(ADMIN)} allowed={false} t={t} location={loc(12)} onBack={jest.fn()} onOpenSync={jest.fn()} />));
    expect(await screen.findByTestId('fo11-denied')).toBeTruthy();
    expect(screen.queryByTestId('fo11-punch-in')).toBeNull();
  });
});

describe('FO-12 Sync centre isolation', () => {
  test('after a user switch nothing of the previous person is listed, only a count', async () => {
    const repos = fixtures();
    // like the authenticated layout, the tree is keyed by the signed-in subject
    function Switcher() {
      const [s, setS] = useState(GROOM);
      return (
        <>
          <Pressable testID="switch-user" accessibilityRole="button" onPress={() => setS(INSTR)} />
          <SyncCentreView key={s.subjectId} repos={repos} scope={s} owner={own(s)} contextKey={key(s)} t={t} onOpenTask={jest.fn()} onOpenShift={jest.fn()} onOpenConflict={jest.fn()} onSignIn={jest.fn()} />
        </>
      );
    }
    await inRouter(<Switcher />);
    expect(await screen.findByTestId('sync-row-syn-op-groom-badal-groom')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('switch-user'));
    expect(await screen.findByTestId('sync-other-account')).toBeTruthy();
    expect(screen.queryByTestId('sync-row-syn-op-groom-badal-groom')).toBeNull();
    expect(text()).not.toMatch(/Badal|Chetak|Toofan/);
  });
});

describe('FO-15 Conflict review', () => {
  test('explains the conflict, keeps the academy record, and discards only after confirmation', async () => {
    const repos = fixtures();
    repos.outbox.setSession(own(GROOM));
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    const onDone = jest.fn();
    await render(wrap(<ConflictReviewView repos={repos} scope={GROOM} owner={own(GROOM)} contextKey={key(GROOM)} itemId="syn-op-groom-badal-groom" t={t} onBack={jest.fn()} onDone={onDone} onOpenShift={jest.fn()} />));
    expect(await screen.findByTestId('fo15-explanation')).toHaveTextContent(/refused it to avoid overwriting/);
    expect(screen.getAllByText('Kept as is').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('fo15-keep_server'));
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId('fo15-discard-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(repos.outbox.get(own(GROOM), 'syn-op-groom-badal-groom')).toBeNull();
  });

  test('another account’s item cannot be opened', async () => {
    const repos = fixtures();
    await render(wrap(<ConflictReviewView repos={repos} scope={INSTR} owner={own(INSTR)} contextKey={key(INSTR)} itemId="syn-op-groom-badal-groom" t={t} onBack={jest.fn()} onDone={jest.fn()} onOpenShift={jest.fn()} />));
    expect(await screen.findByTestId('fo15-gone')).toBeTruthy();
  });
});

describe('FO-17/18 Review', () => {
  test('non-reviewers are denied; reviewers see segments', async () => {
    await inRouter(<ReviewQueueView repos={fixtures()} scope={GROOM} contextKey={key(GROOM)} t={t} onBack={jest.fn()} onOpenItem={jest.fn()} />);
    expect(await screen.findByTestId('fo17-denied')).toBeTruthy();
  });

  test('reviewer: care and shift segments with reasons', async () => {
    const onOpen = jest.fn();
    await inRouter(<ReviewQueueView repos={fixtures()} scope={ADMIN} contextKey={key(ADMIN)} t={t} onBack={jest.fn()} onOpenItem={onOpen} />);
    expect(await screen.findByTestId('fo17-list-care_evidence')).toBeTruthy();
    expect(screen.getByText('Weak location')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fo17-segments-shift_attendance'));
    expect(await screen.findByTestId('fo17-list-shift_attendance')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fo17-item-syn-att-groom-today'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shift_attendance', itemId: 'syn-att-groom-today' }));
  });

  test('a reason is required; a concurrent decision by someone else is shown, never overwritten', async () => {
    const repos = fixtures();
    const decide = jest.spyOn(repos.review, 'decide');
    await render(wrap(<ReviewItemView repos={repos} scope={ADMIN} contextKey={key(ADMIN)} kind="care_evidence" itemId="syn-sub-2" t={t} onBack={jest.fn()} />));
    await fireEvent.press(await screen.findByTestId('fo18-accept'));
    await fireEvent.changeText(screen.getByTestId('fo18-reason'), 'ok');
    await fireEvent.press(screen.getByTestId('fo18-submit'));
    expect(await screen.findByText('Write at least 3 characters.')).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('fo18-reason'), 'Bucket refilled, photo clear');
    await fireEvent.press(screen.getByTestId('fo18-submit'));
    expect(await screen.findByTestId('fo18-conflict')).toBeTruthy();
    expect(await screen.findByTestId('fo18-already-decided')).toHaveTextContent(/Accepted by another reviewer/);
    expect(screen.queryByTestId('fo18-accept')).toBeNull();
  });

  test('shift acceptance says it is not verified presence; decisions carry the loaded version', async () => {
    const repos = fixtures();
    const decide = jest.spyOn(repos.review, 'decide');
    await render(wrap(<ReviewItemView repos={repos} scope={ADMIN} contextKey={key(ADMIN)} kind="shift_attendance" itemId="syn-att-groom-today" t={t} onBack={jest.fn()} />));
    expect(await screen.findByText(/does not mark the punch-in as verified presence/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fo18-reject'));
    await fireEvent.changeText(screen.getByTestId('fo18-reason'), 'Not at the stable at 6');
    await fireEvent.press(screen.getByTestId('fo18-submit'));
    expect(await screen.findByTestId('fo18-decided')).toHaveTextContent(/Rejected/);
    expect(decide).toHaveBeenCalledWith(ADMIN, expect.objectContaining({ kind: 'shift_attendance', expectedVersion: 1, decision: 'reject' }));
  });

  test('own record: no decision buttons (never self-approve); a lost reply is retried with the same operation id', async () => {
    const mine: ReviewItem = {
      kind: 'rank_proposal', itemId: 'p1', hubId: 'syn-hub-1', version: 1, state: 'open', reasons: ['rank_change'], subjectUserId: 'syn-hub-admin', subjectName: 'Meena', observedAt: null,
      receivedAt: new Date(NOW).toISOString(), accuracyM: null, distanceM: null, horseName: null, taskType: null, dueAt: null, late: null, media: null, cadetId: 'c', cadetName: 'Tara',
      fromRank: 'CADET_RIDER', toRank: 'CADET_KNIGHT', evidenceSessionIds: ['s'], decidedBy: null, decidedAt: null, decisionReason: null, canDecide: true,
    };
    const base = fixtures();
    const self: FieldOpsRepositories = { ...base, review: { ...base.review, item: async () => mine } };
    const r = await render(wrap(<ReviewItemView repos={self} scope={ADMIN} contextKey={`${key(ADMIN)}:self`} kind="rank_proposal" itemId="p1" t={t} onBack={jest.fn()} />));
    expect(await screen.findByTestId('fo18-own')).toBeTruthy();
    expect(screen.queryByTestId('fo18-accept')).toBeNull();
    await r.unmount();

    const decide = jest.fn().mockRejectedValueOnce(new FieldCommandError('network', 'x')).mockResolvedValueOnce({ kind: 'rank_proposal', itemId: 'p1', decision: 'accepted', decidedAt: new Date(NOW).toISOString(), duplicate: true });
    const other: FieldOpsRepositories = { ...base, review: { ...base.review, item: async () => ({ ...mine, subjectUserId: 'syn-instructor' }), decide } };
    let n = 0;
    await render(wrap(<ReviewItemView repos={other} scope={ADMIN} contextKey={`${key(ADMIN)}:other`} kind="rank_proposal" itemId="p1" t={t} makeId={() => `op-${++n}`} onBack={jest.fn()} />));
    await fireEvent.press(await screen.findByTestId('fo18-accept'));
    await fireEvent.changeText(screen.getByTestId('fo18-reason'), 'Four strong sessions');
    await fireEvent.press(screen.getByTestId('fo18-submit'));
    await screen.findByTestId('fo18-decide-offline');
    await fireEvent.press(screen.getByTestId('fo18-accept'));
    await fireEvent.press(screen.getByTestId('fo18-submit'));
    expect(await screen.findByTestId('fo18-decided')).toBeTruthy();
    expect(decide.mock.calls[0][1].operationId).toBe(decide.mock.calls[1][1].operationId);
  });
});

describe('FO-19 Rank proposal (flag)', () => {
  test('hidden by default: the flag is off and the screen says so', async () => {
    await render(wrap(<RankProposalView repos={fixtures()} scope={INSTR} contextKey={key(INSTR)} cadetId="syn-f1" t={t} onBack={jest.fn()} />));
    expect(await screen.findByTestId('fo19-off')).toBeTruthy();
    expect(screen.queryByTestId('fo19-submit')).toBeNull();
  });

  test('flag on: cite published sessions, send, and only "sent for approval" (no self-approval)', async () => {
    await render(wrap(<RankProposalView repos={fixtures()} scope={DUAL} contextKey={key(DUAL)} cadetId="syn-f9" t={t} onBack={jest.fn()} />));
    expect(await screen.findByTestId('fo19-authority')).toHaveTextContent(/Nobody can approve their own proposal/);
    await fireEvent.press(screen.getByTestId('fo19-submit'));
    expect(await screen.findByText('Choose a rank.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fo19-rank-CADET_KNIGHT'));
    await fireEvent.press(screen.getByTestId('fo19-session-syn-ts-tara-0'));
    await fireEvent.press(screen.getByTestId('fo19-submit'));
    expect(await screen.findByTestId('fo19-sent')).toHaveTextContent(/The hub admin decides/);
  });
});

describe('FO-20 Posture', () => {
  test('honest unavailable: a reason, no landmarks or scores', async () => {
    await render(wrap(<PostureReviewView repos={fixtures()} scope={INSTR} contextKey={key(INSTR)} mediaOk t={t} onBack={jest.fn()} />));
    expect(await screen.findByTestId('fo20-unavailable')).toHaveTextContent(/switched this off/);
    expect(screen.queryByText(/\d+\s?%|confidence\s*[:=]\s*\d/i)).toBeNull();
  });

  test('grooms are denied', async () => {
    await render(wrap(<PostureReviewView repos={fixtures()} scope={GROOM} contextKey={key(GROOM)} mediaOk t={t} onBack={jest.fn()} />));
    expect(await screen.findByTestId('fo20-denied')).toBeTruthy();
  });
});

describe('server is the authority (fixture server mirrors the SQL rules)', () => {
  test('supervisor and instructor actions are refused for other roles, not just hidden', async () => {
    const repos = fixtures();
    await expect(repos.review.decide(GROOM, { kind: 'care_evidence', itemId: 'syn-sub-1', expectedVersion: 1, decision: 'accept', reason: 'looks fine', operationId: 'op-x' })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await repos.review.queue(GROOM)).toEqual({ kind: 'denied' });
    await expect(repos.posture.capability(GROOM)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(repos.rank.propose(INSTR, { cadetId: 'syn-f1', toRank: 'CADET_RIDER', evidenceSessionIds: ['s'], note: null, operationId: 'op-y' })).rejects.toMatchObject({ kind: 'forbidden' });
    // a hub admin's punch-in is refused by the server and parked as Blocked (never sent again by itself)
    repos.outbox.setSession(own(ADMIN));
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0)); // the fixture binds the session once its seed data exists
    });
    const it = await repos.outbox.queuePunchIn(own(ADMIN), { observedAt: NOW, location: null });
    await waitFor(async () => {
      await repos.outbox.drain();
      expect(repos.outbox.get(own(ADMIN), it.operationId)?.state).toBe('blocked');
    });
  });

  test('another hub’s scope is refused', async () => {
    await expect(fixtures().horses.listHorses({ ...GROOM, hubId: 'syn-hub-2' })).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('offline and unsaved work', () => {
  test('FO-08 with no connection shows the offline state with Retry, not an empty list', async () => {
    const OFF = S('syn-field-offline', 'GROOM');
    await inRouter(<HorsesView repos={fixtures()} scope={OFF} contextKey={key(OFF)} canPunch={false} t={t} onOpenHorse={jest.fn()} onOpenShift={jest.fn()} onOpenReview={jest.fn()} />);
    expect(await screen.findByTestId('fo08-offline')).toBeTruthy();
    expect(screen.queryByTestId('fo08-empty')).toBeNull();
  });

  test('FO-10 leaving with an unsent photo asks first; Stay keeps it', async () => {
    const repos = fixtures();
    const onBack = jest.fn();
    const takePhoto = jest.fn(async () => ({ mode: 'care_photo' as const, uri: 'fixture-capture://t2', mimeType: 'image/jpeg', capturedAt: new Date(NOW).toISOString() }));
    await render(wrap(<CareTaskView repos={repos} scope={GROOM} owner={own(GROOM)} contextKey={key(GROOM)} taskId="syn-occ-badal-water-1" t={t} location={loc(12)} takePhoto={takePhoto} onBack={onBack} onOpenSync={jest.fn()} />));
    await fireEvent.press(await screen.findByTestId('fo10-take-photo'));
    await screen.findByTestId('fo10-send');
    await fireEvent.press(screen.getByTestId('header-back'));
    await fireEvent.press(await screen.findByTestId('fo10-leave-stay'));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('fo10-send')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('header-back'));
    await fireEvent.press(await screen.findByTestId('fo10-leave-confirm'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
