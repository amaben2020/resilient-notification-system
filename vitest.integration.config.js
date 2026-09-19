import { defineConfig } from 'vitest/config';

// Hits real AWS + Neon. Needs DATABASE_URL, PAYMENT_CONFIRMED_TOPIC_ARN, AWS creds.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
