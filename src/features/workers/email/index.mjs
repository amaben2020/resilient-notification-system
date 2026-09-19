import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';
import { logger } from '../../../observability/logger.js';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { userId, transactionId } = parsePaymentEvent(record);
    const log = logger.child({ worker: 'email', transactionId, userId });

    // Real impl: call SES/SendGrid here. We just record that it "went out".
    await db.insert(schema.notifications).values({ transactionId, userId, channel: 'email' });
    log.info('email confirmation sent');
  }
};
