// Publishes straight to the real SNS topic and asserts that ALL three workers
// processed the message by observing their writes in Neon. This proves:
//   1. the topic fans out to all three queues,
//   2. each queue triggers its Lambda,
//   3. each Lambda unwraps the envelope and writes the right row.
// Run with: npm run test:integration  (after terraform apply)
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SNSClient, PublishCommand, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { db, schema } from '../../src/config/db.js';

const topicArn = process.env.PAYMENT_CONFIRMED_TOPIC_ARN;
const region = process.env.AWS_REGION || 'eu-west-2';
const sns = new SNSClient({ region });

beforeAll(() => {
  if (!topicArn || !process.env.DATABASE_URL) {
    throw new Error('integration tests need PAYMENT_CONFIRMED_TOPIC_ARN and DATABASE_URL');
  }
});

async function waitFor(fn, { timeoutMs = 60_000, everyMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error('timed out');
}

describe('SNS fan-out', () => {
  it('topic is subscribed by exactly the email, sms and order queues', async () => {
    const { Subscriptions } = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
    const endpoints = Subscriptions.map((s) => s.Endpoint.split(':').pop()).sort();
    expect(Subscriptions.every((s) => s.Protocol === 'sqs')).toBe(true);
    expect(endpoints).toEqual(
      ['email', 'order', 'sms'].map((w) => expect.stringMatching(new RegExp(`-${w}-queue$`))),
    );
  });

  it('one published event is processed by all three workers', async () => {
    const transactionId = `txn_it_${randomUUID()}`;
    const userId = 'integration_user';
    await db.insert(schema.transactions).values({ transactionId, userId, amount: 42 });

    await sns.send(new PublishCommand({ TopicArn: topicArn, Message: JSON.stringify({ userId, transactionId, amount: 42 }) }));

    const outcome = await waitFor(async () => {
      const [tx] = await db.select().from(schema.transactions).where(eq(schema.transactions.transactionId, transactionId));
      const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.transactionId, transactionId));
      return tx.status === 'confirmed' && notes.length >= 2 ? { tx, notes } : null;
    });

    expect(outcome.tx.status).toBe('confirmed');
    expect(outcome.notes.map((n) => n.channel).sort()).toEqual(['email', 'sms']);
    expect(outcome.notes.every((n) => n.userId === userId)).toBe(true);

    // cleanup
    await db.delete(schema.notifications).where(eq(schema.notifications.transactionId, transactionId));
    await db.delete(schema.transactions).where(eq(schema.transactions.transactionId, transactionId));
  });
});
