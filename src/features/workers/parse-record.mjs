// SNS -> SQS -> Lambda wraps the payload twice:
//   record.body            = JSON string of the SNS envelope
//   snsEnvelope.Message    = JSON string of what payment.service.js published
export function parsePaymentEvent(record) {
  const snsEnvelope = JSON.parse(record.body);
  return JSON.parse(snsEnvelope.Message); // { userId, transactionId, amount }
}
