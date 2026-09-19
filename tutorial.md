# notif-system: from empty scaffold to a deployed event-driven pipeline

A payment comes in, one event is published, and three independent workers
react to it. This document walks through how the system was built, how the
infrastructure is provisioned with Terraform, how GitHub Actions deploys it,
and every real failure hit along the way (with the fix).

---

## 1. What we built

```mermaid
flowchart LR
    Client([curl / frontend]) -->|POST /api/payments| API[Express API<br/>EC2 or laptop]
    API -->|1. INSERT transaction<br/>status = pending| DB[(Neon Postgres<br/>Drizzle ORM)]
    API -->|2. Publish ONE message| SNS[SNS topic<br/>payment-confirmed]

    SNS --> Q1[SQS email-queue]
    SNS --> Q2[SQS sms-queue]
    SNS --> Q3[SQS order-queue]

    Q1 --> L1[Lambda email-worker]
    Q2 --> L2[Lambda sms-worker]
    Q3 --> L3[Lambda order-worker]

    L1 -->|INSERT notification<br/>channel = email| DB
    L2 -->|INSERT notification<br/>channel = sms| DB
    L3 -->|UPDATE transaction<br/>status = confirmed| DB

    Q1 -.->|3 failures| D1[email-dlq]
    Q2 -.->|3 failures| D2[sms-dlq]
    Q3 -.->|3 failures| D3[order-dlq]
```

Why this shape:

| Decision | Reason |
|---|---|
| SNS in front of SQS (fan-out) | The API publishes **once**. Adding a fourth consumer (push notifications, analytics) is one more subscription, zero API changes. |
| One SQS queue per worker | Each worker fails, retries and scales independently. A slow SMS provider never delays order confirmation. |
| Dead-letter queue per queue | After 3 failed attempts a message is parked, not lost. You can inspect and replay it. |
| Lambda for workers | Short, stateless, event-triggered. No servers to keep alive for something that runs for 200 ms. |
| Neon over HTTP (`neon-http` driver) | Each query is an HTTPS request, so there is no connection pool to exhaust from hundreds of concurrent Lambdas. Same client works in Express and Lambda. |

---

## 2. Repository layout

```
notif-system/
├── app.js / server.js                Express app + graceful shutdown
├── src/
│   ├── config/
│   │   ├── schema.js                 Drizzle table definitions
│   │   ├── db.js                     Drizzle client (neon-http)
│   │   └── migrate.js                applies ./drizzle/*.sql
│   ├── features/
│   │   ├── payment-service/          route -> validator -> controller -> service -> repository
│   │   └── workers/
│   │       ├── parse-record.mjs      unwraps SQS body -> SNS envelope -> payload
│   │       ├── email/index.mjs
│   │       ├── sms/index.mjs
│   │       └── order/index.mjs
│   └── observability/metrics.js      prom-client counters + /metrics
├── scripts/
│   ├── build-workers.mjs             esbuild: one bundle per worker -> dist/<worker>/index.mjs
│   └── smoke-test.mjs                POST a payment, poll until workers finish
├── drizzle/                          generated SQL migrations (committed)
├── terraform/
│   ├── main.tf                       SNS, SQS, IAM, Lambda, event source mappings
│   ├── observability.tf              SSM parameter for Grafana key
│   ├── variables.tf
│   ├── environments/                 <env>.tfvars + <env>.backend.hcl
│   └── bootstrap/                    one-time setup Terraform cannot do itself
└── .github/workflows/
    ├── terraform.yml                 reusable pipeline
    ├── deploy-staging.yml            calls it for staging
    └── deploy-prod.yml               calls it for prod
```

---

## 3. Step by step: application code

### 3.1 Database layer (Drizzle + Neon)

**Schema** (`src/config/schema.js`): two tables.

```mermaid
erDiagram
    transactions {
        serial id PK
        text transaction_id UK
        text user_id
        integer amount
        text status "pending -> confirmed"
        timestamp created_at
    }
    notifications {
        serial id PK
        text transaction_id
        text user_id
        text channel "email | sms"
        text status
        timestamp sent_at
    }
    transactions ||--o{ notifications : "transaction_id"
```

