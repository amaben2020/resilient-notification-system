import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { userId, transactionId } = parsePaymentEvent(record);
    const log = logger.child({ worker: 'sms', transactionId, userId });

    // Real impl: call Twilio here.
    await db.insert(schema.notifications).values({ transactionId, userId, channel: 'sms' });
    log.info('sms confirmation sent');
  }
};
