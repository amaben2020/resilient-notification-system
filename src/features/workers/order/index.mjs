import { eq } from 'drizzle-orm';
import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

const log = logger.child({ worker: 'order' });

export const handler = async (event) => {
  log.info({ event: 'QUEUE_BATCH_RECEIVED', count: event.Records.length }, `${event.Records.length} message(s) from order-queue`);

  for (const record of event.Records) {
    const { transactionId } = parsePaymentEvent(record);
    const msg = log.child({ transactionId, messageId: record.messageId });
    msg.info({ event: 'QUEUE_MESSAGE_RECEIVED' }, `payment_confirmed for ${transactionId}`);

    try {
      msg.info({ event: 'PROCESSING' }, 'marking order confirmed');
      await db
        .update(schema.transactions)
        .set({ status: 'confirmed' })
        .where(eq(schema.transactions.transactionId, transactionId));
      msg.info({ event: 'ORDER_CONFIRMED' }, `transaction ${transactionId} -> confirmed`);
    } catch (err) {
      msg.error({ event: 'QUEUE_MESSAGE_FAILED', err }, err.message);
      throw err;
    }
  }
};
