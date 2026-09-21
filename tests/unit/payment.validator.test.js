import { describe, it, expect, vi } from 'vitest';
import { validateCreatePayment } from '../../src/features/payment-service/payment.validator.js';

function run(body) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  validateCreatePayment({ body }, res, next);
  return { res, next };
}

describe('validateCreatePayment', () => {
  it('passes a valid body through', () => {
    const { res, next } = run({ userId: 'u_1', amount: 4999 });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: 1 }, 'userId'],
    [{ userId: '', amount: 1 }, 'userId'],
    [{ userId: 'u', amount: 0 }, 'amount'],
    [{ userId: 'u', amount: -5 }, 'amount'],
    [{ userId: 'u', amount: 12.5 }, 'amount'],
    [{ userId: 'u', amount: '100' }, 'amount'],
    [undefined, 'body'],
    [[1, 2], 'body'],
    [{ userId: 'u'.repeat(65), amount: 1 }, 'userId'],
    [{ userId: 'u', amount: 2147483648 }, 'amount'],
  ])('rejects %j with 400 mentioning %s', (body, field) => {
    const { res, next } = run(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain(field);
  });
});
