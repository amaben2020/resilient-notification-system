import { processPayment, findPayment, paymentStats } from './payment.service.js';

export async function createPayment(req, res, next) {
  try {
    const { userId, amount } = req.body;
    // where we use the queue
    const result = await processPayment(userId, amount);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPayment(req, res, next) {
  try {
    const payment = await findPayment(req.params.transactionId);
    if (!payment) return res.status(404).json({ error: 'not found' });
    res.json(payment);
  } catch (err) {
    next(err);
  }
}

export async function getStats(req, res, next) {
  try {
    const prefix = String(req.query.userPrefix ?? '');
    if (prefix.length < 2) return res.status(400).json({ error: 'userPrefix must be at least 2 characters' });
    res.json(await paymentStats(prefix));
  } catch (err) {
    next(err);
  }
}
