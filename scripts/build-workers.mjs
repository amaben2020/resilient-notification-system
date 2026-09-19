// Bundles each worker (+ drizzle, neon driver, shared config) into one file.
// Output: dist/<worker>/index.mjs  -> Terraform zips each dir into a Lambda.
import { build } from 'esbuild';

const workers = ['email', 'sms', 'order'];

for (const name of workers) {
  await build({
    entryPoints: [`src/features/workers/${name}/index.mjs`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm', // Lambda's "index.handler" resolves index.mjs -> export const handler
    outfile: `dist/${name}/index.mjs`,
    minify: false,
    // Lambda logs are machine-read: always JSON, never the pretty transport.
    define: { 'process.env.LOG_FORMAT': '"json"' },
    // CJS deps (pino) call require() at runtime; give the ESM bundle a real one.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'info',
  });
}
