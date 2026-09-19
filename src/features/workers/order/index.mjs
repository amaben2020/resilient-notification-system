import { eq } from 'drizzle-orm';
import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { transactionId } = parsePaymentEvent(record);
    const log = logger.child({ worker: 'order', transactionId });

    await db
      .update(schema.transactions)
      .set({ status: 'confirmed' })
      .where(eq(schema.transactions.transactionId, transactionId));
    log.info('order confirmed');
  }
};
