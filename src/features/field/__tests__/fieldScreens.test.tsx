import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

import { AssessSessionView } from '../AssessScreen';
import { FieldCommandError } from '../domain/commandErrors';
import type { CheckInResult, FieldWorkflowRepository, PublishResult } from '../domain/workflow';
import { ScanCheckInView } from '../ScanScreen';

const wrap = (ui: ReactNode) => render(<ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>);
const ids = () => {
  let n = 0;
  return jest.fn(() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`);
};
const checkIn: CheckInResult = {
  checkInId: 'ci-1', checkInOperationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cadetId: 'c1', cadetName: 'Aarav Rao',
  sessionDate: '2026-11-04', receivedAt: '2026-11-04T04:30:00Z', duplicate: false, isToday: true,
};
const published: PublishResult = { sessionId: 'ts-1', version: 1, sessionDate: '2026-11-04', duplicate: false };
const repoWith = (over: Partial<FieldWorkflowRepository>): FieldWorkflowRepository => ({
  checkIn: jest.fn(async () => checkIn),
  publish: jest.fn(async () => published),
  ...over,
});
const networkError = () => new FieldCommandError('network', 'We couldn’t confirm. Try again — repeating it is safe.');

describe('Check in (FO-02)', () => {
  it('validates the code before any request, then checks in and hands off to Assess', async () => {
    const repo = repoWith({});
    const onAssess = jest.fn();
    await wrap(<ScanCheckInView repo={repo} onAssess={onAssess} makeId={ids()} now={() => new Date('2026-11-04T04:30:00Z')} />);
    await fireEvent.changeText(screen.getByTestId('passport-input'), 'abc');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText(/doesn’t look like a passport code/)).toBeTruthy();
    expect(repo.checkIn).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('passport-input'), 'https://site.example/verify/bsah-26-f3a00001');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByTestId('checkin-result')).toBeTruthy();
    expect(repo.checkIn).toHaveBeenCalledWith({
      passportCode: 'BSAH-26-F3A00001', observedAt: new Date('2026-11-04T04:30:00Z'), operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    });
    await fireEvent.press(screen.getByTestId('open-assess'));
    expect(onAssess).toHaveBeenCalledWith({ checkInOperationId: checkIn.checkInOperationId, cadetId: 'c1', cadetName: 'Aarav Rao' });
  });

  it('retries a lost reply with the SAME operation id and time (no double check-in)', async () => {
    const checkInFn = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(checkIn);
    const makeId = ids();
    let t = 0;
    await wrap(<ScanCheckInView repo={repoWith({ checkIn: checkInFn })} onAssess={jest.fn()} makeId={makeId} now={() => new Date(Date.UTC(2026, 10, 4, 4, 30, t++))} />);
    await fireEvent.changeText(screen.getByTestId('passport-input'), 'BSAH-26-F3A00001');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByTestId('checkin-error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    await screen.findByTestId('checkin-result');
    expect(checkInFn.mock.calls[0][0]).toEqual(checkInFn.mock.calls[1][0]);
    expect(makeId).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh operation after a definite refusal', async () => {
    const checkInFn = jest.fn().mockRejectedValueOnce(new FieldCommandError('notFound', 'No cadet with this passport code at your hub.')).mockResolvedValueOnce(checkIn);
    const makeId = ids();
    await wrap(<ScanCheckInView repo={repoWith({ checkIn: checkInFn })} onAssess={jest.fn()} makeId={makeId} />);
    await fireEvent.changeText(screen.getByTestId('passport-input'), 'BSAH-26-F3A00001');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByText(/No cadet with this passport code at your hub/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    await screen.findByTestId('checkin-result');
    expect(makeId).toHaveBeenCalledTimes(2);
  });

  it('does not offer Assess for a check-in filed under another day', async () => {
    const repo = repoWith({ checkIn: jest.fn(async () => ({ ...checkIn, sessionDate: '2026-11-03', isToday: false })) });
    await wrap(<ScanCheckInView repo={repo} onAssess={jest.fn()} makeId={ids()} />);
    await fireEvent.changeText(screen.getByTestId('passport-input'), 'BSAH-26-F3A00001');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    expect(await screen.findByTestId('checkin-wrong-day')).toBeTruthy();
    expect(screen.queryByTestId('open-assess')).toBeNull();
  });

  it('starts a new request when a retry comes long after the first attempt', async () => {
    const checkInFn = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(checkIn);
    const makeId = ids();
    const times = [Date.UTC(2026, 10, 4, 4, 30), Date.UTC(2026, 10, 4, 4, 40)];
    await wrap(<ScanCheckInView repo={repoWith({ checkIn: checkInFn })} onAssess={jest.fn()} makeId={makeId} now={() => new Date(times.shift() ?? 0)} />);
    await fireEvent.changeText(screen.getByTestId('passport-input'), 'BSAH-26-F3A00001');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    await screen.findByTestId('checkin-error');
    await fireEvent.press(screen.getByTestId('checkin-submit'));
    await screen.findByTestId('checkin-result');
    expect(makeId).toHaveBeenCalledTimes(2);
    expect(checkInFn.mock.calls[1][0].observedAt).toEqual(new Date(Date.UTC(2026, 10, 4, 4, 40)));
  });

  it('says plainly when the build has no backend', async () => {
    await wrap(<ScanCheckInView onAssess={jest.fn()} />);
    expect(screen.getByTestId('scan-unconnected')).toBeTruthy();
  });
});

describe('Assess and publish (FO-03)', () => {
  const target = { checkInOperationId: checkIn.checkInOperationId, cadetId: 'c1', cadetName: 'Aarav Rao' };

  it('requires all scores, then publishes exactly what was entered', async () => {
    const repo = repoWith({});
    await wrap(<AssessSessionView repo={repo} target={target} onDone={jest.fn()} makeId={ids()} />);
    await fireEvent.press(screen.getByTestId('publish-submit'));
    expect(await screen.findByTestId('score-riding-error')).toBeTruthy();
    expect(screen.getByTestId('score-ground-error')).toBeTruthy();
    expect(repo.publish).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('score-riding-up')); // unset → 5
    await fireEvent.press(screen.getByTestId('score-riding-up')); // 6
    await fireEvent.press(screen.getByTestId('score-ground-down')); // unset → 5
    await fireEvent.press(screen.getByTestId('score-stable-up')); // 5
    await fireEvent.changeText(screen.getByTestId('assess-notes'), '  Good seat.  ');
    await fireEvent.press(screen.getByTestId('publish-submit'));
    expect(await screen.findByTestId('publish-done')).toBeTruthy();
    expect(screen.getByText(/Aarav Rao’s family can see this session now/)).toBeTruthy();
    expect(repo.publish).toHaveBeenCalledWith({
      checkInOperationId: target.checkInOperationId,
      assessment: { riding: 6, ground: 5, stable: 5, notes: 'Good seat.', skillIds: null },
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    });
  });

  it('after a lost reply, freezes the scores and resends the SAME request; a definite refusal unlocks editing', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(new FieldCommandError('invalid', 'The session was refused.'))
      .mockResolvedValueOnce(published);
    await wrap(<AssessSessionView repo={repoWith({ publish })} target={target} onDone={jest.fn()} makeId={ids()} />);
    for (const k of ['riding', 'ground', 'stable']) await fireEvent.press(screen.getByTestId(`score-${k}-up`));
    await fireEvent.press(screen.getByTestId('publish-submit'));
    await screen.findByTestId('publish-error');
    expect(screen.getByText('Retry publishing')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('score-stable-up')); // frozen: no change
    expect(screen.getByTestId('score-stable-value')).toHaveTextContent('5');
    await fireEvent.press(screen.getByTestId('publish-submit'));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls[1][0]).toEqual(publish.mock.calls[0][0]);
    await fireEvent.press(screen.getByTestId('publish-submit'));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(3));
    expect(publish.mock.calls[2][0].operationId).toBe(publish.mock.calls[0][0].operationId);
    await screen.findByText(/The session was refused/);
    await fireEvent.press(screen.getByTestId('score-stable-up')); // unlocked after a definite answer
    expect(screen.getByTestId('score-stable-value')).toHaveTextContent('6');
    await fireEvent.press(screen.getByTestId('publish-submit'));
    await screen.findByTestId('publish-done');
    expect(publish.mock.calls[3][0].operationId).not.toBe(publish.mock.calls[0][0].operationId);
    expect(publish.mock.calls[3][0].assessment.stable).toBe(6);
  });

  it('exposes each score as an adjustable control to screen readers', async () => {
    await wrap(<AssessSessionView repo={repoWith({})} target={target} onDone={jest.fn()} />);
    const riding = screen.getByTestId('score-riding');
    expect(riding.props.accessibilityRole).toBe('adjustable');
    expect(riding.props.accessibilityValue).toMatchObject({ min: 1, max: 10, text: 'Not set' });
    await fireEvent(riding, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('score-riding').props.accessibilityValue).toMatchObject({ now: 5, text: '5 of 10' });
  });

  it('refuses to open without a check-in hand-off', async () => {
    await wrap(<AssessSessionView repo={repoWith({})} target={null} onDone={jest.fn()} />);
    expect(screen.getByText('Open this cadet from Today')).toBeTruthy();
  });
});