**Client** (`src/config/db.js`):

```js
const sql = neon(process.env.DATABASE_URL);
export const db = drizzle({ client: sql, schema });
```

**Migrations.** The schema is turned into SQL with `drizzle-kit generate`, the SQL
is committed under `drizzle/`, and `src/config/migrate.js` applies whatever has
not run yet (tracked in a `__drizzle_migrations` table).

```bash
npm run db:generate   # after editing schema.js
npm run db:migrate    # apply locally; CI runs the same before terraform apply
```

> **Why not `drizzle-kit push`?** `push` diffs the *entire* database against
> your schema and proposes dropping anything it does not know about. This Neon
> database is shared with another project, and `push` tried to drop that
> project's sequences. `generate` + `migrate` only ever runs SQL you committed.
> `drizzle.config.js` also sets `tablesFilter` as a second guard.

### 3.2 Payment feature

Request flow inside the API:

```mermaid
sequenceDiagram
    participant C as Client
    participant R as payment.route.js
    participant V as payment.validator.js
    participant Ctl as payment.controller.js
    participant S as payment.service.js
    participant Repo as payment.repository.js
    participant DB as Neon
    participant SNS as SNS

    C->>R: POST /api/payments {userId, amount}
    R->>V: validate body
    V-->>C: 400 if invalid
    V->>Ctl: next()
    Ctl->>S: processPayment(userId, amount)
    S->>Repo: insertTransaction(...)
    Repo->>DB: INSERT ... RETURNING
    DB-->>S: row (status = pending)
    S->>SNS: Publish({userId, transactionId, amount})
    S-->>Ctl: transaction
    Ctl-->>C: 201 {transactionId, status: "pending"}
```

Each layer has one job: the **validator** rejects bad input, the **controller**
maps HTTP to a function call, the **service** owns the business rule
("persist, then announce"), the **repository** is the only file that knows SQL.

The service also records Prometheus metrics (`payments_processed_total{status}`
and a duration histogram), exposed at `GET /metrics`.

### 3.3 Workers and the double envelope

When SNS delivers to SQS and SQS triggers Lambda, the original payload is
wrapped twice:

```mermaid
flowchart TB
    subgraph event["Lambda event"]
        subgraph record["event.Records[0]"]
            body["record.body  (string)"]
        end
    end
    body -->|JSON.parse| env["SNS envelope<br/>{ Type, MessageId, TopicArn, Message, ... }"]
    env -->|"JSON.parse(envelope.Message)"| payload["{ userId, transactionId, amount }"]
```

That is why `parse-record.mjs` parses twice:

```js
export function parsePaymentEvent(record) {
  const snsEnvelope = JSON.parse(record.body);
  return JSON.parse(snsEnvelope.Message);
}
```

Each worker is ~15 lines: loop over records, parse, do one DB write.

### 3.4 Logging

Metrics (Prometheus) answer "how many / how fast". Logs answer "what happened
to `txn_...`". `src/observability/logger.js` is a pino logger that writes one
JSON object per line to stdout:

```json
{"level":30,"service":"notif-system","worker":"order","transactionId":"txn_...","msg":"order confirmed"}
```

Locally the same line is pretty-printed (`pino-pretty`, in-process, sync):

```
[07:14:43.124] INFO: EVENT_PUBLISHED — payment_confirmed for txn_... -> SNS (fans out to email, sms, order queues)
    transactionId: "txn_..."
    topic: "notif-system-staging-payment-confirmed"
```

Every call carries an `event` name. The lifecycle of one payment reads:

| Where | Events, in order |
|---|---|
| API | `PAYMENT_CREATED` -> `EVENT_PUBLISHED` (or `EVENT_PUBLISH_SKIPPED`) -> `HTTP_REQUEST` |
| each worker | `QUEUE_BATCH_RECEIVED` -> `QUEUE_MESSAGE_RECEIVED` -> `PROCESSING` -> `EMAIL_SENT` / `SMS_SENT` / `ORDER_CONFIRMED` |
| failures | `PAYMENT_FAILED`, `HTTP_ERROR`, `QUEUE_MESSAGE_FAILED` (then rethrown so SQS retries) |

