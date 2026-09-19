import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

const log = logger.child({ worker: 'sms' });

export const handler = async (event) => {
  log.info({ event: 'QUEUE_BATCH_RECEIVED', count: event.Records.length }, `${event.Records.length} message(s) from sms-queue`);

  for (const record of event.Records) {
    const { userId, transactionId } = parsePaymentEvent(record);
    const msg = log.child({ transactionId, userId, messageId: record.messageId });
    msg.info({ event: 'QUEUE_MESSAGE_RECEIVED' }, `payment_confirmed for ${transactionId}`);

    try {
      msg.info({ event: 'PROCESSING' }, `sending confirmation sms to user ${userId}`);
      // Real impl: call Twilio here.
      await db.insert(schema.notifications).values({ transactionId, userId, channel: 'sms' });
      msg.info({ event: 'SMS_SENT' }, 'confirmation sms recorded');
    } catch (err) {
      msg.error({ event: 'QUEUE_MESSAGE_FAILED', err }, err.message);
      throw err;
    }
  }
};
