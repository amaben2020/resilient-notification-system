import pino from 'pino';

// JSON to stdout, one line per event. CloudWatch (Lambda) and Alloy (EC2)
// both ingest stdout, so no transports are needed. Always include the
// transactionId in log calls: it is the correlation key across API and workers.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'notif-system' },
});
