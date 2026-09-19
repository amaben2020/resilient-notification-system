# Shared by every stack. The state KEY is passed separately so each stack
# (staging, prod, dev-ben, dev-mitchell, ...) gets its own state file:
#   terraform init -backend-config=environments/backend.hcl -backend-config="key=dev/ben/terraform.tfstate"
bucket       = "notif-system-tfstate"
region       = "eu-west-2"
use_lockfile = true
