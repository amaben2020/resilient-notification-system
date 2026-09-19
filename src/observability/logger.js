import pino from 'pino';

// One JSON object per line in Lambda / production (CloudWatch, Alloy ingest it).
// Pretty, colourised lines when running locally.
// Every log call carries an `event` name in SCREAMING_CASE so the interesting
// moments can be filtered: EVENT_PUBLISHED, QUEUE_MESSAGE_RECEIVED, ORDER_CONFIRMED...
const inLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const pretty = !inLambda && process.env.NODE_ENV !== 'production' && process.env.LOG_FORMAT !== 'json';

const options = {
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'notif-system' },
};

async function prettyStream() {
  // In-process stream (not a worker-thread transport): output is immediate and
  // nothing is lost on process.exit. Dev-only dependency.
  const { default: prettyFactory } = await import('pino-pretty');
  return prettyFactory({
    colorize: true,
    sync: true, // dev only: nothing buffered, nothing lost on process.exit
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname,service,event',
    messageFormat: '{event} — {msg}',
  });
}

export const logger = pretty ? pino(options, await prettyStream()) : pino(options);
