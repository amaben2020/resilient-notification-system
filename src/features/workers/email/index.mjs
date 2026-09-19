import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

const log = logger.child({ worker: 'email' });

export const handler = async (event) => {
  log.info({ event: 'QUEUE_BATCH_RECEIVED', count: event.Records.length }, `${event.Records.length} message(s) from email-queue`);

  for (const record of event.Records) {
    const { userId, transactionId } = parsePaymentEvent(record);
    const msg = log.child({ transactionId, userId, messageId: record.messageId });
    msg.info({ event: 'QUEUE_MESSAGE_RECEIVED' }, `payment_confirmed for ${transactionId}`);

    try {
      msg.info({ event: 'PROCESSING' }, `sending confirmation email to user ${userId}`);
      // Real impl: call SES/SendGrid here. We just record that it "went out".
      await db.insert(schema.notifications).values({ transactionId, userId, channel: 'email' });
      msg.info({ event: 'EMAIL_SENT' }, 'confirmation email recorded');
    } catch (err) {
      // Rethrow so SQS retries the batch and eventually dead-letters it.
      msg.error({ event: 'QUEUE_MESSAGE_FAILED', err }, err.message);
      throw err;
    }
  }
};
