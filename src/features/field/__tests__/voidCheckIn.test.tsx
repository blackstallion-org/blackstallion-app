import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { createMemoryStore } from '@/core/preferences/keyValueStore';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

import { CadetProfileView, useVoidCheckIn } from '../CadetProfileScreen';
import type { CadetProfile, FieldCommandRepository } from '../data/repositories';
import { FieldCommandError } from '../domain/commandErrors';

const wrap = (ui: ReactNode) => render(<ThemeProvider store={createMemoryStore()}>{ui}</ThemeProvider>);
const ids = () => {
  let n = 0;
  return jest.fn(() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`);
};
const profile = (today: CadetProfile['today']): CadetProfile => ({
  source: 'synthetic-preview',
  cadet: { id: 'c1', name: 'Diya Nair (sample)', firstName: 'Diya', rank: 'CADET_SQUIRE', passportHint: 'BSAH-26-••••0002', horseName: null },
  today,
  attendance: [],
  sessions: [],
  consent: { sessionVideo: 'off', carePhoto: 'off', postureAnalysis: 'off' },
});
const open = { checkInId: 'ci-1', checkInOperationId: 'op-ci-1', time: '09:35', publishedSessionId: null };
const commands = (voidCheckIn: FieldCommandRepository['voidCheckIn']): FieldCommandRepository => ({
  checkIn: jest.fn(),
  publish: jest.fn(),
  correct: jest.fn(),
  voidCheckIn,
});

describe('FO-06 void today’s check-in (FO-16 reason)', () => {
  it('offers the void only for today’s unassessed check-in and only when allowed', async () => {
    const onVoid = jest.fn();
    const { rerender } = await wrap(<CadetProfileView data={profile(open)} canRecord onAssess={jest.fn()} onScan={jest.fn()} onOpenRecord={jest.fn()} canVoid onVoid={onVoid} />);
    await fireEvent.press(screen.getByTestId('profile-void'));
    expect(onVoid).toHaveBeenCalledTimes(1);

    const variants: [CadetProfile['today'], boolean][] = [
      [{ ...open, publishedSessionId: 'ts-1' }, true], // published → correct instead
      [null, true], // not checked in
      [open, false], // role may not void
    ];
    for (const [today, canVoid] of variants) {
      await rerender(
        <ThemeProvider store={createMemoryStore()}>
          <CadetProfileView data={profile(today)} canRecord onAssess={jest.fn()} onScan={jest.fn()} onOpenRecord={jest.fn()} canVoid={canVoid} onVoid={onVoid} />
        </ThemeProvider>,
      );
      expect(screen.queryByTestId('profile-void')).toBeNull();
    }
  });

  it('shows the server’s refusal in plain language and the result only after the server answers', async () => {
    await wrap(
      <CadetProfileView
        data={profile(open)}
        canRecord
        onAssess={jest.fn()}
        onScan={jest.fn()}
        onOpenRecord={jest.fn()}
        canVoid
        onVoid={jest.fn()}
        voidState={{ kind: 'error', error: new FieldCommandError('conflict', 'x', 'PT409', 'errors.known.voidPublished'), retryable: false }}
        onRetryVoid={jest.fn()}
      />,
    );
    expect(screen.getByText(/already published for this check-in\. Make a correction instead/)).toBeTruthy();
    expect(screen.queryByTestId('profile-void-retry')).toBeNull(); // a definite refusal is not retried
  });

  it('after a lost reply, offers Retry (same request) instead of making the person retype the reason', async () => {
    const onRetryVoid = jest.fn();
    await wrap(
      <CadetProfileView data={profile(open)} canRecord onAssess={jest.fn()} onScan={jest.fn()} onOpenRecord={jest.fn()} canVoid onVoid={jest.fn()} onRetryVoid={onRetryVoid}
        voidState={{ kind: 'error', error: new FieldCommandError('network', 'lost'), retryable: true }} />,
    );
    await fireEvent.press(screen.getByTestId('profile-void-retry'));
    expect(onRetryVoid).toHaveBeenCalledTimes(1);
  });

  it('retries a lost reply with the SAME operation id; a new reason is a new operation', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new FieldCommandError('network', 'lost'))
      .mockResolvedValueOnce({ checkInId: 'ci-1', voidedAt: '2026-11-05T06:00:00Z', duplicate: true })
      .mockResolvedValueOnce({ checkInId: 'ci-1', voidedAt: '2026-11-05T06:00:00Z', duplicate: false });
    const makeId = ids();
    const { result } = await renderHook(() => useVoidCheckIn(commands(send), makeId));
    await act(async () => {
      expect(await result.current.submit('ci-1', 'Wrong passport')).toBe(false);
    });
    expect(result.current.state).toMatchObject({ kind: 'error', retryable: true });
    expect(result.current.lastWasDefinite()).toBe(false);
    // Retry resends the same request without retyping the reason
    await act(async () => {
      expect(await result.current.retryLast()).toBe(true);
    });
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send.mock.calls[0][0].operationId).toBe(send.mock.calls[1][0].operationId);
    await act(async () => {
      await result.current.submit('ci-1', 'Different reason');
    });
    expect(send.mock.calls[2][0].operationId).not.toBe(send.mock.calls[1][0].operationId);
  });

  it('a definite refusal ends the attempt (the next try is a new operation)', async () => {
    const send = jest.fn().mockRejectedValueOnce(new FieldCommandError('conflict', 'already')).mockResolvedValueOnce({ checkInId: 'ci-1', voidedAt: 'x', duplicate: false });
    const makeId = ids();
    const { result } = await renderHook(() => useVoidCheckIn(commands(send), makeId));
    await act(async () => {
      await result.current.submit('ci-1', 'Wrong passport');
    });
    await act(async () => {
      await result.current.submit('ci-1', 'Wrong passport');
    });
    expect(send.mock.calls[0][0].operationId).not.toBe(send.mock.calls[1][0].operationId);
  });
});
