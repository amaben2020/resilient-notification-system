import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { loadSecrets } from './secrets.js';

// In Lambda, DATABASE_URL is fetched from SSM here (top-level await runs once
// per container, at cold start). Locally it comes straight from .env.
await loadSecrets();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set (SSM parameter missing or .env not loaded)');
}

// neon-http talks to Postgres over HTTPS: no sockets, no pool, so the same
// client works in Express on a server and inside a Lambda without changes.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle({ client: sql, schema });
export { schema };