Lambda ships stdout to CloudWatch automatically; on EC2, Alloy tails it. The
`transactionId` field is the correlation key: filter on it in CloudWatch Logs
Insights and you see the API publish plus all three workers for one payment.
pino was chosen over winston because it is JSON-first, faster, and needs no
transport configuration for stdout-based collectors. Bundled workers are
pinned to JSON at build time (`define` in esbuild) because the pretty stream
is a dev-only dependency.

### 3.5 Bundling workers for Lambda

A Lambda zip must contain everything it imports. Instead of a `package.json`
per worker, `scripts/build-workers.mjs` uses esbuild to bundle each worker with
its dependencies (Drizzle, the Neon driver, the shared `db.js`) into a single
file:

```
src/features/workers/email/index.mjs  ─┐
src/config/db.js, schema.js            ├─ esbuild ─> dist/email/index.mjs (~400 KB)
node_modules/drizzle-orm, @neondatabase ┘
```

Output is ESM (`.mjs`) so it runs the same locally and on Lambda; the handler
string `index.handler` resolves to `export const handler` in `index.mjs`.
pino is CommonJS and calls `require()` at runtime, so the bundle gets a
`createRequire` banner; without it the bundle throws
`Dynamic require of "node:os" is not supported`.

### 3.6 How the Lambda code reaches AWS

```mermaid
flowchart LR
    A["src/.../index.mjs<br/>+ shared config<br/>+ node_modules"] -->|"esbuild<br/>(npm run build:workers)"| B["dist/email/index.mjs<br/>one self-contained file"]
    B -->|"data.archive_file<br/>(terraform plan)"| C["dist/email.zip<br/>+ base64 sha256"]
    C -->|"aws_lambda_function<br/>filename + source_code_hash"| D["Lambda: CreateFunction /<br/>UpdateFunctionCode"]
    D --> E["aws_lambda_event_source_mapping<br/>SQS poller -> handler"]
```

1. **Bundle.** Lambda runs no `npm install`; the zip must contain everything.
2. **Zip + hash.** `archive_file` runs at plan time and produces the zip and its
   SHA-256.
3. **Upload.** Terraform calls `CreateFunction` the first time and
   `UpdateFunctionCode` when `source_code_hash` differs from the value in
   state. A code-only change therefore plans as `0 to add, 3 to change`.
4. **Trigger.** The event source mapping is Lambda's SQS poller. It reads up to
   `batch_size` messages, calls the handler with them as `event.Records`, and
   deletes them only if the handler returns without throwing. A throw makes the
   batch visible again after the visibility timeout; after `maxReceiveCount`
   failures the messages go to the DLQ. Workers must therefore **let errors
   propagate** rather than catch-and-log them.
5. **Execution role.** `aws_iam_role.lambda_exec_role` is what the *function*
   is allowed to do (read its queue, write logs). It is unrelated to what the
   *CI user* is allowed to do (create the function).

---

## 4. Step by step: infrastructure with Terraform

### 4.1 How Terraform thinks

```mermaid
flowchart LR
    Code[".tf files<br/>(desired state)"] --> Plan
    State["terraform.tfstate<br/>(what TF created last time)"] --> Plan
    Real["Real AWS<br/>(refreshed via API)"] --> Plan
    Plan["terraform plan"] -->|"+ create<br/>~ change<br/>- destroy"| Review{human / CI<br/>approves?}
    Review -->|yes| Apply["terraform apply"]
    Apply --> Real
    Apply --> State
```

Three inputs, one diff. `plan` is read-only and safe to run anywhere. `apply`
executes the diff **and records the result in state**. Lose the state and
Terraform believes nothing exists, so the next apply tries to create
everything again and collides with what is already there.

