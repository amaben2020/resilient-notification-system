import { eq } from 'drizzle-orm';
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
  return row ?? null;
}
