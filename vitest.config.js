import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/api/**/*.test.js'],
    env: { LOG_LEVEL: 'silent', LOG_FORMAT: 'json' },
  },
});