### 4.2 Resources in `main.tf`

```mermaid
flowchart TB
    subgraph tf["terraform/main.tf (for_each over [email, sms, order])"]
        topic[aws_sns_topic]
        q[aws_sqs_queue x3]
        dlq[aws_sqs_queue dlq x3]
        sub[aws_sns_topic_subscription x3]
        qpol[aws_sqs_queue_policy x3]
        role[aws_iam_role]
        rpol[aws_iam_role_policy]
        zip[data.archive_file x3]
        fn[aws_lambda_function x3]
        esm[aws_lambda_event_source_mapping x3]
    end
    topic --> sub --> q
    q -->|redrive_policy| dlq
    topic -->|allow sns:SendMessage| qpol --> q
    role --> rpol
    role -->|execution role| fn
    zip -->|filename + source_code_hash| fn
    q --> esm --> fn
```

Points that matter:

- **`for_each = toset(local.workers)`** stamps out identical queue/DLQ/Lambda
  sets. Adding a worker = adding one string to the list.
- **`aws_sqs_queue_policy`** is required: SNS is a different principal and SQS
  denies it by default. The policy allows `sqs:SendMessage` only from our topic ARN.
- **`data "archive_file"`** zips `dist/<worker>/` at plan time, and
  `source_code_hash = output_base64sha256` makes Terraform redeploy when the
  bundle changes. Without the hash, code changes would show "no changes".
- **`sensitive = true`** on `database_url` prints `(sensitive value)` in plans.
- **`aws_lambda_event_source_mapping`** is the piece that makes SQS invoke
  Lambda (batch of up to 10 messages per invocation).

### 4.3 Remote state and environments

```hcl
terraform {
  backend "s3" {}   # partial config, filled at init time
}
```

```
environments/staging.backend.hcl        environments/prod.backend.hcl
bucket = "notif-system-tfstate"         bucket = "notif-system-tfstate"
key    = "staging/terraform.tfstate"    key    = "prod/terraform.tfstate"
use_lockfile = true                     use_lockfile = true
```

```bash
terraform init -backend-config=environments/staging.backend.hcl
terraform plan -var-file=environments/staging.tfvars
```

Same code, different state file and different `environment` variable, so every
resource name gets a `notif-system-staging-` or `notif-system-prod-` prefix.
`use_lockfile = true` (Terraform >= 1.10) uses S3 conditional writes for
locking, so no DynamoDB table is needed.

For local plans without the bucket, `terraform/backend_override.tf`
(gitignored) swaps in `backend "local" {}`. Terraform merges any
`*_override.tf` file last.

### 4.4 Bootstrap: the chicken-and-egg part

Terraform cannot create the bucket its own state lives in, nor grant itself
permissions. `terraform/bootstrap/README` holds the one-time commands:

1. Create the versioned, private S3 bucket.
2. Create the customer-managed policy `NotifSystemTerraform` from
   `ci-user-policy.json`, attach it to group `notif-system-ci`, add the CI user.

```mermaid
flowchart LR
    U[IAM user amaben<br/>keys used by CI] -->|member of| G[group notif-system-ci]
    G -->|attached| P[managed policy<br/>NotifSystemTerraform]
    P --> S1["sns:* on notif-system-*"]
    P --> S2["sqs:* on notif-system-*"]
    P --> S3["lambda:* on function:notif-system-*"]
    P --> S4["lambda:*EventSourceMapping on *"]
    P --> S5["ssm:* on parameter/notif-system-*"]
    P --> S6["List* read-only on *"]
```

Why a group: a user may hold at most **10 managed policies** and **2048 bytes
of inline policy** in total; this user was at both limits. Group policies count
against neither.

---

## 5. How CI/CD works

### 5.1 Branch strategy: dev -> staging -> master

```mermaid
gitGraph
    commit id: "scaffold"
    branch staging
    checkout staging
    commit id: "feat: wire everything" tag: "staging apply"
    branch dev
    checkout dev
    commit id: "feat: something" tag: "ci: tests only"
    commit id: "fix: review"
    checkout staging
    merge dev id: "PR dev->staging" tag: "plan on PR, apply on merge"
    checkout main
    merge staging id: "PR staging->master" tag: "plan on PR, apply on merge"
```

