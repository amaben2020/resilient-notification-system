import { describe, it, expect } from 'vitest';
import { parsePaymentEvent } from '../../src/features/workers/parse-record.mjs';

describe('parsePaymentEvent', () => {
  it('unwraps SQS body -> SNS envelope -> payload', () => {
    const payload = { userId: 'u_1', transactionId: 'txn_1', amount: 100 };
    const record = {
      body: JSON.stringify({ Type: 'Notification', MessageId: 'm', Message: JSON.stringify(payload) }),
    };
    expect(parsePaymentEvent(record)).toEqual(payload);
  });

  it('throws on a body that is not the SNS envelope (single-wrapped message)', () => {
    const record = { body: JSON.stringify({ userId: 'u_1' }) };
    expect(() => parsePaymentEvent(record)).toThrow();
  });
});
