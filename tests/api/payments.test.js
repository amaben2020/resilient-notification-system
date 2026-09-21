import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/features/payment-service/payment.repository.js', () => ({
  insertTransaction: vi.fn(async (t) => ({ id: 1, status: 'pending', createdAt: new Date(), ...t })),
  findTransaction: vi.fn(),
  summarizeTransactions: vi.fn(async () => ({ total: 3, confirmed: 3, notifications: 6 })),
}));
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: class { send = vi.fn(); },
  PublishCommand: class { constructor(input) { this.input = input; } },
}));

import app from '../../app.js';
import { findTransaction, insertTransaction } from '../../src/features/payment-service/payment.repository.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /api/payments', () => {
  it('400 on invalid body', async () => {
    const res = await request(app).post('/api/payments').send({ userId: 'u_1', amount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
    expect(insertTransaction).not.toHaveBeenCalled();
  });

  it('201 with a pending transaction', async () => {
    const res = await request(app).post('/api/payments').send({ userId: 'u_1', amount: 4999 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: 'u_1', amount: 4999, status: 'pending' });
    expect(res.body.transactionId).toMatch(/^txn_/);
  });

  it('500 via the global error handler when the repository throws', async () => {
    vi.mocked(insertTransaction).mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/payments').send({ userId: 'u_1', amount: 1 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('GET /api/payments/:transactionId', () => {
  it('404 when unknown', async () => {
    vi.mocked(findTransaction).mockResolvedValueOnce(null);
    const res = await request(app).get('/api/payments/txn_nope');
    expect(res.status).toBe(404);
  });

  it('200 with notifications when found', async () => {
    vi.mocked(findTransaction).mockResolvedValueOnce({
      transactionId: 'txn_1', status: 'confirmed', notifications: [{ channel: 'email' }, { channel: 'sms' }],
    });
    const res = await request(app).get('/api/payments/txn_1');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
  });
});

describe('GET /api/payments/stats', () => {
  it('400 without a usable prefix', async () => {
    expect((await request(app).get('/api/payments/stats')).status).toBe(400);
  });
  it('returns totals for the prefix', async () => {
    const res = await request(app).get('/api/payments/stats?userPrefix=k6_');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3, confirmed: 3, notifications: 6 });
  });
});

describe('GET /metrics', () => {
  it('exposes prometheus text format including our counters', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('# TYPE payments_processed_total counter');
    expect(res.text).toContain('payment_processing_duration_seconds');
  });
});