Three branches, three levels of blast radius:

| Branch | Workflow | AWS access | What runs |
|---|---|---|---|
| `dev`, `feature/*` (push) | ci.yml | none | `npm test`, bundle, `terraform fmt/validate` |
| PR into `staging` | deploy-staging | read (plan) | plan against **staging state**, nothing changes |
| push to `staging` (merge) | deploy-staging | write | migrate + apply to staging + integration test |
| PR into `master` | deploy-prod | read (plan) | plan against **prod state** |
| push to `master` (merge) | deploy-prod | write | migrate + apply to prod + integration test |

What is required to promote:

1. **dev -> staging**: open a PR. The plan-only run is your review artifact:
   read it, confirm it says what you expect (`0 to add, 3 to change` for a
   code-only change), merge. Merge triggers the apply.
2. **staging -> master**: same, but the plan runs against prod state. The first
   time it says `22 to add` because prod does not exist yet; afterwards it is
   usually the same diff you already saw on staging.

Nothing is deployed from `dev`; it exists so tests run on every push without
touching AWS. That is also why `ci.yml` needs no secrets.

### 5.1b Personal stacks: one isolated environment per developer

Working against staging from a laptop is fine for one person. With several
developers, Ben's test messages would be processed by the same Lambdas and
land in the same tables as Mitchell's. `dev-stack.yml` gives each developer
their own copy of everything:

```mermaid
flowchart LR
    subgraph ben["Ben  (environment = dev-ben)"]
        b1[SNS notif-system-dev-ben-payment-confirmed]
        b2[SQS dev-ben-*-queue x3]
        b3[Lambda dev-ben-*-worker x3]
        b4[(Neon branch dev-ben)]
        b5[S3 state dev-ben/terraform.tfstate]
    end
    subgraph mitchell["Mitchell  (environment = dev-mitchell)"]
        m1[SNS notif-system-dev-mitchell-payment-confirmed]
        m2[SQS dev-mitchell-*-queue x3]
        m3[Lambda dev-mitchell-*-worker x3]
        m4[(Neon branch dev-mitchell)]
        m5[S3 state dev-mitchell/terraform.tfstate]
    end
    subgraph shared["Shared"]
        code[same main.tf]
        bucket[same S3 bucket]
        parent[(Neon default branch)]
    end
    code --> ben
    code --> mitchell
    parent -.copy-on-write.-> b4
    parent -.copy-on-write.-> m4
```

How it works, and why it costs almost nothing extra to build:

| Isolation layer | Mechanism | Change needed |
|---|---|---|
| AWS resources | every name is `${project}-${var.environment}-...`; run with `-var environment=dev-ben` | none, `for_each` + `name_prefix` already did this |
| Terraform state | same bucket, different key: `-backend-config="key=dev-ben/terraform.tfstate"` | split `backend.hcl` so the key is passed per stack |
| Database | Neon **branch** per developer: a copy-on-write clone of the default branch with its own connection string | `scripts/neon-branch.sh` calls the Neon REST API; needs `NEON_API_KEY` + `NEON_PROJECT_ID` secrets |
| Permissions | the CI policy allows `notif-system-*`, so `notif-system-dev-ben-*` is already covered | none |
| Naming | `validation` block on `var.environment`: `staging`, `prod` or `dev-[a-z0-9]{1,20}` | guards against typos creating stray stacks |

Usage:

```
Actions -> Dev stack -> Run workflow -> developer: ben, action: up
```

The job summary prints the stack's outputs (topic ARN, queue URLs). Ben puts
that ARN and his branch's `DATABASE_URL` in his local `.env`, and his laptop
now talks only to his stack. `action: down` runs `terraform destroy` and
deletes the Neon branch. Serverless resources idle at $0, so a forgotten
stack costs nothing but clutter; the pattern is still to tear it down when the
feature merges.

