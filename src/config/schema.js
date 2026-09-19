import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

// Written by the payment service, updated by the order worker.
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  transactionId: text('transaction_id').notNull().unique(),
  userId: text('user_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').notNull().default('pending'), // pending -> confirmed
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One row per channel per transaction, written by the email/sms workers.
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  userId: text('user_id').notNull(),
  channel: text('channel').notNull(), // email | sms
  status: text('status').notNull().default('sent'),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
});
