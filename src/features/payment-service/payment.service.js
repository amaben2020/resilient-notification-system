import { randomUUID } from 'node:crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { insertTransaction, findTransaction } from './payment.repository.js';
import { paymentCounter, paymentDuration } from '../../observability/metrics.js';

const sns = new SNSClient({ region: process.env.AWS_REGION || 'eu-west-2' });

export async function processPayment(userId, amount) {
  const end = paymentDuration.startTimer();
  try {
    // 1. Core payment logic: persist the transaction (status = pending).
    const transaction = await insertTransaction({
      transactionId: `txn_${randomUUID()}`,
      userId,
      amount,
    });

    // 2. Fire ONE event. SNS fans it out to the email/sms/order queues.
    await publishPaymentConfirmed(transaction);

    paymentCounter.inc({ status: 'success' });
    return transaction;
  } catch (err) {
    paymentCounter.inc({ status: 'failed' });
    throw err;
  } finally {
    end();
  }
}

export function findPayment(transactionId) {
  return findTransaction(transactionId);
}

async function publishPaymentConfirmed({ userId, transactionId, amount }) {
  const TopicArn = process.env.PAYMENT_CONFIRMED_TOPIC_ARN;
  if (!TopicArn) {
    // Local dev without AWS: the row is still written, the event just isn't sent.
    console.warn('PAYMENT_CONFIRMED_TOPIC_ARN not set, skipping SNS publish');
    return;
  }

  await sns.send(
    new PublishCommand({
      TopicArn,
      Message: JSON.stringify({ userId, transactionId, amount }),
    }),
  );
}