Without the Neon secrets the workflow falls back to the shared database and
only isolates the AWS side. That is what the first demo run used.

### 5.2 The pipeline

Both `deploy-*.yml` files are thin callers of one reusable workflow:

```yaml
jobs:
  staging:
    uses: ./.github/workflows/terraform.yml
    with:
      environment: staging
      apply: ${{ github.event_name == 'push' }}
    secrets: inherit
```

```mermaid
flowchart TB
    A[checkout] --> B[setup-node 22<br/>npm ci]
    B --> C[npm run build:workers<br/>esbuild -> dist/]
    C --> D[configure-aws-credentials<br/>from secrets]
    D --> E[setup-terraform]
    E --> F[terraform fmt -check]
    F --> G["terraform init<br/>-backend-config=<env>.backend.hcl"]
    G --> H[terraform validate]
    H --> I["terraform plan -out=tfplan"]
    I --> J{apply == true?}
    J -->|PR: no| K([done: read the plan])
    J -->|push: yes| L[npm run db:migrate]
    L --> M[terraform apply tfplan]
    M --> N([outputs: topic ARN, queue URLs])
```

Details worth knowing:

- **`plan -out=tfplan` then `apply tfplan`** applies exactly what was planned,
  not a fresh diff. If AWS changed in between, apply fails instead of doing
  something you did not review.
- **Migrations run before apply** so new Lambda code never meets missing tables.
- **`concurrency: terraform-<env>`** stops two pushes from applying at once.
- **`environment: notif-app`** on the job is the GitHub environment that holds
  the secrets. It is unrelated to the Terraform environment; one GitHub
  environment currently serves both stacks.
- **`secrets: inherit`** is required: a caller evaluating
  `${{ secrets.X }}` runs outside the job's environment, so environment-scoped
  secrets would resolve to empty.

### 5.3 Secrets

| Secret | Used by |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Terraform + AWS CLI in CI |
| `DATABASE_URL` | `TF_VAR_database_url` (into Lambda env) and `npm run db:migrate` |
| `GRAFANA_CLOUD_API_KEY` | `TF_VAR_grafana_cloud_api_key` (into SSM), optional |

Terraform reads any `TF_VAR_<name>` environment variable as the variable
`<name>`, which is how secrets reach `variables.tf` without appearing in files.

---

### 3.7 Reading the logs in Grafana

Lambda writes stdout to CloudWatch Logs, one log group per function. Rather
than shipping those somewhere, Grafana Cloud queries them in place through its
**CloudWatch data source**, which also exposes the Lambda metrics AWS already
collects (invocations, errors, duration, throttles).

```mermaid
flowchart LR
    L1[λ api] --> CW[CloudWatch Logs<br/>7 log groups]
    L2[λ email/sms/order] --> CW
    L3[λ ...] --> CWM[CloudWatch Metrics<br/>AWS/Lambda, AWS/SQS]
    CW -->|Logs Insights| G[Grafana Cloud<br/>CloudWatch data source]
    CWM -->|GetMetricData| G
    IAM[IAM user grafana-cloudwatch<br/>read-only, notif-system-* log groups] -.credentials.-> G
```

Setup (once): create the read-only IAM user (bootstrap README step 4), then in
Grafana: **Connections -> Data sources -> Add -> CloudWatch**, authentication
"Access & secret key", default region `eu-west-2`, Save & test.

Queries that pay off (Explore -> CloudWatch -> Logs, pick the
`/aws/lambda/notif-system-staging-*` log groups):

```
# everything that happened, newest first
fields @timestamp, event, worker, transactionId, msg
| filter ispresent(event)
| sort @timestamp desc

# one payment across API and all three workers
fields @timestamp, event, worker, msg
| filter transactionId = "txn_..."
| sort @timestamp asc

# failures only
fields @timestamp, event, worker, transactionId, msg, err.message
| filter event in ["QUEUE_MESSAGE_FAILED", "PAYMENT_FAILED", "HTTP_ERROR"]

# throughput per worker per 5 minutes
stats count() by bin(5m), worker
| filter event in ["EMAIL_SENT", "SMS_SENT", "ORDER_CONFIRMED"]
```

