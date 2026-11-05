import { createOutboxPendingWork } from '../data/pendingWork';
import type { FieldOutbox } from '../data/repositories';

const outbox = (durability: FieldOutbox['durability'], n: number) =>
  ({ durability, pendingCount: jest.fn(() => n), discardAllFor: jest.fn(async () => ({ discarded: n, skipped: 0 })) }) as unknown as FieldOutbox;

describe('SH-06 / SH-10 / SH-12 pending-work port over the Field outbox', () => {
  it('reports a memory-only queue as not durable, so sign-out and update copy never promise it stays on the phone', async () => {
    const memory = createOutboxPendingWork(outbox('memory', 2));
    expect(memory.durable).toBe(false);
    expect(await memory.count('syn-groom')).toBe(2);
    expect(createOutboxPendingWork(outbox('durable' as FieldOutbox['durability'], 0)).durable).toBe(true);
  });

  it('discards only through the outbox (tombstones are the outbox’s job)', async () => {
    const o = outbox('memory', 3);
    await createOutboxPendingWork(o).discard?.('syn-groom');
    expect(o.discardAllFor).toHaveBeenCalledWith('syn-groom');
  });
});
