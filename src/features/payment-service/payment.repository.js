import { eq, like, sql } from 'drizzle-orm';
import { db, schema } from '../../config/db.js';

export async function insertTransaction({ transactionId, userId, amount }) {
  const [row] = await db
    .insert(schema.transactions)
    .values({ transactionId, userId, amount })
    .returning();
  return row;
}

export async function findTransaction(transactionId) {
  const [row] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.transactionId, transactionId));
  if (!row) return null;

  const notifications = await db
    .select({ channel: schema.notifications.channel, sentAt: schema.notifications.sentAt })
    .from(schema.notifications)
    .where(eq(schema.notifications.transactionId, transactionId));

  return { ...row, notifications };
}

// Aggregate view used by the load test: how many payments with this user
// prefix exist, how many are confirmed, and how many notification rows landed.
export async function summarizeTransactions(userPrefix) {
  const [tx] = await db
    .select({
      total: sql`count(*)`.mapWith(Number),
      confirmed: sql`count(*) filter (where ${schema.transactions.status} = 'confirmed')`.mapWith(Number),
    })
    .from(schema.transactions)
    .where(like(schema.transactions.userId, `${userPrefix}%`));

  const [n] = await db
    .select({ notifications: sql`count(*)`.mapWith(Number) })
    .from(schema.notifications)
    .where(like(schema.notifications.userId, `${userPrefix}%`));

  return { ...tx, notifications: n.notifications };
}
