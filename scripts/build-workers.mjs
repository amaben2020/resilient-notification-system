// Bundles each Lambda entry point (+ drizzle, neon driver, pino, shared config)
// into one self-contained file. Output: dist/<name>/index.mjs -> Terraform zips it.
import { build } from 'esbuild';

const entries = {
  email: 'src/features/workers/email/index.mjs',
  sms: 'src/features/workers/sms/index.mjs',
  order: 'src/features/workers/order/index.mjs',
  api: 'src/api/index.mjs',
};

for (const [name, entryPoint] of Object.entries(entries)) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm', // Lambda's "index.handler" resolves index.mjs -> export const handler
    outfile: `dist/${name}/index.mjs`,
    minify: false,
    // The Node 20 runtime ships AWS SDK v3. Keeping it external shrinks the
    // bundle and lets New Relic instrument SNS/SSM calls (it hooks imports).
    external: ['@aws-sdk/*'],
    // Lambda logs are machine-read: always JSON, never the pretty transport.
    define: { 'process.env.LOG_FORMAT': '"json"' },
    // CJS deps (pino, express) call require() at runtime; give the ESM bundle a real one.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'info',
  });
}
