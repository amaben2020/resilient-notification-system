import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

// neon-http talks to Postgres over HTTPS: no sockets, no pool, so the same
// client works in Express on EC2 and inside a Lambda without changes.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle({ client: sql, schema });
export { schema };
