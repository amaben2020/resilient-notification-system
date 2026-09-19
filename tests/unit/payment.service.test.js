import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: class { send = sendMock; },
  PublishCommand: class { constructor(input) { this.input = input; } },
}));
vi.mock('../../src/features/payment-service/payment.repository.js', () => ({
  insertTransaction: vi.fn(async (t) => ({ id: 1, status: 'pending', ...t })),
  findTransaction: vi.fn(),
}));

import { processPayment } from '../../src/features/payment-service/payment.service.js';
import { insertTransaction } from '../../src/features/payment-service/payment.repository.js';
import { register } from '../../src/observability/metrics.js';

beforeEach(() => {
  sendMock.mockReset();
  vi.mocked(insertTransaction).mockClear();
});

describe('processPayment', () => {
  it('persists a pending transaction and publishes exactly one SNS message', async () => {
    process.env.PAYMENT_CONFIRMED_TOPIC_ARN = 'arn:aws:sns:eu-west-2:1:t';

    const tx = await processPayment('u_1', 4999);

    expect(tx.status).toBe('pending');
    expect(tx.transactionId).toMatch(/^txn_[0-9a-f-]{36}$/);
    expect(insertTransaction).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();

    const { input } = sendMock.mock.calls[0][0];
    expect(input.TopicArn).toBe('arn:aws:sns:eu-west-2:1:t');
    expect(JSON.parse(input.Message)).toEqual({ userId: 'u_1', transactionId: tx.transactionId, amount: 4999 });
  });

  it('skips publishing when the topic ARN is not configured', async () => {
    delete process.env.PAYMENT_CONFIRMED_TOPIC_ARN;
    await processPayment('u_1', 10);
    expect(insertTransaction).toHaveBeenCalledOnce();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('counts a failure and rethrows when the DB write fails', async () => {
    vi.mocked(insertTransaction).mockRejectedValueOnce(new Error('db down'));
    await expect(processPayment('u_1', 10)).rejects.toThrow('db down');

    const metrics = await register.metrics();
    expect(metrics).toMatch(/payments_processed_total\{status="failed"\} [1-9]/);
  });
});
