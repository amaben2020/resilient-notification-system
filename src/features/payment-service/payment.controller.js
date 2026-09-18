import { processPayment, findPayment } from './payment.service.js';

export async function createPayment(req, res, next) {
  try {
    const { userId, amount } = req.body;
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