Because every line is JSON, CloudWatch indexes the fields automatically:
`event`, `worker`, `transactionId` are queryable without any parsing rules.
That is the concrete return on structured logging.

**Dashboard.** `observability/grafana-dashboard.json` is importable
(Dashboards -> New -> Import -> upload, pick the CloudWatch data source). It has
an `env` switch (staging / prod) and three rows:

| Row | Panels | Source |
|---|---|---|
| Lambda | invocations, errors, duration p95, concurrency, throttles, **max memory used** | `AWS/Lambda` metrics; memory is parsed from the `REPORT` line of every invocation (`@maxMemoryUsed`), no agent needed |
| SQS | age of oldest message, sent/received/deleted, **DLQ depth** | `AWS/SQS` metrics |
| Logs | events per worker, failures, live event stream | Logs Insights on the four log groups |

There is no CPU metric for Lambda: nothing is running between invocations.
Lambda Insights (an extension layer) adds CPU/network/memory utilisation but
bills ~8 custom metrics per function, which is not worth it at this size.

For metrics (Explore -> CloudWatch -> Metrics): namespace `AWS/Lambda`,
metric `Errors` or `Duration`, dimension `FunctionName`; namespace `AWS/SQS`,
metric `ApproximateAgeOfOldestMessage` per queue is the one to alert on (a
rising value means a consumer is broken or falling behind), and
`ApproximateNumberOfMessagesVisible` on the `-dlq` queues should stay at 0.

## 6. Testing

```mermaid
flowchart TB
    subgraph fast["npm test  (offline, ~300 ms, runs on every push)"]
        U1[validator]
        U2[parse-record<br/>double envelope]
        U3[service<br/>mocked repo + SNS]
        U4[workers<br/>mocked db]
        A1[supertest: /health, /metrics,<br/>POST 400/201/500, GET 404/200]
    end
    subgraph slow["npm run test:integration  (real AWS, ~6 s, after every apply)"]
        I1[topic has exactly the<br/>email/sms/order SQS subscriptions]
        I2[publish once -> all three<br/>Lambdas write to Neon]
    end
```

| Layer | Tool | What is real | What is faked |
|---|---|---|---|
| Unit | vitest | the function under test | repository, SNS client, db |
| API | vitest + supertest | Express app, routes, middleware, error handler | repository, SNS client |
| Integration | vitest | SNS, SQS, Lambda, Neon | nothing (publishes directly to the topic) |

The integration test is the only one that proves fan-out. It inserts a
transaction, publishes to the real topic, and polls Neon until the order
worker has set `confirmed` and both notification rows exist. CI runs it right
after `terraform apply`, using the topic ARN from `terraform output`, so a
broken deploy fails the pipeline instead of being discovered later.

## 7. Running locally

```bash
cp .env.example .env            # fill DATABASE_URL and PAYMENT_CONFIRMED_TOPIC_ARN
npm install
npm run db:migrate
npm run dev                     # terminal 1
npm run smoke                   # terminal 2
```

`smoke` posts a payment and polls `GET /api/payments/:id` until the order
worker has set `status = confirmed` and both notification rows exist.
Typical result against real AWS: 4-5 seconds.

Manual:

```bash
curl -X POST localhost:3300/api/payments -H 'content-type: application/json' \
  -d '{"userId":"u_1","amount":4999}'
curl localhost:3300/api/payments/<transactionId>
curl localhost:3300/metrics | grep payments_processed
```

Infra:

```bash
npm run build:workers
cd terraform
terraform init -backend-config=environments/staging.backend.hcl
TF_VAR_database_url=... terraform plan -var-file=environments/staging.tfvars
```

---

## 8. Failures we actually hit, in order

