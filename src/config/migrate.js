import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from './db.js';

// Applies any SQL files in ./drizzle that haven't run yet (tracked in the
// __drizzle_migrations table). Safe to run repeatedly.
await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied');
