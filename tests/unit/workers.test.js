import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable fake of the Drizzle query builder: records the final call.
const { calls, db } = vi.hoisted(() => {
  const calls = { inserts: [], updates: [] };
  const db = {
    insert: vi.fn((table) => ({ values: vi.fn(async (v) => calls.inserts.push({ table, values: v })) })),
    update: vi.fn((table) => ({
      set: vi.fn((v) => ({ where: vi.fn(async (w) => calls.updates.push({ table, set: v, where: w })) })),
    })),
  };
  return { calls, db };
});
vi.mock('../../src/config/db.js', async () => ({ db, schema: await import('../../src/config/schema.js') }));

import { handler as email } from '../../src/features/workers/email/index.mjs';
import { handler as sms } from '../../src/features/workers/sms/index.mjs';
import { handler as order } from '../../src/features/workers/order/index.mjs';
import { schema } from '../../src/config/db.js';

function sqsEvent(...payloads) {
  return {
    Records: payloads.map((p, i) => ({
      messageId: String(i),
      body: JSON.stringify({ Type: 'Notification', Message: JSON.stringify(p) }),
    })),
  };
}

beforeEach(() => {
  calls.inserts.length = 0;
  calls.updates.length = 0;
});

describe('workers', () => {
  it.each([
    ['email', email],
    ['sms', sms],
  ])('%s worker inserts one notification row per record', async (channel, fn) => {
    await fn(sqsEvent({ userId: 'u_1', transactionId: 'txn_1', amount: 1 }, { userId: 'u_2', transactionId: 'txn_2', amount: 2 }));
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0].table).toBe(schema.notifications);
    expect(calls.inserts[0].values).toEqual({ transactionId: 'txn_1', userId: 'u_1', channel });
    expect(calls.inserts[1].values.transactionId).toBe('txn_2');
  });

  it('order worker marks each transaction confirmed', async () => {
    await order(sqsEvent({ userId: 'u_1', transactionId: 'txn_9', amount: 1 }));
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].table).toBe(schema.transactions);
    expect(calls.updates[0].set).toEqual({ status: 'confirmed' });
  });

  it('a malformed record fails the batch (so SQS retries / DLQs it)', async () => {
    await expect(email({ Records: [{ body: 'not json' }] })).rejects.toThrow();
    expect(calls.inserts).toHaveLength(0);
  });
});