Every one of these is a normal part of standing up a pipeline. Knowing the
symptom -> cause mapping is most of the job.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | `drizzle-kit push` prompts about renames, then tries to `DROP SEQUENCE users_id_seq` | Shared database; `push` diffs everything | Switch to `generate` + `migrate`; add `tablesFilter` |
| 2 | `module is not defined in ES module scope` when loading worker bundle | esbuild emitted CJS into a `.js` file under `"type": "module"` | Emit ESM `.mjs` |
| 3 | `terraform plan` -> `Backend initialization required` after `init -backend=false` | `-backend=false` allows `validate` but not `plan` | Gitignored `backend_override.tf` with `backend "local" {}` |
| 4 | `dist/` ended up staged in git | Original `.gitignore` had no trailing newline; append glued onto `*.tfstate` | Rewrite `.gitignore` |
| 5 | `configure-aws-credentials` fails, secrets empty | Secrets were in GitHub environment `notif-app`, job declared `staging`; also caller passed secrets explicitly | `environment: notif-app` + `secrets: inherit` |
| 6 | `The security token included in the request is invalid` | Key pair in secrets did not match the only active key on the IAM user | Re-paste both values from `~/.aws/credentials` |
| 7 | `not authorized to perform: SNS:CreateTopic` (and SQS, Lambda, SSM) | User only had IAM + S3 access | Scoped policy `ci-user-policy.json` |
| 8 | `Maximum policy size of 2048 bytes exceeded for user` | Inline policy cap | Customer-managed policy attached via group |
| 9 | Policy attached, simulator says allowed, Lambda still 403 | **IAM propagation lag**, per service (SNS/SQS instant, Lambda/SSM minutes) | Poll the real API call before re-running |
| 10 | `lambda:ListTags on event-source-mapping:...` denied after functions created | Event source mappings have their own ARN shape, not `function:` | Add statement for `event-source-mapping:*` |
| 11 | Console shows nothing in eu-west-2 | `List*` APIs cannot be resource-scoped; policy had none | Read-only `ListFunctions`/`ListQueues`/`ListTopics` on `*` |
| 12 | Bundled worker: `Dynamic require of "node:os" is not supported` | pino is CJS, esbuild ESM output has no `require` | `createRequire` banner in esbuild config |
| 13 | Public Function URL returns `403 Forbidden` with a correct-looking policy | Since Oct 2025 auth-NONE URLs need **two** statements: `InvokeFunctionUrl` and `InvokeFunction` (condition `InvokedViaFunctionUrl`); provider 5.x could not express the second | Upgrade `hashicorp/aws` to `~> 6.0`, add second `aws_lambda_permission` |

The pattern behind 7-11: read the `AccessDenied` message literally. It names
the exact action and the exact resource ARN to add.

### Partial applies are fine

Runs 7, 9 and 10 each failed mid-apply. Nothing needed cleaning up: whatever
was created is in the S3 state, so the next run planned only the remainder
(`22 -> 21 -> 6 -> 3 to add -> No changes`). That is the practical payoff of
remote state.

---

## 9. Glossary

| Term | Meaning here |
|---|---|
| Fan-out | One publish, N deliveries. SNS -> N SQS queues. |
| DLQ | Dead-letter queue. Where a message goes after `maxReceiveCount` failures. |
| Event source mapping | The Lambda-side resource that polls an SQS queue and invokes the function. |
| Visibility timeout | How long SQS hides a message while a consumer works on it (60 s here, must exceed Lambda timeout of 30 s). |
| State | Terraform's record of what it created. Lives in S3 for this project. |
| Plan / apply | Diff / execute-the-diff. |
| `for_each` | Terraform loop; produces `resource["email"]`, `resource["sms"]`, ... |
| Reusable workflow | A GitHub Actions workflow with `on: workflow_call`, invoked by other workflows via `uses:`. |
| GitHub environment | A named bag of secrets and protection rules a job can target. |
| `TF_VAR_x` | Environment variable Terraform reads as input variable `x`. |
| neon-http | Neon's driver that sends each SQL statement as an HTTPS request. No sockets, no pool. |
