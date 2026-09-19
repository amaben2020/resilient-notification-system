notif-system — payment -> SNS fan-out -> SQS -> Lambda workers -> Neon Postgres (Drizzle)

notif-system/
├── app.js / server.js                 Express API (POST /api/payments, GET /api/payments/:id)
├── src/
│   ├── config/
│   │   ├── db.js                      Drizzle client (neon-http driver)
│   │   ├── schema.js                  transactions + notifications tables
│   │   └── migrate.js                 applies ./drizzle/*.sql
│   └── features/
│       ├── payment-service/           route -> validator -> controller -> service -> repository
│       └── workers/
│           ├── parse-record.mjs       unwraps SQS body -> SNS envelope -> payload
│           ├── email/index.mjs        inserts notifications row (channel=email)
│           ├── sms/index.mjs          inserts notifications row (channel=sms)
│           └── order/index.mjs        sets transactions.status = confirmed
├── scripts/build-workers.mjs          esbuild: bundles each worker -> dist/<worker>/index.mjs
├── drizzle/                           generated SQL migrations (committed)
├── terraform/
│   ├── main.tf                        SNS, SQS(+DLQ), IAM, Lambda x3
│   ├── variables.tf
│   └── environments/
│       ├── staging.tfvars / staging.backend.hcl
│       └── prod.tfvars    / prod.backend.hcl
└── .github/workflows/
    ├── terraform.yml                  reusable: build -> plan -> migrate -> apply
    ├── deploy-staging.yml             PR = plan, push to staging = apply
    └── deploy-prod.yml                PR = plan, push to main/master = apply

Local dev
  cp .env.example .env         # fill DATABASE_URL
  npm install
  npm run db:generate          # after changing src/config/schema.js
  npm run db:migrate
  npm run dev
  curl -X POST localhost:3300/api/payments -H 'content-type: application/json' -d '{"userId":"u_1","amount":4999}'

Infra
  npm run build:workers
  cd terraform && terraform init -backend-config=environments/staging.backend.hcl
  TF_VAR_database_url=... terraform plan -var-file=environments/staging.tfvars
