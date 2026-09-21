import express from 'express';
import helmet from 'helmet';
import paymentRoutes from './src/features/payment-service/payment.route.js';
import { register } from './src/observability/metrics.js';
import { logger } from './src/observability/logger.js';

const app = express();

app.disable('x-powered-by'); // no server fingerprint
app.use(helmet()); // standard security headers (nosniff, no-referrer, HSTS, ...)

// One line per request: method, path, status, duration. Probes are skipped.
app.use((req, res, next) => {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const started = Date.now();
  res.on('finish', () => {
    logger.info(
      { event: 'HTTP_REQUEST', method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - started },
      `${req.method} ${req.originalUrl} -> ${res.statusCode}`,
    );
  });
  next();
});
app.use(express.json({ limit: '10kb' })); // a payment is ~60 bytes; anything big is abuse

app.get('/health', (req, res) => res.json({ ok: true }));

// Prometheus scrape target (Grafana Alloy on the same box pulls this).
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.use('/api/payments', paymentRoutes);

// global middleware for error handling
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error({ event: 'HTTP_ERROR', err, method: req.method, path: req.originalUrl, status }, err.message);
  // 4xx are the client's fault: say what was wrong. 5xx are ours: never leak internals.
  res.status(status).json({ error: status < 500 ? err.message : 'Internal Server Error' });
});

export default app;
