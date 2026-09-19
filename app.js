import express from 'express';
import paymentRoutes from './src/features/payment-service/payment.route.js';
import { register } from './src/observability/metrics.js';
import { logger } from './src/observability/logger.js';
import pinoHttp from 'pino-http';

const app = express();

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/metrics' || req.url === '/health' } }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

// Prometheus scrape target (Grafana Alloy on the same box pulls this).
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.use('/api/payments', paymentRoutes);

// global middleware for error handling
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path }, 'unhandled request error');
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Pipeline Error',
  });
});

export default app;
