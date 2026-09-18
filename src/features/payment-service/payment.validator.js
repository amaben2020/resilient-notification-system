export function validateCreatePayment(req, res, next) {
  const { userId, amount } = req.body ?? {};

  if (typeof userId !== 'string' || userId.length === 0) {
    return res.status(400).json({ error: 'userId must be a non-empty string' });
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive integer (minor units)' });
  }
  next();
}
