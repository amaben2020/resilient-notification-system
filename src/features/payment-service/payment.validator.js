const MAX_USER_ID = 64;
const MAX_AMOUNT = 1_000_000_00; // 1,000,000.00 in minor units; also well inside Postgres int4

export function validateCreatePayment(req, res, next) {
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'body must be a JSON object' });
  }
  const { userId, amount } = body;

  if (typeof userId !== 'string' || userId.length === 0 || userId.length > MAX_USER_ID) {
    return res.status(400).json({ error: `userId must be a string of 1-${MAX_USER_ID} characters` });
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return res.status(400).json({ error: `amount must be a positive integer up to ${MAX_AMOUNT} (minor units)` });
  }
  next();
}
