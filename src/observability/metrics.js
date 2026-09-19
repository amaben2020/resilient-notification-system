import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register }); // CPU, memory, event-loop lag: free

export const paymentCounter = new client.Counter({
  name: 'payments_processed_total',
  help: 'Total payments processed',
  labelNames: ['status'],
  registers: [register],
});

export const paymentDuration = new client.Histogram({
  name: 'payment_processing_duration_seconds',
  help: 'Time to persist a payment and publish its event',
  registers: [register],
});
