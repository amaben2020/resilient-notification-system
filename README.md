Folder structure

notif-system/
├── node_modules/
├── src/
│   ├── config/
│   └── features/
│       ├── email-service/
│       ├── orders-service/
│       ├── payment-service/
│       └── sms-service/
├── terraform/                    ← new
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── environments/
│       ├── dev.tfvars
│       ├── staging.tfvars
│       └── prod.tfvars
├── .gitignore
├── app.js
├── architecture.md
├── package.json
└── server.js
