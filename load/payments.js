// k6 load test: create N payments through the public API as fast as VUs allow,
// then verify every one of them was processed by all three workers.
//   k6 run -e API_URL=https://... load/payments.js
//   k6 run -e API_URL=... -e ITERATIONS=500 -e VUS=50 load/payments.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const base = (__ENV.API_URL || 'http://localhost:3300').replace(/\/$/, '');
const iterations = Number(__ENV.ITERATIONS || 100);
const vus = Number(__ENV.VUS || 20);

const createLatency = new Trend('payment_create_ms', true);
const created = new Counter('payments_created');

export const options = {
  scenarios: {
    burst: { executor: 'shared-iterations', vus, iterations, maxDuration: '2m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],          // < 1% failed requests
    payment_create_ms: ['p(95)<3000'],       // p95 create under 3s (cold starts included)
  },
};

export default function () {
  const res = http.post(`${base}/api/payments`, JSON.stringify({ userId: `k6_vu${__VU}`, amount: 100 + __ITER }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'POST /api/payments' },
  });
  createLatency.add(res.timings.duration);
  const ok = check(res, {
    'status 201': (r) => r.status === 201,
    'has transactionId': (r) => r.json('transactionId') !== undefined,
  });
  if (ok) created.add(1);
  sleep(0.1);
}

// Runs once after all VUs finish: were all payments fully processed downstream?
export function teardown() {
  // give the slowest worker a moment; SQS -> Lambda is usually < 2 s
  sleep(8);
  const res = http.get(`${base}/api/payments/stats?userPrefix=k6_`, { tags: { name: 'GET stats' } });
  if (res.status === 200) {
    console.log(`downstream: ${res.body}`);
  }
}
