import { db, schema } from '../../../config/db.js';
import { parsePaymentEvent } from '../parse-record.mjs';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { userId, transactionId } = parsePaymentEvent(record);

    // Real impl: call Twilio here.
    console.log(`[sms] sending confirmation to user ${userId} for ${transactionId}`);

    await db.insert(schema.notifications).values({ transactionId, userId, channel: 'sms' });
  }
};
