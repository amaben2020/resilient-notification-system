// End-to-end check against real AWS: POST a payment, then poll until the
// order worker has confirmed it and the email/sms workers have logged rows.
// Usage: npm run smoke   (needs the API running: npm run dev)
const base = process.env.API_URL || 'http://localhost:3300';

const res = await fetch(`${base}/api/payments`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: 'smoke_user', amount: 1234 }),
});
const payment = await res.json();
if (!res.ok) throw new Error(`create failed: ${JSON.stringify(payment)}`);
console.log('created', payment.transactionId, payment.status);

const started = Date.now();
for (let i = 0; i < 20; i++) {
  const r = await fetch(`${base}/api/payments/${payment.transactionId}`);
  const p = await r.json();
  if (p.status === 'confirmed' && p.notifications?.length >= 2) {
    console.log(`confirmed after ${Math.round((Date.now() - started) / 1000)}s`);
    console.log('notifications:', p.notifications.map((n) => n.channel).join(', '));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.error('timed out waiting for workers');
process.exit(1);
