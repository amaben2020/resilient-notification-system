import { randomUUID } from 'node:crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { insertTransaction, findTransaction, summarizeTransactions } from './payment.repository.js';
import { paymentCounter, paymentDuration } from '../../observability/metrics.js';
import { logger } from '../../observability/logger.js';

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
    logger.info(
      { event: 'PAYMENT_CREATED', transactionId: transaction.transactionId, userId, amount },
      `payment ${transaction.transactionId} stored as pending`,
    );

    // 2. Fire ONE event. SNS fans it out to the email/sms/order queues.
    await publishPaymentConfirmed(transaction);

    paymentCounter.inc({ status: 'success' });
    return transaction;
  } catch (err) {
    paymentCounter.inc({ status: 'failed' });
    logger.error({ event: 'PAYMENT_FAILED', userId, amount, err }, err.message);
    throw err;
  } finally {
    end();
  }
}

export function paymentStats(userPrefix) {
  return summarizeTransactions(userPrefix);
}

export function findPayment(transactionId) {
  return findTransaction(transactionId);
}

async function publishPaymentConfirmed({ userId, transactionId, amount }) {
  const TopicArn = process.env.PAYMENT_CONFIRMED_TOPIC_ARN;
  if (!TopicArn) {
    // Local dev without AWS: the row is still written, the event just isn't sent.
    logger.warn({ event: 'EVENT_PUBLISH_SKIPPED', transactionId }, 'PAYMENT_CONFIRMED_TOPIC_ARN not set');
    return;
  }

  await sns.send(
    new PublishCommand({
      TopicArn,
      Message: JSON.stringify({ userId, transactionId, amount }),
    }),
  );
  logger.info(
    { event: 'EVENT_PUBLISHED', transactionId, userId, topic: TopicArn.split(':').pop() },
    `payment_confirmed for ${transactionId} -> SNS (fans out to email, sms, order queues)`,
  );
}
