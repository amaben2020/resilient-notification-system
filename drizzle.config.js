import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/config/schema.js',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
  // The Neon DB is shared with other projects. Never use `drizzle-kit push`
  // here: it diffs the whole DB and would try to drop tables it doesn't own.
  // Use `npm run db:generate` then `npm run db:migrate` instead.
  tablesFilter: ['transactions', 'notifications'],
});
