import { eq } from 'drizzle-orm';
import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { transactionId } = parsePaymentEvent(record);

    console.log(`[order] marking ${transactionId} confirmed`);

    await db
      .update(schema.transactions)
      .set({ status: 'confirmed' })
      .where(eq(schema.transactions.transactionId, transactionId));
  }
};
