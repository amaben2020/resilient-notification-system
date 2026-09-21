import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { logger } from '../observability/logger.js';

// Secrets live in SSM Parameter Store under /notif-system/<env>/. Terraform
// creates the parameters; humans (or a one-time CI seed) set the values. At
// cold start every parameter under the prefix is loaded into process.env:
//   /notif-system/staging/database-url  ->  process.env.DATABASE_URL
// Locally SSM_PREFIX is unset and values come from .env as before.
export async function loadSecrets() {
  const prefix = process.env.SSM_PREFIX;
  if (!prefix) return [];

  const ssm = new SSMClient({});
  const loaded = [];
  let NextToken;
  do {
    const page = await ssm.send(
      new GetParametersByPathCommand({ Path: prefix, WithDecryption: true, NextToken }),
    );
    for (const p of page.Parameters ?? []) {
      const key = p.Name.slice(prefix.length + 1).toUpperCase().replaceAll('-', '_');
      if (p.Value === 'PLACEHOLDER') continue; // created by Terraform, not yet set
      process.env[key] ??= p.Value; // an explicit env var still wins
      loaded.push(key);
    }
    NextToken = page.NextToken;
  } while (NextToken);

  logger.info({ event: 'SECRETS_LOADED', prefix, keys: loaded }, `${loaded.length} secret(s) from SSM`);
  return loaded;
}
